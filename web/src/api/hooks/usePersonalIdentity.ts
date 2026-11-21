import { useQuery } from '@tanstack/react-query'
import { request } from '../client'
import type { AuthModeResponse } from '@/api/types'

export type PersonalScope =
  | { mode: 'open' }
  | { mode: 'forward_auth'; subject: string }

export const personalIdentityKey = ['personal-identity'] as const

export function usePersonalIdentity(enabled = true) {
  return useQuery({
    queryKey: personalIdentityKey,
    queryFn: ({ signal }) =>
      request<AuthModeResponse>('/system/auth-mode', { signal, cache: 'no-store' }),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

export function personalScope(identity: AuthModeResponse | undefined): PersonalScope | null {
  if (!identity) return null
  if (identity.mode === 'open') return { mode: 'open' }
  return identity.subject ? { mode: 'forward_auth', subject: identity.subject } : null
}

export function expectedPrincipalHeader(scope: PersonalScope): Record<string, string> {
  return {
    'X-TeslaSync-Expected-Principal': scope.mode === 'open'
      ? 'open'
      : `subject:${encodeURIComponent(scope.subject)}`,
  }
}
