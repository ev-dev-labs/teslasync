// Phase-46 / Prompt 40 — Rate-limit status feed.
//
// Mirrors GET /api/v1/system/rate-limits. Lives in its own file
// because /system has no other React-Query hook today; future sibling
// system endpoints can land here without crowding useAdmin.ts.
//
// The hook auto-refreshes every 30 seconds and yields when the tab is
// hidden (refetchIntervalInBackground:false) — TanStack's built-in
// hook for the "pause polling when hidden" contract that Phase-46 /
// Prompt 53 codified.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { request } from '@/api/client'
import type { RateLimitStatusResponse } from '@/api/types'

export const systemKeys = {
  root: ['system'] as const,
  rateLimits: ['system', 'rate-limits'] as const,
}

export const RATE_LIMIT_REFETCH_INTERVAL_MS = 30_000
export const RATE_LIMIT_STALE_TIME_MS = 15_000

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
    refetchInterval: RATE_LIMIT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: RATE_LIMIT_STALE_TIME_MS,
    retry: 1,
    ...options,
  })
}
