import { useQuery } from '@tanstack/react-query';

import { request } from '../client';

interface AnalyticsSummary {
  totalVehicles: number;
  totalDrives: number;
  totalChargingSessions: number;
  totalDistanceKm: number;
  totalEnergyKwh: number;
  totalCost: number;
  avgEfficiencyWhKm: number;
  co2SavedKg: number;
  vehicleComparison: VehicleComparisonEntry[];
}

interface VehicleComparisonEntry {
  id: string;
  name: string;
  distance: number;
  energy: number;
  efficiency: number;
}

interface MileageStats {
  vehicle_id: number;
  lifetime_km: number;
  last_7d_km: number;
  last_30d_km: number;
  last_365d_km: number;
  drive_count_lifetime: number;
  drive_count_30d: number;
  first_drive_at: string | null;
  last_drive_at: string | null;
}

interface MonthlyMileageBucket {
  year_month: string;
  drive_count: number;
  total_km: number;
  total_wh_consumed: number | null;
  avg_efficiency_wh_per_km: number | null;
}

interface MonthlyMileageResponse {
  vehicle_id: number;
  months: MonthlyMileageBucket[];
}

interface DailyMileageBucket {
  date: string;
  drive_count: number;
  total_km: number;
  end_odometer_km: number | null;
}

interface DailyMileageResponse {
  vehicle_id: number;
  days: DailyMileageBucket[];
}

interface CostBreakdown {
  total_charging_cost: number;
  total_wh: number;
  total_sessions: number;
  total_km: number;
  first_date: string;
  last_date: string;
  equivalent_gas_cost: number;
  total_savings: number;
  monthly_savings: number;
  cost_per_km_ev: number;
  cost_per_km_ice: number;
  maintenance_savings_estimate: number;
  months_of_ownership: number;
  gas_price: number;
  gas_efficiency_mpg: number;
  monthly_breakdown: MonthlyCostEntry[];
}

interface MonthlyCostEntry {
  month: string;
  ev_cost: number;
  equiv_gas_cost: number;
  cumulative_savings: number;
  energy_wh: number;
}

interface TimelineEvent {
  id: string;
  state: string;
  startDate: string;
  durationMin: number;
}

interface StateSummary {
  state: string;
  totalMin: number;
  count: number;
}

interface WeeklyDigestData {
  drives: number;
  distanceKm: number;
  energyKwh: number;
  cost: number;
  efficiency: number;
  prevDrives: number;
  prevDistanceKm: number;
  prevEnergyKwh: number;
  prevCost: number;
  prevEfficiency: number;
}

interface StatsSummary {
  min: number;
  max: number;
  avg: number;
  median: number;
  p95: number;
  count: number;
}

interface FleetAnalytics {
  period_days: number;
  total_vehicles: number;
  total_distance_km: number;
  total_drives: number;
  total_charging_sessions: number;
  total_energy_kwh: number;
  total_cost: number;
  avg_efficiency_wh_km: number;
  most_efficient_vehicle: {
    id: number;
    name: string;
    efficiency: number;
  } | null;
  vehicle_comparison: Array<{
    id: number;
    name: string;
    distance: number;
    energy: number;
    efficiency: number;
    drives: number;
  }>;
  drive_analytics: {
    hourly_pattern: Array<{ hour: number; drives: number; distance: number }>;
    day_of_week: Array<{
      day: string;
      drives: number;
      distance: number;
      avg_distance: number;
    }>;
    speed_distribution: Array<{ range: string; count: number }>;
    distance_distribution: Array<{ range: string; count: number }>;
    speed_stats: StatsSummary;
    power_stats: StatsSummary;
    regen_stats: StatsSummary;
    duration_stats: StatsSummary;
    distance_stats: StatsSummary;
    efficiency_stats: StatsSummary;
    daily_trend: Array<{
      date: string;
      drives: number;
      distance: number;
      efficiency?: number;
    }>;
    temp_vs_efficiency: Array<{
      temp: number;
      efficiency: number;
      distance: number;
    }>;
    duration_distribution?: Array<{ range: string; count: number }>;
    temperature: { inside: StatsSummary; outside: StatsSummary };
  };
  charging_analytics: {
    hourly_pattern: Array<{ hour: number; charges: number; energy: number }>;
    charger_types: Array<{ type: string; count: number }>;
    charger_brands: Array<{ brand: string; count: number }>;
    monthly_trend: Array<{
      month: string;
      energy: number;
      cost: number;
      sessions: number;
      avg_power: number;
      gas_cost: number;
      savings: number;
    }>;
    power_stats: StatsSummary;
    duration_stats: StatsSummary;
    energy_stats: StatsSummary;
    cost_stats: StatsSummary;
    start_battery_dist: Array<{ range: string; count: number }>;
    efficiency_stats: StatsSummary;
  };
  battery_trend: Array<{
    date: string;
    health_score: number;
    capacity_wh: number;
    degradation_pct: number;
    range_km: number;
    cycle_count: number;
  }>;
}

