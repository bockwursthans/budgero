const ID_BYTES = 16;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;

/**
 * A stable id for a new settlement participant (kept across later terms).
 * randomUUID needs a secure context; a self-hosted instance reached over
 * plain HTTP on a LAN address still has getRandomValues.
 */
export function newSettlementParticipantId(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(ID_BYTES));
  return Array.from(bytes, (byte) =>
    byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0')
  ).join('');
}
