import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CabinPrepPlan, CabinPrepSetup } from '@/types/cabinPrep';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change = { id: number; setup?: CabinPrepSetup };

const key = (scope: Scope, vehicle: number) => ['cabin-prep', scope, vehicle] as const;

export function useCabinPrep(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: key(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: CabinPrepPlan }>(`/climate/cabin-prep?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: ({ state }) => state.data?.id && state.data.push_device_ready &&
      (!state.data.reason || state.data.expires_at) ? 30_000 : false,
  });
}

export function useCabinPrepChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, setup }: Change) => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      return setup
        ? request<void>(`/climate/cabin-prep?vehicle_id=${vehicle}`, {
          ...options, method: 'PUT',
          body: JSON.stringify({ ...setup, expected_plan_id: id, departure_confirmed: true }),
        })
        : request<void>(`/climate/cabin-prep?vehicle_id=${vehicle}&plan_id=${id}`, { ...options, method: 'DELETE' });
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
