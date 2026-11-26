import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { parseISO } from 'date-fns';
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import {
  SETTLEMENT_PROGRESS_STATUS,
  type SettlementProgress,
  type SettlementProgressStatus,
} from '@budgero/core/browser';
import { formatMonthLabel } from '@shared/lib/date-utils';
import { cn } from '@shared/lib/utils';
import { Badge } from '@shared/ui/badge';
import { Card, CardContent } from '@shared/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { PROGRESS_STATUS_LABELS } from '../settlement-messages';

interface SettlementProgressCardProps {
  progress: SettlementProgress;
  /** Display names by participant id. */
  names: ReadonlyMap<string, string>;
  categoryName: (id: number) => string;
  money: (milli: number) => string;
}

const STATUS_CLASS: Record<SettlementProgressStatus, string> = {
  [SETTLEMENT_PROGRESS_STATUS.settled]:
    'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  [SETTLEMENT_PROGRESS_STATUS.partly]:
    'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  [SETTLEMENT_PROGRESS_STATUS.open]: '',
};

const headClass = 'h-8 text-xs font-medium uppercase tracking-wide text-muted-foreground';

function StatusBadge({ status }: { status: SettlementProgressStatus }) {
  const { t } = useLingui();
  return (
    <Badge variant="outline" className={cn(STATUS_CLASS[status])}>
      {t(PROGRESS_STATUS_LABELS[status])}
    </Badge>
  );
}

/**
 * How far the payments made so far reach back: settled through which month,
 * each month's status, and the personal categories paid by someone else.
 */
export function SettlementProgressCard({
  progress,
  names,
  categoryName,
  money,
}: SettlementProgressCardProps) {
  const { t, i18n } = useLingui();
  const [showMonths, setShowMonths] = useState(false);
  const dateFormat = new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium' });
  const nameOf = (id: string) => names.get(id) ?? id;
  const lastMonth = progress.months.at(-1);
  const partlyMonth = progress.months.find(
    (entry) => entry.status === SETTLEMENT_PROGRESS_STATUS.partly
  );
  const allSettled = lastMonth?.status === SETTLEMENT_PROGRESS_STATUS.settled;
  const newestFirst = [...progress.months].reverse();
  const items = [...progress.personalItems].reverse();

  const summary = () => {
    if (allSettled) return t`Everything is settled.`;
    const settledThrough = progress.settledThrough
      ? formatMonthLabel(progress.settledThrough)
      : null;
    const partly = partlyMonth ? formatMonthLabel(partlyMonth.month) : null;
    if (settledThrough && partly) return t`Settled through ${settledThrough}; ${partly} partly.`;
    if (settledThrough) return t`Settled through ${settledThrough}.`;
    if (partly) return t`Partly settled in ${partly}; nothing settled in full yet.`;
    return t`Nothing settled yet.`;
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            <Trans>Settlement progress</Trans>
          </h3>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            aria-expanded={showMonths}
            aria-controls="settlement-progress-months"
            onClick={() => setShowMonths((shown) => !shown)}
          >
            {showMonths ? (
              <ChevronDown className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
            <Trans>Months</Trans>
          </button>
        </div>
        <p className="text-sm">{summary()}</p>
        <p className="text-xs text-muted-foreground">
          <Trans>
            The balance is settled as a whole: a month counts as settled once the payments made so
            far cover everything owed up to its end.
          </Trans>
        </p>

        {showMonths ? (
          <ul id="settlement-progress-months" className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {newestFirst.map((entry) => (
              <li key={entry.month} className="flex items-center justify-between gap-2 text-sm">
                <span>{formatMonthLabel(entry.month)}</span>
                <StatusBadge status={entry.status} />
              </li>
            ))}
          </ul>
        ) : null}

        {items.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Trans>Paid for each other</Trans>
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={headClass}>
                    <Trans>Date</Trans>
                  </TableHead>
                  <TableHead className={headClass}>
                    <Trans>Category</Trans>
                  </TableHead>
                  <TableHead className={headClass}>
                    <Trans>Paid by</Trans>
                  </TableHead>
                  <TableHead className={headClass}>
                    <Trans>Payee / memo</Trans>
                  </TableHead>
                  <TableHead className={cn(headClass, 'text-right')}>
                    <Trans>Amount</Trans>
                  </TableHead>
                  <TableHead className={headClass}>
                    <Trans>Status</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={`${item.transactionId}-${item.categoryId}-${item.date}`}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {dateFormat.format(parseISO(item.date))}
                    </TableCell>
                    <TableCell className="text-sm">{categoryName(item.categoryId)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <span className="inline-flex items-center gap-1">
                        {nameOf(item.paidById)}
                        <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                        <span className="sr-only">
                          <Trans context="settlement-paid-for">for</Trans>
                        </span>
                        {nameOf(item.ownerId)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-sm text-muted-foreground">
                      {[item.payee, item.memo].filter(Boolean).join(' · ')}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {money(item.amount)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
