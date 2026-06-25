// Rate-limit status feed.
//
// Mirrors GET /api/v1/system/rate-limits. Lives in its own file
// because /system has no other React-Query hook today; future sibling
// system endpoints can land here without crowding useAdmin.ts.
//
// The hook auto-refreshes every 30 seconds. The native TanStack Query
// adapter preserves refetchIntervalInBackground:false so polling yields
// when the app is not in the foreground.

import {useQuery, type UseQueryOptions} from '@tanstack/react-query';

import {request} from '../client';
import type {RateLimitStatusResponse} from '../../../api/types';

export const systemKeys = {
  root: ['system'] as const,
  rateLimits: ['system', 'rate-limits'] as const,
};

export const RATE_LIMIT_REFETCH_INTERVAL_MS = 30_000;
export const RATE_LIMIT_STALE_TIME_MS = 15_000;

type RateLimitQueryOptions = Omit<
  UseQueryOptions<RateLimitStatusResponse, Error>,
  'queryKey' | 'queryFn'
>;

/**
 * useRateLimitStatus - polls /system/rate-limits.
 *
 * Auto-refresh keeps the same query contract as web: when the app is not
 * foregrounded, TanStack Query should not continue the interval in the
 * background.
 */
export function useRateLimitStatus(options: RateLimitQueryOptions = {}) {
  return useQuery<RateLimitStatusResponse, Error>({
    queryKey: systemKeys.rateLimits,
    queryFn: ({signal}) =>
      request<RateLimitStatusResponse>('/system/rate-limits', {signal}),
    refetchInterval: RATE_LIMIT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: RATE_LIMIT_STALE_TIME_MS,
    retry: 1,
    ...options,
  });
}
