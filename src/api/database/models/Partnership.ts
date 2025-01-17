import {
  Column,
  ForeignKey,
  Table,
  BelongsTo,
  Model,
  PrimaryKey,
  IsUUID,
  Default,
  HasMany,
  AllowNull,
  HasOne,
  Unique,
} from "sequelize-typescript";
import { CreationOptional, JSONB, UUID, UUIDV4 } from "sequelize";
import User from "./User";
import Assessment from "./Assessment";
import ZodColumn from "../modelHelpers/ZodColumn";
import { PrivateMentorNotes, zPrivateMentorNotes } from "../../../shared/Partnership";
import Group from "./Group";

/**
 * A partnership is a mentee-mentor pair
 */
@Table({
  paranoid: true,
  indexes: [{
    unique: true,
    fields: ['mentorId', 'menteeId']
  }]
})
class Partnership extends Model {
  @Unique
  @IsUUID(4)
  @PrimaryKey
  @Default(UUIDV4)
  @Column(UUID)
  id: CreationOptional<string>;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column(UUID)
  mentorId: string;

  @BelongsTo(() => User, { foreignKey: 'mentorId' })
  mentor: User;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column(UUID)
  menteeId: string;

  @BelongsTo(() => User, { foreignKey: 'menteeId' })
  mentee: User;

  @ZodColumn(JSONB, zPrivateMentorNotes.nullable())
  privateMentorNotes: PrivateMentorNotes | null;

  @HasOne(() => Group)
  group: Group;

  @HasMany(() => Assessment)
  assessments: Assessment[];
}

export default Partnership;
