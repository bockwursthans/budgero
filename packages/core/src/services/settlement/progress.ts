/**
 * Settlement progress: how far back the settlement payments made so far
 * reach. The balance is settled as a whole, not booking by booking, so the
 * progress is told by month:
 *
 *   owed_i(m)  = net of participant i over everything up to the end of month m,
 *                payments left out
 *   open_i(m)  = owed_i(m) + payments_i      (payments: sent - received, all so far)
 *
 * Month m is settled when no participant still has anything open in the
 * direction they owed or were owed up to then. Every month up to the last
 * settled one counts as settled; the month after it is partly settled when
 * the payments already cover some of what it added; the rest is open.
 *
 * Pure functions, no DB or UI dependencies.
 */

import {
  SETTLEMENT_PROGRESS_STATUS,
  type SettlementMonthProgress,
  type SettlementProgressStatus,
} from './types.js';

/** Under half a cent counts as even: suggested payments are whole cents. */
const EVEN_BELOW_MILLI = 5;
const MONTHS_PER_YEAR = 12;
const MONTH_DIGITS = 2;

export interface SettlementCumulativeNets {
  /** YYYY-MM */
  month: string;
  /** Per participant: the net up to the end of the month, payments left out. */
  nets: ReadonlyMap<string, number>;
}

export interface SettlementMonthProgressResult {
  months: SettlementMonthProgress[];
  settledThrough?: string;
}

/** Nothing owed up to the month is still open once the payments are counted. */
function isCovered(nets: ReadonlyMap<string, number>, payments: ReadonlyMap<string, number>) {
  for (const [id, owed] of nets) {
    if (Math.abs(owed) < EVEN_BELOW_MILLI) continue;
    const open = owed + (payments.get(id) ?? 0);
    if (Math.sign(owed) * open >= EVEN_BELOW_MILLI) return false;
  }
  return true;
}

/** The payments cover part of what the month added on top of `base`. */
function isReduced(
  nets: ReadonlyMap<string, number>,
  base: ReadonlyMap<string, number> | undefined,
  payments: ReadonlyMap<string, number>
) {
  for (const [id, owed] of nets) {
    const added = owed - (base?.get(id) ?? 0);
    if (Math.abs(added) < EVEN_BELOW_MILLI) continue;
    const open = owed + (payments.get(id) ?? 0);
    if (Math.sign(added) * open <= Math.abs(added) - EVEN_BELOW_MILLI) return true;
  }
  return false;
}

/** Each month's status from the cumulative nets (months in date order). */
export function settlementMonthProgress(
  cumulative: readonly SettlementCumulativeNets[],
  payments: ReadonlyMap<string, number>
): SettlementMonthProgressResult {
  let lastSettled = -1;
  cumulative.forEach((entry, index) => {
    if (isCovered(entry.nets, payments)) lastSettled = index;
  });
  const statusOf = (entry: SettlementCumulativeNets, index: number): SettlementProgressStatus => {
    if (index <= lastSettled) return SETTLEMENT_PROGRESS_STATUS.settled;
    const base = lastSettled >= 0 ? cumulative[lastSettled].nets : undefined;
    return index === lastSettled + 1 && isReduced(entry.nets, base, payments)
      ? SETTLEMENT_PROGRESS_STATUS.partly
      : SETTLEMENT_PROGRESS_STATUS.open;
  };
  return {
    months: cumulative.map((entry, index) => ({
      month: entry.month,
      status: statusOf(entry, index),
    })),
    ...(lastSettled >= 0 ? { settledThrough: cumulative[lastSettled].month } : {}),
  };
}

/** The YYYY-MM month after `month`. */
export function nextMonthKey(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === MONTHS_PER_YEAR ? year + 1 : year;
  const next = monthNumber === MONTHS_PER_YEAR ? 1 : monthNumber + 1;
  return `${nextYear}-${String(next).padStart(MONTH_DIGITS, '0')}`;
}

/** Every YYYY-MM month from `first` to `last`, both included (empty when first > last). */
export function monthKeysBetween(first: string, last: string): string[] {
  const months: string[] = [];
  for (let month = first; month <= last; month = nextMonthKey(month)) months.push(month);
  return months;
}
