import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, request } from '@/api/client';
import type { WeeklyDriveEfficiencyState } from '@/types/weeklyDriveEfficiency';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change =
  | { kind: 'save'; revision: number; zone: string }
  | { kind: 'dismiss'; revision: number; until: string }
  | { kind: 'pause' | 'clear'; revision: number };

const reviewKey = (scope: Scope, vehicle: number) => ['private-weekly-drive-efficiency', scope, vehicle] as const;

export function useWeeklyDriveEfficiency(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: reviewKey(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data?: WeeklyDriveEfficiencyState }>(`/analytics/route-efficiency/weekly-digest?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      if (!data || !('plan' in data) || !('digest' in data) || typeof data.dismissed !== 'boolean') {
        throw new Error('Invalid weekly drive efficiency response');
      }
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: 15_000,
  });
}

export function useWeeklyDriveEfficiencyChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      if (change.kind === 'clear') {
        return request<void>(`/analytics/route-efficiency/weekly-digest?vehicle_id=${vehicle}&expected_revision=${change.revision}`,
          { ...options, method: 'DELETE' });
      }
      const revision = { expected_revision: change.revision };
      const body = change.kind === 'save' ? { ...revision, confirmed: true, time_zone: change.zone }
        : change.kind === 'pause' ? { ...revision, paused: true }
          : change.kind === 'dismiss' ? { ...revision, recent_until: change.until } : revision;
      return request<void>(`/analytics/route-efficiency/weekly-digest?vehicle_id=${vehicle}`, {
        ...options, method: change.kind === 'dismiss' ? 'PATCH' : 'PUT', body: JSON.stringify(body),
      });
    },
    networkMode: 'always',
    gcTime: 0,
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: reviewKey(scope, vehicle) });
    },
  });
}
