import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import {
  SETTLEMENT_MAX_PARTICIPANTS,
  SETTLEMENT_STRATEGY,
  SETTLEMENT_TERMS_ISSUE,
  SETTLEMENT_WARNING,
  type SettlementStrategy,
  type SettlementTermsIssueCode,
  type SettlementWarning,
} from '@budgero/core/browser';

export const STRATEGY_LABELS: Record<SettlementStrategy, MessageDescriptor> = {
  [SETTLEMENT_STRATEGY.incomeWeighted]: msg`By income`,
  [SETTLEMENT_STRATEGY.equal]: msg`Equal split`,
  [SETTLEMENT_STRATEGY.custom]: msg`Fixed shares`,
};

export const STRATEGY_DESCRIPTIONS: Record<SettlementStrategy, MessageDescriptor> = {
  [SETTLEMENT_STRATEGY.incomeWeighted]: msg`Everyone carries the part of the shared expenses that matches their part of the income in the period.`,
  [SETTLEMENT_STRATEGY.equal]: msg`Everyone carries the same part of the shared expenses.`,
  [SETTLEMENT_STRATEGY.custom]: msg`Everyone carries a fixed percentage of the shared expenses.`,
};

export const TERMS_ISSUE_MESSAGES: Record<SettlementTermsIssueCode, MessageDescriptor> = {
  [SETTLEMENT_TERMS_ISSUE.tooFewParticipants]: msg`Add at least two participants.`,
  [SETTLEMENT_TERMS_ISSUE.tooManyParticipants]: msg`A settlement can have at most ${SETTLEMENT_MAX_PARTICIPANTS} participants.`,
  [SETTLEMENT_TERMS_ISSUE.missingParticipantName]: msg`Every participant needs a name.`,
  [SETTLEMENT_TERMS_ISSUE.participantWithoutAccounts]: msg`Every participant needs at least one personal account.`,
  [SETTLEMENT_TERMS_ISSUE.accountAssignedTwice]: msg`An account can belong to one participant only.`,
  [SETTLEMENT_TERMS_ISSUE.customSharesIncomplete]: msg`The fixed shares must add up to 100 %.`,
  [SETTLEMENT_TERMS_ISSUE.missingExpenseCategories]: msg`Choose the categories of shared expenses.`,
  [SETTLEMENT_TERMS_ISSUE.missingIncomeCategories]: msg`Choose the income categories that count.`,
  [SETTLEMENT_TERMS_ISSUE.categoryCountedTwice]: msg`A category can't count as income and as a shared expense.`,
  [SETTLEMENT_TERMS_ISSUE.personalCategoryCountedTwice]: msg`A personal category belongs to one person only and can't also be shared or count as income.`,
  [SETTLEMENT_TERMS_ISSUE.invalidEffectiveDate]: msg`Choose the month the change applies from.`,
  [SETTLEMENT_TERMS_ISSUE.effectiveDateTaken]: msg`Another change already starts in this month. Edit that one instead.`,
  [SETTLEMENT_TERMS_ISSUE.participantNotAMember]: msg`Every participant must be a Budgero user in this workspace.`,
  [SETTLEMENT_TERMS_ISSUE.memberChosenTwice]: msg`Each Budgero user can take part only once.`,
};

export const WARNING_MESSAGES: Record<SettlementWarning, MessageDescriptor> = {
  [SETTLEMENT_WARNING.noIncomeSplitEqually]: msg`No eligible income was found for part of this period, so the shared expenses there are split equally.`,
  [SETTLEMENT_WARNING.noSharesSplitEqually]: msg`All fixed shares are zero for part of this period, so the shared expenses there are split equally.`,
};
