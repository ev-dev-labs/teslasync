import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Comprehensive coverage for the api/client foundation module.
 *
 * Exercises EVERY export:
 *   • apiUrl()                     — path normalisation + double-prefix strip
 *   • SUDO_REQUIRED_CODE / AUTH_MODE_OPEN_CODE — sentinel constants
 *   • SudoCanceledError            — shape, default + custom message
 *   • registerSudoChallengeProvider — register + unregister lifecycle
 *   • setCachedSudoToken           — attach / clear the in-memory token
 *   • __resetSudoStateForTests     — wipes token + provider
 *   • request<T>()                 — success (json/array/204/text), header
 *     construction, snake→camel transform, error parsing, the SUDO_REQUIRED
 *     interceptor (mint / cached / expired / open-mode / cancel / no-provider /
 *     no-token / provider-throw), resilient fall-through, skipAuthRefresh /
 *     text bypass, and caller-initiated cancellation.
 *   • re-exports ApiError / getApiBase / isApiError
 *
 * resilientFetch is replaced with a spy so we can assert the fall-through
 * boundary without hitting the real retry/circuit-breaker pipeline.
 * globalThis.fetch is spied per-test — no real network is ever touched.
 */

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
  registerSudoChallengeProvider,
  setCachedSudoToken,
  __resetSudoStateForTests,
  SudoCanceledError,
  SUDO_REQUIRED_CODE,
  AUTH_MODE_OPEN_CODE,
  ApiError,
  getApiBase,
  isApiError,
  type SudoChallengeProvider,
  type SudoCredential,
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

function sudoRequiredResponse(): Response {
  return jsonResponse({ error: 'step-up reauth required', code: 'SUDO_REQUIRED' }, 401)
}

function headersOf(callIndex: number): Headers {
  const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit]
  return new Headers(init.headers)
}

function urlOf(callIndex: number): string {
  return fetchMock.mock.calls[callIndex][0] as string
}

beforeEach(() => {
  __resetSudoStateForTests()
  resilientFetchMock.mockReset()
  fetchMock = vi.spyOn(globalThis, 'fetch')
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  __resetSudoStateForTests()
  vi.restoreAllMocks()
})

