/**
 * Time-zone resolution primitives.
 *
 * Provides:
 *   - {@link TzMode}          — 'vehicle' | 'user' | 'utc' display mode.
 *   - {@link browserTimezone} — host runtime IANA zone, or 'UTC' fallback.
 *   - {@link resolveTimezone} — pure mode → IANA zone resolver (non-React).
 *   - {@link useTimezone}     — React hook binding the resolver to live data.
 *
 * All backend timestamps stay in UTC; these helpers pick the IANA zone the
 * UI renders them in so the source-of-truth never shifts.
 */

// Native parity port of web/src/lib/timezone.ts.
//
// TzMode, browserTimezone, and resolveTimezone are pure, non-visual logic:
// they touch only the ECMAScript `Intl.DateTimeFormat` API (and plain string
// comparison), which behaves identically under Hermes (React Native) and Node
// (Jest). browserTimezone keeps the source try/catch so an Intl engine that
// lacks `resolvedOptions().timeZone` degrades to 'UTC' instead of throwing.
// There is no JSX, no DOM, and no Recharts / Leaflet / react-leaflet / old
// web-UI import here, so those three port byte-for-byte. (The same three are
// already inlined privately inside the native useDateFormat port; this file is
// their canonical public home.)
//
// The only structural change is `useTimezone`'s two React-hook dependencies,
// which have no 1:1 native equivalent — adapted exactly as the established
// native useDateFormat port does it:
//   - Web sourced the user's optional override from the app-level
//     `@/hooks/useSettings` wrapper (`settings.timezone_user`, always present
//     because that wrapper merges defaults). The native layer reads the same
//     `['settings']` query through `../api/hooks/useSettings`, whose `data` is
//     `undefined` until it resolves and whose `timezone_user` is optional.
//     `resolveTimezone` already treats an empty / nullish override as "no
//     override" (falls back to the host zone), so the unresolved-settings path
//     matches the web default (`timezone_user: ''`) byte-for-byte.
//   - Web sourced the vehicle's IANA zone from `useSelectedVehicle()` (URL >
//     store > first vehicle). The native layer has no global selected-vehicle
//     context, so — matching the page-parity precedent — the vehicle zone is
//     taken from the first vehicle of `useVehicles()`. `resolveTimezone` falls
//     back to the user zone when the vehicle has no usable tz (empty or 'UTC'),
//     so the 'vehicle' default still resolves correctly before any vehicle is
//     polled.

import {useSettings} from '../api/hooks/useSettings';
import {useVehicles} from '../api/hooks/useVehicles';

/**
 * Time-zone display modes for rendering timestamps in vehicle, browser, or UTC
 * time while data remains in UTC.
 */
export type TzMode = 'vehicle' | 'user' | 'utc';

/**
 * Resolves the host runtime's IANA timezone (the device zone under React
 * Native, the browser zone under react-native-web), or `'UTC'` if `Intl` is
 * unavailable.
 */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Pure helper to compute the IANA timezone string from a mode + the
 * vehicle's reported tz + the user's optional override. Designed to be
 * usable from non-React contexts (tests, server-rendered helpers).
 *
 * - `mode === 'utc'` → `'UTC'`
 * - `mode === 'user'` → `userOverride` if set, else host tz
 * - `mode === 'vehicle'` → vehicle's IANA tz, or fall back to user
 *   when the vehicle hasn't been polled yet (empty or `'UTC'`).
 */
export function resolveTimezone(
  mode: TzMode,
  vehicleTz?: string | null,
  userOverride?: string | null,
): string {
  if (mode === 'utc') {
    return 'UTC';
  }
  const userTz =
    userOverride && userOverride.trim() ? userOverride : browserTimezone();
  if (mode === 'user') {
    return userTz;
  }
  if (!vehicleTz || vehicleTz === 'UTC') {
    return userTz;
  }
  return vehicleTz;
}

/**
 * React hook returning the IANA timezone for the given mode, sourcing
 * the vehicle's tz from the fleet's first vehicle (`useVehicles()`) and the
 * user's optional override from `useSettings()`. Only call inside
 * provider-mounted components — pure rendering paths should use
 * `resolveTimezone()`.
 */
export function useTimezone(mode: TzMode = 'vehicle'): string {
  const {data: vehicles} = useVehicles();
  const {data: settings} = useSettings();
  const vehicleTz =
    vehicles && vehicles.length > 0 ? vehicles[0].timezone : undefined;
  return resolveTimezone(mode, vehicleTz, settings?.timezone_user);
}
