import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { ApiError, getApiBase, resilientFetch, _resetRateLimitCache } from './resilience'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resilientFetch wire error normalization', () => {
  beforeEach(() => {
    _resetRateLimitCache()
  })

  const cases: Array<{ label: string; body: unknown; status: number; message: string; code?: string }> = [
    { label: 'nested subsystem unavailable', body: { error: { code: 'SUBSYSTEM_NOT_CONFIGURED', message: 'schema drift unavailable' } }, status: 503, message: 'schema drift unavailable', code: 'SUBSYSTEM_NOT_CONFIGURED' },
    { label: 'nested server failure', body: { error: { code: 'SCHEMA_DRIFT_FAILED', message: 'comparison failed' } }, status: 500, message: 'comparison failed', code: 'SCHEMA_DRIFT_FAILED' },
    { label: 'flat denial', body: { error: 'forbidden', code: 'RBAC_DENY' }, status: 403, message: 'forbidden', code: 'RBAC_DENY' },
    { label: 'top level code precedence', body: { code: 'TOP_DENY', error: { code: 'NESTED_DENY', message: 'denied' } }, status: 403, message: 'denied', code: 'TOP_DENY' },
    { label: 'invalid top level code with valid nested code', body: { code: 42, error: { code: 'NESTED_DENY', message: 'denied' } }, status: 403, message: 'denied', code: 'NESTED_DENY' },
    { label: 'blank top level code with valid nested code', body: { code: ' ', error: { code: 'NESTED_DENY', message: 'denied' } }, status: 403, message: 'denied', code: 'NESTED_DENY' },
    { label: 'valid message with invalid code', body: { error: { code: {}, message: 'invalid code only' } }, status: 503, message: 'invalid code only' },
    { label: 'blank message with valid code', body: { error: { code: 'BACKEND_FAILURE', message: ' ' } }, status: 503, message: 'HTTP 503', code: 'BACKEND_FAILURE' },
    { label: 'ordinary arbitrary 503', body: { error: 'temporary failure' }, status: 503, message: 'temporary failure' },
  ]
  for (const { label, body, status, message, code } of cases) {
    it(`preserves ${label}`, async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json' },
      }))
      await expect(resilientFetch('/admin/schema-drift', { retries: 0 })).rejects.toMatchObject({
        name: 'ApiError', status, message, code,
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  }

  const invalidBodies: Array<{ label: string; body: unknown }> = [
    { label: 'null body', body: null },
    { label: 'unknown envelope', body: { detail: 'not an error' } },
    { label: 'array body', body: [{ error: 'not an envelope' }] },
    { label: 'string body', body: 'not an envelope' },
    { label: 'number body', body: 42 },
    { label: 'boolean body', body: false },
    { label: 'invalid nested fields', body: { error: { message: 42, code: false } } },
    { label: 'empty nested message', body: { error: { message: '', code: '' } } },
    { label: 'whitespace nested message', body: { error: { message: '  ', code: '  ' } } },
    { label: 'empty flat error', body: { error: '' } },
    { label: 'array error', body: { error: [42], code: false } },
  ]
  for (const { label, body } of invalidBodies) {
    it(`uses HTTP fallback for ${label}`, async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(body), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      }))
      await expect(resilientFetch('/admin/schema-drift', { retries: 0 })).rejects.toMatchObject({
        name: 'ApiError', status: 503, message: 'HTTP 503', code: undefined,
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  }

  it('uses HTTP fallback for malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{', {
      status: 503, headers: { 'Content-Type': 'application/json' },
    }))
    await expect(resilientFetch('/admin/schema-drift', { retries: 0 })).rejects.toMatchObject({
      name: 'ApiError', status: 503, message: 'HTTP 503', code: undefined,
    })
  })

  it('uses meaningful HTTP reason phrase for null JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('null', {
      status: 502, statusText: 'Bad Gateway', headers: { 'Content-Type': 'application/json' },
    }))
    await expect(resilientFetch('/admin/schema-drift', { retries: 0 })).rejects.toMatchObject({
      name: 'ApiError', status: 502, message: 'Bad Gateway', code: undefined,
    })
  })

  for (const [label, text, message] of [
    ['plain text', 'gateway maintenance', 'gateway maintenance'],
    ['empty text', '', 'HTTP 503'],
    ['whitespace text', '  ', 'HTTP 503'],
  ]) {
    it(`preserves ${label} error meaning`, async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(text, {
        status: 503, headers: { 'Content-Type': 'text/plain' },
      }))
      await expect(resilientFetch('/admin/schema-drift', { retries: 0 })).rejects.toMatchObject({
        name: 'ApiError', status: 503, message, code: undefined,
      })
    })
  }

  for (const withSignal of [false, true]) {
    it(`propagates JSON decode AbortError unchanged ${withSignal ? 'with' : 'without'} caller signal`, async () => {
      const aborted = new DOMException('decode cancelled', 'AbortError')
      const response = new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })
      vi.spyOn(response, 'json').mockRejectedValueOnce(aborted)
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)
      const eventSpy = vi.spyOn(document, 'dispatchEvent')
      await expect(resilientFetch('/admin/schema-drift', {
        retries: 2, ...(withSignal ? { signal: new AbortController().signal } : {}),
      })).rejects.toBe(aborted)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(eventSpy).not.toHaveBeenCalled()
    })
  }

  it('preserves original JSON decode AbortError when caller aborts during decoding', async () => {
    const controller = new AbortController()
    const aborted = new DOMException('caller cancelled body decoding', 'AbortError')
    const response = new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })
    vi.spyOn(response, 'json').mockImplementationOnce(async () => {
      controller.abort()
      throw aborted
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)
    await expect(resilientFetch('/admin/schema-drift', {
      signal: controller.signal, retries: 2,
    })).rejects.toBe(aborted)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recognizes nested Tesla token expiry without dispatching session expiry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'TESLA_TOKEN_EXPIRED', message: 'Tesla grant expired' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
    const eventSpy = vi.spyOn(document, 'dispatchEvent')
    await expect(resilientFetch('/vehicles/1', { retries: 0 })).rejects.toMatchObject({
      name: 'TeslaAuthExpiredError', status: 401, code: 'TESLA_TOKEN_EXPIRED', message: 'Tesla grant expired',
    })
    expect(eventSpy.mock.calls.map(([event]) => event.type)).toEqual(['teslasync:tesla-auth-expired'])
  })

  it('retains ordinary nested 401 session expiry behavior', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'SESSION_EXPIRED', message: 'sign in again' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
    const eventSpy = vi.spyOn(document, 'dispatchEvent')
    await expect(resilientFetch('/admin/check', { retries: 0 })).rejects.toMatchObject({
      name: 'ApiError', status: 401, code: 'SESSION_EXPIRED', message: 'sign in again',
    })
    expect(eventSpy.mock.calls.map(([event]) => event.type)).toEqual(['teslasync:session-expired'])
  })

  it('retains nested circuit breaker metadata and typed waiting error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'UPSTREAM_BREAKER_OPEN', message: 'upstream cooling down' }, upstream: 'fleet',
    }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '17' } }))
    const eventSpy = vi.spyOn(document, 'dispatchEvent')
    await expect(resilientFetch('/vehicles/1', { retries: 0 })).rejects.toMatchObject({
      name: 'UpstreamUnavailableError', status: 503, code: 'UPSTREAM_BREAKER_OPEN',
      message: 'upstream cooling down', upstream: 'fleet', retryAfterSec: 17,
    })
    expect(eventSpy.mock.calls.map(([event]) => [event.type, (event as CustomEvent).detail])).toEqual([
      ['teslasync:upstream-down', { upstream: 'fleet', retryAfterSec: 17 }],
    ])
  })
})

