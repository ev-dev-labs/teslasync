import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ParkReserveSetup, ParkReserveStatus } from '@/types/parkReserve';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change = { id: number; setup?: ParkReserveSetup };

const key = (scope: Scope, vehicle: number) => ['park-reserve', scope, vehicle] as const;

export function useParkReserve(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: key(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: ParkReserveStatus }>(`/charging/park-reserve?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: ({ state }) => {
      const plan = state.data?.plan;
      return plan && !plan.reason && Date.parse(plan.action_until) > Date.now() ? 30_000 : false;
    },
  });
}

export function useParkReserveChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, setup }: Change) => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      return setup
        ? request<void>(`/charging/park-reserve?vehicle_id=${vehicle}`, {
          ...options, method: 'PUT',
          body: JSON.stringify({ ...setup, expected_plan_id: id, park_confirmed: true }),
        })
        : request<void>(`/charging/park-reserve?vehicle_id=${vehicle}&plan_id=${id}`, { ...options, method: 'DELETE' });
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
