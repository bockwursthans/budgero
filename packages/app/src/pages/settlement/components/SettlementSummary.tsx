import { Trans, useLingui } from '@lingui/react/macro';
import { Fragment, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import type {
  SettlementCategoryAmount,
  SettlementResult,
  SettlementTransfer,
} from '@budgero/core/browser';
import { formatPercent } from '@pages/analytics/format-percent';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { cn } from '@shared/lib/utils';
import { WARNING_MESSAGES } from '../settlement-messages';

interface SettlementSummaryProps {
  result: SettlementResult;
  money: (milli: number) => string;
  /** The signed-in user's id: their row is marked. */
  currentUserId?: string | null;
  /** Category names by id, for the per-category details. */
  categoryNames: ReadonlyMap<number, string>;
  /** Records a suggested payment; without it the payments are only listed. */
  onSettleUp?: (transfer: SettlementTransfer) => void;
}

const PERCENT_POINTS = 100;
const SHARE_DECIMALS = 1;
/** Columns of the table without the personal one; the detail row spans them all. */
const BASE_COLUMN_COUNT = 7;

const headClass = 'h-8 text-xs font-medium uppercase tracking-wide text-muted-foreground';
const moneyCell = 'text-right font-mono text-sm tabular-nums';

/** Per participant: income, share, paid, target and net; then who pays whom. */
export function SettlementSummary({
  result,
  money,
  currentUserId,
  categoryNames,
  onSettleUp,
}: SettlementSummaryProps) {
  const { t } = useLingui();
  const nameOf = new Map(result.participants.map((p) => [p.participantId, p.name]));
  // Without any agreed part, "nothing to settle" would read as "everyone is even".
  const nothingAgreed = result.segments.length === 0 && result.unapprovedSegments.length > 0;
  // Personal categories paid by someone else: shown only when there are any.
  const showPersonal = result.participants.some(
    (p) => p.paidForOthers !== 0 || p.paidByOthers !== 0
  );
  const columnCount = BASE_COLUMN_COUNT + (showPersonal ? 1 : 0);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpenIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const categoryName = (id: number) => categoryNames.get(id) ?? t`Deleted category`;

  return (
    <div className="flex flex-col gap-4">
      {result.warnings.map((warning) => (
        <Alert key={warning}>
          <AlertDescription>{t(WARNING_MESSAGES[warning])}</AlertDescription>
        </Alert>
      ))}

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-bold tabular-nums">{money(result.totalSharedExpenses)}</p>
            <p className="text-sm text-muted-foreground">
              <Trans>Shared expenses</Trans>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-bold tabular-nums">{money(result.totalEligibleIncome)}</p>
            <p className="text-sm text-muted-foreground">
              <Trans>Eligible income</Trans>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-lg p-0 shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={headClass}>
                <Trans>Participant</Trans>
              </TableHead>
              <TableHead className={cn(headClass, 'text-right')}>
                <Trans>Income</Trans>
              </TableHead>
              <TableHead className={cn(headClass, 'text-right')}>
                <Trans>Share</Trans>
              </TableHead>
              <TableHead className={cn(headClass, 'text-right')}>
                <Trans>Paid</Trans>
              </TableHead>
              <TableHead className={cn(headClass, 'text-right')}>
                <Trans>Fair share</Trans>
              </TableHead>
              <TableHead className={cn(headClass, 'text-right')}>
                <Trans>Settlement payments</Trans>
              </TableHead>
              {showPersonal ? (
                <TableHead className={cn(headClass, 'text-right')}>
                  <Trans>Paid for each other</Trans>
                </TableHead>
              ) : null}
              <TableHead className={cn(headClass, 'text-right')}>
                <Trans>Balance</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.participants.map((participant) => {
              const open = openIds.has(participant.participantId);
              const detailsId = `settlement-details-${participant.participantId}`;
              return (
                <Fragment key={participant.participantId}>
                  <TableRow>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-left"
                        aria-expanded={open}
                        aria-controls={detailsId}
                        onClick={() => toggle(participant.participantId)}
                      >
                        {open ? (
                          <ChevronDown className="h-4 w-4" aria-hidden />
                        ) : (
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        )}
                        {participant.name}
                      </button>
                      {participant.participantId === currentUserId ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          <Trans context="settlement-current-user">(you)</Trans>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className={moneyCell}>{money(participant.eligibleIncome)}</TableCell>
                    <TableCell className={moneyCell}>
                      {formatPercent(
                        participant.contributionShare * PERCENT_POINTS,
                        SHARE_DECIMALS
                      )}
                    </TableCell>
                    <TableCell className={moneyCell}>
                      {money(participant.sharedExpensesPaid)}
                    </TableCell>
                    <TableCell className={moneyCell}>
                      {money(participant.targetContribution)}
                    </TableCell>
                    <TableCell className={moneyCell}>
                      {money(participant.paymentsSent - participant.paymentsReceived)}
                    </TableCell>
                    {showPersonal ? (
                      <TableCell className={moneyCell}>
                        {money(participant.paidForOthers - participant.paidByOthers)}
                      </TableCell>
                    ) : null}
                    <TableCell
                      className={cn(
                        moneyCell,
                        participant.netSettlement > 0 && 'text-emerald-600 dark:text-emerald-400',
                        participant.netSettlement < 0 && 'text-destructive'
                      )}
                    >
                      {money(participant.netSettlement)}
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <TableRow id={detailsId}>
                      <TableCell colSpan={columnCount} className="bg-muted/40">
                        <div className="grid gap-4 py-1 sm:grid-cols-2">
                          <CategoryAmounts
                            title={t`Shared expenses paid`}
                            amounts={participant.sharedExpensesByCategory}
                            categoryName={categoryName}
                            money={money}
                          />
                          <CategoryAmounts
                            title={t`Eligible income`}
                            amounts={participant.incomeByCategory}
                            categoryName={categoryName}
                            money={money}
                          />
                          {showPersonal ? (
                            <>
                              <CategoryAmounts
                                title={t`Paid for others (back in full)`}
                                amounts={participant.paidForOthersByCategory}
                                categoryName={categoryName}
                                money={money}
                              />
                              <CategoryAmounts
                                title={t`Paid by others (owed in full)`}
                                amounts={participant.paidByOthersByCategory}
                                categoryName={categoryName}
                                money={money}
                              />
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-4 pb-4">
          <h3 className="text-sm font-semibold">
            <Trans>To settle up</Trans>
          </h3>
          <p className="text-xs text-muted-foreground">
            <Trans>
              Record the payment as a transfer between your personal accounts. It counts as a
              settlement payment, so the open balance goes back to zero.
            </Trans>
          </p>
          {result.transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {nothingAgreed ? (
                <Trans>Nothing to settle until everyone taking part has agreed to the terms.</Trans>
              ) : (
                <Trans>Everyone has paid their share. Nothing to settle.</Trans>
              )}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {result.transfers.map((transfer) => (
                <li
                  key={`${transfer.fromParticipantId}-${transfer.toParticipantId}`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="font-medium">{nameOf.get(transfer.fromParticipantId)}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="sr-only">
                    <Trans context="settlement-transfer">pays</Trans>
                  </span>
                  <span className="font-medium">{nameOf.get(transfer.toParticipantId)}</span>
                  <span className="ml-auto font-mono tabular-nums">{money(transfer.amount)}</span>
                  {onSettleUp ? (
                    <Button size="sm" variant="outline" onClick={() => onSettleUp(transfer)}>
                      <Trans>Settle up</Trans>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface CategoryAmountsProps {
  title: string;
  amounts: readonly SettlementCategoryAmount[];
  categoryName: (id: number) => string;
  money: (milli: number) => string;
}

/** What a participant's total is made of, category by category. */
function CategoryAmounts({ title, amounts, categoryName, money }: CategoryAmountsProps) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      {amounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Nothing in this period.</Trans>
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-sm">
          {amounts.map((entry) => (
            <li key={entry.categoryId} className="flex justify-between gap-4">
              <span>{categoryName(entry.categoryId)}</span>
              <span className="font-mono tabular-nums">{money(entry.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
