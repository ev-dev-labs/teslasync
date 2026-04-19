import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type { ChargingSession, CostForecastData, ChargingOptimizerData } from '@/types/charging';
import type { ChargingSession as ApiChargingSession, ChargeTelemetryReading } from '../types';

/** Fetches paginated charging sessions for a vehicle, optionally filtered by date range. */
export const getChargingSessions = (vehicleId: number, limit = 50, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<ApiChargingSession[]>(`/charging?${params}`)
}

export const chargingKeys = {
  all: ['charging-sessions'] as const,
  detail: (id: string) => ['charging-sessions', id] as const,
  detailById: (id: number) => ['charging-session', id] as const,
  telemetry: (id: number) => ['charge-telemetry', id] as const,
  byVehicle: (vehicleId: string) => ['charging-sessions', 'vehicle', vehicleId] as const,
};

export function useChargingSessions(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleId ? chargingKeys.byVehicle(vehicleId) : chargingKeys.all,
    queryFn: () => request<ChargingSession[]>(
      vehicleId ? `/charging-sessions?vehicle_id=${vehicleId}` : '/charging-sessions',
    ),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useChargingSession(id: string) {
  return useQuery({
    queryKey: chargingKeys.detail(id),
    queryFn: () => request<ChargingSession>(`/charging/${id}`),
    enabled: !!id,
  });
}

/** Fetches a single charging session by numeric ID with full API detail fields. */
export function useChargingSessionDetail(id: number | null) {
  return useQuery({
    queryKey: chargingKeys.detailById(id!),
    queryFn: () => request<ApiChargingSession>(`/charging/${id}`),
    enabled: id != null,
  });
}

/** Fetches detailed telemetry readings for a charging session. */
export function useChargeTelemetry(sessionId: number | null) {
  return useQuery({
    queryKey: chargingKeys.telemetry(sessionId!),
    queryFn: () => request<ChargeTelemetryReading[]>(`/charging/${sessionId}/telemetry`),
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
    queryFn: () => getChargingSessions(vehicleId!, limit, offset, start, end),
    enabled: vehicleId !== null,
    select: safeArray,
  });
}

export function useCostForecast(vehicleId: string | null, months = 6) {
  return useQuery({
    queryKey: ['cost-forecast', vehicleId, months],
    queryFn: () => request<CostForecastData>(`/analytics/cost-forecast?vehicle_id=${vehicleId}&months=${months}`),
    enabled: vehicleId !== null,
    staleTime: 5 * 60_000,
  });
}

export function useChargingOptimizer(vehicleId: string | null) {
  return useQuery({
    queryKey: ['charging-optimizer', vehicleId],
    queryFn: () => request<ChargingOptimizerData>(`/analytics/charging-optimizer?vehicle_id=${vehicleId}`),
    enabled: vehicleId !== null,
    staleTime: 5 * 60_000,
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
  usage_kwh: number | null;
  total_due: number | null;
  has_invoice: boolean;
  invoice_content_id: string | null;
  fetched_at: string;
  created_at: string;
}

export interface TeslaChargingHistorySummary {
  total_sessions: number;
  total_kwh: number | null;
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
    queryFn: () => request<TeslaChargingHistoryResponse>(
      `/tesla/charging/history${vin ? `?vin=${vin}` : ''}`
    ),
    staleTime: 5 * 60_000,
  });
}

/** Mutation to refresh Tesla charging history from the Tesla API. */
export function useRefreshTeslaChargingHistory() {
  const qc = useQueryClient();
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
    onSuccess: () => qc.invalidateQueries({ queryKey: teslaChargingHistoryKeys.all }),
  });
}