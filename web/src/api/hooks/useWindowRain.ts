import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WindowRainSetup, WindowRainStatus } from '@/types/windowRain';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change = { id: number; method: 'PUT'; setup: WindowRainSetup } | { id: number; method: 'PATCH' | 'DELETE' };

const key = (scope: Scope, vehicle: number) => ['window-rain', scope, vehicle] as const;

export function useWindowRain(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: key(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: WindowRainStatus }>(`/security/window-rain?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: ({ state }) => {
      const plan = state.data?.plan;
      return state.data?.available && plan?.device_ready && !plan.paused && plan.reason !== 'park_changed' &&
        Date.parse(plan.watch_until) > Date.now() ? 30_000 : false;
    },
  });
}

export function useWindowRainChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope), method: change.method } as const;
      return change.method === 'PUT'
        ? request<void>(`/security/window-rain?vehicle_id=${vehicle}`, {
          ...options, body: JSON.stringify({ ...change.setup, expected_plan_id: change.id }),
        })
        : request<void>(`/security/window-rain?vehicle_id=${vehicle}&plan_id=${change.id}`, options);
    },
    networkMode: 'always',
    gcTime: 0,
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => { await client.invalidateQueries({ queryKey: key(scope, vehicle) }); },
  });
}
