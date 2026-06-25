import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {apiUrl, request} from '../client';
import {useMutationToast} from './_toastHelpers';

const INTERVALS = {
  FAST: 10_000,
} as const;

const STALE_TIMES = {
  SLOW: 5 * 60_000,
  STATIC: Infinity,
} as const;

export const nativeChargingHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  invoiceUrlMode: 'absolute-api-url',
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
  filters: {queryKey: QueryKey},
): void {
  void qc.invalidateQueries(filters);
}

export interface ChargingSession {
  id: string;
  vehicle_id: string;
  charger_type: string | null;
  start_soc_pct: number;
  end_soc_pct: number | null;
  total_energy_added_wh: number;
  peak_power_w: number | null;
  cost_decimal: number | null;
  started_at: string;
  ended_at?: string | null;
  start_ts: string;
  startedAt: string;
  duration_min: number;
  cost?: number | null;
}

export interface CostForecastData {
  historical: CostHistoricalMonth[];
  forecast: CostForecastMonth[];
  breakdown: CostBreakdownData;
  gas_comparison: GasComparisonData;
  insights: string[];
}

export interface CostHistoricalMonth {
  month: string;
  cost: number;
  kwh: number;
  sessions: number;
  cost_per_kwh: number;
}

export interface CostForecastMonth {
  month: string;
  cost: number;
  cost_low: number;
  cost_high: number;
  kwh: number;
}

export interface CostBreakdownData {
  home: ChargerCategoryData;
  supercharger: ChargerCategoryData;
}

export interface ChargerCategoryData {
  pct: number;
  avg_cost_per_kwh: number;
  monthly_avg: number;
}

export interface GasComparisonData {
  avg_km_per_month: number;
  gas_cost_per_month: number;
  ev_cost_per_month: number;
  monthly_savings: number;
  annual_savings: number;
  lifetime_savings: number;
}

export interface ChargingOptimizerData {
  current_schedule: OptimizerSchedule;
  cost_analysis: OptimizerCostAnalysis;
  battery_health_score: number;
  recommendations: OptimizerRecommendation[];
  weekly_heatmap: OptimizerHeatmapEntry[];
}

export interface OptimizerSchedule {
  most_common_start_hour: number;
  most_common_day: string;
  avg_sessions_per_week: number;
  home_charging_pct: number;
  avg_charge_to_pct: number;
}

export interface OptimizerCostAnalysis {
  peak_hours: number[];
  offpeak_hours: number[];
  peak_cost_per_kwh: number;
  offpeak_cost_per_kwh: number;
  sessions_during_peak_pct: number;
  potential_monthly_savings: number;
}

export interface OptimizerRecommendation {
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  estimated_savings?: number;
}

export interface OptimizerHeatmapEntry {
  day: number;
  hour: number;
  sessions: number;
  avg_cost_per_kwh: number;
}

export interface OptimizeChargeRequest {
  vehicle_id: number;
  target_soc: number;
  depart_by: string;
  rate_plan_id: string;
  max_amps?: number;
  battery_capacity_kwh?: number;
  charger_voltage?: number;
  prefer_off_peak?: boolean;
}

export interface ChargeWindow {
  start_time: string;
  end_time: string;
  rate_cents_kwh: number;
  estimated_cost: number;
  rate_tier: string;
}

export interface CostComparison {
  charge_now_cost: number;
  optimized_cost: number;
  savings: number;
  savings_percent: number;
}

export interface HourlyRate {
  hour: number;
  rate_cents: number;
  tier: string;
}

export interface OptimizeChargeResponse {
  plan_id: number;
  current_soc: number;
  target_soc: number;
  kwh_needed: number;
  estimated_duration_hours: number;
  schedule: ChargeWindow;
  comparison: CostComparison;
  alternative_windows: ChargeWindow[];
  hourly_rates: HourlyRate[];
}

export interface ApplyScheduleRequest {
  plan_id: number;
}

export interface ApplyScheduleResponse {
  status: string;
  plan_id: number;
  message: string;
}

