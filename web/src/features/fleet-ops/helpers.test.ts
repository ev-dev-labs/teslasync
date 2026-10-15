import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDateFormat } from '@/hooks/useDateFormat';
import { formatDayKey } from '@/lib/dateFormat';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type {
  FleetAssignment,
  FleetCostCenter,
  FleetForecastPoint,
  FleetReservation,
  FleetWorkOrder,
} from '@/api/hooks/useFleetOps';
import {
  aggregateForecast, costCenterAllocations, fleetKpis, formatMinorUnits, reservationCalendarDays,
} from './helpers';

const preferences = vi.hoisted(() => ({
  locale: 'de-DE',
  settings: { tz_display_default: 'user', timezone_user: 'America/Los_Angeles' },
}));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => preferences }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { timezone: 'Asia/Tokyo' } }),
}));

afterEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  preferences.locale = 'de-DE';
  preferences.settings.timezone_user = 'America/Los_Angeles';
  preferences.settings.tz_display_default = 'user';
});

const reservation = {
  id: 1,
  vehicle_id: 7,
  vehicle_display_name: 'Pool Y',
  driver_id: 2,
  driver_display_name: 'Driver A',
  cost_center_id: 3,
  cost_center_name: 'Field',
  title: 'Visit',
  purpose: null,
  starts_at: '2026-08-05T10:00:00Z',
  ends_at: '2026-08-05T11:00:00Z',
  status: 'confirmed',
  version: 1,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
} satisfies FleetReservation;

const assignment = {
  id: 1,
  vehicle_id: 7,
  vehicle_display_name: 'Pool Y',
  driver_id: 2,
  driver_display_name: 'Driver A',
  starts_at: '2026-08-01T00:00:00Z',
  ends_at: null,
  notes: null,
  version: 1,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
} satisfies FleetAssignment;

const workOrder = {
  id: 1,
  vehicle_id: 7,
  vehicle_display_name: 'Pool Y',
  cost_center_id: 3,
  cost_center_name: 'Field',
  title: 'Tires',
  description: null,
  status: 'open',
  severity: 'high',
  due_odometer_m: 100000,
  due_at: null,
  scheduled_start_at: null,
  scheduled_end_at: null,
  cost_minor: 12500,
  currency: 'USD',
  version: 1,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
} satisfies FleetWorkOrder;

const costCenter = {
  id: 3,
  code: 'FIELD',
  name: 'Field team',
  active: true,
  version: 1,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
} satisfies FleetCostCenter;

