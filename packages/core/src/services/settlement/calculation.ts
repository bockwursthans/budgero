/**
 * Settlement arithmetic: what each participant earned and paid for the
 * household in a period, what they should have paid, and who pays whom to
 * even it out.
 *
 * For each part of the range (one set of terms):
 *
 *   share_i  = weight_i / sum(weights)       weight: income, 1, or fixed share
 *   target_i = totalSharedExpenses * share_i
 *   net_i    = paid_i - target_i             > 0: money back, < 0: owes
 *
 * Targets are apportioned exactly in milliunits (largest remainder), so they
 * always add up to the total and the nets to zero. The parts are then summed
 * per participant.
 *
 * Pure functions, no DB or UI dependencies.
 */

import { asMilli, roundToCents } from '../../money/index.js';
import {
  SETTLEMENT_STRATEGY,
  SETTLEMENT_WARNING,
  type SettlementCategoryAmount,
  type SettlementLineTotal,
  type SettlementParticipantResult,
  type SettlementResult,
  type SettlementSegmentTotals,
  type SettlementTerms,
  type SettlementTransfer,
  type SettlementWarning,
} from './types.js';

interface ParticipantTotals {
  name: string;
  eligibleIncome: number;
  sharedExpensesPaid: number;
  targetContribution: number;
  incomeByCategory: Map<number, number>;
  paidByCategory: Map<number, number>;
}

const addTo = (amounts: Map<number, number>, categoryId: number, amount: number) =>
  amounts.set(categoryId, (amounts.get(categoryId) ?? 0) + amount);

const sumOf = (amounts: ReadonlyMap<number, number>) =>
  [...amounts.values()].reduce((sum, amount) => sum + amount, 0);

/** Category amounts, largest first (category id on a tie), without zeros. */
function byCategory(amounts: ReadonlyMap<number, number>): SettlementCategoryAmount[] {
  return [...amounts]
    .filter(([, amount]) => amount !== 0)
    .sort(([idA, a], [idB, b]) => b - a || idA - idB)
    .map(([categoryId, amount]) => ({ categoryId, amount: asMilli(amount) }));
}

/**
 * Divides `total` in proportion to `weights` so the parts add up to it
 * exactly: each part is rounded down, then the leftover units go to the
 * largest remainders (earlier index first on a tie). All-zero weights give
 * all-zero parts. BigInt keeps total × weight exact for any amount.
 */
