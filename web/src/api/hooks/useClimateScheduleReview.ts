import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClimateScheduleOption, ClimateScheduleSettings } from '@/types/climateScheduleReview';
import { isApiError, request } from '../client';
import { actionCenterKeys } from './useActionCenter';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change = { id: number; schedule?: ClimateScheduleOption };
const key = (scope: Scope, vehicle: number) => ['climate-schedule-review', scope, vehicle] as const;

export function useClimateScheduleReview(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: key(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: ClimateScheduleSettings }>(`/climate/scheduled-review?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useClimateScheduleReviewChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, schedule }: Change) => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      return schedule
        ? request<void>(`/climate/scheduled-review?vehicle_id=${vehicle}`, {
          ...options, method: 'PUT',
          body: JSON.stringify({
            automation_id: schedule.id, schedule_revision: schedule.updated_at,
            expected_plan_id: id, local_review_confirmed: true,
          }),
        })
        : request<void>(`/climate/scheduled-review?vehicle_id=${vehicle}&plan_id=${id}`, { ...options, method: 'DELETE' });
    },
    networkMode: 'always',
    gcTime: 0,
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: key(scope, vehicle) }),
        client.invalidateQueries({ queryKey: actionCenterKeys.all }),
      ]);
    },
  });
}
