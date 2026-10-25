import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import { deriveDataState } from '../dataState';
import { scopedPath, scopeKey } from '../scope';
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

/** Paging failures retain actual records without claiming a server signal cap. */
export class DayLogPagingError extends Error {
  constructor(message: string, readonly partialData: DayLogResponse, readonly cause?: unknown) {
    super(message);
    this.name = 'DayLogPagingError';
  }
}

async function fetchAllPages(
  vehicleId: number,
  date: string,
  timezone: string,
  layers: DayLogLayer[],
  signal: AbortSignal | undefined,
): Promise<DayLogResponse> {
  const scopePath = scopedPath('/day-log', {
    vehicleId,
    timezone,
    filters: {
    date,
    limit: String(DAY_LOG_PAGE_LIMIT),
      ...(layers.length > 0 ? { layers: [...layers].sort().join(',') } : {}),
    },
  }, { includePresentation: true });
  const base = new URLSearchParams(scopePath.split('?')[1] ?? '');

  // Retrieve every page: the day is complete only when the loaded
  // count reaches total_events. Guarded against a non-advancing
  // server so a bug cannot spin forever.
  const first = await request<DayLogResponse>(`/day-log?${base.toString()}`, { signal });
  const total = first.total_events;
  const events = [...(first.events ?? [])];
  const retained = () => ({ ...first, events: [...events], offset: 0, limit: DAY_LOG_PAGE_LIMIT });
  const fail = (message: string): never => {
    throw new DayLogPagingError(message, retained());
  };
  const seen = new Set(events.map((event) => event.id));
  if (!Number.isSafeInteger(total) || total < 0 || first.offset !== 0
    || events.length > total || seen.size !== events.length) {
    fail('Invalid day-log paging metadata');
  }
  let offset = events.length;
  while (events.length < total) {
    const params = new URLSearchParams(base);
    params.set('offset', String(offset));
    let page: DayLogResponse;
    try {
      page = await request<DayLogResponse>(`/day-log?${params.toString()}`, { signal });
    } catch (cause) {
      // Cancellation belongs to Query's lifecycle, not a paging failure.
      if (signal?.aborted) throw cause;
      throw new DayLogPagingError('Day-log page request failed', retained(), cause);
    }
    const got = page.events ?? [];
    if (page.offset !== offset || page.total_events !== total
      || page.vehicle_id !== first.vehicle_id || page.date !== first.date
      || page.timezone !== first.timezone || page.day_start !== first.day_start
      || page.day_end !== first.day_end) {
      fail('Day-log paging metadata changed');
    }
    if (got.length === 0) fail('Day-log paging stopped before all records loaded');
    if (events.length + got.length > total || got.some((event) => seen.has(event.id))
      || new Set(got.map((event) => event.id)).size !== got.length) {
      fail('Day-log paging returned overlapping or excess records');
    }
    events.push(...got);
    got.forEach((event) => seen.add(event.id));
    offset += got.length;
  }
  return retained();
}

/**
 * Fetches one vehicle's COMPLETE local-day event history.
 *
 * The query succeeds only after every page is loaded. A paging error
 * exposes retained records alongside Query's failure/retry state; a
 * failed refresh keeps the last successful payload instead. The server's
 * `truncated` provenance is never synthesized. Day-log rows close on state transitions (drives,
 * sessions, FSM edges), so the `operational` tier fits: no ambient
 * poll, SSE/mutation invalidation is the refresh path.
 */
export function useDayLog({ vehicleId, date, timezone, layers = [] }: UseDayLogParams) {
  const id = typeof vehicleId === 'number' && Number.isInteger(vehicleId) && vehicleId > 0 ? vehicleId : null;
  const enabled = id != null && date !== '' && timezone !== '';
  const queryKey = dayLogKeys.day(id ?? 0, date, timezone, layers);
  const scope = JSON.stringify(scopeKey({
    vehicleId: id,
    timezone,
    filters: { date, layers: [...layers].sort().join(',') },
  }));
  const partial = useRef<{ scope: string; data: DayLogResponse } | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (id == null) throw new Error('vehicleId is required');
      try {
        const data = await fetchAllPages(id, date, timezone, layers, signal);
        if (partial.current?.scope === scope) partial.current = null;
        return data;
      } catch (error) {
        if (error instanceof DayLogPagingError && !signal.aborted) {
          partial.current = { scope, data: error.partialData };
        }
        throw error;
      }
    },
    enabled,
    ...queryPolicy('operational'),
  });
  const state = deriveDataState(query);
  const pagingError = state.fatalError instanceof DayLogPagingError
    ? state.fatalError as DayLogPagingError
    : null;
  return {
    ...query,
    data: query.data ?? pagingError?.partialData
      ?? (partial.current?.scope === scope ? partial.current.data : undefined),
    pagingError,
  };
}
