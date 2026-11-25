import { beforeEach, describe, expect, it } from 'vitest';
import {
  apportion,
  calculateSettlement,
  cleanSettlementName,
  dayBefore,
  NodeSqlJsAdapter,
  readSettlementProfile,
  removeSettlementTerms,
  ServiceManager,
  SETTLEMENT_MAX_TERMS,
  SETTLEMENT_PROFILE_FORMAT_VERSION,
  SETTLEMENT_PROFILE_STATUS,
  SETTLEMENT_STRATEGY,
  SETTLEMENT_TERMS_ISSUE,
  SETTLEMENT_WARNING,
  settlementSegments,
  settlementTermsOn,
  settlementTransfers,
  upsertSettlementTerms,
  validateSettlementTerms,
  type SettlementLineTotal,
  type SettlementProfile,
  type SettlementTerms,
  type Services,
} from '../src';
import { asMilli } from '../src/money';

const KAY = 'kay';
const FRANZI = 'franzi';
const FLATMATE = 'flatmate';
const KAY_ACCOUNT = 1;
const FRANZI_ACCOUNT = 2;
const JOINT_ACCOUNT = 3;
const SALARY = 10;
const GROCERIES = 20;
const RENT = 21;
const HOBBY = 22;

const terms = (overrides: Partial<SettlementTerms> = {}): SettlementTerms => ({
  strategy: SETTLEMENT_STRATEGY.incomeWeighted,
  participants: [
    { id: KAY, name: 'Kay', accountIds: [KAY_ACCOUNT], customShareBasisPoints: 7_000 },
    { id: FRANZI, name: 'Franzi', accountIds: [FRANZI_ACCOUNT], customShareBasisPoints: 3_000 },
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
  range: [string, string] = ['2026-01-01', '2026-01-31']
) =>
  calculateSettlement(
    [{ segment: { terms: settlementTerms, startDate: range[0], endDate: range[1] }, lines }],
    ...range
  );

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
      line(KAY_ACCOUNT, SALARY, 3_000_000, 0),
      line(FRANZI_ACCOUNT, SALARY, 2_000_000, 0),
      line(KAY_ACCOUNT, RENT, 0, 1_000_000),
      line(FRANZI_ACCOUNT, GROCERIES, 0, 500_000),
    ]);

    expect(result.totalSharedExpenses).toBe(1_500_000);
    expect(result.totalEligibleIncome).toBe(5_000_000);
    expect(byId(result, KAY)).toMatchObject({
      eligibleIncome: 3_000_000,
      sharedExpensesPaid: 1_000_000,
      targetContribution: 900_000,
      netSettlement: 100_000,
      contributionShare: 0.6,
    });
    expect(byId(result, FRANZI)).toMatchObject({
      targetContribution: 600_000,
      netSettlement: -100_000,
    });
    expect(result.transfers).toEqual([
      { fromParticipantId: FRANZI, toParticipantId: KAY, amount: 100_000 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('ignores categories and accounts outside the terms', () => {
    const result = settleOne(terms(), [
      line(KAY_ACCOUNT, SALARY, 1_000_000, 0),
      line(FRANZI_ACCOUNT, SALARY, 1_000_000, 0),
      line(KAY_ACCOUNT, HOBBY, 0, 400_000),
      line(JOINT_ACCOUNT, RENT, 0, 800_000),
      line(FRANZI_ACCOUNT, RENT, 0, 200_000),
    ]);

    expect(result.totalSharedExpenses).toBe(200_000);
    expect(byId(result, KAY).netSettlement).toBe(-100_000);
  });

  it('nets refunds against expenses and paid-back income against income', () => {
    const result = settleOne(terms(), [
      line(KAY_ACCOUNT, SALARY, 1_000_000, 200_000),
      line(FRANZI_ACCOUNT, SALARY, 800_000, 0),
      line(KAY_ACCOUNT, GROCERIES, 50_000, 350_000),
    ]);

    expect(byId(result, KAY).eligibleIncome).toBe(800_000);
    expect(byId(result, KAY).sharedExpensesPaid).toBe(300_000);
    expect(byId(result, KAY).targetContribution).toBe(150_000);
  });

  it('shares a refund month: whoever got the money back passes on the others part', () => {
    const result = settleOne(terms(), [
      line(KAY_ACCOUNT, SALARY, 1_000_000, 0),
      line(FRANZI_ACCOUNT, SALARY, 1_000_000, 0),
      line(KAY_ACCOUNT, GROCERIES, 100_000, 0),
    ]);

    expect(result.totalSharedExpenses).toBe(-100_000);
    expect(nets(result)).toEqual({ [KAY]: -50_000, [FRANZI]: 50_000 });
    expect(result.transfers).toEqual([
      { fromParticipantId: KAY, toParticipantId: FRANZI, amount: 50_000 },
    ]);
  });

  it('gives negative income no share', () => {
    const result = settleOne(terms(), [
      line(KAY_ACCOUNT, SALARY, 0, 200_000),
      line(FRANZI_ACCOUNT, SALARY, 1_000_000, 0),
      line(KAY_ACCOUNT, RENT, 0, 1_000_000),
    ]);

    expect(byId(result, KAY).targetContribution).toBe(0);
    expect(nets(result)).toEqual({ [KAY]: 1_000_000, [FRANZI]: -1_000_000 });
  });

  it('splits equally and by custom shares', () => {
    const lines = [line(KAY_ACCOUNT, RENT, 0, 1_000_000)];

    const equal = settleOne(terms({ strategy: SETTLEMENT_STRATEGY.equal }), lines);
    expect(byId(equal, FRANZI).netSettlement).toBe(-500_000);

    const custom = settleOne(terms({ strategy: SETTLEMENT_STRATEGY.custom }), lines);
    expect(byId(custom, KAY).targetContribution).toBe(700_000);
    expect(byId(custom, FRANZI).netSettlement).toBe(-300_000);
  });

  it('splits equally and warns when income-weighted terms find no income', () => {
    const result = settleOne(terms(), [line(KAY_ACCOUNT, RENT, 0, 1_000_000)]);

    expect(byId(result, FRANZI).targetContribution).toBe(500_000);
    expect(result.warnings).toEqual([SETTLEMENT_WARNING.noIncomeSplitEqually]);
  });

  it('splits equally and warns when every fixed share is zero', () => {
    const zeroShares = terms({
      strategy: SETTLEMENT_STRATEGY.custom,
      participants: terms().participants.map((p) => ({ ...p, customShareBasisPoints: 0 })),
    });
    const result = settleOne(zeroShares, [line(KAY_ACCOUNT, RENT, 0, 1_000_000)]);

    expect(byId(result, FRANZI).targetContribution).toBe(500_000);
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
        { ...terms().participants[1], accountIds: [FRANZI_ACCOUNT, KAY_ACCOUNT] },
      ],
    });
    const result = settleOne(shared, [line(KAY_ACCOUNT, RENT, 0, 1_000_000)]);

    expect(byId(result, KAY).sharedExpensesPaid).toBe(1_000_000);
    expect(byId(result, FRANZI).sharedExpensesPaid).toBe(0);
  });

  it('adds up the parts of a range spanning a change of terms', () => {
    const later = terms({ effectiveFrom: '2026-02-01', strategy: SETTLEMENT_STRATEGY.equal });
    const result = calculateSettlement(
      [
        {
          segment: { terms: terms(), startDate: '2026-01-01', endDate: '2026-01-31' },
          lines: [
            line(KAY_ACCOUNT, SALARY, 3_000_000, 0),
            line(FRANZI_ACCOUNT, SALARY, 1_000_000, 0),
            line(KAY_ACCOUNT, RENT, 0, 1_000_000),
          ],
        },
        {
          segment: { terms: later, startDate: '2026-02-01', endDate: '2026-02-28' },
          lines: [line(FRANZI_ACCOUNT, RENT, 0, 1_000_000)],
        },
      ],
      '2026-01-01',
      '2026-02-28'
    );

    // January: Kay carries 75 % of 1000; February: each carries 500.
    expect(byId(result, KAY).targetContribution).toBe(1_250_000);
    expect(byId(result, KAY).contributionShare).toBe(0.625);
    expect(nets(result)).toEqual({ [KAY]: -250_000, [FRANZI]: 250_000 });
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
          lines: [line(KAY_ACCOUNT, RENT, 0, 1_000_000)],
        },
        {
          segment: { terms: withFlatmate, startDate: '2026-02-01', endDate: '2026-02-28' },
          lines: [line(KAY_ACCOUNT, RENT, 0, 900_000)],
        },
      ],
      '2026-01-01',
      '2026-02-28'
    );

    expect(byId(result, FLATMATE).targetContribution).toBe(300_000);
    expect(byId(result, FRANZI).targetContribution).toBe(800_000);
    expect(byId(result, KAY).netSettlement).toBe(1_100_000);
  });

  it('settles three participants with at most two transfers', () => {
    const three = terms({
      strategy: SETTLEMENT_STRATEGY.equal,
      participants: [...terms().participants, flatmate],
    });
    const result = settleOne(three, [line(KAY_ACCOUNT, RENT, 0, 900_000)]);

    expect(result.transfers).toEqual([
      { fromParticipantId: FLATMATE, toParticipantId: KAY, amount: 300_000 },
      { fromParticipantId: FRANZI, toParticipantId: KAY, amount: 300_000 },
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
        { ...terms(), participants: [{ id: KAY, name: 'Kay', accountIds: [1, 1, -4, 'x'] }] },
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
      { id: KAY, name: 'Kay', accountIds: [1], customShareBasisPoints: 0 },
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
    expect(cleanSettlementName('Fran\u200Bzi\u0000')).toBe('Franzi');
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
          { id: KAY, name: ' ', accountIds: [KAY_ACCOUNT], customShareBasisPoints: 6_000 },
          { id: FRANZI, name: 'Franzi', accountIds: [KAY_ACCOUNT], customShareBasisPoints: 3_000 },
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

  it('lets changes start only on a free first day of a month', () => {
    const issues = (effectiveFrom: string, taken: string[] = []) =>
      validateSettlementTerms(terms({ effectiveFrom }), taken).map((issue) => issue.code);

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
  let kayAccount: number;
  let franziAccount: number;
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
    kayAccount = await household.account('Kay');
    franziAccount = await household.account('Franzi');
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
      { id: KAY, name: 'Kay', accountIds: [kayAccount], customShareBasisPoints: 0 },
      { id: FRANZI, name: 'Franzi', accountIds: [franziAccount], customShareBasisPoints: 0 },
    ],
    incomeCategoryIds: [salary],
    expenseCategoryIds: [groceries, rent],
  });

  const settleJanuary = (profile = profileOf(householdTerms())) =>
    services.settlement.calculate(budgetId, profile, '2026-01-01', '2026-01-31');

  it('settles posted transactions, split lines included', async () => {
    await add(kayAccount, salary, '2026-01-25', 3_000_000);
    await add(franziAccount, salary, '2026-01-25', 2_000_000);
    await add(kayAccount, rent, '2026-01-03', 0, 1_000_000);
    await add(jointAccount, groceries, '2026-01-10', 0, 999_000);
    await add(franziAccount, groceries, '2026-02-01', 0, 999_000);
    const split = await add(franziAccount, groceries, '2026-01-12', 0, 700_000);
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
    expect(nets(result)).toEqual({ [KAY]: 100_000, [FRANZI]: -100_000 });
  });

  it('ignores transfers between the participants and other budgets', async () => {
    await add(kayAccount, salary, '2026-01-25', 1_000_000);
    await add(franziAccount, salary, '2026-01-25', 1_000_000);
    await add(kayAccount, transfers, '2026-01-05', 0, 400_000, budgetId, 'pair-1');
    await add(franziAccount, transfers, '2026-01-05', 400_000, 0, budgetId, 'pair-1');
    const other = await createHousehold('Other');
    await add(await other.account('Elsewhere'), rent, '2026-01-05', 0, 1_000_000, other.id);

    const result = settleJanuary(
      profileOf({ ...householdTerms(), expenseCategoryIds: [groceries, rent] })
    );

    expect(result.totalSharedExpenses).toBe(0);
    expect(result.transfers).toEqual([]);
  });

  it('uses budget-currency amounts and the date part of stored dates', async () => {
    await add(kayAccount, salary, '2026-01-25', 1_000_000);
    await add(franziAccount, salary, '2026-01-25', 1_000_000);
    const rentId = await add(kayAccount, rent, '2026-01-31', 0, 1_000_000);
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

  it('applies dated terms from their date on', async () => {
    await add(kayAccount, rent, '2026-01-03', 0, 1_000_000);
    await add(kayAccount, rent, '2026-02-03', 0, 1_000_000);
    await add(kayAccount, salary, '2026-01-25', 1_000_000);
    const profile = upsertSettlementTerms(profileOf(householdTerms()), {
      ...householdTerms(),
      effectiveFrom: '2026-02-01',
      strategy: SETTLEMENT_STRATEGY.equal,
    });

    const result = services.settlement.calculate(budgetId, profile, '2026-01-01', '2026-02-28');

    // January: only Kay earned, so Kay carries all of it; February: halves.
    expect(nets(result)).toEqual({ [KAY]: 500_000, [FRANZI]: -500_000 });
    expect(result.segments).toHaveLength(2);
  });
});
