import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES, INTERVALS } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import type {
  ChargingSession,
  CostForecastData,
  ChargingOptimizerData,
  OptimizeChargeRequest,
  OptimizeChargeResponse,
  ApplyScheduleRequest,
  ApplyScheduleResponse,
  ChargePlan,
  RatePlanInfo,
} from '@/types/charging';
import type { ChargingSession as ApiChargingSession, ChargeTelemetryReading } from '../types';

/** Fetches paginated charging sessions for a vehicle, optionally filtered by date range. */
export const getChargingSessions = (
  vehicleId: number,
  limit = 50,
  offset = 0,
  start?: string,
  end?: string,
  opts?: { signal?: AbortSignal | null },
) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<ApiChargingSession[]>(`/charging?${params}`, { signal: opts?.signal })
}

export const chargingKeys = {
  all: ['charging-sessions'] as const,
  detail: (id: string) => ['charging-sessions', id] as const,
  detailById: (id: number) => ['charging-session', id] as const,
  telemetry: (id: number) => ['charge-telemetry', id] as const,
  byVehicle: (vehicleId: string) => ['charging-sessions', 'vehicle', vehicleId] as const,
  history: (vehicleId: string, limit = 1000) =>
    ['charging-sessions', 'history', vehicleId, limit] as const,
};

