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
  ) => ['fsm-transitions', entityId, fsmType, hours, page, perPage] as const,
};

export function useFSMStats(entityId: string) {
  return useQuery({
    queryKey: fsmKeys.stats(entityId),
    queryFn: () =>
      request<FSMStats>(`/fsm/stats?vehicle_id=${entityId}`),
    enabled: !!entityId,
    refetchInterval: INTERVALS.FAST,
  });
}

export function useFSMTransitions(
  entityId: string,
  fsmType: FSMType,
  hours: number,
  page: number,
  perPage: number,
) {
  const typeParam = fsmType === 'all' ? '' : `&fsm_type=${fsmType}`;
  return useQuery({
    queryKey: fsmKeys.transitions(entityId, fsmType, hours, page, perPage),
    queryFn: () =>
      request<FSMTransitionResponse>(
        `/fsm/transitions?vehicle_id=${entityId}&hours=${hours}&page=${page}&per_page=${perPage}${typeParam}`,
      ),
    enabled: !!entityId,
    refetchInterval: INTERVALS.FAST,
  });
}
