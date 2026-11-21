import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OvernightDrainSettings } from '@/types/overnightDrain';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change =
  | { kind: 'enable' | 'pause'; id: number; zone: string }
  | { kind: 'dismiss'; id: number; morning: string }
  | { kind: 'clear'; id: number };
const key = (scope: Scope, vehicle: number) => ['private-overnight-drain', scope, vehicle] as const;

export function useOvernightDrain(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: key(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: OvernightDrainSettings }>(`/battery/overnight-drain-review?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) => {
      const plan = query.state.data?.plan;
      return plan && !plan.paused && !plan.review && !query.state.error ? 60_000 : false;
    },
  });
}

export function useOvernightDrainChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      if (change.kind === 'clear') {
        return request<void>(`/battery/overnight-drain-review?vehicle_id=${vehicle}&plan_id=${change.id}`, { ...options, method: 'DELETE' });
      }
      if (change.kind === 'dismiss') {
        return request<void>(`/battery/overnight-drain-review?vehicle_id=${vehicle}`, {
          ...options, method: 'PATCH', body: JSON.stringify({ plan_id: change.id, morning_at: change.morning }),
        });
      }
      return request<void>(`/battery/overnight-drain-review?vehicle_id=${vehicle}`, {
        ...options, method: 'PUT', body: JSON.stringify({
          expected_plan_id: change.id,
          time_zone: change.zone,
          paused: change.kind === 'pause',
          local_review_confirmed: change.kind === 'enable',
        }),
      });
    },
    networkMode: 'always',
    retry: false,
    gcTime: 0,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: key(scope, vehicle) });
    },
  });
}
