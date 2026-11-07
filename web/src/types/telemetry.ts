import type { SignalHistoryPoint } from '@/api/types';
import { knownNumber } from '@/api/dataState';

export interface TelemetryRateSample {
  /** Browser fetch time, not the vehicle's signal observation time. */
  timestamp: number;
  value: number | null;
}

export interface MqttStatusData extends Omit<TelemetryStatus, 'vehicles'> {
  vehicles?: VehicleTelemetry[] | null;
  sessionSamples?: TelemetryRateSample[];
}

export interface MqttWidgetStats {
  totalMessages: number | null;
  messagesPerSec: number | null;
  lastMessage: string | null;
}

export function deriveMqttStats(vehicles: VehicleTelemetry[] | null | undefined): MqttWidgetStats {
  let totalMessages: number | null = vehicles != null && vehicles.length === 0 ? 0 : null;
  let messagesPerSec: number | null = vehicles != null && vehicles.length === 0 ? 0 : null;
  let countsComplete = true;
  let ratesComplete = true;
  let lastMessage: string | null = null;
  let lastMessageMs = -Infinity;
  for (const vehicle of vehicles ?? []) {
    const count = knownNumber(vehicle.signalCount ?? vehicle.signal_count);
    const rate = knownNumber(vehicle.signalsPerSecond ?? vehicle.signals_per_second);
    countsComplete &&= count != null;
    ratesComplete &&= rate != null;
    if (count != null) totalMessages = (totalMessages ?? 0) + count;
    if (rate != null) messagesPerSec = (messagesPerSec ?? 0) + rate;
    const received = vehicle.lastReceived ?? vehicle.last_received;
    if (received) {
      const timestamp = Date.parse(received);
      if (Number.isFinite(timestamp) && timestamp > lastMessageMs) {
        lastMessageMs = timestamp;
        lastMessage = received;
      }
    }
  }
  return {
    totalMessages: countsComplete ? totalMessages : null,
    messagesPerSec: ratesComplete ? messagesPerSec : null,
    lastMessage,
  };
}

export function appendTelemetryRateSample(
  previous: readonly TelemetryRateSample[],
  vehicles: VehicleTelemetry[] | null | undefined,
  timestamp: number,
): TelemetryRateSample[] {
  return [
    ...previous.filter(point => point.timestamp > timestamp - 900_000 && point.timestamp < timestamp).slice(-179),
    { timestamp, value: deriveMqttStats(vehicles).messagesPerSec },
  ];
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
  data: SignalHistoryPoint[];
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
  streaming_vehicles?: Record<string, VehicleTelemetry> | VehicleTelemetry[];
  topics?: string[];
}

export interface VehicleTelemetry {
  vin: string;
  vehicleId?: number;
  vehicle_id?: number;
  state?: string;
  signalCount?: number;
  signal_count?: number;
  batchCount?: number;
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
/*  arrives. Missing counters must remain unknown, not become zero.    */
/*  helpers are the ONE place that resolves the pair to a canonical,   */
/*  null-safe value so every consumer agrees.                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve a single {@link VehicleTelemetry} to canonical camelCase fields,
 * preferring the camelCase spelling and falling back to snake_case. Missing
 * counters, rate and last-seen remain `undefined`, distinct from a real `0`.
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
    signalCount: v.signalCount ?? v.signal_count ?? undefined,
    batchCount: v.batchCount ?? v.batch_count ?? undefined,
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
 * whose every element carries canonical fields — closing the latent
 * gap where the array shape skipped snake_case normalization (leaving
 * `signalCount` `undefined`) and the record shape was silently dropped by
 * callers doing `Array.isArray(status.vehicles) ? status.vehicles : []`.
 * An absent or unsupported container remains unknown (`undefined`); an
 * explicitly supplied empty array or map remains an observed empty list.
 */
export function telemetryVehicleList(
  status: TelemetryStatus | null | undefined,
): VehicleTelemetry[] | undefined {
  const raw = status?.vehicles ?? status?.streaming_vehicles;
  if (Array.isArray(raw)) {
    return raw.map((v) => normalizeVehicleTelemetry(v));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([vin, v]) => normalizeVehicleTelemetry(v, vin));
  }
  return undefined;
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
