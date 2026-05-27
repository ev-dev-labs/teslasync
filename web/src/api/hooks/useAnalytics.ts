import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES } from '@/lib/constants';
import type { AnalyticsSummary, MileageStats, CostBreakdown, TimelineEvent, StateSummary, WeeklyDigestData, MonthlyMileageBucket, MonthlyMileageResponse, DailyMileageBucket, DailyMileageResponse } from '@/types/analytics';
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
 * GET /mileage/stats — Phase-43a / Prompt 0004 restored the endpoint
 * deleted by Phase-42 / 0077. Returns a `MileageStats` snake_case
 * lifetime + window rollup; distances are kilometres (SI in DB,
 * converted at the SELECT list). Phase-43a / Prompt 0009 (fix/misc-fixes)
 * dropped the stale `@deprecated` banner that pointed at the now-restored
 * endpoint family.
 */
export function useMileageStats(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.mileage(vehicleId),
    queryFn: ({ signal }) => request<MileageStats>(`/mileage/stats?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
  });
}

/**
 * GET /mileage/monthly — Phase-43a / Prompt 0004 restoration. Unwraps
 * the `{vehicle_id, months}` envelope so callers receive a plain array
 * of `MonthlyMileageBucket` and don't have to know the envelope shape.
 * Phase-43a / Prompt 0009 (fix/misc-fixes) corrected the response shape
 * (previously typed as the legacy camelCase `MonthlyStat[]`).
 */
export function useMonthlyMileage(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.monthlyMileage(vehicleId),
    queryFn: ({ signal }) => request<MonthlyMileageResponse>(`/mileage/monthly?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: (resp) => safeArray<MonthlyMileageBucket>(resp?.months),
  });
}

/**
 * GET /mileage/daily — Phase-43a / Prompt 0009 (fix/misc-fixes) added
 * the per-day endpoint so MileagePage's Odometer Over Time and Daily
 * Distance charts can render again. Unwraps the `{vehicle_id, days}`
 * envelope into a plain array.
 */
export function useDailyMileage(vehicleId: string, days = 90) {
  return useQuery({
    queryKey: analyticsKeys.dailyMileage(vehicleId, days),
    queryFn: ({ signal }) => request<DailyMileageResponse>(`/mileage/daily?vehicle_id=${vehicleId}&days=${days}`, { signal }),
    enabled: !!vehicleId,
    select: (resp) => safeArray<DailyMileageBucket>(resp?.days),
  });
}

export function useCostBreakdown(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.cost(vehicleId),
    queryFn: ({ signal }) => request<CostBreakdown>(`/analytics/tco?vehicle_id=${vehicleId}`, { signal }),
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
    queryFn: ({ signal }) => request<{ transitions: TimelineEvent[] }>(`/vehicle-states/timeline?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: (data) => safeArray(data?.transitions),
  });
}

/** @deprecated See `useTimeline` — `/vehicle-states/summary` was removed by Phase-42 / Prompt 0077. */
export function useStateSummary(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.stateSummary(vehicleId),
    queryFn: ({ signal }) => request<StateSummary[]>(`/vehicle-states/summary?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useWeeklyDigest(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.weeklyDigest(vehicleId),
    queryFn: ({ signal }) => request<WeeklyDigestData>(`/vehicles/${vehicleId}/weekly-digest`, { signal }),
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
        `/analytics/lifetime${vehicleId ? `?vehicle_id=${vehicleId}` : ''}`, { signal },
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
        `/analytics/year-review?year=${year}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`, { signal },
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STATIC,
  });
}