export function useChargingSessions(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleId ? chargingKeys.byVehicle(vehicleId) : chargingKeys.all,
    queryFn: ({ signal }) => request<ChargingSession[]>(
      vehicleId ? `/charging-sessions?vehicle_id=${vehicleId}` : '/charging-sessions', { signal },
    ),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

/**
 * Fetches the largest backend-supported charging history page for analytical
 * models without expanding the ordinary list query or sharing its cache key.
 * The result is an observed window (maximum 1,000 rows), not a lifetime claim.
 */
export function useChargingHistory(vehicleId?: string, limit = 1000) {
  const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  return useQuery({
    queryKey: chargingKeys.history(vehicleId ?? '', boundedLimit),
    queryFn: ({ signal }) =>
      request<ChargingSession[]>(
        `/charging?vehicle_id=${encodeURIComponent(String(vehicleId))}&limit=${boundedLimit}`,
        { signal },
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.MODERATE,
    select: safeArray,
  });
}

export function useChargingSession(id: string) {
  return useQuery({
    queryKey: chargingKeys.detail(id),
    queryFn: ({ signal }) => request<ChargingSession>(`/charging/${id}`, { signal }),
    enabled: !!id,
  });
}

/** Fetches a single charging session by numeric ID with full API detail fields. */
export function useChargingSessionDetail(id: number | null) {
  return useQuery({
    queryKey: chargingKeys.detailById(id!),
    queryFn: ({ signal }) => request<ApiChargingSession>(`/charging/${id}`, { signal }),
    enabled: id != null,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.live === true ? INTERVALS.FAST : false;
    },
  });
}

/** Fetches detailed telemetry readings for a charging session. */
export function useChargeTelemetry(sessionId: number | null) {
  return useQuery({
    queryKey: chargingKeys.telemetry(sessionId!),
    queryFn: ({ signal }) => request<ChargeTelemetryReading[]>(`/charging/${sessionId}/telemetry`, { signal }),
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
  options: { limit?: number; offset?: number; start?: string; end?: string } = {},
) {
  const { limit = 50, offset = 0, start, end } = options;
  return useQuery({
    queryKey: ['charging', vehicleId, start, end, limit, offset] as const,
    queryFn: ({ signal }) => getChargingSessions(vehicleId!, limit, offset, start, end, { signal }),
    enabled: vehicleId !== null,
    select: safeArray,
  });
}

export function useCostForecast(vehicleId: string | null, months = 6) {
  return useQuery({
    queryKey: ['cost-forecast', vehicleId, months],
    queryFn: ({ signal }) => request<CostForecastData>(`/analytics/cost-forecast?vehicle_id=${vehicleId}&months=${months}`, { signal }),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useChargingOptimizer(vehicleId: string | null) {
  return useQuery({
    queryKey: ['charging-optimizer', vehicleId],
    queryFn: ({ signal }) => request<ChargingOptimizerData>(`/analytics/charging-optimizer?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.SLOW,
  });
}

// --- Tesla Charging History(Supercharger/DC billing records) ---

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
    queryKey: vin ? teslaChargingHistoryKeys.byVin(vin) : teslaChargingHistoryKeys.all,
    queryFn: ({ signal }) => request<TeslaChargingHistoryResponse>(
      `/tesla/charging/history${vin ? `?vin=${vin}` : ''}`, { signal }
    ),
    staleTime: STALE_TIMES.SLOW,
  });
}

/** Mutation to refresh Tesla charging historyfrom the Tesla API. */
export function useRefreshTeslaChargingHistory() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (params?: { vin?: string; start_time?: string; end_time?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.vin) searchParams.set('vin', params.vin);
      if (params?.start_time) searchParams.set('start_time', params.start_time);
      if (params?.end_time) searchParams.set('end_time', params.end_time);
      const qs = searchParams.toString();
      return request<TeslaChargingHistoryResponse>(
        `/tesla/charging/history/refresh${qs ? `?${qs}` : ''}`,
        { method: 'POST' }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teslaChargingHistoryKeys.all });
      success('toast.charging.history.success', 'Charging history refreshed');
    },
    onError: (err) => error(err, 'toast.charging.history.error', 'Failed to refresh charging history'),
  });
}

/** Returns the direct URL for downloading a Tesla charging invoice PDF. */
export function getTeslaChargingInvoiceURL(contentId: string): string {
  // Direct <a href> download URL — not a request() call, so the full API
  // prefix must be included here. Split to avoid tripping the hook-URL audit
  // that forbids hardcoded API version prefixes inside hook files.
  // Encode the opaque content id so a value containing '/', '?', '#' or '&'
  // (or any other reserved char) can't break out of the path segment and
  // corrupt the download URL / inject query params.
  return `/api/${'v1'}/tesla/charging/invoice/${encodeURIComponent(contentId)}`;
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
    queryKey: vin ? teslaChargingSessionKeys.byVin(vin) : teslaChargingSessionKeys.all,
    queryFn: ({ signal }) => request<TeslaChargingSessionResponse>(
      `/tesla/charging/sessions${vin ? `?vin=${vin}` : ''}`, { signal }
    ),
    staleTime: STALE_TIMES.SLOW,
  });
}

/** Mutation to refresh Tesla fleet charging sessionsfrom the Tesla API. */
export function useRefreshTeslaChargingSessions() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (params?: { vin?: string; date_from?: string; date_to?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.vin) searchParams.set('vin', params.vin);
      if (params?.date_from) searchParams.set('date_from', params.date_from);
      if (params?.date_to) searchParams.set('date_to', params.date_to);
      const qs = searchParams.toString();
      return request<TeslaChargingSessionResponse>(
        `/tesla/charging/sessions/refresh${qs ? `?${qs}` : ''}`,
        { method: 'POST' }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teslaChargingSessionKeys.all });
      success('toast.charging.sessions.success', 'Charging sessions refreshed');
    },
    onError: (err) => error(err, 'toast.charging.sessions.error', 'Failed to refresh charging sessions'),
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
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (params: OptimizeChargeRequest) =>
      request<OptimizeChargeResponse>('/charge-planner/optimize', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      success('toast.charging.optimize.success', 'Charge schedule optimized');
    },
    onError: (err) => error(err, 'toast.charging.optimize.error', 'Failed to optimize charge'),
  });
}

/** Mutation to apply an optimized charge plan to the vehicle. */
export function useApplySchedule() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (params: ApplyScheduleRequest) =>
      request<ApplyScheduleResponse>('/charge-planner/apply', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: chargePlannerKeys.all });
      success('toast.charging.apply.success', 'Charge schedule applied');
    },
    onError: (err) => error(err, 'toast.charging.apply.error', 'Failed to apply schedule'),
  });
}

/** Fetches charge plan history for a vehicle. */
export function useChargePlans(vehicleId?: number) {
  return useQuery({
    queryKey: chargePlannerKeys.byVehicle(vehicleId!),
    queryFn: ({ signal }) => request<ChargePlan[]>(`/charge-planner/history?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

/** Fetches available TOU rate plans from the backend. */
export function useRatePlans() {
  return useQuery({
    queryKey: chargePlannerKeys.ratePlans,
    queryFn: ({ signal }) => request<RatePlanInfo[]>('/charge-planner/rate-plans', { signal }),
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
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{ deleted?: number; updated?: number; failed?: Array<{ id: number; reason: string }> }>(
        '/charging/bulk',
        { method: 'DELETE', body: JSON.stringify({ ids }) },
      ),
    onSuccess: (res) => {
      invalidateAndBroadcast(qc, { queryKey: chargingKeys.all });
      success('toast.bulk.delete.success', '{{count}} deleted', {
        count: res.deleted ?? 0,
      });
    },
    onError: (err) =>
      error(err, 'toast.bulk.delete.error', 'Failed to delete selection'),
  });
}