export interface ChargePlan {
  id: number;
  vehicle_id: number;
  target_soc: number;
  depart_by: string | null;
  scheduled_start: string;
  scheduled_end: string;
  rate_plan: string;
  estimated_kwh: number | null;
  estimated_cost: number | null;
  charge_now_cost: number | null;
  savings: number | null;
  status: string;
  applied_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface RatePlanInfo {
  id: string;
  name: string;
  utility: string;
}

export interface ApiChargingSession {
  id: number;
  vehicle_id: number;
  started_at: string;
  ended_at: string | null;
  start_soc_pct: number;
  end_soc_pct: number | null;
  delta_soc_pct: number | null;
  start_odometer_m: number | null;
  end_odometer_m: number | null;
  start_lat: number | null;
  start_lng: number | null;
  start_place: string | null;
  total_energy_added_wh: number;
  peak_power_w: number | null;
  avg_power_w: number | null;
  cost_decimal: number | null;
  cost_currency: string | null;
  charger_type: string | null;
  cable_type: string | null;
  live?: boolean;
  start_ts?: string;
  end_ts?: string | null;
  startedAt: string;
  duration_min: number;
  cost?: number | null;
  ended_status?: string | null;
}

export interface ChargeTelemetryReading {
  session_id: number | null;
  vehicle_id: number;
  ts: string;
  ac_charging_power_w: number | null;
  dc_charging_power_w: number | null;
  ac_charging_energy_in_wh: number | null;
  dc_charging_energy_in_wh: number | null;
  charger_voltage_v: number | null;
  charger_actual_current_a: number | null;
  charger_pilot_current_a: number | null;
  charger_phases: number | null;
  battery_heater_on: boolean | null;
  battery_heater_power_w: number | null;
  charge_limit_soc_pct: number | null;
  charge_request: string | null;
  fast_charger_type: string | null;
  charging_cable_type: string | null;
  charge_port_door_open: boolean | null;
  charge_port_latch: string | null;
  created_at: string;
  battery_level?: number | null;
  soc?: number | null;
  power_kw?: number | null;
  energy_added?: number | null;
  rated_range?: number | null;
  battery_temp?: number | null;
  inside_temp?: number | null;
  outside_temp?: number | null;
  voltage?: number | null;
  current_amps?: number | null;
}

/** Fetches paginated charging sessions for a vehicle, optionally filtered by date range. */
export const getChargingSessions = (
  vehicleId: number,
  limit = 50,
  offset = 0,
  start?: string,
  end?: string,
  opts?: {signal?: AbortSignal | null},
) => {
  const params = new URLSearchParams({
    vehicle_id: String(vehicleId),
    limit: String(limit),
    offset: String(offset),
  });
  if (start) {
    params.append('start', start);
  }
  if (end) {
    params.append('end', end);
  }
  return request<ApiChargingSession[]>(`/charging?${params}`, {
    signal: opts?.signal,
  });
};

export const chargingKeys = {
  all: ['charging-sessions'] as const,
  detail: (id: string) => ['charging-sessions', id] as const,
  detailById: (id: number) => ['charging-session', id] as const,
  telemetry: (id: number) => ['charge-telemetry', id] as const,
  byVehicle: (vehicleId: string) =>
    ['charging-sessions', 'vehicle', vehicleId] as const,
};

export function useChargingSessions(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleId ? chargingKeys.byVehicle(vehicleId) : chargingKeys.all,
    queryFn: ({signal}) =>
      request<ChargingSession[]>(
        vehicleId ? `/charging-sessions?vehicle_id=${vehicleId}` : '/charging-sessions',
        {signal},
      ),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useChargingSession(id: string) {
  return useQuery({
    queryKey: chargingKeys.detail(id),
    queryFn: ({signal}) => request<ChargingSession>(`/charging/${id}`, {signal}),
    enabled: !!id,
  });
}

/** Fetches a single charging session by numeric ID with full API detail fields. */
export function useChargingSessionDetail(id: number | null) {
  return useQuery({
    queryKey: chargingKeys.detailById(id!),
    queryFn: ({signal}) => request<ApiChargingSession>(`/charging/${id}`, {signal}),
    enabled: id != null,
    refetchInterval: query => {
      const data = query.state.data;
      return data?.live === true ? INTERVALS.FAST : false;
    },
  });
}

/** Fetches detailed telemetry readings for a charging session. */
export function useChargeTelemetry(sessionId: number | null) {
  return useQuery({
    queryKey: chargingKeys.telemetry(sessionId!),
    queryFn: ({signal}) =>
      request<ChargeTelemetryReading[]>(`/charging/${sessionId}/telemetry`, {
        signal,
      }),
    enabled: sessionId != null,
    select: safeArray,
  });
}

/**
 * Hook wrapping getChargingSessions with pagination and date range filtering.
 * Returns the full API ChargingSession type with all charger detail fields.
 */
export function useChargingSessionsPaginated(
  vehicleId: number | null,
  options: {limit?: number; offset?: number; start?: string; end?: string} = {},
) {
  const {limit = 50, offset = 0, start, end} = options;
  return useQuery({
    queryKey: ['charging', vehicleId, start, end, limit, offset] as const,
    queryFn: ({signal}) =>
      getChargingSessions(vehicleId!, limit, offset, start, end, {signal}),
    enabled: vehicleId !== null,
    select: safeArray,
  });
}

export function useCostForecast(vehicleId: string | null, months = 6) {
  return useQuery({
    queryKey: ['cost-forecast', vehicleId, months],
    queryFn: ({signal}) =>
      request<CostForecastData>(
        `/analytics/cost-forecast?vehicle_id=${vehicleId}&months=${months}`,
        {signal},
      ),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useChargingOptimizer(vehicleId: string | null) {
  return useQuery({
    queryKey: ['charging-optimizer', vehicleId],
    queryFn: ({signal}) =>
      request<ChargingOptimizerData>(
        `/analytics/charging-optimizer?vehicle_id=${vehicleId}`,
        {signal},
      ),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.SLOW,
  });
}

// --- Tesla Charging History (Supercharger/DC billing records) ---

export interface TeslaChargingHistoryEntry {
  id: number;
  session_id: number;
  vin: string;
  site_location_name: string;
  charge_start_datetime: string;
  charge_stop_datetime: string | null;
  country: string | null;
  state: string | null;
  county: string | null;
  postal_code: string | null;
  billing_type: string | null;
  fee_type: string | null;
  currency_code: string | null;
  pricing_type: string | null;
  rate_base: number | null;
  usage_wh: number | null;
  total_due: number | null;
  has_invoice: boolean;
  invoice_content_id: string | null;
  fetched_at: string;
  created_at: string;
}

export interface TeslaChargingHistorySummary {
  total_sessions: number;
  total_wh: number | null;
  total_spend: number | null;
  avg_cost_per_kwh: number | null;
}

export interface TeslaChargingHistoryResponse {
  entries: TeslaChargingHistoryEntry[];
  summary: TeslaChargingHistorySummary;
  upserted?: number;
}

export const teslaChargingHistoryKeys = {
  all: ['tesla-charging-history'] as const,
  byVin: (vin: string) => ['tesla-charging-history', vin] as const,
};

/** Fetches Tesla Supercharger/DC charging history from the local DB. */
export function useTeslaChargingHistory(vin?: string) {
  return useQuery({
    queryKey: vin
      ? teslaChargingHistoryKeys.byVin(vin)
      : teslaChargingHistoryKeys.all,
    queryFn: ({signal}) =>
      request<TeslaChargingHistoryResponse>(
        `/tesla/charging/history${vin ? `?vin=${vin}` : ''}`,
        {signal},
      ),
    staleTime: STALE_TIMES.SLOW,
  });
}

/** Mutation to refresh Tesla charging history from the Tesla API. */
export function useRefreshTeslaChargingHistory() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (params?: {
      vin?: string;
      start_time?: string;
      end_time?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.vin) {
        searchParams.append('vin', params.vin);
      }
      if (params?.start_time) {
        searchParams.append('start_time', params.start_time);
      }
      if (params?.end_time) {
        searchParams.append('end_time', params.end_time);
      }
      const qs = searchParams.toString();
      return request<TeslaChargingHistoryResponse>(
        `/tesla/charging/history/refresh${qs ? `?${qs}` : ''}`,
        {method: 'POST'},
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({queryKey: teslaChargingHistoryKeys.all});
      success('toast.charging.history.success', 'Charging history refreshed');
    },
    onError: err =>
      error(
        err,
        'toast.charging.history.error',
        'Failed to refresh charging history',
      ),
  });
}

/** Returns the native-safe direct URL for downloading a Tesla charging invoice PDF. */
export function getTeslaChargingInvoiceURL(contentId: string): string {
  return apiUrl(`/tesla/charging/invoice/${contentId}`);
}

// --- Tesla Fleet Charging Sessions (business accounts only) ---

export interface TeslaChargingSession {
  id: number;
  session_id: number;
  vin: string;
  charger_id: string | null;
  site_location_name: string;
  charge_start_datetime: string;
  charge_stop_datetime: string | null;
  total_energy_added_wh: number;
  peak_power_kw: number | null;
  max_charge_rate_kw: number | null;
  charge_duration_s: number | null;
  charger_type: string | null;
  currency_code: string | null;
  total_cost: number | null;
  per_kwh_rate: number | null;
  idle_fee: number | null;
  congestion_fee: number | null;
  latitude: number | null;
  longitude: number | null;
  fetched_at: string;
  created_at: string;
}

export interface TeslaChargingSessionSummary {
  total_sessions: number;
  total_wh: number | null;
  total_cost: number | null;
  avg_cost_per_kwh: number | null;
  peak_power_kw: number | null;
}

export interface TeslaChargingSessionResponse {
  sessions: TeslaChargingSession[];
  summary: TeslaChargingSessionSummary;
  upserted?: number;
}

export const teslaChargingSessionKeys = {
  all: ['tesla-charging-sessions'] as const,
  byVin: (vin: string) => ['tesla-charging-sessions', vin] as const,
};

/** Fetches Tesla fleet charging sessions from the local DB (business accounts only). */
export function useTeslaChargingSessions(vin?: string) {
  return useQuery({
    queryKey: vin
      ? teslaChargingSessionKeys.byVin(vin)
      : teslaChargingSessionKeys.all,
    queryFn: ({signal}) =>
      request<TeslaChargingSessionResponse>(
        `/tesla/charging/sessions${vin ? `?vin=${vin}` : ''}`,
        {signal},
      ),
    staleTime: STALE_TIMES.SLOW,
  });
}

/** Mutation to refresh Tesla fleet charging sessions from the Tesla API. */
export function useRefreshTeslaChargingSessions() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (params?: {vin?: string; date_from?: string; date_to?: string}) => {
      const searchParams = new URLSearchParams();
      if (params?.vin) {
        searchParams.append('vin', params.vin);
      }
      if (params?.date_from) {
        searchParams.append('date_from', params.date_from);
      }
      if (params?.date_to) {
        searchParams.append('date_to', params.date_to);
      }
      const qs = searchParams.toString();
      return request<TeslaChargingSessionResponse>(
        `/tesla/charging/sessions/refresh${qs ? `?${qs}` : ''}`,
        {method: 'POST'},
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({queryKey: teslaChargingSessionKeys.all});
      success('toast.charging.sessions.success', 'Charging sessions refreshed');
    },
    onError: err =>
      error(
        err,
        'toast.charging.sessions.error',
        'Failed to refresh charging sessions',
      ),
  });
}

// --- Smart Charge Planner ---

export const chargePlannerKeys = {
  all: ['charge-plans'] as const,
  byVehicle: (vehicleId: number) => ['charge-plans', vehicleId] as const,
  ratePlans: ['charge-planner-rate-plans'] as const,
};

/** Mutation to optimize a charge schedule using TOU rates. */
export function useOptimizeCharge() {
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (params: OptimizeChargeRequest) =>
      request<OptimizeChargeResponse>('/charge-planner/optimize', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      success('toast.charging.optimize.success', 'Charge schedule optimized');
    },
    onError: err =>
      error(err, 'toast.charging.optimize.error', 'Failed to optimize charge'),
  });
}

