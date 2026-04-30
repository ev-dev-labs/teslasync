import type { SecurityEvent } from '@/types/admin';

/* ------------------------------------------------------------------ */
/*  Helper types                                                       */
/* ------------------------------------------------------------------ */

export type WindowState = 'Closed' | 'Venting' | 'Open' | 'Unknown';

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

export function parseWindowState(val: string | null | undefined): WindowState {
  if (!val) return 'Unknown';
  const lower = val.toLowerCase();
  if (lower === 'closed' || lower === '0') return 'Closed';
  if (lower.includes('vent')) return 'Venting';
  if (lower.includes('open') || lower !== '0') return 'Open';
  return 'Unknown';
}

export function windowColor(state: WindowState): string {
  switch (state) {
    case 'Closed':
      return 'bg-green-500/20 border-green-500/40';
    case 'Venting':
      return 'bg-amber-500/20 border-amber-500/40';
    case 'Open':
      return 'bg-red-500/20 border-red-500/40';
    default:
      return 'bg-gray-500/20 border-gray-500/40';
  }
}

export function windowTextClass(state: WindowState): string {
  switch (state) {
    case 'Closed':
      return 'text-green-400';
    case 'Venting':
      return 'text-amber-400';
    case 'Open':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}

/* ------------------------------------------------------------------ */
/*  Door helpers                                                       */
/* ------------------------------------------------------------------ */

export function doorClosed(state: string | null | undefined): boolean {
  if (!state) return true;
  const lower = state.trim().toLowerCase();
  if (lower === 'closed' || lower === 'closedall' || lower === '0' || lower === 'false') return true;
  if (lower.startsWith('{')) {
    try {
      const parsed = JSON.parse(state) as Record<string, unknown>;
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

export function windowSummary(ev: SecurityEvent | undefined): string {
  if (!ev) return '—';
  const states = [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow].map(parseWindowState);
  const allClosed = states.every((s) => s === 'Closed');
  if (allClosed) return 'All Closed';
  const openCount = states.filter((s) => s !== 'Closed').length;
  return `${openCount} Open/Venting`;
}

/* ------------------------------------------------------------------ */
/*  Time helpers                                                       */
/* ------------------------------------------------------------------ */

export function timeSince(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return '—';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Sentry helpers                                                     */
/* ------------------------------------------------------------------ */

/** Returns true if the SentryMode enum value means armed (any non-Off state). */
export function isSentryActive(val: string | null | undefined): boolean {
  if (!val) return false;
  return !val.toLowerCase().includes('off');
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
        detail: curr.doorState ?? '—',
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
        detail: curr.doorState ?? '—',
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
