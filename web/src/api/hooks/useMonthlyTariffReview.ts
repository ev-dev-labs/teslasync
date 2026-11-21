import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MonthlyTariffReview, MonthlyTariffSettings } from '@/types/monthlyTariff';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change =
  | { kind: 'save'; settings: MonthlyTariffSettings }
  | { kind: 'clear'; planID: number }
  | { kind: 'dismiss'; planID: number; through: string };

const reviewKey = (scope: Scope, vehicle: number) => ['private-monthly-tariff-review', scope, vehicle] as const;

export function useMonthlyTariffReview(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: reviewKey(scope, vehicle),
    queryFn: ({ signal }) => request<MonthlyTariffReview>(`/tariff-lab/monthly-review?vehicle_id=${vehicle}`, {
      signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
    }),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useMonthlyTariffReviewChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change): Promise<void> => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      if (change.kind === 'clear') {
        return request<void>(`/tariff-lab/monthly-review?vehicle_id=${vehicle}&plan_id=${change.planID}`, { ...options, method: 'DELETE' });
      }
      if (change.kind === 'dismiss') {
        return request<void>(`/tariff-lab/monthly-review?vehicle_id=${vehicle}`, {
          ...options, method: 'PATCH', body: JSON.stringify({ plan_id: change.planID, through: change.through }),
        });
      }
      const { id, site_id, site_revision, current_tariff_id, current_version, alternative_tariff_id, alternative_version,
        time_zone, minimum_savings_minor, switch_fee_minor, paused } = change.settings;
      return request<void>(`/tariff-lab/monthly-review?vehicle_id=${vehicle}`, {
        ...options, method: 'PUT', body: JSON.stringify({
          expected_plan_id: id, site_id, site_revision, current_tariff_id, current_version, alternative_tariff_id,
          alternative_version, time_zone, minimum_savings_minor, switch_fee_minor, paused, same_site_terms_confirmed: !paused,
        }),
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
    onSettled: async () => { await client.invalidateQueries({ queryKey: reviewKey(scope, vehicle) }); },
  });
}
