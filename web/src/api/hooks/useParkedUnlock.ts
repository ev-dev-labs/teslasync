import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ParkedUnlockSetup, ParkedUnlockStatus } from '@/types/parkedUnlock';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change = { id: number; method: 'PUT'; setup: ParkedUnlockSetup }
  | { id: number; method: 'PATCH'; action: 'snooze' | 'pause' }
  | { id: number; method: 'DELETE' };

const key = (scope: Scope, vehicle: number) => ['parked-unlock', scope, vehicle] as const;

export function useParkedUnlock(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: key(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: ParkedUnlockStatus }>(`/security/parked-unlock?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: ({ state }) => {
      const plan = state.data?.plan;
      return state.data?.available && plan?.place_ready && plan.device_ready && !plan.paused ? 30_000 : false;
    },
  });
}

export function useParkedUnlockChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope), method: change.method } as const;
      return change.method === 'PUT'
        ? request<void>(`/security/parked-unlock?vehicle_id=${vehicle}`, {
          ...options, body: JSON.stringify({ ...change.setup, expected_plan_id: change.id }),
        })
        : request<void>(`/security/parked-unlock?vehicle_id=${vehicle}&plan_id=${change.id}`, {
          ...options, ...(change.method === 'PATCH' ? { body: JSON.stringify({ action: change.action }) } : {}),
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
    onSettled: async () => { await client.invalidateQueries({ queryKey: key(scope, vehicle) }); },
  });
}
