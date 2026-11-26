'use client';

import { Trans, useLingui } from '@lingui/react/macro';

/**
 * Add Transaction Form
 *
 * Main shell component that composes the transaction form from sub-components.
 * Uses useAddTransactionForm hook for state management.
 */

import * as React from 'react';
import { toast } from 'sonner';

import { ManualRatePrompt } from '@features/currencies/ui/ManualRatePrompt';
import { saveManualRate } from '@entities/currency/lib/currency-utils';
import { toastError } from '@shared/lib/errors';
import { recurringErrorMessage } from '@entities/recurring/lib/error-message';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { Card, CardContent } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { DialogHeader, DialogTitle, DialogDescription } from '@shared/ui/dialog';
import { AddAccountDialog } from '@features/account-management/ui/AddAccountDialog';
import type { AddTransferRequest } from '@features/transactions/api/useAddTransactionHandler';
import type { AddTransferResult } from '@entities/transaction/api/useTransactions';
import { useCreateRecurringTransaction } from '@entities/recurring/api/useRecurringTransactions';
import { resolveCategoryId } from '@features/transactions/lib/category-selection';
import {
  AMOUNT_SIGN_TYPES,
  typeForShortcutCode,
} from '@features/transactions/lib/quick-entry-shortcuts';
import { ENTER_COMMITS_FIELD_SELECTOR } from '@shared/lib/focus-navigation';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import type { AddTransactionEscapeHandler } from './useAddTransactionDialogEscape';
import { getCurrentDate, TRANSACTION_FIELD, type TransactionField } from './add-transaction.utils';

import { TransactionFormHeader } from './TransactionFormHeader';
import { TransactionDetailsSection } from './TransactionDetailsSection';
import { TransactionSplitSection } from './TransactionSplitSection';
import { TransactionFormActions } from './TransactionFormActions';
import { DuplicateTransactionHint } from '../form/DuplicateTransactionHint';
import { RecurringOptionsSection } from './RecurringOptionsSection';
import {
  useAddTransactionForm,
  type SavedTransactionSummary,
  type UseAddTransactionFormOptions,
} from './useAddTransactionForm';
import {
  buildRecurringSchedule,
  createRecurringFormSettings,
  isRecurringEndConditionValid,
  recurringInitialSplitLines,
  recurringInitialToTransactionValues,
  type RecurringFormSettings,
  type RecurringTransactionFormInitialValues,
  type RecurringTransactionFormSubmit,
} from './recurring-form';

export interface AddTransactionRecurringOptions {
  initialEnabled?: boolean;
  locked?: boolean;
  mode?: 'create' | 'edit';
  initialValues?: RecurringTransactionFormInitialValues;
  onSubmit?: (values: RecurringTransactionFormSubmit) => Promise<void> | void;
  isSubmitting?: boolean;
}

export interface AddTransactionFormProps {
  budgetId: number;
  selectedAccountId?: number;
  onAddTransaction: UseAddTransactionFormOptions['onAddTransaction'];
  onAddTransfer: (request: AddTransferRequest) => Promise<AddTransferResult>;
  onCancel: () => void;
  recurring?: AddTransactionRecurringOptions;
  /**
   * The dialog's Escape: the form fills it in so Escape first ends editing
   * the amount, and asks before throwing a started transaction away (see
   * useAddTransactionDialogEscape).
   */
  registerEscapeHandler?: (handler: AddTransactionEscapeHandler | null) => void;
}

/** Roles that act on Enter themselves (a picker opens, a tab or switch toggles). */
const ENTER_ACTIVATED_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'option',
  'radio',
  'switch',
  'tab',
]);
const ENTER_ACTIVATED_TAGS = new Set(['a', 'button', 'textarea']);
const AMOUNT_FIELD_SELECTOR = '[data-testid="transaction-amount-input"]';

/** Where focus goes when a required field is missing. */
const FIELD_SELECTORS: Record<TransactionField, string> = {
  [TRANSACTION_FIELD.fromAccount]: '[data-testid="transaction-from-account-select"]',
  [TRANSACTION_FIELD.toAccount]: '[data-testid="transaction-to-account-select"]',
  [TRANSACTION_FIELD.category]: '[data-testid="transaction-category-field"] [role="combobox"]',
};

