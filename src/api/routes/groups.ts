import { procedure, router } from "../trpc";
import { z } from "zod";
import { authUser } from "../auth";
import db from "../database/db";
import { Includeable, Transaction } from "sequelize";
import User from "../database/models/User";
import { TRPCError } from "@trpc/server";
import Transcript from "../database/models/Transcript";
import Summary from "../database/models/Summary";
import invariant from "tiny-invariant";
import _ from "lodash";
import { isPermitted } from "../../shared/Role";
import sequelizeInstance from "../database/sequelizeInstance";
import { formatUserName, formatGroupName } from "../../shared/strings";
import nzh from 'nzh';
import { email } from "../sendgrid";
import { alreadyExistsError, noPermissionError, notFoundError } from "../errors";
import { Group, GroupCountingTranscripts, zGroup, zGroupCountingTranscripts, 
  zGroupWithTranscripts } from "../../shared/Group";
import { includeForGroup } from "../database/models/attributesAndIncludes";

async function listGroups(userIds: string[], additionalWhere?: { [k: string]: any }):
  Promise<GroupCountingTranscripts[]> 
{
  const includes: Includeable[] = [...includeForGroup, {
    model: Transcript,
    // We don't need to return any attributes, but sequelize seems to require at least one attribute.
    // TODO: Any way to return transcript count?
    attributes: ['transcriptId']
  }];

  if (userIds.length === 0) {
    return await db.Group.findAll({ where: additionalWhere, include: includes });
  } else {
    return (await findGroups(userIds, 'inclusive', includes, additionalWhere)) as GroupCountingTranscripts[];
  }
}

const create = procedure
  .use(authUser('GroupManager'))
  .input(z.object({
    userIds: z.array(z.string()).min(2),
  }))
  .mutation(async ({ ctx, input }) =>
{
  const res = await createGroupDeprecated(input.userIds);
  await emailNewUsersOfGroupIgnoreError(ctx, res.group.id, input.userIds);
  return res;
});

const update = procedure
  .use(authUser('GroupManager'))
  .input(zGroup)
  .mutation(async ({ ctx, input }) =>
{
  const newUserIds = input.users.map(u => u.id);
  checkMinimalGroupSize(newUserIds);

  const addUserIds: string[] = [];
  await sequelizeInstance.transaction(async (t) => {
    const group = await db.Group.findByPk(input.id, {
      include: db.GroupUser
    });
    if (!group) throw notFoundError("分组", input.id);

    // Delete old users
    var deleted = false;
    for (const oldGU of group.groupUsers) {
      if (!newUserIds.includes(oldGU.userId)) {
        await oldGU.destroy({ transaction: t });
        deleted = true;
      }
    }

    // Update group itself
    await group.update({
      // Set to null if the input is an empty string.
      name: input.name || null,
      // Reset the meeting link to prevent deleted users from reusing it.
      ...deleted ? {
        meetingLink: null,
      } : {}
    }, { transaction: t });

    // Add new users
    const oldUserIds = group.groupUsers.map(gu => gu.userId);
    addUserIds.push(...newUserIds.filter(uid => !oldUserIds.includes(uid)));
    const promises = addUserIds.map(async uid => {
      // upsert because the matching row may have been previously deleted.
      await db.GroupUser.upsert({
        groupId: input.id,
        userId: uid,
        deletedAt: null,
      }, { transaction: t })
    });
    await Promise.all(promises);
  });

  // new users are persisted only after the transaction is committed (not read-your-write yet).
  await emailNewUsersOfGroupIgnoreError(ctx, input.id, addUserIds);
});

const destroy = procedure
  .use(authUser('GroupManager'))
  .input(z.object({ groupId: z.string().uuid() }))
  .mutation(async ({ input }) => 
{
  const group = await db.Group.findByPk(input.groupId);
  if (!group) throw notFoundError("分组", input.groupId);

  // Need a transaction for cascading destroys
  await sequelizeInstance.transaction(async (t) => {
    await group.destroy({ transaction: t });
  });
});

/**
 * @param includeUnowned Whether to include unowned groups. A group is unowned iff. its partnershipId is null.
 */
const listMine = procedure
  .use(authUser())
  .input(z.object({ 
    includeOwned: z.boolean(),
  }))
  .output(z.array(zGroupCountingTranscripts))
  .query(async ({ ctx, input }) => 
{
  return (await db.GroupUser.findAll({
    where: { 
      userId: ctx.user.id,
    },
    include: [{
      model: db.Group,
      include: [...includeForGroup, Transcript],
      where: input.includeOwned ? {} : { partnershipId: null },
    }]
  })).map(groupUser => groupUser.group);
});

/**
 * @param userIds Return all the groups if `userIds` is empty, otherwise groups that contains the given users.
 * @param includeUnowned Whether to include unowned groups. A group is unowned iff. its partnershipId is null.
 */
const list = procedure
  .use(authUser(['GroupManager']))
  .input(z.object({ 
    userIds: z.string().array(),
    includeOwned: z.boolean(),
  }))
  .output(z.array(zGroup))
  .query(async ({ input }) => listGroups(input.userIds, input.includeOwned ? {} : { partnershipId: null }));

/**
 * Identical to `list`, but additionally returns empty transcripts
 */
