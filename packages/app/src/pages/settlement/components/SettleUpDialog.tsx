import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useId, useState } from 'react';
import { parseISO } from 'date-fns';
import { Trash2 } from 'lucide-react';
import type {
  Account,
  MilliUnits,
  SettlementPersonalItem,
  SettlementTransfer,
} from '@budgero/core/browser';
import { asMilli } from '@shared/lib/currency/milli';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import {
  canSettlePerItem,
  recordableLines,
  SETTLE_UP_MODE,
  settleUpLines,
  totalOf,
  type SettleUpLine,
  type SettleUpMode,
} from '../settle-up';
import type { SettleUpRequest } from '../useSettleUp';

interface SettleUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transfer: SettlementTransfer;
  /** Display names by participant id. */
  names: ReadonlyMap<string, string>;
  /** The payer's and the receiver's personal accounts. */
  fromAccounts: readonly Account[];
  toAccounts: readonly Account[];
  /** Personal items the payer still owes the receiver (see itemsToSettle). */
  items: readonly SettlementPersonalItem[];
  categoryName: (id: number) => string;
  money: (milli: number) => string;
  /** The budget currency: the settlement's amounts are in it. */
  currency: string;
  localizer: Intl.NumberFormat;
  /** YYYY-MM-DD the payment is dated by default. */
  today: string;
  busy: boolean;
  onSubmit: (request: SettleUpRequest) => Promise<void>;
}

const accountIdOf = (accounts: readonly Account[]) => (accounts[0] ? String(accounts[0].ID) : '');

