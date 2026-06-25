import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import { request } from '../client';
import { useMutationToast } from './_toastHelpers';

const INTERVALS = {
  REALTIME: 5_000,
  STANDARD: 30_000,
} as const;

const STALE_TIMES = {
  STANDARD: 60_000,
  SLOW: 5 * 60_000,
  STATIC: Infinity,
} as const;

const AS_OF_QUERY_PARAM = 'as_of';
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export const nativeEnergyHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  asOfDateUrlStateAvailable: false,
  batteryHealthAsOfMode: 'live-state-only',
  mutationFeedbackPrimitive: 'Alert.alert',
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

function invalidateAndBroadcast(
  qc: QueryClient,
  filters: { queryKey: QueryKey },
): void {
  void qc.invalidateQueries(filters);
}

function useAsOfDate(): { asOf: string | null } {
  return { asOf: null };
}

export interface EnergyStats {
  total_energy_used_wh: number;
  total_energy_charged_wh: number;
  total_wh: number;
  total_cost: number;
  total_distance_m: number;
  avg_efficiency_wh_per_m: number;
  co2_saved_kg: number;
  daily_breakdown: DailyEnergy[];
}

export interface DailyEnergy {
  date: string;
  energy_wh: number;
  cost: number;
  distance_m: number;
  efficiency_wh_per_m: number;
}

export interface BatteryHealth {
  health_score: number;
  degradation_pct: number;
  current_capacity_pct: number;
  total_cycles: number;
  estimated_range_current_km: number;
  estimated_range_new_km: number;
  monthly_trend: MonthlyTrend[];
}

export interface MonthlyTrend {
  month: string;
  capacity_pct: number;
  range_km: number;
}

export interface BatteryCell {
  cell_id: number;
  module: number;
  voltage: number;
  temperature: number;
}

export interface BatteryCellSummary {
  total_cells: number;
  avg_voltage: number;
  min_voltage: number;
  max_voltage: number;
  voltage_spread: number;
  avg_temperature: number;
  min_temperature: number;
  max_temperature: number;
  temp_spread: number;
  cells: BatteryCell[];
}

export interface DegradationData {
  current_health: number;
  current_capacity: number;
  current_cycles: number;
  current_range: number;
  current_temp: number;
  stress_level: 'Low' | 'Medium' | 'High';
  fast_charge_ratio: number;
  snapshots: unknown[];
  monthly_trend: DegradationTrend[];
  prediction: DegradationPrediction | null;
  charging_habits: ChargingHabits | null;
  current_health_pct: number;
  degradation_rate_pct_per_month: number;
  projected_80pct_date: string | null;
  projections: PredictiveProjection[];
  risk_factors: RiskFactorData[];
  recommendations: string[];
}

export interface DegradationTrend {
  month: string;
  avg_health: number;
  avg_capacity: number;
  avg_range: number;
}

export interface DegradationPrediction {
  has_enough_data: boolean;
  slope_per_year: number;
  years_to_80_pct: number;
  predicted_date: string | null;
  projection_points: { month: string; health: number }[];
}

export interface ChargingHabits {
  fast_charge_count: number;
  slow_charge_count: number;
  deep_discharge_count: number;
  charge_to_full_count: number;
  high_soc_count: number;
  total_count: number;
}

export interface PredictiveProjection {
  date: string;
  health_pct: number;
  confidence_low: number;
  confidence_high: number;
}

export interface RiskFactorData {
  name: string;
  score: number;
  label: string;
  detail: string;
}

export interface BatteryHealthAnalytics {
  current_soh: number;
  estimated_capacity: number;
  original_capacity: number;
  degradation_rate_yr: number;
  battery_age_months: number;
  total_cycles: number;
  avg_depth_of_discharge: number;
  fast_charge_pct: number;
  full_charge_pct: number;
  charge_habits_score: number;
  temp_exposure_score: number;
  history: BatteryHealthSnapshot[];
}

export interface BatteryHealthSnapshot {
  date: string;
  odometer: number;
  soh_pct: number;
  capacity_wh: number;
  range_km: number;
}

export interface EnergyFlowData {
  dc_charging_power: number | null;
  ac_charging_power: number | null;
  energy_remaining: number | null;
  pack_voltage: number | null;
  pack_current: number | null;
  soc: number | null;
  charge_state: string | null;
}

export interface VampireDrainStats {
  avg_drain_rate: number;
  total_range_lost: number;
  total_hours: number;
  event_count: number;
  avg_sentry_drain: number;
  avg_nosentry_drain: number;
}

