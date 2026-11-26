/**
 * Dates typed into the transaction form, read the way the user's locale
 * writes them:
 *
 *   24          the 24th of this month
 *   24.11       24 November this year (11/24 in a month-first locale)
 *   24.11.26    2026; four-digit years and ISO (2026-11-24) work too
 *   +2 / -1     days from today
 *   h, gestern  the first letters of the words for today, yesterday or tomorrow
 *
 * Separators can be . / - or a space. Anything else, or a day that doesn't
 * exist (31.02), reads as no date. Pure functions, no UI dependencies.
 */

export const DATE_FIELD_ORDER = {
  dayMonthYear: 'dmy',
  monthDayYear: 'mdy',
  yearMonthDay: 'ymd',
} as const;

export type DateFieldOrder = (typeof DATE_FIELD_ORDER)[keyof typeof DATE_FIELD_ORDER];

export interface TypedDateKeywords {
  today: string;
  yesterday: string;
  tomorrow: string;
}

export interface TypedDateContext {
  today: Date;
  order: DateFieldOrder;
  /** The words in the user's language; any start of one picks it (today wins a tie). */
  keywords: TypedDateKeywords;
}

const FIELD_INITIAL = { day: 'd', month: 'm', year: 'y' } as const;
/** A date whose day, month and year all differ, to read the locale's order off. */
const ORDER_SAMPLE = new Date(2026, 10, 25);
const TWO_DIGIT_YEAR_BASE = 2000;
const TWO_DIGIT_YEAR_LENGTH = 2;
const FOUR_DIGIT_YEAR_LENGTH = 4;
const MAX_PARTS = 3;
/** Midday, so a daylight-saving change never moves the date. */
const MIDDAY_HOUR = 12;
const RELATIVE_DAYS = /^([+-])\s*(\d{1,3})$/;
const SEPARATORS = /[./\-\s]+/;
const DIGITS = /^\d+$/;
const LETTERS = /^\p{L}+$/u;

/** In which order the locale writes day, month and year. */
export function dateFieldOrder(locale: string): DateFieldOrder {
  const order = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .formatToParts(ORDER_SAMPLE)
    .flatMap((part) =>
      part.type === 'day' || part.type === 'month' || part.type === 'year'
        ? [FIELD_INITIAL[part.type]]
        : []
    )
    .join('');
  if (order === DATE_FIELD_ORDER.monthDayYear) return DATE_FIELD_ORDER.monthDayYear;
  if (order === DATE_FIELD_ORDER.yearMonthDay) return DATE_FIELD_ORDER.yearMonthDay;
  return DATE_FIELD_ORDER.dayMonthYear;
}

/** The date in the locale's short numeric form (24.11.2026, 11/24/2026, …). */
export function formatTypedDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day, MIDDAY_HOUR);
  const exists =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return exists ? date : null;
}

export function shiftDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, MIDDAY_HOUR);
}

/** The same day `months` later, or the month's last day when it is shorter. */
export function shiftMonths(date: Date, months: number): Date {
  const firstOfTarget = new Date(date.getFullYear(), date.getMonth() + months, 1, MIDDAY_HOUR);
  const lastDay = new Date(
    firstOfTarget.getFullYear(),
    firstOfTarget.getMonth() + 1,
    0,
    MIDDAY_HOUR
  ).getDate();
  return new Date(
    firstOfTarget.getFullYear(),
    firstOfTarget.getMonth(),
    Math.min(date.getDate(), lastDay),
    MIDDAY_HOUR
  );
}

function keywordDate(text: string, { today, keywords }: TypedDateContext): Date | null {
  if (!LETTERS.test(text)) return null;
  const offsets: [string, number][] = [
    [keywords.today, 0],
    [keywords.yesterday, -1],
    [keywords.tomorrow, 1],
  ];
  const match = offsets.find(([word]) => word.toLowerCase().startsWith(text));
  return match ? shiftDays(today, match[1]) : null;
}

function yearOf(part: string | undefined, today: Date): number | null {
  if (part === undefined) return today.getFullYear();
  if (part.length === TWO_DIGIT_YEAR_LENGTH) return TWO_DIGIT_YEAR_BASE + Number(part);
  if (part.length === FOUR_DIGIT_YEAR_LENGTH) return Number(part);
  return null;
}

/** The typed date, or null when it isn't one. */
export function parseTypedDate(input: string, context: TypedDateContext): Date | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const keyword = keywordDate(text, context);
  if (keyword) return keyword;

  const relative = RELATIVE_DAYS.exec(text);
  if (relative) {
    const days = Number(relative[2]);
    return shiftDays(context.today, relative[1] === '-' ? -days : days);
  }

  const parts = text.split(SEPARATORS).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_PARTS || !parts.every((p) => DIGITS.test(p))) {
    return null;
  }
  const { today, order } = context;
  const month = today.getMonth() + 1;

  // ISO, whatever the locale: 2026-11-24.
  if (parts[0].length === FOUR_DIGIT_YEAR_LENGTH) {
    if (parts.length !== MAX_PARTS) return null;
    return calendarDate(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }
  // One number is always the day of this month.
  if (parts.length === 1) return calendarDate(today.getFullYear(), month, Number(parts[0]));

  const [first, second, third] = parts;
  switch (order) {
    case DATE_FIELD_ORDER.dayMonthYear: {
      const year = yearOf(third, today);
      return year === null ? null : calendarDate(year, Number(second), Number(first));
    }
    case DATE_FIELD_ORDER.monthDayYear: {
      const year = yearOf(third, today);
      return year === null ? null : calendarDate(year, Number(first), Number(second));
    }
    case DATE_FIELD_ORDER.yearMonthDay: {
      // Without a year: month and day; with one: a two-digit year first.
      if (third === undefined)
        return calendarDate(today.getFullYear(), Number(first), Number(second));
      const year = yearOf(first, today);
      return year === null ? null : calendarDate(year, Number(second), Number(third));
    }
  }
}
