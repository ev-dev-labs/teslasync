import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { isApiError, request } from '@/api/client'
import type { AuthModeResponse } from '@/api/types'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'

export type SharedChargerScope = Extract<PersonalScope, { mode: 'forward_auth' }>

export interface SharedChargerRef {
  id: number
  revision: number
}

export interface SharedChargerOwnedPlan extends SharedChargerRef {
  place_id: number
  expires_at: string
}

export interface SharedChargerInvitation extends SharedChargerOwnedPlan {
  vehicle_id: number
  place_updated_at: string
  reminder_offered: boolean
  confirmed: boolean
}

export interface SharedChargerList {
  can_manage: boolean
  owned: SharedChargerOwnedPlan[]
  invitations: SharedChargerInvitation[]
}

export interface SharedChargerSlot {
  vehicle_id: number
  starts_at: string
  ends_at: string
}

interface SharedChargerCard extends SharedChargerOwnedPlan {
  first: SharedChargerSlot
  second: SharedChargerSlot
  swap_at: string
  evaluated_at: string
}

interface SharedChargerReminder extends SharedChargerRef {
  vehicle_id: number
  swap_at: string
  expires_at: string
}

export interface SharedChargerView {
  card: SharedChargerCard | null
  reminder: SharedChargerReminder | null
}

type SharedChargerParticipantInput = { vehicle_id: number; subject: string }

export interface SharedChargerAuthorizationInput {
  place_id: number
  place_updated_at: string
  participants: [SharedChargerParticipantInput, SharedChargerParticipantInput]
  reminder_vehicle_id: number
  expires_at: string
}

export interface SharedChargerConfirmationInput {
  available_at: string
  departure_at: string
  energy_needed_wh: number
  conservative_power_w: number
  already_plugged: boolean
  accept_reminder: boolean
}

export type SharedChargerChange =
  | { kind: 'create'; input: SharedChargerAuthorizationInput }
  | { kind: 'revise'; ref: SharedChargerRef; input: SharedChargerAuthorizationInput }
  | { kind: 'revoke'; ref: SharedChargerRef }
  | { kind: 'confirm'; ref: SharedChargerRef; vehicleId: number; input: SharedChargerConfirmationInput }
  | { kind: 'withdraw'; ref: SharedChargerRef; vehicleId: number }

export const sharedChargerPageLimit = 32

const scopeKey = (scope: SharedChargerScope | null) => ['shared-charger-planning', scope?.subject ?? null] as const
const privateQuery = { gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: 'always' } as const

function isCurrentPrincipal(client: QueryClient, scope: SharedChargerScope): boolean {
  const identity = client.getQueryState<AuthModeResponse>(personalIdentityKey)
  return identity?.status === 'success' && identity.fetchStatus === 'idle' &&
    identity.data?.mode === 'forward_auth' && identity.data.subject === scope.subject
}

function refreshIdentity(client: QueryClient, error: unknown) {
  if (isApiError(error) && (error.status === 401 || error.code === 'IDENTITY_CHANGED')) {
    void client.invalidateQueries({ queryKey: personalIdentityKey })
  }
}

export function useSharedChargerPlanning(scope: SharedChargerScope, offset: number) {
  const client = useQueryClient()
  return useQuery({
    ...privateQuery,
    queryKey: [...scopeKey(scope), 'list', offset],
    queryFn: async ({ signal }) => {
      try {
        const { data } = await request<{ data: SharedChargerList }>(`/smart-charging/shared-chargers?limit=${sharedChargerPageLimit}&offset=${offset}`, {
          signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
        })
        return data
      } catch (error) {
        refreshIdentity(client, error)
        throw error
      }
    },
  })
}

export function useSharedChargerCard(scope: SharedChargerScope, ref: SharedChargerRef) {
  const client = useQueryClient()
  return useQuery({
    ...privateQuery,
    queryKey: [...scopeKey(scope), 'card', ref.id, ref.revision],
    queryFn: async ({ signal }) => {
      try {
        const { data } = await request<{ data: SharedChargerView }>(`/smart-charging/shared-chargers/${ref.id}/card?revision=${ref.revision}`, {
          signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
        })
        return data
      } catch (error) {
        refreshIdentity(client, error)
        throw error
      }
    },
    refetchInterval: (query) => query.state.status === 'error' ? false : 30_000,
  })
}

export function useSharedChargerChange(scope: SharedChargerScope) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (change: SharedChargerChange) => {
      if (!isCurrentPrincipal(client, scope)) throw new Error('Verified browser principal changed')
      const options = { requiresLiveMode: true, cache: 'no-store', headers: expectedPrincipalHeader(scope) } as const
      switch (change.kind) {
        case 'create':
          return request<{ data: SharedChargerRef }>('/smart-charging/shared-chargers', {
            ...options, method: 'POST', body: JSON.stringify(change.input),
          })
        case 'revise':
          return request<{ data: SharedChargerRef }>(`/smart-charging/shared-chargers/${change.ref.id}?revision=${change.ref.revision}`, {
            ...options, method: 'PUT', body: JSON.stringify(change.input),
          })
        case 'revoke':
          return request<void>(`/smart-charging/shared-chargers/${change.ref.id}?revision=${change.ref.revision}`, {
            ...options, method: 'DELETE',
          })
        case 'confirm':
          return request<void>(`/smart-charging/shared-chargers/${change.ref.id}/vehicles/${change.vehicleId}?revision=${change.ref.revision}`, {
            ...options, method: 'PUT', body: JSON.stringify(change.input),
          })
        case 'withdraw':
          return request<void>(`/smart-charging/shared-chargers/${change.ref.id}/vehicles/${change.vehicleId}?revision=${change.ref.revision}`, {
            ...options, method: 'DELETE',
          })
      }
    },
    gcTime: 0,
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      refreshIdentity(client, error)
      if (isApiError(error) && [403, 404, 409].includes(error.status)) {
        void client.invalidateQueries({ queryKey: scopeKey(scope) })
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: scopeKey(scope) })
    },
  })
}
