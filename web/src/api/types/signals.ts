// AUTO-SPLIT from web/src/api/types.ts (P2 #3).
// See @/api/types barrel for the public re-export surface.

// === Phase-42 typed signal envelope =============================//
// Backend prompts 0069 (`/signals/`) and 0071 (SSE `signal_change`)
// rewrote the live/history payload from a raw string to the typed
// envelope `{kind, value, ts}`. The frontend hooks normalize the
// backend's protomodel.ValueKind discriminator (e.g. "ValueKindFloat" or
// the integer enum on SSE) into the compact `SignalKind` union below so
// React components can switch on `kind` and trust the typed `value`
// without re-parsing strings. Forward-only — no fallback for the
// pre-Phase-42 string-only shape.

/**
 * Compact discriminator for a typed signal value. Maps to the backend's
 * `protomodel.ValueKind` after normalization in the consuming hook:
 *   string  ← ValueKindString
 *   bool    ← ValueKindBool
 *   int     ← ValueKindInt32 / ValueKindInt64 / ValueKindEnum
 *   float   ← ValueKindFloat / ValueKindDouble
 *   time    ← ValueKindTime
 *   unknown ← ValueKindUnknown / ValueKindCompound / ValueKindInvalid
 */
export type SignalKind =
  | 'string'
  | 'bool'
  | 'int'
  | 'float'
  | 'time'
  | 'unknown'

/** Typed primitive carried by a SignalEnvelope. `value` is the JSON-decoded
 *  scalar matching `kind`; `null` indicates the typed column was empty. */
export type SignalValue = string | boolean | number | null

/** Typed live/history envelope returned by /signals/* and SSE signal_change.
 *  `ts` is RFC3339 / ISO 8601. */
export interface SignalEnvelope {
  kind: SignalKind
  value: SignalValue
  ts: string
}

/** UnitKind discriminator surfaced by /signals/{vehicleID}/available.
 *  Mirrors `protomodel.UnitKind` (none/distance/temperature/pressure/
 *  charge); `speed` is included so the frontend can flag distance-derived
 *  rate signals separately even though the backend currently rolls them
 *  into UnitKindNone. */
export type SignalUnitKind =
  | 'none'
  | 'distance'
  | 'temperature'
  | 'pressure'
  | 'charge'
  | 'speed'

/** A single entry in the /signals/{vehicleID}/available catalog. */
export interface SignalDescriptor {
  name: string
  category: string
  value_kind: SignalKind
  unit_kind: SignalUnitKind
  is_compound: boolean
  is_setting_unit: boolean
}

/** SSE `signal_change` event from EventHub.BroadcastSignalChange (Phase-42
 *  Prompt 0071). Per-signal companion to the existing `vehicle_update`
 *  batch event so dashboards can apply O(1) keyed updates. */
export interface SignalChangeEvent extends SignalEnvelope {
  vehicle_id: number
  field: string
}

/** Response shape of GET /signals/{vehicleID}/live (Phase-42 Prompt 0069). */
export interface LiveSignalsResponse {
  vehicle_id: number
  count: number
  at: string
  signals: Record<string, SignalEnvelope>
}

/** Response shape of GET /signals/{vehicleID}/available (Phase-42 Prompt 0069). */
export interface AvailableSignalsResponse {
  vehicle_id: number
  count: number
  source: string
  signals: SignalDescriptor[]
}

/** Response shape of GET /signals/{vehicleID}/{signalName}/history. */
export interface SignalHistoryResponseTyped {
  vehicle_id: number
  signal: string
  expected_kind: string
  from: string
  to: string
  count: number
  data: SignalEnvelope[]
}

/** One row of the per-category routing destination map served by
 *  GET /tesla/fleet-telemetry/coverage (Phase-42 Prompt 0068). */
export interface FleetTelemetryFieldCoverage {
  field: string
  destination: string
  column?: string
  also_signal_log?: boolean
  subscribed: boolean
}

/** A single category bucket in the coverage response. */
export interface FleetTelemetryCategoryCoverage {
  category: string
  total_fields: number
  destinations: Record<string, number>
  fields: FleetTelemetryFieldCoverage[]
}

/** Response shape of GET /tesla/fleet-telemetry/coverage. */
export interface FleetTelemetryCoverageResponse {
  categories: FleetTelemetryCategoryCoverage[]
  destination_totals: Record<string, number>
  orphan_fields?: string[]
}
