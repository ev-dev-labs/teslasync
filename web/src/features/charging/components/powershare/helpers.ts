import type { BadgeVariant } from '@/types/fsm';
import type { NeonColor } from '@/lib/tokens';
import { formatTime } from '@/lib/dateFormat';
import type { SignalObservation } from '@/types/signals';
import type { TrendPoint } from './constants';

/** Map a Powershare status string → Badge variant. */
export function statusVariant(status: string | null): BadgeVariant {
  if (!status) return 'neutral';
  const s = status.toLowerCase();
  if (s.includes('error') || s.includes('fail')) return 'danger';
  // Negative states are matched before the positive ones: the substring
  // "active" is contained inside "inactive" (Tesla's real off-state is
  // `PowershareStateInactive`), so an active-first check would paint an
  // inactive/off session as a green "success".
  if (s.includes('inactive') || s.includes('off')) return 'neutral';
  // `Enabled` / `EnabledReconnectingSoon` are Tesla's canonical active states —
  // match them alongside the generic active/on synonyms.
  if (s.includes('active') || s.includes('enabled') || s.includes('on')) return 'success';
  return 'warning';
}

/** Map a Powershare status string → neon accent for the KPI card. */
export function statusNeon(status: string | null): NeonColor {
  switch (statusVariant(status)) {
    case 'success':
      return 'green';
    case 'danger':
      return 'red';
    case 'warning':
      return 'amber';
    default:
      return 'blue';
  }
}

/** Tailwind bg class for the StatusPill dot — color-independent status still
 *  pairs with the humanized text label beside it. */
export function statusDotClass(status: string | null): string {
  switch (statusVariant(status)) {
    case 'success':
      return 'bg-emerald-400';
    case 'danger':
      return 'bg-rose-400';
    case 'warning':
      return 'bg-amber-400';
    default:
      return 'bg-slate-400';
  }
}

/** Map a Powershare stop-reason string → Badge variant. */
export function stopReasonVariant(reason: string | null): BadgeVariant {
  if (!reason) return 'neutral';
  const r = reason.toLowerCase();
  // "None" — with or without its `PowershareStopReasonStatus` proto prefix —
  // is a non-problem state, so it stays neutral rather than amber.
  if (r.includes('none')) return 'neutral';
  if (r.includes('user')) return 'warning';
  if (r.includes('error') || r.includes('fault') || r.includes('low')) return 'danger';
  return 'warning';
}

/**
 * Turn a proto-prefixed enum literal (e.g. `PowershareStatusActive`,
 * `PowershareStopReasonUserRequest`) into a human label ("Active",
 * "User Request"). Strips the supplied signal prefix (falling back to a generic
 * `Powershare` strip) then splits camelCase. Returns null for empty input so
 * callers can render a "—" placeholder.
 */
export function humanizeEnum(raw: string | null, prefix?: string): string | null {
  if (!raw) return null;
  let s = raw;
  if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length);
  else if (s.startsWith('Powershare')) s = s.slice('Powershare'.length);
  s = s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  return s.length > 0 ? s : raw;
}

/**
 * Build a chronological trend from a signal-observations result. The backend
 * returns newest-first, so we walk it in reverse and drop any rows whose
 * numeric value is null or non-finite (text/bool/compound kinds coerce to
 * null; a stray NaN/Infinity would poison the chart's axis and peak scale).
 */
export function buildSeries(data: SignalObservation[] | undefined): TrendPoint[] {
  const rows = data ?? [];
  const points: TrendPoint[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const value = row?.value_numeric;
    if (value == null || !Number.isFinite(value)) continue;
    points.push({ ts: row.ts, label: formatTime(row.ts), value });
  }
  return points;
}

/** Largest value in a trend (used as the MetricBar/relative-scale ceiling).
 *  Floors at 0 and is null-safe so a missing/undefined series can't throw. */
export function seriesPeak(points: TrendPoint[]): number {
  return (points ?? []).reduce((max, p) => (p.value > max ? p.value : max), 0);
}
