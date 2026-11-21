import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SmartSolarDecision } from '@/types/smartCharging'
import { isApiError, request } from '../client'
import { actionCenterKeys } from './useActionCenter'
import { smartBackupKeys } from './useSmartBackupCharging'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'

interface SolarSettings {
  available: boolean
  energy_site_id?: string
  plan: { place_id: number; place_updated_at: string } | null
  decision: SmartSolarDecision | null
}

type SolarChange =
  | { kind: 'connect'; siteId: string }
  | { kind: 'disconnect' }
  | { kind: 'enable'; placeId: number; updatedAt: string }
  | { kind: 'disable' }

const solarKey = (scope: PersonalScope) => ['smart-charging', 'solar', scope] as const

export function useSmartSolar(scope: PersonalScope, vehicleId: number) {
  return useQuery({
    queryKey: [...solarKey(scope), vehicleId],
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: SolarSettings }>(`/smart-charging/solar?vehicle_id=${vehicleId}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      })
      return data
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) => query.state.data?.plan ? 15_000 : false,
  })
}

export function useSmartSolarChange(scope: PersonalScope, vehicleId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (change: SolarChange) => {
      const options = { requiresLiveMode: true, cache: 'no-store' as const, headers: expectedPrincipalHeader(scope) }
      switch (change.kind) {
        case 'connect': {
          const { data } = await request<{ data: { authorization_url: string } }>('/smart-charging/solar/connection', {
            ...options, method: 'POST', body: JSON.stringify({ energy_site_id: change.siteId, vehicle_id: vehicleId }),
          })
          return data.authorization_url
        }
        case 'disconnect':
          await request<void>('/smart-charging/solar/connection', { ...options, method: 'DELETE' })
          break
        case 'enable':
          await request<void>('/smart-charging/solar', {
            ...options, method: 'PUT',
            body: JSON.stringify({
              vehicle_id: vehicleId, place_id: change.placeId, place_updated_at: change.updatedAt, confirmed_home: true,
            }),
          })
          break
        case 'disable':
          await request<void>(`/smart-charging/solar?vehicle_id=${vehicleId}`, { ...options, method: 'DELETE' })
          break
      }
    },
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: personalIdentityKey })
      }
    },
    onSuccess: async (_result, change) => {
      if (change.kind !== 'connect') {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: solarKey(scope) }),
          queryClient.invalidateQueries({ queryKey: actionCenterKeys.lists }),
          queryClient.invalidateQueries({ queryKey: smartBackupKeys.all(scope) }),
        ])
      }
    },
  })
}
