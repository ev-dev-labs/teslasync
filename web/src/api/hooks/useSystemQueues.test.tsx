// useSystemQueues hook-layer tests.
//
// useSystemQueues.ts exposes the admin job-queue TanStack Query surface:
//   - clampJobsLimit()  — the [1, 200] limit sanitiser
//   - queueKeys         — the cache-key factory
//   - useQueueStatus()  — polls /system/queues
//   - useQueueJobs()    — per-worker drawer feed at /system/queues/{worker}/jobs
//
// These tests exercise the contract each export exposes — the exact
// request path (no /api/v1 prefix, snake_case `limit` query param), the
// AbortSignal thread-through, the enabled gate, the limit clamp (both in
// the URL *and* the cache key so identity matches the URL that was
// fetched), worker URL-encoding, and the error path — without standing
// up the whole System admin page.
//
// Sibling-of-source location is mandatory: the elevation gate matches
// `api/hooks/useSystemQueues` as a contiguous path substring, which a
// __tests__/ subdir would interrupt.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

import { ApiError, request } from '@/api/client'
import type { QueueJobsResponse, QueueStatusResponse } from '@/api/types'
import {
  clampJobsLimit,
  queueKeys,
  useQueueStatus,
  useQueueJobs,
  QUEUE_JOBS_DEFAULT_LIMIT,
  QUEUE_JOBS_MAX_LIMIT,
} from './useSystemQueues'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

/**
 * Fresh QueryClient + provider per test. retry:false is the baseline,
 * but both hooks override it with retry:1 — retryDelay:0 keeps that
 * single retry from stalling the error-path tests behind React Query's
 * default exponential backoff. Returns the client so cache-identity
 * tests can read back a specific key.
 */
function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
    },
  })
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { qc, wrapper }
}

/** Reads back the [path, options] pair from the Nth request() call. */
function callArgs(n = 0): [string, { signal?: unknown }] {
  return mockedRequest.mock.calls[n] as [string, { signal?: unknown }]
}

const statusPayload: QueueStatusResponse = {
  generated_at: '2025-06-01T00:00:00Z',
  workers: [
    {
      worker: 'export',
      display_name: 'Export Worker',
      pending: 2,
      in_progress: 1,
      succeeded_24h: 40,
      failed_24h: 0,
      oldest_pending_age_seconds: 12,
      heartbeat_severity: 'ok',
      heartbeat_detail: 'Last beat 3s ago',
    },
  ],
}

const jobsPayload: QueueJobsResponse = {
  worker: 'export',
  jobs: [
    {
      id: 'job-1',
      worker: 'export',
      status: 'succeeded',
      title: 'Nightly CSV export',
      started_at: '2025-06-01T00:00:00Z',
      finished_at: '2025-06-01T00:00:05Z',
      duration_ms: 5000,
    },
  ],
}

beforeEach(() => {
  mockedRequest.mockReset()
})

// ---------------------------------------------------------------------------
// clampJobsLimit — the [1, 200] sanitiser the URL + cache key share
// ---------------------------------------------------------------------------

describe('clampJobsLimit', () => {
  it('passes through in-range integers unchanged', () => {
    expect(clampJobsLimit(1)).toBe(1)
    expect(clampJobsLimit(25)).toBe(25)
    expect(clampJobsLimit(QUEUE_JOBS_MAX_LIMIT)).toBe(QUEUE_JOBS_MAX_LIMIT)
  })

  it('caps values above the max at QUEUE_JOBS_MAX_LIMIT', () => {
    expect(clampJobsLimit(QUEUE_JOBS_MAX_LIMIT + 1)).toBe(QUEUE_JOBS_MAX_LIMIT)
    expect(clampJobsLimit(1_000_000)).toBe(QUEUE_JOBS_MAX_LIMIT)
  })

  it('floors fractional limits and lifts sub-1 values to 1', () => {
    expect(clampJobsLimit(25.9)).toBe(25)
    expect(clampJobsLimit(0)).toBe(1)
    expect(clampJobsLimit(0.4)).toBe(1)
    expect(clampJobsLimit(-5)).toBe(1)
  })

  it('falls back to the default page size for non-finite input', () => {
    expect(clampJobsLimit(Number.NaN)).toBe(QUEUE_JOBS_DEFAULT_LIMIT)
    expect(clampJobsLimit(Number.POSITIVE_INFINITY)).toBe(QUEUE_JOBS_DEFAULT_LIMIT)
    expect(clampJobsLimit(Number.NEGATIVE_INFINITY)).toBe(QUEUE_JOBS_DEFAULT_LIMIT)
  })
})

// ---------------------------------------------------------------------------
// queueKeys — cache-key factory
// ---------------------------------------------------------------------------

