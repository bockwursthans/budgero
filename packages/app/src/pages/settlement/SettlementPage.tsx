import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { toast } from 'sonner';
import {
  createDefaultSettlementTerms,
  removeSettlementTerms,
  SETTLEMENT_MAX_PARTICIPANTS,
  SETTLEMENT_MIN_PARTICIPANTS,
  SETTLEMENT_PROFILE_STATUS,
  settlementTermsKey,
  settlementTermsOn,
  upsertSettlementTerms,
  type SettlementProfile,
  type SettlementResult,
  type SettlementTerms,
  type SettlementTermsConsent,
} from '@budgero/core/browser';
import { useSettlement, useSettlementProfile } from '@entities/settlement/api/useSettlement';
import {
  fingerprintOf,
  useSettlementApprovalActions,
  useSettlementConsent,
} from '@entities/settlement/api/useSettlementConsent';
import { useMoneyFormatters } from '@pages/analytics/components/chart-utils';
import { getTodayISO } from '@shared/lib/date-utils';
import { NAV_WORKSPACES } from '@shared/model/nav-registry';
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
import {
  defaultChangeDate,
  initialSettlementPeriod,
  resolveSettlementRange,
} from './settlement-period';
import { useSettlementMembers, type SettlementMember } from './useSettlementMembers';
import { useSettlementOptions } from './useSettlementOptions';

interface TermsEditor {
  title: string;
  initialTerms: SettlementTerms;
  dated: boolean;
  /** Date of the dated terms being edited (removed when the date changes). */
  replacedEffectiveFrom?: string;
  /** Key of the terms being edited, so their old approval can be withdrawn. */
  editingKey?: string;
  /** Remounts the dialog so each opening starts from `initialTerms`. */
  version: number;
}

/** Start dates of the profile's dated terms, except the ones being edited. */
function takenDates(profile: SettlementProfile | null, editing?: string): string[] {
  return (profile?.terms ?? [])
    .map((terms) => terms.effectiveFrom)
    .filter((date): date is string => date !== undefined && date !== editing);
}

/** The result with the members' current names (the saved ones stay for former members). */
function withMemberNames(
  result: SettlementResult,
  members: readonly SettlementMember[]
): SettlementResult {
  const nameOf = new Map(members.map((member) => [member.id, member.name]));
  return {
    ...result,
    participants: result.participants.map((participant) => ({
      ...participant,
      name: nameOf.get(participant.participantId) ?? participant.name,
    })),
  };
}