export interface VampireDrainEvent {
  id: number;
  start_date: string;
  duration_hours: number;
  battery_lost: number;
  drain_rate_pct_per_hour: number;
  outside_temp_avg: number | null;
  sentry_mode: boolean;
}

export interface ProjectedRangeData {
  current_range_km: number;
  new_range_km: number;
  degradation_pct: number;
  total_cycles: number;
  health_score: number;
  current_capacity_pct: number;
  avg_daily_km: number;
}

export interface SleepEfficiencyData {
  sleep_efficiency_pct: number;
  time_to_sleep_avg_min: number;
  sentry_on_drain_rate: number;
  sentry_off_drain_rate: number;
  sentry_monthly_cost: number;
  sentry_monthly_kwh: number;
  sentry_extra_drain_rate: number;
  sentry_extra_monthly_kwh: number;
  sentry_extra_monthly_cost: number;
  state_distribution: { state: string; total_minutes: number }[];
  sentry_comparison: {
    sentry_mode: boolean;
    avg_drain_rate: number;
    avg_battery_lost: number;
  }[];
  recent_events: SleepDrainEvent[];
}

export interface SleepDrainEvent {
  id: number;
  start_date: string;
  duration_hours: number;
  battery_lost: number;
  drain_rate: number;
  sentry_mode: boolean;
  outside_temp: number | null;
}

export interface TeslaEnergyHistoryEntry {
  id: number;
  energy_site_id: number;
  period: string;
  timestamp: string;
  solar_energy_wh: number | null;
  battery_energy_in_wh: number | null;
  battery_energy_out_wh: number | null;
  grid_energy_in_wh: number | null;
  grid_energy_out_wh: number | null;
  consumer_energy_wh: number | null;
  fetched_at: string;
}

export interface TeslaBackupEvent {
  id: number;
  energy_site_id: number;
  period: string;
  timestamp: string;
  duration_seconds: number;
  fetched_at: string;
}

export interface TeslaWCChargingEntry {
  id: number;
  energy_site_id: number;
  din: string | null;
  timestamp: string;
  energy_wh: number | null;
  fetched_at: string;
}

export interface TeslaEnergySite {
  id: number;
  energy_site_id: number;
  resource_type: string;
  site_name: string;
  gateway_id: string | null;
  total_pack_energy: number | null;
  percentage_charged: number | null;
  battery_type: string | null;
  backup_capable: boolean;
  storm_mode_enabled: boolean;
  has_solar: boolean;
  has_battery: boolean;
  has_grid: boolean;
  has_load_meter: boolean;
  tou_capable: boolean;
  storm_mode_capable: boolean;
  fetched_at: string;
  created_at: string;
  updated_at: string;
  site_info_fetched_at: string | null;
}

