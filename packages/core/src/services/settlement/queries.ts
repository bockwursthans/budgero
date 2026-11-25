import { DatabaseAdapter } from '../../database/interface.js';
import { allRows } from '../../database/sql.js';
import { asMilli } from '../../money/index.js';
import { NO_SPLITS_FILTER } from '../transactions/queries.js';
import type { SettlementLineTotal, SettlementPaymentTotal } from './types.js';

interface LineTotalRow {
  AccountID: number;
  CategoryID: number;
  Inflow: number | null;
  Outflow: number | null;
}

/** The account ids arrive as one JSON array parameter, however many there are. */
const ACCOUNT_FILTER = 't.AccountID IN (SELECT value FROM json_each(?))';

/** System group of the plain transfer category (budgets/index.ts insertSystemCategories). */
const TRANSFERS_GROUP_NAME = 'Transfers';
/** Mirror rows of a split's transfer lines share one id per parent (splits/split-service.ts). */
const SPLIT_TRANSFER_ID_GLOB = 'split_transfer_*';

/** Whether a transfer leg is a plain transfer: no spending or income category on it. */
const plainTransferLeg = (alias: string) => `
    (${alias}.CategoryID IS NULL OR ${alias}.CategoryID IN (
      SELECT c.ID FROM categories c JOIN category_groups g ON g.ID = c.CategoryGroupID
      WHERE g.BudgetID = ${alias}.BudgetID AND g.Name = '${TRANSFERS_GROUP_NAME}'))`;

const LINE_TOTALS_SQL = `
  WITH lines AS (
    SELECT t.AccountID AS AccountID, s.CategoryID AS CategoryID,
           s.InflowConverted AS Inflow, s.OutflowConverted AS Outflow
    FROM transaction_splits s
    JOIN transactions t ON t.ID = s.TransactionID
    WHERE t.BudgetID = ? AND DATE(t.Date) >= DATE(?) AND DATE(t.Date) <= DATE(?)
      AND ${ACCOUNT_FILTER} AND s.CategoryID IS NOT NULL
    UNION ALL
    SELECT t.AccountID AS AccountID, t.CategoryID AS CategoryID,
           t.InflowConverted AS Inflow, t.OutflowConverted AS Outflow
    FROM transactions t
    WHERE t.BudgetID = ? AND DATE(t.Date) >= DATE(?) AND DATE(t.Date) <= DATE(?)
      AND ${ACCOUNT_FILTER} AND t.CategoryID IS NOT NULL
      ${NO_SPLITS_FILTER}
  )
  SELECT AccountID, CategoryID, SUM(Inflow) AS Inflow, SUM(Outflow) AS Outflow
  FROM lines
  GROUP BY AccountID, CategoryID
`;

/**
 * Transfers whose sending leg is in one of the accounts and whose receiving
 * leg is in another of them, summed per account pair (sender's budget-currency
 * amount; the receiving leg of a cross-currency transfer may differ slightly).
 *
 * Only plain transfers count: a transfer that carries a spending or income
 * category on either leg (possible to and from tracking accounts) is already
 * settled through that category, and would otherwise count twice. Mirror rows
 * of split transfer lines are left out too: all mirrors of one split share an
 * id, so pairing them would invent payments between the mirrors.
 */
const PAYMENT_TOTALS_SQL = `
  SELECT t.AccountID AS FromAccountID, p.AccountID AS ToAccountID,
         SUM(t.OutflowConverted - t.InflowConverted) AS Amount
  FROM transactions t
  JOIN transactions p ON p.TransferID = t.TransferID AND p.ID != t.ID
  WHERE t.BudgetID = ? AND DATE(t.Date) >= DATE(?) AND DATE(t.Date) <= DATE(?)
    AND t.TransferID IS NOT NULL AND t.TransferID != '' AND t.OutflowConverted > 0
    AND t.TransferID NOT GLOB '${SPLIT_TRANSFER_ID_GLOB}'
    AND ${ACCOUNT_FILTER}
    AND p.AccountID IN (SELECT value FROM json_each(?))
    AND ${plainTransferLeg('t')} AND ${plainTransferLeg('p')}
  GROUP BY t.AccountID, p.AccountID
`;

interface PaymentTotalRow {
  FromAccountID: number;
  ToAccountID: number;
  Amount: number | null;
}

/**
 * SettlementQueries - SQL for the household settlement.
 */
export class SettlementQueries {
  constructor(private db: DatabaseAdapter) {}

  /**
   * Budget-currency inflow and outflow per account and category, posted
   * between both dates (inclusive). Split transactions count by their lines,
   * so each line lands in its own category. Scheduled recurring occurrences
   * are not included: only what was actually paid or earned settles.
   */
  lineTotals(
    budgetId: number,
    startDate: string,
    endDate: string,
    accountIds: readonly number[]
  ): SettlementLineTotal[] {
    if (accountIds.length === 0) return [];
    const params = [budgetId, startDate, endDate, JSON.stringify(accountIds)];
    return allRows<LineTotalRow>(this.db, LINE_TOTALS_SQL, ...params, ...params).map((row) => ({
      accountId: row.AccountID,
      categoryId: row.CategoryID,
      inflow: asMilli(row.Inflow ?? 0),
      outflow: asMilli(row.Outflow ?? 0),
    }));
  }

  /** Money transferred from one of the accounts to another one, per account pair. */
  paymentTotals(
    budgetId: number,
    startDate: string,
    endDate: string,
    accountIds: readonly number[]
  ): SettlementPaymentTotal[] {
    if (accountIds.length === 0) return [];
    const accounts = JSON.stringify(accountIds);
    return allRows<PaymentTotalRow>(
      this.db,
      PAYMENT_TOTALS_SQL,
      budgetId,
      startDate,
      endDate,
      accounts,
      accounts
    ).map((row) => ({
      fromAccountId: row.FromAccountID,
      toAccountId: row.ToAccountID,
      amount: asMilli(row.Amount ?? 0),
    }));
  }
}