describe('fleet operations view model', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'does not report missing or invalid monetary values as zero: %s',
    (cost_minor) => {
      const allocation = costCenterAllocations(
        [costCenter], [], [{ ...workOrder, cost_minor } as FleetWorkOrder],
      )[0];
      expect(allocation).toMatchObject({
        cost_minor: null, currency: null, cost_state: 'unknown',
        qualifying_cost_count: 0, work_order_count: 1, open_work_order_count: 1,
      });
    },
  );

  it.each([0, -12500, 12500, 12.5, -0.25])(
    'preserves a measured monetary value of %s',
    (cost_minor) => {
      expect(costCenterAllocations([costCenter], [], [{ ...workOrder, cost_minor }])[0])
        .toMatchObject({
          cost_minor, currency: 'USD', cost_state: 'known',
          qualifying_cost_count: 1, work_order_count: 1,
        });
    },
  );

  it('exposes a partial subtotal and counts without zero-coercing missing records', () => {
    expect(costCenterAllocations([costCenter], [reservation], [
      { ...workOrder, cost_minor: 0 },
      { ...workOrder, id: 2, cost_minor: -12.5, status: 'completed' },
      { ...workOrder, id: 3, cost_minor: null },
      { ...workOrder, id: 4, cost_minor: NaN },
      { ...workOrder, id: 5, cost_center_id: 4 },
    ])[0]).toMatchObject({
      cost_minor: -12.5, currency: 'USD', cost_state: 'partial',
      qualifying_cost_count: 2, work_order_count: 4,
      reservation_count: 1, open_work_order_count: 3,
    });
  });

  it('keeps an empty allocation unknown rather than presenting a measured zero', () => {
    expect(costCenterAllocations([costCenter], [], [])[0]).toMatchObject({
      cost_minor: null, currency: null, cost_state: 'unknown',
      qualifying_cost_count: 0, work_order_count: 0,
    });
  });

  it.each([null, undefined, '', ' ', 'US', 'invalid'])(
    'excludes missing or invalid currency %s from monetary qualification',
    (currency) => {
      expect(formatMinorUnits(0, currency as string | null)).toBe('—');
      expect(costCenterAllocations([costCenter], [], [
        { ...workOrder, currency } as FleetWorkOrder,
        { ...workOrder, id: 2, cost_minor: 0 },
      ])[0]).toMatchObject({
        cost_minor: 0, currency: 'USD', cost_state: 'partial',
        qualifying_cost_count: 1, work_order_count: 2,
      });
    },
  );

  it('never adds different currencies, even when both amounts are measured zero', () => {
    expect(costCenterAllocations([costCenter], [], [
      { ...workOrder, cost_minor: 0 },
      { ...workOrder, id: 2, cost_minor: 0, currency: 'EUR' },
    ])[0]).toMatchObject({
      cost_minor: null, currency: null, cost_state: 'unknown',
      qualifying_cost_count: 2, work_order_count: 2,
    });
  });

  it('normalizes currency casing and preserves signed fractional sums', () => {
    expect(costCenterAllocations([costCenter], [], [
      { ...workOrder, cost_minor: 12.5, currency: 'usd' },
      { ...workOrder, id: 2, cost_minor: -0.25 },
    ])[0]).toMatchObject({
      cost_minor: 12.25, currency: 'USD', cost_state: 'known',
      qualifying_cost_count: 2, work_order_count: 2,
    });
  });

  it('keeps an overflowing subtotal unknown', () => {
    expect(costCenterAllocations([costCenter], [], [
      { ...workOrder, cost_minor: Number.MAX_VALUE },
      { ...workOrder, id: 2, cost_minor: Number.MAX_VALUE },
    ])[0]).toMatchObject({
      cost_minor: null, cost_state: 'unknown', qualifying_cost_count: 2,
    });
  });

  it.each([
    { currency: 'JPY', amount: 12500, value: 12500 },
    { currency: 'USD', amount: 12500, value: 125 },
    { currency: 'BHD', amount: 12500, value: 12.5 },
    { currency: 'CLF', amount: 12500, value: 1.25 },
    { currency: 'JPY', amount: 0, value: 0 },
    { currency: 'BHD', amount: -12501, value: -12.501 },
  ])('formats $amount minor units in $currency', ({ currency, amount, value }) => {
    const expected = new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(value);
    expect(formatMinorUnits(amount, currency)).toBe(expected);
  });

  it('preserves the unknown-currency placeholder', () => {
    expect(formatMinorUnits(12500, null)).toBe('—');
  });

  it.each([null, undefined, NaN, Infinity])('keeps missing or invalid costs unknown: %s', (amount) => {
    expect(formatMinorUnits(amount, 'USD')).toBe('—');
  });

  it.each([
    { currency: 'JPY', value: 12500 },
    { currency: 'USD', value: 125 },
    { currency: 'BHD', value: 12.5 },
    { currency: 'CLF', value: 1.25 },
  ])('uses saved money preferences without changing the $currency exponent', ({ currency, value }) => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(3);
    expect(formatMinorUnits(12500, currency)).toBe(new Intl.NumberFormat('de-DE', {
      style: 'currency', currency, minimumFractionDigits: 3, maximumFractionDigits: 3,
    }).format(value));
  });

  it('groups by the effective local day while preserving raw instants and records', () => {
    const first = { ...reservation, starts_at: '2026-08-05T00:30:00Z' };
    const second = { ...reservation, id: 2, starts_at: '2026-08-04T18:30:00-07:00' };
    const third = { ...reservation, id: 3, starts_at: '2026-08-05T07:00:00Z' };
    const days = reservationCalendarDays([first, second, third], 'America/Los_Angeles');
    expect(days).toEqual([
      { day: '2026-08-04', reservations: [first, second] },
      { day: '2026-08-05', reservations: [third] },
    ]);
    expect(days[0].reservations[0]).toBe(first);
    expect(first.starts_at).toBe('2026-08-05T00:30:00Z');
    expect(reservationCalendarDays([first], 'Asia/Tokyo')[0].day).toBe('2026-08-05');
  });

  it('keeps invalid and missing reservation dates in an unknown day group', () => {
    const invalid = { ...reservation, starts_at: 'not-a-date' };
    const missing = { ...reservation, id: 2, starts_at: '' };
    expect(reservationCalendarDays([invalid, missing], 'America/Los_Angeles')).toEqual([
      { day: null, reservations: [invalid, missing] },
    ]);
  });

  it('honors saved locale/timezone for period, time, due date and calendar labels', () => {
    const { result, rerender } = renderHook(() => useDateFormat());
    const instant = '2026-08-05T00:30:00Z';
    expect(result.current.formatDateTime(instant)).toBe('4. Aug. 2026, 17:30');
    expect(result.current.formatTime(instant)).toBe('17:30');
    expect(result.current.formatDate(instant)).toBe('4. Aug. 2026');
    const day = reservationCalendarDays([{ ...reservation, starts_at: instant }], result.current.tz)[0].day;
    expect(formatDayKey(day!, { ...result.current.opts, style: 'short' })).toBe('4. Aug.');
    preferences.locale = 'en-GB';
    preferences.settings.timezone_user = 'Asia/Tokyo';
    rerender();
    expect(result.current.formatDateTime(instant)).toBe('5 Aug 2026, 09:30');
    expect(result.current.formatDate(instant)).toBe('5 Aug 2026');
  });

  it('preserves vehicle and UTC timezone modes', () => {
    preferences.settings.tz_display_default = 'vehicle';
    const { result, rerender } = renderHook(() => useDateFormat());
    expect(result.current.tz).toBe('Asia/Tokyo');
    preferences.settings.tz_display_default = 'utc';
    rerender();
    expect(result.current.tz).toBe('UTC');
  });

  it('handles DST day boundaries and missing/invalid display dates', () => {
    const { result } = renderHook(() => useDateFormat());
    const items = [
      { ...reservation, starts_at: '2026-03-08T09:30:00Z' },
      { ...reservation, id: 2, starts_at: '2026-03-08T10:30:00Z' },
    ];
    expect(reservationCalendarDays(items, result.current.tz)).toEqual([
      { day: '2026-03-08', reservations: items },
    ]);
    expect(items.map((item) => result.current.formatTime(item.starts_at))).toEqual(['01:30', '03:30']);
    for (const value of [null, undefined, '', 'not-a-date']) {
      expect(result.current.formatDateTime(value)).toBe('—');
      expect(result.current.formatDate(value)).toBe('—');
      expect(result.current.formatTime(value)).toBe('—');
    }
  });

  it('derives KPI values without treating missing forecast as zero precision', () => {
    const values = fleetKpis(
      [reservation],
      [assignment, { ...assignment, id: 2 }],
      [workOrder],
      [],
    );
    expect(values).toEqual({
      active_reservations: 1,
      assigned_vehicles: 1,
      open_work_orders: 1,
      expected_utilization_pct: null,
    });
  });

  it.each(['USD', 'JPY', 'BHD', 'CLF'])(
    'preserves raw minor-unit maintenance costs and %s currency by cost center',
    (currency) => {
      const center = {
        id: 3,
        code: 'FIELD',
        name: 'Field team',
        active: true,
        version: 1,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      } satisfies FleetCostCenter;
      expect(
        costCenterAllocations([center], [reservation], [{ ...workOrder, currency }])[0],
      ).toMatchObject({
        reservation_count: 1,
        open_work_order_count: 1,
        cost_minor: 12500,
        currency,
      });
    },
  );

  it('aggregates per-vehicle forecast points while preserving uncertainty width', () => {
    const point = {
      vehicle_id: 7,
      vehicle_display_name: 'Pool Y',
      forecast_date: '2026-08-05T00:00:00Z',
      available_s: 36000,
      reserved_s: 7200,
      maintenance_downtime_s: 0,
      historical_expected_s: 3600,
      expected_utilization_pct: 20,
      lower_utilization_pct: 10,
      upper_utilization_pct: 35,
    } satisfies FleetForecastPoint;
    expect(aggregateForecast([point, {
      ...point,
      vehicle_id: 8,
      expected_utilization_pct: 40,
      lower_utilization_pct: 20,
      upper_utilization_pct: 60,
    }])).toEqual([{
      date: '2026-08-05',
      expected: 30,
      lower: 15,
      uncertainty: 32.5,
      upper: 47.5,
    }]);
  });
});