export default function SettlementPage() {
  const { t } = useLingui();
  const budgetId = useUiStore((state) => state.selectedBudget?.ID ?? 0);
  const { amount: money } = useMoneyFormatters();
  const options = useSettlementOptions(budgetId);
  const membership = useSettlementMembers();
  const { profile, status, loaded, canWrite, save } = useSettlementProfile(budgetId);

  const [period, setPeriod] = useState(() => initialSettlementPeriod(getTodayISO()));
  const { startDate, endDate } = resolveSettlementRange(period);
  const consent = useSettlementConsent(budgetId, profile);
  const { approve, revoke } = useSettlementApprovalActions();
  const settlement = useSettlement(budgetId, profile, startDate, endDate, consent);
  const memberNames = useMemo(
    () => new Map(membership.members.map((member) => [member.id, member.name])),
    [membership.members]
  );
  const result = useMemo(
    () => (settlement.data ? withMemberNames(settlement.data, membership.members) : null),
    [settlement.data, membership.members]
  );

  const [editor, setEditor] = useState<TermsEditor | null>(null);
  const [termsToRemove, setTermsToRemove] = useState<SettlementTerms | null>(null);

  const enoughMembers = membership.members.length >= SETTLEMENT_MIN_PARTICIPANTS;
  // Participants are picked from the member list, so editing waits for it.
  const canEdit = canWrite && !membership.isLoading && !membership.isError;

  const openEditor = (next: Omit<TermsEditor, 'version'>) =>
    setEditor((previous) => ({ ...next, version: (previous?.version ?? 0) + 1 }));

  const openSetup = () =>
    openEditor({
      title: t`Set up household settlement`,
      initialTerms: createDefaultSettlementTerms(
        membership.members.slice(0, SETTLEMENT_MAX_PARTICIPANTS),
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
      editingKey: settlementTermsKey(terms),
    });

  const isMine = (consentOf: SettlementTermsConsent | undefined) =>
    membership.currentUserId !== null &&
    Boolean(consentOf?.approvedBy.includes(membership.currentUserId));

  /** Withdraws the signed-in member's approval of terms that no longer exist as they were. */
  const withdrawStale = async (consentOf: SettlementTermsConsent | undefined) => {
    if (consentOf && isMine(consentOf)) await revoke.mutateAsync(consentOf.fingerprint);
  };

  /**
   * Saving terms you take part in is agreeing to them; the others still have
   * to. Resolves the saved terms' fingerprint (null without a key or terms).
   */
  const approveSaved = async (
    next: SettlementProfile,
    terms: SettlementTerms
  ): Promise<string | null> => {
    const saved = next.terms.find(
      (entry) => settlementTermsKey(entry) === settlementTermsKey(terms)
    );
    if (!saved) return null;
    const fingerprint = await fingerprintOf(budgetId, next, saved);
    const takesPart = saved.participants.some((p) => p.id === membership.currentUserId);
    if (fingerprint && takesPart) await approve.mutateAsync(fingerprint);
    return fingerprint;
  };

  const handleSave = async (terms: SettlementTerms) => {
    const next = upsertSettlementTerms(profile, terms, editor?.replacedEffectiveFrom);
    const previousConsent = editor?.editingKey ? consent.byTerms.get(editor.editingKey) : undefined;
    const saved = await save(next);
    if (!saved) {
      toast.error(t`The settlement could not be saved here.`);
      return;
    }
    setEditor(null);
    try {
      const fingerprint = await approveSaved(next, terms);
      if (previousConsent?.fingerprint !== fingerprint) await withdrawStale(previousConsent);
      toast.success(t`Settlement saved. It takes effect once everyone has agreed.`);
    } catch {
      toast.error(
        t`The terms were saved, but your consent could not be recorded. Try again below.`
      );
    }
  };

  const handleRemove = async () => {
    if (!profile || !termsToRemove?.effectiveFrom) return;
    const removedConsent = consent.byTerms.get(settlementTermsKey(termsToRemove));
    const saved = await save(removeSettlementTerms(profile, termsToRemove.effectiveFrom));
    setTermsToRemove(null);
    if (!saved) {
      toast.error(t`The settlement could not be saved here.`);
      return;
    }
    await withdrawStale(removedConsent).catch(() => undefined);
  };

  const handleApprove = (consentOf: SettlementTermsConsent) =>
    approve.mutate(consentOf.fingerprint, {
      onError: () => toast.error(t`Your consent could not be recorded. Check your connection.`),
    });

  const handleRevoke = (consentOf: SettlementTermsConsent) =>
    revoke.mutate(consentOf.fingerprint, {
      onError: () => toast.error(t`Your consent could not be withdrawn. Check your connection.`),
    });

  if (!loaded || options.isLoading) return <CenteredLoader />;

  const renderSettlement = () => {
    if (result) {
      return (
        <SettlementSummary
          result={result}
          money={money}
          currentUserId={membership.currentUserId}
          categoryNames={options.categoryNames}
        />
      );
    }
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

  const inviteHint = (
    <p className="max-w-md text-sm text-muted-foreground">
      <Trans>
        Everyone taking part needs their own Budgero login in this workspace, so they can enter and
        manage their own transactions. Invite the others first.
      </Trans>{' '}
      <Link to={NAV_WORKSPACES.to} className="underline underline-offset-4">
        {t(NAV_WORKSPACES.label)}
      </Link>
    </p>
  );

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

      {membership.isError ? (
        <Alert>
          <AlertDescription>
            <Trans>
              The members of this workspace could not be loaded, so the setup can't be changed right
              now. Check your connection.
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
                Share household expenses fairly: pick who takes part, assign each person their
                personal accounts and the shared expense categories, and see each month who owes
                whom.
              </Trans>
            </p>
            {enoughMembers || membership.isLoading ? null : inviteHint}
            <Button onClick={openSetup} disabled={!canEdit || !enoughMembers}>
              <Trans>Set up settlement</Trans>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {profile ? (
        <>
          {consent.isError ? (
            <Alert>
              <AlertDescription>
                <Trans>
                  The consents could not be loaded, so the settlement can't be shown right now.
                  Check your connection.
                </Trans>
              </AlertDescription>
            </Alert>
          ) : null}
          {result && result.unapprovedSegments.length > 0 ? (
            <Alert>
              <AlertDescription>
                <Trans>
                  Not everyone has agreed to the terms for all of this period yet. Those parts are
                  left out until everyone taking part has agreed.
                </Trans>
              </AlertDescription>
            </Alert>
          ) : null}
          {renderSettlement()}
          <SettlementTermsList
            terms={profile.terms}
            canWrite={canEdit}
            consent={consent.byTerms}
            currentUserId={membership.currentUserId}
            memberNames={memberNames}
            approvalBusy={approve.isPending || revoke.isPending}
            onEdit={openEdit}
            onRemove={setTermsToRemove}
            onAddChange={openAddChange}
            onApprove={handleApprove}
            onRevoke={handleRevoke}
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
          members={membership.members}
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
