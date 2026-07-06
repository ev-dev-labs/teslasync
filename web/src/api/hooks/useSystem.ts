// Rate-limit status feed.
//
// Mirrors GET /api/v1/system/rate-limits. Lives in its own file
// because /system has no other React-Query hook today; future sibling
// system endpoints can land here without crowding useAdmin.ts.
//
// The hook auto-refreshes every 30 seconds and yields when the tab is
// hidden (refetchIntervalInBackground:false), using TanStack's built-in
// pause-on-hidden behavior.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { request } from '@/api/client'
import type { RateLimitStatusResponse, ScopeBudget } from '@/api/types'
import { safeArray } from '@/lib/safeArray'

export const systemKeys = {
  root: ['system'] as const,
  rateLimits: ['system', 'rate-limits'] as const,
}

export const RATE_LIMIT_REFETCH_INTERVAL_MS = 30_000
export const RATE_LIMIT_STALE_TIME_MS = 15_000

/**
 * Normalises the rate-limit envelope so `scopes` is ALWAYS a real array on
 * success. A Go nil slice marshals to JSON `null`, so without this guard a
 * consumer doing `data.scopes.map(...)` could crash the whole panel. Mirrors
 * the `select: safeArray` invariant every other list-bearing hook enforces at
 * the query boundary — defined at module scope so its reference is stable
 * (React Query only re-runs `select` when its input data or reference changes).
 */
function selectRateLimitStatus(
  resp: RateLimitStatusResponse,
): RateLimitStatusResponse {
  return { ...resp, scopes: safeArray<ScopeBudget>(resp?.scopes) }
}

type RateLimitQueryOptions = Omit<
  UseQueryOptions<RateLimitStatusResponse, Error>,
  'queryKey' | 'queryFn'
>

/**
 * useRateLimitStatus — polls /system/rate-limits.
 *
 * Auto-refresh respects document visibility: when the tab is hidden
 * the refetch timer pauses (and resumes on visibilitychange) so an
 * idle Settings tab in the background doesn't burn server budget.
 */
export function useRateLimitStatus(options: RateLimitQueryOptions = {}) {
  return useQuery<RateLimitStatusResponse, Error>({
    queryKey: systemKeys.rateLimits,
    queryFn: ({ signal }) =>
      request<RateLimitStatusResponse>('/system/rate-limits', { signal }),
    select: selectRateLimitStatus,
    refetchInterval: RATE_LIMIT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: RATE_LIMIT_STALE_TIME_MS,
    retry: 1,
    ...options,
  })
}
