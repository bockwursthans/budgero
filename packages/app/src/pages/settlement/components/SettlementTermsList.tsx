import { Trans, useLingui } from '@lingui/react/macro';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { SettlementTerms } from '@budgero/core/browser';
import { formatShortDate, parseDateKey } from '@shared/lib/date-utils';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { STRATEGY_LABELS } from '../settlement-messages';

interface SettlementTermsListProps {
  terms: readonly SettlementTerms[];
  canWrite: boolean;
  onEdit: (terms: SettlementTerms) => void;
  onRemove: (terms: SettlementTerms) => void;
  onAddChange: () => void;
}

/** The profile's terms in date order, each editable; dated ones removable. */
export function SettlementTermsList({
  terms,
  canWrite,
  onEdit,
  onRemove,
  onAddChange,
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
        <ul className="flex flex-col divide-y">
          {terms.map((entry) => (
            <li
              key={entry.effectiveFrom ?? ''}
              className="flex flex-wrap items-center gap-2 py-2 text-sm"
            >
              <span className="font-medium">{startLabel(entry)}</span>
              <span className="text-muted-foreground">{t(STRATEGY_LABELS[entry.strategy])}</span>
              <span className="text-muted-foreground">
                {entry.participants.map((participant) => participant.name).join(', ')}
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
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
