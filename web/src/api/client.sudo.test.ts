import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Phase-46 / Prompt 31 — request() interceptor for SUDO_REQUIRED.
 *
 * Coverage:
 *   • 401+SUDO_REQUIRED triggers the registered challenge provider,
 *     replays the original request with X-Sudo-Token, and returns
 *     the second response body.
 *   • Cached token from a prior reauth is attached on subsequent
 *     calls without re-prompting.
 *   • An expired cached token (expiresAtMs in the past) is dropped
 *     and the next call re-prompts.
 *   • User cancel rejects with SudoCanceledError; original request
 *     never replays.
 *   • Open-mode SudoCredential ({ mode: 'open' }) replays the
 *     request WITHOUT setting X-Sudo-Token (the route's RequireSudo
 *     middleware is a passthrough in that mode).
 *   • Non-SUDO 401s fall through to resilientFetch (which owns the
 *     auto-refresh and circuit-breaker policies).
 *   • Unrelated errors propagate from directRequest and trigger the
 *     resilientFetch fallback for retries.
 */

const resilientFetchMock = vi.fn()

vi.mock('../lib/resilience', async () => {
  const actual: typeof import('../lib/resilience') = await vi.importActual('../lib/resilience')
  return {
    ...actual,
    resilientFetch: (path: string, options: RequestInit) =>
      resilientFetchMock(path, options),
  }
})

import {
  request,
  registerSudoChallengeProvider,
  setCachedSudoToken,
  __resetSudoStateForTests,
  SudoCanceledError,
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

function sudoRequiredResponse(): Response {
  return jsonResponse({ error: 'step-up reauth required', code: 'SUDO_REQUIRED' }, 401)
}

beforeEach(() => {
  __resetSudoStateForTests()
  resilientFetchMock.mockReset()
  fetchMock = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  __resetSudoStateForTests()
  vi.restoreAllMocks()
})

describe('request() — SUDO_REQUIRED interceptor', () => {
  it('opens the dialog, mints a token, and replays with X-Sudo-Token', async () => {
    fetchMock
      .mockResolvedValueOnce(sudoRequiredResponse()) // attempt 1: gated
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // attempt 2: success

    const provider: SudoChallengeProvider = vi.fn(async () =>
      ({
        mode: 'session',
        token: 'mint-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }) as SudoCredential,
    )
    registerSudoChallengeProvider(provider)

    const result = await request<{ ok: boolean }>('/api-keys/42', { method: 'DELETE' })

    expect(result).toEqual({ ok: true })
    expect(provider).toHaveBeenCalledWith('/api-keys/42')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Inspect the replay headers.
    const [, replayInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const replayHeaders = new Headers(replayInit.headers)
    expect(replayHeaders.get('X-Sudo-Token')).toBe('mint-1')
  })

  it('reuses a cached token on the second rapid call without re-prompting', async () => {
    setCachedSudoToken({
      token: 'cached-XYZ',
      expiresAtMs: Date.now() + 60_000,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const provider = vi.fn()
    registerSudoChallengeProvider(provider as unknown as SudoChallengeProvider)

    const result = await request<{ ok: boolean }>('/data-repair/charging/9', {
      method: 'DELETE',
    })

    expect(result).toEqual({ ok: true })
    expect(provider).not.toHaveBeenCalled()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('X-Sudo-Token')).toBe('cached-XYZ')
  })

  it('drops an expired cached token and re-prompts', async () => {
    setCachedSudoToken({
      token: 'stale',
      expiresAtMs: Date.now() - 1000, // already expired
    })

    fetchMock
      .mockResolvedValueOnce(sudoRequiredResponse()) // attempt 1 (no token attached)
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // attempt 2 with fresh token

    const provider: SudoChallengeProvider = vi.fn(async () =>
      ({
        mode: 'session',
        token: 'fresh',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }) as SudoCredential,
    )
    registerSudoChallengeProvider(provider)

    await request<{ ok: boolean }>('/api-keys/1', { method: 'DELETE' })

    expect(provider).toHaveBeenCalledTimes(1)
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(firstInit.headers).has('X-Sudo-Token')).toBe(false)
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new Headers(secondInit.headers).get('X-Sudo-Token')).toBe('fresh')
  })

  it('rejects with SudoCanceledError when the user cancels the dialog', async () => {
    fetchMock.mockResolvedValueOnce(sudoRequiredResponse())

    const provider: SudoChallengeProvider = vi.fn(async () => {
      throw new SudoCanceledError()
    })
    registerSudoChallengeProvider(provider)

    await expect(request('/api-keys/1', { method: 'DELETE' })).rejects.toBeInstanceOf(
      SudoCanceledError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1) // never replayed
  })

  it('rejects with SudoCanceledError when no provider is registered', async () => {
    fetchMock.mockResolvedValueOnce(sudoRequiredResponse())
    // no registerSudoChallengeProvider() call

    await expect(request('/x', { method: 'POST' })).rejects.toBeInstanceOf(
      SudoCanceledError,
    )
  })

  it('open-mode credential replays without an X-Sudo-Token header', async () => {
    fetchMock
      .mockResolvedValueOnce(sudoRequiredResponse())
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const provider: SudoChallengeProvider = vi.fn(async () =>
      ({ mode: 'open' }) as SudoCredential,
    )
    registerSudoChallengeProvider(provider)

    await request('/x', { method: 'POST' })

    const [, replayInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new Headers(replayInit.headers).has('X-Sudo-Token')).toBe(false)
  })

  it('non-sudo 401 falls through to resilientFetch', async () => {
    // First attempt: a 401 that is NOT SUDO_REQUIRED. The interceptor
    // should not open the dialog and should hand the call off to the
    // resilient pipeline for the auto-refresh + retry policy.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'expired', code: 'TOKEN_EXPIRED' }, 401),
    )
    resilientFetchMock.mockResolvedValueOnce({ ok: true })

    const provider = vi.fn()
    registerSudoChallengeProvider(provider as unknown as SudoChallengeProvider)

    const result = await request<{ ok: boolean }>('/x', { method: 'GET' })
    expect(result).toEqual({ ok: true })
    expect(provider).not.toHaveBeenCalled()
    expect(resilientFetchMock).toHaveBeenCalledTimes(1)
    expect(resilientFetchMock.mock.calls[0][0]).toBe('/x')
  })

  it('5xx errors fall through to resilientFetch for retry', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'upstream broke' }, 502),
    )
    resilientFetchMock.mockResolvedValueOnce({ recovered: true })

    const result = await request<{ recovered: boolean }>('/x', { method: 'GET' })
    expect(result).toEqual({ recovered: true })
    expect(resilientFetchMock).toHaveBeenCalledTimes(1)
  })

  it('skipAuthRefresh callers do NOT fall through to resilientFetch on non-sudo errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'gone' }, 410))

    await expect(
      request('/x', { method: 'GET', skipAuthRefresh: true }),
    ).rejects.toThrow(/gone/i)
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

  it('text response type bypasses resilientFetch on non-sudo errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 422))

    await expect(
      request('/x', { method: 'GET', responseType: 'text' }),
    ).rejects.toThrow(/nope/i)
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })

  it('successful first attempt does not invoke resilientFetch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    const result = await request<{ ok: boolean }>('/healthz', { method: 'GET' })
    expect(result).toEqual({ ok: true })
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })
})
