import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import { scopeKey, scopedPath, type QueryScope } from '../scope';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES } from '@/lib/constants';
import { browserTimezone } from '@/lib/timezone';
import type { AnalyticsSummary, MileageStats, CostBreakdown, TimelineEvent, StateSummary, WeeklyDigestData, MonthlyMileageBucket, MonthlyMileageResponse, DailyMileageBucket, DailyMileageResponse } from '@/types/analytics';
import { FSD_DEFAULT_PERIOD_DAYS, type FsdInsights } from '@/types/fsd';
import type { FleetAnalytics } from '@/api/types';

export const analyticsKeys = {
  summary: (days: number) => ['analytics', 'summary', days] as const,
  fleet: (days: number | undefined, start?: string, end?: string) =>
    ['analytics', 'fleet', days, start, end] as const,
  mileage: (vehicleId: string) => ['analytics', 'mileage', vehicleId] as const,
  monthlyMileage: (vehicleId: string) => ['analytics', 'monthly-mileage', vehicleId] as const,
  dailyMileage: (vehicleId: string, days: number) => ['analytics', 'daily-mileage', vehicleId, days] as const,
  cost: (vehicleId: string) => ['analytics', 'cost', vehicleId] as const,
  timeline: (vehicleId: string) => ['analytics', 'timeline', vehicleId] as const,
  stateSummary: (vehicleId: string) => ['analytics', 'state-summary', vehicleId] as const,
  weeklyDigest: (vehicleId: string) => ['analytics', 'weekly-digest', vehicleId] as const,
  lifetime: (vehicleId?: string) => ['analytics', 'lifetime', vehicleId] as const,
  batteryCells: (vehicleId: string) => ['analytics', 'battery-cells', vehicleId] as const,
  temperatureImpact: (vehicleId: string) => ['analytics', 'temperature-impact', vehicleId] as const,
  fsdInsights: (scope: QueryScope) => ['analytics', 'fsd', ...scopeKey(scope)] as const,
};

export function useAnalyticsSummary(days = 30) {
  return useQuery({
    queryKey: analyticsKeys.summary(days),
    queryFn: ({ signal }) => request<AnalyticsSummary>(`/analytics/fleet?days=${days}`, { signal }),
  });
}

/**
 * Full fleet analytics with drive/charging/battery deep analytics.
 *
 * Three calling shapes are supported:
 *   - `useFleetAnalytics()`               → no bounds; backend returns full history
 *   - `useFleetAnalytics(30)`             → trailing 30-day window (legacy widget shape)
 *   - `useFleetAnalytics({ start, end })` → explicit range from RangePicker
 *
 * Backend `/analytics/fleet` precedence: `start`/`end` win over `days`; if no
 * bound is supplied the handler returns full history (no hard-coded window).
 */
export function useFleetAnalytics(
  arg: number | { days?: number; start?: string; end?: string } = {},
  startLegacy?: string,
) {
  const opts: { days?: number; start?: string; end?: string } =
    typeof arg === 'number' ? { days: arg, start: startLegacy } : arg;

  const params = new URLSearchParams();
  if (opts.start) params.set('start', opts.start);
  if (opts.end) params.set('end', opts.end);
  if (!opts.start && !opts.end && opts.days != null) params.set('days', String(opts.days));
  const qs = params.toString();

  return useQuery({
    queryKey: analyticsKeys.fleet(opts.days, opts.start, opts.end),
    queryFn: ({ signal }) =>
      request<FleetAnalytics>(qs ? `/analytics/fleet?${qs}` : '/analytics/fleet', { signal }),
  });
}

/**
 * GET /mileage/stats returns a `MileageStats` snake_case lifetime +
 * window rollup. Distances are kilometres, converted from SI at the SELECT list.
 */
export function useMileageStats(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.mileage(vehicleId),
    queryFn: ({ signal }) => request<MileageStats>(`/mileage/stats?vehicle_id=${encodeURIComponent(vehicleId)}`, { signal }),
    enabled: !!vehicleId,
  });
}

/**
 * GET /mileage/monthly unwraps the `{vehicle_id, months}` envelope so
 * callers receive a plain `MonthlyMileageBucket` array.
 */
export function useMonthlyMileage(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.monthlyMileage(vehicleId),
    queryFn: ({ signal }) => request<MonthlyMileageResponse>(`/mileage/monthly?vehicle_id=${encodeURIComponent(vehicleId)}`, { signal }),
    enabled: !!vehicleId,
    select: (resp) => safeArray<MonthlyMileageBucket>(resp?.months),
  });
}

