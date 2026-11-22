import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TripReviewSetup, TripReviewState } from '@/types/smartTripReview'
import { isApiError, request } from '../client'
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity'

const reviewKey = (scope: PersonalScope, planId: number, vehicleId: number) =>
  ['smart-charging', 'trip-review', scope, vehicleId, planId] as const

export function useTripPlanReview(scope: PersonalScope, planId: number, vehicleId: number, version: number | undefined, open: boolean) {
  return useQuery({
    queryKey: [...reviewKey(scope, planId, vehicleId), version],
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: TripReviewState }>(`/smart-charging/plans/${planId}/review?vehicle_id=${vehicleId}`, {
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

type TripReviewChange =
  | { kind: 'save'; setup: TripReviewSetup }
  | { kind: 'adjustment'; key: string }
  | { kind: 'remove' }

export function useTripPlanReviewChange(scope: PersonalScope, planId: number, vehicleId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (change: TripReviewChange) => request<void>(`/smart-charging/plans/${planId}/review?vehicle_id=${vehicleId}`, {
      method: change.kind === 'save' ? 'PUT' : change.kind === 'adjustment' ? 'POST' : 'DELETE',
      body: change.kind === 'save' ? JSON.stringify({ ...change.setup, local_review_confirmed: true })
        : change.kind === 'adjustment' ? JSON.stringify({ adjustment_key: change.key }) : undefined,
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
    onSettled: async () => { await queryClient.invalidateQueries({ queryKey: reviewKey(scope, planId, vehicleId) }) },
  })
}