describe('module constants + re-exports', () => {
  it('exposes the backend sentinel codes verbatim', () => {
    expect(SUDO_REQUIRED_CODE).toBe('SUDO_REQUIRED')
    expect(AUTH_MODE_OPEN_CODE).toBe('AUTH_MODE_OPEN')
  })

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

describe('SudoCanceledError', () => {
  it('is an Error subclass with a stable name and default message', () => {
    const err = new SudoCanceledError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('SudoCanceledError')
    expect(err.message).toMatch(/cancelled/i)
  })

  it('accepts a custom message', () => {
    expect(new SudoCanceledError('nope').message).toBe('nope')
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

  it('replays a nested sudo challenge through the existing auth interceptor', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'SUDO_REQUIRED', message: 'step-up reauth required' },
      }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const provider: SudoChallengeProvider = vi.fn(async (): Promise<SudoCredential> => ({
      mode: 'session',
      token: 'nested-mint',
    }))
    registerSudoChallengeProvider(provider)

    await expect(request('/api-keys/42', { method: 'DELETE' })).resolves.toEqual({ ok: true })
    expect(provider).toHaveBeenCalledWith('/api-keys/42')
    expect(headersOf(1).get('X-Sudo-Token')).toBe('nested-mint')
    expect(resilientFetchMock).not.toHaveBeenCalled()
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

  it('reuses the token minted by a nested sudo challenge', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'SUDO_REQUIRED', message: 'confirm' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ deleted_id: 42 }))
      .mockResolvedValueOnce(jsonResponse({ deleted_id: 43 }))
    const provider = vi.fn(async (): Promise<SudoCredential> => ({ mode: 'session', token: 'nested-cache' }))
    registerSudoChallengeProvider(provider)
    await expect(request('/api-keys/42', { method: 'DELETE' })).resolves.toEqual({ deleted_id: 42, deletedId: 42 })
    await expect(request('/api-keys/43', { method: 'DELETE' })).resolves.toEqual({ deleted_id: 43, deletedId: 43 })
    expect(provider).toHaveBeenCalledTimes(1)
    expect(headersOf(2).get('X-Sudo-Token')).toBe('nested-cache')
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

  it('replays nested open mode challenge without minting a token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'SUDO_REQUIRED', message: 'confirm' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    registerSudoChallengeProvider(vi.fn(async (): Promise<SudoCredential> => ({ mode: 'open' })))
    await expect(request('/api-keys/42', { method: 'DELETE' })).resolves.toEqual({ ok: true })
    expect(headersOf(1).has('X-Sudo-Token')).toBe(false)
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

  it('preserves cancellation of a nested sudo challenge without replay', async () => {
    const cancelled = new SudoCanceledError('nested confirmation cancelled')
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'SUDO_REQUIRED', message: 'confirm' } }, 401))
    registerSudoChallengeProvider(vi.fn(async () => { throw cancelled }))
    await expect(request('/api-keys/42', { method: 'DELETE' })).rejects.toBe(cancelled)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

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

  it('does not challenge or retry again when a nested sudo replay is rejected', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'SUDO_REQUIRED', message: 'confirm' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'RBAC_DENY', message: 'still forbidden' } }, 403))
    const provider = vi.fn(async (): Promise<SudoCredential> => ({ mode: 'session', token: 'one-replay' }))
    registerSudoChallengeProvider(provider)

    await expect(request('/api-keys/42', { method: 'DELETE' })).rejects.toMatchObject({
      name: 'ApiError', status: 403, code: 'RBAC_DENY', message: 'still forbidden',
    })
    expect(provider).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

  it('keeps caller headers and cancellation options through a nested-error fallback', async () => {
    const controller = new AbortController()
    const headers = new Headers({ 'X-Test-Scope': 'original' })
    setCachedSudoToken({ token: 'retained-token', expiresAtMs: Date.now() + 60_000 })
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
      expect(headersOf(index).get('X-Sudo-Token')).toBe('retained-token')
    }
    expect(fetchMock.mock.calls[0][1]).toHaveProperty('signal', controller.signal)
    expect(fetchMock.mock.calls[1][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('request() — resilient fall-through', () => {
  it('routes a non-sudo 5xx JSON failure to resilientFetch with the normalised path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'upstream broke' }, 502))
    resilientFetchMock.mockResolvedValueOnce({ recovered: true })

    const res = await request<{ recovered: boolean }>('/x', { method: 'GET' })

    expect(res).toEqual({ recovered: true })
    expect(resilientFetchMock).toHaveBeenCalledTimes(1)
    expect(resilientFetchMock.mock.calls[0][0]).toBe('/x')
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
    registerSudoChallengeProvider(provider as unknown as SudoChallengeProvider)

    let caught: unknown
    await request('/vehicles', { signal: controller.signal }).catch((e) => {
      caught = e
    })

    expect((caught as { name?: string }).name).toBe('AbortError')
    expect(resilientFetchMock).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })
})

describe('request() — SUDO_REQUIRED interceptor', () => {
  it('opens the dialog, caches the minted token, and replays with X-Sudo-Token', async () => {
    fetchMock
      .mockResolvedValueOnce(sudoRequiredResponse())
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const provider: SudoChallengeProvider = vi.fn(
      async () =>
        ({
          mode: 'session',
          token: 'mint-1',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }) as SudoCredential,
    )
    registerSudoChallengeProvider(provider)

    const res = await request<{ ok: boolean }>('/api-keys/42', { method: 'DELETE' })

    expect(res).toEqual({ ok: true })
    expect(provider).toHaveBeenCalledWith('/api-keys/42')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(headersOf(1).get('X-Sudo-Token')).toBe('mint-1')
  })

  it('reuses a token that was minted without an explicit expiry (default TTL)', async () => {
    fetchMock
      .mockResolvedValueOnce(sudoRequiredResponse())
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const provider = vi.fn(async () => ({ mode: 'session', token: 'mint' }) as SudoCredential)
    registerSudoChallengeProvider(provider)

    await request('/api-keys/1', { method: 'DELETE' })
    await request('/api-keys/2', { method: 'DELETE' })

    expect(provider).toHaveBeenCalledTimes(1)
    expect(headersOf(2).get('X-Sudo-Token')).toBe('mint')
  })

  it('drops an expired cached token and re-prompts', async () => {
    setCachedSudoToken({ token: 'stale', expiresAtMs: Date.now() - 1_000 })
    fetchMock
      .mockResolvedValueOnce(sudoRequiredResponse())
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const provider: SudoChallengeProvider = vi.fn(
      async () =>
        ({
          mode: 'session',
          token: 'fresh',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }) as SudoCredential,
    )
    registerSudoChallengeProvider(provider)

    await request('/api-keys/1', { method: 'DELETE' })

    expect(provider).toHaveBeenCalledTimes(1)
    expect(headersOf(0).has('X-Sudo-Token')).toBe(false)
    expect(headersOf(1).get('X-Sudo-Token')).toBe('fresh')
  })

  it('open-mode credential replays without an X-Sudo-Token header', async () => {
    fetchMock
      .mockResolvedValueOnce(sudoRequiredResponse())
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const provider: SudoChallengeProvider = vi.fn(async () => ({ mode: 'open' }) as SudoCredential)
    registerSudoChallengeProvider(provider)

    await request('/x', { method: 'POST' })

    expect(headersOf(1).has('X-Sudo-Token')).toBe(false)
  })

  it('rejects with SudoCanceledError when the user cancels', async () => {
    fetchMock.mockResolvedValueOnce(sudoRequiredResponse())
    const provider: SudoChallengeProvider = vi.fn(async () => {
      throw new SudoCanceledError()
    })
    registerSudoChallengeProvider(provider)

    await expect(request('/api-keys/1', { method: 'DELETE' })).rejects.toBeInstanceOf(
      SudoCanceledError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects with SudoCanceledError when no provider is registered', async () => {
    fetchMock.mockResolvedValueOnce(sudoRequiredResponse())

    await expect(request('/x', { method: 'POST' })).rejects.toBeInstanceOf(SudoCanceledError)
  })

  it('wraps a non-cancel provider failure as a SudoCanceledError preserving the message', async () => {
    fetchMock.mockResolvedValueOnce(sudoRequiredResponse())
    const provider: SudoChallengeProvider = vi.fn(async () => {
      throw new Error('mint endpoint 500')
    })
    registerSudoChallengeProvider(provider)

    let caught: unknown
    await request('/x', { method: 'POST' }).catch((e) => {
      caught = e
    })

    expect(caught).toBeInstanceOf(SudoCanceledError)
    expect((caught as SudoCanceledError).message).toBe('mint endpoint 500')
  })

  it('rejects with SudoCanceledError when the provider returns no token', async () => {
    fetchMock.mockResolvedValueOnce(sudoRequiredResponse())
    const provider: SudoChallengeProvider = vi.fn(async () => ({ mode: 'session' }) as SudoCredential)
    registerSudoChallengeProvider(provider)

    await expect(request('/x', { method: 'POST' })).rejects.toThrow(/no token/i)
  })
})

describe('sudo token cache management', () => {
  it('attaches a pre-seeded cached token without prompting', async () => {
    setCachedSudoToken({ token: 'cached-XYZ', expiresAtMs: Date.now() + 60_000 })
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const provider = vi.fn()
    registerSudoChallengeProvider(provider as unknown as SudoChallengeProvider)

    await request('/data-repair/charging/9', { method: 'DELETE' })

    expect(provider).not.toHaveBeenCalled()
    expect(headersOf(0).get('X-Sudo-Token')).toBe('cached-XYZ')
  })

  it('clears the token when setCachedSudoToken(null) is called', async () => {
    setCachedSudoToken({ token: 'temp', expiresAtMs: Date.now() + 60_000 })
    setCachedSudoToken(null)
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await request('/vehicles', { method: 'GET' })

    expect(headersOf(0).has('X-Sudo-Token')).toBe(false)
  })

  it('registerSudoChallengeProvider returns an unregister that fails closed', async () => {
    const provider = vi.fn()
    const unregister = registerSudoChallengeProvider(provider as unknown as SudoChallengeProvider)
    expect(typeof unregister).toBe('function')

    unregister()
    fetchMock.mockResolvedValueOnce(sudoRequiredResponse())

    await expect(request('/x', { method: 'POST' })).rejects.toBeInstanceOf(SudoCanceledError)
    expect(provider).not.toHaveBeenCalled()
  })

  it('__resetSudoStateForTests wipes both the token and the provider', async () => {
    setCachedSudoToken({ token: 'live', expiresAtMs: Date.now() + 60_000 })
    registerSudoChallengeProvider(vi.fn() as unknown as SudoChallengeProvider)

    __resetSudoStateForTests()

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // no token attached now
      .mockResolvedValueOnce(sudoRequiredResponse()) // no provider -> cancel

    await request('/vehicles', { method: 'GET' })
    expect(headersOf(0).has('X-Sudo-Token')).toBe(false)

    await expect(request('/x', { method: 'POST' })).rejects.toBeInstanceOf(SudoCanceledError)
  })
})
