import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiError, request } from '../client'
import { actionCenterKeys } from './useActionCenter'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'
import type {
  SmartCommuteNavigationOutcome,
  SmartCommuteRoutineInput,
  SmartCommuteSettings,
  SmartCommuteSnapshot,
  SmartCommuteTrafficInput,
  SmartCommuteTrafficPreview,
} from '@/types/smartCommute'

export const smartCommuteKeys = {
  all: ['smart-commute'] as const,
  snapshot: (scope: PersonalScope | null, vehicleId: number | null) =>
    ['smart-commute', 'snapshot', scope, vehicleId] as const,
}

export function useSmartCommute(
  scope: PersonalScope | null,
  vehicleId: number | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: smartCommuteKeys.snapshot(scope, vehicleId),
    queryFn: ({ signal }) =>
      request<{ data: SmartCommuteSnapshot }>(
        `/smart-commute?vehicle_id=${vehicleId}`,
        { signal, cache: 'no-store', headers: expectedPrincipalHeader(scope!) },
      ),
    select: (response) => response.data,
    enabled: enabled && scope != null && vehicleId != null,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) => query.state.data?.data.traffic_decisions?.length ? 15_000 : false,
  })
}

export function useSmartCommuteNavigation(scope: PersonalScope, vehicleId: number, routineId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { occurrence_id: string; address: string; wake_confirmed: boolean }) => {
      if (scope.mode !== 'forward_auth') throw new Error('Smart Commute navigation requires a verified operator')
      const { data } = await request<{ data: { outcome: SmartCommuteNavigationOutcome } }>(
        `/smart-commute/routines/${routineId}/navigation`, {
          method: 'POST', requiresLiveMode: true, cache: 'no-store', signal: AbortSignal.timeout(55_000),
          headers: expectedPrincipalHeader(scope),
          body: JSON.stringify({ ...input, vehicle_id: vehicleId, confirmed: true }),
        },
      )
      return data.outcome
    },
    gcTime: 0,
    networkMode: 'always',
    retry: false,
    onSuccess: (outcome) => {
      if (outcome !== 'wake_required' && outcome !== 'wake_permission_required') {
        void queryClient.invalidateQueries({ queryKey: smartCommuteKeys.snapshot(scope, vehicleId) })
      }
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: personalIdentityKey })
      }
    },
  })
}

export function useSmartCommuteTrafficPreview(scope: PersonalScope, vehicleId: number, routineId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (driveId: number) => request<{ data: SmartCommuteTrafficPreview }>(
      `/smart-commute/routines/${routineId}/traffic-preview`, {
        method: 'POST', requiresLiveMode: true, cache: 'no-store', headers: expectedPrincipalHeader(scope),
        body: JSON.stringify({ vehicle_id: vehicleId, drive_id: driveId }),
      },
    ),
    gcTime: 0,
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: personalIdentityKey })
      }
    },
  })
}

export type SmartCommuteChange =
  | { kind: 'settings'; settings: SmartCommuteSettings }
  | { kind: 'analyze'; timeZone: string }
  | { kind: 'create'; routine: SmartCommuteRoutineInput }
  | { kind: 'confirm'; id: number; routine: SmartCommuteRoutineInput }
  | { kind: 'decline'; id: number }
  | { kind: 'snooze'; id: number; durationS: number }
  | { kind: 'deleteRoutine'; id: number }
  | { kind: 'deleteAll' }
  | { kind: 'trafficConsent'; id: number; traffic: SmartCommuteTrafficInput }
  | { kind: 'trafficDisconnect'; id: number }
  | { kind: 'trafficSkip'; id: number }

export function useSmartCommuteChange(scope: PersonalScope | null, vehicleId: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (change: SmartCommuteChange) => {
      if (scope == null || vehicleId == null) throw new Error('Missing Smart Commute scope')
      const options = {
        requiresLiveMode: true,
        cache: 'no-store' as const,
        headers: expectedPrincipalHeader(scope),
      }
      switch (change.kind) {
        case 'settings':
          return request<void>('/smart-commute', {
            ...options, method: 'PUT', body: JSON.stringify(change.settings),
          })
        case 'analyze':
          return request<void>('/smart-commute/analyses', {
            ...options, method: 'POST', body: JSON.stringify({ vehicle_id: vehicleId, time_zone: change.timeZone }),
          })
        case 'create':
          return request<void>('/smart-commute/routines', {
            ...options, method: 'POST', body: JSON.stringify(change.routine),
          })
        case 'confirm':
          return request<void>(`/smart-commute/routines/${change.id}`, {
            ...options, method: 'PUT', body: JSON.stringify(change.routine),
          })
        case 'decline':
          return request<void>(`/smart-commute/routines/${change.id}/decline`, {
            ...options, method: 'POST', body: JSON.stringify({ vehicle_id: vehicleId }),
          })
        case 'snooze':
          return request<void>(`/smart-commute/routines/${change.id}/snooze`, {
            ...options, method: 'POST',
            body: JSON.stringify({ vehicle_id: vehicleId, duration_s: change.durationS }),
          })
        case 'deleteRoutine':
          return request<void>(`/smart-commute/routines/${change.id}?vehicle_id=${vehicleId}`, {
            ...options, method: 'DELETE',
          })
        case 'deleteAll':
          return request<void>(`/smart-commute?vehicle_id=${vehicleId}`, {
            ...options, method: 'DELETE',
          })
        case 'trafficConsent':
          return request<void>(`/smart-commute/routines/${change.id}/traffic-consent`, {
            ...options, method: 'PUT', body: JSON.stringify({ vehicle_id: vehicleId, ...change.traffic }),
          })
        case 'trafficDisconnect':
          return request<void>(`/smart-commute/routines/${change.id}/traffic-consent?vehicle_id=${vehicleId}`, {
            ...options, method: 'DELETE',
          })
        case 'trafficSkip':
          return request<void>(`/smart-commute/routines/${change.id}/traffic-skip`, {
            ...options, method: 'POST', body: JSON.stringify({ vehicle_id: vehicleId }),
          })
      }
    },
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: personalIdentityKey })
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: smartCommuteKeys.all }),
        queryClient.invalidateQueries({ queryKey: actionCenterKeys.lists }),
      ])
    },
  })
}
