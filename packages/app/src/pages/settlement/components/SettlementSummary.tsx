import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowRight } from 'lucide-react';
import type { SettlementResult } from '@budgero/core/browser';
import { formatPercent } from '@pages/analytics/format-percent';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent } from '@shared/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { cn } from '@shared/lib/utils';
import { WARNING_MESSAGES } from '../settlement-messages';

interface SettlementSummaryProps {
  result: SettlementResult;
  money: (milli: number) => string;
  /** The signed-in user's id: their row is marked. */
  currentUserId?: string | null;
}

const PERCENT_POINTS = 100;
const SHARE_DECIMALS = 1;

const headClass = 'h-8 text-xs font-medium uppercase tracking-wide text-muted-foreground';
const moneyCell = 'text-right font-mono text-sm tabular-nums';

/** Per participant: income, share, paid, target and net; then who pays whom. */
export function SettlementSummary({ result, money, currentUserId }: SettlementSummaryProps) {
  const { t } = useLingui();
  const nameOf = new Map(result.participants.map((p) => [p.participantId, p.name]));

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
                <Trans>Balance</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.participants.map((participant) => (
              <TableRow key={participant.participantId}>
                <TableCell className="font-medium">
                  {participant.name}
                  {participant.participantId === currentUserId ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      <Trans context="settlement-current-user">(you)</Trans>
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className={moneyCell}>{money(participant.eligibleIncome)}</TableCell>
                <TableCell className={moneyCell}>
                  {formatPercent(participant.contributionShare * PERCENT_POINTS, SHARE_DECIMALS)}
                </TableCell>
                <TableCell className={moneyCell}>{money(participant.sharedExpensesPaid)}</TableCell>
                <TableCell className={moneyCell}>{money(participant.targetContribution)}</TableCell>
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
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-4 pb-4">
          <h3 className="text-sm font-semibold">
            <Trans>To settle up</Trans>
          </h3>
          {result.transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>Everyone has paid their share. Nothing to settle.</Trans>
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
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
