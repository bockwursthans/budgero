import { describe, it, expect } from 'vitest';
import { withEditPrecision } from '@shared/lib/number-format';
import {
  evaluateTextToNumber,
  getSeparators,
  formatNumberForInput,
  mayBeTypedDecimal,
  parseLocalizedNumericString,
  tolerateTypedDecimal,
} from './calculator-utils';

const usdNoDecimals = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const eurNoDecimalsDe = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

describe('getSeparators with zero-decimal display formats', () => {
  it('still derives a decimal separator for en-US', () => {
    const { groupSep, decimalSep } = getSeparators(usdNoDecimals);
    expect(groupSep).toBe(',');
    expect(decimalSep).toBe('.');
  });

  it('still derives a decimal separator for de-DE', () => {
    const { groupSep, decimalSep } = getSeparators(eurNoDecimalsDe);
    expect(groupSep).toBe('.');
    expect(decimalSep).toBe(',');
  });

  it('lets localized decimal input parse instead of collapsing into the integer part', () => {
    const { groupSep, decimalSep } = getSeparators(eurNoDecimalsDe);
    expect(parseLocalizedNumericString('1.385,24', groupSep, decimalSep)).toBe(1385.24);
  });
});

describe('formatNumberForInput with zero-decimal display formats', () => {
  it('preserves fractional value when seeding edit text (en-US)', () => {
    const { groupSep, decimalSep } = getSeparators(usdNoDecimals);
    expect(formatNumberForInput(1385.24, usdNoDecimals, groupSep, decimalSep)).toBe('1,385.24');
  });

  it('preserves fractional value when seeding edit text (de-DE)', () => {
    const { groupSep, decimalSep } = getSeparators(eurNoDecimalsDe);
    expect(formatNumberForInput(1385.24, eurNoDecimalsDe, groupSep, decimalSep)).toBe('1.385,24');
  });

  it('keeps whole values free of forced trailing decimals', () => {
    const { groupSep, decimalSep } = getSeparators(usdNoDecimals);
    expect(formatNumberForInput(1385, usdNoDecimals, groupSep, decimalSep)).toBe('1,385');
  });
});

describe('withEditPrecision', () => {
  it('shows real cents that a zero-decimal display format would hide', () => {
    const edit = withEditPrecision(usdNoDecimals);
    expect(edit.format(0.24)).toBe('$0.24');
    expect(edit.format(4585.24)).toBe('$4,585.24');
  });

  it('keeps whole amounts rendering without decimals when the display format has none', () => {
    const edit = withEditPrecision(usdNoDecimals);
    expect(edit.format(4585)).toBe('$4,585');
  });

  it('renders exact milliunit remainders instead of rounding them to zero', () => {
    const edit = withEditPrecision(usdNoDecimals);
    expect(edit.format(0.002)).toBe('$0.002');
  });

  it('leaves two-decimal display formats intact', () => {
    const twoDecimals = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(withEditPrecision(twoDecimals).format(1385)).toBe('$1,385.00');
  });

  it('returns a cached instance for the same formatter', () => {
    expect(withEditPrecision(usdNoDecimals)).toBe(withEditPrecision(usdNoDecimals));
  });
});

describe('decimals typed with the group separator', () => {
  const GERMAN = { group: '.', decimal: ',' };
  const ENGLISH = { group: ',', decimal: '.' };

  it.each([
    ['3.5', '3,5'],
    ['12.99', '12,99'],
    ['1.234', '1.234'],
    ['1.234,5', '1.234,5'],
    ['1.234.567', '1.234.567'],
    ['2.5+3', '2,5+3'],
  ])('reads %s as %s in a decimal-comma format', (input, expected) => {
    expect(tolerateTypedDecimal(input, GERMAN.group, GERMAN.decimal)).toBe(expected);
  });

  it('works the other way round, and only for dot and comma', () => {
    expect(tolerateTypedDecimal('3,5', ENGLISH.group, ENGLISH.decimal)).toBe('3.5');
    expect(tolerateTypedDecimal('3 5', '\u00a0', ',')).toBe('3 5');
  });

  it('evaluates them as decimals and keeps thousands', () => {
    expect(evaluateTextToNumber('3.5', GERMAN.group, GERMAN.decimal)).toBe(3.5);
    expect(evaluateTextToNumber('1.234', GERMAN.group, GERMAN.decimal)).toBe(1234);
    expect(evaluateTextToNumber('2.5*2', GERMAN.group, GERMAN.decimal)).toBe(5);
  });

  it('holds off regrouping while the text may still become decimals', () => {
    expect(mayBeTypedDecimal('3.', GERMAN.group, GERMAN.decimal)).toBe(true);
    expect(mayBeTypedDecimal('3.5', GERMAN.group, GERMAN.decimal)).toBe(true);
    expect(mayBeTypedDecimal('1.000', GERMAN.group, GERMAN.decimal)).toBe(false);
    expect(mayBeTypedDecimal('3,5', GERMAN.group, GERMAN.decimal)).toBe(false);
  });
});
