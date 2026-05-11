/**
 * Defensive type guards for runtime values from the Go backend.
 *
 * After the per-field MQTT cutover (Phase-42a), `/security/latest` and
 * other endpoints serialize raw `signal.SignalValue` (`interface{}`)
 * directly. The Go protomodel emits typed values per signal:
 *   - bool   for Locked, ServiceMode, ValetModeEnabled, GuestModeEnabled,
 *            DriverSeatOccupied, HomelinkNearby, LightsHazardsActive,
 *            LightsHighBeams, SpeedLimitMode, ...
 *   - int    for HomelinkDeviceCount, PairedPhoneKeyAndKeyFobQty, ...
 *   - string for SentryMode (e.g. "SentryModeStateOff"), DoorState,
 *            Fd/Fp/Rd/RpWindow, CenterDisplay, LightsTurnSignal, ...
 *
 * Frontend TS types pre-Phase-42 commonly declared all these fields as
 * `string | null`, so consumers blindly called `.trim()`, `.toLowerCase()`,
 * `.split()`, etc. on the runtime value. When a boolean `false` slips into
 * a "string" field the page crashes with React error boundaries (e.g.
 * "e.trim is not a function").
 *
 * These guards keep the proper-fix invariant: NEVER coerce a non-string
 * to a string (because `String(false) === "false"` then matches
 * `lower !== '0'` and incorrectly classifies a closed door as "Open").
 * Instead, narrow before string operations and let consumers branch
 * explicitly on type.
 */

/** Returns `v` only when it is a non-empty string; `null` otherwise. */
export function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Returns `v` when it is a string (including empty); `null` otherwise. */
export function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Returns `v` when it is a finite number; `null` otherwise. */
export function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Returns `v` when it is a boolean; `null` otherwise. */
export function asBoolean(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