/**
 * GET /mileage/daily unwraps the `{vehicle_id, days}` envelope into a
 * plain array for daily distance charts.
 */
export function useDailyMileage(vehicleId: string, days = 90) {
  return useQuery({
    queryKey: analyticsKeys.dailyMileage(vehicleId, days),
    queryFn: ({ signal }) => request<DailyMileageResponse>(`/mileage/daily?vehicle_id=${encodeURIComponent(vehicleId)}&days=${days}`, { signal }),
    enabled: !!vehicleId,
    select: (resp) => safeArray<DailyMileageBucket>(resp?.days),
  });
}

export function useCostBreakdown(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.cost(vehicleId),
    queryFn: ({ signal }) => request<CostBreakdown>(`/analytics/tco?vehicle_id=${encodeURIComponent(vehicleId)}`, { signal }),
    enabled: !!vehicleId,
  });
}

/**
 * @deprecated Phase-42 / Prompt 0077 removed `/vehicle-states/timeline`
 * along with the `vehicle_states` snapshot table. State transitions are
 * now derived from `signal_log` directly via the FSM endpoints
 * (`/fsm/transitions`). Hook retained so `TimelinePage.tsx` and
 * `StateTimelineWidget.tsx` continue to type-check; the UI surfaces the
 * empty state via the query's `error` channel.
 */
export function useTimeline(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.timeline(vehicleId),
    queryFn: ({ signal }) => request<{ transitions: TimelineEvent[] }>(`/vehicle-states/timeline?vehicle_id=${encodeURIComponent(vehicleId)}`, { signal }),
    enabled: !!vehicleId,
    select: (data) => safeArray(data?.transitions),
  });
}

