import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetDocumentCancellationForTests } from '../lib/documentCancellation'
import { documentLifecycleDriver } from '../test/documentLifecycle'


const resilientFetchMock = vi.fn()

vi.mock('../lib/resilience', async () => {
  const actual: typeof import('../lib/resilience') = await vi.importActual('../lib/resilience')
  return {
    ...actual,
    resilientFetch: (path: string, options: RequestInit) => resilientFetchMock(path, options),
  }
})

import {
  request,
  apiUrl,
  registerActionConfirmationProvider,
  __resetActionConfirmationForTests,
  ActionCanceledError,
  ApiError,
  getApiBase,
  isApiError,
} from './client'

let fetchMock: ReturnType<typeof vi.spyOn>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

function headersOf(callIndex: number): Headers {
  const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit]
  return new Headers(init.headers)
}

function urlOf(callIndex: number): string {
  return fetchMock.mock.calls[callIndex][0] as string
}

beforeEach(() => {
  __resetDocumentCancellationForTests()
  __resetActionConfirmationForTests()
  resilientFetchMock.mockReset()
  fetchMock = vi.spyOn(globalThis, 'fetch')
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  __resetDocumentCancellationForTests()
  __resetActionConfirmationForTests()
  vi.restoreAllMocks()
})

describe('request — late document starts', () => {
  it('rejects a new direct read after document unload without entering fetch or retry', async () => {
    const lifecycle = documentLifecycleDriver()
    fetchMock.mockImplementation(async () => jsonResponse({ id: 7 }))
    await request('/vehicles')
    lifecycle('beforeunload')
    await expect(request('/vehicles')).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

  it('preserves the exact caller signal and resumes reads after cancelled navigation', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const lifecycle = documentLifecycleDriver()
    fetchMock.mockImplementation(async () => jsonResponse({ id: 7 }))
    await request('/vehicles', { signal: caller.signal })
    const prevent = (event: Event) => event.preventDefault()
    window.addEventListener('beforeunload', prevent)
    try {
      lifecycle('beforeunload')
      await expect(request('/vehicles', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' })
      await vi.runAllTimersAsync()
      await expect(request('/vehicles', { signal: caller.signal })).resolves.toEqual({ id: 7 })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      for (const call of fetchMock.mock.calls) expect(call[1]).toHaveProperty('signal', caller.signal)
      expect(caller.signal.aborted).toBe(false)
      expect(resilientFetchMock).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('beforeunload', prevent)
      vi.useRealTimers()
    }
  })
})

describe('module constants + re-exports', () => {

  it('re-exports ApiError / getApiBase / isApiError as working utilities', () => {
    expect(typeof getApiBase()).toBe('string')
    const apiErr = new ApiError('boom', 500, 'INTERNAL')
    expect(isApiError(apiErr)).toBe(true)
    expect(apiErr.status).toBe(500)
    expect(apiErr.code).toBe('INTERNAL')
    expect(isApiError(new Error('plain'))).toBe(false)
  })
})

describe('apiUrl()', () => {
  it('prefixes /api/v1 and adds a leading slash when missing', () => {
    const base = getApiBase()
    expect(apiUrl('/vehicles')).toBe(`${base}/api/v1/vehicles`)
    expect(apiUrl('vehicles')).toBe(`${base}/api/v1/vehicles`)
  })

  it('strips a stray /api/v1 prefix so it is never doubled', () => {
    const base = getApiBase()
    expect(apiUrl('/api/v1/vehicles')).toBe(`${base}/api/v1/vehicles`)
  })
})

describe('ActionCanceledError', () => {
  it('is an Error subclass with a stable name and default message', () => {
    const err = new ActionCanceledError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ActionCanceledError')
    expect(err.message).toMatch(/cancelled/i)
  })

  it('accepts a custom message', () => {
    expect(new ActionCanceledError('nope').message).toBe('nope')
  })
})

describe('request() — success paths', () => {
  it('blocks live-only mutations before the network in historical mode', async () => {
    window.history.replaceState(
      null,
      '',
      '/commands?as_of=2026-01-02T03%3A04%3A05Z',
    )

    await expect(
      request('/vehicles/1/command', {
        method: 'POST',
        requiresLiveMode: true,
      }),
    ).rejects.toMatchObject({
      name: 'OperationalModeWriteError',
      mode: 'as_of',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

  it('does not forward the live-mode policy marker to fetch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await request('/vehicles/1/command', {
      method: 'POST',
      requiresLiveMode: true,
    })

    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('requiresLiveMode')
  })

  it('transforms snake_case JSON to expose both snake and camel keys', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ display_name: 'Model 3', battery_level: 80 }))

    const res = await request<Record<string, unknown>>('/vehicles/1/state')

    expect(res.display_name).toBe('Model 3')
    expect(res.displayName).toBe('Model 3')
    expect(res.batteryLevel).toBe(80)
  })

  it('transforms arrays element-by-element', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ session_id: 1 }, { session_id: 2 }]))

    const rows = await request<Array<Record<string, unknown>>>('/charging')

    expect(rows).toHaveLength(2)
    expect(rows[0].sessionId).toBe(1)
    expect(rows[1].sessionId).toBe(2)
  })

  it('returns undefined for a 204 No Content response', async () => {
    registerActionConfirmationProvider(async () => {})
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const res = await request('/vehicles/1', { method: 'DELETE' })

    expect(res).toBeUndefined()
  })

  it('returns the raw body untransformed for responseType: text', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('v1.2.3'))

    const res = await request<string>('/system/version', { responseType: 'text' })

    expect(res).toBe('v1.2.3')
  })

  it('normalises a stray /api/v1 prefix through to the fetched URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await request('/api/v1/vehicles', { method: 'GET' })

    expect(urlOf(0)).toBe(`${getApiBase()}/api/v1/vehicles`)
  })

  it('returns JSON from an explicitly accepted non-2xx domain status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'degraded', database_pool: { acquired_conns: 4 } }, 503),
    )

    const res = await request<Record<string, unknown>>('/system/health', {
      acceptedStatuses: [503],
    })

    expect(res.status).toBe('degraded')
    expect(res.databasePool).toEqual({ acquired_conns: 4, acquiredConns: 4 })
    expect(resilientFetchMock).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('acceptedStatuses')
  })
})

