import type {
  FleetAssignment,
  FleetChargingPolicy,
  FleetCostCenter,
  FleetDriver,
  FleetForecastPoint,
  FleetPage,
  FleetReservation,
  FleetUtilizationForecast,
  FleetWorkOrder,
} from '../../src/api/hooks/useFleetOps';
import { mockVehicle } from '../mockApi';

export const fleetNow = '2026-10-06T12:00:00.000Z';
export const fleetForecastFrom = '2026-10-06T00:00:00.000Z';
export const fleetForecastTo = '2026-10-20T00:00:00.000Z';
export const fleetRoute = '/fleet-operations';

export interface FleetOpsFixtures {
  drivers: FleetPage<FleetDriver>;
  assignments: FleetPage<FleetAssignment>;
  reservations: FleetPage<FleetReservation>;
  costCenters: FleetPage<FleetCostCenter>;
  policies: FleetPage<FleetChargingPolicy>;
  workOrders: FleetPage<FleetWorkOrder>;
  forecast: FleetUtilizationForecast;
}

function completePage<T>(items: T[]): FleetPage<T> {
  return { items, total: items.length, limit: 100, offset: 0 };
}

// Operands extend the released FleetKpis/FleetOperationsPage fixtures, not
// inferred server totals. An ended assignment still participates in the Set.
export function fleetOpsFixtures(
  mode: 'populated' | 'empty' | 'zeroForecast' = 'populated',
): FleetOpsFixtures {
  const versioned = {
    version: 1,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };
  const reservation: FleetReservation = {
    ...versioned,
    id: 3, vehicle_id: mockVehicle.id, vehicle_display_name: mockVehicle.display_name,
    driver_id: 2, driver_display_name: 'Driver A',
    cost_center_id: 4, cost_center_name: 'Field team',
    title: 'Airport run', purpose: null,
    starts_at: '2026-10-07T10:00:00Z', ends_at: '2026-10-07T11:00:00Z',
    status: 'confirmed',
  };
  const assignment: FleetAssignment = {
    ...versioned,
    id: 1, vehicle_id: mockVehicle.id, vehicle_display_name: mockVehicle.display_name,
    driver_id: 2, driver_display_name: 'Driver A',
    starts_at: '2026-10-01T00:00:00Z', ends_at: null, notes: null,
  };
  const workOrder: FleetWorkOrder = {
    ...versioned,
    id: 6, vehicle_id: mockVehicle.id, vehicle_display_name: mockVehicle.display_name,
    cost_center_id: 4, cost_center_name: 'Field team',
    title: 'Rotate tires', description: null, status: 'scheduled', severity: 'high',
    due_odometer_m: 100000, due_at: null,
    scheduled_start_at: null, scheduled_end_at: null,
    cost_minor: 10000, currency: 'USD',
  };
  const point: FleetForecastPoint = {
    vehicle_id: mockVehicle.id, vehicle_display_name: mockVehicle.display_name,
    forecast_date: '2026-10-07T00:00:00Z',
    available_s: 36000, reserved_s: 7200, maintenance_downtime_s: 0,
    historical_expected_s: 3600, expected_utilization_pct: 20.3,
    lower_utilization_pct: 10, upper_utilization_pct: 35,
  };
  const points: FleetForecastPoint[] = mode === 'empty' ? []
    : mode === 'zeroForecast' ? [{
      ...point, reserved_s: 0, historical_expected_s: 0,
      expected_utilization_pct: 0, lower_utilization_pct: 0, upper_utilization_pct: 0,
    }]
      : [
        point,
        {
          ...point, vehicle_id: 8, vehicle_display_name: 'Pool vehicle',
          expected_utilization_pct: 40.3, lower_utilization_pct: 20, upper_utilization_pct: 55,
        },
        {
          ...point, forecast_date: '2026-10-08T00:00:00Z',
          expected_utilization_pct: 60.3, lower_utilization_pct: 40, upper_utilization_pct: 75,
        },
      ];
  const empty = mode !== 'populated';
  return {
    drivers: completePage(empty ? [] : [{
      ...versioned, id: 2, display_name: 'Driver A', reference_code: 'DRV-A',
      status: 'active', max_charge_soc: 80, curfew_start: null, curfew_end: null,
    }]),
    assignments: completePage(empty ? [] : [
      assignment,
      { ...assignment, id: 2 },
      {
        ...assignment, id: 3, vehicle_id: 8, vehicle_display_name: 'Pool vehicle',
        ends_at: '2026-10-02T00:00:00Z',
      },
    ]),
    reservations: completePage(empty ? [] : [
      reservation,
      { ...reservation, id: 4, title: 'Requested depot run', status: 'requested' },
      { ...reservation, id: 5, title: 'Completed depot run', status: 'completed' },
      { ...reservation, id: 6, title: 'Cancelled depot run', status: 'cancelled' },
    ]),
    costCenters: completePage(empty ? [] : [{
      ...versioned, id: 4, code: 'FIELD', name: 'Field team', active: true,
    }]),
    policies: completePage(empty ? [] : [{
      ...versioned,
      id: 5, vehicle_id: mockVehicle.id, vehicle_display_name: mockVehicle.display_name,
      name: 'Depot nights', target_soc_pct: 80, max_power_w: 11000, priority: 10,
      effective_from: '2026-10-01T00:00:00Z', effective_to: null, enabled: true,
      windows: [{ day_of_week: 1, start_local_time: '00:00', end_local_time: '06:00' }],
    }]),
    workOrders: completePage(empty ? [] : [
      workOrder,
      { ...workOrder, id: 7, title: 'Inspect brakes', status: 'in_progress' },
      { ...workOrder, id: 8, title: 'Completed inspection', status: 'completed' },
      { ...workOrder, id: 9, title: 'Cancelled inspection', status: 'cancelled' },
    ]),
    forecast: {
      from: fleetForecastFrom, to: fleetForecastTo,
      generated_at: '2026-10-06T11:00:00Z',
      quality: 'fair', history_drive_count: 20, history_day_count: 12,
      limitations: ['Moderate history.'], points,
    },
  };
}
