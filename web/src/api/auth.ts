import { request } from './client'
import type { AuthStatus } from './types'

/** Returns the current Tesla OAuth authentication status. */
export const getAuthStatus = () => request<AuthStatus>('/auth/status')
/** Fetches the Tesla OAuth authorization URL and CSRF state token. */
export const getAuthURL = () => request<{ auth_url: string; state: string }>('/auth/login')

/**
 * Disconnects the Tesla account: revokes the stored refresh token and clears
 * saved credentials on the backend. Destructive and sudo-gated — the client's
 * step-up reauth interceptor may prompt for a fresh credential, and the returned
 * promise rejects with `SudoCanceledError` if the user dismisses that prompt.
 */
export const disconnectAuth = () => request<{ status: string }>('/auth/disconnect', { method: 'POST' })
