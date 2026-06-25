import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {isApiError, request, type ApiError} from '../client';
import type {
  ActiveSession,
  ActiveSessionsResponse,
  RevokeAllOthersResponse,
} from '../../../api/types';
import {useMutationToast} from './_toastHelpers';

export type {
  ActiveSession,
  ActiveSessionsResponse,
  RevokeAllOthersResponse,
} from '../../../api/types';

export const nativeSessionHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  mutationFeedbackPrimitive: 'Alert.alert',
  sudoChallengeProvider: 'registerSudoChallengeProvider',
  authModeOpenHandledAsData: true,
} as const;

function invalidateAndBroadcast(
  qc: QueryClient,
  filters: {queryKey: QueryKey},
): void {
  void qc.invalidateQueries(filters);
}

export const sessionKeys = {
  list: ['sessions', 'list'] as const,
};

const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN';

interface SessionListPayload {
  mode: 'session';
  sessions: ActiveSession[];
}

export function useSessions(options?: {enabled?: boolean}) {
  return useQuery<ActiveSessionsResponse, ApiError>({
    queryKey: sessionKeys.list,
    queryFn: async ({signal}) => {
      try {
        const payload = await request<SessionListPayload>('/auth/sessions', {
          signal,
        });
        return {mode: 'session', sessions: payload.sessions ?? []};
      } catch (err) {
        if (isApiError(err) && err.code === AUTH_MODE_OPEN_CODE) {
          return {mode: 'open'};
        }
        throw err;
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  const toast = useMutationToast();
  return useMutation<void, ApiError, string>({
    mutationFn: (id: string) =>
      request<void>(`/auth/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: sessionKeys.list});
      toast.success('settings.sessions.toasts.revoked', 'Session signed out.');
    },
    onError: err =>
      toast.error(
        err,
        'settings.sessions.errors.revoke',
        'Failed to sign out session',
      ),
  });
}

export function useRevokeAllOtherSessions() {
  const qc = useQueryClient();
  const toast = useMutationToast();
  return useMutation<RevokeAllOthersResponse, ApiError, void>({
    mutationFn: () =>
      request<RevokeAllOthersResponse>('/auth/sessions/all-others', {
        method: 'DELETE',
      }),
    onSuccess: result => {
      invalidateAndBroadcast(qc, {queryKey: sessionKeys.list});
      toast.success(
        'settings.sessions.toasts.revokedAllOthers',
        `Signed out ${result.revoked} other device${
          result.revoked === 1 ? '' : 's'
        }.`,
      );
    },
    onError: err =>
      toast.error(
        err,
        'settings.sessions.errors.revokeAllOthers',
        'Failed to sign out other sessions',
      ),
  });
}
