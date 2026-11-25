import { describe, expect, it, vi } from 'vitest';
import {
  asMilli,
  SETTLEMENT_EARLIEST_DATE,
  SETTLEMENT_PROFILE_FORMAT_VERSION,
  SETTLEMENT_PROFILE_STATUS,
  SETTLEMENT_STRATEGY,
  settlementTermsFingerprint,
  type SettlementProfile,
  type SettlementProfileStatus,
  type SettlementResult,
  type SettlementTerms,
} from '@budgero/core/browser';
import {
  executeQuerySettlement,
  querySettlementSchema,
  SETTLEMENT_TOOL_MESSAGE,
  SETTLEMENT_TOOL_PERIOD,
} from './query-settlement';
import type { ToolContext } from './types';

const ALEX = 'user-alex';
const SAM = 'user-sam';
const RENT = 20;
const APPROVAL_KEY = 'ab'.repeat(32);

const terms: SettlementTerms = {
  strategy: SETTLEMENT_STRATEGY.equal,
  participants: [
    { id: ALEX, name: 'Alex', accountIds: [1], customShareBasisPoints: 0 },
    { id: SAM, name: 'Sam', accountIds: [2], customShareBasisPoints: 0 },
  ],
  incomeCategoryIds: [],
  expenseCategoryIds: [RENT],
};
const profile: SettlementProfile = {
  formatVersion: SETTLEMENT_PROFILE_FORMAT_VERSION,
  approvalKey: APPROVAL_KEY,
  terms: [terms],
};

const participant = (id: string, name: string, paid: number, net: number) => ({
  participantId: id,
  name,
  eligibleIncome: asMilli(0),
  sharedExpensesPaid: asMilli(paid),
  targetContribution: asMilli(500_000),
  paymentsSent: asMilli(0),
  paymentsReceived: asMilli(0),
  paidForOthers: asMilli(0),
  paidByOthers: asMilli(0),
  netSettlement: asMilli(net),
  contributionShare: 0.5,
  incomeByCategory: [],
  sharedExpensesByCategory: paid ? [{ categoryId: RENT, amount: asMilli(paid) }] : [],
  paidForOthersByCategory: [],
  paidByOthersByCategory: [],
});

const result: SettlementResult = {
  startDate: SETTLEMENT_EARLIEST_DATE,
  endDate: '2026-11-25',
  totalSharedExpenses: asMilli(1_000_000),
  totalEligibleIncome: asMilli(0),
  participants: [
    participant(ALEX, 'Alex', 1_000_000, 500_000),
    participant(SAM, 'Sam', 0, -500_000),
  ],
  transfers: [{ fromParticipantId: SAM, toParticipantId: ALEX, amount: asMilli(500_000) }],
  segments: [],
  unapprovedSegments: [],
  warnings: [],
};

function context(
  overrides: Partial<ToolContext> = {},
  stored: SettlementProfile | null = profile,
  status: SettlementProfileStatus = SETTLEMENT_PROFILE_STATUS.ready
) {
  const calculate = vi.fn(() => result);
  const ctx = {
    budgetId: 1,
    services: {
      settlement: {
        readProfile: () => ({ status, profile: stored }),
        calculate,
      },
    },
    categories: [{ ID: RENT, Name: 'Rent' }],
    accounts: [],
    aiConfig: {},
    currencySymbol: 'EUR',
    formatCurrency: (amount: number) => `€${amount.toFixed(2)}`,
    ...overrides,
  } as unknown as ToolContext;
  return { ctx, calculate };
}

const approvedBy = async (...userIds: string[]) => {
  const fingerprint = await settlementTermsFingerprint(APPROVAL_KEY, 1, terms);
  return userIds.map((userId) => ({ userId, fingerprint }));
};

describe('query_settlement tool', () => {
  it('reports the open balance with who pays whom', async () => {
    const approvals = await approvedBy(ALEX, SAM);
    const { ctx, calculate } = context({ listSettlementApprovals: async () => approvals });

    const answer = await executeQuerySettlement(
      { period: SETTLEMENT_TOOL_PERIOD.openBalance },
      ctx
    );

    expect(answer.success).toBe(true);
    expect(answer.message).toContain('Sam pays Alex €500.00');
    expect(answer.data).toMatchObject({
      currency: 'EUR',
      participants: [
        { name: 'Alex', balance: 500 },
        { name: 'Sam', balance: -500 },
      ],
    });
    const [, , start, , isApproved] = calculate.mock.calls[0] as unknown as [
      number,
      SettlementProfile,
      string,
      string,
      (entry: SettlementTerms) => boolean,
    ];
    expect(start).toBe(SETTLEMENT_EARLIEST_DATE);
    expect(isApproved(terms)).toBe(true);
  });

  it('settles nothing on terms not everyone agreed to', async () => {
    const approvals = await approvedBy(ALEX);
    const { ctx, calculate } = context({ listSettlementApprovals: async () => approvals });

    await executeQuerySettlement({ period: SETTLEMENT_TOOL_PERIOD.openBalance }, ctx);

    const isApproved = (calculate.mock.calls[0] as unknown[])[4] as (e: SettlementTerms) => boolean;
    expect(isApproved(terms)).toBe(false);
  });

  it('treats unknown consent as no consent', async () => {
    const { ctx, calculate } = context();

    await executeQuerySettlement({ period: SETTLEMENT_TOOL_PERIOD.openBalance }, ctx);

    const isApproved = (calculate.mock.calls[0] as unknown[])[4] as (e: SettlementTerms) => boolean;
    expect(isApproved(terms)).toBe(false);
  });

  it('settles one month', async () => {
    const { ctx, calculate } = context();

    await executeQuerySettlement({ period: SETTLEMENT_TOOL_PERIOD.month, month: '2028-02' }, ctx);

    expect((calculate.mock.calls[0] as unknown[]).slice(2, 4)).toEqual([
      '2028-02-01',
      '2028-02-29',
    ]);
  });

  it('asks for a complete period', async () => {
    const { ctx, calculate } = context();

    const answer = await executeQuerySettlement(
      { period: SETTLEMENT_TOOL_PERIOD.range, startDate: '2026-03-01' },
      ctx
    );

    expect(answer.success).toBe(false);
    expect(calculate).not.toHaveBeenCalled();
  });

  it('says when no settlement is set up', async () => {
    const { ctx } = context({}, null);

    const answer = await executeQuerySettlement(
      { period: SETTLEMENT_TOOL_PERIOD.openBalance },
      ctx
    );

    expect(answer.message).toBe(SETTLEMENT_TOOL_MESSAGE.unset);
  });

  it.each([
    [SETTLEMENT_PROFILE_STATUS.newerFormat, null, SETTLEMENT_TOOL_MESSAGE.newerFormat],
    [SETTLEMENT_PROFILE_STATUS.unreadable, profile, SETTLEMENT_TOOL_MESSAGE.unreadable],
  ] as const)('settles nothing when the terms are %s', async (status, stored, message) => {
    const { ctx, calculate } = context({}, stored, status);

    const answer = await executeQuerySettlement(
      { period: SETTLEMENT_TOOL_PERIOD.openBalance },
      ctx
    );

    expect(answer).toEqual({ success: false, message });
    expect(calculate).not.toHaveBeenCalled();
  });

  it('accepts only real months', () => {
    expect(querySettlementSchema.safeParse({ period: 'month', month: '2026-12' }).success).toBe(
      true
    );
    for (const month of ['2026-13', '2026-00']) {
      expect(querySettlementSchema.safeParse({ period: 'month', month }).success).toBe(false);
    }
  });
});
