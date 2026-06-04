import { useSettings } from '@/hooks/useSettings';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

/**
 * Time-zone display modes for rendering timestamps in vehicle, browser, or UTC
 * time while data remains in UTC.
 */
export type TzMode = 'vehicle' | 'user' | 'utc';

/** Resolves the browser's IANA timezone, or `'UTC'` if `Intl` is unavailable. */
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
 * - `mode === 'user'` → `userOverride` if set, else browser tz
 * - `mode === 'vehicle'` → vehicle's IANA tz, or fall back to user
 *   when the vehicle hasn't been polled yet (empty or `'UTC'`).
 */
export function resolveTimezone(
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
