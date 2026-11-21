export const COLLECTIONS = ['all', 'anomalies', 'notable', 'commutes', 'tagged'] as const;
export type Collection = typeof COLLECTIONS[number];
export const FSD_FILTERS = ['all', 'reported', 'high', 'estimated', 'ambiguous', 'unknown'] as const;
export type FsdFilter = typeof FSD_FILTERS[number];
export const TREND_METRICS = ['drives', 'distance', 'score', 'efficiency', 'cost'] as const;

export const FSD_MAX_RANGE_DAYS = 366;

export function inclusiveDateKeySpan(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}
