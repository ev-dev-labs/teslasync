import { request } from '../../api/client';

interface AuthStatus {
  authenticated: boolean;
  expires_at?: string;
  expired?: boolean;
}

/** Returns the current Tesla OAuth authentication status. */
export const getAuthStatus = () => request<AuthStatus>('/auth/status');

/** Fetches the Tesla OAuth authorization URL and CSRF state token. */
export const getAuthURL = () =>
  request<{auth_url: string; state: string}>('/auth/login');

export const disconnectAuth = () =>
  request<{status: string}>('/auth/disconnect', {method: 'POST'});
