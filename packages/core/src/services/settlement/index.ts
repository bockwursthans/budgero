import { DatabaseAdapter } from '../../database/interface.js';
import { accountOwners, calculateSettlement, personalCategoryOwners } from './calculation.js';
import { monthKeysBetween, settlementMonthProgress } from './progress.js';
import { asMilli } from '../../money/index.js';
import { SyncedStateService, type SyncedStateScope } from '../synced-state/index.js';
import {
  readSettlementProfile,
  SETTLEMENT_PROFILE_KEY,
  settlementSegments,
  type SettlementProfileReading,
} from './profile.js';
import { SettlementQueries } from './queries.js';
import {
  SETTLEMENT_PROGRESS_STATUS,
  type SettlementLineTotal,
  type SettlementMonthLineTotal,
  type SettlementPersonalItem,
  type SettlementProfile,
  type SettlementProgress,
  type SettlementResult,
  type SettlementTerms,
} from './types.js';

export * from './types.js';
export * from './profile.js';
export * from './consent.js';
export * from './report.js';
export { apportion, calculateSettlement, settlementTransfers } from './calculation.js';
export { monthKeysBetween, nextMonthKey, settlementMonthProgress } from './progress.js';
export type { SettlementCumulativeNets } from './progress.js';

/** The synced state scope a budget's settlement profile is stored in. */
export function settlementProfileScope(budgetId: number): SyncedStateScope {
  return `budget:${budgetId}`;
}

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

  private syncedState: SyncedStateService;

  constructor(private db: DatabaseAdapter) {
    this.queries = new SettlementQueries(db);
    this.syncedState = new SyncedStateService(db);
  }

  /** The budget's stored settlement profile and whether it may be changed. */
  readProfile(budgetId: number): SettlementProfileReading {
    return readSettlementProfile(
      this.syncedState.get(settlementProfileScope(budgetId), SETTLEMENT_PROFILE_KEY)
    );
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
    const parts = approved.map((segment) => {
      const accountIds = accountIdsOf(segment.terms);
      return {
        segment,
        lines: this.getLineTotals(budgetId, segment.startDate, segment.endDate, accountIds),
        payments: this.queries.paymentTotals(
          budgetId,
          segment.startDate,
          segment.endDate,
          accountIds
        ),
      };
    });
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

  /**
   * How far the settlement payments made so far settle the range: each
   * month's status and the personal-category bookings someone else paid.
   * Meant for the open balance, a range that runs up to today.
   */
  progress(
    budgetId: number,
    profile: SettlementProfile,
    startDate: string,
    endDate: string,
    isApproved: SettlementTermsFilter
  ): SettlementProgress {
    return settlementProgressOf(this, this.queries, {
      budgetId,
      profile,
      startDate,
      endDate,
      isApproved,
    });
  }
}

const RUNNING_KEY_SEPARATOR = ':';
const MONTH_KEY_LENGTH = 'YYYY-MM'.length;
const monthKeyOf = (date: string) => date.slice(0, MONTH_KEY_LENGTH);

/** Adds a month's line to the running totals of its account and category. */
function addToRunning(running: Map<string, SettlementLineTotal>, line: SettlementLineTotal) {
  const key = `${line.accountId}${RUNNING_KEY_SEPARATOR}${line.categoryId}`;
  const total = running.get(key);
  running.set(key, {
    accountId: line.accountId,
    categoryId: line.categoryId,
    inflow: asMilli((total?.inflow ?? 0) + line.inflow),
    outflow: asMilli((total?.outflow ?? 0) + line.outflow),
  });
}

/** Lines grouped by their YYYY-MM month. */
function byMonth(lines: readonly SettlementMonthLineTotal[]): Map<string, SettlementLineTotal[]> {
  const grouped = new Map<string, SettlementLineTotal[]>();
  for (const { month, ...line } of lines) {
    const entries = grouped.get(month);
    if (entries) entries.push(line);
    else grouped.set(month, [line]);
  }
  return grouped;
}

/**
 * How far the settlement payments made so far settle a range: each month's
 * status and the personal-category bookings someone else paid. Meant for the
 * open balance, a range that runs up to today (see progress.ts).
 */
function settlementProgressOf(
  service: SettlementService,
  queries: SettlementQueries,
  request: {
    budgetId: number;
    profile: SettlementProfile;
    startDate: string;
    endDate: string;
    isApproved: SettlementTermsFilter;
  }
): SettlementProgress {
  const { budgetId, profile, startDate, endDate, isApproved } = request;
  const segments = settlementSegments(profile, startDate, endDate).filter((segment) =>
    isApproved(segment.terms)
  );
  const monthly = segments.map((segment) => ({
    segment,
    linesByMonth: byMonth(
      queries.monthLineTotals(
        budgetId,
        segment.startDate,
        segment.endDate,
        accountIdsOf(segment.terms)
      )
    ),
  }));
  const bookedMonths = monthly.flatMap(({ linesByMonth }) => [...linesByMonth.keys()]).sort();
  if (bookedMonths.length === 0) return { months: [], personalItems: [] };

  const result = service.calculate(budgetId, profile, startDate, endDate, isApproved);
  const payments = new Map(
    result.participants.map((p) => [p.participantId, p.paymentsSent - p.paymentsReceived])
  );
  // Running totals per part, grown month by month: the nets up to each month's end.
  const running = monthly.map(() => new Map<string, SettlementLineTotal>());
  const cumulative = monthKeysBetween(bookedMonths[0], monthKeyOf(endDate)).map((month) => {
    monthly.forEach(({ linesByMonth }, index) => {
      for (const line of linesByMonth.get(month) ?? []) addToRunning(running[index], line);
    });
    const parts = monthly.flatMap(({ segment }, index) =>
      monthKeyOf(segment.startDate) <= month
        ? [{ segment, lines: [...running[index].values()], payments: [] }]
        : []
    );
    const nets = calculateSettlement(parts, startDate, endDate).participants.map(
      (p) => [p.participantId, p.netSettlement as number] as const
    );
    return { month, nets: new Map(nets) };
  });
  const { months, settledThrough } = settlementMonthProgress(cumulative, payments);

  const statusOf = new Map(months.map((entry) => [entry.month, entry.status]));
  const personalItems = segments.flatMap((segment) => {
    const accountOwner = accountOwners(segment.terms);
    const personalOwner = personalCategoryOwners(segment.terms);
    return queries
      .bookingLines(
        budgetId,
        segment.startDate,
        segment.endDate,
        [...accountOwner.keys()],
        [...personalOwner.keys()]
      )
      .flatMap((line): SettlementPersonalItem[] => {
        const paidById = accountOwner.get(line.accountId);
        const ownerId = personalOwner.get(line.categoryId);
        if (paidById === undefined || ownerId === undefined || paidById === ownerId) return [];
        return [
          {
            transactionId: line.transactionId,
            date: line.date,
            categoryId: line.categoryId,
            payee: line.payee,
            memo: line.memo,
            paidById,
            ownerId,
            amount: asMilli(line.outflow - line.inflow),
            status: statusOf.get(monthKeyOf(line.date)) ?? SETTLEMENT_PROGRESS_STATUS.open,
          },
        ];
      });
  });

  return { months, ...(settledThrough ? { settledThrough } : {}), personalItems };
}
