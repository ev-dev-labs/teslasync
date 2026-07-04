// useSystem hook-family coverage.
//
// Exercises EVERY export of api/hooks/useSystem.ts through its public surface:
//   - systemKeys           — stable, hierarchical cache-key tuples used for
//                            invalidation.
//   - RATE_LIMIT_*_MS      — the poll cadence + staleness-budget constants and
//                            the invariant between them.
//   - useRateLimitStatus   — GET /system/rate-limits: request shaping +
//                            AbortSignal threading, the `scopes` null / non-array
//                            normalisation that stops a Go nil slice from
//                            crashing `.map`, the array pass-through, the
//                            `enabled:false` gate (the exact call shape
//                            RateLimitStatusPanel uses for its test override),
//                            caller-option precedence over the hook defaults,
//                            and the failure path.
//
// Network is mocked at the `request` boundary — the repo convention (see
// useExports.test.tsx / RateLimitStatusPanel.test.tsx). `safeArray` is left
// REAL so the normalisation is proven end-to-end rather than stubbed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Keep the real client exports and swap only the HTTP entry point for a spy.
vi.mock('@/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

import { request } from '@/api/client'
import {
  systemKeys,
  RATE_LIMIT_REFETCH_INTERVAL_MS,
  RATE_LIMIT_STALE_TIME_MS,
  useRateLimitStatus,
} from './useSystem'
import type {
  RateLimitStatusResponse,
  RateLimitSeverity,
  ScopeBudget,
} from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

// ── Helpers ────────────────────────────────────────────────────────────────
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function makeScope(
  id: string,
  current: number,
  limit: number,
  severity: RateLimitSeverity,
  windowSeconds = 60,
): ScopeBudget {
  return {
    id,
    name: id,
    current,
    limit,
    window_seconds: windowSeconds,
    severity,
    detail: `${id} detail`,
  }
}

function buildResponse(
  overrides: Partial<RateLimitStatusResponse> = {},
): RateLimitStatusResponse {
  return {
    generated_at: '2026-07-04T12:00:00Z',
    scopes: [
      makeScope('tesla.fleet_api.burst', 1, 5, 'ok', 0),
      makeScope('api.internal.minute', 350, 600, 'warn', 60),
      makeScope('api.write.minute', 110, 120, 'critical', 60),
    ],
    ...overrides,
  }
}

/** URL passed to the mocked `request` on invocation `i`. */
function calledUrl(i = 0): string {
  return mockedRequest.mock.calls[i]?.[0] as string
}
/** RequestInit passed to the mocked `request` on invocation `i`. */
function calledOpts(i = 0): RequestInit {
  return (mockedRequest.mock.calls[i]?.[1] ?? {}) as RequestInit
}

beforeEach(() => {
  mockedRequest.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── systemKeys ───────────────────────────────────────────────────────────────
describe('systemKeys', () => {
  it('exposes stable, hierarchical cache-key tuples', () => {
    expect(systemKeys.root).toEqual(['system'])
    expect(systemKeys.rateLimits).toEqual(['system', 'rate-limits'])
    // rateLimits is scoped UNDER root, so a broad invalidate(['system'])
    // also drops the rate-limit cache.
    expect(systemKeys.rateLimits[0]).toBe(systemKeys.root[0])
  })
})

// ── cadence constants ────────────────────────────────────────────────────────
describe('rate-limit polling constants', () => {
  it('publishes a 30s poll cadence and a 15s staleness budget', () => {
    expect(RATE_LIMIT_REFETCH_INTERVAL_MS).toBe(30_000)
    expect(RATE_LIMIT_STALE_TIME_MS).toBe(15_000)
  })

  it('keeps the refetch interval no shorter than the stale window', () => {
    // A stale window LONGER than the poll cadence would refetch data React
    // Query still considers fresh — wasted server budget. This invariant
    // guards against a future edit inverting the two.
    expect(RATE_LIMIT_REFETCH_INTERVAL_MS).toBeGreaterThanOrEqual(
      RATE_LIMIT_STALE_TIME_MS,
    )
  })
})

// ── useRateLimitStatus ───────────────────────────────────────────────────────
describe('useRateLimitStatus', () => {
  it('GETs /system/rate-limits, threads an AbortSignal, and surfaces the envelope', async () => {
    const payload = buildResponse()
    mockedRequest.mockResolvedValueOnce(payload)

    const { result } = renderHook(() => useRateLimitStatus(), {
      wrapper: wrapperFor(makeClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(calledUrl()).toBe('/system/rate-limits')
    // resilience contract: the queryFn hands React Query's AbortSignal to
    // request() so a route change cancels the in-flight poll.
    expect(calledOpts()).toHaveProperty('signal')
    expect(result.current.data?.generated_at).toBe(payload.generated_at)
    expect(result.current.data?.scopes).toHaveLength(3)
    expect(result.current.data?.scopes[2].id).toBe('api.write.minute')
  })

  it('normalises a null `scopes` slice to [] so consumers can .map without a guard', async () => {
    // A Go nil slice marshals to JSON null; the hook must not surface it raw.
    mockedRequest.mockResolvedValueOnce({
      generated_at: '2026-07-04T12:00:00Z',
      scopes: null,
    } as unknown as RateLimitStatusResponse)

    const { result } = renderHook(() => useRateLimitStatus(), {
      wrapper: wrapperFor(makeClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Array.isArray(result.current.data?.scopes)).toBe(true)
    expect(result.current.data?.scopes).toEqual([])
    // the rest of the envelope is preserved untouched.
    expect(result.current.data?.generated_at).toBe('2026-07-04T12:00:00Z')
  })

  it('coerces a non-array `scopes` payload to [] and warns (defensive safeArray)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockedRequest.mockResolvedValueOnce({
      generated_at: '2026-07-04T12:00:00Z',
      scopes: { oops: true },
    } as unknown as RateLimitStatusResponse)

    const { result } = renderHook(() => useRateLimitStatus(), {
      wrapper: wrapperFor(makeClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.scopes).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('passes a populated scopes array through untouched', async () => {
    const payload = buildResponse({
      scopes: [makeScope('api.internal.minute', 10, 600, 'ok', 60)],
    })
    mockedRequest.mockResolvedValueOnce(payload)

    const { result } = renderHook(() => useRateLimitStatus(), {
      wrapper: wrapperFor(makeClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.scopes).toHaveLength(1)
    expect(result.current.data?.scopes[0]).toEqual(
      expect.objectContaining({ id: 'api.internal.minute', severity: 'ok' }),
    )
  })

  it('stays idle and fires no request when disabled via options', async () => {
    const { result } = renderHook(
      () => useRateLimitStatus({ enabled: false }),
      { wrapper: wrapperFor(makeClient()) },
    )

    // Give a disabled query a tick — it must never dispatch.
    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
  })

  it('surfaces a request failure as isError, with caller options overriding the defaults', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('rate-limit feed down'))

    const { result } = renderHook(
      // retry:false overrides the hook's default retry:1 so the error path
      // resolves immediately instead of waiting on backoff — and proves the
      // caller-supplied options win over the hook defaults (spread order).
      () => useRateLimitStatus({ retry: false }),
      { wrapper: wrapperFor(makeClient()) },
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.data).toBeUndefined()
  })
})
