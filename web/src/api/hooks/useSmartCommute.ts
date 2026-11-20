import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiError, request } from '../client'
import { actionCenterKeys } from './useActionCenter'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'
import type {
  SmartCommuteRoutineInput,
  SmartCommuteSettings,
  SmartCommuteSnapshot,
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
  })
}

export type SmartCommuteChange =
  | { kind: 'settings'; settings: SmartCommuteSettings }
  | { kind: 'analyze' }
  | { kind: 'create'; routine: SmartCommuteRoutineInput }
  | { kind: 'confirm'; id: number; routine: SmartCommuteRoutineInput }
  | { kind: 'decline'; id: number }
  | { kind: 'snooze'; id: number; durationS: number }
  | { kind: 'deleteRoutine'; id: number }
  | { kind: 'deleteAll' }

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
            ...options, method: 'POST', body: JSON.stringify({ vehicle_id: vehicleId }),
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
