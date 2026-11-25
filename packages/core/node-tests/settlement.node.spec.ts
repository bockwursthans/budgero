import { beforeEach, describe, expect, it } from 'vitest';
import {
  apportion,
  approvedSettlementTermsKeys,
  calculateSettlement,
  cleanSettlementName,
  createSettlementApprovalKey,
  dayBefore,
  INITIAL_SETTLEMENT_TERMS_KEY,
  isSettlementApprovalKey,
  NodeSqlJsAdapter,
  readSettlementProfile,
  removeSettlementTerms,
  ServiceManager,
  SETTLEMENT_EARLIEST_DATE,
  SETTLEMENT_MAX_TERMS,
  SETTLEMENT_PROFILE_FORMAT_VERSION,
  SETTLEMENT_PROFILE_KEY,
  SETTLEMENT_PROFILE_STATUS,
  SETTLEMENT_STRATEGY,
  SETTLEMENT_TERMS_ISSUE,
  SETTLEMENT_WARNING,
  settlementProfileScope,
  settlementReport,
  settlementSegments,
  settlementTermsConsent,
  settlementTermsFingerprint,
  settlementTermsKey,
  settlementTermsOn,
  settlementTransfers,
  upsertSettlementTerms,
  validateSettlementTerms,
  type SettlementLineTotal,
  type SettlementPaymentTotal,
  type SettlementProfile,
  type SettlementTerms,
  type Services,
} from '../src';
import { asMilli } from '../src/money';

const ALEX = 'alex';
const SAM = 'sam';
const FLATMATE = 'flatmate';
const ALEX_ACCOUNT = 1;
const SAM_ACCOUNT = 2;
const JOINT_ACCOUNT = 3;
const SALARY = 10;
const GROCERIES = 20;
const RENT = 21;
const HOBBY = 22;

const terms = (overrides: Partial<SettlementTerms> = {}): SettlementTerms => ({
  strategy: SETTLEMENT_STRATEGY.incomeWeighted,
  participants: [
    { id: ALEX, name: 'Alex', accountIds: [ALEX_ACCOUNT], customShareBasisPoints: 7_000 },
    { id: SAM, name: 'Sam', accountIds: [SAM_ACCOUNT], customShareBasisPoints: 3_000 },
  ],
  incomeCategoryIds: [SALARY],
  expenseCategoryIds: [GROCERIES, RENT],
  ...overrides,
});

const flatmate = {
  id: FLATMATE,
  name: 'Flatmate',
  accountIds: [JOINT_ACCOUNT],
  customShareBasisPoints: 0,
};

const profileOf = (...entries: SettlementTerms[]): SettlementProfile => ({
  formatVersion: SETTLEMENT_PROFILE_FORMAT_VERSION,
  terms: entries,
});

const ALL_APPROVED = () => true;
const APPROVAL_KEY = 'ab'.repeat(32);

const line = (
  accountId: number,
  categoryId: number,
  inflow: number,
  outflow: number
): SettlementLineTotal => ({
  accountId,
  categoryId,
  inflow: asMilli(inflow),
  outflow: asMilli(outflow),
});

const settleOne = (
  settlementTerms: SettlementTerms,
  lines: SettlementLineTotal[],
  payments: SettlementPaymentTotal[] = [],
  range: [string, string] = ['2026-01-01', '2026-01-31']
) =>
  calculateSettlement(
    [
      {
        segment: { terms: settlementTerms, startDate: range[0], endDate: range[1] },
        lines,
        payments,
      },
    ],
    ...range
  );

const payment = (fromAccountId: number, toAccountId: number, amount: number) => ({
  fromAccountId,
  toAccountId,
  amount: asMilli(amount),
});

const byId = (result: ReturnType<typeof settleOne>, id: string) =>
  result.participants.find((participant) => participant.participantId === id)!;

const nets = (result: ReturnType<typeof settleOne>) =>
  Object.fromEntries(result.participants.map((p) => [p.participantId, p.netSettlement]));

describe('apportion', () => {
  it('adds up to the total exactly, leftovers to the largest remainders', () => {
    expect(apportion(100, [1n, 1n, 1n])).toEqual([34, 33, 33]);
    expect(apportion(10, [2n, 1n])).toEqual([7, 3]);
  });

  it('keeps the sign of a negative total', () => {
    expect(apportion(-100, [1n, 1n, 1n])).toEqual([-34, -33, -33]);
  });

  it('gives nothing when every weight is zero', () => {
    expect(apportion(500, [0n, 0n])).toEqual([0, 0]);
  });

  it('stays exact for amounts whose products exceed double precision', () => {
    const total = 9_000_000_000_000;
    const parts = apportion(total, [3_000_000_000_001n, 7_000_000_000_000n]);
    expect(parts[0] + parts[1]).toBe(total);
  });
});

