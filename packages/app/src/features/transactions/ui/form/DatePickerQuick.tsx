import { Trans, useLingui } from '@lingui/react/macro';
/**
 * Date field with a calendar and Today / -1 day / +1 day buttons.
 *
 * The date can be typed in the locale's form (see typed-date.ts): Enter
 * takes it and moves on past the optional time, ↑/↓ shift it by a day, Page↑/Page↓ by a month and
 * Alt+↓ opens the calendar. The buttons stay for the mouse, out of the tab order.
 */

import { useCallback, useId, useRef, useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { TimeInput } from '@shared/ui/time-input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { MonthYearCalendar } from '@shared/ui/MonthYearCalendar';
import { FOCUS_DIRECTION, focusAdjacentField } from '@shared/lib/focus-navigation';
import { cn } from '@shared/lib/utils';
import {
  dateFieldOrder,
  formatTypedDate,
  parseTypedDate,
  shiftDays,
  shiftMonths,
} from '@features/transactions/lib/typed-date';

interface DatePickerQuickProps {
  value: Date | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (date: Date | null) => void;
  /** Optional time of day ('HH:MM', '' for none); the time input shows only with onTimeChange. */
  time?: string;
  onTimeChange?: (time: string) => void;
}

const DAY_STEP = 1;
const MONTH_STEP = 1;

export function DatePickerQuick({
  value,
  open,
  onOpenChange,
  onChange,
  time = '',
  onTimeChange,
}: DatePickerQuickProps) {
  const { t, i18n } = useLingui();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The date and the optional time: Enter on the date moves past both.
  const rowRef = useRef<HTMLDivElement | null>(null);
  // What is being typed; null while the field shows the date itself.
  const [draft, setDraft] = useState<string | null>(null);

  const context = {
    today: new Date(),
    order: dateFieldOrder(i18n.locale),
    keywords: { today: t`Today`, yesterday: t`Yesterday`, tomorrow: t`Tomorrow` },
  };
  const typed = draft === null ? null : parseTypedDate(draft, context);
  const invalid = draft !== null && draft.trim() !== '' && typed === null;
  const preview = typed ?? value;
  const longDate = new Intl.DateTimeFormat(i18n.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const setDate = useCallback(
    (date: Date) => {
      onChange(date);
      setDraft(null);
    },
    [onChange]
  );

  /** Takes what was typed; an empty field goes back to the date. Resolves whether it was one. */
  const commitDraft = () => {
    if (draft === null) return true;
    if (typed) {
      setDate(typed);
      return true;
    }
    if (draft.trim() === '') {
      setDraft(null);
      return true;
    }
    return false;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const base = typed ?? value ?? context.today;
    const step = (next: Date) => {
      event.preventDefault();
      setDate(next);
    };
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      onOpenChange(true);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        if (commitDraft() && rowRef.current)
          focusAdjacentField(rowRef.current, FOCUS_DIRECTION.next);
        return;
      case 'ArrowUp':
        return step(shiftDays(base, DAY_STEP));
      case 'ArrowDown':
        return step(shiftDays(base, -DAY_STEP));
      case 'PageUp':
        return step(shiftMonths(base, MONTH_STEP));
      case 'PageDown':
        return step(shiftMonths(base, -MONTH_STEP));
    }
  };

  const handleDateSelect = useCallback(
    (date: Date | undefined) => {
      onChange(date || null);
      setDraft(null);
      onOpenChange(false);
    },
    [onChange, onOpenChange]
  );

  const setDateRelative = (days: number) => {
    setDate(shiftDays(value ?? new Date(), days));
    onOpenChange(false);
  };

  const setDateToday = () => {
    setDate(new Date());
    onOpenChange(false);
  };

  return (
    <>
      <div className="space-y-1">
        <div ref={rowRef} className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverAnchor asChild>
              <div className="relative min-w-0 flex-1">
                <Input
                  ref={inputRef}
                  id="transaction-date"
                  inputMode="text"
                  autoComplete="off"
                  aria-label={t`Date`}
                  aria-invalid={invalid || undefined}
                  aria-describedby={hintId}
                  value={draft ?? (value ? formatTypedDate(value, i18n.locale) : '')}
                  placeholder={formatTypedDate(context.today, i18n.locale)}
                  onChange={(event) => setDraft(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={commitDraft}
                  onKeyDown={handleKeyDown}
                  className={cn(
                    'h-8 sm:h-10 pr-10 bg-background',
                    invalid && 'border-destructive focus-visible:ring-destructive'
                  )}
                  data-testid="transaction-date-input"
                  // Enter takes the date and moves on; it doesn't save the form.
                  data-enter-commits-field=""
                />
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    tabIndex={-1}
                    aria-label={t`Open calendar`}
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                  >
                    <CalendarIcon className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
              </div>
            </PopoverAnchor>
            <PopoverContent
              className="w-auto p-0"
              align="start"
              modal
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                inputRef.current?.focus();
              }}
            >
              <MonthYearCalendar selected={value || undefined} onSelect={handleDateSelect} />
            </PopoverContent>
          </Popover>
          {onTimeChange && (
            <TimeInput
              value={time ?? ''}
              onValueChange={onTimeChange}
              aria-label={t`Time (optional)`}
              title={t`Time (optional)`}
              className="h-8 w-28 shrink-0 sm:h-10"
            />
          )}
        </div>
        <p
          id={hintId}
          className={cn('ml-6 text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}
          aria-live="polite"
        >
          {invalid ? (
            <Trans>Not a date. Try a day like 24, or +1 for tomorrow.</Trans>
          ) : preview ? (
            longDate.format(preview)
          ) : (
            <Trans>Type a date or pick one.</Trans>
          )}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 w-full max-w-full px-6">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          tabIndex={-1}
          className="h-8 sm:h-9 w-full justify-center"
          onClick={setDateToday}
        >
          <Trans>Today</Trans>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          tabIndex={-1}
          className="h-8 sm:h-9 w-full justify-center"
          onClick={() => setDateRelative(-DAY_STEP)}
        >
          <Trans>-1 day</Trans>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          tabIndex={-1}
          className="h-8 sm:h-9 w-full justify-center"
          onClick={() => setDateRelative(DAY_STEP)}
        >
          <Trans>+1 day</Trans>
        </Button>
      </div>
    </>
  );
}
