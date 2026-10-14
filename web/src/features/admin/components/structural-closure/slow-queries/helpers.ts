import { fmtNumber } from '@/lib/numberFormat';
import type { SlowQueryOrderBy, SlowQueryRow } from '@/types/admin-operator-confidence';

export const ORDER_BY_OPTIONS: ReadonlyArray<{ value: SlowQueryOrderBy; labelKey: string; fallback: string }> = [
  { value: 'mean_time', labelKey: 'admin.slowQueries.orderMean', fallback: 'Mean time' },
  { value: 'total_time', labelKey: 'admin.slowQueries.orderTotal', fallback: 'Total time' },
  { value: 'calls', labelKey: 'admin.slowQueries.orderCalls', fallback: 'Calls' },
  { value: 'max_time', labelKey: 'admin.slowQueries.orderMax', fallback: 'Max time' },
];

export const LIMIT_OPTIONS = [10, 25, 50, 100];

/** Maps the sort control to the numeric field the chart ranks by. */
type MetricKey = 'mean_time_ms' | 'total_time_ms' | 'calls' | 'max_time_ms';
export const ORDER_TO_METRIC: Record<SlowQueryOrderBy, MetricKey> = {
  mean_time: 'mean_time_ms',
  total_time: 'total_time_ms',
  calls: 'calls',
  max_time: 'max_time_ms',
};


/** Format a millisecond duration, promoting to seconds past 1 s. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${fmtNumber(ms / 1000)} s`;
  return `${fmtNumber(ms)} ms`;
}

/** Clip long SQL fingerprints so axis ticks and bar labels stay one line. */
export function shortFingerprint(value: string, max = 28): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function cacheCounters(row: SlowQueryRow): [number, number] | null {
  const hit = row.shared_blks_hit;
  const read = row.shared_blks_read;
  if (hit == null || read == null || !Number.isFinite(hit) || !Number.isFinite(read)
    || hit < 0 || read < 0) return null;
  return [hit, read];
}

/** Unknown or untouched shared buffers have no measured cache hit ratio. */
export function cacheHitRatioValue(row: SlowQueryRow): number | null {
  const counters = cacheCounters(row);
  if (counters === null) return null;
  const [hit, read] = counters;
  const total = hit + read;
  if (total <= 0 || !Number.isFinite(total)) return null;
  return (hit / total) * 100;
}

/** Across-shown-queries evidence must be complete, not a partial-row estimate. */
export function cacheHitRatioTotalValue(rows: readonly SlowQueryRow[]): number | null {
  let hit = 0;
  let read = 0;
  for (const row of rows) {
    const counters = cacheCounters(row);
    if (counters === null) return null;
    hit += counters[0];
    read += counters[1];
  }
  const total = hit + read;
  return total > 0 && Number.isFinite(total) ? (hit / total) * 100 : null;
}

/** Table-cell label form of the cache hit ratio. */
export function cacheHitRatioLabel(row: SlowQueryRow): string {
  const v = cacheHitRatioValue(row);
  return v === null ? '—' : `${fmtNumber(v)}%`;
}