export function apportion(total: number, weights: readonly bigint[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weightSum === 0n) return weights.map(() => 0);
  const sign = total < 0 ? -1n : 1n;
  const magnitude = BigInt(Math.abs(total));
  const parts = weights.map((weight) => (magnitude * weight) / weightSum);
  let leftover = magnitude - parts.reduce((sum, part) => sum + part, 0n);
  const byRemainder = weights
    .map((weight, index) => ({ index, remainder: (magnitude * weight) % weightSum }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
    );
  for (const { index } of byRemainder) {
    if (leftover === 0n) break;
    parts[index] += 1n;
    leftover -= 1n;
  }
  return parts.map((part) => Number(part * sign));
}

function participantTotalsOf(terms: SettlementTerms, lines: readonly SettlementLineTotal[]) {
  const ownerOf = new Map<number, string>();
  for (const participant of terms.participants) {
    for (const accountId of participant.accountIds) {
      if (!ownerOf.has(accountId)) ownerOf.set(accountId, participant.id);
    }
  }
  const incomeCategories = new Set(terms.incomeCategoryIds);
  const expenseCategories = new Set(terms.expenseCategoryIds);
  const income = new Map<string, Map<number, number>>();
  const paid = new Map<string, Map<number, number>>();
  const amountsOf = (byOwner: Map<string, Map<number, number>>, owner: string) => {
    let amounts = byOwner.get(owner);
    if (!amounts) byOwner.set(owner, (amounts = new Map()));
    return amounts;
  };
  for (const line of lines) {
    const owner = ownerOf.get(line.accountId);
    if (owner === undefined) continue;
    if (incomeCategories.has(line.categoryId)) {
      addTo(amountsOf(income, owner), line.categoryId, line.inflow - line.outflow);
    }
    if (expenseCategories.has(line.categoryId)) {
      addTo(amountsOf(paid, owner), line.categoryId, line.outflow - line.inflow);
    }
  }
  return terms.participants.map((participant) => {
    const incomeByCategory = income.get(participant.id) ?? new Map<number, number>();
    const paidByCategory = paid.get(participant.id) ?? new Map<number, number>();
    return {
      participant,
      incomeByCategory,
      paidByCategory,
      income: sumOf(incomeByCategory),
      paid: sumOf(paidByCategory),
    };
  });
}

function weightsFor(
  terms: SettlementTerms,
  incomes: readonly number[]
): { weights: bigint[]; warning?: SettlementWarning } {
  const equal = () => terms.participants.map(() => 1n);
  switch (terms.strategy) {
    case SETTLEMENT_STRATEGY.incomeWeighted: {
      // Negative income (more refunded than earned) can't carry a negative share.
      const weights = incomes.map((income) => BigInt(Math.max(0, income)));
      return weights.some((weight) => weight > 0n)
        ? { weights }
        : { weights: equal(), warning: SETTLEMENT_WARNING.noIncomeSplitEqually };
    }
    case SETTLEMENT_STRATEGY.custom: {
      const weights = terms.participants.map((p) => BigInt(p.customShareBasisPoints));
      return weights.some((weight) => weight > 0n)
        ? { weights }
        : { weights: equal(), warning: SETTLEMENT_WARNING.noSharesSplitEqually };
    }
    case SETTLEMENT_STRATEGY.equal:
      return { weights: equal() };
  }
}

/**
 * Suggested payments that settle all nets: the largest debtor pays the
 * largest creditor until one is even, then the next (at most n - 1 payments).
 * Payments are whole cents; what rounds to nothing is left out.
 */
export function settlementTransfers(
  participants: readonly Pick<SettlementParticipantResult, 'participantId' | 'netSettlement'>[]
): SettlementTransfer[] {
  const byAmount = (a: { amount: number; id: string }, b: { amount: number; id: string }) =>
    b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const creditors = participants
    .filter((p) => p.netSettlement > 0)
    .map((p) => ({ id: p.participantId, amount: p.netSettlement as number }))
    .sort(byAmount);
  const debtors = participants
    .filter((p) => p.netSettlement < 0)
    .map((p) => ({ id: p.participantId, amount: -(p.netSettlement as number) }))
    .sort(byAmount);
  const transfers: SettlementTransfer[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = Math.min(creditor.amount, debtor.amount);
    const payment = roundToCents(asMilli(amount));
    if (payment > 0) {
      transfers.push({
        fromParticipantId: debtor.id,
        toParticipantId: creditor.id,
        amount: payment,
      });
    }
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditorIndex += 1;
    if (debtor.amount === 0) debtorIndex += 1;
  }
  return transfers;
}

/** Settles a range from its parts' totals (parts in date order). */
export function calculateSettlement(
  parts: readonly SettlementSegmentTotals[],
  startDate: string,
  endDate: string
): SettlementResult {
  const totals = new Map<string, ParticipantTotals>();
  const warnings = new Set<SettlementWarning>();

  for (const { segment, lines } of parts) {
    const rows = participantTotalsOf(segment.terms, lines);
    const sharedTotal = rows.reduce((sum, row) => sum + row.paid, 0);
    const { weights, warning } = weightsFor(
      segment.terms,
      rows.map((row) => row.income)
    );
    if (warning && sharedTotal !== 0) warnings.add(warning);
    const targets = apportion(sharedTotal, weights);
    rows.forEach(({ participant, income, paid, incomeByCategory, paidByCategory }, index) => {
      const entry = totals.get(participant.id) ?? {
        name: participant.name,
        eligibleIncome: 0,
        sharedExpensesPaid: 0,
        targetContribution: 0,
        incomeByCategory: new Map<number, number>(),
        paidByCategory: new Map<number, number>(),
      };
      // Parts come in date order: the latest name wins.
      entry.name = participant.name;
      entry.eligibleIncome += income;
      entry.sharedExpensesPaid += paid;
      entry.targetContribution += targets[index];
      for (const [categoryId, amount] of incomeByCategory) {
        addTo(entry.incomeByCategory, categoryId, amount);
      }
      for (const [categoryId, amount] of paidByCategory) {
        addTo(entry.paidByCategory, categoryId, amount);
      }
      totals.set(participant.id, entry);
    });
  }

  const totalSharedExpenses = [...totals.values()].reduce(
    (sum, entry) => sum + entry.sharedExpensesPaid,
    0
  );
  const totalEligibleIncome = [...totals.values()].reduce(
    (sum, entry) => sum + entry.eligibleIncome,
    0
  );
  const participants: SettlementParticipantResult[] = [...totals].map(([id, entry]) => ({
    participantId: id,
    name: entry.name,
    eligibleIncome: asMilli(entry.eligibleIncome),
    sharedExpensesPaid: asMilli(entry.sharedExpensesPaid),
    targetContribution: asMilli(entry.targetContribution),
    netSettlement: asMilli(entry.sharedExpensesPaid - entry.targetContribution),
    contributionShare:
      totalSharedExpenses === 0 ? 0 : entry.targetContribution / totalSharedExpenses,
    incomeByCategory: byCategory(entry.incomeByCategory),
    sharedExpensesByCategory: byCategory(entry.paidByCategory),
  }));

  return {
    startDate,
    endDate,
    totalSharedExpenses: asMilli(totalSharedExpenses),
    totalEligibleIncome: asMilli(totalEligibleIncome),
    participants,
    transfers: settlementTransfers(participants),
    segments: parts.map(({ segment }) => ({
      startDate: segment.startDate,
      endDate: segment.endDate,
      effectiveFrom: segment.terms.effectiveFrom,
      strategy: segment.terms.strategy,
    })),
    unapprovedSegments: [],
    warnings: [...warnings],
  };
}
