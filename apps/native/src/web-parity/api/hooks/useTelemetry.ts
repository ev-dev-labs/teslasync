import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {request} from '../client';
import {useMutationToast} from './_toastHelpers';

const INTERVALS = {
  REALTIME: 5_000,
  STANDARD: 30_000,
} as const;

const STALE_TIMES = {
  REALTIME: 5_000,
  STANDARD: 60_000,
  SLOW: 5 * 60_000,
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

export interface SignalPoint {
  timestamp: string;
  valueNum?: number;
  valueStr?: string;
  valueBool?: boolean;
}

export interface SignalStats {
  vehicleId: number;
  count: number;
  oldest: string | null;
  newest: string | null;
}

export interface SignalHistoryResponse {
  vehicleId: number;
  signal: string;
  from: string;
  to: string;
  count: number;
  data: SignalPoint[];
}

export interface TelemetryStatus {
  connected: boolean;
  broker?: string;
  uptimeSeconds?: number;
  uptime_seconds?: number;
  vehicles?: Record<string, VehicleTelemetry> | VehicleTelemetry[];
  streaming_vehicles?: Record<string, VehicleTelemetry>;
  topics?: string[];
}

export interface VehicleTelemetry {
  vin: string;
  vehicleId?: number;
  vehicle_id?: number;
  state?: string;
  signalCount: number;
  signal_count?: number;
  batchCount: number;
  batch_count?: number;
  signalsPerSecond?: number;
  signals_per_second?: number;
  lastReceived?: string;
  last_received?: string;
  is_streaming?: boolean;
  data_source?: string;
  latency_ms?: number;
  uptime_seconds?: number;
}

export type SignalSource = 'fleet_telemetry' | 'fleet_api' | 'manual' | 'backfill';

export interface SignalObservation {
  vehicle_id: number;
  ts: string;
  signal_name: string;
  value_numeric: number | null;
  value_text: string | null;
  value_bool: boolean | null;
  source: SignalSource;
}

export type SignalValueType = 'numeric' | 'text' | 'bool';

export interface SignalCatalogEntry {
  name: string;
  value_type: SignalValueType;
  source_module: string;
  unit: string | null;
  description: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export const telemetryKeys = {
  signals: (vehicleId: number) => ['signals', vehicleId] as const,
  liveSignals: (vehicleId?: number) => ['live-signals', vehicleId] as const,
  signalStats: (vehicleId: number) => ['signal-stats', vehicleId] as const,
  signalHistory: (vehicleId: number, signal: string, hours: number) =>
    ['signal-history', vehicleId, signal, hours] as const,
  signalLog: (vehicleId: number, signal: string, hours: number, page: number) =>
    ['signal-log', vehicleId, signal, hours, page] as const,
  signalDiff: (vehicleId: number, signal: string, from: string, to: string) =>
    ['signal-diff', vehicleId, signal, from, to] as const,
  signalDiffServer: (
    vehicleId: number,
    atA: string,
    atB: string,
    signalsCsv: string,
  ) => ['signal-diff-server', vehicleId, atA, atB, signalsCsv] as const,
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

/**
 * useSignals — list of available signal names for a vehicle.
 *
 * The backend may return a rich catalog envelope, a legacy `{signals: string[]}`
 * envelope, or a bare array. Consumers of this legacy hook expect only names,
 * so malformed entries are ignored while preserving the original query shape.
 */
export function useSignals(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signals(vehicleId),
    queryFn: async ({signal: abortSignal}): Promise<string[]> => {
      const resp = await request<
        | {signals?: Array<{name?: unknown} | string>}
        | Array<{name?: unknown} | string>
      >(`/signals/${vehicleId}/available`, {signal: abortSignal});

      const arr: unknown[] = Array.isArray(resp)
        ? resp
        : ((resp as {signals?: unknown[]})?.signals ?? []);

      return arr.reduce<string[]>((acc, entry) => {
        if (typeof entry === 'string') {
          acc.push(entry);
        } else if (entry && typeof entry === 'object' && 'name' in entry) {
          const name = (entry as {name: unknown}).name;
          if (typeof name === 'string' && name.length > 0) {
            acc.push(name);
          }
        }
        return acc;
      }, []);
    },
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function getVehicleLiveSignals(
  vehicleId: number,
  opts?: {signal?: AbortSignal | null},
) {
  return request<VehicleLiveSignalsResponse>(`/signals/${vehicleId}/live`, {
    signal: opts?.signal,
  });
}

export interface UseVehicleLiveSignalsOptions {
  /**
   * Override the default refetch cadence. The page-level Live Signal Inspector
   * uses 1s; dashboard widgets can stay on the default native parity cadence.
   */
  refetchInterval?: number;
  /** Disable polling without unmounting the hook. */
  enabled?: boolean;
}

export function useVehicleLiveSignals(
  vehicleId?: number,
  opts?: UseVehicleLiveSignalsOptions,
) {
  const enabled = opts?.enabled ?? true;
  return useQuery({
    queryKey: telemetryKeys.liveSignals(vehicleId),
    queryFn: ({signal}) => getVehicleLiveSignals(vehicleId ?? 0, {signal}),
    enabled: !!vehicleId && enabled,
    staleTime: STALE_TIMES.REALTIME,
    refetchInterval: opts?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function useSignalStats(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalStats(vehicleId),
    queryFn: ({signal}) =>
      request<SignalStats>(`/signals/${vehicleId}/stats`, {signal}),
    enabled: vehicleId > 0,
  });
}

export function useSignalHistory(
  vehicleId: number,
  signalName: string,
  hours: number,
) {
  return useQuery({
    queryKey: telemetryKeys.signalHistory(vehicleId, signalName, hours),
    queryFn: ({signal}) =>
      request<SignalHistoryResponse>(
        `/signals/${vehicleId}/${signalName}/history?hours=${hours}`,
        {signal},
      ),
    enabled: vehicleId > 0 && !!signalName,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useSignalLog(
  vehicleId: number,
  signalName: string,
  hours: number,
  page: number,
  pageSize: number,
) {
  return useQuery({
    queryKey: telemetryKeys.signalLog(vehicleId, signalName, hours, page),
    queryFn: ({signal}) =>
      request<SignalHistoryResponse>(
        `/signals/${vehicleId}/${signalName}/history?hours=${hours}&page=${page}&page_size=${pageSize}`,
        {signal},
      ),
    enabled: vehicleId > 0 && !!signalName,
  });
}

export function useSignalDiff(
  vehicleId: number,
  signalName: string,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: telemetryKeys.signalDiff(vehicleId, signalName, from, to),
    queryFn: ({signal}) =>
      request<SignalHistoryResponse>(
        `/signals/${vehicleId}/${signalName}/history?from=${from}&to=${to}`,
        {signal},
      ),
    enabled: vehicleId > 0 && !!signalName && !!from && !!to,
  });
}

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
 * Fetch a point-in-time signal snapshot. Pass `at=''` to read live state.
 * Supplying a CSV of signal names narrows the server-side response.
 */
export function useSignalSnapshot(
  vehicleId: number,
  at: string,
  signalsCsv = '',
  options?: {enabled?: boolean; refetchInterval?: number},
) {
  return useQuery({
    queryKey: telemetryKeys.signalSnapshot(vehicleId, at, signalsCsv),
    queryFn: ({signal}) => {
      const usp = new URLSearchParams();
      if (at) {
        usp.append('at', at);
      }
      if (signalsCsv) {
        usp.append('signals', signalsCsv);
      }
      const qs = usp.toString();
      return request<SignalSnapshotResponse>(
        `/signals/${vehicleId}/snapshot${qs ? `?${qs}` : ''}`,
        {signal},
      );
    },
    enabled: (options?.enabled ?? true) && vehicleId > 0,
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Fetch the server-side diff between two snapshots. The backend filters out
 * unchanged signals so native consumers receive the same compact response.
 */
export function useSignalDiffServer(
  vehicleId: number,
  atA: string,
  atB: string,
  signalsCsv = '',
  options?: {enabled?: boolean},
) {
  return useQuery({
    queryKey: telemetryKeys.signalDiffServer(vehicleId, atA, atB, signalsCsv),
    queryFn: ({signal}) => {
      const usp = new URLSearchParams();
      if (atA) {
        usp.append('at_a', atA);
      }
      if (atB) {
        usp.append('at_b', atB);
      }
      if (signalsCsv) {
        usp.append('signals', signalsCsv);
      }
      return request<SignalDiffServerResponse>(
        `/signals/${vehicleId}/diff?${usp.toString()}`,
        {signal},
      );
    },
    enabled: (options?.enabled ?? true) && vehicleId > 0 && !!atA && !!atB,
    staleTime: STALE_TIMES.STANDARD,
  });
}

export function useSignalGaps(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalGaps(vehicleId),
    queryFn: async ({signal}) => {
      const res = await request<{
        signals?: Record<string, {value: unknown; timestamp: string}>;
      }>(`/signals/${vehicleId}/live`, {signal});
      return res.signals ?? {};
    },
    enabled: vehicleId > 0,
    refetchInterval: INTERVALS.REALTIME,
  });
}

export function useMQTTStatus() {
  return useQuery({
    queryKey: telemetryKeys.mqttStatus,
    queryFn: async ({signal}) => {
      const raw = await request<TelemetryStatus>('/telemetry', {signal});
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
      } as TelemetryStatus & {vehicles: VehicleTelemetry[]};
    },
    refetchInterval: INTERVALS.REALTIME,
  });
}

/**
 * Deprecated parity hook for the deleted web `/signals/catalog` backend route.
 * It is preserved so any converted consumers retain the same graceful query
 * error behavior as web.
 */
export function useSignalCatalog() {
  return useQuery({
    queryKey: ['signal-catalog'],
    queryFn: ({signal}) =>
      request<SignalCatalogEntry[]>('/signals/catalog', {signal}),
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useSignalObservations(
  vehicleId: number | string | undefined,
  opts?: {signal_name?: string; since?: string; until?: string; limit?: number},
) {
  const params = new URLSearchParams();
  if (vehicleId != null) {
    params.append('vehicle_id', String(vehicleId));
  }
  if (opts?.signal_name) {
    params.append('field', opts.signal_name);
  }
  if (opts?.since) {
    params.append('since', opts.since);
  }
  if (opts?.until) {
    params.append('until', opts.until);
  }
  if (opts?.limit) {
    params.append('limit', String(opts.limit));
  }

  return useQuery({
    queryKey: ['signal-observations', vehicleId, opts],
    queryFn: async ({signal}) => {
      const envelope = await request<SignalsObservationsResponseRaw>(
        `/signals/observations?${params}`,
        {signal},
      );
      return adaptObservations(envelope);
    },
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.REALTIME,
  });
}

interface SignalsObservationsRowRaw {
  vehicle_id?: number;
  vehicleId?: number;
  ts: string;
  field?: string;
  value_kind?: string;
  valueKind?: string;
  value: unknown;
}

interface SignalsObservationsResponseRaw {
  count?: number;
  total?: number;
  observations?: SignalsObservationsRowRaw[];
}

const NUMERIC_VALUE_KINDS = new Set([
  'ValueKindFloat',
  'ValueKindDouble',
  'ValueKindInt32',
  'ValueKindInt64',
  'ValueKindUnixTime',
]);
const TEXT_VALUE_KINDS = new Set([
  'ValueKindString',
  'ValueKindEnum',
]);
const BOOL_VALUE_KINDS = new Set(['ValueKindBool', 'ValueKindBoolean']);

function adaptObservations(
  envelope: SignalsObservationsResponseRaw | null | undefined,
): SignalObservation[] {
  const rows = envelope?.observations ?? [];
  return rows.map((row): SignalObservation => {
    const kind = row.value_kind ?? row.valueKind ?? '';
    const field = row.field ?? '';
    const vehicleId = row.vehicle_id ?? row.vehicleId ?? 0;

    let valueNumeric: number | null = null;
    let valueText: string | null = null;
    let valueBool: boolean | null = null;

    if (NUMERIC_VALUE_KINDS.has(kind)) {
      if (row.value == null) {
        valueNumeric = null;
      } else {
        const n = typeof row.value === 'number' ? row.value : Number(row.value);
        valueNumeric = Number.isFinite(n) ? n : null;
      }
    } else if (TEXT_VALUE_KINDS.has(kind)) {
      valueText = row.value == null ? null : String(row.value);
    } else if (BOOL_VALUE_KINDS.has(kind)) {
      valueBool = typeof row.value === 'boolean' ? row.value : null;
    }

    return {
      vehicle_id: vehicleId,
      ts: row.ts,
      signal_name: field,
      value_numeric: valueNumeric,
      value_text: valueText,
      value_bool: valueBool,
      source: 'fleet_telemetry',
    };
  });
}

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

export function useFleetTelemetryErrorVINs() {
  return useQuery({
    queryKey: ['fleet-telemetry-error-vins'],
    queryFn: ({signal}) =>
      request<FleetTelemetryErrorVIN[]>(
        '/tesla/fleet-telemetry/error-vins',
        {signal},
      ),
    staleTime: STALE_TIMES.STANDARD,
  });
}

export function useFleetTelemetryErrors(vin?: string) {
  return useQuery({
    queryKey: ['fleet-telemetry-errors', vin],
    queryFn: ({signal}) =>
      request<FleetTelemetryError[]>(
        `/tesla/fleet-telemetry/errors${vin ? `?vin=${vin}` : ''}`,
        {signal},
      ),
    staleTime: STALE_TIMES.STANDARD,
  });
}

export function useRefreshFleetTelemetryErrorVINs() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request('/tesla/fleet-telemetry/error-vins/refresh', {method: 'POST'}),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: ['fleet-telemetry-error-vins']});
      success(
        'toast.telemetry.errorVins.refresh.success',
        'Telemetry error VINs refreshed',
      );
    },
    onError: err =>
      error(
        err,
        'toast.telemetry.errorVins.refresh.error',
        'Failed to refresh error VINs',
      ),
  });
}

export function useRefreshFleetTelemetryErrors() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request('/tesla/fleet-telemetry/errors/refresh', {method: 'POST'}),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: ['fleet-telemetry-errors']});
      success(
        'toast.telemetry.errors.refresh.success',
        'Telemetry errors refreshed',
      );
    },
    onError: err =>
      error(
        err,
        'toast.telemetry.errors.refresh.error',
        'Failed to refresh telemetry errors',
      ),
  });
}