describe('calculateSettlement', () => {
  it('splits shared expenses by income (the issue example)', () => {
    const result = settleOne(terms(), [
      line(ALEX_ACCOUNT, SALARY, 3_000_000, 0),
      line(SAM_ACCOUNT, SALARY, 2_000_000, 0),
      line(ALEX_ACCOUNT, RENT, 0, 1_000_000),
      line(SAM_ACCOUNT, GROCERIES, 0, 500_000),
    ]);

    expect(result.totalSharedExpenses).toBe(1_500_000);
    expect(result.totalEligibleIncome).toBe(5_000_000);
    expect(byId(result, ALEX)).toMatchObject({
      eligibleIncome: 3_000_000,
      sharedExpensesPaid: 1_000_000,
      targetContribution: 900_000,
      netSettlement: 100_000,
      contributionShare: 0.6,
    });
    expect(byId(result, SAM)).toMatchObject({
      targetContribution: 600_000,
      netSettlement: -100_000,
    });
    expect(result.transfers).toEqual([
      { fromParticipantId: SAM, toParticipantId: ALEX, amount: 100_000 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('shows per category what was earned and paid, summed over the range', () => {
    const later = terms({ effectiveFrom: '2026-02-01' });
    const result = calculateSettlement(
      [
        {
          segment: { terms: terms(), startDate: '2026-01-01', endDate: '2026-01-31' },
          payments: [],
          lines: [
            line(ALEX_ACCOUNT, SALARY, 1_000_000, 0),
            line(ALEX_ACCOUNT, RENT, 0, 800_000),
            line(ALEX_ACCOUNT, GROCERIES, 50_000, 250_000),
          ],
        },
        {
          segment: { terms: later, startDate: '2026-02-01', endDate: '2026-02-28' },
          payments: [],
          lines: [line(ALEX_ACCOUNT, RENT, 0, 800_000), line(ALEX_ACCOUNT, GROCERIES, 200_000, 0)],
        },
      ],
      '2026-01-01',
      '2026-02-28'
    );

    expect(byId(result, ALEX).sharedExpensesByCategory).toEqual([
      { categoryId: RENT, amount: 1_600_000 },
    ]);
    expect(byId(result, ALEX).incomeByCategory).toEqual([
      { categoryId: SALARY, amount: 1_000_000 },
    ]);
    expect(byId(result, SAM).sharedExpensesByCategory).toEqual([]);
  });

  it('counts transfers between participants as settlement payments, so paying evens out', () => {
    const lines = [
      line(ALEX_ACCOUNT, SALARY, 1_000_000, 0),
      line(SAM_ACCOUNT, SALARY, 1_000_000, 0),
      line(ALEX_ACCOUNT, RENT, 0, 1_000_000),
    ];

    const owing = settleOne(terms(), lines);
    expect(nets(owing)).toEqual({ [ALEX]: 500_000, [SAM]: -500_000 });

    const paid = settleOne(terms(), lines, [payment(SAM_ACCOUNT, ALEX_ACCOUNT, 500_000)]);
    expect(nets(paid)).toEqual({ [ALEX]: 0, [SAM]: 0 });
    expect(byId(paid, SAM).paymentsSent).toBe(500_000);
    expect(byId(paid, ALEX).paymentsReceived).toBe(500_000);
    expect(paid.transfers).toEqual([]);
  });

  it('ignores transfers within one participant and to accounts outside the settlement', () => {
    const twoAccounts = terms({
      participants: [
        { ...terms().participants[0], accountIds: [ALEX_ACCOUNT, JOINT_ACCOUNT] },
        terms().participants[1],
      ],
    });
    const result = settleOne(
      twoAccounts,
      [line(ALEX_ACCOUNT, RENT, 0, 1_000_000)],
      [payment(ALEX_ACCOUNT, JOINT_ACCOUNT, 300_000), payment(SAM_ACCOUNT, 99, 200_000)]
    );

    expect(byId(result, ALEX).paymentsSent).toBe(0);
    expect(byId(result, SAM).paymentsSent).toBe(0);
  });

  it('ignores categories and accounts outside the terms', () => {
    const result = settleOne(terms(), [
      line(ALEX_ACCOUNT, SALARY, 1_000_000, 0),
      line(SAM_ACCOUNT, SALARY, 1_000_000, 0),
      line(ALEX_ACCOUNT, HOBBY, 0, 400_000),
      line(JOINT_ACCOUNT, RENT, 0, 800_000),
      line(SAM_ACCOUNT, RENT, 0, 200_000),
    ]);

    expect(result.totalSharedExpenses).toBe(200_000);
    expect(byId(result, ALEX).netSettlement).toBe(-100_000);
  });

  it('nets refunds against expenses and paid-back income against income', () => {
    const result = settleOne(terms(), [
      line(ALEX_ACCOUNT, SALARY, 1_000_000, 200_000),
      line(SAM_ACCOUNT, SALARY, 800_000, 0),
      line(ALEX_ACCOUNT, GROCERIES, 50_000, 350_000),
    ]);

    expect(byId(result, ALEX).eligibleIncome).toBe(800_000);
    expect(byId(result, ALEX).sharedExpensesPaid).toBe(300_000);
    expect(byId(result, ALEX).targetContribution).toBe(150_000);
  });

  it('shares a refund month: whoever got the money back passes on the others part', () => {
    const result = settleOne(terms(), [
      line(ALEX_ACCOUNT, SALARY, 1_000_000, 0),
      line(SAM_ACCOUNT, SALARY, 1_000_000, 0),
      line(ALEX_ACCOUNT, GROCERIES, 100_000, 0),
    ]);

    expect(result.totalSharedExpenses).toBe(-100_000);
    expect(nets(result)).toEqual({ [ALEX]: -50_000, [SAM]: 50_000 });
    expect(result.transfers).toEqual([
      { fromParticipantId: ALEX, toParticipantId: SAM, amount: 50_000 },
    ]);
  });

  it('gives negative income no share', () => {
    const result = settleOne(terms(), [
      line(ALEX_ACCOUNT, SALARY, 0, 200_000),
      line(SAM_ACCOUNT, SALARY, 1_000_000, 0),
      line(ALEX_ACCOUNT, RENT, 0, 1_000_000),
    ]);

    expect(byId(result, ALEX).targetContribution).toBe(0);
    expect(nets(result)).toEqual({ [ALEX]: 1_000_000, [SAM]: -1_000_000 });
  });

  it('splits equally and by custom shares', () => {
    const lines = [line(ALEX_ACCOUNT, RENT, 0, 1_000_000)];

    const equal = settleOne(terms({ strategy: SETTLEMENT_STRATEGY.equal }), lines);
    expect(byId(equal, SAM).netSettlement).toBe(-500_000);

    const custom = settleOne(terms({ strategy: SETTLEMENT_STRATEGY.custom }), lines);
    expect(byId(custom, ALEX).targetContribution).toBe(700_000);
    expect(byId(custom, SAM).netSettlement).toBe(-300_000);
  });

  it('splits equally and warns when income-weighted terms find no income', () => {
    const result = settleOne(terms(), [line(ALEX_ACCOUNT, RENT, 0, 1_000_000)]);

    expect(byId(result, SAM).targetContribution).toBe(500_000);
    expect(result.warnings).toEqual([SETTLEMENT_WARNING.noIncomeSplitEqually]);
  });

  it('splits equally and warns when every fixed share is zero', () => {
    const zeroShares = terms({
      strategy: SETTLEMENT_STRATEGY.custom,
      participants: terms().participants.map((p) => ({ ...p, customShareBasisPoints: 0 })),
    });
    const result = settleOne(zeroShares, [line(ALEX_ACCOUNT, RENT, 0, 1_000_000)]);

    expect(byId(result, SAM).targetContribution).toBe(500_000);
    expect(result.warnings).toEqual([SETTLEMENT_WARNING.noSharesSplitEqually]);
  });

  it('warns about nothing when there is nothing to share', () => {
    expect(settleOne(terms(), []).warnings).toEqual([]);
  });

  it('counts an account assigned twice for its first participant only', () => {
    const shared = terms({
      strategy: SETTLEMENT_STRATEGY.equal,
      participants: [
        terms().participants[0],
        { ...terms().participants[1], accountIds: [SAM_ACCOUNT, ALEX_ACCOUNT] },
      ],
    });
    const result = settleOne(shared, [line(ALEX_ACCOUNT, RENT, 0, 1_000_000)]);

    expect(byId(result, ALEX).sharedExpensesPaid).toBe(1_000_000);
    expect(byId(result, SAM).sharedExpensesPaid).toBe(0);
  });

  it('adds up the parts of a range spanning a change of terms', () => {
    const later = terms({ effectiveFrom: '2026-02-01', strategy: SETTLEMENT_STRATEGY.equal });
    const result = calculateSettlement(
      [
        {
          segment: { terms: terms(), startDate: '2026-01-01', endDate: '2026-01-31' },
          payments: [],
          lines: [
            line(ALEX_ACCOUNT, SALARY, 3_000_000, 0),
            line(SAM_ACCOUNT, SALARY, 1_000_000, 0),
            line(ALEX_ACCOUNT, RENT, 0, 1_000_000),
          ],
        },
        {
          segment: { terms: later, startDate: '2026-02-01', endDate: '2026-02-28' },
          payments: [],
          lines: [line(SAM_ACCOUNT, RENT, 0, 1_000_000)],
        },
      ],
      '2026-01-01',
      '2026-02-28'
    );

    // January: Alex carries 75 % of 1000; February: each carries 500.
    expect(byId(result, ALEX).targetContribution).toBe(1_250_000);
    expect(byId(result, ALEX).contributionShare).toBe(0.625);
    expect(nets(result)).toEqual({ [ALEX]: -250_000, [SAM]: 250_000 });
    expect(result.segments.map((segment) => segment.strategy)).toEqual([
      SETTLEMENT_STRATEGY.incomeWeighted,
      SETTLEMENT_STRATEGY.equal,
    ]);
  });

  it('settles a participant who joins later only for the part they took part in', () => {
    const withFlatmate = terms({
      effectiveFrom: '2026-02-01',
      strategy: SETTLEMENT_STRATEGY.equal,
      participants: [...terms().participants, flatmate],
    });
    const result = calculateSettlement(
      [
        {
          segment: {
            terms: terms({ strategy: SETTLEMENT_STRATEGY.equal }),
            startDate: '2026-01-01',
            endDate: '2026-01-31',
          },
          payments: [],
          lines: [line(ALEX_ACCOUNT, RENT, 0, 1_000_000)],
        },
        {
          segment: { terms: withFlatmate, startDate: '2026-02-01', endDate: '2026-02-28' },
          payments: [],
          lines: [line(ALEX_ACCOUNT, RENT, 0, 900_000)],
        },
      ],
      '2026-01-01',
      '2026-02-28'
    );

    expect(byId(result, FLATMATE).targetContribution).toBe(300_000);
    expect(byId(result, SAM).targetContribution).toBe(800_000);
    expect(byId(result, ALEX).netSettlement).toBe(1_100_000);
  });

  it('settles three participants with at most two transfers', () => {
    const three = terms({
      strategy: SETTLEMENT_STRATEGY.equal,
      participants: [...terms().participants, flatmate],
    });
    const result = settleOne(three, [line(ALEX_ACCOUNT, RENT, 0, 900_000)]);

    expect(result.transfers).toEqual([
      { fromParticipantId: FLATMATE, toParticipantId: ALEX, amount: 300_000 },
      { fromParticipantId: SAM, toParticipantId: ALEX, amount: 300_000 },
    ]);
  });
});

describe('settlementTransfers', () => {
  const net = (participantId: string, netSettlement: number) => ({
    participantId,
    netSettlement: asMilli(netSettlement),
  });

  it('pays the largest creditor from the largest debtor first', () => {
    expect(
      settlementTransfers([
        net('a', 300_000),
        net('b', 100_000),
        net('c', -250_000),
        net('d', -150_000),
      ])
    ).toEqual([
      { fromParticipantId: 'c', toParticipantId: 'a', amount: 250_000 },
      { fromParticipantId: 'd', toParticipantId: 'a', amount: 50_000 },
      { fromParticipantId: 'd', toParticipantId: 'b', amount: 100_000 },
    ]);
  });

  it('pays whole cents and leaves out what rounds to nothing', () => {
    expect(settlementTransfers([net('a', 4), net('b', -4)])).toEqual([]);
    expect(settlementTransfers([net('a', 12_345), net('b', -12_345)])).toEqual([
      { fromParticipantId: 'b', toParticipantId: 'a', amount: 12_350 },
    ]);
  });
});

describe('settlement consent', () => {
  it('fingerprints the same terms the same way, whatever the order of ids', async () => {
    const reordered = terms({
      participants: [...terms().participants].reverse().map((participant) => ({
        ...participant,
        accountIds: [...participant.accountIds].reverse(),
      })),
      expenseCategoryIds: [RENT, GROCERIES],
    });

    const fingerprint = await settlementTermsFingerprint(APPROVAL_KEY, 1, terms());

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await settlementTermsFingerprint(APPROVAL_KEY, 1, reordered)).toBe(fingerprint);
  });

  it('needs a new approval for any change that matters, not for a rename', async () => {
    const base = await settlementTermsFingerprint(APPROVAL_KEY, 1, terms());
    const changed = [
      terms({ strategy: SETTLEMENT_STRATEGY.equal }),
      terms({ expenseCategoryIds: [GROCERIES] }),
      terms({ effectiveFrom: '2026-03-01' }),
      terms({
        participants: [
          { ...terms().participants[0], accountIds: [ALEX_ACCOUNT, JOINT_ACCOUNT] },
          terms().participants[1],
        ],
      }),
    ];
    for (const entry of changed) {
      expect(await settlementTermsFingerprint(APPROVAL_KEY, 1, entry)).not.toBe(base);
    }
    expect(await settlementTermsFingerprint(APPROVAL_KEY, 2, terms())).not.toBe(base);
    expect(await settlementTermsFingerprint('cd'.repeat(32), 1, terms())).not.toBe(base);

    const renamed = terms({
      participants: terms().participants.map((participant) => ({ ...participant, name: 'X' })),
    });
    expect(await settlementTermsFingerprint(APPROVAL_KEY, 1, renamed)).toBe(base);
  });

  it('refuses a malformed approval key', async () => {
    await expect(settlementTermsFingerprint('short', 1, terms())).rejects.toThrow();
  });

  it('counts only participants who approved this exact fingerprint', () => {
    const fingerprint = 'f'.repeat(64);
    const approvals = [
      { userId: ALEX, fingerprint },
      { userId: SAM, fingerprint: 'e'.repeat(64) },
      { userId: 'stranger', fingerprint },
    ];

    expect(settlementTermsConsent(terms(), fingerprint, approvals)).toEqual({
      fingerprint,
      approvedBy: [ALEX],
      pendingFor: [SAM],
      approved: false,
    });
    expect(
      settlementTermsConsent(terms(), fingerprint, [...approvals, { userId: SAM, fingerprint }])
        .approved
    ).toBe(true);
    expect(
      settlementTermsConsent(terms({ participants: [] }), fingerprint, approvals).approved
    ).toBe(false);
  });

  it('lists the terms every participant approved', async () => {
    const profile = {
      ...profileOf(terms(), terms({ effectiveFrom: '2026-03-01' })),
      approvalKey: APPROVAL_KEY,
    };
    const initial = await settlementTermsFingerprint(APPROVAL_KEY, 1, profile.terms[0]);
    const change = await settlementTermsFingerprint(APPROVAL_KEY, 1, profile.terms[1]);
    const approvals = [
      { userId: ALEX, fingerprint: initial },
      { userId: SAM, fingerprint: initial },
      { userId: ALEX, fingerprint: change },
    ];

    expect(await approvedSettlementTermsKeys(1, profile, approvals)).toEqual([
      INITIAL_SETTLEMENT_TERMS_KEY,
    ]);
    expect(await approvedSettlementTermsKeys(1, profileOf(terms()), approvals)).toEqual([]);
  });

  it('keys terms by their start', () => {
    expect(settlementTermsKey(terms())).toBe(INITIAL_SETTLEMENT_TERMS_KEY);
    expect(settlementTermsKey(terms({ effectiveFrom: '2026-03-01' }))).toBe('2026-03-01');
  });

  it('gives a new profile an approval key and keeps it', () => {
    const created = upsertSettlementTerms(null, terms());
    expect(isSettlementApprovalKey(created.approvalKey)).toBe(true);
    expect(isSettlementApprovalKey(createSettlementApprovalKey())).toBe(true);

    const changed = upsertSettlementTerms(created, terms({ effectiveFrom: '2026-03-01' }));
    expect(changed.approvalKey).toBe(created.approvalKey);
    expect(removeSettlementTerms(changed, '2026-03-01').approvalKey).toBe(created.approvalKey);
  });

  it('marks a profile with a broken approval key unreadable', () => {
    const reading = readSettlementProfile({ ...profileOf(terms()), approvalKey: 'nope' });
    expect(reading.status).toBe(SETTLEMENT_PROFILE_STATUS.unreadable);
    expect(reading.profile?.approvalKey).toBeUndefined();
  });
});

describe('settlement profile', () => {
  it('reads a profile written by this build as ready', () => {
    const stored = upsertSettlementTerms(
      upsertSettlementTerms(null, terms()),
      terms({ effectiveFrom: '2026-06-01' })
    );

    expect(readSettlementProfile(JSON.parse(JSON.stringify(stored)))).toEqual({
      status: SETTLEMENT_PROFILE_STATUS.ready,
      profile: stored,
    });
  });

  it('tells unset, newer and unreadable values apart', () => {
    expect(readSettlementProfile(undefined).status).toBe(SETTLEMENT_PROFILE_STATUS.unset);
    expect(
      readSettlementProfile({ formatVersion: SETTLEMENT_PROFILE_FORMAT_VERSION + 1, terms: [] })
        .status
    ).toBe(SETTLEMENT_PROFILE_STATUS.newerFormat);
    for (const garbage of ['x', [], { formatVersion: 1 }, { formatVersion: 1, terms: [] }]) {
      expect(readSettlementProfile(garbage).status).toBe(SETTLEMENT_PROFILE_STATUS.unreadable);
    }
  });

  it('shows what it can of a damaged profile but marks it unreadable', () => {
    const reading = readSettlementProfile({
      formatVersion: SETTLEMENT_PROFILE_FORMAT_VERSION,
      terms: [
        terms({ effectiveFrom: '2026-06-01' }),
        { ...terms(), participants: [{ id: ALEX, name: 'Alex', accountIds: [1, 1, -4, 'x'] }] },
        { ...terms(), strategy: 'unknown' },
        { ...terms(), effectiveFrom: '2026-02-30' },
        { ...terms(), effectiveFrom: '2026-07-15' },
      ],
    });

    expect(reading.status).toBe(SETTLEMENT_PROFILE_STATUS.unreadable);
    expect(reading.profile?.terms.map((entry) => entry.effectiveFrom)).toEqual([
      undefined,
      '2026-06-01',
    ]);
    expect(reading.profile?.terms[0].participants).toEqual([
      { id: ALEX, name: 'Alex', accountIds: [1], customShareBasisPoints: 0 },
    ]);
  });

  it.each([
    [
      'a repeated participant id',
      { participants: [terms().participants[0], terms().participants[0]] },
    ],
    [
      'a hidden character in a name',
      { participants: [{ ...terms().participants[0], name: 'Ka\u202Ey' }] },
    ],
    [
      'a share above 100 %',
      { participants: [{ ...terms().participants[0], customShareBasisPoints: 10_001 }] },
    ],
    ['a category list that is not a list', { expenseCategoryIds: 'all' }],
  ])('marks %s as unreadable', (_label, damage) => {
    const reading = readSettlementProfile(profileOf({ ...terms(), ...damage } as SettlementTerms));
    expect(reading.status).toBe(SETTLEMENT_PROFILE_STATUS.unreadable);
  });

  it('caps the number of terms it reads', () => {
    const many = Array.from({ length: SETTLEMENT_MAX_TERMS + 10 }, (_, index) =>
      terms({
        effectiveFrom: `${2000 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`,
      })
    );
    const reading = readSettlementProfile(profileOf(...many));

    expect(reading.status).toBe(SETTLEMENT_PROFILE_STATUS.unreadable);
    expect(reading.profile?.terms).toHaveLength(SETTLEMENT_MAX_TERMS);
  });

  it('never assigns stored keys onto prototypes', () => {
    const raw = JSON.parse(
      `{"formatVersion":1,"terms":[{"strategy":"equal","__proto__":{"polluted":true},
        "participants":[{"id":"a","name":"A","accountIds":[1],"customShareBasisPoints":0,
        "__proto__":{"polluted":true}}],"incomeCategoryIds":[],"expenseCategoryIds":[20]}]}`
    ) as unknown;

    const reading = readSettlementProfile(raw);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(reading.profile!.terms[0])).toBe(Object.prototype);
  });

  it('cleans names without splitting characters', () => {
    expect(cleanSettlementName('Sa\u200Bm\u0000')).toBe('Sam');
    expect(cleanSettlementName('😀'.repeat(100))).toBe('😀'.repeat(80));
  });

  it('makes the earliest dated terms the initial ones when none are undated', () => {
    const reading = readSettlementProfile(
      profileOf(terms({ effectiveFrom: '2026-03-01' }), terms({ effectiveFrom: '2026-01-01' }))
    );

    expect(reading.profile?.terms.map((entry) => entry.effectiveFrom)).toEqual([
      undefined,
      '2026-03-01',
    ]);
  });

  it('finds the terms in effect on a day', () => {
    const march = terms({ effectiveFrom: '2026-03-01', strategy: SETTLEMENT_STRATEGY.equal });
    const profile = profileOf(terms(), march);

    expect(settlementTermsOn(profile, '2026-02-28')?.effectiveFrom).toBeUndefined();
    expect(settlementTermsOn(profile, '2026-03-01')).toBe(march);
  });

  describe('settlementSegments', () => {
    const profile = profileOf(
      terms(),
      terms({ effectiveFrom: '2026-03-01' }),
      terms({ effectiveFrom: '2026-05-01' })
    );
    const ranges = (start: string, end: string) =>
      settlementSegments(profile, start, end).map(({ startDate, endDate }) => [startDate, endDate]);

    it('splits a range at each change', () => {
      expect(ranges('2026-02-01', '2026-05-31')).toEqual([
        ['2026-02-01', '2026-02-28'],
        ['2026-03-01', '2026-04-30'],
        ['2026-05-01', '2026-05-31'],
      ]);
    });

    it('handles ranges that start or end right at a change', () => {
      expect(ranges('2026-03-01', '2026-03-31')).toEqual([['2026-03-01', '2026-03-31']]);
      expect(ranges('2026-02-01', '2026-02-28')).toEqual([['2026-02-01', '2026-02-28']]);
      expect(ranges('2026-02-28', '2026-03-01')).toEqual([
        ['2026-02-28', '2026-02-28'],
        ['2026-03-01', '2026-03-01'],
      ]);
    });

    it('has no parts for an empty range', () => {
      expect(ranges('2026-04-02', '2026-04-01')).toEqual([]);
    });
  });

  it('counts back across months, years and leap days', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2028-03-01')).toBe('2028-02-29');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });

  it('adds, replaces, moves and removes dated terms', () => {
    let profile = upsertSettlementTerms(null, terms());
    profile = upsertSettlementTerms(profile, terms({ effectiveFrom: '2026-05-01' }));
    profile = upsertSettlementTerms(
      profile,
      terms({ effectiveFrom: '2026-05-01', strategy: SETTLEMENT_STRATEGY.equal })
    );
    expect(profile.terms).toHaveLength(2);
    expect(profile.terms[1].strategy).toBe(SETTLEMENT_STRATEGY.equal);

    profile = upsertSettlementTerms(profile, terms({ effectiveFrom: '2026-07-01' }), '2026-05-01');
    expect(profile.terms.map((entry) => entry.effectiveFrom)).toEqual([undefined, '2026-07-01']);

    profile = upsertSettlementTerms(profile, terms({ strategy: SETTLEMENT_STRATEGY.custom }));
    expect(profile.terms.map((entry) => entry.strategy)).toEqual([
      SETTLEMENT_STRATEGY.custom,
      SETTLEMENT_STRATEGY.incomeWeighted,
    ]);

    profile = removeSettlementTerms(profile, '2026-07-01');
    expect(profile.terms).toHaveLength(1);
  });

  it('reports what keeps terms from being saved', () => {
    expect(validateSettlementTerms(terms())).toEqual([]);

    const codes = validateSettlementTerms(
      terms({
        strategy: SETTLEMENT_STRATEGY.custom,
        participants: [
          { id: ALEX, name: ' ', accountIds: [ALEX_ACCOUNT], customShareBasisPoints: 6_000 },
          { id: SAM, name: 'Sam', accountIds: [ALEX_ACCOUNT], customShareBasisPoints: 3_000 },
        ],
        expenseCategoryIds: [SALARY],
      })
    ).map((issue) => issue.code);

    expect(codes).toEqual([
      SETTLEMENT_TERMS_ISSUE.missingParticipantName,
      SETTLEMENT_TERMS_ISSUE.accountAssignedTwice,
      SETTLEMENT_TERMS_ISSUE.customSharesIncomplete,
      SETTLEMENT_TERMS_ISSUE.categoryCountedTwice,
    ]);
    expect(
      validateSettlementTerms(
        terms({ participants: [], incomeCategoryIds: [], expenseCategoryIds: [] })
      ).map((issue) => issue.code)
    ).toEqual([
      SETTLEMENT_TERMS_ISSUE.tooFewParticipants,
      SETTLEMENT_TERMS_ISSUE.missingExpenseCategories,
      SETTLEMENT_TERMS_ISSUE.missingIncomeCategories,
    ]);
  });

  it('takes only workspace members, each once', () => {
    const members = new Set([ALEX, SAM]);
    expect(validateSettlementTerms(terms(), { memberIds: members })).toEqual([]);

    const stranger = { ...terms().participants[1], id: 'stranger' };
    expect(
      validateSettlementTerms(terms({ participants: [terms().participants[0], stranger] }), {
        memberIds: members,
      })
    ).toEqual([{ code: SETTLEMENT_TERMS_ISSUE.participantNotAMember, participantId: 'stranger' }]);

    const twice = { ...terms().participants[0], accountIds: [SAM_ACCOUNT] };
    expect(
      validateSettlementTerms(terms({ participants: [terms().participants[0], twice] }), {
        memberIds: members,
      }).map((issue) => issue.code)
    ).toEqual([SETTLEMENT_TERMS_ISSUE.memberChosenTwice]);
  });

  it('lets changes start only on a free first day of a month', () => {
    const issues = (effectiveFrom: string, taken: string[] = []) =>
      validateSettlementTerms(terms({ effectiveFrom }), { otherEffectiveDates: taken }).map(
        (issue) => issue.code
      );

    expect(issues('2026-03-01')).toEqual([]);
    expect(issues('2026-03-15')).toEqual([SETTLEMENT_TERMS_ISSUE.invalidEffectiveDate]);
    expect(issues('1899-12-01')).toEqual([SETTLEMENT_TERMS_ISSUE.invalidEffectiveDate]);
    expect(issues('2026-03-01', ['2026-03-01'])).toEqual([
      SETTLEMENT_TERMS_ISSUE.effectiveDateTaken,
    ]);
  });
});

describe('SettlementService (Node/sql.js)', () => {
  let adapter: NodeSqlJsAdapter;
  let services: Services;
  let budgetId: number;
  let alexAccount: number;
  let samAccount: number;
  let jointAccount: number;
  let salary: number;
  let groceries: number;
  let rent: number;
  let hobby: number;
  let transfers: number;

  const exec = (query: string, ...params: unknown[]) => adapter.prepare(query).run(...params);

  const add = (
    accountId: number,
    categoryId: number,
    date: string,
    inflow: number,
    outflow = 0,
    budget = budgetId,
    transferId = ''
  ) =>
    services.transactions.addTransaction(
      asMilli(inflow),
      asMilli(outflow),
      accountId,
      categoryId,
      budget,
      date,
      'memo',
      transferId
    );

  const createHousehold = async (name: string) => {
    const id = await services.budgets.createBudget({
      name,
      display_currency: 'EUR',
      badge_icon: 'euro',
      number_format: 'euro',
      create_default_categories: true,
    });
    const account = async (accountName: string) =>
      (await services.accounts.createAccount(accountName, id, 'checking', 'EUR', 0)).ID;
    return { id, account };
  };

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    services = manager.getServices();
    const household = await createHousehold('Household');
    budgetId = household.id;
    alexAccount = await household.account('Alex');
    samAccount = await household.account('Sam');
    jointAccount = await household.account('Joint');

    const incomeGroup = services.categories
      .getAllCategoryGroups(budgetId)
      .find((group) => group.Name === 'Income')!;
    const categories = services.categories.getAllCategories(budgetId);
    salary = categories.find((category) => category.CategoryGroupID === incomeGroup.ID)!.ID;
    transfers = categories.find((category) => category.Name === 'Transfers')!.ID;
    const spending = categories.filter(
      (category) =>
        category.CategoryGroupID !== incomeGroup.ID &&
        !['Transfers', 'Uncategorized'].includes(category.Name)
    );
    [groceries, rent, hobby] = spending.map((category) => category.ID);
  });

  const householdTerms = (): SettlementTerms => ({
    strategy: SETTLEMENT_STRATEGY.incomeWeighted,
    participants: [
      { id: ALEX, name: 'Alex', accountIds: [alexAccount], customShareBasisPoints: 0 },
      { id: SAM, name: 'Sam', accountIds: [samAccount], customShareBasisPoints: 0 },
    ],
    incomeCategoryIds: [salary],
    expenseCategoryIds: [groceries, rent],
  });

  const settleJanuary = (profile = profileOf(householdTerms())) =>
    services.settlement.calculate(budgetId, profile, '2026-01-01', '2026-01-31', ALL_APPROVED);

  it('settles posted transactions, split lines included', async () => {
    await add(alexAccount, salary, '2026-01-25', 3_000_000);
    await add(samAccount, salary, '2026-01-25', 2_000_000);
    await add(alexAccount, rent, '2026-01-03', 0, 1_000_000);
    await add(jointAccount, groceries, '2026-01-10', 0, 999_000);
    await add(samAccount, groceries, '2026-02-01', 0, 999_000);
    const split = await add(samAccount, groceries, '2026-01-12', 0, 700_000);
    await services.splits.upsertSplits(split, [
      {
        CategoryID: groceries,
        Memo: 'food',
        InflowConverted: asMilli(0),
        OutflowConverted: asMilli(500_000),
        InflowNative: asMilli(0),
        OutflowNative: asMilli(500_000),
        OrderIndex: 0,
      },
      {
        CategoryID: hobby,
        Memo: 'books',
        InflowConverted: asMilli(0),
        OutflowConverted: asMilli(200_000),
        InflowNative: asMilli(0),
        OutflowNative: asMilli(200_000),
        OrderIndex: 1,
      },
    ]);

    const result = settleJanuary();

    expect(result.totalSharedExpenses).toBe(1_500_000);
    expect(nets(result)).toEqual({ [ALEX]: 100_000, [SAM]: -100_000 });
  });

  it('counts transfers between participants as payments, not as shared expenses', async () => {
    await add(alexAccount, salary, '2026-01-25', 1_000_000);
    await add(samAccount, salary, '2026-01-25', 1_000_000);
    await add(alexAccount, transfers, '2026-01-05', 0, 400_000, budgetId, 'pair-1');
    await add(samAccount, transfers, '2026-01-05', 400_000, 0, budgetId, 'pair-1');
    await add(alexAccount, transfers, '2026-01-06', 0, 50_000, budgetId, 'to-joint');
    await add(jointAccount, transfers, '2026-01-06', 50_000, 0, budgetId, 'to-joint');
    const other = await createHousehold('Other');
    await add(await other.account('Elsewhere'), rent, '2026-01-05', 0, 1_000_000, other.id);

    const result = settleJanuary(
      profileOf({ ...householdTerms(), expenseCategoryIds: [groceries, rent] })
    );

    expect(result.totalSharedExpenses).toBe(0);
    expect(nets(result)).toEqual({ [ALEX]: 400_000, [SAM]: -400_000 });
    expect(result.transfers).toEqual([
      { fromParticipantId: SAM, toParticipantId: ALEX, amount: 400_000 },
    ]);
  });

  it('uses budget-currency amounts and the date part of stored dates', async () => {
    await add(alexAccount, salary, '2026-01-25', 1_000_000);
    await add(samAccount, salary, '2026-01-25', 1_000_000);
    const rentId = await add(alexAccount, rent, '2026-01-31', 0, 1_000_000);
    exec(
      'UPDATE transactions SET OutflowConverted = ?, Date = ? WHERE ID = ?',
      800_000,
      '2026-01-31T23:30:00',
      rentId
    );

    expect(settleJanuary().totalSharedExpenses).toBe(800_000);
  });

  it('reads nothing for terms without accounts', () => {
    expect(services.settlement.getLineTotals(budgetId, '2026-01-01', '2026-01-31', [])).toEqual([]);
  });

  it('evens out over all months once the suggested payment is made', async () => {
    await add(alexAccount, salary, '2026-01-25', 1_000_000);
    await add(samAccount, salary, '2026-01-25', 1_000_000);
    await add(alexAccount, rent, '2026-01-03', 0, 1_000_000);
    const sinceStart = () =>
      services.settlement.calculate(
        budgetId,
        profileOf(householdTerms()),
        SETTLEMENT_EARLIEST_DATE,
        '2026-02-28',
        ALL_APPROVED
      );
    expect(nets(sinceStart())).toEqual({ [ALEX]: 500_000, [SAM]: -500_000 });

    await add(samAccount, transfers, '2026-02-02', 0, 500_000, budgetId, 'settle-1');
    await add(alexAccount, transfers, '2026-02-02', 500_000, 0, budgetId, 'settle-1');

    expect(nets(sinceStart())).toEqual({ [ALEX]: 0, [SAM]: 0 });
    expect(sinceStart().transfers).toEqual([]);
  });

  it('reads the stored profile from the budget’s synced state', () => {
    const stored = upsertSettlementTerms(null, householdTerms());
    services.syncedState.set(
      settlementProfileScope(budgetId),
      SETTLEMENT_PROFILE_KEY,
      stored,
      '2026-01-01T00:00:00Z'
    );

    expect(services.settlement.readProfile(budgetId)).toEqual({
      status: SETTLEMENT_PROFILE_STATUS.ready,
      profile: stored,
    });
    expect(services.settlement.readProfile(budgetId + 1).status).toBe(
      SETTLEMENT_PROFILE_STATUS.unset
    );
  });

  it('applies dated terms from their date on', async () => {
    await add(alexAccount, rent, '2026-01-03', 0, 1_000_000);
    await add(alexAccount, rent, '2026-02-03', 0, 1_000_000);
    await add(alexAccount, salary, '2026-01-25', 1_000_000);
    const profile = upsertSettlementTerms(profileOf(householdTerms()), {
      ...householdTerms(),
      effectiveFrom: '2026-02-01',
      strategy: SETTLEMENT_STRATEGY.equal,
    });

    const result = services.settlement.calculate(
      budgetId,
      profile,
      '2026-01-01',
      '2026-02-28',
      ALL_APPROVED
    );

    // January: only Alex earned, so Alex carries all of it; February: halves.
    expect(nets(result)).toEqual({ [ALEX]: 500_000, [SAM]: -500_000 });
    expect(result.segments).toHaveLength(2);
  });
});

describe('SettlementService without everyone’s consent (Node/sql.js)', () => {
  it('settles only the parts whose terms every participant approved', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    const services = manager.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'Household',
      display_currency: 'EUR',
      badge_icon: 'euro',
      number_format: 'euro',
      create_default_categories: true,
    });
    const alex = (await services.accounts.createAccount('Alex', budgetId, 'checking', 'EUR', 0)).ID;
    const sam = (await services.accounts.createAccount('Sam', budgetId, 'checking', 'EUR', 0)).ID;
    const rent = services.categories
      .getAllCategories(budgetId)
      .find((category) => !['Transfers', 'Uncategorized', 'Income'].includes(category.Name))!.ID;
    for (const date of ['2026-01-03', '2026-02-03']) {
      await services.transactions.addTransaction(
        asMilli(0),
        asMilli(1_000_000),
        alex,
        rent,
        budgetId,
        date,
        'rent',
        ''
      );
    }
    const january = terms({
      strategy: SETTLEMENT_STRATEGY.equal,
      participants: [
        { id: ALEX, name: 'Alex', accountIds: [alex], customShareBasisPoints: 0 },
        { id: SAM, name: 'Sam', accountIds: [sam], customShareBasisPoints: 0 },
      ],
      expenseCategoryIds: [rent],
    });
    const profile = profileOf(january, { ...january, effectiveFrom: '2026-02-01' });
    const onlyInitial = (entry: SettlementTerms) => entry.effectiveFrom === undefined;

    const result = services.settlement.calculate(
      budgetId,
      profile,
      '2026-01-01',
      '2026-02-28',
      onlyInitial
    );

    expect(result.totalSharedExpenses).toBe(1_000_000);
    expect(result.unapprovedSegments).toEqual([
      { startDate: '2026-02-01', endDate: '2026-02-28', effectiveFrom: '2026-02-01' },
    ]);
    expect(
      services.settlement.calculate(budgetId, profile, '2026-01-01', '2026-02-28', () => false)
        .participants
    ).toEqual([]);
  });
});

