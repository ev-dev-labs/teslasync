import type { SecurityEvent } from '@/types/admin';
import { asNonEmptyString } from '@/lib/typeGuards';

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
  const lower = raw.toLowerCase();
  if (lower === 'closed' || lower === '0') return 'Closed';
  if (lower.includes('vent')) return 'Venting';
  if (lower.includes('open') || lower !== '0') return 'Open';
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

export function doorClosed(state: unknown): boolean {
  // Backend may emit DoorState as bool/object.
  if (state == null) return true;
  if (typeof state === 'boolean') return !state;
  if (typeof state === 'number') return state === 0;
  if (typeof state === 'object' && !Array.isArray(state)) {
    return Object.values(state as Record<string, unknown>).every((v) => v === false || v == null);
  }
  const raw = asNonEmptyString(state);
  if (!raw) return true;
  const lower = raw.trim().toLowerCase();
  if (lower === '' || lower === 'closed' || lower === 'closedall' || lower === '0' || lower === 'false') return true;
  if (lower.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.values(parsed).every((v) => v === false || v == null);
    } catch { /* fall through */ }
  }
  return false;
}

export function allWindowsClosed(ev: SecurityEvent | undefined): boolean {
  if (!ev) return true;
  return [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow]
    .map(parseWindowState)
    .every((s) => s === 'Closed');
}

export function windowSummary(ev: SecurityEvent | undefined, t: Translate): string {
  if (!ev) return '—';
  const states = [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow].map(parseWindowState);
  const allClosed = states.every((s) => s === 'Closed');
  if (allClosed) return t('admin.security.window.allClosed', 'All Closed');
  const openCount = states.filter((s) => s !== 'Closed').length;
  return t('admin.security.window.openVenting', '{{count}} Open/Venting', { count: openCount });
}

/* ------------------------------------------------------------------ */
/*  Time helpers                                                       */
/* ------------------------------------------------------------------ */

export function timeSince(iso: string | null | undefined, t: Translate): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return '—';
  const seconds = Math.floor(diff / 1000);
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

/** Returns true if the SentryMode value means armed (any non-Off state).
 *  Accepts native bool and string enum values. */
export function isSentryActive(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  const raw = asNonEmptyString(val);
  if (!raw) return false;
  return !raw.toLowerCase().includes('off');
}

export function buildSentryBuckets(events: SecurityEvent[]): SentryDayBucket[] {
  const bucketMap = new Map<string, { on: number; off: number }>();

  for (const ev of events) {
    const dateKey = (ev.createdAt ?? '').slice(0, 10);
    const bucket = bucketMap.get(dateKey) ?? { on: 0, off: 0 };
    if (isSentryActive(ev.sentryMode)) {
      bucket.on += 1;
    } else {
      bucket.off += 1;
    }
    bucketMap.set(dateKey, bucket);
  }

  return Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({
      date,
      sentryOn: counts.on,
      sentryOff: counts.off,
    }));
}

export function computeSentryUptime(events: SecurityEvent[]): number {
  if (events.length === 0) return 0;
  const sentryOnCount = events.filter((e) => isSentryActive(e.sentryMode)).length;
  return (sentryOnCount / events.length) * 100;
}

/* ------------------------------------------------------------------ */
/*  Lock helpers                                                       */
/* ------------------------------------------------------------------ */

export function findLastLockChange(events: SecurityEvent[]): string | undefined {
  for (let i = 1; i < events.length; i++) {
    if (events[i].locked !== events[i - 1].locked) {
      return events[i - 1].createdAt;
    }
  }
  return events[0]?.createdAt;
}

/* ------------------------------------------------------------------ */
/*  Security statistics                                                */
/* ------------------------------------------------------------------ */

export function computeSecurityStats(history: SecurityEvent[]): SecurityStats | null {
  if (history.length === 0) return null;
  let lockEvents = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i].locked !== history[i - 1].locked) lockEvents++;
  }
  const doorOpenCount = history.filter((e) => !doorClosed(e.doorState)).length;
  const windowOpenCount = history.filter((e) => !allWindowsClosed(e)).length;
  const homelinkCount = history.filter((e) => e.homelinkNearby).length;
  const guestCount = history.filter((e) => e.guestMode).length;
  return { lockEvents, doorOpenCount, windowOpenCount, homelinkCount, guestCount, total: history.length };
}

/* ------------------------------------------------------------------ */
/*  Timeline derivation (semantic — no translations)                   */
/* ------------------------------------------------------------------ */

export function deriveTimeline(events: SecurityEvent[]): TimelineEvent[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const timeline: TimelineEvent[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const prev = sorted[i + 1];

    if (curr.locked !== prev.locked) {
      timeline.push({
        id: `lock-${curr.id}`,
        kind: 'lock',
        detail: asNonEmptyString(curr.doorState) ?? '—',
        timestamp: curr.createdAt,
        variant: curr.locked ? 'positive' : 'negative',
      });
    }

    if (curr.sentryMode !== prev.sentryMode) {
      timeline.push({
        id: `sentry-${curr.id}`,
        kind: 'sentry',
        detail: '',
        timestamp: curr.createdAt,
        variant: isSentryActive(curr.sentryMode) ? 'positive' : 'negative',
      });
    }

    if (curr.doorState !== prev.doorState) {
      const closed = doorClosed(curr.doorState);
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