interface YearReviewDriveHighlight {
  drive_id: number;
  date: string;
  distance_km: number;
  duration_min: number;
  start_address: string;
  end_address: string;
  efficiency_wh_km: number;
}

interface YearReviewMonthStat {
  month: number;
  drives: number;
  distance_km: number;
  energy_wh: number;
  cost: number;
}

interface YearReviewComparison {
  label: string;
  value: string;
  emoji: string;
}

interface YearReview {
  year: number;
  vehicle: {
    id: number;
    display_name: string;
    model: string;
  };
  total_drives: number;
  total_distance_km: number;
  total_energy_kwh: number;
  total_charge_sessions: number;
  total_driving_minutes: number;
  total_charging_cost: number;
  gas_savings: number;
  co2_offset_kg: number;
  longest_drive: YearReviewDriveHighlight | null;
  shortest_drive: YearReviewDriveHighlight | null;
  most_efficient_drive: YearReviewDriveHighlight | null;
  least_efficient_drive: YearReviewDriveHighlight | null;
  fastest_speed_kmh: number;
  coldest_drive_temp_c: number;
  hottest_drive_temp_c: number;
  monthly_stats: YearReviewMonthStat[];
  most_active_day_of_week: string;
  most_active_hour: number;
  avg_drives_per_week: number;
  avg_distance_per_drive_km: number;
  avg_efficiency_wh_km: number;
  supercharger_pct: number;
  dc_fast_pct: number;
  ac_other_pct: number;
  avg_charge_start_soc: number;
  comparisons: YearReviewComparison[];
}

const STALE_TIMES = {
  SLOW: 5 * 60_000,
  STATIC: Infinity,
} as const;

function safeArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  console.warn('[safeArray] Expected array, got:', typeof value);
  return [];
}

export const analyticsKeys = {
  summary: (days: number) => ['analytics', 'summary', days] as const,
  fleet: (days: number | undefined, start?: string, end?: string) =>
    ['analytics', 'fleet', days, start, end] as const,
  mileage: (vehicleId: string) => ['analytics', 'mileage', vehicleId] as const,
  monthlyMileage: (vehicleId: string) =>
    ['analytics', 'monthly-mileage', vehicleId] as const,
  dailyMileage: (vehicleId: string, days: number) =>
    ['analytics', 'daily-mileage', vehicleId, days] as const,
  cost: (vehicleId: string) => ['analytics', 'cost', vehicleId] as const,
  timeline: (vehicleId: string) =>
    ['analytics', 'timeline', vehicleId] as const,
  stateSummary: (vehicleId: string) =>
    ['analytics', 'state-summary', vehicleId] as const,
  weeklyDigest: (vehicleId: string) =>
    ['analytics', 'weekly-digest', vehicleId] as const,
  lifetime: (vehicleId?: string) => ['analytics', 'lifetime', vehicleId] as const,
};

export function useAnalyticsSummary(days = 30) {
  return useQuery({
    queryKey: analyticsKeys.summary(days),
    queryFn: ({ signal }) =>
      request<AnalyticsSummary>(`/analytics/fleet?days=${days}`, { signal }),
  });
}

export function useFleetAnalytics(
  arg: number | { days?: number; start?: string; end?: string } = {},
  startLegacy?: string,
) {
  const opts: { days?: number; start?: string; end?: string } =
    typeof arg === 'number' ? { days: arg, start: startLegacy } : arg;

  const params = new URLSearchParams();
  if (opts.start) {
    params.append('start', opts.start);
  }
  if (opts.end) {
    params.append('end', opts.end);
  }
  if (!opts.start && !opts.end && opts.days != null) {
    params.append('days', String(opts.days));
  }
  const qs = params.toString();

  return useQuery({
    queryKey: analyticsKeys.fleet(opts.days, opts.start, opts.end),
    queryFn: ({ signal }) =>
      request<FleetAnalytics>(qs ? `/analytics/fleet?${qs}` : '/analytics/fleet', {
        signal,
      }),
  });
}

