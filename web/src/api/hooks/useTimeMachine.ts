import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';

/**
 * Vehicle Time Machine hooks.
 *
 * Reconstruct the COMPLETE signal state of a vehicle at any past instant
 * from the `signal_log` cold-path hypertable. Backed by:
 *   GET /vehicles/{id}/time-machine?at=<RFC3339>   (point-in-time state)
 *   GET /vehicles/{id}/time-machine/range          (scrubber bounds)
 *
 * `request()` prepends `/api/v1` — paths here MUST NOT include it. Query
 * params are snake_case (`at`) to match the Go handler.
 */

/** protomodel.ValueKind collapsed to a stable, frontend-facing label. */
export type TimeMachineValueKind =
  | 'string'
  | 'bool'
  | 'int'
  | 'enum'
  | 'float'
  | 'time'
  | 'unknown';

/** A JSON-representable signal value. `time` kinds arrive as RFC 3339 strings. */
export type TimeMachineValue = string | number | boolean | null;

/** One reconstructed field at the requested instant (snake_case ↔ Go tags). */
export interface TimeMachineField {
  field: string;
  value: TimeMachineValue;
  value_kind: TimeMachineValueKind;
  /** RFC 3339 timestamp of the last change at-or-before the instant. */
  ts: string;
  /** Seconds between the field's last change and the reconstruction instant. */
  age_seconds: number;
}

/** Point-in-time reconstruction envelope. */
export interface TimeMachineState {
  /** Echoed RFC 3339 instant the state was reconstructed at. */
  at: string;
  fields: TimeMachineField[];
  count: number;
}

/** Scrubber bounds. earliest/latest are null when the vehicle has no history. */
export interface TimeMachineRange {
  earliest: string | null;
  latest: string | null;
  field_count: number;
}

/**
 * Bounds for the timeline scrubber (oldest + newest observation, distinct
 * field count). Near-static per vehicle, so it caches until invalidated.
 */
export function useTimeMachineRange(vehicleId: number | null) {
  return useQuery({
    queryKey: ['time-machine-range', vehicleId],
    queryFn: ({ signal }) =>
      request<TimeMachineRange>(`/vehicles/${vehicleId}/time-machine/range`, { signal }),
    enabled: vehicleId !== null && vehicleId > 0,
    staleTime: STALE_TIMES.SLOW,
  });
}

/**
 * Full reconstructed field state at `atISO` (RFC 3339). Disabled until both
 * a vehicle and an instant are known, so scrubbing to a fresh position is a
 * cache miss that fetches, while returning to a visited position is instant.
 */
export function useTimeMachineState(vehicleId: number | null, atISO: string | null) {
  return useQuery({
    queryKey: ['time-machine-state', vehicleId, atISO],
    queryFn: ({ signal }) =>
      request<TimeMachineState>(
        `/vehicles/${vehicleId}/time-machine?at=${encodeURIComponent(atISO ?? '')}`,
        { signal },
      ),
    enabled: vehicleId !== null && vehicleId > 0 && !!atISO,
    // Historical reconstructions are immutable — the past does not change —
    // so a visited instant never needs a background refetch.
    staleTime: STALE_TIMES.STATIC,
  });
}