/** Records a suggested settlement payment as one or more transfers. */
export function SettleUpDialog({
  open,
  onOpenChange,
  transfer,
  names,
  fromAccounts,
  toAccounts,
  items,
  categoryName,
  money,
  currency,
  localizer,
  today,
  busy,
  onSubmit,
}: SettleUpDialogProps) {
  const { t, i18n } = useLingui();
  const fieldId = useId();
  const dateFormat = new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium' });
  const memos = {
    all: t`Household settlement`,
    rest: t`Shared expenses`,
    item: (item: SettlementPersonalItem) => {
      const category = categoryName(item.categoryId);
      const date = dateFormat.format(parseISO(item.date));
      return t`Settles ${category} of ${date}`;
    },
  };

  const [fromAccountId, setFromAccountId] = useState(() => accountIdOf(fromAccounts));
  const [toAccountId, setToAccountId] = useState(() => accountIdOf(toAccounts));
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<SettleUpMode>(SETTLE_UP_MODE.single);
  const [lines, setLines] = useState<SettleUpLine[]>(() =>
    settleUpLines(transfer, items, SETTLE_UP_MODE.single, memos)
  );
  const [labelled, setLabelled] = useState(true);

  const fromAccount = fromAccounts.find((account) => String(account.ID) === fromAccountId);
  const toAccount = toAccounts.find((account) => String(account.ID) === toAccountId);
  const perItemPossible = canSettlePerItem(transfer, items);
  const recordable = recordableLines(lines);
  const total = totalOf(recordable.map((line) => line.amount));
  const left = asMilli(transfer.amount - total);
  const otherCurrency =
    (fromAccount && fromAccount.Currency !== currency) ||
    (toAccount && toAccount.Currency !== currency);
  const canSave =
    Boolean(fromAccount && toAccount) && !otherCurrency && recordable.length > 0 && date !== '';

  const changeMode = (next: SettleUpMode) => {
    setMode(next);
    setLines(settleUpLines(transfer, items, next, memos));
  };
  const updateLine = (key: string, change: Partial<SettleUpLine>) =>
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...change } : line))
    );
  const removeLine = (key: string) =>
    setLines((previous) => previous.filter((line) => line.key !== key));

  const submit = async () => {
    if (!fromAccount || !toAccount || !canSave) return;
    await onSubmit({ fromAccount, toAccount, date, lines: recordable, labelled });
  };

  const from = names.get(transfer.fromParticipantId) ?? '';
  const to = names.get(transfer.toParticipantId) ?? '';
  const amount = money(transfer.amount);
  const totalText = money(total);
  const difference = money(Math.abs(left));
  const accountSelect = (
    id: string,
    label: string,
    accounts: readonly Account[],
    value: string,
    onChange: (value: string) => void
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={t`Pick an account`} />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.ID} value={String(account.ID)}>
              {account.Name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>Settle up</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              {from} pays {to} {amount}. It is recorded as transfers between your personal accounts,
              so the open balance goes down by what you enter here.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {fromAccounts.length === 0 || toAccounts.length === 0 ? (
            <Alert>
              <AlertDescription>
                <Trans>
                  Both need a personal account in the settlement terms to record the payment.
                </Trans>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            {accountSelect(
              `${fieldId}-from`,
              t`From`,
              fromAccounts,
              fromAccountId,
              setFromAccountId
            )}
            {accountSelect(`${fieldId}-to`, t`To`, toAccounts, toAccountId, setToAccountId)}
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-date`} className="text-xs text-muted-foreground">
                <Trans>Date</Trans>
              </Label>
              <Input
                id={`${fieldId}-date`}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>

          {otherCurrency ? (
            <Alert>
              <AlertDescription>
                <Trans>
                  One of the accounts is in another currency. Record this payment in the transaction
                  dialog, where the exchange rate can be set.
                </Trans>
              </AlertDescription>
            </Alert>
          ) : null}

          {items.length > 0 ? (
            <RadioGroup
              value={mode}
              onValueChange={(value) => changeMode(value as SettleUpMode)}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id={`${fieldId}-single`} value={SETTLE_UP_MODE.single} />
                <Label htmlFor={`${fieldId}-single`}>
                  <Trans>One transfer for everything</Trans>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  id={`${fieldId}-per-item`}
                  value={SETTLE_UP_MODE.perItem}
                  disabled={!perItemPossible}
                />
                <Label htmlFor={`${fieldId}-per-item`}>
                  <Trans>One transfer per item paid for {from}, then one for the rest</Trans>
                </Label>
              </div>
              {perItemPossible ? null : (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    The items add up to more than the payment, because other amounts offset them.
                    Record one transfer.
                  </Trans>
                </p>
              )}
            </RadioGroup>
          ) : null}

          <ul className="flex flex-col gap-2" aria-label={t`Transfers to record`}>
            {lines.map((line, index) => (
              <li key={line.key} className="flex items-center gap-2">
                <Input
                  aria-label={t`Memo`}
                  value={line.memo}
                  onChange={(event) => updateLine(line.key, { memo: event.target.value })}
                  className="flex-1"
                />
                <div className="w-36">
                  <CalculatorCell
                    value={line.amount}
                    onCommit={(value: MilliUnits) => updateLine(line.key, { amount: value })}
                    currencyCode={currency}
                    formatter={localizer.format}
                    localizer={localizer}
                    inputAlign="right"
                    useFormatterForDisplay
                    displayClassName="h-9 flex items-center justify-end rounded-md border border-input bg-background px-3 text-sm"
                    inputClassName="h-9"
                    data-testid={`settle-up-amount-${index}`}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeLine(line.key)}
                  disabled={lines.length === 1}
                  aria-label={t`Remove transfer`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>
              <Trans>
                Total: <span className="font-mono tabular-nums">{totalText}</span>
              </Trans>
            </span>
            <span className="text-muted-foreground">
              {left > 0 ? (
                <Trans>Still open afterwards: {difference}</Trans>
              ) : left < 0 ? (
                <Trans>More than the open balance by {difference}</Trans>
              ) : (
                <Trans>Settles the open balance</Trans>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id={`${fieldId}-label`}
              checked={labelled}
              onCheckedChange={(checked) => setLabelled(checked === true)}
            />
            <Label htmlFor={`${fieldId}-label`}>
              <Trans>Mark the transfers with the label "Household settlement"</Trans>
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={!canSave || busy}>
              <Plural
                value={recordable.length}
                one="Record # transfer"
                other="Record # transfers"
              />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
