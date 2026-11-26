import {
  roundToCents,
  SETTLEMENT_PROGRESS_STATUS,
  type MilliUnits,
  type SettlementPersonalItem,
  type SettlementTransfer,
} from '@budgero/core/browser';
import { asMilli } from '@shared/lib/currency/milli';

/** How a suggested payment is recorded: one transfer, or one per personal item and the rest. */
export const SETTLE_UP_MODE = {
  single: 'single',
  perItem: 'per-item',
} as const;

export type SettleUpMode = (typeof SETTLE_UP_MODE)[keyof typeof SETTLE_UP_MODE];

/** One transfer to record. `amount` in budget currency (whole cents). */
export interface SettleUpLine {
  key: string;
  amount: MilliUnits;
  memo: string;
}

export interface SettleUpMemos {
  /** The single transfer that settles everything. */
  all: string;
  /** What is left once the personal items are paid: the shared expenses. */
  rest: string;
  item: (item: SettlementPersonalItem) => string;
}

const LINE_KEY = { all: 'all', rest: 'rest', itemPrefix: 'item-' } as const;

const notSettled = (item: SettlementPersonalItem) =>
  item.status !== SETTLEMENT_PROGRESS_STATUS.settled;

/**
 * The personal items this payment can settle one by one: what the payer
 * still owes the receiver in full (the payer's personal categories that the
 * receiver paid), oldest first.
 */
export function itemsToSettle(
  transfer: SettlementTransfer,
  items: readonly SettlementPersonalItem[]
): SettlementPersonalItem[] {
  return items.filter(
    (item) =>
      item.ownerId === transfer.fromParticipantId &&
      item.paidById === transfer.toParticipantId &&
      item.amount > 0 &&
      notSettled(item)
  );
}

/**
 * Per item only works while the items fit into the payment: when they add
 * up to more, other amounts offset them and one transfer is the honest record.
 */
export function canSettlePerItem(
  transfer: SettlementTransfer,
  items: readonly SettlementPersonalItem[]
): boolean {
  if (items.length === 0) return false;
  return totalOf(items.map((item) => roundToCents(item.amount))) <= transfer.amount;
}

export function totalOf(amounts: readonly number[]): MilliUnits {
  return asMilli(amounts.reduce((sum, amount) => sum + amount, 0));
}

/** The transfers a mode suggests for the payment (the amounts stay editable). */
export function settleUpLines(
  transfer: SettlementTransfer,
  items: readonly SettlementPersonalItem[],
  mode: SettleUpMode,
  memos: SettleUpMemos
): SettleUpLine[] {
  if (mode === SETTLE_UP_MODE.single || !canSettlePerItem(transfer, items)) {
    return [{ key: LINE_KEY.all, amount: transfer.amount, memo: memos.all }];
  }
  const perItem = items.map((item) => ({
    key: `${LINE_KEY.itemPrefix}${item.transactionId}-${item.categoryId}`,
    amount: roundToCents(item.amount),
    memo: memos.item(item),
  }));
  const rest = asMilli(transfer.amount - totalOf(perItem.map((line) => line.amount)));
  return rest > 0 ? [...perItem, { key: LINE_KEY.rest, amount: rest, memo: memos.rest }] : perItem;
}

/** Lines that would record a transfer: a positive amount. */
export function recordableLines(lines: readonly SettleUpLine[]): SettleUpLine[] {
  return lines.filter((line) => line.amount > 0);
}
