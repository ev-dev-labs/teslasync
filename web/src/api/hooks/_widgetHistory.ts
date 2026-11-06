export type WidgetTimeRange = '24h' | '7d' | '30d' | '90d';

const RANGE_MS: Record<WidgetTimeRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export function isWidgetTimeRange(value: string | undefined): value is WidgetTimeRange {
  return value !== undefined && Object.prototype.hasOwnProperty.call(RANGE_MS, value);
}

export function widgetTimeBounds(range: string, now = new Date()): { start: string; end: string } {
  if (!isWidgetTimeRange(range)) {
    throw new Error('Invalid widget time range');
  }
  return {
    start: new Date(now.getTime() - RANGE_MS[range]).toISOString(),
    end: now.toISOString(),
  };
}

interface WidgetHistoryOptions {
  limit?: number;
  start?: string;
  range?: string;
  completeRange?: boolean;
}

/** Fetch a rolling widget window on the server; aggregates consume every page. */
export async function fetchWidgetHistory<T extends { id: number }>(
  vehicleId: number,
  options: WidgetHistoryOptions,
  fetchPage: (params: URLSearchParams) => Promise<T[] | null>,
): Promise<T[]> {
  if (!Number.isSafeInteger(vehicleId) || vehicleId <= 0) {
    throw new Error('Vehicle scope has not resolved');
  }
  const bounds = options.range === undefined ? undefined : widgetTimeBounds(options.range);
  const start = bounds?.start ?? options.start;
  const complete = options.completeRange === true && bounds !== undefined;
  const limit = complete ? 1000 : options.limit;
  const rows: T[] = [];
  const seen = new Set<number>();

  for (let offset = 0; ; offset += limit ?? 0) {
    const params = new URLSearchParams({ vehicle_id: String(vehicleId) });
    if (limit !== undefined) params.set('limit', String(limit));
    if (start) params.set('start', start);
    if (bounds) params.set('end', bounds.end);
    if (complete) params.set('offset', String(offset));
    const page = await fetchPage(params);
    if (page === null) return rows;
    if (!Array.isArray(page) || (limit !== undefined && page.length > limit)) {
      throw new Error('Invalid widget history response');
    }
    if (!complete) return page;
    for (const row of page) {
      if (!row || !Number.isSafeInteger(row.id) || seen.has(row.id)) {
        throw new Error('Widget history changed while loading; retry');
      }
      seen.add(row.id);
    }
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
