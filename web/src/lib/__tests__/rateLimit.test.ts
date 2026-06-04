import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * RateLimitError + UpstreamUnavailableError + Retry-After parsing,
 * scope short-circuit cache, and dispatched CustomEvents.
 *
 * These tests use vitest's `vi.stubGlobal('fetch', ...)` to intercept
 * the resilientFetch network call so we can synthesize 429 / 503
 * responses with arbitrary Retry-After headers without standing up a
 * real HTTP server.
 */

import {
  resilientFetch,
  RateLimitError,
  UpstreamUnavailableError,
  isRateLimitError,
  isUpstreamUnavailableError,
  pathScope,
  _resetRateLimitCache,
} from '../resilience'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const merged = new Headers({ 'content-type': 'application/json', ...headers })
  return new Response(JSON.stringify(body), { status, headers: merged })
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // Force navigator.onLine = true so we don't short-circuit before the request.
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  _resetRateLimitCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  _resetRateLimitCache()
})

describe('pathScope', () => {
  it('returns the first path segment with a leading slash', () => {
    expect(pathScope('/vehicles/123/state')).toBe('/vehicles')
    expect(pathScope('/charging/45/telemetry')).toBe('/charging')
    expect(pathScope('/drives')).toBe('/drives')
  })

  it('handles paths without a leading slash', () => {
    expect(pathScope('vehicles/123')).toBe('/vehicles')
  })

  it('strips query string from the segment', () => {
    expect(pathScope('/vehicles?limit=10')).toBe('/vehicles')
  })
})

describe('RateLimitError', () => {
  it('is thrown on 429 with Retry-After header parsed in seconds', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: 'too many requests' }, { 'retry-after': '30' }),
    )

    const err = await resilientFetch('/vehicles', { retries: 0 }).catch((e) => e)

    expect(isRateLimitError(err)).toBe(true)
    const rl = err as RateLimitError
    expect(rl.status).toBe(429)
    expect(rl.retryAfterSec).toBe(30)
    expect(rl.scope).toBe('/vehicles')
  })

  it('defaults Retry-After to 60s when the header is missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'rl' }))

    const err = await resilientFetch('/vehicles', { retries: 0 }).catch((e) => e)

    expect(isRateLimitError(err)).toBe(true)
    expect((err as RateLimitError).retryAfterSec).toBe(60)
  })

  it('defaults Retry-After to 60s when the header value is non-numeric', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: 'rl' }, { 'retry-after': 'soon' }),
    )

    const err = await resilientFetch('/vehicles', { retries: 0 }).catch((e) => e)

    expect((err as RateLimitError).retryAfterSec).toBe(60)
  })

  it('dispatches the teslasync:rate-limited document event with scope + retryAfterSec', async () => {
    const handler = vi.fn()
    document.addEventListener('teslasync:rate-limited', handler)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: 'rl' }, { 'retry-after': '15' }),
    )

    await resilientFetch('/charging/9/telemetry', { retries: 0 }).catch(() => undefined)

    expect(handler).toHaveBeenCalledTimes(1)
    const evt = handler.mock.calls[0][0] as CustomEvent<{ scope: string; retryAfterSec: number }>
    expect(evt.detail.scope).toBe('/charging')
    expect(evt.detail.retryAfterSec).toBe(15)
    document.removeEventListener('teslasync:rate-limited', handler)
  })

  it('short-circuits subsequent calls to the same scope without hitting the network', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: 'rl' }, { 'retry-after': '30' }),
    )

    await resilientFetch('/vehicles', { retries: 0 }).catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Second call to the same scope MUST be cached — no extra fetch call.
    const err = await resilientFetch('/vehicles/42/state', { retries: 0 }).catch((e) => e)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(isRateLimitError(err)).toBe(true)
    expect((err as RateLimitError).message).toMatch(/cached/i)
  })

  it('does NOT short-circuit calls to a different scope', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rl' }, { 'retry-after': '30' }))
      .mockResolvedValueOnce(jsonResponse(200, { hello: 'world' }))

    await resilientFetch('/vehicles', { retries: 0 }).catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Different scope — should hit the network normally.
    const ok = await resilientFetch('/charging', { retries: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ok).toEqual({ hello: 'world' })
  })

  it('expires the short-circuit cache when the cooldown window elapses', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: 'rl' }, { 'retry-after': '30' }),
    )

    await resilientFetch('/vehicles', { retries: 0 }).catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Advance past the 30s cooldown.
    vi.setSystemTime(new Date('2026-05-03T12:00:31Z'))

    // The next call should hit the network again (cache expired).
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const ok = await resilientFetch('/vehicles', { retries: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ok).toEqual({ ok: true })

    vi.useRealTimers()
  })
})

describe('UpstreamUnavailableError', () => {
  it('is thrown on 503 with code UPSTREAM_BREAKER_OPEN', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        503,
        { error: 'tesla temporarily unavailable', code: 'UPSTREAM_BREAKER_OPEN', upstream: 'tesla' },
        { 'retry-after': '45' },
      ),
    )

    const err = await resilientFetch('/vehicles', { retries: 0 }).catch((e) => e)

    expect(isUpstreamUnavailableError(err)).toBe(true)
    const ub = err as UpstreamUnavailableError
    expect(ub.status).toBe(503)
    expect(ub.retryAfterSec).toBe(45)
    expect(ub.upstream).toBe('tesla')
  })

  it('falls back to upstream "tesla" when the body omits the field', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        503,
        { error: 'breaker', code: 'UPSTREAM_BREAKER_OPEN' },
        { 'retry-after': '20' },
      ),
    )

    const err = await resilientFetch('/vehicles', { retries: 0 }).catch((e) => e)
    expect((err as UpstreamUnavailableError).upstream).toBe('tesla')
  })

  it('dispatches teslasync:upstream-down with upstream + retryAfterSec', async () => {
    const handler = vi.fn()
    document.addEventListener('teslasync:upstream-down', handler)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        503,
        { error: 'breaker', code: 'UPSTREAM_BREAKER_OPEN', upstream: 'tesla' },
        { 'retry-after': '90' },
      ),
    )

    await resilientFetch('/vehicles', { retries: 0 }).catch(() => undefined)

    expect(handler).toHaveBeenCalledTimes(1)
    const evt = handler.mock.calls[0][0] as CustomEvent<{ upstream: string; retryAfterSec: number }>
    expect(evt.detail.upstream).toBe('tesla')
    expect(evt.detail.retryAfterSec).toBe(90)
    document.removeEventListener('teslasync:upstream-down', handler)
  })

  it('does NOT mark the rate-limit cache for 503 (separate signal)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          503,
          { error: 'breaker', code: 'UPSTREAM_BREAKER_OPEN' },
          { 'retry-after': '60' },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))

    await resilientFetch('/vehicles', { retries: 0 }).catch(() => undefined)
    // Subsequent call should still hit the network — 503 is upstream-down,
    // not a rate-limit; the breaker banner handles its own backoff.
    const ok = await resilientFetch('/vehicles', { retries: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ok).toEqual({ ok: true })
  })

  it('does NOT throw UpstreamUnavailableError for plain 503 without the code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'service unavailable' }))

    const err = await resilientFetch('/vehicles', { retries: 0 }).catch((e) => e)
    expect(isUpstreamUnavailableError(err)).toBe(false)
    expect((err as Error).message).toMatch(/service unavailable/i)
  })
})
