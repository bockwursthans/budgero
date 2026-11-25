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
export { apportion, calculateSettlement, settlementTransfers } from './calculation.js';

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

  /** Settles the inclusive date range with the profile's terms in effect on each day. */
  calculate(
    budgetId: number,
    profile: SettlementProfile,
    startDate: string,
    endDate: string
  ): SettlementResult {
    const parts = settlementSegments(profile, startDate, endDate).map((segment) => ({
      segment,
      lines: this.getLineTotals(
        budgetId,
        segment.startDate,
        segment.endDate,
        accountIdsOf(segment.terms)
      ),
    }));
    return calculateSettlement(parts, startDate, endDate);
  }
}
