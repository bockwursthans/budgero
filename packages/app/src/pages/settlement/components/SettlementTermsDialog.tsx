import { Trans, useLingui } from '@lingui/react/macro';
import { useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  cleanSettlementName,
  SETTLEMENT_FULL_SHARE_BASIS_POINTS,
  SETTLEMENT_MAX_PARTICIPANTS,
  SETTLEMENT_MIN_PARTICIPANTS,
  SETTLEMENT_STRATEGIES,
  SETTLEMENT_STRATEGY,
  validateSettlementTerms,
  type SettlementParticipant,
  type SettlementStrategy,
  type SettlementTerms,
} from '@budgero/core/browser';
import type { MultiSelectFilterGroup } from '@pages/analytics/components/MultiSelectFilterControl';
import { formatPercent } from '@pages/analytics/format-percent';
import { getTodayISO } from '@shared/lib/date-utils';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
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
import MonthPickerPopover from '@shared/ui/MonthPickerPopover';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { defaultChangeDate, monthKeyOf, monthStart } from '../settlement-period';
import {
  STRATEGY_DESCRIPTIONS,
  STRATEGY_LABELS,
  TERMS_ISSUE_MESSAGES,
} from '../settlement-messages';
import type { SettlementMember } from '../useSettlementMembers';
import { SettlementMultiSelect, type SettlementOption } from './SettlementMultiSelect';

const BASIS_POINTS_PER_PERCENT = 100;
const SHARE_INPUT_STEP = '0.01';
const MAX_SHARE_PERCENT = SETTLEMENT_FULL_SHARE_BASIS_POINTS / BASIS_POINTS_PER_PERCENT;

/** Command values of the "none" entries (must be unique within a picker). */
const CLEAR_OPTION_VALUE = {
  incomeCategories: 'settlement-no-income-categories',
  expenseCategories: 'settlement-no-expense-categories',
  accounts: 'settlement-no-accounts',
  personalCategories: 'settlement-no-personal-categories',
} as const;

type OptionGroups = MultiSelectFilterGroup<SettlementOption>[];

interface SettlementTermsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What the form starts from (remount the dialog to start over). */
  initialTerms: SettlementTerms;
  /** Dated terms apply from a month on; the initial terms apply from the start. */
  dated: boolean;
  /** Months other dated terms already start on (YYYY-MM-01). */
  takenEffectiveDates: readonly string[];
  /** Workspace members: the Budgero users that can take part. */
  members: readonly SettlementMember[];
  accountGroups: OptionGroups;
  categoryGroups: OptionGroups;
  onSave: (terms: SettlementTerms) => Promise<void>;
}

function percentText(basisPoints: number): string {
  return String(basisPoints / BASIS_POINTS_PER_PERCENT);
}

function basisPointsFrom(text: string): number | null {
  const percent = Number(text.replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(percent)) return null;
  if (percent < 0 || percent > MAX_SHARE_PERCENT) return null;
  return Math.round(percent * BASIS_POINTS_PER_PERCENT);
}

const asParticipant = (member: SettlementMember): SettlementParticipant => ({
  id: member.id,
  name: member.name,
  accountIds: [],
  customShareBasisPoints: 0,
});