describe('request() — header construction', () => {
  it('sets Accept and Content-Type when a body is present', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await request('/alerts/rules', { method: 'POST', body: JSON.stringify({ x: 1 }) })

    const h = headersOf(0)
    expect(h.get('Accept')).toBe('application/json')
    expect(h.get('Content-Type')).toBe('application/json')
  })

  it('omits Content-Type on a bodyless GET but keeps Accept', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await request('/vehicles', { method: 'GET' })

    const h = headersOf(0)
    expect(h.get('Accept')).toBe('application/json')
    expect(h.has('Content-Type')).toBe(false)
  })
})

describe('request() — error handling', () => {
  it('throws an ApiError carrying status, message, and structured code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden', code: 'RBAC_DENY' }, 403))

    let caught: unknown
    await request('/admin/wipe', { method: 'POST', skipAuthRefresh: true }).catch((e) => {
      caught = e
    })

    expect(isApiError(caught)).toBe(true)
    expect((caught as ApiError).status).toBe(403)
    expect((caught as ApiError).code).toBe('RBAC_DENY')
    expect((caught as ApiError).message).toBe('forbidden')
  })

  it('falls back to the response text when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('gateway down', 503))

    let caught: unknown
    await request('/x', { skipAuthRefresh: true }).catch((e) => {
      caught = e
    })

    expect((caught as ApiError).status).toBe(503)
    expect((caught as ApiError).message).toBe('gateway down')
  })
})

