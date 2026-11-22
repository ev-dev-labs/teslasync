import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, request } from '@/api/client';
import type { Subscription } from '@/types/ownership';
import type { RenewalState, RenewalTerms } from '@/types/subscriptionRenewal';
import { actionCenterKeys } from './useActionCenter';
import { ownershipKeys } from './useOwnership';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change =
  | { kind: 'save'; revision: string; subscriptionVersion: number; terms: RenewalTerms }
  | { kind: 'pause'; revision: string; subscriptionVersion: number }
  | { kind: 'dismiss' | 'clear'; revision: string };

const subscriptionsKey = (scope: Scope, vehicle: number) => [...ownershipKeys.subscriptions(vehicle), scope] as const;
const reviewKey = (scope: Scope, vehicle: number, subscription: number) =>
  [...ownershipKeys.all, 'private-subscription-renewal', scope, vehicle, subscription] as const;

export function useRenewalSubscriptions(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: subscriptionsKey(scope, vehicle),
    queryFn: ({ signal }) => request<{ items: Subscription[] }>(`/subscription-roi/subscriptions?vehicle_id=${vehicle}`, {
      signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
    }),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useSubscriptionRenewal(scope: Scope, vehicle: number, subscription: number) {
  return useQuery({
    queryKey: reviewKey(scope, vehicle, subscription),
    queryFn: ({ signal }) => request<RenewalState>(`/subscription-roi/renewal?vehicle_id=${vehicle}&subscription_id=${subscription}`, {
      signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
    }),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useSubscriptionRenewalChange(scope: Scope, vehicle: number, subscription: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change) => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      if (change.kind === 'clear') {
        return request<void>(`/subscription-roi/renewal?vehicle_id=${vehicle}&subscription_id=${subscription}&expected_revision=${encodeURIComponent(change.revision)}`,
          { ...options, method: 'DELETE' });
      }
      const revision = { expected_revision: change.revision };
      const body = change.kind === 'save' ? {
        ...revision, subscription_version: change.subscriptionVersion, confirmed: true, ...change.terms,
      } : change.kind === 'pause' ? {
        ...revision, subscription_version: change.subscriptionVersion, paused: true,
      } : revision;
      return request<void>(`/subscription-roi/renewal?vehicle_id=${vehicle}&subscription_id=${subscription}`, {
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
      await client.invalidateQueries({ queryKey: reviewKey(scope, vehicle, subscription) });
      await client.invalidateQueries({ queryKey: subscriptionsKey(scope, vehicle) });
      await client.invalidateQueries({ queryKey: actionCenterKeys.lists });
    },
  });
}
