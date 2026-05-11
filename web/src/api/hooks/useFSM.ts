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
    startDate?: string,
    endDate?: string,
  ) =>
    [
      'fsm-transitions',
      entityId,
      fsmType,
      hours,
      page,
      perPage,
      startDate ?? '',
      endDate ?? '',
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

export function useFSMTransitions(
  entityId: string,
  fsmType: FSMType,
  hours: number,
  page: number,
  perPage: number,
  startDate?: string,
  endDate?: string,
) {
  const nameParam = fsmType === 'all' ? '' : `&fsm_name=${fsmType}`;
  // When the caller passes an explicit start/end (canonical RangePicker
  // window), prefer those over the rolling-from-now `hours` so historical
  // presets like `yesterday`/`lastMonth` and custom calendar picks return
  // the actual chosen window. The `hours` param is still sent for backward
  // compatibility with backends that may not yet support start/end (and is
  // ignored by the modern handler when start/end are present).
  const dateParams =
    startDate && endDate ? `&start=${startDate}&end=${endDate}` : '';
  return useQuery({
    queryKey: fsmKeys.transitions(
      entityId,
      fsmType,
      hours,
      page,
      perPage,
      startDate,
      endDate,
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
