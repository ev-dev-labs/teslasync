import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColdTireReading, ColdTireReview } from '@/types/coldTireReview';
import { isApiError, request } from '../client';
import { actionCenterKeys } from './useActionCenter';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Change = { kind: 'append'; seriesId: number; reading: ColdTireReading } | { kind: 'remove'; seriesId: number };
const reviewKey = (scope: PersonalScope, vehicle: number) => ['cold-tire-review', scope, vehicle] as const;

export function useColdTireReview(scope: PersonalScope, vehicle: number) {
  return useQuery({
    queryKey: reviewKey(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: ColdTireReview }>(`/tire-pressure/cold-checks?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useColdTireChange(scope: PersonalScope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => request<void>(
      `/tire-pressure/cold-checks?vehicle_id=${vehicle}${change.kind === 'remove' ? `&series_id=${change.seriesId}` : ''}`,
      {
        method: change.kind === 'remove' ? 'DELETE' : 'POST',
        body: change.kind === 'append' ? JSON.stringify({ ...change.reading, expected_series_id: change.seriesId }) : undefined,
        cache: 'no-store',
        requiresLiveMode: true,
        headers: expectedPrincipalHeader(scope),
      },
    ),
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: reviewKey(scope, vehicle) }),
        client.invalidateQueries({ queryKey: actionCenterKeys.all }),
      ]);
    },
  });
}
