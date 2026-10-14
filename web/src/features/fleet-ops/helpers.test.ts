import { describe, expect, it } from 'vitest';
import type {
  FleetAssignment,
  FleetCostCenter,
  FleetForecastPoint,
  FleetReservation,
  FleetWorkOrder,
} from '@/api/hooks/useFleetOps';
import { aggregateForecast, costCenterAllocations, fleetKpis, formatMinorUnits } from './helpers';

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

describe('fleet operations view model', () => {
  it.each([
    { currency: 'JPY', amount: 12500, value: 12500 },
    { currency: 'USD', amount: 12500, value: 125 },
    { currency: 'BHD', amount: 12500, value: 12.5 },
    { currency: 'CLF', amount: 12500, value: 1.25 },
    { currency: 'JPY', amount: 0, value: 0 },
    { currency: 'BHD', amount: -12501, value: -12.501 },
  ])('formats $amount minor units in $currency', ({ currency, amount, value }) => {
    const expected = new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
    expect(formatMinorUnits(amount, currency)).toBe(expected);
  });

  it('preserves the unknown-currency placeholder', () => {
    expect(formatMinorUnits(12500, null)).toBe('—');
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
