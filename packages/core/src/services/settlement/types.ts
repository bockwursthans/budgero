import type { MilliUnits } from '../../money/index.js';

/** How the shared expenses of a period are divided between the participants. */
export const SETTLEMENT_STRATEGY = {
  /** In proportion to each participant's eligible income in the period. */
  incomeWeighted: 'income-weighted',
  /** In equal parts. */
  equal: 'equal',
  /** By a fixed share per participant. */
  custom: 'custom',
} as const;

export type SettlementStrategy = (typeof SETTLEMENT_STRATEGY)[keyof typeof SETTLEMENT_STRATEGY];

export const SETTLEMENT_STRATEGIES: readonly SettlementStrategy[] =
  Object.values(SETTLEMENT_STRATEGY);

export interface SettlementParticipant {
  /** Stable id, kept across terms so the results of one person add up. */
  id: string;
  name: string;
  /** Personal accounts: what is paid from or earned into them counts for this participant. */
  accountIds: number[];
  /** Fixed share in basis points (10 000 = 100 %), used by the custom strategy only. */
  customShareBasisPoints: number;
}

/** The settlement rules in effect from one date on. */
export interface SettlementTerms {
  /** YYYY-MM-DD the terms apply from; absent on the initial terms. */
  effectiveFrom?: string;
  strategy: SettlementStrategy;
  participants: SettlementParticipant[];
  /** Categories whose net inflow counts as a participant's income. */
  incomeCategoryIds: number[];
  /** Categories whose net outflow counts as a shared household expense. */
  expenseCategoryIds: number[];
}

/** A budget's settlement setup, stored as synced budget state. */
export interface SettlementProfile {
  formatVersion: number;
  /** Ordered by effectiveFrom; only the first terms have none. */
  terms: SettlementTerms[];
}

/** Net amounts of one account in one category over a period, in budget currency. */
export interface SettlementLineTotal {
  accountId: number;
  categoryId: number;
  inflow: MilliUnits;
  outflow: MilliUnits;
}

/** The part of a date range one set of terms applies to (both dates inclusive). */
export interface SettlementSegment {
  terms: SettlementTerms;
  startDate: string;
  endDate: string;
}

export interface SettlementSegmentTotals {
  segment: SettlementSegment;
  lines: readonly SettlementLineTotal[];
}

export interface SettlementParticipantResult {
  participantId: string;
  name: string;
  eligibleIncome: MilliUnits;
  sharedExpensesPaid: MilliUnits;
  targetContribution: MilliUnits;
  /** Paid minus target: positive means money back, negative means owed. */
  netSettlement: MilliUnits;
  /** Part of all shared expenses this participant carries (0 to 1). */
  contributionShare: number;
}

/** A suggested payment that settles the period. */
export interface SettlementTransfer {
  fromParticipantId: string;
  toParticipantId: string;
  amount: MilliUnits;
}

export const SETTLEMENT_WARNING = {
  /** Income-weighted terms found no income in some part of the range: split equally there. */
  noIncomeSplitEqually: 'no-income-split-equally',
  /** Fixed-share terms where every share is zero: split equally. */
  noSharesSplitEqually: 'no-shares-split-equally',
} as const;

export type SettlementWarning = (typeof SETTLEMENT_WARNING)[keyof typeof SETTLEMENT_WARNING];

export interface SettlementResult {
  startDate: string;
  endDate: string;
  totalSharedExpenses: MilliUnits;
  totalEligibleIncome: MilliUnits;
  participants: SettlementParticipantResult[];
  transfers: SettlementTransfer[];
  /** The terms used, one entry per part of the range they cover. */
  segments: {
    startDate: string;
    endDate: string;
    effectiveFrom?: string;
    strategy: SettlementStrategy;
  }[];
  warnings: SettlementWarning[];
}