describe('request() — wire error normalization', () => {
  const transports = [
    { transport: 'direct', skipAuthRefresh: true },
    { transport: 'resilient', skipAuthRefresh: false },
  ]

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('../lib/resilience')>('../lib/resilience')
    resilientFetchMock.mockImplementation(actual.resilientFetch)
  })

  it.each(transports)('preserves nested subsystem message code and status via $transport', async ({ skipAuthRefresh }) => {
    fetchMock.mockImplementation(async () => jsonResponse({
      error: {
        code: 'SUBSYSTEM_NOT_CONFIGURED',
        message: 'schema_drift subsystem not configured on this deployment',
      },
    }, 503))

    await expect(request('/admin/observability/schema-drift', { skipAuthRefresh })).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'SUBSYSTEM_NOT_CONFIGURED',
      message: 'schema_drift subsystem not configured on this deployment',
    })
    expect(fetchMock).toHaveBeenCalledTimes(skipAuthRefresh ? 1 : 2)
  })

  it.each(transports)('preserves nested failure details via $transport', async ({ skipAuthRefresh }) => {
    fetchMock.mockImplementation(async () => jsonResponse({
      error: { code: 'SCHEMA_DRIFT_FAILED', message: 'schema comparison failed' },
    }, 500))

    await expect(request('/admin/observability/schema-drift', { skipAuthRefresh })).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      code: 'SCHEMA_DRIFT_FAILED',
      message: 'schema comparison failed',
    })
  })

  it('preserves a nested error first received by the resilient fallback', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('direct transport unavailable'))
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'SUBSYSTEM_NOT_CONFIGURED', message: 'resilient subsystem unavailable' },
      }, 503))

    await expect(request('/admin/observability/schema-drift')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'SUBSYSTEM_NOT_CONFIGURED',
      message: 'resilient subsystem unavailable',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(transports)('preserves flat error string code and status via $transport', async ({ skipAuthRefresh }) => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'forbidden', code: 'RBAC_DENY' }, 403))

    await expect(request('/admin/observability/schema-drift', { skipAuthRefresh })).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'RBAC_DENY',
      message: 'forbidden',
    })
  })

  const fallbackCases: Array<{ caseName: string; body: unknown }> = [
    { caseName: 'unknown envelope', body: { detail: 'not an error envelope' } },
    { caseName: 'invalid nested fields', body: { error: { message: 42, code: false } } },
    { caseName: 'null body', body: null },
    { caseName: 'array body', body: [{ error: 'not an envelope' }] },
    { caseName: 'string body', body: 'not an envelope' },
    { caseName: 'number body', body: 42 },
    { caseName: 'boolean body', body: false },
    { caseName: 'empty nested message', body: { error: { message: '' } } },
    { caseName: 'whitespace nested message', body: { error: { message: '  ' } } },
    { caseName: 'empty flat error', body: { error: '', code: '' } },
    { caseName: 'array error', body: { error: [42], code: false } },
  ]

  for (const { transport, skipAuthRefresh } of transports) {
    it.each(fallbackCases)(`uses the standard HTTP fallback for $caseName via ${transport}`, async ({ body }) => {
      fetchMock.mockImplementation(async () => jsonResponse(body, 503))

      const error: unknown = await request('/admin/observability/schema-drift', { skipAuthRefresh }).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({
        name: 'ApiError',
        status: 503,
        message: 'HTTP 503',
      })
      expect(error).toHaveProperty('code', undefined)
    })
  }

  it.each(transports)('uses the standard HTTP fallback for malformed JSON via $transport', async ({ skipAuthRefresh }) => {
    fetchMock.mockImplementation(async () => new Response('{', {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(request('/admin/observability/schema-drift', { skipAuthRefresh })).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: 'HTTP 503',
    })
  })

  it('preserves an AbortError raised while decoding an error body', async () => {
    const aborted = new DOMException('cancelled during decode', 'AbortError')
    const response = jsonResponse({ error: 'unused' }, 503)
    vi.spyOn(response, 'json').mockRejectedValueOnce(aborted)
    fetchMock.mockResolvedValueOnce(response)

    await expect(request('/admin/observability/schema-drift')).rejects.toBe(aborted)
    expect(resilientFetchMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  for (const { transport, skipAuthRefresh } of transports) {
    it(`preserves top level code precedence via ${transport}`, async () => {
      fetchMock.mockImplementation(async () => jsonResponse({
        code: 'TOP_LEVEL_DENY',
        error: { code: 'NESTED_DENY', message: 'permission denied' },
      }, 403))
      await expect(request('/admin/check', { skipAuthRefresh })).rejects.toMatchObject({
        name: 'ApiError', status: 403, code: 'TOP_LEVEL_DENY', message: 'permission denied',
      })
    })

    it(`preserves meaningful reason phrase fallback via ${transport}`, async () => {
      fetchMock.mockImplementation(async () => new Response('null', {
        status: 502, statusText: 'Bad Gateway', headers: { 'Content-Type': 'application/json' },
      }))
      await expect(request('/admin/check', { skipAuthRefresh })).rejects.toMatchObject({
        name: 'ApiError', status: 502, message: 'Bad Gateway', code: undefined,
      })
    })

    it(`preserves text error details via ${transport}`, async () => {
      fetchMock.mockImplementation(async () => textResponse('gateway maintenance', 503))
      await expect(request('/admin/check', { skipAuthRefresh })).rejects.toMatchObject({
        name: 'ApiError', status: 503, message: 'gateway maintenance', code: undefined,
      })
    })
  }

  it('propagates a decode AbortError first received by the resilient fallback', async () => {
    const aborted = new DOMException('fallback decode cancelled', 'AbortError')
    const response = jsonResponse({ error: 'unused' }, 503)
    vi.spyOn(response, 'json').mockRejectedValueOnce(aborted)
    fetchMock
      .mockRejectedValueOnce(new Error('direct transport unavailable'))
      .mockResolvedValueOnce(response)
    const eventSpy = vi.spyOn(document, 'dispatchEvent')

    await expect(request('/admin/observability/schema-drift')).rejects.toBe(aborted)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(resilientFetchMock).toHaveBeenCalledTimes(1)
    expect(eventSpy).not.toHaveBeenCalled()
  })

  it('keeps caller headers and cancellation options through a nested-error fallback', async () => {
    const controller = new AbortController()
    const headers = new Headers({ 'X-Test-Scope': 'original' })
    fetchMock.mockImplementation(async () => jsonResponse({
      error: { code: 'SCHEMA_DRIFT_FAILED', message: 'comparison failed' },
    }, 500))

    await expect(request('/admin/observability/schema-drift', {
      signal: controller.signal, headers,
    })).rejects.toMatchObject({
      name: 'ApiError', status: 500, code: 'SCHEMA_DRIFT_FAILED', message: 'comparison failed',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(resilientFetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal })
    expect(headers.get('X-Sudo-Token')).toBeNull()
    for (const index of [0, 1]) {
      expect(headersOf(index).get('X-Test-Scope')).toBe('original')
      expect(headersOf(index).get('X-Sudo-Token')).toBeNull()
    }
    expect(fetchMock.mock.calls[0][1]).toHaveProperty('signal', controller.signal)
    expect(fetchMock.mock.calls[1][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('request() — resilient fall-through', () => {
  it.each([
    { status: 404, code: 'NOT_FOUND', message: 'web push is not configured' },
    { status: 501, code: 'AUTH_MODE_OPEN', message: 'requires forward-auth mode' },
  ])('returns a terminal $status response without a duplicate request', async ({ status, code, message }) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: message, code }, status))

    await expect(request('/optional-feature')).rejects.toMatchObject({
      name: 'ApiError', status, code, message,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

  it('forwards accepted domain statuses to the resilient fallback', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network transition'))
    resilientFetchMock.mockResolvedValueOnce({ status: 'degraded' })

    await request('/system/health', { acceptedStatuses: [503] })

    expect(resilientFetchMock.mock.calls[0][1]).toMatchObject({
      acceptedStatuses: [503],
    })
  })

  it('does NOT fall through when skipAuthRefresh is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'gone' }, 410))

    await expect(request('/x', { skipAuthRefresh: true })).rejects.toThrow(/gone/i)
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

  it('does NOT fall through for responseType: text errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 422))

    await expect(request('/x', { responseType: 'text' })).rejects.toThrow(/nope/i)
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

  it('does not touch resilientFetch when the first attempt succeeds', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    const res = await request<{ ok: boolean }>('/healthz')

    expect(res).toEqual({ ok: true })
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })
})

describe('request() — caller cancellation', () => {
  it('propagates an AbortError and never enters the resilient pipeline or the dialog', async () => {
    const controller = new AbortController()
    controller.abort()
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))

    const provider = vi.fn()
    registerActionConfirmationProvider(provider)

    let caught: unknown
    await request('/vehicles', { signal: controller.signal }).catch((e) => {
      caught = e
    })

    expect((caught as { name?: string }).name).toBe('AbortError')
    expect(resilientFetchMock).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })
})
