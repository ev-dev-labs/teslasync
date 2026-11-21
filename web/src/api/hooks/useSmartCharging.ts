import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiError, request } from '../client'
import { actionCenterKeys } from './useActionCenter'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'
import type {
  SmartChargingLatestStart,
  SmartChargingPlan,
  SmartChargingPlanInput,
  SmartChargingSitePerformanceSettings,
  SmartPublicFeeDecision,
  SmartPublicFeeTerms,
  SmartPublicFeeTermsInput,
} from '@/types/smartCharging'

export const smartChargingKeys = {
  all: ['smart-charging'] as const,
  plans: (scope: PersonalScope | null, vehicleId: number | null) =>
    ['smart-charging', 'plans', scope, vehicleId] as const,
  latestStarts: (scope: PersonalScope | null, vehicleId: number | null) =>
    ['smart-charging', 'latest-starts', scope, vehicleId] as const,
  sitePerformance: (scope: PersonalScope | null, vehicleId: number | null) =>
    ['smart-charging', 'site-performance', scope, vehicleId] as const,
  publicFeeTerms: (scope: PersonalScope, vehicleId: number) =>
    ['smart-charging', 'public-fee-terms', scope, vehicleId] as const,
  publicFeeDecision: (scope: PersonalScope, vehicleId: number, sessionId: string | null) =>
    ['smart-charging', 'public-fee', scope, vehicleId, sessionId] as const,
}

export function useSmartCharging(scope: PersonalScope | null, vehicleId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: smartChargingKeys.plans(scope, vehicleId),
    queryFn: ({ signal }) =>
      request<{ data: SmartChargingPlan[] }>(
        `/smart-charging/plans?vehicle_id=${vehicleId}&limit=100&offset=0`,
        { signal, cache: 'no-store', headers: expectedPrincipalHeader(scope!) },
      ),
    select: (response) => response.data ?? [],
    enabled: enabled && scope != null && vehicleId != null,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

export function useSmartChargingLatestStarts(
  scope: PersonalScope | null,
  vehicleId: number | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: smartChargingKeys.latestStarts(scope, vehicleId),
    queryFn: async ({ signal }) => {
      const response = await request<{ data: SmartChargingLatestStart[] }>(
        `/smart-charging/latest-start?vehicle_id=${vehicleId}`,
        { signal, cache: 'no-store', headers: expectedPrincipalHeader(scope!) },
      )
      return response.data ?? []
    },
    enabled: enabled && scope != null && vehicleId != null,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

export type SmartChargingChange =
  | { kind: 'create'; plan: SmartChargingPlanInput }
  | { kind: 'update'; id: number; plan: SmartChargingPlanInput; version: number; previous: string }
  | { kind: 'earlierCheck'; id: number; version: number; previous: string; checkAt: string; expiresAt: string }
  | { kind: 'snooze'; id: number; durationS: number }
  | { kind: 'delete'; id: number }
  | { kind: 'sitePerformance'; placeId: number | null }
  | { kind: 'publicFeeTerms'; terms: SmartPublicFeeTermsInput | null }

export function usePublicFeeTerms(scope: PersonalScope, vehicleId: number) {
  return useQuery({
    queryKey: smartChargingKeys.publicFeeTerms(scope, vehicleId),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: { terms: SmartPublicFeeTerms | null; needs_review: boolean } }>(
        `/smart-charging/public-fee-terms?vehicle_id=${vehicleId}`,
        { signal, cache: 'no-store', headers: expectedPrincipalHeader(scope) },
      )
      return data
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

export function usePublicFeeDecision(scope: PersonalScope, vehicleId: number, sessionId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: smartChargingKeys.publicFeeDecision(scope, vehicleId, sessionId),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: { decision: SmartPublicFeeDecision | null } }>(
        `/smart-charging/public-fee?vehicle_id=${vehicleId}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''}`,
        { signal, cache: 'no-store', headers: expectedPrincipalHeader(scope) },
      )
      return data
    },
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: 15_000,
  })
}

export function useSitePerformance(scope: PersonalScope, vehicleId: number) {
  return useQuery({
    queryKey: smartChargingKeys.sitePerformance(scope, vehicleId),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: SmartChargingSitePerformanceSettings }>(
        `/smart-charging/site-performance?vehicle_id=${vehicleId}`,
        { signal, cache: 'no-store', headers: expectedPrincipalHeader(scope) },
      )
      return data
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

export function useSmartChargingChange(scope: PersonalScope | null, vehicleId: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (change: SmartChargingChange) => {
      if (scope == null || vehicleId == null) throw new Error('Missing charging readiness scope')
      const options = {
        requiresLiveMode: true,
        cache: 'no-store' as const,
        headers: expectedPrincipalHeader(scope),
      }
      switch (change.kind) {
        case 'create':
          return request<void>('/smart-charging/plans', {
            ...options, method: 'POST', body: JSON.stringify(change.plan),
          })
        case 'update':
          return request<void>(`/smart-charging/plans/${change.id}`, {
            ...options, method: 'PUT', body: JSON.stringify({
              ...change.plan, expected_version: change.version, expected_check_at: change.previous,
            }),
          })
        case 'earlierCheck':
          return request<void>(`/smart-charging/plans/${change.id}`, {
            ...options, method: 'PATCH', body: JSON.stringify({
              vehicle_id: vehicleId, expected_version: change.version, expected_check_at: change.previous,
              check_at: change.checkAt, preview_expires_at: change.expiresAt,
            }),
          })
        case 'snooze':
          return request<void>(`/smart-charging/plans/${change.id}/snooze`, {
            ...options, method: 'POST',
            body: JSON.stringify({ vehicle_id: vehicleId, duration_s: change.durationS }),
          })
        case 'delete':
          return request<void>(`/smart-charging/plans/${change.id}?vehicle_id=${vehicleId}`, {
            ...options, method: 'DELETE',
          })
        case 'sitePerformance':
          return request<void>('/smart-charging/site-performance', {
            ...options, method: 'PUT',
            body: JSON.stringify({ vehicle_id: vehicleId, charging_place_id: change.placeId, enabled: change.placeId != null }),
          })
        case 'publicFeeTerms':
          return change.terms == null
            ? request<void>(`/smart-charging/public-fee-terms?vehicle_id=${vehicleId}`, { ...options, method: 'DELETE' })
            : request<void>('/smart-charging/public-fee-terms', {
              ...options, method: 'PUT', body: JSON.stringify({ ...change.terms, vehicle_id: vehicleId }),
            })
      }
    },
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: personalIdentityKey })
      }
      if (isApiError(error) && error.code === 'PLAN_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: smartChargingKeys.all })
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: smartChargingKeys.all }),
        queryClient.invalidateQueries({ queryKey: actionCenterKeys.lists }),
      ])
    },
  })
}
