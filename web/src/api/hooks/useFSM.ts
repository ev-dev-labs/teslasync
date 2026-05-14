import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { INTERVALS } from '@/lib/constants';
import type { FSMStats, FSMTransitionResponse, FSMType } from '@/types/fsm';

export const fsmKeys = {
  stats: (entityId: string) => ['fsm-stats', entityId] as const,
  transitions: (
    entityId: string,
    fsmType: string,
    hours: number,
    page: number,
    perPage: number,
    startInstant?: string,
    endInstant?: string,
  ) =>
    [
      'fsm-transitions',
      entityId,
      fsmType,
      hours,
      page,
      perPage,
      startInstant ?? '',
      endInstant ?? '',
    ] as const,
};

export function useFSMStats(entityId: string) {
  return useQuery({
    queryKey: fsmKeys.stats(entityId),
    queryFn: ({ signal }) =>
      request<FSMStats>(`/fsm/stats?vehicle_id=${entityId}`, { signal }),
    enabled: !!entityId,
    refetchInterval: INTERVALS.FAST,
  });
}

/**
 * Fetches the FSM transition log filtered to a calendar window.
 *
 * `startInstant` / `endInstantExclusive` MUST be RFC 3339 instants
 * (e.g. `2026-05-12T07:00:00.000Z`) representing the half-open
 * `[start, end)` window already resolved to the user's display
 * timezone. Build them from `useRangeState`'s `startInstant` /
 * `endInstantExclusive` so calendar-day strings never reach the wire
 * — the legacy `YYYY-MM-DD` shape silently dropped today's local rows
 * for any user not on UTC.
 */
export function useFSMTransitions(
  entityId: string,
  fsmType: FSMType,
  hours: number,
  page: number,
  perPage: number,
  startInstant?: string,
  endInstantExclusive?: string,
) {
  const nameParam = fsmType === 'all' ? '' : `&fsm_name=${fsmType}`;
  const dateParams =
    startInstant && endInstantExclusive
      ? `&start=${encodeURIComponent(startInstant)}` +
        `&end=${encodeURIComponent(endInstantExclusive)}`
      : '';
  return useQuery({
    queryKey: fsmKeys.transitions(
      entityId,
      fsmType,
      hours,
      page,
      perPage,
      startInstant,
      endInstantExclusive,
    ),
    queryFn: ({ signal }) =>
      request<FSMTransitionResponse>(
        `/fsm/transitions?vehicle_id=${entityId}&hours=${hours}&page=${page}&per_page=${perPage}${nameParam}${dateParams}`,
        { signal },
      ),
    enabled: !!entityId,
    refetchInterval: INTERVALS.FAST,
  });
}
