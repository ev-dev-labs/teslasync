import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiError, request } from '../client'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'

interface BackupWatch {
  id: number
  vehicle_id: number
  place_id: number
  device_id: number
  outage_confirmed_at: string
  watch_until: string
}

interface BackupChargingSettings {
  available: boolean
  connected: boolean
  connection_revision?: number
  active: boolean
  watch: BackupWatch | null
  decision: {
    watch: BackupWatch
    evidence: {
      observed_at: string
      expires_at: string
      vehicle_power_w: number
      minimum_battery_to_load_w: number
    }
  } | null
}

type BackupChange =
  | { kind: 'start'; connectionRevision: number; placeId: number; placeUpdatedAt: string; deviceId: number; deviceUpdatedAt: string }
  | { kind: 'stop'; watchId: number }

export const smartBackupKeys = {
  all: (scope: PersonalScope) => ['smart-charging', 'backup-charging', scope] as const,
  vehicle: (scope: PersonalScope, vehicleId: number) => [...smartBackupKeys.all(scope), vehicleId] as const,
}

export function useSmartBackupCharging(scope: PersonalScope, vehicleId: number) {
  return useQuery({
    queryKey: smartBackupKeys.vehicle(scope, vehicleId),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: BackupChargingSettings }>(`/smart-charging/backup-charging?vehicle_id=${vehicleId}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      })
      return data
    },
    enabled: scope.mode !== 'open',
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: ({ state }) => state.data?.active ? 15_000 : false,
  })
}

export function useSmartBackupChargingChange(scope: PersonalScope, vehicleId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (change: BackupChange) => {
      const options = { requiresLiveMode: true, cache: 'no-store' as const, headers: expectedPrincipalHeader(scope) }
      if (change.kind === 'stop') {
        return request<void>(`/smart-charging/backup-charging?vehicle_id=${vehicleId}&watch_id=${change.watchId}`, { ...options, method: 'DELETE' })
      }
      return request<void>('/smart-charging/backup-charging', {
        ...options,
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: vehicleId, connection_revision: change.connectionRevision,
          place_id: change.placeId, place_updated_at: change.placeUpdatedAt,
          device_id: change.deviceId, device_updated_at: change.deviceUpdatedAt,
          same_backup_circuit_confirmed: true, utility_outage_confirmed: true,
        }),
      })
    },
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: personalIdentityKey })
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: smartBackupKeys.vehicle(scope, vehicleId) })
    },
  })
}
