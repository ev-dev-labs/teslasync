import type {
  FleetAssignment,
  FleetCostCenter,
  FleetForecastPoint,
  FleetReservation,
  FleetWorkOrder,
} from '@/api/hooks/useFleetOps';

export interface FleetKpiValues {
  active_reservations: number;
  assigned_vehicles: number;
  open_work_orders: number;
  expected_utilization_pct: number | null;
}

export function fleetKpis(
  reservations: FleetReservation[],
  assignments: FleetAssignment[],
  workOrders: FleetWorkOrder[],
  forecast: FleetForecastPoint[],
): FleetKpiValues {
  const assigned = new Set(assignments.map((item) => item.vehicle_id));
  const expected = forecast.map((point) => point.expected_utilization_pct);
  return {
    active_reservations: reservations.filter(
      (item) => item.status === 'requested' || item.status === 'confirmed',
    ).length,
    assigned_vehicles: assigned.size,
    open_work_orders: workOrders.filter(
      (item) => item.status !== 'completed' && item.status !== 'cancelled',
    ).length,
    expected_utilization_pct:
      expected.length > 0
        ? Math.round((expected.reduce((sum, value) => sum + value, 0) / expected.length) * 10) / 10
        : null,
  };
}

export interface CostCenterAllocation {
  cost_center: FleetCostCenter;
  reservation_count: number;
  open_work_order_count: number;
  cost_minor: number;
  currency: string | null;
}

export function costCenterAllocations(
  costCenters: FleetCostCenter[],
  reservations: FleetReservation[],
  workOrders: FleetWorkOrder[],
): CostCenterAllocation[] {
  return costCenters.map((costCenter) => {
    const relatedOrders = workOrders.filter((item) => item.cost_center_id === costCenter.id);
    const currencies = new Set(
      relatedOrders.map((item) => item.currency).filter((value): value is string => value !== null),
    );
    return {
      cost_center: costCenter,
      reservation_count: reservations.filter((item) => item.cost_center_id === costCenter.id).length,
      open_work_order_count: relatedOrders.filter(
        (item) => item.status !== 'completed' && item.status !== 'cancelled',
      ).length,
      cost_minor: relatedOrders.reduce((sum, item) => sum + (item.cost_minor ?? 0), 0),
      currency: currencies.size === 1 ? [...currencies][0] : null,
    };
  });
}

export interface ForecastChartPoint extends Record<string, string | number> {
  date: string;
  expected: number;
  lower: number;
  uncertainty: number;
  upper: number;
}

export function aggregateForecast(points: FleetForecastPoint[]): ForecastChartPoint[] {
  const byDate = new Map<string, FleetForecastPoint[]>();
  points.forEach((point) => {
    const date = point.forecast_date.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), point]);
  });
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => {
      const average = (field: keyof Pick<
        FleetForecastPoint,
        'expected_utilization_pct' | 'lower_utilization_pct' | 'upper_utilization_pct'
      >) => values.reduce((sum, value) => sum + value[field], 0) / values.length;
      const lower = average('lower_utilization_pct');
      const upper = average('upper_utilization_pct');
      return {
        date,
        expected: Math.round(average('expected_utilization_pct') * 10) / 10,
        lower: Math.round(lower * 10) / 10,
        uncertainty: Math.round((upper - lower) * 10) / 10,
        upper: Math.round(upper * 10) / 10,
      };
    });
}

export function formatMinorUnits(amount: number, currency: string | null): string {
  if (!currency) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100);
}
