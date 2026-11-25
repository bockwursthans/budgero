import { SETTLEMENT_EARLIEST_DATE } from '@budgero/core/browser';
import { lastDayOfMonth } from '@pages/analytics/analytics-state';
import { shiftMonthKey } from '@pages/analytics/analytics-model';

export const SETTLEMENT_PERIOD_MODE = {
  /** Everything up to today: the balance still open between the participants. */
  sinceStart: 'since-start',
  month: 'month',
  custom: 'custom',
} as const;

export type SettlementPeriodMode =
  (typeof SETTLEMENT_PERIOD_MODE)[keyof typeof SETTLEMENT_PERIOD_MODE];

export interface SettlementPeriod {
  mode: SettlementPeriodMode;
  /** YYYY-MM-DD the open balance runs to (today when the page opened). */
  today: string;
  /** YYYY-MM, used in month mode. */
  month: string;
  /** YYYY-MM-DD, used in custom mode ('' until picked). */
  customStart: string;
  customEnd: string;
}

export interface SettlementRange {
  startDate: string;
  endDate: string;
}

const MONTH_KEY_LENGTH = 'YYYY-MM'.length;
const FIRST_DAY_SUFFIX = '-01';

/** The first day of a YYYY-MM month: the date settlement changes start on. */
export function monthStart(monthKey: string): string {
  return `${monthKey}${FIRST_DAY_SUFFIX}`;
}

/** The YYYY-MM month of a YYYY-MM-DD date. */
export function monthKeyOf(date: string): string {
  return date.slice(0, MONTH_KEY_LENGTH);
}

/** Where a new change starts by default: next month, so the current one stays as it is. */
export function defaultChangeDate(todayISO: string): string {
  return monthStart(shiftMonthKey(monthKeyOf(todayISO), 1));
}

/**
 * Opens on the open balance: every month so far, with the payments already
 * made between the participants. It is zero once everyone is even.
 */
export function initialSettlementPeriod(todayISO: string): SettlementPeriod {
  return {
    mode: SETTLEMENT_PERIOD_MODE.sinceStart,
    today: todayISO,
    month: monthKeyOf(todayISO),
    customStart: '',
    customEnd: '',
  };
}

/** The inclusive date range a period covers; empty dates until a custom range is picked. */
export function resolveSettlementRange(period: SettlementPeriod): SettlementRange {
  switch (period.mode) {
    case SETTLEMENT_PERIOD_MODE.sinceStart:
      return { startDate: SETTLEMENT_EARLIEST_DATE, endDate: period.today };
    case SETTLEMENT_PERIOD_MODE.custom:
      return { startDate: period.customStart, endDate: period.customEnd || period.customStart };
    case SETTLEMENT_PERIOD_MODE.month:
      return { startDate: monthStart(period.month), endDate: lastDayOfMonth(period.month) };
  }
}

export function shiftSettlementMonth(period: SettlementPeriod, months: number): SettlementPeriod {
  return { ...period, month: shiftMonthKey(period.month, months) };
}
