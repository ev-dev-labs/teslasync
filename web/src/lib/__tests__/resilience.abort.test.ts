import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AbortSignal threading through `resilientFetch`.
 *
 * These tests verify that:
 *   - A user-side abort propagates as `AbortError` (not converted to a
 *     408 ApiError, not retried, not flagged as a transient infra
 *     signal that the rate-limit cache would short-circuit).
 *   - Internal timeouts still fire correctly and surface as 408.
 *   - Pre-aborted signals short-circuit before any network work.
 *   - Aborts during retry-backoff stop the loop immediately.
 */

import { resilientFetch, ApiError, _resetRateLimitCache } from '../resilience'

/**
 * Build a fetch mock that respects an incoming `AbortSignal`. The
 * default fake-fetch returned by `vi.stubGlobal('fetch', vi.fn())` does
 * NOT subscribe to `init.signal`, which would let our test hang
 * forever instead of asserting cancellation. This helper returns a
 * promise that rejects with a real DOMException AbortError as soon as
 * the signal aborts — closely matching real browser fetch semantics.
 */
function makeAbortAwareFetch() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) {
        reject(new DOMException('aborted', 'AbortError'))
        return
      }
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            reject(new DOMException('aborted', 'AbortError'))
          },
          { once: true },
        )
      }
    })
  })
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  _resetRateLimitCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('resilientFetch — user-side AbortSignal', () => {
  it('rejects with AbortError when the caller aborts mid-request (NOT 408)', async () => {
    const fetchMock = makeAbortAwareFetch()
    vi.stubGlobal('fetch', fetchMock)

    const ctrl = new AbortController()
    const promise = resilientFetch('/vehicles', { signal: ctrl.signal, retries: 0 })

    // Give the fetch mock a tick to subscribe to the signal.
    await new Promise((r) => setTimeout(r, 5))
    ctrl.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    // Not converted to ApiError(408) — that conversion is reserved for
    // the internal timeout path.
    await expect(promise).rejects.not.toBeInstanceOf(ApiError)
  })

  it('does NOT retry after a user-initiated abort', async () => {
    const fetchMock = makeAbortAwareFetch()
    vi.stubGlobal('fetch', fetchMock)

    const ctrl = new AbortController()
    // retries: 3 — without abort handling, we would see 4 fetch calls.
    const promise = resilientFetch('/vehicles', {
      signal: ctrl.signal,
      retries: 3,
      retryDelay: 10,
    })

    await new Promise((r) => setTimeout(r, 5))
    ctrl.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('short-circuits without issuing fetch when the signal is already aborted', async () => {
    const fetchMock = makeAbortAwareFetch()
    vi.stubGlobal('fetch', fetchMock)

    const ctrl = new AbortController()
    ctrl.abort()

    await expect(
      resilientFetch('/vehicles', { signal: ctrl.signal, retries: 0 }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('propagates a successful response when the signal never fires', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const ctrl = new AbortController()
    const result = await resilientFetch<{ ok: boolean }>('/vehicles', {
      signal: ctrl.signal,
      retries: 0,
    })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still surfaces the internal timeout as ApiError 408 when the user passes no signal', async () => {
    // Use real timers to avoid microtask-vs-fake-timer races. A 30 ms
    // timeout is short enough to keep the suite fast.
    const fetchMock = makeAbortAwareFetch()
    vi.stubGlobal('fetch', fetchMock)

    const err = await resilientFetch('/vehicles', { retries: 0, timeout: 30 }).catch(
      (e) => e,
    )

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(408)
  })

  it('respects abort during retry backoff', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      // First attempt fails with a normal network error so we enter
      // the retry-backoff path.
      if (init?.signal?.aborted) {
        throw new DOMException('aborted', 'AbortError')
      }
      throw new Error('boom')
    })
    vi.stubGlobal('fetch', fetchMock)

    const ctrl = new AbortController()
    const promise = resilientFetch('/vehicles', {
      signal: ctrl.signal,
      retries: 5,
      retryDelay: 1000,
    })

    // Let the first attempt fail and the loop enter the backoff sleep.
    await new Promise((r) => setTimeout(r, 20))
    ctrl.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    // We never made it past the first attempt because abort fired
    // during backoff.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
