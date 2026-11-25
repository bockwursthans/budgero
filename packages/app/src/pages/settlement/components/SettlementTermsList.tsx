import { Trans, useLingui } from '@lingui/react/macro';
import { Check, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  settlementTermsKey,
  type SettlementTerms,
  type SettlementTermsConsent,
} from '@budgero/core/browser';
import { formatShortDate, parseDateKey } from '@shared/lib/date-utils';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { STRATEGY_LABELS } from '../settlement-messages';

interface SettlementTermsListProps {
  terms: readonly SettlementTerms[];
  canWrite: boolean;
  /** Consent per terms key; terms without an entry show no consent yet (still loading). */
  consent: ReadonlyMap<string, SettlementTermsConsent>;
  currentUserId: string | null;
  /** Current display names by user id (falls back to the saved name). */
  memberNames: ReadonlyMap<string, string>;
  approvalBusy: boolean;
  onEdit: (terms: SettlementTerms) => void;
  onRemove: (terms: SettlementTerms) => void;
  onAddChange: () => void;
  onApprove: (consent: SettlementTermsConsent) => void;
  onRevoke: (consent: SettlementTermsConsent) => void;
}

/** The profile's terms in date order with everyone's consent; dated ones removable. */
export function SettlementTermsList({
  terms,
  canWrite,
  consent,
  currentUserId,
  memberNames,
  approvalBusy,
  onEdit,
  onRemove,
  onAddChange,
  onApprove,
  onRevoke,
}: SettlementTermsListProps) {
  const { t } = useLingui();

  const startLabel = (entry: SettlementTerms) => {
    const date = entry.effectiveFrom ? parseDateKey(entry.effectiveFrom) : null;
    return date ? t`From ${formatShortDate(date)}` : t`From the start`;
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            <Trans>Settlement terms</Trans>
          </h3>
          <Button variant="outline" size="sm" onClick={onAddChange} disabled={!canWrite}>
            <Plus className="mr-1 h-4 w-4" />
            <Trans>Add change</Trans>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <Trans>
            Terms take effect only when everyone taking part has agreed to them from their own
            login. Any change needs everyone's consent again.
          </Trans>
        </p>
        <ul className="flex flex-col divide-y">
          {terms.map((entry) => {
            const entryConsent = consent.get(settlementTermsKey(entry));
            const isParticipant = entry.participants.some((p) => p.id === currentUserId);
            const hasApproved =
              currentUserId !== null && entryConsent?.approvedBy.includes(currentUserId);
            return (
              <li key={settlementTermsKey(entry)} className="flex flex-col gap-2 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{startLabel(entry)}</span>
                  <span className="text-muted-foreground">
                    {t(STRATEGY_LABELS[entry.strategy])}
                  </span>
                  <span className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(entry)}
                      disabled={!canWrite}
                      aria-label={t`Edit terms`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {entry.effectiveFrom ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(entry)}
                        disabled={!canWrite}
                        aria-label={t`Remove change`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </span>
                </div>
                <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label={t`Consent`}>
                  {entry.participants.map((participant) => {
                    const name = memberNames.get(participant.id) ?? participant.name;
                    const approved = entryConsent?.approvedBy.includes(participant.id);
                    return (
                      <li key={participant.id} className="flex items-center gap-1">
                        {approved ? (
                          <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                        )}
                        <span>{name}</span>
                        <span className="sr-only">
                          {approved ? t`has agreed` : t`has not agreed yet`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {entryConsent && isParticipant ? (
                  <div>
                    {hasApproved ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={approvalBusy}
                        onClick={() => onRevoke(entryConsent)}
                      >
                        <Trans>Withdraw my consent</Trans>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={approvalBusy}
                        onClick={() => onApprove(entryConsent)}
                      >
                        <Trans>I agree to these terms</Trans>
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
