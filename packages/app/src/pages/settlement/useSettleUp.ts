import { useLingui } from '@lingui/react/macro';
import {
  isAccountOnBudget,
  resolveTransferPayees,
  type Account,
  type MilliUnits,
} from '@budgero/core/browser';
import { useAddLabel } from '@entities/label/api/label-directory';
import { useLabels } from '@entities/label/api/useLabels';
import { useAddTransfer } from '@entities/transaction/api/mutations';
import {
  formatTransferMemo,
  generateTransferId,
  resolveTransferCategoryIds,
} from '@features/transactions/ui/add-transaction/add-transaction.utils';
import type { SettleUpLine } from './settle-up';

/** Colour of the label settlement payments get (teal, like the settlement's charts). */
export const SETTLEMENT_LABEL_COLOR = '#14b8a6';

export interface SettleUpRequest {
  fromAccount: Account;
  toAccount: Account;
  /** YYYY-MM-DD */
  date: string;
  lines: readonly SettleUpLine[];
  /** Mark the transfers with the "Household settlement" label (created when missing). */
  labelled: boolean;
}

/**
 * Records settlement payments as plain transfers between two participants'
 * personal accounts, one per line: exactly what the settlement counts as a
 * payment, so the open balance goes down by their amounts.
 */
export function useSettleUp(budgetId: number, transfersCategoryId: number | null) {
  const { t } = useLingui();
  const addTransfer = useAddTransfer();
  const addLabel = useAddLabel();
  const { byName } = useLabels(budgetId);

  const settlementLabelId = async (): Promise<number> => {
    const name = t`Household settlement`;
    const existing = byName.get(name.toLowerCase());
    if (existing) return existing.ID;
    return addLabel.mutateAsync({ budgetId, name, color: SETTLEMENT_LABEL_COLOR });
  };

  const settleUp = async ({ fromAccount, toAccount, date, lines, labelled }: SettleUpRequest) => {
    const labelId = labelled ? await settlementLabelId() : null;
    const { sourceCategoryId, destinationCategoryId } = resolveTransferCategoryIds({
      sourceOnBudget: isAccountOnBudget(fromAccount),
      destinationOnBudget: isAccountOnBudget(toAccount),
      selectedCategoryId: null,
      transfersCategoryId,
    });
    const { sourcePayee, destinationPayee } = resolveTransferPayees(fromAccount, toAccount);
    const leg = (accountId: number, categoryId: number, payee: string | null) => ({
      accountId,
      categoryId,
      labelId,
      date,
      payee: payee ?? '',
    });
    for (const line of lines) {
      const amount: MilliUnits = line.amount;
      const memo = formatTransferMemo({
        fromAccountName: fromAccount.Name,
        toAccountName: toAccount.Name,
        memo: line.memo,
        amount,
        convertedAmount: amount,
        fromCurrency: fromAccount.Currency,
        toCurrency: toAccount.Currency,
        needsConversion: false,
      });
      await addTransfer.mutateAsync({
        budgetId,
        transferId: generateTransferId(),
        source: {
          ...leg(fromAccount.ID, sourceCategoryId, sourcePayee),
          inflow: 0,
          outflow: amount,
          memo,
        },
        destination: {
          ...leg(toAccount.ID, destinationCategoryId, destinationPayee),
          inflow: amount,
          outflow: 0,
          memo,
        },
      });
    }
  };

  return { settleUp, isPending: addTransfer.isPending || addLabel.isPending };
}
