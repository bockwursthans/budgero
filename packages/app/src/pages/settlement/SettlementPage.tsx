import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { Scale } from 'lucide-react';
import { toast } from 'sonner';
import {
  createDefaultSettlementTerms,
  removeSettlementTerms,
  SETTLEMENT_PROFILE_STATUS,
  settlementTermsOn,
  upsertSettlementTerms,
  type SettlementProfile,
  type SettlementTerms,
} from '@budgero/core/browser';
import { useSettlement, useSettlementProfile } from '@entities/settlement/api/useSettlement';
import { useMoneyFormatters } from '@pages/analytics/components/chart-utils';
import { getTodayISO } from '@shared/lib/date-utils';
import { useUiStore } from '@shared/store/useUiStore';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { CenteredLoader } from '@shared/ui/CenteredLoader';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { SettlementPeriodPicker } from './components/SettlementPeriodPicker';
import { SettlementSummary } from './components/SettlementSummary';
import { SettlementTermsDialog } from './components/SettlementTermsDialog';
import { SettlementTermsList } from './components/SettlementTermsList';
import { newSettlementParticipantId } from './settlement-ids';
import {
  defaultChangeDate,
  initialSettlementPeriod,
  resolveSettlementRange,
} from './settlement-period';
import { useSettlementOptions } from './useSettlementOptions';

interface TermsEditor {
  title: string;
  initialTerms: SettlementTerms;
  dated: boolean;
  /** Date of the dated terms being edited (removed when the date changes). */
  replacedEffectiveFrom?: string;
  /** Remounts the dialog so each opening starts from `initialTerms`. */
  version: number;
}

const DEFAULT_PARTICIPANT_COUNT = 2;

/** Start dates of the profile's dated terms, except the ones being edited. */
function takenDates(profile: SettlementProfile | null, editing?: string): string[] {
  return (profile?.terms ?? [])
    .map((terms) => terms.effectiveFrom)
    .filter((date): date is string => date !== undefined && date !== editing);
}

export default function SettlementPage() {
  const { t } = useLingui();
  const budgetId = useUiStore((state) => state.selectedBudget?.ID ?? 0);
  const { amount: money } = useMoneyFormatters();
  const options = useSettlementOptions(budgetId);
  const { profile, status, loaded, canWrite, save } = useSettlementProfile(budgetId);

  const [period, setPeriod] = useState(() => initialSettlementPeriod(getTodayISO()));
  const { startDate, endDate } = resolveSettlementRange(period);
  const settlement = useSettlement(budgetId, profile, startDate, endDate);

  const [editor, setEditor] = useState<TermsEditor | null>(null);
  const [termsToRemove, setTermsToRemove] = useState<SettlementTerms | null>(null);

  const openEditor = (next: Omit<TermsEditor, 'version'>) =>
    setEditor((previous) => ({ ...next, version: (previous?.version ?? 0) + 1 }));

  const openSetup = () =>
    openEditor({
      title: t`Set up household settlement`,
      initialTerms: createDefaultSettlementTerms(
        Array.from({ length: DEFAULT_PARTICIPANT_COUNT }, () => ({
          id: newSettlementParticipantId(),
          name: '',
        })),
        options.incomeCategoryIds
      ),
      dated: false,
    });

  const openAddChange = () => {
    const effectiveFrom = defaultChangeDate(getTodayISO());
    const current = profile ? settlementTermsOn(profile, effectiveFrom) : undefined;
    if (!current) return;
    openEditor({
      title: t`Add a change`,
      initialTerms: { ...current, effectiveFrom },
      dated: true,
    });
  };

  const openEdit = (terms: SettlementTerms) =>
    openEditor({
      title: t`Edit settlement terms`,
      initialTerms: terms,
      dated: terms.effectiveFrom !== undefined,
      replacedEffectiveFrom: terms.effectiveFrom,
    });

  const handleSave = async (terms: SettlementTerms) => {
    const saved = await save(upsertSettlementTerms(profile, terms, editor?.replacedEffectiveFrom));
    if (!saved) {
      toast.error(t`The settlement could not be saved here.`);
      return;
    }
    toast.success(t`Settlement saved`);
    setEditor(null);
  };

  const handleRemove = async () => {
    if (!profile || !termsToRemove?.effectiveFrom) return;
    const saved = await save(removeSettlementTerms(profile, termsToRemove.effectiveFrom));
    if (!saved) toast.error(t`The settlement could not be saved here.`);
    setTermsToRemove(null);
  };

  if (!loaded || options.isLoading) return <CenteredLoader />;

  const renderSettlement = () => {
    if (settlement.data) return <SettlementSummary result={settlement.data} money={money} />;
    if (settlement.isError) {
      return (
        <Alert variant="destructive">
          <AlertDescription>
            <Trans>The settlement could not be calculated. Try again or pick another period.</Trans>
          </AlertDescription>
        </Alert>
      );
    }
    if (settlement.isLoading) return <CenteredLoader />;
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>Pick a period to see the settlement.</Trans>
      </p>
    );
  };

  return (
    <div className="flex flex-col gap-6 p-4 pb-24 md:p-6 md:pb-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scale className="h-6 w-6" aria-hidden />
          <h1 className="text-2xl font-bold">
            <Trans>Household settlement</Trans>
          </h1>
        </div>
        {profile ? <SettlementPeriodPicker period={period} onChange={setPeriod} /> : null}
      </div>

      {status === SETTLEMENT_PROFILE_STATUS.newerFormat ? (
        <Alert>
          <AlertDescription>
            <Trans>
              This settlement was set up with a newer version of Budgero. Update the app to see or
              change it.
            </Trans>
          </AlertDescription>
        </Alert>
      ) : null}

      {status === SETTLEMENT_PROFILE_STATUS.unreadable ? (
        <Alert>
          <AlertDescription>
            <Trans>
              Parts of this settlement could not be read, so it can't be changed here. Update
              Budgero on all devices.
            </Trans>
          </AlertDescription>
        </Alert>
      ) : null}

      {status === SETTLEMENT_PROFILE_STATUS.unset ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Scale className="h-12 w-12 text-muted-foreground" aria-hidden />
            <p className="max-w-md text-muted-foreground">
              <Trans>
                Share household expenses fairly: assign each person their personal accounts, pick
                the shared expense categories, and see each month who owes whom.
              </Trans>
            </p>
            <Button onClick={openSetup} disabled={!canWrite}>
              <Trans>Set up settlement</Trans>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {profile ? (
        <>
          {renderSettlement()}
          <SettlementTermsList
            terms={profile.terms}
            canWrite={canWrite}
            onEdit={openEdit}
            onRemove={setTermsToRemove}
            onAddChange={openAddChange}
          />
        </>
      ) : null}

      {editor ? (
        <SettlementTermsDialog
          key={editor.version}
          open
          onOpenChange={(open) => !open && setEditor(null)}
          title={editor.title}
          initialTerms={editor.initialTerms}
          dated={editor.dated}
          takenEffectiveDates={takenDates(profile, editor.replacedEffectiveFrom)}
          accountGroups={options.accountGroups}
          categoryGroups={options.categoryGroups}
          onSave={handleSave}
        />
      ) : null}

      <ConfirmDialog
        open={termsToRemove !== null}
        onOpenChange={(open) => !open && setTermsToRemove(null)}
        title={t`Remove this change?`}
        description={
          <Trans>
            The period it covered is then settled with the terms before it. Transactions are not
            touched.
          </Trans>
        }
        confirmText={t`Remove`}
        variant="destructive"
        onConfirm={handleRemove}
      />
    </div>
  );
}