/** Editor for one set of settlement terms: participants, categories, strategy, start date. */
export function SettlementTermsDialog({
  open,
  onOpenChange,
  title,
  initialTerms,
  dated,
  takenEffectiveDates,
  members,
  accountGroups,
  categoryGroups,
  onSave,
}: SettlementTermsDialogProps) {
  const { t } = useLingui();
  const fieldId = useId();
  const [draft, setDraft] = useState<SettlementTerms>(() => ({
    ...initialTerms,
    effectiveFrom: dated
      ? (initialTerms.effectiveFrom ?? defaultChangeDate(getTodayISO()))
      : undefined,
  }));
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(false);

  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const issues = useMemo(
    () => validateSettlementTerms(draft, { otherEffectiveDates: takenEffectiveDates, memberIds }),
    [draft, takenEffectiveDates, memberIds]
  );
  const issueMessages = [...new Set(issues.map((issue) => t(TERMS_ISSUE_MESSAGES[issue.code])))];
  const customShareTotal = draft.participants.reduce(
    (sum, participant) => sum + participant.customShareBasisPoints,
    0
  );
  const chosenIds = new Set(draft.participants.map((participant) => participant.id));
  const unchosenMembers = members.filter((member) => !chosenIds.has(member.id));
  const canAdd =
    unchosenMembers.length > 0 && draft.participants.length < SETTLEMENT_MAX_PARTICIPANTS;

  const update = (patch: Partial<SettlementTerms>) => setDraft((prev) => ({ ...prev, ...patch }));
  const updateParticipant = (id: string, patch: Partial<SettlementParticipant>) =>
    setDraft((prev) => ({
      ...prev,
      participants: prev.participants.map((participant) =>
        participant.id === id ? { ...participant, ...patch } : participant
      ),
    }));
  const addParticipant = () => {
    const [next] = unchosenMembers;
    if (!next) return;
    setDraft((prev) => ({ ...prev, participants: [...prev.participants, asParticipant(next)] }));
  };
  const removeParticipant = (id: string) =>
    setDraft((prev) => ({
      ...prev,
      participants: prev.participants.filter((participant) => participant.id !== id),
    }));

  const handleSave = async () => {
    if (issues.length > 0) {
      setShowIssues(true);
      return;
    }
    const nameOf = new Map(members.map((member) => [member.id, member.name]));
    setSaving(true);
    try {
      await onSave({
        ...draft,
        participants: draft.participants.map(({ personalCategoryIds, ...participant }) => ({
          ...participant,
          // Saved with the member's current name, shown wherever the member list isn't loaded.
          name: cleanSettlementName(nameOf.get(participant.id) ?? participant.name).trim(),
          // Stored only when set, so terms without them sign exactly as before.
          ...(personalCategoryIds?.length ? { personalCategoryIds } : {}),
        })),
      });
    } finally {
      setSaving(false);
    }
  };

  const countLabel = (count: number) => (count === 0 ? t`None selected` : t`${count} selected`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            <Trans>
              Expenses in the shared categories paid from a participant's personal accounts count as
              paid by them. Income is what reaches their personal accounts in the income categories.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2 overflow-y-auto flex-1 min-h-0">
          {dated ? (
            <div className="flex flex-col gap-1">
              <Label className="text-sm font-medium">
                <Trans>Applies from</Trans>
              </Label>
              <div className="rounded-md border px-3 py-1.5">
                <MonthPickerPopover
                  value={monthKeyOf(draft.effectiveFrom ?? defaultChangeDate(getTodayISO()))}
                  onChange={(month) => update({ effectiveFrom: monthStart(month) })}
                  align="start"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Changes start with a month. Earlier months keep being settled with the terms
                  before.
                </Trans>
              </p>
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              <Trans>How are shared expenses split?</Trans>
            </legend>
            <RadioGroup
              value={draft.strategy}
              onValueChange={(value) => update({ strategy: value as SettlementStrategy })}
            >
              {SETTLEMENT_STRATEGIES.map((strategy) => (
                <div key={strategy} className="flex items-start gap-2">
                  <RadioGroupItem
                    id={`${fieldId}-${strategy}`}
                    value={strategy}
                    className="mt-0.5"
                  />
                  <Label htmlFor={`${fieldId}-${strategy}`} className="flex flex-col items-start">
                    <span className="text-sm font-medium">{t(STRATEGY_LABELS[strategy])}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {t(STRATEGY_DESCRIPTIONS[strategy])}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">
              <Trans>Participants</Trans>
            </legend>
            {draft.participants.map((participant) => (
              <ParticipantRow
                key={participant.id}
                participant={participant}
                memberChoices={[
                  ...members.filter((member) => member.id === participant.id),
                  ...unchosenMembers,
                ]}
                showShare={draft.strategy === SETTLEMENT_STRATEGY.custom}
                canRemove={draft.participants.length > SETTLEMENT_MIN_PARTICIPANTS}
                accountGroups={accountGroups}
                categoryGroups={categoryGroups}
                countLabel={countLabel}
                onChange={(patch) => updateParticipant(participant.id, patch)}
                onRemove={() => removeParticipant(participant.id)}
              />
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addParticipant}
                disabled={!canAdd}
              >
                <Plus className="mr-1 h-4 w-4" />
                <Trans>Add participant</Trans>
              </Button>
              {draft.strategy === SETTLEMENT_STRATEGY.custom ? (
                <span className="text-sm text-muted-foreground">
                  <Trans>
                    Total: {formatPercent(customShareTotal / BASIS_POINTS_PER_PERCENT, 2)}
                  </Trans>
                </span>
              ) : null}
            </div>
            {unchosenMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Everyone in this workspace takes part. To add someone, invite them to the
                  workspace first.
                </Trans>
              </p>
            ) : null}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label className="text-sm font-medium">
                <Trans>Income categories</Trans>
              </Label>
              <SettlementMultiSelect
                groups={categoryGroups}
                selectedIds={draft.incomeCategoryIds}
                onChange={(ids) => update({ incomeCategoryIds: ids })}
                buttonLabel={countLabel(draft.incomeCategoryIds.length)}
                searchPlaceholder={t`Search categories…`}
                emptyText={t`No categories found.`}
                clearOptionValue={CLEAR_OPTION_VALUE.incomeCategories}
              />
              <p className="text-xs text-muted-foreground">
                <Trans>Sets each participant's share when splitting by income.</Trans>
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-sm font-medium">
                <Trans>Shared expense categories</Trans>
              </Label>
              <SettlementMultiSelect
                groups={categoryGroups}
                selectedIds={draft.expenseCategoryIds}
                onChange={(ids) => update({ expenseCategoryIds: ids })}
                buttonLabel={countLabel(draft.expenseCategoryIds.length)}
                searchPlaceholder={t`Search categories…`}
                emptyText={t`No categories found.`}
                clearOptionValue={CLEAR_OPTION_VALUE.expenseCategories}
              />
              <p className="text-xs text-muted-foreground">
                <Trans>Only these expenses are shared; everything else stays personal.</Trans>
              </p>
            </div>
          </div>

          {showIssues && issueMessages.length > 0 ? (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {issueMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            <Trans>Save</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ParticipantRowProps {
  participant: SettlementParticipant;
  /** This participant's member (if still one) and the members nobody has chosen yet. */
  memberChoices: readonly SettlementMember[];
  showShare: boolean;
  canRemove: boolean;
  accountGroups: OptionGroups;
  categoryGroups: OptionGroups;
  countLabel: (count: number) => string;
  onChange: (patch: Partial<SettlementParticipant>) => void;
  onRemove: () => void;
}

function ParticipantRow({
  participant,
  memberChoices,
  showShare,
  canRemove,
  accountGroups,
  categoryGroups,
  countLabel,
  onChange,
  onRemove,
}: ParticipantRowProps) {
  const { t } = useLingui();
  const fieldId = useId();
  // The typed text, so "12," or "" can be typed on the way to a share.
  const [shareText, setShareText] = useState(() => percentText(participant.customShareBasisPoints));
  const isMember = memberChoices.some((member) => member.id === participant.id);
  const personalCategoryIds = participant.personalCategoryIds ?? [];

  return (
    <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${fieldId}-member`} className="text-xs text-muted-foreground">
          <Trans>Budgero user</Trans>
        </Label>
        <Select
          value={participant.id}
          onValueChange={(id) => {
            const member = memberChoices.find((choice) => choice.id === id);
            if (member) onChange({ id: member.id, name: member.name });
          }}
        >
          <SelectTrigger id={`${fieldId}-member`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {isMember ? null : (
              <SelectItem value={participant.id} disabled>
                {t`${participant.name} (no longer in this workspace)`}
              </SelectItem>
            )}
            {memberChoices.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">
          <Trans>Personal accounts</Trans>
        </Label>
        <SettlementMultiSelect
          groups={accountGroups}
          selectedIds={participant.accountIds}
          onChange={(accountIds) => onChange({ accountIds })}
          buttonLabel={countLabel(participant.accountIds.length)}
          searchPlaceholder={t`Search accounts…`}
          emptyText={t`No accounts found.`}
          clearOptionValue={CLEAR_OPTION_VALUE.accounts}
        />
      </div>
      {showShare ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-share`} className="text-xs text-muted-foreground">
            <Trans>Share in %</Trans>
          </Label>
          <Input
            id={`${fieldId}-share`}
            className="w-24"
            inputMode="decimal"
            step={SHARE_INPUT_STEP}
            value={shareText}
            onChange={(event) => {
              setShareText(event.target.value);
              const basisPoints = basisPointsFrom(event.target.value);
              onChange({ customShareBasisPoints: basisPoints ?? 0 });
            }}
          />
        </div>
      ) : (
        <span />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={t`Remove participant`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <div className="flex flex-col gap-1 sm:col-span-4">
        <Label className="text-xs text-muted-foreground">
          <Trans>Personal categories</Trans>
        </Label>
        <SettlementMultiSelect
          groups={categoryGroups}
          selectedIds={personalCategoryIds}
          onChange={(ids) => onChange({ personalCategoryIds: ids })}
          buttonLabel={countLabel(personalCategoryIds.length)}
          searchPlaceholder={t`Search categories…`}
          emptyText={t`No categories found.`}
          clearOptionValue={CLEAR_OPTION_VALUE.personalCategories}
        />
        <p className="text-xs text-muted-foreground">
          <Trans>
            Spending in these categories is this person's alone. When someone else pays it, this
            person owes them the full amount.
          </Trans>
        </p>
      </div>
    </div>
  );
}
