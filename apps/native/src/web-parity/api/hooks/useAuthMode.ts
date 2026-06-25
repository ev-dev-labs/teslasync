import {useQuery} from '@tanstack/react-query';

import {request} from '../client';
import type {ApiError} from '../client';
import type {AuthModeResponse} from '../../../api/types';

export type {AuthModeResponse};

/**
 * Stable query-key registry for the auth-mode endpoint. Exported so other
 * hooks can invalidate it without re-deriving the key.
 */
export const authModeKeys = {
  all: ['auth', 'mode'] as const,
};

/**
 * Default staleTime for the contract endpoint: 5 minutes. The auth mode is a
 * deployment-level contract and should not poll in the background.
 */
export const AUTH_MODE_STALE_MS = 5 * 60_000;

/**
 * Status query for the native parity auth-mode contract endpoint.
 */
export function useAuthMode() {
  return useQuery<AuthModeResponse, ApiError>({
    queryKey: authModeKeys.all,
    queryFn: ({signal}) =>
      request<AuthModeResponse>('/system/auth-mode', {signal}),
    staleTime: AUTH_MODE_STALE_MS,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
}

/**
 * Convenience boolean. Defaults to false until the contract resolves.
 */
export function useIsForwardAuth(): boolean {
  const {data} = useAuthMode();
  return data?.mode === 'forward_auth';
}

/**
 * Returns the current request subject in forward-auth mode, or null when the
 * deployment is open/auth data is not resolved yet.
 */
export function useAuthSubject(): string | null {
  const {data} = useAuthMode();
  if (!data) {
    return null;
  }
  if (data.mode !== 'forward_auth') {
    return null;
  }
  return data.subject ?? null;
}
