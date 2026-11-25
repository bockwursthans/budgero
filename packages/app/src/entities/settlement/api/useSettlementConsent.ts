import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  settlementTermsConsent,
  settlementTermsFingerprint,
  settlementTermsKey,
  type SettlementApprovalRecord,
  type SettlementProfile,
  type SettlementTerms,
  type SettlementTermsConsent,
} from '@budgero/core/browser';
import { spaceApi } from '@shared/api/api-client';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';

const SETTLEMENT_APPROVALS_QUERY_KEY = 'settlementApprovals';
const SETTLEMENT_FINGERPRINTS_QUERY_KEY = 'settlementFingerprints';
/**
 * Approvals change when another member approves from their own login, which the
 * open page can't hear about: check again every half minute and whenever the
 * window regains focus (both off by default in this app).
 */
const APPROVALS_REFRESH_MS = 30_000;

export interface SettlementConsentState {
  /** Consent per terms, by settlementTermsKey. */
  byTerms: ReadonlyMap<string, SettlementTermsConsent>;
  /** Keys of the terms every participant approved, in profile order. */
  approvedTermsKeys: string[];
  /** Fingerprints and approvals are known. */
  ready: boolean;
  isError: boolean;
}

/** The fingerprint of every set of terms in the profile, by terms key. */
async function fingerprintsOf(
  budgetId: number,
  profile: SettlementProfile,
  approvalKey: string
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    profile.terms.map(
      async (terms) =>
        [
          settlementTermsKey(terms),
          await settlementTermsFingerprint(approvalKey, budgetId, terms),
        ] as const
    )
  );
  return Object.fromEntries(entries);
}

/** Every approval recorded in a workspace, as the server reports them. */
export async function fetchSettlementApprovals(
  spaceId: string
): Promise<SettlementApprovalRecord[]> {
  const approvals = await spaceApi.listSettlementApprovals(spaceId);
  return approvals.map((approval) => ({
    userId: approval.user_id,
    fingerprint: approval.fingerprint,
  }));
}

/** Every approval recorded in the open workspace. */
export function useSettlementApprovals() {
  const spaceId = useActiveSpaceId();
  return useQuery<SettlementApprovalRecord[]>({
    queryKey: [SETTLEMENT_APPROVALS_QUERY_KEY, spaceId],
    enabled: Boolean(spaceId),
    staleTime: APPROVALS_REFRESH_MS,
    refetchInterval: APPROVALS_REFRESH_MS,
    refetchOnWindowFocus: 'always',
    queryFn: () => {
      if (!spaceId) throw new Error('Space id is required');
      return fetchSettlementApprovals(spaceId);
    },
  });
}

/** Who approved which terms of the profile, and which terms took effect. */
export function useSettlementConsent(
  budgetId: number,
  profile: SettlementProfile | null
): SettlementConsentState {
  const approvalKey = profile?.approvalKey;
  const fingerprints = useQuery<Record<string, string>>({
    queryKey: [SETTLEMENT_FINGERPRINTS_QUERY_KEY, budgetId, JSON.stringify(profile)],
    enabled: profile !== null && approvalKey !== undefined,
    staleTime: Infinity,
    queryFn: () => fingerprintsOf(budgetId, profile!, approvalKey!),
  });
  const approvals = useSettlementApprovals();

  return useMemo(() => {
    const byTerms = new Map<string, SettlementTermsConsent>();
    for (const terms of profile?.terms ?? []) {
      const key = settlementTermsKey(terms);
      const fingerprint = fingerprints.data?.[key];
      if (fingerprint && approvals.data) {
        byTerms.set(key, settlementTermsConsent(terms, fingerprint, approvals.data));
      }
    }
    return {
      byTerms,
      approvedTermsKeys: [...byTerms].filter(([, consent]) => consent.approved).map(([key]) => key),
      // A profile without an approval key has no approved terms: known at once.
      ready: approvalKey === undefined || (fingerprints.isSuccess && approvals.isSuccess),
      isError: fingerprints.isError || approvals.isError,
    };
  }, [
    profile,
    approvalKey,
    fingerprints.data,
    fingerprints.isSuccess,
    fingerprints.isError,
    approvals.data,
    approvals.isSuccess,
    approvals.isError,
  ]);
}

/** Records or withdraws the signed-in member's own approval of settlement terms. */
export function useSettlementApprovalActions() {
  const spaceId = useActiveSpaceId();
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [SETTLEMENT_APPROVALS_QUERY_KEY, spaceId] }),
    [queryClient, spaceId]
  );
  const approve = useMutation<void, Error, string>({
    mutationFn: async (fingerprint) => {
      if (!spaceId) throw new Error('Space id is required');
      await spaceApi.approveSettlement(spaceId, fingerprint);
    },
    onSuccess: refresh,
  });
  const revoke = useMutation<void, Error, string>({
    mutationFn: async (fingerprint) => {
      if (!spaceId) throw new Error('Space id is required');
      await spaceApi.revokeSettlementApproval(spaceId, fingerprint);
    },
    onSuccess: refresh,
  });
  return { approve, revoke };
}

/** The fingerprint of one set of terms of a saved profile. */
export function fingerprintOf(
  budgetId: number,
  profile: SettlementProfile,
  terms: SettlementTerms
): Promise<string> | null {
  return profile.approvalKey
    ? settlementTermsFingerprint(profile.approvalKey, budgetId, terms)
    : null;
}
