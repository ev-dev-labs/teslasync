/**
 * signalGapUtils — pure, framework-free helpers for the Signal Gap Detector.
 *
 * Centralizes the staleness math so both `SignalCatalogPanel` (the detail
 * table) and `useSignalGapAnalysis` (the page KPIs / charts) derive rows and
 * buckets from a single source of truth. No React, no JSX — trivially testable.
 */

import { fmtInt } from '@/lib/numberFormat';
import type { SignalRow } from '@/types/telemetry';

/** Age (seconds) below which a signal is considered live/active. */
export const GAP_ACTIVE_MAX_S = 30;
/** Age (seconds) below which a signal is considered aging (but not yet stale). */
export const GAP_AGING_MAX_S = 300;

/** Discrete staleness buckets used by the KPI band, chart, and legend. */
export type GapBucketKey = 'active' | 'aging' | 'stale' | 'never';

/** Series colors for the staleness buckets — color-blind-safe, theme-stable. */
export const GAP_BUCKET_COLORS: Record<GapBucketKey, string> = {
  active: '#10b981',
  aging: '#f59e0b',
  stale: '#ef4444',
  never: '#64748b',
};

export interface GapBuckets {
  total: number;
  active: number;
  aging: number;
  stale: number;
  never: number;
}

/**
 * Normalize the raw `/signals/{id}/live` map into typed `SignalRow`s.
 *
 * `liveData` entries are usually `{ value, timestamp }` objects but older
 * payloads sometimes ship a bare scalar; both shapes are tolerated. `now` is
 * injected so callers control the staleness reference (render time vs.
 * fetch time) and the function stays pure/deterministic under test.
 */
export function deriveSignalRows(
  liveData: Record<string, unknown> | null | undefined,
  now: number,
): SignalRow[] {
  if (!liveData) return [];
  return Object.entries(liveData).map(([name, entry]) => {
    const raw =
      entry && typeof entry === 'object'
        ? (entry as Record<string, unknown>)
        : { value: entry, timestamp: null };
    const ts = (raw as { timestamp?: string | null }).timestamp ?? null;
    const staleness = ts ? (now - new Date(ts).getTime()) / 1000 : Infinity;
    const category: SignalRow['category'] = !ts
      ? 'never'
      : staleness > GAP_AGING_MAX_S
        ? 'stale'
        : 'active';
    const value = (raw as { value?: unknown }).value;
    return {
      name,
      value: value != null ? String(value) : '—',
      timestamp: ts,
      staleness,
      category,
    };
  });
}

/** Tally derived rows into the four staleness buckets plus a total. */
export function computeGapBuckets(rows: SignalRow[]): GapBuckets {
  const buckets: GapBuckets = { total: rows.length, active: 0, aging: 0, stale: 0, never: 0 };
  for (const row of rows) {
    if (!row.timestamp) {
      buckets.never += 1;
    } else if (row.staleness < GAP_ACTIVE_MAX_S) {
      buckets.active += 1;
    } else if (row.staleness < GAP_AGING_MAX_S) {
      buckets.aging += 1;
    } else {
      buckets.stale += 1;
    }
  }
  return buckets;
}

/**
 * Fraction (0–100) of signals that are still arriving within the aging
 * window. This is the inverse of the "gap" surface (stale + never) and drives
 * the freshness gauge.
 */
export function computeFreshnessPct(buckets: GapBuckets): number {
  if (buckets.total <= 0) return 0;
  return Math.round(((buckets.active + buckets.aging) / buckets.total) * 100);
}

/** Human-readable "…ago" label for a staleness value in seconds. */
export function formatStaleness(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${fmtInt(seconds)}s ago`;
  if (seconds < 3600) return `${fmtInt(seconds / 60)}m ago`;
  const h = Math.floor(seconds / 3600);
  const m = (seconds % 3600) / 60;
  return `${h}h ${fmtInt(m)}m ago`;
}
