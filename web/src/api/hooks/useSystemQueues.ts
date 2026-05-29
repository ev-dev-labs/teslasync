// Job queue status hooks.
//
// useQueueStatus() polls /system/queues every 30s.
// useQueueJobs(worker, { enabled }) fetches /system/queues/{worker}/jobs.
//
// Polling pauses while the tab is hidden via TanStack Query's
// refetchIntervalInBackground:false. The drawer hook accepts an `enabled` flag
// so per-worker jobs only fetch when the drawer is open.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { request } from '@/api/client'
import type { QueueJobsResponse, QueueStatusResponse } from '@/api/types'

export const queueKeys = {
  root: ['system', 'queues'] as const,
  status: ['system', 'queues', 'status'] as const,
  jobs: (worker: string) => ['system', 'queues', 'jobs', worker] as const,
}

export const QUEUE_STATUS_REFETCH_INTERVAL_MS = 30_000
export const QUEUE_STATUS_STALE_TIME_MS = 15_000
export const QUEUE_JOBS_REFETCH_INTERVAL_MS = 60_000
export const QUEUE_JOBS_STALE_TIME_MS = 30_000
export const QUEUE_JOBS_DEFAULT_LIMIT = 25

type QueueStatusOptions = Omit<
  UseQueryOptions<QueueStatusResponse, Error>,
  'queryKey' | 'queryFn'
>

type QueueJobsOptions = Omit<
  UseQueryOptions<QueueJobsResponse, Error>,
  'queryKey' | 'queryFn'
> & {
  /** Maximum number of jobs to fetch (clamped to [1, 200] server-side). */
  limit?: number
}

/**
 * useQueueStatus — polls /system/queues.
 *
 * Auto-refresh respects document visibility: when the tab is hidden
 * the refetch timer pauses (and resumes on visibilitychange) so an
 * idle admin tab in the background doesn't burn server budget.
 */
export function useQueueStatus(options: QueueStatusOptions = {}) {
  return useQuery<QueueStatusResponse, Error>({
    queryKey: queueKeys.status,
    queryFn: ({ signal }) =>
      request<QueueStatusResponse>('/system/queues', { signal }),
    refetchInterval: QUEUE_STATUS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: QUEUE_STATUS_STALE_TIME_MS,
    retry: 1,
    ...options,
  })
}

/**
 * useQueueJobs — fetches recent jobs for a single worker for the
 * drawer view. Pass `enabled: false` (the default for closed
 * drawers) to skip the network call entirely until the user opens
 * the drawer.
 */
export function useQueueJobs(
  worker: string,
  { limit = QUEUE_JOBS_DEFAULT_LIMIT, ...options }: QueueJobsOptions = {},
) {
  return useQuery<QueueJobsResponse, Error>({
    queryKey: queueKeys.jobs(worker),
    queryFn: ({ signal }) =>
      request<QueueJobsResponse>(
        `/system/queues/${encodeURIComponent(worker)}/jobs?limit=${limit}`,
        { signal },
      ),
    refetchInterval: QUEUE_JOBS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: QUEUE_JOBS_STALE_TIME_MS,
    retry: 1,
    ...options,
  })
}
