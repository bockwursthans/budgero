import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { useLingui } from '@lingui/react/macro';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { formatDateISO, formatShortDate, parseDateKey } from '@shared/lib/date-utils';
import { Button } from '@shared/ui/button';
import DateRangePicker from '@shared/ui/date-range-picker';
import MonthPickerPopover from '@shared/ui/MonthPickerPopover';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import {
  SETTLEMENT_PERIOD_MODE,
  shiftSettlementMonth,
  type SettlementPeriod,
  type SettlementPeriodMode,
} from '../settlement-period';

const MODE_LABELS: Record<SettlementPeriodMode, MessageDescriptor> = {
  [SETTLEMENT_PERIOD_MODE.month]: msg`Month`,
  [SETTLEMENT_PERIOD_MODE.custom]: msg`Custom range`,
};

const MODES = Object.values(SETTLEMENT_PERIOD_MODE);

interface SettlementPeriodPickerProps {
  period: SettlementPeriod;
  onChange: (period: SettlementPeriod) => void;
}

/** A month with prev/next stepping, or a custom date range. */
export function SettlementPeriodPicker({ period, onChange }: SettlementPeriodPickerProps) {
  const { t } = useLingui();

  const from = period.customStart ? (parseDateKey(period.customStart) ?? undefined) : undefined;
  const to = period.customEnd ? (parseDateKey(period.customEnd) ?? undefined) : undefined;
  const customRange: DateRange | undefined = from || to ? { from, to } : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={period.mode}
        onValueChange={(mode) => onChange({ ...period, mode: mode as SettlementPeriodMode })}
      >
        <SelectTrigger className="h-9 w-auto min-w-[140px]" size="sm" aria-label={t`Period`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {t(MODE_LABELS[mode])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {period.mode === SETTLEMENT_PERIOD_MODE.month ? (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(shiftSettlementMonth(period, -1))}
            aria-label={t`Previous month`}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <MonthPickerPopover
            value={period.month}
            onChange={(month) => onChange({ ...period, month })}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(shiftSettlementMonth(period, 1))}
            aria-label={t`Next month`}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-2">
              <CalendarRange className="h-4 w-4" />
              {from && to ? `${formatShortDate(from)} – ${formatShortDate(to)}` : t`Pick range`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <DateRangePicker
              value={customRange}
              onChange={(range) =>
                onChange({
                  ...period,
                  customStart: range?.from ? formatDateISO(range.from) : '',
                  customEnd: range?.to ? formatDateISO(range.to) : '',
                })
              }
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
