import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import type { DayLogLayer, DayLogResponse } from '../types';

/** Page size for the all-pages fetch loop (server max is 2000). */
export const DAY_LOG_PAGE_LIMIT = 2000;

export const dayLogKeys = {
  all: ['day-log'] as const,
  day: (vehicleId: number, date: string, timezone: string, layers: readonly string[]) =>
    ['day-log', vehicleId, date, timezone, [...layers].sort().join(',')] as const,
};

export interface UseDayLogParams {
  /** Effective vehicle id; query stays disabled until a positive id lands. */
  vehicleId: number | null;
  /** Local calendar day, `YYYY-MM-DD` (never a Date — no UTC footgun). */
  date: string;
  /** IANA timezone the server computes day boundaries in. */
  timezone: string;
  /**
   * Optional layers to enable. Omitted/empty means the COMPLETE
   * history (server enables every layer); an explicit list narrows.
   */
  layers?: DayLogLayer[];
}

async function fetchAllPages(
  vehicleId: number,
  date: string,
  timezone: string,
  layers: DayLogLayer[],
  signal: AbortSignal | undefined,
): Promise<DayLogResponse> {
  const base = new URLSearchParams({
    vehicle_id: String(vehicleId),
    date,
    timezone,
    limit: String(DAY_LOG_PAGE_LIMIT),
  });
  if (layers.length > 0) base.set('layers', layers.join(','));

  // Retrieve every page: the day is complete only when the loaded
  // count reaches total_events. Guarded against a non-advancing
  // server so a bug cannot spin forever.
  const first = await request<DayLogResponse>(`/day-log?${base.toString()}`, { signal });
  const total = first.total_events;
  const events = [...(first.events ?? [])];
  let offset = events.length;
  while (events.length < total) {
    const params = new URLSearchParams(base);
    params.set('offset', String(offset));
    const page = await request<DayLogResponse>(`/day-log?${params.toString()}`, { signal });
    const got = page.events ?? [];
    if (got.length === 0) break;
    events.push(...got);
    offset += got.length;
    if (offset > total + DAY_LOG_PAGE_LIMIT) break;
  }
  return { ...first, events, offset: 0, limit: DAY_LOG_PAGE_LIMIT };
}

/**
 * Fetches one vehicle's COMPLETE local-day event history.
 *
 * The query resolves only after every page is loaded (see
 * total_events), so consumers never mistake a partial page for the
 * whole day. Day-log rows close on state transitions (drives,
 * sessions, FSM edges), so the `operational` tier fits: no ambient
 * poll, SSE/mutation invalidation is the refresh path.
 */
export function useDayLog({ vehicleId, date, timezone, layers = [] }: UseDayLogParams) {
  const id = typeof vehicleId === 'number' && Number.isInteger(vehicleId) && vehicleId > 0 ? vehicleId : null;
  const enabled = id != null && date !== '' && timezone !== '';

  return useQuery({
    queryKey: dayLogKeys.day(id ?? 0, date, timezone, layers),
    queryFn: ({ signal }) => {
      if (id == null) throw new Error('vehicleId is required');
      return fetchAllPages(id, date, timezone, layers, signal);
    },
    enabled,
    ...queryPolicy('operational'),
  });
}