export function useMileageStats(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.mileage(vehicleId),
    queryFn: ({ signal }) =>
      request<MileageStats>(`/mileage/stats?vehicle_id=${vehicleId}`, {
        signal,
      }),
    enabled: !!vehicleId,
  });
}

export function useMonthlyMileage(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.monthlyMileage(vehicleId),
    queryFn: ({ signal }) =>
      request<MonthlyMileageResponse>(`/mileage/monthly?vehicle_id=${vehicleId}`, {
        signal,
      }),
    enabled: !!vehicleId,
    select: resp => safeArray<MonthlyMileageBucket>(resp?.months),
  });
}

export function useDailyMileage(vehicleId: string, days = 90) {
  return useQuery({
    queryKey: analyticsKeys.dailyMileage(vehicleId, days),
    queryFn: ({ signal }) =>
      request<DailyMileageResponse>(
        `/mileage/daily?vehicle_id=${vehicleId}&days=${days}`,
        { signal },
      ),
    enabled: !!vehicleId,
    select: resp => safeArray<DailyMileageBucket>(resp?.days),
  });
}

export function useCostBreakdown(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.cost(vehicleId),
    queryFn: ({ signal }) =>
      request<CostBreakdown>(`/analytics/tco?vehicle_id=${vehicleId}`, {
        signal,
      }),
    enabled: !!vehicleId,
  });
}

export function useTimeline(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.timeline(vehicleId),
    queryFn: ({ signal }) =>
      request<{ transitions: TimelineEvent[] }>(
        `/vehicle-states/timeline?vehicle_id=${vehicleId}`,
        { signal },
      ),
    enabled: !!vehicleId,
    select: data => safeArray(data?.transitions),
  });
}

export function useStateSummary(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.stateSummary(vehicleId),
    queryFn: ({ signal }) =>
      request<StateSummary[]>(`/vehicle-states/summary?vehicle_id=${vehicleId}`, {
        signal,
      }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useWeeklyDigest(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.weeklyDigest(vehicleId),
    queryFn: ({ signal }) =>
      request<WeeklyDigestData>(`/vehicles/${vehicleId}/weekly-digest`, {
        signal,
      }),
    enabled: !!vehicleId,
    retry: false,
    staleTime: STALE_TIMES.STATIC,
  });
}

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
  total_drives: number;
  total_distance_km: number;
  total_driving_hours: number;
  longest_drive_km: number;
  highest_speed_kmh: number;
  avg_efficiency_wh_km: number;
  total_charge_sessions: number;
  total_energy_kwh: number;
  total_charging_hours: number;
  total_charging_cost: number;
  gas_equivalent_cost: number;
  total_savings: number;
  co2_offset_kg: number;
  trees_equivalent: number;
  earth_circumferences: number;
  moon_trips: number;
  days_on_road: number;
  homes_equivalent_days: number;
  first_drive_date: string | null;
  ownership_days: number;
  most_active_day_of_week: string;
  most_active_hour: number;
  longest_drive_record: PersonalRecord;
  highest_speed_record: PersonalRecord;
  max_charge_record: PersonalRecord;
  achievements: LifetimeAchievement[];
}

export function useLifetimeStats(vehicleId?: string) {
  return useQuery({
    queryKey: analyticsKeys.lifetime(vehicleId),
    queryFn: ({ signal }) =>
      request<LifetimeStats>(
        `/analytics/lifetime${vehicleId ? `?vehicle_id=${vehicleId}` : ''}`,
        { signal },
      ),
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useYearReview(year: number, vehicleId?: string) {
  return useQuery({
    queryKey: ['year-review', year, vehicleId] as const,
    queryFn: ({ signal }) =>
      request<YearReview>(
        `/analytics/year-review?year=${year}${
          vehicleId ? `&vehicle_id=${vehicleId}` : ''
        }`,
        { signal },
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STATIC,
  });
}