describe('queueKeys', () => {
  it('produces stable, distinct key tuples for every query variant', () => {
    expect(queueKeys.root).toEqual(['system', 'queues'])
    expect(queueKeys.status).toEqual(['system', 'queues', 'status'])
  })

  it('defaults the jobs limit segment and includes an explicit limit when given', () => {
    expect(queueKeys.jobs('export')).toEqual([
      'system',
      'queues',
      'jobs',
      'export',
      QUEUE_JOBS_DEFAULT_LIMIT,
    ])
    expect(queueKeys.jobs('export', 50)).toEqual([
      'system',
      'queues',
      'jobs',
      'export',
      50,
    ])
    // Different limits must yield distinct keys (the cache-collision guard).
    expect(queueKeys.jobs('export', 10)).not.toEqual(queueKeys.jobs('export', 20))
  })
})

// ---------------------------------------------------------------------------
// useQueueStatus
// ---------------------------------------------------------------------------

describe('useQueueStatus', () => {
  it('GETs /system/queues, threads the abort signal, and surfaces the workers payload', async () => {
    mockedRequest.mockResolvedValueOnce(statusPayload)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueueStatus(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const [url, opts] = callArgs()
    expect(url).toBe('/system/queues')
    expect(opts).toHaveProperty('signal')
    expect(result.current.data?.workers).toHaveLength(1)
    expect(result.current.data?.workers[0].worker).toBe('export')
  })

  it('stays idle (no request) when enabled=false is passed through', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueueStatus({ enabled: false }), { wrapper })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('surfaces request failures as isError', async () => {
    // retry:1 on this hook overrides the wrapper's retry:false, so reject
    // *every* attempt (mockRejectedValue, not …Once) to reach the error state.
    mockedRequest.mockRejectedValue(new ApiError('boom', 500))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueueStatus(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
  })
})

// ---------------------------------------------------------------------------
// useQueueJobs
// ---------------------------------------------------------------------------

describe('useQueueJobs', () => {
  it('GETs /system/queues/{worker}/jobs with the default limit, threads the signal, and surfaces jobs', async () => {
    mockedRequest.mockResolvedValueOnce(jobsPayload)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueueJobs('export'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const [url, opts] = callArgs()
    expect(url).toBe(`/system/queues/export/jobs?limit=${QUEUE_JOBS_DEFAULT_LIMIT}`)
    expect(opts).toHaveProperty('signal')
    expect(result.current.data?.jobs).toHaveLength(1)
    expect(result.current.data?.jobs[0].id).toBe('job-1')
  })

  it('URL-encodes a worker identifier containing reserved characters', async () => {
    mockedRequest.mockResolvedValueOnce({ worker: 'a b/c', jobs: [] })
    const { wrapper } = makeWrapper()
    renderHook(() => useQueueJobs('a b/c'), { wrapper })

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    expect(callArgs()[0]).toBe(`/system/queues/a%20b%2Fc/jobs?limit=${QUEUE_JOBS_DEFAULT_LIMIT}`)
  })

  it('clamps an over-large limit down to QUEUE_JOBS_MAX_LIMIT in the request URL', async () => {
    mockedRequest.mockResolvedValueOnce(jobsPayload)
    const { wrapper } = makeWrapper()
    renderHook(() => useQueueJobs('export', { limit: 999_999 }), { wrapper })

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    expect(callArgs()[0]).toBe(`/system/queues/export/jobs?limit=${QUEUE_JOBS_MAX_LIMIT}`)
  })

  it('lifts a sub-1 limit to 1 in the request URL', async () => {
    mockedRequest.mockResolvedValueOnce(jobsPayload)
    const { wrapper } = makeWrapper()
    renderHook(() => useQueueJobs('export', { limit: 0 }), { wrapper })

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    expect(callArgs()[0]).toBe('/system/queues/export/jobs?limit=1')
  })

  it('keys the cache with the clamped limit so cache identity matches the URL that was fetched', async () => {
    mockedRequest.mockResolvedValue(jobsPayload)
    const { qc, wrapper } = makeWrapper()
    renderHook(() => useQueueJobs('export', { limit: 999_999 }), { wrapper })

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    // The raw limit (999_999) must NOT be the cache key…
    expect(qc.getQueryData(queueKeys.jobs('export', 999_999))).toBeUndefined()
    // …the clamped MAX_LIMIT must be.
    expect(qc.getQueryData(queueKeys.jobs('export', QUEUE_JOBS_MAX_LIMIT))).toEqual(
      jobsPayload,
    )
  })

  it('respects the explicit enabled=false gate — the closed drawer fires no request', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueueJobs('export', { enabled: false }), {
      wrapper,
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('surfaces request failures as isError', async () => {
    mockedRequest.mockRejectedValue(new ApiError('queue down', 503))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueueJobs('export'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
  })
})