export interface TeslaEnergySiteInfo {
  site_name?: string;
  time_zone_offset?: number;
  installation_time_zone?: string;
  backup_reserve_percent?: number;
  default_real_mode?: string;
  version?: string;
  battery_count?: number;
  nameplate_power?: number;
  nameplate_energy?: number;
  components?: {
    solar?: boolean;
    battery?: boolean;
    grid?: boolean;
    load_meter?: boolean;
    tou_capable?: boolean;
    storm_mode_capable?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface TeslaEnergySiteInfoResponse {
  data: TeslaEnergySiteInfo | null;
  fetched_at: string | null;
}

export interface TeslaEnergyLiveStatus {
  id: number;
  energy_site_id: number;
  solar_power: number | null;
  battery_power: number | null;
  load_power: number | null;
  grid_power: number | null;
  grid_services_power: number | null;
  energy_left: number | null;
  total_pack_energy: number | null;
  percentage_charged: number | null;
  grid_status: string | null;
  backup_capable: boolean | null;
  storm_mode_active: boolean | null;
  raw_json?: string;
  timestamp: string;
  fetched_at: string;
}

export interface TOUSettingsPayload {
  tou_settings: {
    optimization_strategy?: string;
    tariff_content_v2?: TariffContentV2;
    [key: string]: unknown;
  };
}

export interface TariffContentV2 {
  name?: string;
  utility?: string;
  daily_charges?: Array<{ amount: number; name?: string }>;
  demand_charges?: Record<string, Record<string, number>>;
  energy_charges?: Record<
    string,
    Record<string, Array<{ rate: number; start: number; end: number }>>
  >;
  seasons?: Record<
    string,
    { fromMonth: number; fromDay: number; toMonth: number; toDay: number }
  >;
  [key: string]: unknown;
}

export interface TOUPreset {
  id: string;
  name: string;
  utility: string;
  settings: TOUSettingsPayload;
}

export function useEnergyStats(vehicleId: string | null, days = 30) {
  return useQuery({
    queryKey: ['energy-stats', vehicleId, days],
    queryFn: ({ signal }) =>
      request<EnergyStats>(`/vehicles/${vehicleId}/energy?days=${days}`, {
        signal,
      }),
    enabled: vehicleId !== null,
  });
}

export function useBatteryHealth(vehicleId: string | null) {
  const { asOf } = useAsOfDate();
  const path = asOf
    ? `/vehicles/${vehicleId}/battery?${AS_OF_QUERY_PARAM}=${encodeURIComponent(
        asOf,
      )}`
    : `/vehicles/${vehicleId}/battery`;
  return useQuery({
    queryKey: asOf
      ? ['battery-health', vehicleId, asOf]
      : ['battery-health', vehicleId],
    queryFn: ({ signal }) => request<BatteryHealth>(path, { signal }),
    enabled: vehicleId !== null,
  });
}

export function useBatteryCells(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-cells', vehicleId],
    queryFn: ({ signal }) =>
      request<BatteryCellSummary>(`/vehicles/${vehicleId}/battery/cells`, {
        signal,
      }),
    enabled: vehicleId !== null,
    retry: false,
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useBatteryHealthAnalytics(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-health-analytics', vehicleId],
    queryFn: ({ signal }) =>
      request<BatteryHealthAnalytics>(
        `/analytics/battery-health?vehicle_id=${vehicleId}`,
        { signal },
      ),
    enabled: vehicleId !== null,
  });
}

export function useBatteryDegradation(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-degradation', vehicleId],
    queryFn: ({ signal }) =>
      request<DegradationData>(
        `/analytics/battery-degradation?vehicle_id=${vehicleId}`,
        { signal },
      ),
    enabled: vehicleId !== null,
  });
}

export function useEnergyFlow(vehicleId: string | null) {
  return useQuery({
    queryKey: ['energy-flow', vehicleId],
    queryFn: ({ signal }) =>
      request<EnergyFlowData>(`/vehicles/${vehicleId}/energy/flow`, { signal }),
    enabled: vehicleId !== null,
    refetchInterval: INTERVALS.REALTIME,
    retry: false,
    staleTime: STALE_TIMES.STATIC,
  });
}

/**
 * DEPRECATED. The backend `/vampire-drain/stats`
 * route was deleted alongside the `vampire_drain_events` table; this hook
 * will reliably 404 in production. Kept (not removed) because the
 * `features/dashboard` VampireDrainWidget and the legacy VampireDrainPage
 * still call it; their UI surfaces the resulting query error gracefully.
 * A future replacement should derive vampire-drain metrics from `signal_log`
 * (BatteryLevel + IdleNumberOfMinutes) and route through `useSleepEfficiency`
 * style aggregates.
 */
export function useVampireDrainStats(vehicleId: string | null) {
  return useQuery({
    queryKey: ['vampire-drain-stats', vehicleId],
    queryFn: ({ signal }) =>
      request<VampireDrainStats>(
        `/vampire-drain/stats?vehicle_id=${vehicleId}`,
        { signal },
      ),
    enabled: vehicleId !== null,
  });
}

/**
 * DEPRECATED. See `useVampireDrainStats` for the
 * deletion rationale and migration plan. Returns 404 from the backend.
 */
export function useVampireDrainEvents(vehicleId: string | null, limit = 50) {
  return useQuery({
    queryKey: ['vampire-drain-events', vehicleId, limit],
    queryFn: ({ signal }) =>
      request<VampireDrainEvent[]>(
        `/vampire-drain?vehicle_id=${vehicleId}&limit=${limit}`,
        { signal },
      ),
    enabled: vehicleId !== null,
    select: safeArray,
  });
}