const listCountingTranscripts = procedure
  .use(authUser(['SummaryEngineer']))
  .input(z.object({ userIds: z.string().array(), }))
  .output(z.array(zGroupCountingTranscripts))
  .query(async ({ input }) => listGroups(input.userIds));

/**
 * Transcripts in the return value are sorted by reverse chronological order.
 */
const get = procedure
  // We will throw access denied later if the user isn't a privileged user and isn't in the group.
  .use(authUser())
  .input(z.object({ id: z.string().uuid() }))
  .output(zGroupWithTranscripts)
  .query(async ({ input, ctx }) => 
{
  const g = await db.Group.findByPk(input.id, {
    include: [...includeForGroup, {
      model: Transcript,
      include: [{
        model: Summary,
        attributes: [ 'summaryKey' ]  // Caller should only need to get the summary count.
      }],
    }],
    order: [
      [{ model: Transcript, as: 'transcripts' }, 'startedAt', 'desc']
    ],
  });
  if (!g) throw notFoundError("分组", input.id);
  if (!isPermitted(ctx.user.roles, 'SummaryEngineer') && !g.users.some(u => u.id === ctx.user.id)) {
    throw noPermissionError("分组", input.id);
  }
  return g;
});

export default router({
  create,
  update,
  destroy,
  list,
  listMine,
  listCountingTranscripts,
  get,
});

/**
 * @returns groups that contain all the given users.
 * @param mode if `exclusive`, return the singleton group that contains no more other users, or an empty array if no
 * such group exists.
 * @param includes Optional `include`s in the returned group.
 */
export async function findGroups(userIds: string[], mode: 'inclusive' | 'exclusive', includes?: Includeable[], 
  additionalWhere?: { [k: string]: any }): Promise<Group[] | GroupCountingTranscripts[]> 
{
  invariant(userIds.length > 0);

  const gus = await db.GroupUser.findAll({
    where: {
      userId: userIds[0] as string,
    },
    include: [{
      model: db.Group,
      include: [db.GroupUser, ...(includes || [])],
      where: additionalWhere,
    }]
  })

  const res = gus.filter(gu => {
    const groupUserIds = gu.group.groupUsers.map(gu => gu.userId);
    const isSubset = userIds.every(uid => groupUserIds.includes(uid));
    return isSubset && (mode === 'inclusive' || userIds.length === groupUserIds.length);
  }).map(gu => gu.group);

  invariant(mode === 'inclusive' || res.length <= 1);
  return res;
}

export async function createGroup(userIds: string[], partnershipId: string | null, t: Transaction): Promise<Group>
{
  const g = await db.Group.create({ partnershipId }, { transaction: t });
  await db.GroupUser.bulkCreate(userIds.map(userId => ({
    userId,
    groupId: g.id,
  })), { transaction: t });
  return g;
}

/**
 * Use createGroup instead
 */
export async function createGroupDeprecated(userIds: string[]) {
  checkMinimalGroupSize(userIds);
  const existing = await findGroups(userIds, 'exclusive');
  if (existing.length > 0) {
    throw alreadyExistsError("分组");
  }

  const group = await db.Group.create({});
  const groupUsers = await db.GroupUser.bulkCreate(userIds.map(userId => ({
    userId: userId,
    groupId: group.id,
  })));

  return {
    group,
    groupUsers,
  }
}

async function emailNewUsersOfGroupIgnoreError(ctx: any, groupId: string, userIds: string[]) {
  try {
    await emailNewUsersOfGroup(ctx, groupId, userIds);
  } catch (e) {
    console.log('Error ignored by emailNewUsersOfGroupIgnoreError()', e);
  }
}

async function emailNewUsersOfGroup(ctx: any, groupId: string, newUserIds: string[]) {
  if (newUserIds.length == 0) return;

  const group = await db.Group.findByPk(groupId, {
    include: [{
      model: User,
      attributes: ['id', 'name', 'email'],
    }]
  });
  if (!group) throw notFoundError('分组', groupId);

  const formatNames = (names: string[]) =>
    names.slice(0, 3).join('、') + (names.length > 3 ? `等${nzh.cn.encodeS(names.length)}人` : '');

  const personalizations = newUserIds
  // Don't send emails to self.
  .filter(uid => uid != ctx.user.id)
  .map(uid => {
    const theseUsers = group.users.filter(u => u.id === uid);
    invariant(theseUsers.length === 1);
    const thisUser = theseUsers[0];

    return {
      to: [{ 
        email: thisUser.email, 
        name: thisUser.name 
      }],
      dynamicTemplateData: {
        name: formatUserName(thisUser.name, 'friendly'),
        manager: ctx.user.name,
        groupName: formatGroupName(group.name, group.users.length),
        others: formatNames(group.users.filter(u => u.id !== uid).map(u => u.name)),
        groupUrl: `${ctx.baseUrl}/groups/${group.id}`
      }
    }
  });

  await email('d-839f4554487c4f3abeca937c80858b4e', personalizations, ctx.baseUrl);
}

function checkMinimalGroupSize(userIds: string[]) {
  // Some userIds may be duplicates
  if ((new Set(userIds)).size < 2) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '每个分组需要至少两名用户。'
    })
  }
}