/** @deprecated See `useTimeline` — `/vehicle-states/summary` was removed by Phase-42 / Prompt 0077. */
export function useStateSummary(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.stateSummary(vehicleId),
    queryFn: ({ signal }) => request<StateSummary[]>(`/vehicle-states/summary?vehicle_id=${encodeURIComponent(vehicleId)}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useWeeklyDigest(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.weeklyDigest(vehicleId),
    queryFn: ({ signal }) => request<WeeklyDigestData>(`/vehicles/${encodeURIComponent(vehicleId)}/weekly-digest`, { signal }),
    enabled: !!vehicleId,
    retry: false,
    staleTime: STALE_TIMES.STATIC,
  });
}

/* ── Lifetime Stats ─────────────────────────────────────────────── */

export interface LifetimeAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number;
  target: number;
  current: number;
}

export interface PersonalRecord {
  value: number;
  date: string | null;
}

export interface LifetimeStats {
  // Driving
  total_drives: number;
  total_distance_km: number;
  total_driving_hours: number;
  longest_drive_km: number;
  highest_speed_kmh: number;
  avg_efficiency_wh_km: number;

  // Charging
  total_charge_sessions: number;
  total_energy_kwh: number;
  total_charging_hours: number;
  total_charging_cost: number;

  // Savings
  gas_equivalent_cost: number;
  total_savings: number;
  co2_offset_kg: number;
  trees_equivalent: number;

  // Fun facts
  earth_circumferences: number;
  moon_trips: number;
  days_on_road: number;
  homes_equivalent_days: number;

  // Timeline
  first_drive_date: string | null;
  ownership_days: number;
  most_active_day_of_week: string;
  most_active_hour: number;

  // Personal records
  longest_drive_record: PersonalRecord;
  highest_speed_record: PersonalRecord;
  max_charge_record: PersonalRecord;

  // Achievements
  achievements: LifetimeAchievement[];
}

export function useLifetimeStats(vehicleId?: string) {
  return useQuery({
    queryKey: analyticsKeys.lifetime(vehicleId),
    queryFn: ({ signal }) =>
      request<LifetimeStats>(
        `/analytics/lifetime${vehicleId ? `?vehicle_id=${encodeURIComponent(vehicleId)}` : ''}`, { signal },
      ),
    staleTime: STALE_TIMES.SLOW,
  });
}

/* ── Year in Review──────────────────────────────────────────────── */

export function useYearReview(year: number, vehicleId?: string) {
  return useQuery({
    queryKey: ['year-review', year, vehicleId] as const,
    queryFn: ({ signal }) =>
      request<import('@/api/types').YearReview>(
        `/analytics/year-review?year=${year}${vehicleId ? `&vehicle_id=${encodeURIComponent(vehicleId)}` : ''}`, { signal },
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STATIC,
  });
}

/* ── Battery Cells ──────────────────────────────────────────────── */

/**
 * Per-cell deviation classification emitted by the backend
 * (`internal/api/batterycells/handler.go`). The wire values are
 * `normal | slight_deviation | significant_deviation` — NOT the legacy
 * `low/high/critical` the page used to assume.
 */
export type CellStatus = 'normal' | 'slight_deviation' | 'significant_deviation';

/**
 * A single synthetic cell reading. The backend numbers cells from 1 via
 * the `cell_number` JSON field (there is no `cell_id`). Voltage is volts
 * (SI); `delta_from_avg` is millivolts.
 */
export interface CellReading {
  cell_number: number;
  voltage: number;
  delta_from_avg: number;
  status: CellStatus;
}

/** One hourly bucket of brick-voltage history (7-day window). */
export interface CellHistoryPoint {
  timestamp: string;
  min_voltage: number;
  max_voltage: number;
  avg_voltage: number;
  imbalance_mv: number;
}

/**
 * GET /analytics/battery-cells response. Voltages are volts (SI),
 * temperatures are °C (SI); format at the display boundary with
 * `useUnits()`. `status === 'no_data'` signals an empty payload (vehicle
 * has never emitted brick voltages).
 */
export interface BatteryCellData {
  status?: string;
  total_cells: number;
  avg_voltage: number;
  min_voltage: number;
  max_voltage: number;
  voltage_spread: number;
  imbalance_mv: number;
  pack_voltage: number;
  avg_temperature: number;
  min_temperature: number;
  max_temperature: number;
  temp_spread: number;
  cells: CellReading[];
  history: CellHistoryPoint[];
  min_cell?: string;
  max_cell?: string;
}

/**
 * GET /analytics/battery-cells?vehicle_id=X — per-cell voltage snapshot
 * plus a 7-day hourly imbalance history. Reads SI directly from the API;
 * callers convert at the render boundary.
 */
export function useBatteryCells(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.batteryCells(vehicleId),
    queryFn: ({ signal }) =>
      request<BatteryCellData>(`/analytics/battery-cells?vehicle_id=${encodeURIComponent(vehicleId)}`, { signal }),
    enabled: !!vehicleId,
  });
}

/* ── Projected Range ────────────────────────────────────────────── */

/** A single named driver of the projection delta (e.g. temperature, speed). */
export interface RangeFactor {
  name: string;
  impact_pct: number;
  description: string;
}

/** One point on the rated-vs-projected range curve, keyed by battery %. */
export interface RangeCurvePoint {
  battery_pct: number;
  rated_range: number;
  projected_range: number;
}

/**
 * One cell of the learned efficiency matrix. `wh_km` is watt-hours per
 * kilometre (the analytics-layer canonical efficiency unit); `samples` is
 * the number of qualifying drives that fed the bucket.
 */
export interface EfficiencyBucket {
  temp_bucket: string;
  speed_bucket: string;
  wh_km: number;
  samples: number;
}

/**
 * A "what your range would be" scenario. Distances are kilometres, speed
 * km/h, temperature °C — format at the render boundary via `useUnits()`.
 */
export interface RangeScenario {
  name: string;
  speed_kmh: number;
  temp_c: number;
  efficiency_wh_km: number;
  range_km: number;
  sample_count: number;
  extras: string[];
  is_current?: boolean;
}

/**
 * GET /analytics/range-projection response. Distances are kilometres,
 * energy watt-hours, temperature °C, speed km/h — all SI-floor analytics
 * units. Never assume display units here; convert at the render boundary.
 */
export interface RangeProjection {
  current_range_km: number;
  projected_range_km: number;
  battery_level: number;
  efficiency_factor: number;
  factors: RangeFactor[];
  projection_curve: RangeCurvePoint[];
  current_battery_pct: number;
  usable_capacity_wh: number;
  health_factor: number;
  scenarios: RangeScenario[];
  efficiency_matrix: EfficiencyBucket[];
  tesla_estimate_km: number;
  your_estimate_km: number;
  accuracy_note: string;
}

/**
 * GET /analytics/range-projection?vehicle_id=X — personalized range
 * projection: your-vs-Tesla estimate, a rated/projected curve, a learned
 * temperature×speed efficiency matrix, and what-if scenarios. Reads SI
 * directly from the API; callers format at the display boundary.
 */
export function useRangeProjection(vehicleId: string) {
  return useQuery({
    queryKey: ['analytics', 'range-projection', vehicleId] as const,
    queryFn: ({ signal }) =>
      request<RangeProjection>(`/analytics/range-projection?vehicle_id=${encodeURIComponent(vehicleId)}`, { signal }),
    enabled: !!vehicleId,
  });
}

/**
 * A single drive plotted on the temperature-vs-efficiency scatter. All
 * physical quantities are SI as emitted by the backend: `outside_temp` is
 * °C, `distance_km` is kilometres (already derived from SI metres in SQL),
 * and `efficiency_wh_km` is watt-hours per kilometre. Format at the display
 * boundary with `useUnits()` — never mutate these on the wire.
 */
export interface TemperatureImpactPoint {
  outside_temp: number;
  efficiency_wh_km: number;
  distance_km: number;
  drive_date: string;
}

/** Server-computed efficiency bucket (kept for API completeness). */
export interface TemperatureImpactEfficiencyBucket {
  temp_bucket: string;
  drive_count: number;
  avg_distance_km: number;
  avg_duration_s: number;
  avg_battery_pct_per_100km: number;
  avg_temp: number;
}

/** One month of the seasonal trend. `avg_temp` is °C (SI). */
export interface TemperatureImpactMonthlyTrend {
  month: string;
  avg_temp: number;
  avg_efficiency: number;
  drive_count: number;
  total_distance: number;
}

/**
 * Full GET /analytics/temperature-impact response. `vampire_drain` is always
 * empty until signal_log reconstruction lands; callers should treat every
 * array as possibly-absent and default with `?? []`.
 */
export interface TemperatureImpactResponse {
  points: TemperatureImpactPoint[];
  efficiency: TemperatureImpactEfficiencyBucket[];
  vampire_drain: unknown[];
  monthly_trend: TemperatureImpactMonthlyTrend[];
}

/**
 * GET /analytics/temperature-impact?vehicle_id=X — how outside ambient
 * temperature affects driving efficiency. Reads SI directly from the API;
 * the page converts temperature/distance at the render boundary via
 * `useUnits()`. Disabled until a vehicle is selected.
 */
export function useTemperatureImpact(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.temperatureImpact(vehicleId),
    queryFn: ({ signal }) =>
      request<TemperatureImpactResponse>(
        `/analytics/temperature-impact?vehicle_id=${encodeURIComponent(vehicleId)}`,
        { signal },
      ),
    enabled: !!vehicleId,
  });
}

/* ── FSD Insights ───────────────────────────────────────────────── */

/**
 * GET /analytics/fsd — server-side rollup of the two resettable SI-meter
 * distance counters (`SelfDrivingMilesSinceReset` / `MilesSinceReset`) into a
 * dense per-local-day series plus explicit data-quality metadata.
 *
 * Why the timezone travels: the backend attributes each observed counter delta
 * to the LOCAL calendar day of the later sample, so the day labels only line up
 * with what the operator experienced if the browser's IANA zone is sent.
 * `browserTimezone()` falls back to `'UTC'` when `Intl` is unavailable, which is
 * also the backend's default — so a degraded environment gets a coherent (if
 * UTC-labelled) answer instead of an error.
 *
 * Returns RAW SI: `*_m` fields are meters. Conversion belongs at the render
 * boundary (`useUnits()` + `lib/unitConversion`), never here.
 *
 * `historical` volatility tier: signal_log is append-only, so the rollup for a
 * given period only changes when new telemetry lands.
 */
export function useFsdInsights(
  vehicleId: string | undefined,
  days: number = FSD_DEFAULT_PERIOD_DAYS,
  timezone: string = browserTimezone(),
) {
  const scope: QueryScope = {
    vehicleId: vehicleId ?? null,
    timezone,
    filters: { days },
  };

  return useQuery({
    queryKey: analyticsKeys.fsdInsights(scope),
    queryFn: ({ signal }) =>
      request<FsdInsights>(
        scopedPath('/analytics/fsd', scope, { includePresentation: true }),
        { signal },
      ),
    enabled: !!vehicleId,
    ...queryPolicy('historical'),
  });
}
