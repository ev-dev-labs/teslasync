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

/**
 * A vehicle id is usable by the FSM endpoints only when it is a positive
 * integer. Vehicle ids are `int64 > 0` on the backend, and the
 * `/fsm/transitions` handler rejects `vehicle_id=0` outright with HTTP 400
 * ("vehicle_id required") while `/fsm/stats` silently drops the
 * active-sub-FSM block for a non-positive id.
 *
 * The previous `enabled: !!entityId` guard only filtered the empty string,
 * so a `'0'` (a genuine "no vehicle resolved yet" sentinel), a stray
 * `'abc'`, a whitespace-padded `' 3'`, or a fractional `'2.5'` all fired a
 * request that could only ever fail or return a misleading partial payload.
 * Gating on this predicate keeps the "no vehicle selected" state truly
 * idle. Leading zeros (`'007'`) are accepted because the backend
 * `strconv.ParseInt` normalises them.
 */
export function isValidEntityId(entityId: string): boolean {
  return /^\d+$/.test(entityId) && Number(entityId) > 0;
}

/** Builds the `/fsm/stats` query path for a resolved vehicle id. */
export function buildStatsPath(entityId: string): string {
  return `/fsm/stats?vehicle_id=${entityId}`;
}

/**
 * Builds the `/fsm/transitions` query path.
 *
 * `fsmType === 'all'` omits the `fsm_name` filter so every FSM's rows are
 * returned. When BOTH `startInstant` and `endInstantExclusive` are present
 * they are appended as a half-open `[start, end)` window and take
 * precedence over `hours` on the backend; a lone bound is dropped (the
 * window is meaningless without both edges). Both instants are
 * percent-encoded so the `+` in an RFC 3339 offset survives the wire.
 */
export function buildTransitionsPath(
  entityId: string,
  fsmType: FSMType,
  hours: number,
  page: number,
  perPage: number,
  startInstant?: string,
  endInstantExclusive?: string,
): string {
  const nameParam = fsmType === 'all' ? '' : `&fsm_name=${fsmType}`;
  const dateParams =
    startInstant && endInstantExclusive
      ? `&start=${encodeURIComponent(startInstant)}` +
        `&end=${encodeURIComponent(endInstantExclusive)}`
      : '';
  return (
    `/fsm/transitions?vehicle_id=${entityId}` +
    `&hours=${hours}&page=${page}&per_page=${perPage}${nameParam}${dateParams}`
  );
}

export function useFSMStats(entityId: string) {
  return useQuery({
    queryKey: fsmKeys.stats(entityId),
    queryFn: ({ signal }) => request<FSMStats>(buildStatsPath(entityId), { signal }),
    enabled: isValidEntityId(entityId),
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
        buildTransitionsPath(
          entityId,
          fsmType,
          hours,
          page,
          perPage,
          startInstant,
          endInstantExclusive,
        ),
        { signal },
      ),
    enabled: isValidEntityId(entityId),
    refetchInterval: INTERVALS.FAST,
  });
}
