import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request, __resetActionConfirmationForTests } from './client'
import { _resetRateLimitCache, resilientFetch } from '@/lib/resilience'
import { __resetBroadcastForTests } from '@/lib/broadcast'
import { ratePolicyHeaders } from '@/test/rateLimit'

const fetchMock = vi.fn<typeof fetch>()

function reply(status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(status === 200 ? { battery_level: 80 } : { error: 'slow down' }), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  _resetRateLimitCache()
  __resetActionConfirmationForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})

afterEach(() => {
  _resetRateLimitCache()
  __resetBroadcastForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('primary transport quota admission', () => {
  it.each([
    { method: 'GET', responseType: 'json' as const },
    { method: 'GET', responseType: 'text' as const },
    { method: 'POST', responseType: 'json' as const },
  ])('handles the first $method $responseType 429 once, without fallback or replay', async (options) => {
    fetchMock.mockResolvedValueOnce(reply(429, { 'Retry-After': '30' }))
    await expect(request('/vehicles/7/refresh', options)).rejects.toMatchObject({
      name: 'RateLimitError', retryAfterSec: 30, scope: '/vehicles/7/refresh', requestMethod: options.method,
    })
    await expect(request('/vehicles/7/refresh', options)).rejects.toMatchObject({ name: 'RateLimitError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a limited refresh does not block vehicle state reads or an unrelated action', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(429, ratePolicyHeaders()))
      .mockResolvedValueOnce(reply(200))
      .mockResolvedValueOnce(reply(200))
    await expect(request('/vehicles/7/refresh', { method: 'POST' })).rejects.toMatchObject({ name: 'RateLimitError' })
    await expect(request('/vehicles/9/refresh', { method: 'POST' })).rejects.toMatchObject({ name: 'RateLimitError' })
    await expect(request('/vehicles/7/state')).resolves.toMatchObject({ battery_level: 80 })
    await expect(request('/feedback', { method: 'POST' })).resolves.toMatchObject({ battery_level: 80 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('a write backstop does not delay GET reads and never replays the rejected write', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(reply(429, ratePolicyHeaders({ scope: '/*', methods: 'WRITE' })))
      .mockResolvedValueOnce(reply(200))
    await expect(request('/feedback', { method: 'POST' })).rejects.toMatchObject({ name: 'RateLimitError' })
    await expect(request('/vehicles')).resolves.toMatchObject({ battery_level: 80 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('cancels a paced obsolete read before it reaches fetch', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(reply(429, ratePolicyHeaders({ scope: '/vehicles', methods: 'GET' }, { 'Retry-After': '1' })))
      .mockImplementation(async () => reply(200))
    await expect(request('/vehicles')).rejects.toMatchObject({ name: 'RateLimitError' })
    await vi.advanceTimersByTimeAsync(1000)
    await request('/vehicles')
    const controller = new AbortController()
    const queued = request('/vehicles', { signal: controller.signal })
    const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent signal-free reads without consuming a response body twice', async () => {
    fetchMock.mockImplementation(async () => reply(200))
    const results = await Promise.all([request('/vehicles'), request('/vehicles')])
    expect(results).toEqual([
      { battery_level: 80, batteryLevel: 80 }, { battery_level: 80, batteryLevel: 80 },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('explicit resilient writes get zero network retries even when retries were requested', async () => {
    fetchMock.mockRejectedValue(new TypeError('connection interrupted'))
    await expect(resilientFetch('/feedback', { method: 'POST', retries: 5 })).rejects.toThrow('connection interrupted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
