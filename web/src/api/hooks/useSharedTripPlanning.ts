import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { isApiError, request } from '@/api/client'
import type { AuthModeResponse } from '@/api/types'
import { expectedPrincipalHeader, personalIdentityKey, personalScope, type PersonalScope } from './usePersonalIdentity'

export type SharedTripScope = Extract<PersonalScope, { mode: 'forward_auth' }>

export interface SharedTrip {
  id: number
  revision: number
  departure_at: string
}

export interface SharedTripInvitation {
  trip_id: number
  revision: number
  vehicle_id: number
  entry_version: number
  departure_at: string
  consent_expires_at: string | null
}

interface SharedTripList {
  can_manage: boolean
  owned: SharedTrip[]
  invitations: SharedTripInvitation[]
}

interface SharedTripOption {
  vehicle_id: number
  return_low_pct: number
  return_high_pct: number
  reserve_pct: number
  observed_at: string
  expires_at: string
}

export interface SharedTripComparison extends SharedTrip {
  expires_at: string
  options: SharedTripOption[]
}

export interface SharedTripDraft {
  departure_at: string
  nominations: { vehicle_id: number; subject: string }[]
}

export interface SharedTripConfirmation {
  trip_use_low_pct: number
  trip_use_high_pct: number
  reserve_pct: number
  schedule_clear: boolean
  maintenance_clear: boolean
}

export type SharedTripChange =
  | { kind: 'create'; draft: SharedTripDraft }
  | { kind: 'revise'; trip: SharedTrip; draft: SharedTripDraft }
  | { kind: 'cancel'; trip: SharedTrip }
  | { kind: 'confirm'; entry: SharedTripInvitation; confirmation: SharedTripConfirmation }
  | { kind: 'withdraw'; entry: SharedTripInvitation }

export const sharedTripPageSize = 50
export const sharedTripMaxOffset = 10_000

const keys = {
  scoped: (scope: SharedTripScope) => ['shared-trip-planning', scope.subject] as const,
  lists: (scope: SharedTripScope) => [...keys.scoped(scope), 'list'] as const,
  list: (scope: SharedTripScope, offset: number) => [...keys.lists(scope), offset] as const,
  comparison: (scope: SharedTripScope, entry: SharedTripInvitation | null) =>
    [...keys.scoped(scope), 'comparison', entry?.trip_id, entry?.revision, entry?.vehicle_id, entry?.entry_version] as const,
}

const privateQuery = {
  staleTime: 0,
  gcTime: 0,
  retry: false,
  refetchOnWindowFocus: 'always',
  placeholderData: undefined,
} as const

export function isSharedTripIdentityError(error: unknown) {
  return isApiError(error) && (
    error.status === 401 || error.status === 403 || error.code === 'IDENTITY_CHANGED'
  )
}

function refreshIdentityOnChange(client: QueryClient, error: unknown) {
  if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
    void client.invalidateQueries({ queryKey: personalIdentityKey })
  }
}

export function useSharedTripPlanning(scope: SharedTripScope, offset: number) {
  const client = useQueryClient()
  return useQuery({
    ...privateQuery,
    queryKey: keys.list(scope, offset),
    queryFn: async ({ signal }) => {
      try {
        const { data } = await request<{ data: SharedTripList }>(
          `/smart-charging/shared-trips?limit=${sharedTripPageSize}&offset=${offset}`,
          { signal, cache: 'no-store', headers: expectedPrincipalHeader(scope) },
        )
        return data
      } catch (error) {
        refreshIdentityOnChange(client, error)
        throw error
      }
    },
  })
}

export function useSharedTripComparison(scope: SharedTripScope, entry: SharedTripInvitation | null) {
  const client = useQueryClient()
  return useQuery({
    ...privateQuery,
    queryKey: keys.comparison(scope, entry),
    enabled: entry != null,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      if (entry == null) return null
      try {
        const { data } = await request<{ data: { comparison: SharedTripComparison | null } }>(
          `/smart-charging/shared-trips/${entry.trip_id}/comparison`,
          { signal, cache: 'no-store', headers: expectedPrincipalHeader(scope) },
        )
        return data.comparison
      } catch (error) {
        refreshIdentityOnChange(client, error)
        if (isApiError(error) && error.status === 404) {
          void client.invalidateQueries({ queryKey: keys.lists(scope) })
        }
        throw error
      }
    },
  })
}

export function useSharedTripChange(scope: SharedTripScope) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (change: SharedTripChange) => {
      const current = personalScope(client.getQueryData<AuthModeResponse>(personalIdentityKey))
      if (current?.mode !== 'forward_auth' || current.subject !== scope.subject) {
        throw new Error('Shared trip browser identity changed')
      }
      const options = {
        requiresLiveMode: true,
        cache: 'no-store',
        headers: expectedPrincipalHeader(scope),
      } as const
      switch (change.kind) {
        case 'create':
          await request<{ data: SharedTrip }>('/smart-charging/shared-trips', {
            ...options, method: 'POST', body: JSON.stringify(change.draft),
          })
          break
        case 'revise':
          await request<{ data: SharedTrip }>(`/smart-charging/shared-trips/${change.trip.id}`, {
            ...options, method: 'PUT', body: JSON.stringify({ ...change.draft, revision: change.trip.revision }),
          })
          break
        case 'cancel':
          await request<void>(`/smart-charging/shared-trips/${change.trip.id}?revision=${change.trip.revision}`, {
            ...options, method: 'DELETE',
          })
          break
        case 'confirm':
          await request<void>(`/smart-charging/shared-trips/${change.entry.trip_id}/vehicles/${change.entry.vehicle_id}`, {
            ...options, method: 'PUT', body: JSON.stringify({
              ...change.confirmation, revision: change.entry.revision, entry_version: change.entry.entry_version,
            }),
          })
          break
        case 'withdraw':
          await request<void>(
            `/smart-charging/shared-trips/${change.entry.trip_id}/vehicles/${change.entry.vehicle_id}?revision=${change.entry.revision}&entry_version=${change.entry.entry_version}`,
            { ...options, method: 'DELETE' },
          )
          break
      }
    },
    networkMode: 'always',
    retry: false,
    gcTime: 0,
    onError: (error) => {
      refreshIdentityOnChange(client, error)
      if (isApiError(error) && error.status === 404) {
        void client.invalidateQueries({ queryKey: keys.scoped(scope) })
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.scoped(scope) }),
  })
}
