/**
 * The settlement profile of a budget: who takes part, which of their accounts
 * are personal, which categories count as income and as shared expenses, and
 * how the expenses are divided. Kept as synced budget state (one JSON value
 * per budget), so every member and device sees the same setup.
 *
 * Changes apply from the first day of a month: the profile holds a list of
 * terms, each in effect from its `effectiveFrom` until the next one starts.
 * The first terms have no date and apply from the beginning. A range
 * spanning a change is settled part by part, each part with its own terms.
 * Month starts keep an income-weighted split independent of paydays.
 *
 * The stored value comes from other members' devices, so it is read
 * defensively: anything this build can't read exactly makes the profile
 * read-only instead of being cleaned up and written back.
 *
 * Pure functions, no DB or UI dependencies.
 */

import { getUTCDateString, isCalendarDate } from '../../utils/date.js';
import {
  SETTLEMENT_STRATEGIES,
  SETTLEMENT_STRATEGY,
  type SettlementParticipant,
  type SettlementProfile,
  type SettlementSegment,
  type SettlementStrategy,
  type SettlementTerms,
} from './types.js';

/** Synced state key (budget scope) the profile is stored under. */
export const SETTLEMENT_PROFILE_KEY = 'settlement.profile';

/** Bumped when the stored shape changes in a way older builds can't read. */
export const SETTLEMENT_PROFILE_FORMAT_VERSION = 1;

/** 100 % in basis points. */
export const SETTLEMENT_FULL_SHARE_BASIS_POINTS = 10_000;

export const SETTLEMENT_MIN_PARTICIPANTS = 2;
export const SETTLEMENT_MAX_PARTICIPANTS = 20;
/** Twenty years of monthly changes. */
export const SETTLEMENT_MAX_TERMS = 240;
/** Per id list (a participant's accounts, the income or expense categories). */
export const SETTLEMENT_MAX_IDS = 500;
export const SETTLEMENT_MAX_NAME_LENGTH = 80;

const MAX_PARTICIPANT_ID_LENGTH = 64;
const MIN_YEAR = 1900;
const FIRST_DAY_OF_MONTH = 1;
const ISO_DATE_PATTERN = /^(\d{4})-\d{2}-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
/** Control and invisible formatting characters (bidi overrides, zero-width). */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

export const SETTLEMENT_PROFILE_STATUS = {
  /** Nothing stored yet. */
  unset: 'unset',
  /** Read completely; may be changed. */
  ready: 'ready',
  /** Written by a newer build. */
  newerFormat: 'newer-format',
  /** Parts could not be read; shown as far as possible, never written back. */
  unreadable: 'unreadable',
} as const;

export type SettlementProfileStatus =
  (typeof SETTLEMENT_PROFILE_STATUS)[keyof typeof SETTLEMENT_PROFILE_STATUS];

export interface SettlementProfileReading {
  status: SettlementProfileStatus;
  profile: SettlementProfile | null;
}

export const SETTLEMENT_TERMS_ISSUE = {
  tooFewParticipants: 'too-few-participants',
  tooManyParticipants: 'too-many-participants',
  missingParticipantName: 'missing-participant-name',
  participantWithoutAccounts: 'participant-without-accounts',
  accountAssignedTwice: 'account-assigned-twice',
  customSharesIncomplete: 'custom-shares-incomplete',
  missingExpenseCategories: 'missing-expense-categories',
  missingIncomeCategories: 'missing-income-categories',
  categoryCountedTwice: 'category-counted-twice',
  invalidEffectiveDate: 'invalid-effective-date',
  effectiveDateTaken: 'effective-date-taken',
} as const;

export type SettlementTermsIssueCode =
  (typeof SETTLEMENT_TERMS_ISSUE)[keyof typeof SETTLEMENT_TERMS_ISSUE];

export interface SettlementTermsIssue {
  code: SettlementTermsIssueCode;
  /** The participant the issue is about, when it is about one. */
  participantId?: string;
}

/** A real calendar day written as YYYY-MM-DD, from 1900 on. */
export function isSettlementDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_PATTERN.exec(value);
  return match !== null && Number(match[1]) >= MIN_YEAR && isCalendarDate(value);
}