describe('settlementReport', () => {
  it('describes the result in currency units with names', () => {
    const result = settleOne(
      terms(),
      [
        line(ALEX_ACCOUNT, SALARY, 3_000_000, 0),
        line(SAM_ACCOUNT, SALARY, 2_000_000, 0),
        line(ALEX_ACCOUNT, RENT, 0, 1_000_005),
      ],
      [payment(SAM_ACCOUNT, ALEX_ACCOUNT, 100_000)]
    );

    const report = settlementReport(
      { ...result, unapprovedSegments: [{ startDate: '2026-02-01', endDate: '2026-02-28' }] },
      {
        currency: 'EUR',
        categoryNames: new Map([[RENT, 'Rent']]),
        memberNames: new Map([[ALEX, 'Alex (current)']]),
      }
    );

    expect(report).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      currency: 'EUR',
      totalSharedExpenses: 1000.005,
      totalEligibleIncome: 5000,
      toSettleUp: [{ from: 'Sam', to: 'Alex (current)', amount: 300 }],
      awaitingConsent: [{ startDate: '2026-02-01', endDate: '2026-02-28' }],
    });
    expect(report.participants[0]).toMatchObject({
      userId: ALEX,
      name: 'Alex (current)',
      sharePercent: 60,
      sharedExpensesPaid: 1000.005,
      paymentsReceived: 100,
      sharedExpensesByCategory: [{ categoryId: RENT, category: 'Rent', amount: 1000.005 }],
      incomeByCategory: [{ categoryId: SALARY, category: '', amount: 3000 }],
    });
  });
});
