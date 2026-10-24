import type {
  FleetAssignment,
  FleetCostCenter,
  FleetForecastPoint,
  FleetReservation,
  FleetWorkOrder,
} from '@/api/hooks/useFleetOps';
import { ymdInTz } from '@/lib/dateConvert';
import { getGlobalLocale, getGlobalPrecision, isFiniteNumber } from '@/lib/numberFormat';

export function reservationCalendarDays(items: FleetReservation[], tz: string) {
  const days = new Map<string | null, FleetReservation[]>();
  for (const item of items) {
    const day = item.starts_at ? ymdInTz(new Date(item.starts_at), tz) : null;
    const reservations = days.get(day) ?? [];
    reservations.push(item);
    days.set(day, reservations);
  }
  return [...days.entries()].map(([day, reservations]) => ({ day, reservations }));
}

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
  cost_minor: number | null;
  currency: string | null;
  cost_state: 'known' | 'partial' | 'unknown';
  /** Finite amounts with a valid currency; mixed currencies are never summed. */
  qualifying_cost_count: number;
  work_order_count: number;
}

export function costCenterAllocations(
  costCenters: FleetCostCenter[],
  reservations: FleetReservation[],
  workOrders: FleetWorkOrder[],
): CostCenterAllocation[] {
  return costCenters.map((costCenter) => {
    const relatedOrders = workOrders.filter((item) => item.cost_center_id === costCenter.id);
    const qualifyingOrders = relatedOrders.filter(
      (item): item is FleetWorkOrder & { cost_minor: number; currency: string } =>
        isFiniteNumber(item.cost_minor) && isCurrencyCode(item.currency),
    );
    const currencies = new Set(
      qualifyingOrders.map((item) => item.currency.toUpperCase()),
    );
    // A subtotal is meaningful only when its qualifying records share a currency.
    const subtotal = qualifyingOrders.reduce((sum, item) => sum + item.cost_minor, 0);
    const cost = qualifyingOrders.length > 0 && currencies.size === 1 && isFiniteNumber(subtotal)
      ? subtotal
      : null;
    return {
      cost_center: costCenter,
      reservation_count: reservations.filter((item) => item.cost_center_id === costCenter.id).length,
      open_work_order_count: relatedOrders.filter(
        (item) => item.status !== 'completed' && item.status !== 'cancelled',
      ).length,
      cost_minor: cost,
      currency: currencies.size === 1 ? [...currencies][0] : null,
      cost_state: cost === null
        ? 'unknown'
        : qualifyingOrders.length === relatedOrders.length ? 'known' : 'partial',
      qualifying_cost_count: qualifyingOrders.length,
      work_order_count: relatedOrders.length,
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

export function formatMinorUnits(
  amount: number | null | undefined,
  currency: string | null,
  options: { locale?: string; precision?: number } = {},
): string {
  if (!isCurrencyCode(currency) || !isFiniteNumber(amount)) return '—';
  const locale = options.locale ?? getGlobalLocale();
  // The source currency's exponent is independent of the user's display precision.
  const exponent = new Intl.NumberFormat(locale, {
    style: 'currency', currency,
  }).resolvedOptions().maximumFractionDigits ?? 0;
  const precision = options.precision ?? getGlobalPrecision();
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
  return formatter.format(amount / 10 ** exponent);
}

function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]{3}$/i.test(value);
}