export function useProjectedRange(vehicleId: string | null) {
  return useQuery({
    queryKey: ['projected-range', vehicleId],
    queryFn: ({ signal }) =>
      request<ProjectedRangeData>(
        `/vehicles/${vehicleId}/battery/projected-range`,
        { signal },
      ),
    enabled: vehicleId !== null,
    retry: false,
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useSleepEfficiency(
  vehicleId: string | null,
  days = 30,
  startDate?: string,
  endDate?: string,
) {
  const dateParams =
    startDate && endDate ? `&start=${startDate}&end=${endDate}` : '';
  return useQuery({
    queryKey: [
      'sleep-efficiency',
      vehicleId,
      days,
      startDate ?? '',
      endDate ?? '',
    ],
    queryFn: ({ signal }) =>
      request<SleepEfficiencyData>(
        `/analytics/sleep?vehicle_id=${vehicleId}&days=${days}${dateParams}`,
        { signal },
      ),
    enabled: vehicleId !== null,
  });
}

export function useTeslaEnergySites() {
  return useQuery({
    queryKey: ['tesla-energy-sites'],
    queryFn: ({ signal }) =>
      request<TeslaEnergySite[]>('/tesla/energy-sites', { signal }),
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function useRefreshTeslaEnergySites() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<TeslaEnergySite[]>('/tesla/energy-sites/refresh', {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-energy-sites'] });
      success('toast.energy.sites.success', 'Energy sites refreshed');
    },
    onError: err =>
      error(err, 'toast.energy.sites.error', 'Failed to refresh energy sites'),
  });
}

export function useTeslaEnergySiteInfo(siteId?: number) {
  return useQuery({
    queryKey: ['tesla-site-info', siteId],
    queryFn: ({ signal }) =>
      request<TeslaEnergySiteInfoResponse>(
        `/tesla/energy-sites/${siteId}/site-info`,
        { signal },
      ),
    enabled: !!siteId,
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useRefreshTeslaEnergySiteInfo() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (siteId: number) =>
      request<TeslaEnergySiteInfoResponse>(
        `/tesla/energy-sites/${siteId}/site-info/refresh`,
        { method: 'POST' },
      ),
    onSuccess: (_data, siteId) => {
      queryClient.invalidateQueries({ queryKey: ['tesla-site-info', siteId] });
      success('toast.energy.siteInfo.success', 'Site info refreshed');
    },
    onError: err =>
      error(err, 'toast.energy.siteInfo.error', 'Failed to refresh site info'),
  });
}

export function useUpdateTOUSettings() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({
      siteId,
      settings,
    }: {
      siteId: number;
      settings: TOUSettingsPayload;
    }) =>
      request(`/tesla/energy-sites/${siteId}/tou-settings`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(settings),
      }),
    onSuccess: (_data, { siteId }) => {
      invalidateAndBroadcast(queryClient, {
        queryKey: ['tesla-site-info', siteId],
      });
      success('toast.energy.tou.success', 'TOU settings saved');
    },
    onError: err =>
      error(err, 'toast.energy.tou.error', 'Failed to save TOU settings'),
  });
}

export function useTeslaEnergyHistory(
  siteId?: number,
  period = 'day',
  since?: string,
  until?: string,
) {
  const params = new URLSearchParams({ period });
  if (since) {
    params.append('since', since);
  }
  if (until) {
    params.append('until', until);
  }

  return useQuery({
    queryKey: ['tesla-energy-history', siteId, period, since, until],
    queryFn: ({ signal }) =>
      request<TeslaEnergyHistoryEntry[]>(
        `/tesla/energy-sites/${siteId}/energy-history?${params.toString()}`,
        { signal },
      ),
    enabled: !!siteId,
    staleTime: STALE_TIMES.SLOW,
    select: safeArray,
  });
}

export function useTeslaBackupHistory(
  siteId?: number,
  since?: string,
  until?: string,
) {
  const params = new URLSearchParams();
  if (since) {
    params.append('since', since);
  }
  if (until) {
    params.append('until', until);
  }

  return useQuery({
    queryKey: ['tesla-backup-history', siteId, since, until],
    queryFn: ({ signal }) =>
      request<TeslaBackupEvent[]>(
        `/tesla/energy-sites/${siteId}/backup-history?${params.toString()}`,
        { signal },
      ),
    enabled: !!siteId,
    staleTime: STALE_TIMES.SLOW,
    select: safeArray,
  });
}

export function useTeslaWCChargingHistory(
  siteId?: number,
  since?: string,
  until?: string,
) {
  const params = new URLSearchParams();
  if (since) {
    params.append('since', since);
  }
  if (until) {
    params.append('until', until);
  }

  return useQuery({
    queryKey: ['tesla-wc-charging-history', siteId, since, until],
    queryFn: ({ signal }) =>
      request<TeslaWCChargingEntry[]>(
        `/tesla/energy-sites/${siteId}/charging-history?${params.toString()}`,
        { signal },
      ),
    enabled: !!siteId,
    staleTime: STALE_TIMES.SLOW,
    select: safeArray,
  });
}

