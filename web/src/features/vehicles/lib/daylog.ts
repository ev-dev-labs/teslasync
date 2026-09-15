import type { ComponentType } from 'react';
import { Icons } from '@/lib/icons';
import { ymdInTz } from '@/lib/dateFormat';
import type { DayLogEvent, DayLogLayer } from '@/api/types';

/** Optional layers in stable display order (all off by default). */
export const DAY_LOG_LAYERS: readonly DayLogLayer[] = [
  'turn_signals',
  'lights',
  'doors_windows',
  'hvac',
  'gear',
  'homelink',
] as const;

/** English fallbacks so tests and missing catalogs still read as labels. */
export const DAY_LOG_LAYER_LABEL: Record<DayLogLayer, string> = {
  turn_signals: 'Turn signals',
  lights: 'Lights / hazards',
  doors_windows: 'Doors / windows',
  hvac: 'HVAC on/off',
  gear: 'Gear changes',
  homelink: 'Homelink / home/work',
};

export const DAY_LOG_EVENT_TITLE: Record<string, string> = {
  drive_start: 'Drive started',
  drive_end: 'Drive ended',
  charge_start: 'Charge started',
  charge_end: 'Charge ended',
  parked: 'Parked',
  online: 'Online',
  asleep: 'Asleep',
  offline: 'Offline',
  state_change: 'State change',
  locked: 'Locked',
  unlocked: 'Unlocked',
  lock_unknown: 'Lock state unknown',
  sentry_on: 'Sentry on',
  sentry_off: 'Sentry off',
  sentry_unknown: 'Sentry state unknown',
  remote_start_on: 'Remote start active',
  remote_start_off: 'Remote start ended',
  sw_update: 'Software update',
  sw_update_installed: 'Software update installed',
  turn_signal: 'Turn signal',
  hazards_on: 'Hazards on',
  hazards_off: 'Hazards off',
  high_beams_on: 'High beams on',
  high_beams_off: 'High beams off',
  door_open: 'Door opened',
  door_closed: 'Door closed',
  window: 'Window moved',
  hvac_on: 'HVAC on',
  hvac_off: 'HVAC off',
  gear: 'Gear change',
  homelink_nearby_on: 'Homelink nearby',
  homelink_nearby_off: 'Homelink away',
  arrived_home: 'Arrived home',
  left_home: 'Left home',
  arrived_work: 'Arrived at work',
  left_work: 'Left work',
  arrived_favorite: 'Arrived at favorite',
  left_favorite: 'Left favorite',
};

export const DAY_LOG_SOURCE_STATUS: Record<string, string> = {
  ok: 'Have data',
  empty: 'No rows',
  unavailable: 'Unavailable',
};

/** True for well-formed `YYYY-MM-DD` calendar dates (no Date parsing). */
export function isValidYmd(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  // Round-trip through the local-time constructor: overflow (Feb 30)
  // does not survive, so a mismatch means an impossible date.
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/**
 * Shift a `YYYY-MM-DD` day by whole days. Pure calendar math through
 * the local-time constructor — never `new Date("…")`, which parses as
 * UTC and shifts the day for negative-offset zones. Returns null for
 * malformed input rather than guessing.
 */
export function addDaysYmd(ymd: string, delta: number): string | null {
  if (!isValidYmd(ymd)) return null;
  const [y, mo, d] = ymd.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  dt.setDate(dt.getDate() + delta);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** Today's `YYYY-MM-DD` in the given IANA timezone (browser when unset). */
export function todayYmd(tz?: string): string {
  return ymdInTz(new Date(), tz) ?? '1970-01-01';
}

/** Timeline-dot icon per event type. Unknown types get the fallback. */
export const DAY_LOG_ICON: Record<string, ComponentType<{ className?: string }>> = {
  drive_start: Icons.drive,
  drive_end: Icons.drive,
  charge_start: Icons.charging,
  charge_end: Icons.charging,
  parked: Icons.parking,
  online: Icons.activity,
  asleep: Icons.moon,
  offline: Icons.wifiOff,
  state_change: Icons.info,
  locked: Icons.locked,
  unlocked: Icons.unlocked,
  lock_unknown: Icons.key,
  sentry_on: Icons.securityAlert,
  sentry_off: Icons.securityOff,
  sentry_unknown: Icons.security,
  remote_start_on: Icons.power,
  remote_start_off: Icons.power,
  sw_update: Icons.download,
  sw_update_installed: Icons.success,
  turn_signal: Icons.arrowLeftRight,
  hazards_on: Icons.warning,
  hazards_off: Icons.warning,
  high_beams_on: Icons.lightbulb,
  high_beams_off: Icons.lightbulb,
  door_open: Icons.doorOpen,
  door_closed: Icons.doorOpen,
  window: Icons.doorOpen,
  hvac_on: Icons.climate,
  hvac_off: Icons.climate,
  gear: Icons.settingsAlt,
  homelink_nearby_on: Icons.home,
  homelink_nearby_off: Icons.home,
  arrived_home: Icons.location,
  left_home: Icons.location,
  arrived_work: Icons.location,
  left_work: Icons.location,
  arrived_favorite: Icons.location,
  left_favorite: Icons.location,
};

export function eventIcon(type: string): ComponentType<{ className?: string }> {
  return DAY_LOG_ICON[type] ?? Icons.activity;
}

/** Timeline-dot accent per event type (solid dot hues, no gradients). */
export const DAY_LOG_ACCENT: Record<string, string> = {
  drive_start: '#22d3ee',
  drive_end: '#22d3ee',
  charge_start: '#34d399',
  charge_end: '#34d399',
  parked: '#94a3b8',
  online: '#38bdf8',
  asleep: '#64748b',
  offline: '#78716c',
  state_change: '#94a3b8',
  locked: '#fbbf24',
  unlocked: '#fbbf24',
  lock_unknown: '#78716c',
  sentry_on: '#f87171',
  sentry_off: '#34d399',
  sentry_unknown: '#78716c',
  remote_start_on: '#38bdf8',
  remote_start_off: '#64748b',
  sw_update: '#38bdf8',
  sw_update_installed: '#34d399',
};

export function eventAccent(type: string): string {
  return DAY_LOG_ACCENT[type] ?? '#94a3b8';
}

/**
 * Deep-link target for ref events. Returns null for non-linkable
 * events (missing/invalid ref) so callers render plain text.
 */
export function eventHref(event: DayLogEvent): string | null {
  if (event.ref_kind == null || event.ref_id == null) return null;
  if (!Number.isInteger(event.ref_id) || event.ref_id <= 0) return null;
  if (event.ref_kind === 'drive') return `/drives/${event.ref_id}`;
  if (event.ref_kind === 'charge') return `/charging/${event.ref_id}`;
  return null;
}

/** Payload readers — payload is `Record<string, unknown>`, never `any`. */
export function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

export function payloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
