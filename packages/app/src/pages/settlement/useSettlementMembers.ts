import { useMemo } from 'react';
import { useProfile } from '@entities/user/api/useAuth';
import { useSpaceMembers } from '@features/budget-sharing/api/useBudgetSpaceSharing';
import { MEMBER_INVITATION_STATUS, type BudgetSpaceMember } from '@shared/model/budget-spaces';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';

/** A Budgero user who can take part in the settlement: a member of the open workspace. */
export interface SettlementMember {
  id: string;
  name: string;
}

export interface SettlementMembers {
  /** Members who accepted their invite, in the server's order (owner first). */
  members: SettlementMember[];
  memberIds: ReadonlySet<string>;
  currentUserId: string | null;
  isLoading: boolean;
  /** The member list could not be loaded (it comes from the server, so not offline). */
  isError: boolean;
}

const displayName = (member: BudgetSpaceMember): string =>
  member.user_name.trim() || member.user_email.trim() || member.user_id;

/** The open workspace's members, the only people a settlement can split between. */
export function useSettlementMembers(): SettlementMembers {
  const spaceId = useActiveSpaceId();
  const membersQuery = useSpaceMembers(spaceId);
  const profile = useProfile();

  const members = useMemo(
    () =>
      (membersQuery.data ?? [])
        .filter((member) => member.invitation_status === MEMBER_INVITATION_STATUS.accepted)
        .map((member) => ({ id: member.user_id, name: displayName(member) })),
    [membersQuery.data]
  );
  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);

  return {
    members,
    memberIds,
    currentUserId: profile.data?.id ?? null,
    isLoading: membersQuery.isLoading,
    isError: membersQuery.isError,
  };
}
