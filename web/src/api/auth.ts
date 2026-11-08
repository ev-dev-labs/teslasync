import { request } from './client'
import type { AuthStatus } from './types'

/** Returns the current Tesla OAuth authentication status. */
export const getAuthStatus = () => request<AuthStatus>('/auth/status')
/** Fetches the Tesla OAuth authorization URL and CSRF state token. */
export const getAuthURL = () => request<{ auth_url: string; state: string }>('/auth/login')

/**
 * Disconnects the Tesla account: revokes the stored refresh token and clears
 * saved credentials on the backend. The client confirms intent before sending;
 * cancellation rejects with `ActionCanceledError` without requesting a password.
 */
export const disconnectAuth = () => request<{ status: string }>('/auth/disconnect', { method: 'POST' })
