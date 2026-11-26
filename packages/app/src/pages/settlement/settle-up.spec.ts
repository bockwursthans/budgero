import {
  asMilli,
  SETTLEMENT_PROGRESS_STATUS,
  type SettlementPersonalItem,
  type SettlementTransfer,
} from '@budgero/core/browser';
import {
  canSettlePerItem,
  itemsToSettle,
  recordableLines,
  SETTLE_UP_MODE,
  settleUpLines,
} from './settle-up';

const SAM = 'sam';
const ALEX = 'alex';
const DINING = 30;

const transfer: SettlementTransfer = {
  fromParticipantId: SAM,
  toParticipantId: ALEX,
  amount: asMilli(200_000),
};

const item = (overrides: Partial<SettlementPersonalItem> = {}): SettlementPersonalItem => ({
  transactionId: 7,
  date: '2026-02-10',
  categoryId: DINING,
  payee: 'Restaurant',
  memo: '',
  paidById: ALEX,
  ownerId: SAM,
  amount: asMilli(50_000),
  status: SETTLEMENT_PROGRESS_STATUS.open,
  ...overrides,
});

const memos = {
  all: 'Household settlement',
  rest: 'Shared expenses',
  item: (entry: SettlementPersonalItem) => `Settles ${entry.categoryId}`,
};

describe('itemsToSettle', () => {
  it('keeps what the payer still owes the receiver in full', () => {
    const owed = item();
    expect(
      itemsToSettle(transfer, [
        owed,
        item({ transactionId: 8, status: SETTLEMENT_PROGRESS_STATUS.settled }),
        item({ transactionId: 9, paidById: SAM, ownerId: ALEX }),
        item({ transactionId: 10, amount: asMilli(-5_000) }),
      ])
    ).toEqual([owed]);
  });
});

describe('settleUpLines', () => {
  it('records one transfer for everything by default', () => {
    expect(settleUpLines(transfer, [item()], SETTLE_UP_MODE.single, memos)).toEqual([
      { key: 'all', amount: 200_000, memo: 'Household settlement' },
    ]);
  });

  it('records one transfer per item, then the rest', () => {
    expect(settleUpLines(transfer, [item()], SETTLE_UP_MODE.perItem, memos)).toEqual([
      { key: 'item-7-30', amount: 50_000, memo: `Settles ${DINING}` },
      { key: 'rest', amount: 150_000, memo: 'Shared expenses' },
    ]);
  });

  it('leaves out an empty rest and rounds items to cents', () => {
    const exact = { ...transfer, amount: asMilli(50_000) };
    expect(
      settleUpLines(exact, [item({ amount: asMilli(49_996) })], SETTLE_UP_MODE.perItem, memos)
    ).toEqual([{ key: 'item-7-30', amount: 50_000, memo: `Settles ${DINING}` }]);
  });

  it('falls back to one transfer when the items add up to more than the payment', () => {
    const small = { ...transfer, amount: asMilli(30_000) };
    expect(canSettlePerItem(small, [item()])).toBe(false);
    expect(settleUpLines(small, [item()], SETTLE_UP_MODE.perItem, memos)).toEqual([
      { key: 'all', amount: 30_000, memo: 'Household settlement' },
    ]);
  });
});

describe('recordableLines', () => {
  it('drops lines without a positive amount', () => {
    expect(
      recordableLines([
        { key: 'a', amount: asMilli(0), memo: '' },
        { key: 'b', amount: asMilli(10), memo: '' },
      ])
    ).toEqual([{ key: 'b', amount: 10, memo: '' }]);
  });
});
