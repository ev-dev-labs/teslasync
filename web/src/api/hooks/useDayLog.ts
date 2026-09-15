import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import type { DayLogLayer, DayLogResponse } from '../types';

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
  /** Optional layers to enable (off by default — too noisy). */
  layers?: DayLogLayer[];
}

/**
 * Fetches one vehicle's local-day event timeline.
 *
 * Day-log rows close on state transitions (drives, sessions, FSM edges),
 * so the `operational` tier fits: no ambient poll, SSE/mutation
 * invalidation is the refresh path. The server echoes the resolved
 * `day_start`/`day_end` (UTC) so the page never recomputes boundaries.
 */
export function useDayLog({ vehicleId, date, timezone, layers = [] }: UseDayLogParams) {
  const id = typeof vehicleId === 'number' && Number.isInteger(vehicleId) && vehicleId > 0 ? vehicleId : null;
  const enabled = id != null && date !== '' && timezone !== '';

  return useQuery({
    queryKey: dayLogKeys.day(id ?? 0, date, timezone, layers),
    queryFn: ({ signal }) => {
      if (id == null) throw new Error('vehicleId is required');
      const params = new URLSearchParams({ vehicle_id: String(id), date, timezone });
      if (layers.length > 0) params.set('layers', layers.join(','));
      return request<DayLogResponse>(`/day-log?${params.toString()}`, { signal });
    },
    enabled,
    ...queryPolicy('operational'),
  });
}
