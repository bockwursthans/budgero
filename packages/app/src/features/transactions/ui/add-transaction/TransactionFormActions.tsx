'use client';

import { Trans, useLingui } from '@lingui/react/macro';

/**
 * Transaction Form Actions
 *
 * Form action buttons: Cancel, Quick Add, and Submit.
 */

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { DialogFooter } from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { getKeyboardShortcutLabels } from '@shared/lib/keyboard-shortcuts';
import { formatNativeAmount } from '@entities/currency/lib/currency-utils';
import { TYPE_SHORTCUT_DIGITS } from '@features/transactions/lib/quick-entry-shortcuts';
import type { SavedTransactionSummary } from './useAddTransactionForm';

interface TransactionFormActionsProps {
  onCancel: () => void;
  onQuickAdd: () => void;
  isCalculatingTransfer: boolean;
  isTransfer: boolean;
  isInflow: boolean;
  isOutflow: boolean;
  recurringMode?: 'create' | 'edit' | null;
  isSubmitting?: boolean;
  /** The last transaction saved with "add another", confirmed below the buttons. */
  lastSaved?: SavedTransactionSummary | null;
  currencyCode?: string;
}

export const TransactionFormActions = React.memo(function TransactionFormActions({
  onCancel,
  onQuickAdd,
  isCalculatingTransfer,
  isTransfer,
  isInflow,
  isOutflow,
  recurringMode = null,
  isSubmitting = false,
  lastSaved = null,
  currencyCode = '',
}: TransactionFormActionsProps) {
  const { t, i18n } = useLingui();
  const shortcuts = getKeyboardShortcutLabels();
  const saveShortcut = shortcuts.mod('Enter');
  const saveAnotherShortcut = shortcuts.modShift('Enter');
  const typeShortcut = shortcuts.alt(Object.values(TYPE_SHORTCUT_DIGITS).join('/'));
  const savedSummary = lastSaved
    ? [
        formatNativeAmount(lastSaved.amount, currencyCode),
        lastSaved.category,
        lastSaved.payee,
        lastSaved.date
          ? new Intl.DateTimeFormat(i18n.locale, { day: 'numeric', month: 'short' }).format(
              lastSaved.date
            )
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const submitButtonClassName = React.useMemo(() => {
    const base =
      'h-auto min-h-9 min-w-0 whitespace-normal px-3 py-2 leading-tight transition-colors';
    if (isInflow) {
      return `${base} bg-success hover:bg-success/90 text-white`;
    }
    if (isOutflow) {
      return `${base} bg-destructive hover:bg-destructive/90 text-white`;
    }
    return base;
  }, [isInflow, isOutflow]);

  const submitButtonLabel = React.useMemo(() => {
    if (isCalculatingTransfer || isSubmitting) {
      return (
        <Trans>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Processing...
        </Trans>
      );
    }
    if (recurringMode === 'edit') {
      return t`Save recurring transaction`;
    }
    if (recurringMode === 'create') {
      return t`Create recurring transaction`;
    }
    if (isTransfer) {
      return t`Add Transfer`;
    }
    return isInflow ? t`Add Income` : t`Add Expense`;
  }, [isCalculatingTransfer, isSubmitting, recurringMode, isTransfer, isInflow, t]);

  return (
    <DialogFooter className="mt-4 sm:mt-6 flex min-w-0 flex-col sm:flex-col gap-3">
      <div className={`grid min-w-0 gap-2 ${recurringMode ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {!recurringMode && (
          <Button
            onClick={onQuickAdd}
            disabled={isCalculatingTransfer || isSubmitting}
            variant="outline"
            type="button"
            title={saveAnotherShortcut}
            className="h-auto min-h-9 min-w-0 whitespace-normal px-3 py-2 leading-tight"
          >
            <Trans>Quick Add</Trans>
          </Button>
        )}
        <Button
          disabled={isCalculatingTransfer || isSubmitting}
          type="submit"
          className={submitButtonClassName}
          data-testid="add-transaction-submit"
        >
          {submitButtonLabel}
        </Button>
      </div>
      {savedSummary ? (
        <p className="text-xs text-muted-foreground" role="status" data-testid="last-saved">
          <Trans>Saved: {savedSummary}</Trans>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" type="button" onClick={onCancel} className="h-9 px-3 sm:px-4">
          <Trans>Cancel</Trans>
        </Button>
        <span className="hidden sm:inline-block text-xs text-muted-foreground">
          {recurringMode ? (
            <Trans>Press {saveShortcut} to save</Trans>
          ) : (
            <Trans>
              {saveShortcut} save · {saveAnotherShortcut} save and add another · {typeShortcut}{' '}
              expense, income, transfer
            </Trans>
          )}
        </span>
      </div>
    </DialogFooter>
  );
});
