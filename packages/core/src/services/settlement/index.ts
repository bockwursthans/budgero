import { DatabaseAdapter } from '../../database/interface.js';
import { calculateSettlement } from './calculation.js';
import { settlementSegments } from './profile.js';
import { SettlementQueries } from './queries.js';
import type {
  SettlementLineTotal,
  SettlementProfile,
  SettlementResult,
  SettlementTerms,
} from './types.js';

export * from './types.js';
export * from './profile.js';
export * from './consent.js';
export { apportion, calculateSettlement, settlementTransfers } from './calculation.js';

/** Decides whether terms took effect (every participant approved them). */
export type SettlementTermsFilter = (terms: SettlementTerms) => boolean;

const accountIdsOf = (terms: SettlementTerms): number[] => [
  ...new Set(terms.participants.flatMap((participant) => participant.accountIds)),
];

/**
 * SettlementService - income-weighted (or equal / fixed-share) settlement of
 * shared household expenses paid from the participants' personal accounts.
 */
export class SettlementService {
  private queries: SettlementQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new SettlementQueries(db);
  }

  getLineTotals(
    budgetId: number,
    startDate: string,
    endDate: string,
    accountIds: readonly number[]
  ): SettlementLineTotal[] {
    return this.queries.lineTotals(budgetId, startDate, endDate, accountIds);
  }

  /**
   * Settles the inclusive date range with the terms in effect on each day.
   * Parts whose terms `isApproved` refuses are not settled; they are listed
   * as unapproved instead, so nobody is settled on terms they didn't agree to.
   */
  calculate(
    budgetId: number,
    profile: SettlementProfile,
    startDate: string,
    endDate: string,
    isApproved: SettlementTermsFilter
  ): SettlementResult {
    const segments = settlementSegments(profile, startDate, endDate);
    const approved = segments.filter((segment) => isApproved(segment.terms));
    const parts = approved.map((segment) => ({
      segment,
      lines: this.getLineTotals(
        budgetId,
        segment.startDate,
        segment.endDate,
        accountIdsOf(segment.terms)
      ),
    }));
    return {
      ...calculateSettlement(parts, startDate, endDate),
      unapprovedSegments: segments
        .filter((segment) => !approved.includes(segment))
        .map(({ startDate: from, endDate: until, terms }) => ({
          startDate: from,
          endDate: until,
          effectiveFrom: terms.effectiveFrom,
        })),
    };
  }
}