describe('ApiError', () => {
  it('creates error with status', () => {
    const err = new ApiError('test error', 404)
    expect(err.status).toBe(404)
    expect(err.message).toBe('test error')
    expect(err.name).toBe('ApiError')
  })

  describe('getApiBase', () => {
    it('reads the CSP-safe Nginx meta configuration before the legacy window value', () => {
      const meta = document.createElement('meta')
      meta.name = 'teslasync-api-base'
      meta.content = 'https://api.example.test///'
      document.head.appendChild(meta)
      const previous = window.__TESLASYNC_API_BASE__
      window.__TESLASYNC_API_BASE__ = 'https://legacy.example.test'

      expect(getApiBase()).toBe('https://api.example.test')

      meta.remove()
      window.__TESLASYNC_API_BASE__ = previous
    })
  })

  describe('resilientFetch accepted statuses', () => {
    it('parses an explicitly accepted 503 health snapshot as data', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'degraded',
            database_pool: { acquired_conns: 2 },
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

      const result = await resilientFetch<Record<string, unknown>>(
        '/system/health',
        {
          retries: 0,
          acceptedStatuses: [503],
        },
      )

      expect(result.status).toBe('degraded')
      expect(result.databasePool).toEqual({
        acquired_conns: 2,
        acquiredConns: 2,
      })
    })
  })

  it('stores various status codes', () => {
    expect(new ApiError('', 500).status).toBe(500)
    expect(new ApiError('', 502).status).toBe(502)
    expect(new ApiError('', 400).status).toBe(400)
    expect(new ApiError('', 408).status).toBe(408)
  })

  it('extends Error', () => {
    const err = new ApiError('msg', 500)
    expect(err).toBeInstanceOf(Error)
  })
})
