import {
  DATE_FIELD_ORDER,
  dateFieldOrder,
  formatTypedDate,
  parseTypedDate,
  shiftMonths,
  type TypedDateContext,
} from './typed-date';

const TODAY = new Date(2026, 10, 25, 12);
const german: TypedDateContext = {
  today: TODAY,
  order: DATE_FIELD_ORDER.dayMonthYear,
  keywords: { today: 'Heute', yesterday: 'Gestern', tomorrow: 'Morgen' },
};
const american: TypedDateContext = {
  ...german,
  order: DATE_FIELD_ORDER.monthDayYear,
  keywords: { today: 'Today', yesterday: 'Yesterday', tomorrow: 'Tomorrow' },
};

const day = (date: Date | null) =>
  date ? [date.getFullYear(), date.getMonth() + 1, date.getDate()] : null;

describe('dateFieldOrder', () => {
  it('reads the order off the locale', () => {
    expect(dateFieldOrder('de-DE')).toBe(DATE_FIELD_ORDER.dayMonthYear);
    expect(dateFieldOrder('en-US')).toBe(DATE_FIELD_ORDER.monthDayYear);
    expect(dateFieldOrder('sv-SE')).toBe(DATE_FIELD_ORDER.yearMonthDay);
  });
});

describe('parseTypedDate', () => {
  it.each([
    ['24', [2026, 11, 24]],
    ['3.2', [2026, 2, 3]],
    ['24.11.26', [2026, 11, 24]],
    ['24/11/2025', [2025, 11, 24]],
    ['1 12', [2026, 12, 1]],
    ['2026-01-05', [2026, 1, 5]],
    ['+2', [2026, 11, 27]],
    ['-30', [2026, 10, 26]],
    ['h', [2026, 11, 25]],
    ['gest', [2026, 11, 24]],
    ['M', [2026, 11, 26]],
  ])('reads %s in a day-first locale', (input, expected) => {
    expect(day(parseTypedDate(input, german))).toEqual(expected);
  });

  it('reads month first where the locale does, and today before tomorrow', () => {
    expect(day(parseTypedDate('2/3', american))).toEqual([2026, 2, 3]);
    expect(day(parseTypedDate('12/31/27', american))).toEqual([2027, 12, 31]);
    expect(day(parseTypedDate('t', american))).toEqual([2026, 11, 25]);
    expect(day(parseTypedDate('tom', american))).toEqual([2026, 11, 26]);
  });

  it.each(['', 'x', '31.02', '24.13', '1.2.3.4', '24.11.2026x', '2026-11', '24.11.123'])(
    'reads %j as no date',
    (input) => {
      expect(parseTypedDate(input, german)).toBeNull();
    }
  );
});

describe('shiftMonths', () => {
  it('keeps the day, or takes the last one of a shorter month', () => {
    expect(day(shiftMonths(new Date(2026, 0, 31), 1))).toEqual([2026, 2, 28]);
    expect(day(shiftMonths(new Date(2026, 0, 15), -1))).toEqual([2025, 12, 15]);
  });
});

describe('formatTypedDate', () => {
  it('writes the locale’s short numeric date', () => {
    expect(formatTypedDate(TODAY, 'de-DE')).toBe('25.11.2026');
    expect(formatTypedDate(TODAY, 'en-US')).toBe('11/25/2026');
  });
});
