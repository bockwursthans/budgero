/**
 * Consent to settlement terms. Terms count only once every participant has
 * approved them from their own login. An approval is a fingerprint the
 * server stores next to the authenticated member who sent it, so no member
 * can approve for another one. The fingerprint is an HMAC of the terms under
 * the profile's approval key, which lives in the end-to-end encrypted
 * workspace: the server learns who agreed, not to what. Any change to the
 * terms changes the fingerprint, so changed terms need everyone's consent
 * again.
 *
 * Browser-safe: Web Crypto only, no DB or UI dependencies.
 */

import type { SettlementProfile, SettlementTerms } from './types.js';

/** Stands for the undated initial terms wherever terms are looked up by start. */
export const INITIAL_SETTLEMENT_TERMS_KEY = 'initial';

/** Bytes of a new approval key (HMAC-SHA-256 key). */
const APPROVAL_KEY_BYTES = 32;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;
const APPROVAL_KEY_PATTERN = /^[0-9a-f]{64}$/;
const HMAC_ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;
/** Part of the signed message: a new layout gets a new number, so old approvals stop matching. */
const FINGERPRINT_LAYOUT_VERSION = 1;

/** An approval as the server reports it. */
export interface SettlementApprovalRecord {
  userId: string;
  fingerprint: string;
}

export interface SettlementTermsConsent {
  fingerprint: string;
  /** Participants (user ids) who approved these exact terms. */
  approvedBy: string[];
  /** Participants who have not approved them yet. */
  pendingFor: string[];
  approved: boolean;
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0')).join('');

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / HEX_DIGITS_PER_BYTE));
  for (let index = 0; index < bytes.length; index += 1) {
    const offset = index * HEX_DIGITS_PER_BYTE;
    bytes[index] = Number.parseInt(hex.slice(offset, offset + HEX_DIGITS_PER_BYTE), HEX_RADIX);
  }
  return bytes;
}

export function isSettlementApprovalKey(value: unknown): value is string {
  return typeof value === 'string' && APPROVAL_KEY_PATTERN.test(value);
}

/** A new random approval key for a profile. */
export function createSettlementApprovalKey(): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(APPROVAL_KEY_BYTES)));
}

/** The key the terms are looked up and approved by: their start date, or the initial key. */
export function settlementTermsKey(terms: Pick<SettlementTerms, 'effectiveFrom'>): string {
  return terms.effectiveFrom ?? INITIAL_SETTLEMENT_TERMS_KEY;
}

const ascending = (ids: readonly number[]): number[] => [...ids].sort((a, b) => a - b);

/**
 * What an approval agrees to, in a fixed layout so every device signs the
 * same bytes: the budget, the start, the split and, per participant, who
 * they are, which accounts are theirs and their fixed share. Display names
 * are left out: renaming someone is no new agreement.
 */
export function settlementTermsMessage(budgetId: number, terms: SettlementTerms): string {
  const participants = [...terms.participants]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((participant) => [
      participant.id,
      ascending(participant.accountIds),
      participant.customShareBasisPoints,
    ]);
  return JSON.stringify([
    FINGERPRINT_LAYOUT_VERSION,
    budgetId,
    terms.effectiveFrom ?? null,
    terms.strategy,
    participants,
    ascending(terms.incomeCategoryIds),
    ascending(terms.expenseCategoryIds),
  ]);
}

/** The fingerprint members approve for these terms (lowercase hex HMAC-SHA-256). */
export async function settlementTermsFingerprint(
  approvalKey: string,
  budgetId: number,
  terms: SettlementTerms
): Promise<string> {
  if (!isSettlementApprovalKey(approvalKey)) throw new Error('Invalid settlement approval key');
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    fromHex(approvalKey),
    HMAC_ALGORITHM,
    false,
    ['sign']
  );
  const message = new TextEncoder().encode(settlementTermsMessage(budgetId, terms));
  return toHex(
    new Uint8Array(await globalThis.crypto.subtle.sign(HMAC_ALGORITHM.name, key, message))
  );
}

/** Who approved terms with this fingerprint, and who still has to. */
export function settlementTermsConsent(
  terms: SettlementTerms,
  fingerprint: string,
  approvals: readonly SettlementApprovalRecord[]
): SettlementTermsConsent {
  const approvers = new Set(
    approvals
      .filter((approval) => approval.fingerprint === fingerprint)
      .map((approval) => approval.userId)
  );
  const participantIds = terms.participants.map((participant) => participant.id);
  const approvedBy = participantIds.filter((id) => approvers.has(id));
  const pendingFor = participantIds.filter((id) => !approvers.has(id));
  return {
    fingerprint,
    approvedBy,
    pendingFor,
    approved: participantIds.length > 0 && pendingFor.length === 0,
  };
}

/** Keys of the profile's terms that every participant approved (in profile order). */
export async function approvedSettlementTermsKeys(
  budgetId: number,
  profile: SettlementProfile,
  approvals: readonly SettlementApprovalRecord[]
): Promise<string[]> {
  const { approvalKey } = profile;
  if (!approvalKey) return [];
  const consents = await Promise.all(
    profile.terms.map(async (terms) => {
      const fingerprint = await settlementTermsFingerprint(approvalKey, budgetId, terms);
      return {
        key: settlementTermsKey(terms),
        consent: settlementTermsConsent(terms, fingerprint, approvals),
      };
    })
  );
  return consents.filter(({ consent }) => consent.approved).map(({ key }) => key);
}
