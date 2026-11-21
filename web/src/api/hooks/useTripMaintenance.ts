import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TripMaintenanceSettings, TripMaintenanceSetup } from '@/types/smartTripMaintenance'
import { isApiError, request } from '../client'
import { actionCenterKeys } from './useActionCenter'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'

const maintenanceKey = (scope: PersonalScope, plan: number, vehicle: number) =>
  ['smart-charging', 'trip-maintenance', scope, vehicle, plan] as const

export function useTripMaintenance(scope: PersonalScope, plan: number, vehicle: number, version: number | undefined, open: boolean) {
  return useQuery({
    queryKey: [...maintenanceKey(scope, plan, vehicle), version],
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: TripMaintenanceSettings }>(`/smart-charging/plans/${plan}/maintenance?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      })
      return data
    },
    enabled: open && scope.mode === 'forward_auth',
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

export function useTripMaintenanceChange(scope: PersonalScope, plan: number, vehicle: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (setup: TripMaintenanceSetup | null) => request<void>(`/smart-charging/plans/${plan}/maintenance?vehicle_id=${vehicle}`, {
      method: setup ? 'PUT' : 'DELETE',
      body: setup ? JSON.stringify({ ...setup, local_analysis_confirmed: true }) : undefined,
      requiresLiveMode: true,
      cache: 'no-store',
      headers: expectedPrincipalHeader(scope),
    }),
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: personalIdentityKey })
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: maintenanceKey(scope, plan, vehicle) }),
        queryClient.invalidateQueries({ queryKey: actionCenterKeys.all }),
      ])
    },
  })
}
