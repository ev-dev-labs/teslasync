import type { SecurityEvent } from '@/types/admin';
import { asNonEmptyString } from '@/lib/typeGuards';
import { ymdInTz } from '@/lib/dateConvert';

/** Minimal translator shape — matches react-i18next's `t` for the
 *  `(key, defaultValue, options?)` call form these formatters use so the
 *  UI-facing strings they return stay i18n-driven. */
export type Translate = (key: string, defaultValue: string, options?: Record<string, unknown>) => string;

/* ------------------------------------------------------------------ */
/*  Helper types                                                       */
/* ------------------------------------------------------------------ */

export type WindowState = 'Closed' | 'Venting' | 'Open' | 'Unknown';

/** Token-driven tile accent tones. Maps a semantic state to a toned
 *  300-level color used by <StatusTile> for the icon chip + value text.
 *  `muted` renders a neutral chip for unknown/inactive states. */
export type TileTone = 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'cyan' | 'muted';

export interface SentryDayBucket {
  date: string;
  sentryOn: number;
  sentryOff: number;
  sentryUnknown?: number;
}

export interface TimelineEvent {
  id: string;
  kind: 'lock' | 'sentry' | 'door';
  variant: 'positive' | 'negative' | 'neutral';
  detail: string;
  timestamp: string;
}

export interface SecurityStats {
  lockEvents: number;
  doorOpenCount: number;
  windowOpenCount: number;
  homelinkCount: number;
  guestCount: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Window helpers                                                     */
/* ------------------------------------------------------------------ */

export function parseWindowState(val: unknown): WindowState {
  const raw = asNonEmptyString(val);
  if (!raw) return 'Unknown';
  const lower = raw.trim().toLowerCase();
  if (lower === 'closed' || lower === '0') return 'Closed';
  if (lower.includes('vent')) return 'Venting';
  if (lower.includes('open')) return 'Open';
  return 'Unknown';
}

/** Maps a parsed window state to a <StatusTile> accent tone. */
export function windowTone(state: WindowState): TileTone {
  switch (state) {
    case 'Closed':
      return 'green';
    case 'Venting':
      return 'amber';
    case 'Open':
      return 'red';
    default:
      return 'muted';
  }
}

/* ------------------------------------------------------------------ */
/*  Door helpers                                                       */
/* ------------------------------------------------------------------ */

/** Null means missing/unrecognized evidence, never measured closed or open. */
export function doorClosed(state: unknown): boolean | null {
  // Backend may emit DoorState as bool/object.
  if (state == null) return null;
  if (typeof state === 'boolean') return !state;
  if (typeof state === 'number') return Number.isFinite(state) ? state === 0 : null;
  if (typeof state === 'object' && !Array.isArray(state)) {
    const values = Object.values(state);
    if (values.some((v) => v === true)) return false;
    return values.length > 0 && values.every((v) => v === false) ? true : null;
  }
  const raw = asNonEmptyString(state);
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (lower === 'closed' || lower === 'closedall' || lower === '0' || lower === 'false') return true;
  if (lower.startsWith('{')) {
    try {
      return doorClosed(JSON.parse(raw));
    } catch { return null; }
  }
  return lower.includes('open') || lower === 'true' ? false : null;
}

export function allWindowsClosed(ev: SecurityEvent | undefined): boolean | null {
  if (!ev) return null;
  const states = [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow].map(parseWindowState);
  if (states.some((s) => s === 'Open' || s === 'Venting')) return false;
  return states.every((s) => s === 'Closed') ? true : null;
}

export function securityPosture(ev: SecurityEvent | undefined): boolean | null {
  const states = [ev?.locked ?? null, doorClosed(ev?.doorState), allWindowsClosed(ev)];
  if (states.includes(false)) return false;
  return states.every((state) => state === true) ? true : null;
}

export function windowSummary(ev: SecurityEvent | undefined, t: Translate): string {
  if (!ev) return '—';
  const states = [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow].map(parseWindowState);
  const allClosed = states.every((s) => s === 'Closed');
  if (allClosed) return t('admin.security.window.allClosed', 'All closed');
  const openCount = states.filter((s) => s === 'Open' || s === 'Venting').length;
  const unknown = states.includes('Unknown') ? t('admin.security.unknown', 'Unknown') : '';
  const measured = openCount > 0 ? t('admin.security.window.openVenting', '{{count}} open/venting', { count: openCount }) : '';
  return [measured, unknown].filter(Boolean).join(' · ');
}

/* ------------------------------------------------------------------ */
/*  Time helpers                                                       */
/* ------------------------------------------------------------------ */

export function timeSince(iso: string | null | undefined, t: Translate): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return '—';
  const seconds = Math.floor(diff / 1000);
  // relative-time: when the security event happened
  if (seconds < 60) return t('admin.security.time.justNow', 'just now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('admin.security.time.minutesAgo', '{{count}}m ago', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('admin.security.time.hoursAgo', '{{count}}h ago', { count: hours });
  const days = Math.floor(hours / 24);
  return t('admin.security.time.daysAgo', '{{count}}d ago', { count: days });
}

/* ------------------------------------------------------------------ */
/*  Sentry helpers                                                     */
/* ------------------------------------------------------------------ */

/** Known bool/enum states only; missing and future enums remain unknown. */
export function isSentryActive(val: unknown): boolean | null {
  if (typeof val === 'boolean') return val;
  const raw = asNonEmptyString(val);
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (lower === 'off' || lower === 'sentrymodestateoff') return false;
  if (['on', 'armed', 'sentrymodestatearmed', 'sentrymodestateaware', 'sentrymodestatepanic'].includes(lower)) return true;
  return null;
}

export function buildSentryBuckets(events: SecurityEvent[], timezone?: string): SentryDayBucket[] {
  const bucketMap = new Map<string, { on: number; off: number; unknown: number }>();

  for (const ev of events) {
    const dateKey = ev.createdAt ? ymdInTz(new Date(ev.createdAt), timezone) : null;
    if (!dateKey) continue;
    const bucket = bucketMap.get(dateKey) ?? { on: 0, off: 0, unknown: 0 };
    const active = isSentryActive(ev.sentryMode);
    if (active === true) {
      bucket.on += 1;
    } else if (active === false) {
      bucket.off += 1;
    } else {
      bucket.unknown += 1;
    }
    bucketMap.set(dateKey, bucket);
  }

  return Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({
      date,
      sentryOn: counts.on,
      sentryOff: counts.off,
      ...(counts.unknown > 0 ? { sentryUnknown: counts.unknown } : {}),
    }));
}

