import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiError, request } from '@/api/client'
import { actionCenterKeys } from './useActionCenter'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'

export interface SmartFeaturePreference {
  feature: string
  allowed: boolean
}

const preferencesKey = (scope: PersonalScope | null) => ['smart-feature-preferences', scope] as const

export function useSmartFeatures(scope: PersonalScope | null, refetchInterval?: number) {
  return useQuery({
    queryKey: preferencesKey(scope),
    enabled: scope !== null,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval,
    queryFn: ({ signal }) => {
      if (!scope) throw new Error('Missing Smart Features scope')
      return request<SmartFeaturePreference[]>('/settings/smart-features', {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      })
    },
  })
}

export function useSetSmartFeature(scope: PersonalScope | null) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: preferencesKey(scope),
    networkMode: 'always',
    retry: false,
    mutationFn: (pref: SmartFeaturePreference) => {
      if (!scope) throw new Error('Missing Smart Features scope')
      return request<SmartFeaturePreference>(`/settings/smart-features/${encodeURIComponent(pref.feature)}`, {
        method: 'PUT', body: JSON.stringify({ allowed: pref.allowed }),
        requiresLiveMode: true, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      })
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: preferencesKey(scope) }),
        client.invalidateQueries({ queryKey: actionCenterKeys.lists }),
      ])
    },
    onError: error => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey })
      }
    },
  })
}
