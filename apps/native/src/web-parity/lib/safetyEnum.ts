/**
 * Safety enum normalization helpers.
 *
 * The backend serializes raw signal.SignalValue (`interface{}`) directly
 * via /api/v1/safety/latest
 * and /api/v1/safety. Several "string"-typed enum fields can therefore
 * arrive as:
 *   - native `boolean` — when the protomodel emits an ADAS toggle the
 *     user has disabled (e.g. ForwardCollisionWarning = false on a car
 *     that doesn't have FSD).
 *   - native `number` — for legacy signal_log rows from before the
 *     codec was added (e.g. CruiseFollowDistance = 3.0 instead of "3").
 *   - the typed enum string — `"FollowDistance3"`, `"SpeedAssistLevelChime"`,
 *     etc.
 *   - the codec-stripped enum suffix — `"3"`, `"Chime"`.
 *
 * `cleanEnum` is the SINGLE choke point: every renderer / classifier
 * MUST funnel its raw value through here so we never call `.startsWith`,
 * `.toLowerCase`, or `String().toLowerCase` on a value whose runtime
 * shape we don't control.
 *
 * NEVER do `String(value).toLowerCase() !== 'off'` — that silently
 * coerces booleans (`String(false) === "false"`, which is `!== 'off'`,
 * so a disabled-by-bool feature would be classified as on).
 *
 * ## Native conversion (contract rules 6 + 7)
 *
 * safetyEnum.ts is non-visual utility/type code (a raw-enum string
 * registry, a derived keyof field type, and two pure normalizers). It
 * touches no DOM, no browser globals, no Recharts/Leaflet, and no web UI
 * components, so the logic ports 1:1 to React Native-compatible TypeScript
 * (contract rule 6).
 *
 * On the web this module imports `asNonEmptyString` and `asFiniteNumber`
 * from `./typeGuards`. That typeGuards module is not yet part of the native
 * parity layer, so — following the sibling SecurityAccessPage.tsx /
 * WindowStatusDetail.tsx native ports (which inline `asNonEmptyString` for
 * the same reason) — the two consumed guards are inlined verbatim below.
 * They stay module-private so safetyEnum.ts's public surface stays identical
 * to the web (`SAFETY_ENUM_PREFIXES`, `SafetyEnumField`, `cleanSafetyEnum`,
 * `isSafetyEnumActive`). When typeGuards is ported to native these inlines
 * collapse to a relative import.
 */

// `asNonEmptyString` / `asFiniteNumber` inlined from web `@/lib/typeGuards`
// (no native typeGuards module). See the native-conversion header above.

/** Returns `v` only when it is a non-empty string; `null` otherwise. */
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Returns `v` when it is a finite number; `null` otherwise. */
function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Tesla raw enum prefixes that need stripping for old signal_log rows. */
export const SAFETY_ENUM_PREFIXES = {
  forward_collision_warning: 'ForwardCollisionSensitivity',
  lane_departure_avoidance: 'LaneAssistLevel',
  speed_limit_warning: 'SpeedAssistLevel',
  cruise_follow_distance: 'FollowDistance',
} as const;

export type SafetyEnumField = keyof typeof SAFETY_ENUM_PREFIXES;

/** Convert a raw safety-enum value into a human-renderable, prefix-stripped
 *  string. Accepts `unknown`. Returns `fallback` for null/undefined/empty.
 *  Booleans render as "On" / "Off". Numbers render as their decimal form. */
export function cleanSafetyEnum(
  value: unknown,
  field: SafetyEnumField,
  fallback = '—',
): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';

  const num = asFiniteNumber(value);
  if (num !== null) return String(num);

  const raw = asNonEmptyString(value);
  if (!raw) return fallback;

  const prefix = SAFETY_ENUM_PREFIXES[field];
  if (prefix && raw.startsWith(prefix)) {
    const stripped = raw.slice(prefix.length);
    if (field === 'speed_limit_warning' && stripped === 'None') return 'Off';
    return stripped || raw;
  }
  return raw;
}

/** Whether a safety-enum value represents an ENABLED feature.
 *  Centralizes the "off / none / disabled / 0" classification so callers
 *  don't reinvent it (and don't reinvent it WRONG via String() coercion). */
export function isSafetyEnumActive(
  value: unknown,
  field: SafetyEnumField,
): boolean {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  const cleaned = cleanSafetyEnum(value, field, '');
  if (cleaned === '') return false;
  const lower = cleaned.toLowerCase();
  if (
    lower === 'off' ||
    lower === 'none' ||
    lower === 'disabled' ||
    lower === '0'
  )
    return false;
  return true;
}