export function computeSentryUptime(events: SecurityEvent[]): number {
  if (events.length === 0) return 0;
  const sentryOnCount = events.filter((e) => isSentryActive(e.sentryMode) === true).length;
  return (sentryOnCount / events.length) * 100;
}

/* ------------------------------------------------------------------ */
/*  Lock helpers                                                       */
/* ------------------------------------------------------------------ */

export function findLastLockChange(events: SecurityEvent[]): string | undefined {
  const sorted = chronologicalEvents(events);
  let lastChange: string | undefined;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].locked != null && sorted[i - 1].locked != null && sorted[i].locked !== sorted[i - 1].locked) {
      lastChange = sorted[i].createdAt;
    }
  }
  return lastChange ?? sorted[0]?.createdAt;
}

function chronologicalEvents(events: SecurityEvent[]): SecurityEvent[] {
  return events.filter((ev) => Number.isFinite(Date.parse(ev.createdAt)))
    .slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/* ------------------------------------------------------------------ */
/*  Security statistics                                                */
/* ------------------------------------------------------------------ */

export function computeSecurityStats(history: SecurityEvent[]): SecurityStats | null {
  if (history.length === 0) return null;
  let lockEvents = 0;
  const sorted = chronologicalEvents(history);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].locked != null && sorted[i - 1].locked != null && sorted[i].locked !== sorted[i - 1].locked) lockEvents++;
  }
  const doorOpenCount = history.filter((e) => doorClosed(e.doorState) === false).length;
  const windowOpenCount = history.filter((e) => allWindowsClosed(e) === false).length;
  const homelinkCount = history.filter((e) => e.homelinkNearby).length;
  const guestCount = history.filter((e) => e.guestMode).length;
  return { lockEvents, doorOpenCount, windowOpenCount, homelinkCount, guestCount, total: history.length };
}

/* ------------------------------------------------------------------ */
/*  Timeline derivation (semantic — no translations)                   */
/* ------------------------------------------------------------------ */

export function deriveTimeline(events: SecurityEvent[]): TimelineEvent[] {
  if (events.length === 0) return [];

  const sorted = chronologicalEvents(events).reverse();

  const timeline: TimelineEvent[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const prev = sorted[i + 1];

    if (curr.locked != null && prev.locked != null && curr.locked !== prev.locked) {
      timeline.push({
        id: `lock-${curr.id}`,
        kind: 'lock',
        detail: asNonEmptyString(curr.doorState) ?? '—',
        timestamp: curr.createdAt,
        variant: curr.locked ? 'positive' : 'negative',
      });
    }

    const currSentry = isSentryActive(curr.sentryMode);
    const prevSentry = isSentryActive(prev.sentryMode);
    if (currSentry != null && prevSentry != null && curr.sentryMode !== prev.sentryMode) {
      timeline.push({
        id: `sentry-${curr.id}`,
        kind: 'sentry',
        detail: '',
        timestamp: curr.createdAt,
        variant: currSentry ? 'positive' : 'negative',
      });
    }

    const closed = doorClosed(curr.doorState);
    const prevClosed = doorClosed(prev.doorState);
    if (closed != null && prevClosed != null && curr.doorState !== prev.doorState) {
      timeline.push({
        id: `door-${curr.id}`,
        kind: 'door',
        detail: asNonEmptyString(curr.doorState) ?? '',
        timestamp: curr.createdAt,
        variant: closed ? 'positive' : 'negative',
      });
    }

    if (timeline.length >= 50) break;
  }

  return timeline.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}
