import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MileageTermReview, MileageTermSettings } from '@/types/mileageTerm';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change =
  | { kind: 'save'; settings: MileageTermSettings }
  | { kind: 'clear'; planID: number }
  | { kind: 'dismiss'; planID: number; through: string };

const reviewKey = (scope: Scope, vehicle: number) => ['private-mileage-term-review', scope, vehicle] as const;

export function useMileageTermReview(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: reviewKey(scope, vehicle),
    queryFn: ({ signal }) => request<MileageTermReview>(`/analytics/mileage-budget/review?vehicle_id=${vehicle}`, {
      signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
    }),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useMileageTermReviewChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change): Promise<void> => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      if (change.kind === 'clear') {
        return request<void>(`/analytics/mileage-budget/review?vehicle_id=${vehicle}&plan_id=${change.planID}`, { ...options, method: 'DELETE' });
      }
      if (change.kind === 'dismiss') {
        return request<void>(`/analytics/mileage-budget/review?vehicle_id=${vehicle}`, {
          ...options, method: 'PATCH', body: JSON.stringify({ plan_id: change.planID, through: change.through }),
        });
      }
      const { id, time_zone, first_day, end_day, opening_odometer_m, allowance_m, minimum_overage_m, paused } = change.settings;
      return request<void>(`/analytics/mileage-budget/review?vehicle_id=${vehicle}`, {
        ...options, method: 'PUT', body: JSON.stringify({
          expected_plan_id: id, time_zone, first_day, end_day, opening_odometer_m, allowance_m, minimum_overage_m,
          paused, terms_confirmed: !paused,
        }),
      });
    },
    networkMode: 'always',
    gcTime: 0,
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => { await client.invalidateQueries({ queryKey: reviewKey(scope, vehicle) }); },
  });
}
