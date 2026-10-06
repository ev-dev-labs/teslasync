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

/** Shared-buffer cache hit ratio (0–100) or null when no blocks were touched. */
export function cacheHitRatioValue(row: SlowQueryRow): number | null {
  const hit = row.shared_blks_hit ?? 0;
  const read = row.shared_blks_read ?? 0;
  const total = hit + read;
  if (total <= 0) return null;
  return (hit / total) * 100;
}

/** Table-cell label form of the cache hit ratio. */
export function cacheHitRatioLabel(row: SlowQueryRow): string {
  const v = cacheHitRatioValue(row);
  return v === null ? '—' : `${fmtNumber(v)}%`;
}