export function AddTransactionForm(props: AddTransactionFormProps) {
  const spaceId = useActiveSpaceId();
  // Reset all form, split, and autofill state when its owning budget changes.
  return <BudgetTransactionForm key={JSON.stringify([spaceId, props.budgetId])} {...props} />;
}

function BudgetTransactionForm({
  budgetId,
  selectedAccountId,
  onAddTransaction,
  onAddTransfer,
  onCancel,
  recurring,
  registerEscapeHandler,
}: AddTransactionFormProps) {
  const { t } = useLingui();
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const [lastSaved, setLastSaved] = React.useState<SavedTransactionSummary | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  /** A save asked for while the amount was being typed: it waits for the amount (add another?). */
  const pendingSubmit = React.useRef<boolean | null>(null);

  const focusField = React.useCallback((field: TransactionField) => {
    formRef.current?.querySelector<HTMLElement>(FIELD_SELECTORS[field])?.focus();
  }, []);

  const createRecurring = useCreateRecurringTransaction();
  const [recurringEnabled, setRecurringEnabled] = React.useState(
    recurring?.initialEnabled ?? false
  );
  const [recurringSettings, setRecurringSettings] = React.useState<RecurringFormSettings>(() =>
    createRecurringFormSettings(recurring?.initialValues)
  );
  const recurringLocked = recurring?.locked ?? false;
  const recurringMode = recurringEnabled ? (recurring?.mode ?? 'create') : null;
  const recurringInitialValues = React.useMemo(
    () => recurringInitialToTransactionValues(recurring?.initialValues),
    [recurring?.initialValues]
  );
  // Read once: the split editor owns the lines after the first render.
  const [recurringInitialSplits] = React.useState(() =>
    recurringInitialSplitLines(recurring?.initialValues)
  );
  const {
    form,
    isSplit,
    splitLines,
    setSplitLines,
    toggleSplit,
    prepareSplitLines,
    categories,
    categoriesLoading,
    accounts,
    accountsLoading,
    selectedAccount,
    toAccount = null,
    currencyCode,
    needsCurrencyConversion,
    transferInvolvesOffBudget = false,
    parentSigned,
    remaining,
    canUseCurrencyApi,
    selectedBudget,
    globalLocalizer,
    splitLocalizer,
    autofillAppliedFields,
    payeeCategoryApplied,
    payeeCategorySource,
    resolvedRate,
    receivedAmount,
    setReceivedAmount,
    needsBudgetConversion,
    conversionTargetCurrency,
    handleSubmit,
  } = useAddTransactionForm({
    budgetId,
    selectedAccountId,
    onAddTransaction,
    onAddTransfer,
    onCancel,
    initialValues: recurringInitialValues,
    initialSplitLines: recurringInitialSplits,
    disableLastUsed: recurringLocked,
    disableAutofill: recurringLocked,
    disableCurrencyConversion: recurringEnabled,
    onInvalidField: focusField,
    onSavedAnother: setLastSaved,
  });

  const recurringSubmitting = recurring?.isSubmitting ?? createRecurring.isPending;

  const submitRecurring = React.useCallback(async () => {
    if (!form.selectedFromAccount) {
      toast.error(t`Missing account`, { description: t`Please select an account.` });
      return;
    }
    if (form.isTransfer && !form.selectedToAccount) {
      toast.error(t`Missing destination`, {
        description: t`Please select a destination account.`,
      });
      return;
    }
    const split = isSplit && !form.isTransfer;
    if (!form.isTransfer && !split && !form.selectedCategory) {
      toast.error(t`Missing category`, { description: t`Please select a category.` });
      return;
    }
    if (!form.amount || form.amount <= 0) {
      toast.error(t`Missing amount`, { description: t`Please enter an amount greater than zero.` });
      return;
    }
    if (!form.transactionDate) {
      toast.error(t`Missing first occurrence`, {
        description: t`Please select the first occurrence date.`,
      });
      return;
    }
    if (!isRecurringEndConditionValid(recurringSettings)) {
      toast.error(t`Incomplete end condition`, {
        description: t`Choose a valid end date or number of occurrences.`,
      });
      return;
    }
    // The lines carry the categories of a split template.
    const splits = split ? prepareSplitLines({ templateLines: true }) : null;
    if (split && !splits) return;

    const categoryId = resolveCategoryId(
      categories,
      form.selectedCategory,
      form.selectedCategoryId,
      payeeCategorySource?.CategoryID
    );
    const values: RecurringTransactionFormSubmit = {
      name: form.payee.trim() || form.memo.trim() || t`Recurring transaction`,
      memo: form.memo.trim(),
      amount: form.amount,
      direction: form.isInflow ? 'inflow' : 'outflow',
      accountId: Number(form.selectedFromAccount),
      toAccountId: form.isTransfer ? Number(form.selectedToAccount) : null,
      categoryId: (form.isTransfer && !transferInvolvesOffBudget) || splits ? null : categoryId,
      splits,
      schedule: buildRecurringSchedule(form.transactionDate, recurringSettings),
      notifyDaysBefore: Math.max(0, Math.trunc(Number(recurringSettings.notifyDaysBefore) || 0)),
      active: recurringSettings.active,
    };

    if (recurring?.onSubmit) {
      await recurring.onSubmit(values);
      return;
    }

    await createRecurring.mutateAsync({
      budgetId,
      accountId: values.accountId!,
      toAccountId: values.toAccountId,
      categoryId: values.categoryId,
      splits: values.splits,
      name: values.name,
      memo: values.memo,
      amount: values.amount,
      direction: values.direction,
      schedule: values.schedule,
      notifyDaysBefore: values.notifyDaysBefore,
      active: values.active,
    });
    toast.success(t`Recurring transaction created`, {
      description: t`We will remind you when it is almost due.`,
    });
    onCancel();
  }, [
    form,
    isSplit,
    prepareSplitLines,
    recurringSettings,
    categories,
    payeeCategorySource,
    transferInvolvesOffBudget,
    recurring,
    createRecurring,
    budgetId,
    onCancel,
    t,
  ]);

  const submitTransaction = React.useCallback(
    (addAnother: boolean) => {
      if (recurringEnabled) {
        void submitRecurring().catch((error) => {
          toastError(
            t`Failed to save recurring transaction`,
            error,
            t`Please try again.`,
            recurringErrorMessage
          );
        });
        return;
      }
      handleSubmit(addAnother).catch((error) => {
        toastError(t`Failed to add transaction`, error, t`Please try again.`);
      });
    },
    [handleSubmit, recurringEnabled, submitRecurring, t]
  );

  const onFormSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      submitTransaction(false);
    },
    [submitTransaction]
  );

  const onQuickAdd = React.useCallback(() => {
    submitTransaction(true);
  }, [submitTransaction]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLFormElement>) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      // Pickers and the calendar render outside the form: their keys are theirs.
      if (!e.currentTarget.contains(target)) return;
      const mod = e.metaKey || e.ctrlKey;

      // Ctrl+Enter saves, Ctrl+Shift+Enter saves and starts the next one.
      if (e.key === 'Enter' && mod) {
        e.preventDefault();
        if (form.isAmountEditing) {
          // The amount input takes this Enter too; save once it is committed.
          pendingSubmit.current = e.shiftKey;
          return;
        }
        submitTransaction(e.shiftKey);
        return;
      }

      if (e.altKey && !mod && !e.shiftKey) {
        const type = typeForShortcutCode(e.code);
        if (type) {
          e.preventDefault();
          form.setTransactionType(type);
        }
        return;
      }

      // A sign typed first into the empty amount picks income or expense.
      const signType = AMOUNT_SIGN_TYPES[e.key];
      if (
        signType &&
        !mod &&
        target instanceof HTMLInputElement &&
        target.value === '' &&
        target.closest(AMOUNT_FIELD_SELECTOR)
      ) {
        e.preventDefault();
        form.setTransactionType(signType);
        return;
      }

      if (e.key !== 'Enter' || e.shiftKey || e.altKey || mod) return;
      // The amount and the date take their Enter and move on to the next field.
      if (form.isAmountEditing || target.closest(ENTER_COMMITS_FIELD_SELECTOR)) return;
      const role = target.getAttribute('role');
      if (
        ENTER_ACTIVATED_TAGS.has(target.tagName.toLowerCase()) ||
        (role !== null && ENTER_ACTIVATED_ROLES.has(role)) ||
        target.closest('[role="listbox"]')
      ) {
        return;
      }
      e.preventDefault();
      submitTransaction(false);
    },
    [form, submitTransaction]
  );

  // Saves asked for while the amount was being typed, once it is committed.
  React.useEffect(() => {
    if (form.isAmountEditing || pendingSubmit.current === null) return;
    const addAnother = pendingSubmit.current;
    pendingSubmit.current = null;
    submitTransaction(addAnother);
  }, [form.isAmountEditing, submitTransaction]);

  // Escape ends editing the amount first, and asks before dropping what was typed.
  const started = (form.amount ?? 0) > 0 || form.memo.trim() !== '';
  React.useEffect(() => {
    if (!registerEscapeHandler) return;
    registerEscapeHandler((event) => {
      if (form.isAmountEditing) {
        event.preventDefault();
        return;
      }
      if (started) {
        event.preventDefault();
        setConfirmDiscard(true);
      }
    });
    return () => registerEscapeHandler(null);
  }, [registerEscapeHandler, form.isAmountEditing, started]);

  const handleRatePromptConfirm = React.useCallback(
    async (rate: number, base: string, quote: string) => {
      if (selectedBudget) await saveManualRate(base, quote, rate, selectedBudget.ID);
      form.setShowRatePrompt(false);
      if (form.pendingAdd) {
        await onAddTransaction(
          form.pendingAdd.date,
          form.pendingAdd.categoryId,
          form.pendingAdd.memo,
          form.pendingAdd.payee,
          form.pendingAdd.outflow,
          form.pendingAdd.inflow,
          form.pendingAdd.accountId,
          form.pendingAdd.labelId,
          form.pendingAdd.transferId,
          false,
          undefined,
          undefined,
          form.pendingAdd.time
        );
        form.setPendingAdd(null);
        return;
      }
      setTimeout(() => form.setAmount(form.amount), 0);
    },
    [selectedBudget, form, onAddTransaction]
  );

  // No accounts prompt
  if (!accountsLoading && accounts.length === 0) {
    return (
      <div className="min-w-0 max-w-lg w-full mx-auto space-y-4 p-2 sm:p-4">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-lg sm:text-xl font-semibold">
            <Trans>Add an account first</Trans>
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            <Trans>Create an account to start recording transactions.</Trans>
          </DialogDescription>
        </DialogHeader>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-muted-foreground">
              <Trans>You need at least one account before adding transactions.</Trans>
            </p>
            <div className="flex flex-wrap gap-2">
              <AddAccountDialog
                open={form.addAccountOpen}
                onOpenChange={form.setAddAccountOpen}
                onSuccess={(accountId) => {
                  form.setFromAccount(accountId.toString());
                  form.setAddAccountOpen(false);
                }}
                renderTrigger={(open) => (
                  <Button type="button" onClick={open}>
                    <Trans>Create Account</Trans>
                  </Button>
                )}
              />
              <Button type="button" variant="outline" onClick={onCancel}>
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={onFormSubmit}
      onKeyDownCapture={handleKeyDown}
      className="min-w-0 max-w-lg w-full mx-auto px-1 sm:px-0"
      data-testid="add-transaction-form"
    >
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t`Discard this transaction?`}
        description={t`What you typed here is not saved.`}
        confirmText={t`Discard`}
        cancelText={t`Keep editing`}
        variant="destructive"
        onConfirm={onCancel}
      />
      {form.showRatePrompt && form.pendingRatePair && (
        <ManualRatePrompt
          from={form.pendingRatePair.from}
          to={form.pendingRatePair.to}
          budgetId={selectedBudget?.ID}
          rateDate={form.transactionDate ? getCurrentDate(form.transactionDate) : undefined}
          onCancel={() => form.setShowRatePrompt(false)}
          onConfirm={handleRatePromptConfirm}
        />
      )}

      <TransactionFormHeader
        rememberLast={form.rememberLast}
        onRememberLastChange={form.setRememberLast}
        title={
          recurringMode === 'edit'
            ? t`Edit Recurring Transaction`
            : recurringMode === 'create' && recurringLocked
              ? t`New Recurring Transaction`
              : undefined
        }
        description={
          recurringEnabled
            ? t`Fill in the transaction once, then choose when it should repeat.`
            : undefined
        }
        showRememberLast={!recurringLocked}
        recurringEnabled={recurringEnabled}
        onRecurringEnabledChange={setRecurringEnabled}
        recurringLocked={recurringLocked}
      />

      <TransactionDetailsSection
        budgetId={budgetId}
        amount={form.amount}
        amountTouched={form.amountTouched}
        currencyCode={currencyCode}
        transactionType={form.transactionType}
        amountInputNonce={form.amountInputNonce}
        amountFocusSignal={form.amountFocusSignal}
        globalLocalizer={globalLocalizer}
        onAmountCommit={form.setAmount}
        onAmountTouched={() => form.setAmountTouched(true)}
        onAmountEditingChange={form.setAmountEditing}
        onTransactionTypeChange={form.setTransactionType}
        transactionDate={form.transactionDate}
        dateOpen={form.dateOpen}
        onDateOpenChange={form.setDateOpen}
        onDateChange={form.setDate}
        // Recurring templates have no time: each posted occurrence is date-only.
        transactionTime={recurringEnabled ? undefined : form.transactionTime}
        onTimeChange={recurringEnabled ? undefined : form.setTime}
        selectedFromAccount={form.selectedFromAccount}
        selectedToAccount={form.selectedToAccount}
        onFromAccountChange={form.setFromAccount}
        onToAccountChange={form.setToAccount}
        accounts={accounts}
        accountsLoading={accountsLoading}
        isTransfer={form.isTransfer}
        transferInvolvesOffBudget={transferInvolvesOffBudget}
        needsCurrencyConversion={needsCurrencyConversion}
        needsBudgetConversion={needsBudgetConversion}
        conversionTargetCurrency={conversionTargetCurrency}
        convertedAmount={form.convertedAmount}
        isLoadingRate={form.isLoadingRate}
        selectedAccount={selectedAccount}
        toAccount={toAccount}
        canUseCurrencyApi={canUseCurrencyApi}
        exchangeRate={resolvedRate}
        receivedAmount={receivedAmount}
        onReceivedAmountChange={setReceivedAmount}
        showCurrencyConversion={!recurringEnabled}
        payee={form.payee}
        onPayeeChange={form.setPayee}
        selectedLabelId={form.selectedLabelId}
        onLabelChange={form.setLabelId}
        showLabel={!recurringEnabled}
        selectedCategory={form.selectedCategory}
        selectedCategoryId={form.selectedCategoryId}
        onCategoryChange={form.setCategory}
        categories={categories}
        categoriesLoading={categoriesLoading}
        isSplit={isSplit}
        memo={form.memo}
        onMemoChange={form.setMemo}
        autofillAppliedFields={autofillAppliedFields}
        payeeCategoryApplied={payeeCategoryApplied}
        payeeCategorySource={payeeCategorySource}
      />

      <DuplicateTransactionHint
        accountId={form.selectedFromAccount ? Number(form.selectedFromAccount) : null}
        date={form.transactionDate}
        amount={form.amount}
        isInflow={form.isInflow}
        currencyCode={currencyCode}
        enabled={!recurringEnabled && !form.isTransfer}
      />

      <TransactionSplitSection
        budgetId={budgetId}
        isTransfer={form.isTransfer}
        isSplit={isSplit}
        onToggleSplit={toggleSplit}
        splitLines={splitLines}
        onSplitLinesChange={setSplitLines}
        remaining={remaining}
        parentAmount={parentSigned}
        formatter={splitLocalizer}
        transferAccounts={accounts.filter(
          (account) => String(account.ID) !== form.selectedFromAccount && !account.Archived
        )}
        parentAccount={accounts.find((account) => String(account.ID) === form.selectedFromAccount)}
        date={getCurrentDate(form.transactionDate)}
        templateLines={recurringEnabled}
      />

      {recurringEnabled && (
        <RecurringOptionsSection
          firstOccurrence={form.transactionDate}
          settings={recurringSettings}
          onChange={setRecurringSettings}
        />
      )}

      <TransactionFormActions
        onCancel={onCancel}
        onQuickAdd={onQuickAdd}
        isCalculatingTransfer={form.isCalculatingTransfer}
        isTransfer={form.isTransfer}
        isInflow={form.isInflow}
        isOutflow={form.isOutflow}
        recurringMode={recurringMode}
        isSubmitting={recurringSubmitting}
        lastSaved={recurringEnabled ? null : lastSaved}
        currencyCode={currencyCode}
      />
    </form>
  );
}
