import { request } from './client'
import type { AuthStatus } from './types'

/** Returns the current Tesla OAuth authentication status. */
export const getAuthStatus = () => request<AuthStatus>('/auth/status')
/** Fetches the Tesla OAuth authorization URL and CSRF state token. */
export const getAuthURL = () => request<{ auth_url: string; state: string }>('/auth/login')
/** Refreshes the Tesla OAuth access token using the stored refresh token. */
export const refreshAuth = () => request<{ status: string }>('/auth/refresh', { method: 'POST' })

export const disconnectAuth = () => request<{ status: string }>('/auth/disconnect', { method: 'POST' })
