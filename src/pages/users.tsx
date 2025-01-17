import {
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  ModalHeader,
  ModalContent,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  FormControl,
  FormLabel,
  Input,
  VStack,
  FormErrorMessage,
  Stack,
  Checkbox,
  Box,
  Tag,
  Wrap,
  WrapItem,
  Flex,
  TableContainer,
} from '@chakra-ui/react'
import React, { useState } from 'react'
import AppLayout from 'AppLayout'
import { NextPageWithLayout } from '../NextPageWithLayout'
import { trpcNext } from "../trpc";
import User from 'shared/User';
import ModalWithBackdrop from 'components/ModalWithBackdrop';
import { isValidChineseName, toPinyin } from 'shared/strings';
import Role, { AllRoles, RoleProfiles, isPermitted } from 'shared/Role';
import trpc from 'trpc';
import { useUserContext } from 'UserContext';
import { AddIcon, EditIcon } from '@chakra-ui/icons';
import Loader from 'components/Loader';
import z from "zod";

const Page: NextPageWithLayout = () => {
  const { data, refetch } : { data: User[] | undefined, refetch: () => void } = trpcNext.users.list.useQuery();
  const [userBeingEdited, setUserBeingEdited] = useState<User | null>(null);
  const [creatingNewUser, setCreatingNewUser] = useState(false);
  const [me] = useUserContext();
  
  const closeUserEditor = () => {
    setUserBeingEdited(null);
    setCreatingNewUser(false);
    refetch();
  };

  return <>
    {userBeingEdited && <UserEditor user={userBeingEdited} onClose={closeUserEditor}/>}
    {creatingNewUser && <UserEditor onClose={closeUserEditor}/>}

    <Flex direction='column' gap={6}>
      <Box>
        <Button variant='brand' leftIcon={<AddIcon />} onClick={() => setCreatingNewUser(true)}>新建用户</Button>
      </Box>
      {!data ? <Loader /> :
        <TableContainer>
          <Table>
            <Thead>
              <Tr>
                <Th>电子邮箱</Th>
                <Th>姓名</Th>
                <Th>拼音</Th>
                <Th>角色</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {data.map((u: any) => (
                <Tr key={u.id} onClick={() => setUserBeingEdited(u)} cursor='pointer'>
                  <Td>{u.email}</Td>
                  <Td>{u.name} {me.id === u.id ? "（我）" : ""}</Td>
                  <Td>{toPinyin(u.name ?? '')}</Td>
                  <Td>
                    <Wrap>
                    {u.roles.map((r: Role) => {
                      const rp = RoleProfiles[r];
                      return <WrapItem key={r}>
                        <Tag bgColor={rp.privileged ? "orange" : "brand.c"} color="white">
                          {rp.displayName}
                        </Tag>
                      </WrapItem>;
                    })}
                    </Wrap>
                  </Td>
                  <Td><EditIcon /></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      }
    </Flex>
  </>
}

Page.getLayout = (page) => <AppLayout>{page}</AppLayout>;

export default Page;

function UserEditor(props: { 
  user?: User, // When absent, create a new user.
  onClose: () => void,
}) {
  const u = props.user ?? {
    email: '',
    name: '',
    roles: [],
  };

  const [me] = useUserContext();
  const [email, setEmail] = useState(u.email);
  const [name, setName] = useState(u.name || '');
  const [roles, setRoles] = useState(u.roles);
  const [saving, setSaving] = useState(false);
  const validName = isValidChineseName(name);
  const validEmail = z.string().email().safeParse(email).success;

  const setRole = (e: any) => {
    if (e.target.checked) setRoles([...roles, e.target.value]);
    else setRoles(roles.filter(r => r !== e.target.value));
  }

  const save = async () => {
    setSaving(true);
    try {
      if (props.user) {
        const u = structuredClone(props.user);
        u.email = email;
        u.name = name;
        u.roles = roles;
        await trpc.users.update.mutate(u);
      } else {
        await trpc.users.create.mutate({ name, email, roles });
      }
      props.onClose();
    } finally {
      setSaving(false);
    }
  }

  return <ModalWithBackdrop isOpen onClose={props.onClose}>
    <ModalContent>
      <ModalHeader>{u.name}</ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        <VStack spacing={6}>
          <FormControl isRequired isInvalid={!validEmail}>
            <FormLabel>Email</FormLabel>
            <Input type='email' value={email} onChange={e => setEmail(e.target.value)} />
            <FormErrorMessage>需要填写有效Email地址。</FormErrorMessage>
          </FormControl>
          <FormControl isRequired isInvalid={!validName}>
            <FormLabel>姓名</FormLabel>
            <Input value={name} onChange={e => setName(e.target.value)} />
            <FormErrorMessage>需要填写中文姓名。</FormErrorMessage>
          </FormControl>
          <FormControl>
            <FormLabel>角色</FormLabel>
            <Stack>
              {AllRoles
                .filter(r => isPermitted(me.roles, "PrivilegedRoleManager") || !RoleProfiles[r].privileged)
                .map(r => {
                const rp = RoleProfiles[r];
                return (
                  <Checkbox key={r} value={r} isChecked={isPermitted(roles, r)} onChange={setRole}>
                    {rp.privileged ? "*" : ""} {rp.displayName}（{r}）
                  </Checkbox>
                );
              })}
            </Stack>
          </FormControl>
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button variant='brand' isLoading={saving} onClick={save} isDisabled={!validEmail || !validName}>保存</Button>
      </ModalFooter>
    </ModalContent>
  </ModalWithBackdrop>;
}
