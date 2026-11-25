import { useCallback, useMemo } from 'react';
import {
  readSettlementProfile,
  SETTLEMENT_PROFILE_KEY,
  SETTLEMENT_PROFILE_STATUS,
  type SettlementProfile,
  type SettlementProfileStatus,
  type SettlementResult,
} from '@budgero/core/browser';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { budgetScope, useSyncedState } from '@shared/lib/synced-state';

/**
 * Keyed under 'allTransactionsAnalytics', which every transaction, split and
 * account write invalidates, so the settlement refetches when its inputs move.
 */
const SETTLEMENT_QUERY_ROOT = 'allTransactionsAnalytics';
const SETTLEMENT_QUERY_PART = 'householdSettlement';

/** Statuses this build may write over: nothing stored yet, or read completely. */
const WRITABLE_STATUSES: readonly SettlementProfileStatus[] = [
  SETTLEMENT_PROFILE_STATUS.unset,
  SETTLEMENT_PROFILE_STATUS.ready,
];

export interface SettlementProfileState {
  profile: SettlementProfile | null;
  status: SettlementProfileStatus;
  loaded: boolean;
  /** False in the demo, before the store is read, and for profiles this build can't fully read. */
  canWrite: boolean;
  /**
   * Replaces the whole profile (newest write wins, like other synced budget
   * settings): resolves false when the write was refused.
   */
  save: (profile: SettlementProfile) => Promise<boolean>;
}

/** The budget's settlement profile, shared by the workspace's members. */
export function useSettlementProfile(budgetId: number): SettlementProfileState {
  const scope = budgetId > 0 ? budgetScope(budgetId) : null;
  const synced = useSyncedState<unknown>(scope, SETTLEMENT_PROFILE_KEY);
  const { status, profile } = useMemo(() => readSettlementProfile(synced.value), [synced.value]);
  const { set } = synced;
  const save = useCallback((next: SettlementProfile) => set(next), [set]);
  return {
    profile,
    status,
    loaded: synced.loaded,
    canWrite: synced.canWrite && WRITABLE_STATUSES.includes(status),
    save,
  };
}

/** The settlement of an inclusive date range; idle without a profile or range. */
export function useSettlement(
  budgetId: number,
  profile: SettlementProfile | null,
  startDate: string,
  endDate: string
) {
  return useSpaceQuery<SettlementResult | null>({
    key: [
      SETTLEMENT_QUERY_ROOT,
      SETTLEMENT_QUERY_PART,
      budgetId,
      startDate,
      endDate,
      JSON.stringify(profile),
    ],
    enabled: budgetId > 0 && profile !== null && startDate !== '' && startDate <= endDate,
    queryFn: (services) =>
      profile ? services.settlement.calculate(budgetId, profile, startDate, endDate) : null,
  });
}
