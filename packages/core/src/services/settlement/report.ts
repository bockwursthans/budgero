/**
 * The settlement as plain data for readers outside the app's UI: the chat
 * assistant's tool, and any local API that serves it (the headless client
 * discussed in #155). Amounts are decimal currency units, names resolved,
 * ids kept so callers can link back.
 *
 * Pure functions, no DB or UI dependencies.
 */

import { toDecimal, type MilliUnits } from '../../money/index.js';
import type { SettlementCategoryAmount, SettlementResult } from './types.js';

export interface SettlementReportCategory {
  categoryId: number;
  category: string;
  amount: number;
}

export interface SettlementReportParticipant {
  userId: string;
  name: string;
  eligibleIncome: number;
  /** Part of the shared expenses carried, in percent points. */
  sharePercent: number;
  sharedExpensesPaid: number;
  fairShare: number;
  paymentsSent: number;
  paymentsReceived: number;
  /** Paid in other participants' personal categories: owed back in full. */
  paidForOthers: number;
  /** Others paid in this participant's personal categories: owed to them in full. */
  paidByOthers: number;
  /** Positive: gets money back; negative: owes; zero: settled. */
  balance: number;
  sharedExpensesByCategory: SettlementReportCategory[];
  incomeByCategory: SettlementReportCategory[];
  paidForOthersByCategory: SettlementReportCategory[];
  paidByOthersByCategory: SettlementReportCategory[];
}

export interface SettlementReport {
  startDate: string;
  endDate: string;
  currency: string;
  totalSharedExpenses: number;
  totalEligibleIncome: number;
  participants: SettlementReportParticipant[];
  /** Payments that settle the range. */
  toSettleUp: { from: string; to: string; amount: number }[];
  /** Parts of the range left out until every participant agreed to their terms. */
  awaitingConsent: { startDate: string; endDate: string }[];
  warnings: string[];
}

export interface SettlementReportContext {
  /** ISO code of the budget currency the amounts are in. */
  currency: string;
  categoryNames: ReadonlyMap<number, string>;
  /** Current member names by user id (the saved ones are used otherwise). */
  memberNames?: ReadonlyMap<string, string>;
}

const PERCENT_POINTS = 100;
/** Share percentages keep one decimal. */
const SHARE_ROUNDING = 10;
const UNKNOWN_CATEGORY = '';

const amount = (milli: MilliUnits): number => toDecimal(milli);

function categories(
  amounts: readonly SettlementCategoryAmount[],
  names: ReadonlyMap<number, string>
): SettlementReportCategory[] {
  return amounts.map((entry) => ({
    categoryId: entry.categoryId,
    category: names.get(entry.categoryId) ?? UNKNOWN_CATEGORY,
    amount: amount(entry.amount),
  }));
}

/** The settlement result as a self-describing report. */
export function settlementReport(
  result: SettlementResult,
  { currency, categoryNames, memberNames }: SettlementReportContext
): SettlementReport {
  const savedNames = new Map(result.participants.map((p) => [p.participantId, p.name]));
  const displayName = (id: string) => memberNames?.get(id) ?? savedNames.get(id) ?? id;
  return {
    startDate: result.startDate,
    endDate: result.endDate,
    currency,
    totalSharedExpenses: amount(result.totalSharedExpenses),
    totalEligibleIncome: amount(result.totalEligibleIncome),
    participants: result.participants.map((participant) => ({
      userId: participant.participantId,
      name: displayName(participant.participantId),
      eligibleIncome: amount(participant.eligibleIncome),
      sharePercent:
        Math.round(participant.contributionShare * PERCENT_POINTS * SHARE_ROUNDING) /
        SHARE_ROUNDING,
      sharedExpensesPaid: amount(participant.sharedExpensesPaid),
      fairShare: amount(participant.targetContribution),
      paymentsSent: amount(participant.paymentsSent),
      paymentsReceived: amount(participant.paymentsReceived),
      paidForOthers: amount(participant.paidForOthers),
      paidByOthers: amount(participant.paidByOthers),
      balance: amount(participant.netSettlement),
      sharedExpensesByCategory: categories(participant.sharedExpensesByCategory, categoryNames),
      incomeByCategory: categories(participant.incomeByCategory, categoryNames),
      paidForOthersByCategory: categories(participant.paidForOthersByCategory, categoryNames),
      paidByOthersByCategory: categories(participant.paidByOthersByCategory, categoryNames),
    })),
    toSettleUp: result.transfers.map((transfer) => ({
      from: displayName(transfer.fromParticipantId),
      to: displayName(transfer.toParticipantId),
      amount: amount(transfer.amount),
    })),
    awaitingConsent: result.unapprovedSegments.map(({ startDate, endDate }) => ({
      startDate,
      endDate,
    })),
    warnings: [...result.warnings],
  };
}
