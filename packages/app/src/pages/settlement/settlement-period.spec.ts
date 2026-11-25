import {
  defaultChangeDate,
  initialSettlementPeriod,
  monthKeyOf,
  monthStart,
  resolveSettlementRange,
  SETTLEMENT_PERIOD_MODE,
  shiftSettlementMonth,
} from './settlement-period';

describe('settlement period', () => {
  it('opens on the month of today', () => {
    expect(initialSettlementPeriod('2026-11-25')).toEqual({
      mode: SETTLEMENT_PERIOD_MODE.month,
      month: '2026-11',
      customStart: '',
      customEnd: '',
    });
  });

  it('covers the whole month, leap days included', () => {
    const period = { ...initialSettlementPeriod('2028-02-10') };
    expect(resolveSettlementRange(period)).toEqual({
      startDate: '2028-02-01',
      endDate: '2028-02-29',
    });
  });

  it('steps across year boundaries', () => {
    const december = initialSettlementPeriod('2026-12-01');
    expect(shiftSettlementMonth(december, 1).month).toBe('2027-01');
    expect(shiftSettlementMonth(december, -12).month).toBe('2025-12');
  });

  it('uses the picked custom range, a single day while only the start is picked', () => {
    const custom = {
      ...initialSettlementPeriod('2026-11-25'),
      mode: SETTLEMENT_PERIOD_MODE.custom,
      customStart: '2026-03-15',
      customEnd: '',
    };
    expect(resolveSettlementRange(custom)).toEqual({
      startDate: '2026-03-15',
      endDate: '2026-03-15',
    });
    expect(resolveSettlementRange({ ...custom, customEnd: '2026-04-14' })).toEqual({
      startDate: '2026-03-15',
      endDate: '2026-04-14',
    });
  });

  it('has no range until a custom start is picked', () => {
    const custom = {
      ...initialSettlementPeriod('2026-11-25'),
      mode: SETTLEMENT_PERIOD_MODE.custom,
    };
    expect(resolveSettlementRange(custom)).toEqual({ startDate: '', endDate: '' });
  });
});

describe('settlement change dates', () => {
  it('start changes on the first day of a month', () => {
    expect(monthStart('2026-03')).toBe('2026-03-01');
    expect(monthKeyOf('2026-03-01')).toBe('2026-03');
  });

  it('proposes next month for a new change, across the year end', () => {
    expect(defaultChangeDate('2026-11-25')).toBe('2026-12-01');
    expect(defaultChangeDate('2026-12-31')).toBe('2027-01-01');
  });
});
