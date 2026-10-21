import { useSettings } from '@/hooks/useSettings';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

/**
 * Time-zone display modes for rendering timestamps in vehicle, browser, or UTC
 * time while data remains in UTC.
 */
export type TzMode = 'vehicle' | 'user' | 'utc';

/**
 * Narrow an arbitrary runtime value to a {@link TzMode}. The persisted
 * `settings.tz_display_default` column predates the enum, is nullable, and
 * is written by older clients, so at runtime it can be `undefined`, an empty
 * string, or a legacy value outside the union — none of which the nullish
 * coalescing operator alone would sanitise. Private: `useDateFormat` keeps
 * its own copy so it never gains imports from this widely-mocked module.
 */
function isTzMode(value: unknown): value is TzMode {
  return value === 'vehicle' || value === 'user' || value === 'utc';
}

/** Resolves the browser's IANA timezone, or `'UTC'` if `Intl` is unavailable. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Returns true when `tz` names a zone `Intl` can actually format in.
 * The settings override is free text and the vehicle zone comes from the
 * car, so both must be validated before use — handing an unknown name to
 * `Intl.DateTimeFormat` throws `RangeError` at render time.
 */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Usable IANA zone for `candidate`: the trimmed candidate when it is a
 * real zone, else the explicit fallback when that is real, else the
 * browser zone. Never throws, never returns an invalid zone.
 */
export function sanitizeTimezone(candidate: unknown, fallback?: string | null): string {
  if (typeof candidate === 'string' && isValidTimezone(candidate.trim())) return candidate.trim();
  if (isValidTimezone(fallback)) return fallback.trim();
  return browserTimezone();
}

/**
 * Pure helper to compute the IANA timezone string from a mode + the
 * vehicle's reported tz + the user's optional override. Designed to be
 * usable from non-React contexts (tests, server-rendered helpers).
 *
 * - `mode === 'utc'` → `'UTC'`
 * - `mode === 'user'` → `userOverride` if a real zone, else browser tz
 * - `mode === 'vehicle'` → vehicle's IANA tz, or fall back to user
 *   when the vehicle hasn't been polled yet (empty or `'UTC'`) or
 *   reports a name `Intl` cannot use.
 *
 * Invalid overrides never propagate: every return value is a zone
 * `Intl` accepts, so display formatters cannot throw on it.
 */
export function resolveTimezone(
  mode: TzMode,
  vehicleTz?: string | null,
  userOverride?: string | null,
): string {
  if (mode === 'utc') return 'UTC';
  const userTz = sanitizeTimezone(userOverride);
  if (mode === 'user') return userTz;
  if (isValidTimezone(vehicleTz) && vehicleTz.trim() !== 'UTC') {
    return vehicleTz.trim();
  }
  return userTz;
}

/**
 * UNSANITIZED resolution for business-instant conversion boundaries ONLY
 * (rate effective dates, journey departure inputs, schedule builders):
 * returns the raw saved/vehicle zone WITHOUT `Intl` validation, falling
 * back to the browser zone only when nothing is set. An invalid saved
 * zone therefore reaches the conversion helper, which decides: strict
 * helpers throw (the form surfaces a validation error instead of
 * persisting instants converted in a guessed zone); legacy wall-clock
 * parsers keep their browser-local fallback. NEVER use for display —
 * display must use {@link resolveTimezone} / `useTimezone`, which fall
 * back to a usable zone and can never throw at render time.
 */
export function resolveRawTimezone(
  mode: TzMode,
  vehicleTz?: string | null,
  userOverride?: string | null,
): string {
  if (mode === 'utc') return 'UTC';
  const userTz = userOverride && userOverride.trim() ? userOverride : browserTimezone();
  if (mode === 'user') return userTz;
  if (!vehicleTz || vehicleTz === 'UTC') return userTz;
  return vehicleTz;
}

/**
 * React hook returning the IANA timezone for the given mode, sourcing
 * the vehicle's tz from `useSelectedVehicle()` and the user's optional
 * override from `useSettings()`. Only call inside provider-mounted
 * components — pure rendering paths should use `resolveTimezone()`.
 */
export function useTimezone(mode: TzMode = 'vehicle'): string {
  const { vehicle } = useSelectedVehicle();
  const { settings } = useSettings();
  return resolveTimezone(mode, vehicle?.timezone, settings.timezone_user);
}

/**
 * React hook returning the UNSANITIZED conversion zone for business-instant
 * conversion boundaries (rate effective dates, journey departure inputs,
 * schedule builders). The mode mirrors `settings.tz_display_default`
 * (validated, `'vehicle'` fallback); the zone itself is raw per
 * {@link resolveRawTimezone} — an invalid saved zone reaches the conversion
 * helper instead of being pre-guessed by the display layer. Only call
 * inside provider-mounted components.
 */
export function useConversionTimezone(): string {
  const { vehicle } = useSelectedVehicle();
  const { settings } = useSettings();
  const requestedMode = settings.tz_display_default;
  const mode: TzMode = isTzMode(requestedMode) ? requestedMode : 'vehicle';
  return resolveRawTimezone(mode, vehicle?.timezone, settings.timezone_user);
}
