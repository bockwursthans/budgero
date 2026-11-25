import { lastDayOfMonth } from '@pages/analytics/analytics-state';
import { shiftMonthKey } from '@pages/analytics/analytics-model';

export const SETTLEMENT_PERIOD_MODE = {
  month: 'month',
  custom: 'custom',
} as const;

export type SettlementPeriodMode =
  (typeof SETTLEMENT_PERIOD_MODE)[keyof typeof SETTLEMENT_PERIOD_MODE];

export interface SettlementPeriod {
  mode: SettlementPeriodMode;
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

/** The current month, so the settlement opens on what is still open. */
export function initialSettlementPeriod(todayISO: string): SettlementPeriod {
  return {
    mode: SETTLEMENT_PERIOD_MODE.month,
    month: monthKeyOf(todayISO),
    customStart: '',
    customEnd: '',
  };
}

/** The inclusive date range a period covers; empty dates until a custom range is picked. */
export function resolveSettlementRange(period: SettlementPeriod): SettlementRange {
  if (period.mode === SETTLEMENT_PERIOD_MODE.custom) {
    return { startDate: period.customStart, endDate: period.customEnd || period.customStart };
  }
  return { startDate: monthStart(period.month), endDate: lastDayOfMonth(period.month) };
}

export function shiftSettlementMonth(period: SettlementPeriod, months: number): SettlementPeriod {
  return { ...period, month: shiftMonthKey(period.month, months) };
}