/** Mutation to apply an optimized charge plan to the vehicle. */
export function useApplySchedule() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (params: ApplyScheduleRequest) =>
      request<ApplyScheduleResponse>('/charge-planner/apply', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: chargePlannerKeys.all});
      success('toast.charging.apply.success', 'Charge schedule applied');
    },
    onError: err =>
      error(err, 'toast.charging.apply.error', 'Failed to apply schedule'),
  });
}

/** Fetches charge plan history for a vehicle. */
export function useChargePlans(vehicleId?: number) {
  return useQuery({
    queryKey: chargePlannerKeys.byVehicle(vehicleId!),
    queryFn: ({signal}) =>
      request<ChargePlan[]>(
        `/charge-planner/history?vehicle_id=${vehicleId}`,
        {signal},
      ),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

/** Fetches available TOU rate plans from the backend. */
export function useRatePlans() {
  return useQuery({
    queryKey: chargePlannerKeys.ratePlans,
    queryFn: ({signal}) =>
      request<RatePlanInfo[]>('/charge-planner/rate-plans', {signal}),
    staleTime: STALE_TIMES.STATIC,
    select: safeArray,
  });
}

/**
 * Bulk delete charging sessions. Returns the standardized
 * BulkOperationResult envelope.
 */
export function useBulkDeleteCharging() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{
        deleted?: number;
        updated?: number;
        failed?: Array<{id: number; reason: string}>;
      }>('/charging/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ids}),
      }),
    onSuccess: res => {
      invalidateAndBroadcast(qc, {queryKey: chargingKeys.all});
      success('toast.bulk.delete.success', '{{count}} deleted', {
        count: res.deleted ?? 0,
      });
    },
    onError: err =>
      error(err, 'toast.bulk.delete.error', 'Failed to delete selection'),
  });
}
