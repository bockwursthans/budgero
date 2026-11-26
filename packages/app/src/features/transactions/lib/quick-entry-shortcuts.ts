import type { TransactionType } from '@features/transactions/ui/form/TransactionTypeSelector';

/**
 * Keys of the add-transaction form, so expenses can be typed in without the
 * mouse. Alt + digit picks the kind (by key position, whatever the layout).
 */
export const TYPE_SHORTCUT_DIGITS: Record<TransactionType, string> = {
  outflow: '1',
  inflow: '2',
  transfer: '3',
};

const DIGIT_CODE_PREFIX = 'Digit';

/** The kind Alt + this key code picks, if any. */
export function typeForShortcutCode(code: string): TransactionType | null {
  const entry = Object.entries(TYPE_SHORTCUT_DIGITS).find(
    ([, digit]) => code === `${DIGIT_CODE_PREFIX}${digit}`
  );
  return entry ? (entry[0] as TransactionType) : null;
}

/** Typed as the first character of an empty amount: the sign picks income or expense. */
export const AMOUNT_SIGN_TYPES: Readonly<Record<string, TransactionType>> = {
  '+': 'inflow',
  '-': 'outflow',
};
