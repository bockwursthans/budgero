import { DatabaseAdapter } from '../../database/interface.js';
import { allRows } from '../../database/sql.js';
import { asMilli } from '../../money/index.js';
import { NO_SPLITS_FILTER } from '../transactions/queries.js';
import type { SettlementLineTotal } from './types.js';

interface LineTotalRow {
  AccountID: number;
  CategoryID: number;
  Inflow: number | null;
  Outflow: number | null;
}

/** The account ids arrive as one JSON array parameter, however many there are. */
const ACCOUNT_FILTER = 't.AccountID IN (SELECT value FROM json_each(?))';

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
}
