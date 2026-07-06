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

export interface SignalLogEntry {
  timestamp: string;
  valueNum?: number;
  valueStr?: string;
  valueBool?: boolean;
}

export interface SignalRow {
  name: string;
  value: string;
  timestamp: string | null;
  staleness: number;
  category: 'active' | 'stale' | 'never';
}

export interface SignalEntry {
  id: number;
  timestamp: string;
  name: string;
  value: string;
  type: 'number' | 'string' | 'boolean';
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

export interface RangeStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

/* ------------------------------------------------------------------ */
/*  Dual-shape normalizers                                            */
/*                                                                    */
/*  `TelemetryStatus` / `VehicleTelemetry` are deliberately declared  */
/*  with BOTH the camelCase and the snake_case spelling of every      */
/*  telemetry counter: the `/telemetry` payload is run through        */
/*  `camelCaseKeys()` by `request()` (which exposes both forms) and   */
/*  the Go handler has itself shipped either casing — and either an    */
/*  array or a `Record<vin, …>` map — across versions. Reading a       */
/*  single spelling therefore silently loses data whenever the other   */
/*  arrives: a `signalCount` of `undefined` renders as 0. These        */
/*  helpers are the ONE place that resolves the pair to a canonical,   */
/*  null-safe value so every consumer agrees.                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve a single {@link VehicleTelemetry} to canonical camelCase fields,
 * preferring the camelCase spelling and falling back to snake_case. Count
 * fields default to `0` so callers can sum/format them without a guard; the
 * optional rate/last-seen fields stay `undefined` when absent so a missing
 * value is distinguishable from a real `0`.
 *
 * @param v   raw per-vehicle telemetry (either casing).
 * @param vin optional VIN override, supplied when the vehicle arrives keyed by
 *            VIN in a `Record<vin, …>` map — the map key is the authoritative
 *            VIN in that shape.
 */
export function normalizeVehicleTelemetry(
  v: VehicleTelemetry,
  vin?: string,
): VehicleTelemetry {
  return {
    ...v,
    vin: vin ?? v.vin,
    signalCount: v.signalCount ?? v.signal_count ?? 0,
    batchCount: v.batchCount ?? v.batch_count ?? 0,
    signalsPerSecond: v.signalsPerSecond ?? v.signals_per_second,
    lastReceived: v.lastReceived ?? v.last_received,
  };
}

/**
 * Flatten the polymorphic `vehicles` / `streaming_vehicles` field of a
 * {@link TelemetryStatus} into a normalized `VehicleTelemetry[]`.
 *
 * The backend has shipped vehicles as an ARRAY and as a `Record<vin, …>` map
 * across versions, and under either the `vehicles` or the older
 * `streaming_vehicles` key. This resolves all four combinations to one array
 * whose every element carries canonical, null-safe fields — closing the latent
 * gap where the array shape skipped snake_case normalization (leaving
 * `signalCount` `undefined`) and the record shape was silently dropped by
 * callers doing `Array.isArray(status.vehicles) ? status.vehicles : []`.
 */
export function telemetryVehicleList(
  status: TelemetryStatus | null | undefined,
): VehicleTelemetry[] {
  const raw = status?.vehicles ?? status?.streaming_vehicles;
  if (Array.isArray(raw)) {
    return raw.map((v) => normalizeVehicleTelemetry(v));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([vin, v]) => normalizeVehicleTelemetry(v, vin));
  }
  return [];
}

/**
 * Resolve broker uptime (seconds) from either casing, or `undefined` when the
 * status is absent or omits it entirely.
 */
export function telemetryUptimeSeconds(
  status: TelemetryStatus | null | undefined,
): number | undefined {
  return status?.uptimeSeconds ?? status?.uptime_seconds;
}
