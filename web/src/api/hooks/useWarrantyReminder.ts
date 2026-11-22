import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WarrantyReminderSettings } from '@/types/warrantyReminders';
import { isApiError, request } from '../client';
import { actionCenterKeys } from './useActionCenter';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type WarrantyScope = Extract<PersonalScope, { mode: 'forward_auth' }>;

const reminderKey = (scope: WarrantyScope, vehicleId: number, warrantyId: number) =>
  ['warranty-reminder', scope, vehicleId, warrantyId] as const;

export function useWarrantyReminder(scope: WarrantyScope, vehicleId: number, warrantyId: number) {
  return useQuery({
    queryKey: reminderKey(scope, vehicleId, warrantyId),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: WarrantyReminderSettings }>(
        `/warranty-command/warranties/${warrantyId}/reminder?vehicle_id=${vehicleId}`, {
          signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
        });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) => query.state.data?.enabled ? 60_000 : false,
  });
}

export function useWarrantyReminderChange(scope: WarrantyScope, vehicleId: number, warrantyId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => request<void>(
      `/warranty-command/warranties/${warrantyId}/reminder?vehicle_id=${vehicleId}`, {
        method: enabled ? 'PUT' : 'DELETE',
        body: enabled ? JSON.stringify({ local_analysis_confirmed: true }) : undefined,
        cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope),
      }),
    networkMode: 'always',
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: reminderKey(scope, vehicleId, warrantyId) }),
        client.invalidateQueries({ queryKey: actionCenterKeys.all }),
      ]);
    },
  });
}
