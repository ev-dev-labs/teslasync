import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type { SignalHistoryResponse, SignalStats, TelemetryStatus, VehicleTelemetry } from '@/types/telemetry';
import type { SignalCatalogEntry, SignalObservation } from '@/types/signals';

export const telemetryKeys = {
  signals: (vehicleId: number) => ['signals', vehicleId] as const,
  signalStats: (vehicleId: number) => ['signal-stats', vehicleId] as const,
  signalHistory: (vehicleId: number, signal: string, hours: number) => ['signal-history', vehicleId, signal, hours] as const,
  signalLog: (vehicleId: number, signal: string, hours: number, page: number) => ['signal-log', vehicleId, signal, hours, page] as const,
  signalDiff: (vehicleId: number, signal: string, from: string, to: string) => ['signal-diff', vehicleId, signal, from, to] as const,
  signalGaps: (vehicleId: number) => ['signal-gaps', vehicleId] as const,
  mqttStatus: ['mqtt-status'] as const,
};

export function useSignals(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signals(vehicleId),
    queryFn: async () => {
      const resp = await request<{ signals?: string[] } | string[]>(`/signals/${vehicleId}/available`);
      // API wraps signals in { signals: [...] } but old code expected string[]
      if (Array.isArray(resp)) return resp;
      return (resp as { signals?: string[] }).signals ?? [];
    },
    enabled: vehicleId > 0,
    staleTime: 60_000,
    select: safeArray,
  });
}

export function useSignalStats(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalStats(vehicleId),
    queryFn: () => request<SignalStats>(`/signals/${vehicleId}/stats`),
    enabled: vehicleId > 0,
  });
}

export function useSignalHistory(vehicleId: number, signal: string, hours: number) {
  return useQuery({
    queryKey: telemetryKeys.signalHistory(vehicleId, signal, hours),
    queryFn: () => request<SignalHistoryResponse>(`/signals/${vehicleId}/${signal}/history?hours=${hours}`),
    enabled: vehicleId > 0 && !!signal,
    refetchInterval: 30_000,
  });
}

export function useSignalLog(vehicleId: number, signal: string, hours: number, page: number, pageSize: number) {
  return useQuery({
    queryKey: telemetryKeys.signalLog(vehicleId, signal, hours, page),
    queryFn: () =>
      request<SignalHistoryResponse>(
        `/signals/${vehicleId}/${signal}/history?hours=${hours}&page=${page}&page_size=${pageSize}`
      ),
    enabled: vehicleId > 0 && !!signal,
  });
}

export function useSignalDiff(vehicleId: number, signal: string, from: string, to: string) {
  return useQuery({
    queryKey: telemetryKeys.signalDiff(vehicleId, signal, from, to),
    queryFn: () =>
      request<SignalHistoryResponse>(`/signals/${vehicleId}/${signal}/history?from=${from}&to=${to}`),
    enabled: vehicleId > 0 && !!signal && !!from && !!to,
  });
}

export function useSignalGaps(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalGaps(vehicleId),
    queryFn: async () => {
      const res = await request<{ signals?: Record<string, { value: unknown; timestamp: string }> }>(`/signals/${vehicleId}/live`);
      return res.signals ?? {};
    },
    enabled: vehicleId > 0,
    refetchInterval: 5_000,
  });
}

export function useMQTTStatus() {
  return useQuery({
    queryKey: telemetryKeys.mqttStatus,
    queryFn: async () => {
      const raw = await request<TelemetryStatus>('/telemetry');
      // Backend returns vehicles as Record<vin, VehicleStreamState>.
      // Normalize to array for the page.
      const vehiclesRaw = raw.vehicles ?? raw.streaming_vehicles;
      let vehiclesArr: VehicleTelemetry[] = [];
      if (Array.isArray(vehiclesRaw)) {
        vehiclesArr = vehiclesRaw;
      } else if (vehiclesRaw && typeof vehiclesRaw === 'object') {
        vehiclesArr = Object.entries(vehiclesRaw).map(([vin, v]) => ({
          ...v,
          vin,
          signalCount: v.signalCount ?? v.signal_count ?? 0,
          batchCount: v.batchCount ?? v.batch_count ?? 0,
          signalsPerSecond: v.signalsPerSecond ?? v.signals_per_second,
          lastReceived: v.lastReceived ?? v.last_received,
        }));
      }
      return {
        ...raw,
        uptimeSeconds: raw.uptimeSeconds ?? raw.uptime_seconds,
        vehicles: vehiclesArr,
      } as TelemetryStatus & { vehicles: VehicleTelemetry[] };
    },
    refetchInterval: 5_000,
  });
}

// ─── Typed Signal Hooks (Phase 6 endpoints) ──────────────────────────────────

export function useSignalCatalog() {
  return useQuery({
    queryKey: ['signal-catalog'],
    queryFn: () => request<SignalCatalogEntry[]>('/signals/catalog'),
    staleTime: 5 * 60_000,
  });
}

export function useSignalObservations(
  vehicleId: number | string | undefined,
  opts?: { signal_name?: string; since?: string; until?: string; limit?: number },
) {
  const params = new URLSearchParams();
  if (vehicleId != null) params.set('vehicle_id', String(vehicleId));
  if (opts?.signal_name) params.set('signal_name', opts.signal_name);
  if (opts?.since) params.set('since', opts.since);
  if (opts?.until) params.set('until', opts.until);
  if (opts?.limit) params.set('limit', String(opts.limit));

  return useQuery({
    queryKey: ['signal-observations', vehicleId, opts],
    queryFn: () => request<SignalObservation[]>(`/signals/observations?${params}`),
    enabled: !!vehicleId,
    staleTime: 5_000,
  });
}

// ─── Fleet Telemetry Error Types ─────────────────────────────────────────────

export interface FleetTelemetryErrorVIN {
  id: number;
  vin: string;
  active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface FleetTelemetryError {
  id: number;
  vin: string;
  error_code: string | null;
  error_message: string | null;
  reported_at: string | null;
  tesla_updated_at: string | null;
  fetched_at: string;
}

// ─── Fleet Telemetry Error Hooks ─────────────────────────────────────────────

export function useFleetTelemetryErrorVINs() {
  return useQuery({
    queryKey: ['fleet-telemetry-error-vins'],
    queryFn: () => request<FleetTelemetryErrorVIN[]>('/tesla/fleet-telemetry/error-vins'),
    staleTime: 60_000,
  });
}

export function useFleetTelemetryErrors(vin?: string) {
  return useQuery({
    queryKey: ['fleet-telemetry-errors', vin],
    queryFn: () =>
      request<FleetTelemetryError[]>(
        `/tesla/fleet-telemetry/errors${vin ? `?vin=${vin}` : ''}`
      ),
    staleTime: 60_000,
  });
}

export function useRefreshFleetTelemetryErrorVINs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request('/tesla/fleet-telemetry/error-vins/refresh', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fleet-telemetry-error-vins'] }),
  });
}

export function useRefreshFleetTelemetryErrors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request('/tesla/fleet-telemetry/errors/refresh', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fleet-telemetry-errors'] }),
  });
}
