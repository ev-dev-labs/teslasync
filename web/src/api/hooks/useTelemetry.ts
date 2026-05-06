import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';
import type { SignalHistoryResponse, SignalStats, TelemetryStatus, VehicleTelemetry } from '@/types/telemetry';
import type { SignalCatalogEntry, SignalObservation } from '@/types/signals';

export const telemetryKeys = {
  signals: (vehicleId: number) => ['signals', vehicleId] as const,
  liveSignals: (vehicleId?: number) => ['live-signals', vehicleId] as const,
  signalStats: (vehicleId: number) => ['signal-stats', vehicleId] as const,
  signalHistory: (vehicleId: number, signal: string, hours: number) => ['signal-history', vehicleId, signal, hours] as const,
  signalLog: (vehicleId: number, signal: string, hours: number, page: number) => ['signal-log', vehicleId, signal, hours, page] as const,
  signalDiff: (vehicleId: number, signal: string, from: string, to: string) => ['signal-diff', vehicleId, signal, from, to] as const,
  signalDiffServer: (vehicleId: number, atA: string, atB: string, signalsCsv: string) =>
    ['signal-diff-server', vehicleId, atA, atB, signalsCsv] as const,
  signalSnapshot: (vehicleId: number, at: string, signalsCsv: string) =>
    ['signal-snapshot', vehicleId, at, signalsCsv] as const,
  signalGaps: (vehicleId: number) => ['signal-gaps', vehicleId] as const,
  mqttStatus: ['mqtt-status'] as const,
};

export interface VehicleLiveSignal {
  value: unknown;
  timestamp?: string;
}

export interface VehicleLiveSignalsResponse {
  vehicle_id?: number;
  signals?: Record<string, VehicleLiveSignal | unknown>;
}

export function useSignals(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signals(vehicleId),
    queryFn: async ({ signal }) => {
      const resp = await request<{ signals?: string[] } | string[]>(`/signals/${vehicleId}/available`, { signal });
      // API wraps signals in { signals: [...] } but old code expected string[]
      if (Array.isArray(resp)) return resp;
      return (resp as { signals?: string[] }).signals ?? [];
    },
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function getVehicleLiveSignals(
  vehicleId: number,
  opts?: { signal?: AbortSignal | null },
) {
  return request<VehicleLiveSignalsResponse>(`/signals/${vehicleId}/live`, {
    signal: opts?.signal,
  });
}

export function useVehicleLiveSignals(vehicleId?: number) {
  return useQuery({
    queryKey: telemetryKeys.liveSignals(vehicleId),
    queryFn: ({ signal }) => getVehicleLiveSignals(vehicleId ?? 0, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.REALTIME,
    retry: 1,
  });
}

export function useSignalStats(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalStats(vehicleId),
    queryFn: ({ signal }) => request<SignalStats>(`/signals/${vehicleId}/stats`, { signal }),
    enabled: vehicleId > 0,
  });
}

