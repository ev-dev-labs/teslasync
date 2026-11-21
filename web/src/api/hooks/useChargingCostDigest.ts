import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChargingCostDigestSettings, ChargingCostReview } from '@/types/chargingCostDigest';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;

type Change =
  | { kind: 'save'; settings: ChargingCostDigestSettings }
  | { kind: 'clear'; planID: number }
  | { kind: 'dismiss'; planID: number; through: string };

const queryKey = (scope: Scope, vehicle: number) => ['private-charging-cost-digest', scope, vehicle] as const;

export function useChargingCostDigest(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: queryKey(scope, vehicle),
    queryFn: ({ signal }) => request<ChargingCostReview>(`/analytics/tco/charging-cost-digest?vehicle_id=${vehicle}`, {
      signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
    }),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useChargingCostDigestChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change): Promise<void> => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      if (change.kind === 'clear') {
        return request<void>(`/analytics/tco/charging-cost-digest?vehicle_id=${vehicle}&plan_id=${change.planID}`, { ...options, method: 'DELETE' });
      }
      if (change.kind === 'dismiss') {
        return request<void>(`/analytics/tco/charging-cost-digest?vehicle_id=${vehicle}`, {
          ...options, method: 'PATCH', body: JSON.stringify({ plan_id: change.planID, through: change.through }),
        });
      }
      const { id, time_zone, currency, material_change_minor, paused } = change.settings;
      return request<void>(`/analytics/tco/charging-cost-digest?vehicle_id=${vehicle}`, {
        ...options, method: 'PUT', body: JSON.stringify({
          expected_plan_id: id, time_zone, currency, material_change_minor, paused, local_review_confirmed: !paused,
        }),
      });
    },
    retry: false,
    networkMode: 'always',
    gcTime: 0,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => { await client.invalidateQueries({ queryKey: queryKey(scope, vehicle) }); },
  });
}