interface RefreshParams {
  siteId: number;
  start_date?: string;
  end_date?: string;
  time_zone?: string;
  period?: string;
}

export function useRefreshTeslaEnergyHistory() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({
      siteId,
      period = 'day',
      start_date,
      end_date,
      time_zone,
    }: RefreshParams) => {
      const params = new URLSearchParams({ period });
      if (start_date) {
        params.append('start_date', start_date);
      }
      if (end_date) {
        params.append('end_date', end_date);
      }
      if (time_zone) {
        params.append('time_zone', time_zone);
      }
      return request<{ entries: TeslaEnergyHistoryEntry[]; upserted: number }>(
        `/tesla/energy-sites/${siteId}/energy-history/refresh?${params.toString()}`,
        { method: 'POST' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-energy-history'] });
      success('toast.energy.history.success', 'Energy history refreshed');
    },
    onError: err =>
      error(
        err,
        'toast.energy.history.error',
        'Failed to refresh energy history',
      ),
  });
}

export function useRefreshTeslaBackupHistory() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({
      siteId,
      period = 'day',
      start_date,
      end_date,
      time_zone,
    }: RefreshParams) => {
      const params = new URLSearchParams({ period });
      if (start_date) {
        params.append('start_date', start_date);
      }
      if (end_date) {
        params.append('end_date', end_date);
      }
      if (time_zone) {
        params.append('time_zone', time_zone);
      }
      return request<{ entries: TeslaBackupEvent[]; upserted: number }>(
        `/tesla/energy-sites/${siteId}/backup-history/refresh?${params.toString()}`,
        { method: 'POST' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-backup-history'] });
      success('toast.energy.backup.success', 'Backup history refreshed');
    },
    onError: err =>
      error(
        err,
        'toast.energy.backup.error',
        'Failed to refresh backup history',
      ),
  });
}

export function useRefreshTeslaWCChargingHistory() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({
      siteId,
      start_date,
      end_date,
      time_zone,
    }: RefreshParams) => {
      const params = new URLSearchParams();
      if (start_date) {
        params.append('start_date', start_date);
      }
      if (end_date) {
        params.append('end_date', end_date);
      }
      if (time_zone) {
        params.append('time_zone', time_zone);
      }
      return request<{ entries: TeslaWCChargingEntry[]; upserted: number }>(
        `/tesla/energy-sites/${siteId}/charging-history/refresh?${params.toString()}`,
        { method: 'POST' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['tesla-wc-charging-history'],
      });
      success(
        'toast.energy.wcCharging.success',
        'Wall Connector charging history refreshed',
      );
    },
    onError: err =>
      error(
        err,
        'toast.energy.wcCharging.error',
        'Failed to refresh WC charging history',
      ),
  });
}

export function useTeslaEnergyLiveStatus(siteId?: number) {
  return useQuery({
    queryKey: ['tesla-live-status', siteId],
    queryFn: ({ signal }) =>
      request<TeslaEnergyLiveStatus>(
        `/tesla/energy-sites/${siteId}/live-status`,
        { signal },
      ),
    enabled: !!siteId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useTeslaEnergyLiveStatusHistory(
  siteId?: number,
  since?: string,
  until?: string,
  limit?: number,
) {
  const params = new URLSearchParams();
  if (since) {
    params.append('since', since);
  }
  if (until) {
    params.append('until', until);
  }
  if (limit) {
    params.append('limit', String(limit));
  }

  return useQuery({
    queryKey: ['tesla-live-status-history', siteId, since, until, limit],
    queryFn: ({ signal }) =>
      request<TeslaEnergyLiveStatus[]>(
        `/tesla/energy-sites/${siteId}/live-status/history?${params.toString()}`,
        { signal },
      ),
    enabled: !!siteId,
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function useRefreshTeslaEnergyLiveStatus() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (siteId: number) =>
      request<TeslaEnergyLiveStatus>(
        `/tesla/energy-sites/${siteId}/live-status/refresh`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-live-status'] });
      queryClient.invalidateQueries({
        queryKey: ['tesla-live-status-history'],
      });
      success('toast.energy.liveStatus.success', 'Live status refreshed');
    },
    onError: err =>
      error(
        err,
        'toast.energy.liveStatus.error',
        'Failed to refresh live status',
      ),
  });
}