/** A date terms can start on: the first day of a month. */
export function isSettlementChangeDate(value: unknown): value is string {
  return isSettlementDate(value) && Number(value.slice(-2)) === FIRST_DAY_OF_MONTH;
}

/** The calendar day before a YYYY-MM-DD date. */
export function dayBefore(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return getUTCDateString(new Date(Date.UTC(year, month - 1, day) - MS_PER_DAY));
}

/** A display name without hidden characters, cut to the length limit (whole characters). */
export function cleanSettlementName(name: string): string {
  return Array.from(name.replace(HIDDEN_CHARACTERS, ''))
    .slice(0, SETTLEMENT_MAX_NAME_LENGTH)
    .join('');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStrategy(value: unknown): value is SettlementStrategy {
  return (SETTLEMENT_STRATEGIES as readonly unknown[]).includes(value);
}

const isId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0;

const isBasisPoints = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= SETTLEMENT_FULL_SHARE_BASIS_POINTS;

/**
 * Reads one stored value. `lossy` is set whenever something had to be
 * dropped or changed, so the caller can refuse to write the result back.
 */
class ProfileReader {
  lossy = false;

  ids(value: unknown): number[] {
    if (!Array.isArray(value) || value.length > SETTLEMENT_MAX_IDS) {
      this.lossy = true;
      return Array.isArray(value) ? this.ids(value.slice(0, SETTLEMENT_MAX_IDS)) : [];
    }
    const ids = [...new Set(value.filter(isId))];
    if (ids.length !== value.length) this.lossy = true;
    return ids;
  }

  participant(raw: unknown): SettlementParticipant | null {
    if (!isPlainObject(raw)) return null;
    const { id, name, customShareBasisPoints } = raw;
    if (typeof id !== 'string' || id === '' || id.length > MAX_PARTICIPANT_ID_LENGTH) return null;
    const cleanName = typeof name === 'string' ? cleanSettlementName(name) : '';
    if (cleanName !== name) this.lossy = true;
    if (!isBasisPoints(customShareBasisPoints)) this.lossy = true;
    return {
      id,
      name: cleanName,
      accountIds: this.ids(raw.accountIds),
      customShareBasisPoints: isBasisPoints(customShareBasisPoints) ? customShareBasisPoints : 0,
    };
  }

  participants(raw: unknown): SettlementParticipant[] {
    if (!Array.isArray(raw)) {
      this.lossy = true;
      return [];
    }
    const byId = new Map<string, SettlementParticipant>();
    for (const entry of raw.slice(0, SETTLEMENT_MAX_PARTICIPANTS)) {
      const participant = this.participant(entry);
      if (participant && !byId.has(participant.id)) byId.set(participant.id, participant);
    }
    if (byId.size !== raw.length) this.lossy = true;
    return [...byId.values()];
  }

  terms(raw: unknown): SettlementTerms | null {
    if (!isPlainObject(raw) || !isStrategy(raw.strategy)) return null;
    const { effectiveFrom } = raw;
    if (effectiveFrom !== undefined && !isSettlementChangeDate(effectiveFrom)) return null;
    return {
      ...(effectiveFrom !== undefined ? { effectiveFrom } : {}),
      strategy: raw.strategy,
      participants: this.participants(raw.participants),
      incomeCategoryIds: this.ids(raw.incomeCategoryIds),
      expenseCategoryIds: this.ids(raw.expenseCategoryIds),
    };
  }
}

/**
 * Sorts terms: the first undated terms are the initial ones (later undated
 * ones are dropped), and a repeated date keeps its last terms. Without
 * initial terms the earliest dated ones become the initial terms, so every
 * day is covered.
 */
export function normalizeSettlementTerms(entries: readonly SettlementTerms[]): SettlementTerms[] {
  let initial: SettlementTerms | undefined;
  const byDate = new Map<string, SettlementTerms>();
  for (const terms of entries) {
    if (terms.effectiveFrom === undefined) initial ??= terms;
    else byDate.set(terms.effectiveFrom, terms);
  }
  const dated = [...byDate.values()].sort((a, b) => (a.effectiveFrom! < b.effectiveFrom! ? -1 : 1));
  if (initial) return [initial, ...dated];
  if (dated.length === 0) return [];
  const [earliest, ...later] = dated;
  const undated = { ...earliest };
  delete undated.effectiveFrom;
  return [undated, ...later];
}

/** The stored profile and whether this build may change it. */
export function readSettlementProfile(raw: unknown): SettlementProfileReading {
  if (raw === undefined || raw === null) {
    return { status: SETTLEMENT_PROFILE_STATUS.unset, profile: null };
  }
  if (
    isPlainObject(raw) &&
    typeof raw.formatVersion === 'number' &&
    raw.formatVersion > SETTLEMENT_PROFILE_FORMAT_VERSION
  ) {
    return { status: SETTLEMENT_PROFILE_STATUS.newerFormat, profile: null };
  }
  if (
    !isPlainObject(raw) ||
    raw.formatVersion !== SETTLEMENT_PROFILE_FORMAT_VERSION ||
    !Array.isArray(raw.terms)
  ) {
    return { status: SETTLEMENT_PROFILE_STATUS.unreadable, profile: null };
  }
  const reader = new ProfileReader();
  const read = raw.terms
    .slice(0, SETTLEMENT_MAX_TERMS)
    .map((entry) => reader.terms(entry))
    .filter((terms): terms is SettlementTerms => terms !== null);
  const terms = normalizeSettlementTerms(read);
  const complete = !reader.lossy && terms.length === raw.terms.length && terms.length > 0;
  return {
    status: complete ? SETTLEMENT_PROFILE_STATUS.ready : SETTLEMENT_PROFILE_STATUS.unreadable,
    profile: terms.length > 0 ? { formatVersion: SETTLEMENT_PROFILE_FORMAT_VERSION, terms } : null,
  };
}

/** Starting terms for a new profile, split by income. */
export function createDefaultSettlementTerms(
  participants: readonly Pick<SettlementParticipant, 'id' | 'name'>[],
  incomeCategoryIds: readonly number[]
): SettlementTerms {
  const evenShare = Math.floor(SETTLEMENT_FULL_SHARE_BASIS_POINTS / participants.length);
  return {
    strategy: SETTLEMENT_STRATEGY.incomeWeighted,
    participants: participants.map((participant, index) => ({
      ...participant,
      accountIds: [],
      customShareBasisPoints:
        index === 0
          ? SETTLEMENT_FULL_SHARE_BASIS_POINTS - evenShare * (participants.length - 1)
          : evenShare,
    })),
    incomeCategoryIds: [...incomeCategoryIds],
    expenseCategoryIds: [],
  };
}

/** The terms in effect on `date`. */
export function settlementTermsOn(
  profile: SettlementProfile,
  date: string
): SettlementTerms | undefined {
  let found: SettlementTerms | undefined;
  for (const terms of profile.terms) {
    if (terms.effectiveFrom === undefined || terms.effectiveFrom <= date) found = terms;
    else break;
  }
  return found;
}

/** Splits an inclusive date range into the parts each set of terms covers. */
export function settlementSegments(
  profile: SettlementProfile,
  startDate: string,
  endDate: string
): SettlementSegment[] {
  const segments: SettlementSegment[] = [];
  profile.terms.forEach((terms, index) => {
    const next = profile.terms[index + 1]?.effectiveFrom;
    const from =
      terms.effectiveFrom !== undefined && terms.effectiveFrom > startDate
        ? terms.effectiveFrom
        : startDate;
    const until = next !== undefined && next <= endDate ? dayBefore(next) : endDate;
    if (from <= until) segments.push({ terms, startDate: from, endDate: until });
  });
  return segments;
}

/**
 * The profile with `terms` added, replacing the terms of the same date (or
 * the initial terms when undated). `replacedEffectiveFrom` removes the dated
 * terms being edited first, so moving terms to another date doesn't keep a
 * copy at the old one.
 */
export function upsertSettlementTerms(
  profile: SettlementProfile | null,
  terms: SettlementTerms,
  replacedEffectiveFrom?: string
): SettlementProfile {
  const kept = (profile?.terms ?? []).filter(
    (existing) =>
      existing.effectiveFrom !== terms.effectiveFrom &&
      (replacedEffectiveFrom === undefined || existing.effectiveFrom !== replacedEffectiveFrom)
  );
  return {
    formatVersion: SETTLEMENT_PROFILE_FORMAT_VERSION,
    terms: normalizeSettlementTerms([...kept, terms]),
  };
}

/** The profile without the dated terms of `effectiveFrom` (the initial terms always stay). */
export function removeSettlementTerms(
  profile: SettlementProfile,
  effectiveFrom: string
): SettlementProfile {
  return {
    ...profile,
    terms: profile.terms.filter((terms) => terms.effectiveFrom !== effectiveFrom),
  };
}

function participantIssues(participants: readonly SettlementParticipant[]): SettlementTermsIssue[] {
  const issues: SettlementTermsIssue[] = [];
  if (participants.length < SETTLEMENT_MIN_PARTICIPANTS) {
    issues.push({ code: SETTLEMENT_TERMS_ISSUE.tooFewParticipants });
  }
  if (participants.length > SETTLEMENT_MAX_PARTICIPANTS) {
    issues.push({ code: SETTLEMENT_TERMS_ISSUE.tooManyParticipants });
  }
  const accountOwners = new Map<number, string>();
  for (const participant of participants) {
    if (participant.name.trim() === '') {
      issues.push({
        code: SETTLEMENT_TERMS_ISSUE.missingParticipantName,
        participantId: participant.id,
      });
    }
    if (participant.accountIds.length === 0) {
      issues.push({
        code: SETTLEMENT_TERMS_ISSUE.participantWithoutAccounts,
        participantId: participant.id,
      });
    }
    const sharedAccount = participant.accountIds.some(
      (accountId) => (accountOwners.get(accountId) ?? participant.id) !== participant.id
    );
    if (sharedAccount) {
      issues.push({
        code: SETTLEMENT_TERMS_ISSUE.accountAssignedTwice,
        participantId: participant.id,
      });
    }
    for (const accountId of participant.accountIds) accountOwners.set(accountId, participant.id);
  }
  return issues;
}

/**
 * Problems that keep terms from being saved; empty when they are fine.
 * `otherEffectiveDates` are the dates other terms of the profile start on.
 */
export function validateSettlementTerms(
  terms: SettlementTerms,
  otherEffectiveDates: readonly string[] = []
): SettlementTermsIssue[] {
  const issues = participantIssues(terms.participants);
  if (terms.strategy === SETTLEMENT_STRATEGY.custom) {
    const total = terms.participants.reduce((sum, p) => sum + p.customShareBasisPoints, 0);
    if (total !== SETTLEMENT_FULL_SHARE_BASIS_POINTS) {
      issues.push({ code: SETTLEMENT_TERMS_ISSUE.customSharesIncomplete });
    }
  }
  if (terms.expenseCategoryIds.length === 0) {
    issues.push({ code: SETTLEMENT_TERMS_ISSUE.missingExpenseCategories });
  }
  if (
    terms.strategy === SETTLEMENT_STRATEGY.incomeWeighted &&
    terms.incomeCategoryIds.length === 0
  ) {
    issues.push({ code: SETTLEMENT_TERMS_ISSUE.missingIncomeCategories });
  }
  const incomeCategories = new Set(terms.incomeCategoryIds);
  if (terms.expenseCategoryIds.some((id) => incomeCategories.has(id))) {
    issues.push({ code: SETTLEMENT_TERMS_ISSUE.categoryCountedTwice });
  }
  if (terms.effectiveFrom !== undefined) {
    if (!isSettlementChangeDate(terms.effectiveFrom)) {
      issues.push({ code: SETTLEMENT_TERMS_ISSUE.invalidEffectiveDate });
    } else if (otherEffectiveDates.includes(terms.effectiveFrom)) {
      issues.push({ code: SETTLEMENT_TERMS_ISSUE.effectiveDateTaken });
    }
  }
  return issues;
}
