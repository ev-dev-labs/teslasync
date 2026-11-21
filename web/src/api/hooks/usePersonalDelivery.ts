import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiError, request } from '../client'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'
import type {
  PersonalDeliveryDevice,
  PersonalDeliveryDevices,
  PersonalDeliverySubscription,
  PersonalDeliveryTexts,
} from '@/types/personalDelivery'

export const personalDeliveryKeys = {
  all: ['personal-delivery'] as const,
  devices: (scope: PersonalScope | null) => ['personal-delivery', 'devices', scope] as const,
  current: (scope: PersonalScope | null, generation: number) => ['personal-delivery', 'current', scope, generation] as const,
}

export function usePersonalDeliveryDevices(scope: PersonalScope | null, enabled: boolean) {
  return useQuery({
    queryKey: personalDeliveryKeys.devices(scope),
    queryFn: async ({ signal }) => {
      const response = await request<{ data: PersonalDeliveryDevices }>('/smart-delivery/devices', {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope!),
      })
      return { ...response.data, devices: response.data.devices ?? [] }
    },
    enabled: enabled && scope != null,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

export function useCurrentPersonalDevice(
  scope: PersonalScope | null, endpoint: string | null, generation: number, enabled: boolean,
) {
  return useQuery({
    queryKey: personalDeliveryKeys.current(scope, generation),
    queryFn: async ({ signal }) => {
      try {
        const response = await request<{ data: PersonalDeliveryDevice }>('/smart-delivery/devices/lookup', {
          method: 'POST', body: JSON.stringify({ endpoint }), signal, cache: 'no-store',
          headers: expectedPrincipalHeader(scope!),
        })
        return response.data
      } catch (error) {
        if (isApiError(error) && error.status === 404) return null
        throw error
      }
    },
    enabled: enabled && scope != null && endpoint != null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) => query.state.data?.verified === false ? 3000 : false,
  })
}

export type PersonalDeliveryChange =
  | { kind: 'enroll'; subscription: PersonalDeliverySubscription; texts: PersonalDeliveryTexts }
  | { kind: 'charging'; id: number; enabled: boolean }
  | { kind: 'commute'; id: number; enabled: boolean; copy: { title: string; body: string } }
  | { kind: 'delete'; id: number }

export function usePersonalDeliveryChange(scope: PersonalScope | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (change: PersonalDeliveryChange) => {
      if (scope == null) throw new Error('Missing personal delivery scope')
      const options = {
        requiresLiveMode: true,
        cache: 'no-store' as const,
        headers: expectedPrincipalHeader(scope),
      }
      switch (change.kind) {
        case 'enroll':
          return request<void>('/smart-delivery/devices', {
            ...options, method: 'POST',
            body: JSON.stringify({ subscription: change.subscription, texts: change.texts }),
          })
        case 'charging':
          return request<void>(`/smart-delivery/devices/${change.id}/charging`, {
            ...options, method: 'PUT', body: JSON.stringify({ enabled: change.enabled }),
          })
        case 'commute':
          return request<void>(`/smart-delivery/devices/${change.id}/commute`, {
            ...options, method: 'PUT', body: JSON.stringify({ enabled: change.enabled, copy: change.copy }),
          })
        case 'delete':
          return request<void>(`/smart-delivery/devices/${change.id}`, { ...options, method: 'DELETE' })
      }
    },
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: personalIdentityKey })
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: personalDeliveryKeys.all })
    },
  })
}
