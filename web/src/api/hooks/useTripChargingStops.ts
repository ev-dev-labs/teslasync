import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TripStopResult, TripStopSettings, TripStopSetup } from '@/types/smartTripStops'
import { isApiError, request } from '../client'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'

const keyFor = (scope: PersonalScope, vehicleId: number, planId: number) =>
  ['smart-charging', 'trip-stops', scope, vehicleId, planId] as const

export function useTripChargingStops(scope: PersonalScope, vehicleId: number, planId: number, version: number | undefined, open: boolean) {
  return useQuery({
    queryKey: [...keyFor(scope, vehicleId, planId), version],
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: TripStopSettings }>(
        `/smart-charging/plans/${planId}/stops?vehicle_id=${vehicleId}`,
        { signal, cache: 'no-store', headers: expectedPrincipalHeader(scope) },
      )
      return data
    },
    enabled: open && scope.mode === 'forward_auth',
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

type TripStopChange =
  | { kind: 'save'; setup: TripStopSetup }
  | { kind: 'compare' }
  | { kind: 'revoke' }

export function useTripStopChange(scope: PersonalScope, vehicleId: number, planId: number) {
  const queryClient = useQueryClient()
  const queryKey = keyFor(scope, vehicleId, planId)
  return useMutation({
    mutationFn: (change: TripStopChange) => request<{ data: TripStopResult | null } | undefined>(
      `/smart-charging/plans/${planId}/stops?vehicle_id=${vehicleId}`,
      {
        method: change.kind === 'save' ? 'PUT' : change.kind === 'compare' ? 'POST' : 'DELETE',
        body: change.kind === 'save'
          ? JSON.stringify({ ...change.setup, provider_consent: true, compatible_stops_confirmed: true })
          : undefined,
        cache: 'no-store',
        requiresLiveMode: true,
        headers: expectedPrincipalHeader(scope),
      },
    ),
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: personalIdentityKey })
      }
    },
    onSettled: async () => { await queryClient.invalidateQueries({ queryKey }) },
  })
}
