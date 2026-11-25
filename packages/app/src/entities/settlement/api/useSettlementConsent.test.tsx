import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  INITIAL_SETTLEMENT_TERMS_KEY,
  SETTLEMENT_PROFILE_FORMAT_VERSION,
  SETTLEMENT_STRATEGY,
  settlementTermsFingerprint,
  type SettlementProfile,
} from '@budgero/core/browser';
import type { SettlementApprovalDto } from '@shared/model/budget-spaces';
import { useSettlementApprovalActions, useSettlementConsent } from './useSettlementConsent';

const SPACE_ID = 'space-1';
const ALEX = 'user-alex';
const SAM = 'user-sam';
const CHANGE_DATE = '2026-03-01';

const { serverApprovals, spaceApi } = vi.hoisted(() => {
  const approvals: { user_id: string; fingerprint: string }[] = [];
  return {
    serverApprovals: approvals,
    spaceApi: {
      listSettlementApprovals: vi.fn(async () => [...approvals]),
      approveSettlement: vi.fn(async (_spaceId: string, fingerprint: string) => {
        approvals.push({ user_id: 'user-alex', fingerprint });
      }),
      revokeSettlementApproval: vi.fn(async (_spaceId: string, fingerprint: string) => {
        const index = approvals.findIndex((approval) => approval.fingerprint === fingerprint);
        if (index >= 0) approvals.splice(index, 1);
      }),
    },
  };
});

vi.mock('@shared/api/api-client', () => ({ spaceApi }));
vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => SPACE_ID }));

const initialTerms = {
  strategy: SETTLEMENT_STRATEGY.equal,
  participants: [
    { id: ALEX, name: 'Alex', accountIds: [1], customShareBasisPoints: 0 },
    { id: SAM, name: 'Sam', accountIds: [2], customShareBasisPoints: 0 },
  ],
  incomeCategoryIds: [],
  expenseCategoryIds: [20],
};
const profile: SettlementProfile = {
  formatVersion: SETTLEMENT_PROFILE_FORMAT_VERSION,
  approvalKey: 'ab'.repeat(32),
  terms: [initialTerms, { ...initialTerms, effectiveFrom: CHANGE_DATE }],
};

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const approval = (userId: string, fingerprint: string) =>
  ({ space_id: SPACE_ID, user_id: userId, fingerprint, created_at: '' }) as SettlementApprovalDto;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  serverApprovals.length = 0;
  vi.clearAllMocks();
});

describe('useSettlementConsent', () => {
  it('takes terms into effect only once every participant approved them', async () => {
    const initialFingerprint = await settlementTermsFingerprint(
      profile.approvalKey!,
      1,
      profile.terms[0]
    );
    const changeFingerprint = await settlementTermsFingerprint(
      profile.approvalKey!,
      1,
      profile.terms[1]
    );
    serverApprovals.push(
      approval(ALEX, initialFingerprint),
      approval(SAM, initialFingerprint),
      approval(ALEX, changeFingerprint)
    );

    const { result } = renderHook(() => useSettlementConsent(1, profile), { wrapper });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.approvedTermsKeys).toEqual([INITIAL_SETTLEMENT_TERMS_KEY]);
    expect(result.current.byTerms.get(CHANGE_DATE)?.pendingFor).toEqual([SAM]);
  });

  it('ignores approvals of other terms and of a different budget', async () => {
    const otherBudget = await settlementTermsFingerprint(profile.approvalKey!, 2, profile.terms[0]);
    serverApprovals.push(approval(ALEX, otherBudget), approval(SAM, otherBudget));

    const { result } = renderHook(() => useSettlementConsent(1, profile), { wrapper });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.approvedTermsKeys).toEqual([]);
  });

  it('knows at once that a profile without an approval key has nothing approved', () => {
    const { result } = renderHook(
      () => useSettlementConsent(1, { ...profile, approvalKey: undefined }),
      { wrapper }
    );

    expect(result.current.ready).toBe(true);
    expect(result.current.approvedTermsKeys).toEqual([]);
  });
});

describe('useSettlementApprovalActions', () => {
  it('approves and withdraws through the server, then reloads the approvals', async () => {
    const fingerprint = 'c'.repeat(64);
    const { result } = renderHook(() => useSettlementApprovalActions(), { wrapper });

    await act(async () => {
      await result.current.approve.mutateAsync(fingerprint);
    });
    expect(spaceApi.approveSettlement).toHaveBeenCalledWith(SPACE_ID, fingerprint);

    await act(async () => {
      await result.current.revoke.mutateAsync(fingerprint);
    });
    expect(spaceApi.revokeSettlementApproval).toHaveBeenCalledWith(SPACE_ID, fingerprint);
    expect(serverApprovals).toEqual([]);
  });
});
