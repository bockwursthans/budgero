import { z } from 'zod';
import {
  approvedSettlementTermsKeys,
  SETTLEMENT_EARLIEST_DATE,
  SETTLEMENT_PROFILE_STATUS,
  settlementReport,
  settlementTermsKey,
  type SettlementReport,
} from '@budgero/core/browser';
import { endOfMonth, formatDateISO, getTodayISO, parseMonthKey } from '@shared/lib/date-utils';
import { getErrorMessage } from '@shared/lib/errors';
import { isoDate, withoutNulls } from './resolve-entity';
import type { ToolContext, ToolExecutionResult } from './types';

/** Which part of time the settlement covers. */
export const SETTLEMENT_TOOL_PERIOD = {
  /** Every month so far, payments between participants included: who owes whom right now. */
  openBalance: 'open_balance',
  month: 'month',
  range: 'range',
} as const;

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What the tool says instead of a settlement when the saved terms can't be used. */
export const SETTLEMENT_TOOL_MESSAGE = {
  unset: 'No household settlement is set up for this budget.',
  newerFormat:
    'The household settlement was saved by a newer version of Budgero. Update Budgero to read it.',
  unreadable:
    'The household settlement terms could not be read completely, so no settlement is calculated. Open Reports → Household settlement to check them.',
} as const;

export const querySettlementSchema = withoutNulls(
  z.object({
    period: z.enum([
      SETTLEMENT_TOOL_PERIOD.openBalance,
      SETTLEMENT_TOOL_PERIOD.month,
      SETTLEMENT_TOOL_PERIOD.range,
    ]),
    month: z.string().regex(MONTH_KEY_PATTERN, 'must be a month in YYYY-MM format').optional(),
    startDate: isoDate().optional(),
    endDate: isoDate().optional(),
  })
);

export type QuerySettlementArgs = z.infer<typeof querySettlementSchema>;

export const QUERY_SETTLEMENT_DESCRIPTION =
  'Household settlement between the members of the workspace: shared expenses each participant paid, their fair share (by income, equal or fixed shares), payments already made between them, the open balance and who should pay whom. Use period "open_balance" for "who owes whom now", "month" (YYYY-MM) for one month, or "range" with startDate/endDate. Read-only. Only terms every participant agreed to are settled.';

type Range = { startDate: string; endDate: string } | { error: string };

function rangeOf(args: QuerySettlementArgs): Range {
  switch (args.period) {
    case SETTLEMENT_TOOL_PERIOD.openBalance:
      return { startDate: SETTLEMENT_EARLIEST_DATE, endDate: getTodayISO() };
    case SETTLEMENT_TOOL_PERIOD.month: {
      const first = args.month ? parseMonthKey(args.month) : null;
      if (!first) return { error: 'month is required as YYYY-MM for period "month"' };
      return { startDate: formatDateISO(first), endDate: formatDateISO(endOfMonth(first)) };
    }
    case SETTLEMENT_TOOL_PERIOD.range:
      if (!args.startDate || !args.endDate || args.startDate > args.endDate) {
        return { error: 'startDate and endDate (startDate <= endDate) are required for "range"' };
      }
      return { startDate: args.startDate, endDate: args.endDate };
  }
}

function describe(report: SettlementReport, format: (amount: number) => string): string {
  const balances = report.participants
    .map(
      (p) =>
        `${p.name}: paid ${format(p.sharedExpensesPaid)}, fair share ${format(p.fairShare)}, balance ${format(p.balance)}`
    )
    .join('; ');
  const settle =
    report.toSettleUp.length === 0
      ? 'Nothing to settle.'
      : `To settle up: ${report.toSettleUp.map((t) => `${t.from} pays ${t.to} ${format(t.amount)}`).join('; ')}.`;
  const pending =
    report.awaitingConsent.length > 0
      ? ` Not settled yet because not every participant agreed to the terms: ${report.awaitingConsent.map((s) => `${s.startDate} to ${s.endDate}`).join(', ')}.`
      : '';
  return `Household settlement ${report.startDate} to ${report.endDate} (positive balance = gets money back, negative = owes). Shared expenses ${format(report.totalSharedExpenses)}. ${balances}. ${settle}${pending}`;
}

export async function executeQuerySettlement(
  args: QuerySettlementArgs,
  context: ToolContext
): Promise<ToolExecutionResult> {
  try {
    const { status, profile } = context.services.settlement.readProfile(context.budgetId);
    // Settling only the readable part would silently stretch other terms over the rest.
    if (status === SETTLEMENT_PROFILE_STATUS.newerFormat) {
      return { success: false, message: SETTLEMENT_TOOL_MESSAGE.newerFormat };
    }
    if (status === SETTLEMENT_PROFILE_STATUS.unreadable) {
      return { success: false, message: SETTLEMENT_TOOL_MESSAGE.unreadable };
    }
    if (!profile) {
      return { success: true, message: SETTLEMENT_TOOL_MESSAGE.unset };
    }
    const range = rangeOf(args);
    if ('error' in range) {
      return { success: false, message: 'The settlement period is incomplete', error: range.error };
    }
    // Without the server's approvals nobody's consent is known, so nothing is settled.
    const approvals = context.listSettlementApprovals
      ? await context.listSettlementApprovals()
      : [];
    const approved = await approvedSettlementTermsKeys(context.budgetId, profile, approvals);
    const result = context.services.settlement.calculate(
      context.budgetId,
      profile,
      range.startDate,
      range.endDate,
      (terms) => approved.includes(settlementTermsKey(terms))
    );
    const report = settlementReport(result, {
      currency: context.currencySymbol,
      categoryNames: new Map(context.categories.map((category) => [category.ID, category.Name])),
      memberNames: context.memberNames,
    });
    return { success: true, message: describe(report, context.formatCurrency), data: report };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to calculate the household settlement',
      error: getErrorMessage(error),
    };
  }
}