export function useSignalHistory(vehicleId: number, signal: string, hours: number) {
  return useQuery({
    queryKey: telemetryKeys.signalHistory(vehicleId, signal, hours),
    queryFn: ({ signal }) => request<SignalHistoryResponse>(`/signals/${vehicleId}/${signal}/history?hours=${hours}`, { signal }),
    enabled: vehicleId > 0 && !!signal,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useSignalLog(vehicleId: number, signal: string, hours: number, page: number, pageSize: number) {
  return useQuery({
    queryKey: telemetryKeys.signalLog(vehicleId, signal, hours, page),
    queryFn: ({ signal }) =>
      request<SignalHistoryResponse>(
        `/signals/${vehicleId}/${signal}/history?hours=${hours}&page=${page}&page_size=${pageSize}`, { signal }
      ),
    enabled: vehicleId > 0 && !!signal,
  });
}

export function useSignalDiff(vehicleId: number, signal: string, from: string, to: string) {
  return useQuery({
    queryKey: telemetryKeys.signalDiff(vehicleId, signal, from, to),
    queryFn: ({ signal }) =>
      request<SignalHistoryResponse>(`/signals/${vehicleId}/${signal}/history?from=${from}&to=${to}`, { signal }),
    enabled: vehicleId > 0 && !!signal && !!from && !!to,
  });
}

// ─── Phase-40 / Prompt 58 — server-side diff & point-in-time snapshot ─────

export type SignalSourceLayer = 'l1' | 'l2' | 'log' | 'stale' | 'unknown';

export interface SignalSnapshotEntry {
  value: unknown;
  timestamp?: string;
  source?: SignalSourceLayer;
  age_ms?: number;
}

export interface SignalSnapshotResponse {
  vehicle_id: number;
  at?: string;
  count: number;
  signals: Record<string, SignalSnapshotEntry>;
}

export interface SignalDiffRow {
  name: string;
  value_a: unknown;
  value_b: unknown;
  source_a?: SignalSourceLayer;
  source_b?: SignalSourceLayer;
  age_ms_a?: number;
  age_ms_b?: number;
  changed: boolean;
}

export interface SignalDiffServerResponse {
  vehicle_id: number;
  at_a: string;
  at_b: string;
  count: number;
  data: SignalDiffRow[];
}

/**
 * Phase-40 / Prompt 58 — fetch a point-in-time signal snapshot. Pass
 * `at=''` to read live state. Supplying a CSV of signal names narrows the
 * server-side response so dense vehicles don't ship 200+ values per call.
 */
export function useSignalSnapshot(
  vehicleId: number,
  at: string,
  signalsCsv: string = '',
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  return useQuery({
    queryKey: telemetryKeys.signalSnapshot(vehicleId, at, signalsCsv),
    queryFn: ({ signal }) => {
      const usp = new URLSearchParams();
      if (at) usp.set('at', at);
      if (signalsCsv) usp.set('signals', signalsCsv);
      const qs = usp.toString();
      return request<SignalSnapshotResponse>(
        `/signals/${vehicleId}/snapshot${qs ? `?${qs}` : ''}`, { signal },
      );
    },
    enabled: (options?.enabled ?? true) && vehicleId > 0,
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Phase-40 / Prompt 58 — fetch the server-side diff between two snapshots.
 * Unchanged signals are filtered out by the backend so the response stays
 * compact.
 */
export function useSignalDiffServer(
  vehicleId: number,
  atA: string,
  atB: string,
  signalsCsv: string = '',
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: telemetryKeys.signalDiffServer(vehicleId, atA, atB, signalsCsv),
    queryFn: ({ signal }) => {
      const usp = new URLSearchParams();
      if (atA) usp.set('at_a', atA);
      if (atB) usp.set('at_b', atB);
      if (signalsCsv) usp.set('signals', signalsCsv);
      return request<SignalDiffServerResponse>(
        `/signals/${vehicleId}/diff?${usp.toString()}`, { signal },
      );
    },
    enabled: (options?.enabled ?? true) && vehicleId > 0 && !!atA && !!atB,
    staleTime: STALE_TIMES.STANDARD,
  });
}

export function useSignalGaps(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalGaps(vehicleId),
    queryFn: async ({ signal }) => {
      const res = await request<{ signals?: Record<string, { value: unknown; timestamp: string }> }>(`/signals/${vehicleId}/live`, { signal });
      return res.signals ?? {};
    },
    enabled: vehicleId > 0,
    refetchInterval: INTERVALS.REALTIME,
  });
}

export function useMQTTStatus() {
  return useQuery({
    queryKey: telemetryKeys.mqttStatus,
    queryFn: async ({ signal }) => {
      const raw = await request<TelemetryStatus>('/telemetry', { signal });
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
    refetchInterval: INTERVALS.REALTIME,
  });
}

// ─── Typed Signal Hooks (Phase 6 endpoints) ──────────────────────────────────

/**
 * Phase-42 / Prompt 0077 — DEPRECATED. The backend `/signals/catalog`
 * route was deleted alongside `signal_catalog_handler.go`; the typed
 * `signal_log` pipeline (migrations 000167+) plus
 * `internal/api/signal_handler.go`'s `/signals/{vehicleID}/available`
 * endpoint are now the authoritative catalog surface. This hook will
 * reliably 404 in production. Kept (not removed) because the
 * `features/dashboard` SignalCatalogWidget still imports it; its UI
 * surfaces the resulting query error gracefully. A future replacement
 * should source the catalog from `useSignals()` (via `/available`) or
 * from `protomodel.Signals` exposed through a new endpoint.
 */
export function useSignalCatalog() {
  return useQuery({
    queryKey: ['signal-catalog'],
    queryFn: ({ signal }) => request<SignalCatalogEntry[]>('/signals/catalog', { signal }),
    staleTime: STALE_TIMES.SLOW,
  });
}

/**
 * Phase-42 / Prompt 0077 — DEPRECATED. The backend `/signals/observations`
 * route was deleted alongside `signal_catalog_handler.go`. See
 * `useSignalCatalog` for the deletion rationale and migration plan. This
 * hook will reliably 404 in production. Kept (not removed) because
 * features outside the telemetry domain (charging PowersharePage,
 * driving dynamics components, dashboard widgets) still call it; their
 * UI surfaces the resulting query error gracefully. A future replacement
 * should derive observations from `useSignalHistory` per-signal time-series
 * queries against `signal_log`.
 */
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
    queryFn: ({ signal }) => request<SignalObservation[]>(`/signals/observations?${params}`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.REALTIME,
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
    queryFn: ({ signal }) => request<FleetTelemetryErrorVIN[]>('/tesla/fleet-telemetry/error-vins', { signal }),
    staleTime: STALE_TIMES.STANDARD,
  });
}

export function useFleetTelemetryErrors(vin?: string) {
  return useQuery({
    queryKey: ['fleet-telemetry-errors', vin],
    queryFn: ({ signal }) =>
      request<FleetTelemetryError[]>(
        `/tesla/fleet-telemetry/errors${vin ? `?vin=${vin}` : ''}`, { signal }
      ),
    staleTime: STALE_TIMES.STANDARD,
  });
}

export function useRefreshFleetTelemetryErrorVINs() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () => request('/tesla/fleet-telemetry/error-vins/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet-telemetry-error-vins'] });
      toast.success('Telemetry error VINs refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh error VINs: ${err.message}`);
    },
  });
}

export function useRefreshFleetTelemetryErrors() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () => request('/tesla/fleet-telemetry/errors/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet-telemetry-errors'] });
      toast.success('Telemetry errors refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh telemetry errors: ${err.message}`);
    },
  });
}
