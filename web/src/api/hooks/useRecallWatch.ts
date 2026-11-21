import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useOptionalToast } from '@/components/feedback/Toast';
import type { RecallWatch, RecallWatchSetup } from '@/types/recallWatch';
import { isApiError, request } from '../client';
import { actionCenterKeys } from './useActionCenter';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change = { kind: 'enable'; watchId: number; setup: RecallWatchSetup } | { kind: 'remove'; watchId: number };
const watchKey = (scope: Scope, vehicle: number) => ['recall-watch', scope, vehicle] as const;

export function useRecallWatch(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: watchKey(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: RecallWatch }>(`/service-intelligence/recall-watch?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: query => query.state.data?.id ? 60_000 : false,
  });
}

export function useRecallWatchChange(scope: Scope, vehicle: number) {
  const { t } = useTranslation();
  const toast = useOptionalToast();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => request<void>(
      `/service-intelligence/recall-watch?vehicle_id=${vehicle}${change.kind === 'remove' ? `&watch_id=${change.watchId}` : ''}`,
      {
        method: change.kind === 'remove' ? 'DELETE' : 'PUT',
        body: change.kind === 'enable' ? JSON.stringify({
          ...change.setup, expected_watch_id: change.watchId, model_confirmed: true, nhtsa_confirmed: true,
        }) : undefined,
        cache: 'no-store',
        requiresLiveMode: true,
        headers: expectedPrincipalHeader(scope),
      },
    ),
    networkMode: 'always',
    retry: false,
    onSuccess: (_, change) => {
      toast?.success(change.kind === 'enable'
        ? t('maintenance.recallWatch.enabled', 'Private recall watch saved')
        : t('maintenance.recallWatch.disabled', 'Private recall watch cleared'));
    },
    onError: (error) => {
      toast?.error(t('maintenance.recallWatch.failure', 'Could not change your recall watch. Refresh and verify your sign-in and vehicle.'));
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: watchKey(scope, vehicle) }),
        client.invalidateQueries({ queryKey: actionCenterKeys.all }),
      ]);
    },
  });
}
