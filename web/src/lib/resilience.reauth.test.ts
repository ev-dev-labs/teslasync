import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, getServerBaseUrl, setServerConnection } from './serverConnection'

/**
 * Identity-transition purge — direct funnel (`lib/resilience.ts`).
 *
 * HIGH-severity regression guard: `navigateToReauth()` is the single funnel
 * for every sign-out / session-expired / reauth transition
 * (`SessionExpiredModal`, `SessionExpiringModal`, and the 401 handler inside
 * `resilientFetch`). If it navigates without purging, the next person to use
 * the browser is served the previous identity's vehicle list, drives and
 * notification counts straight out of Cache Storage.
 *
 * Ordering matters as much as the call itself: the purge and the broadcast
 * must both happen BEFORE `window.location.assign`, because after that the
 * document is being torn down.
 *
 * `src/test-setup.ts` imports `@/lib/resilience` eagerly (to reset the
 * auth-expired latch), so a static `vi.mock` of its dependencies would be
 * registered too late to bind. Each case therefore resets the registry and
 * re-imports the module under `vi.doMock`.
 */

const ORDER: string[] = []

let purgeMock: ReturnType<typeof vi.fn>
let broadcastMock: ReturnType<typeof vi.fn>
let assignSpy: ReturnType<typeof vi.fn>
let reloadSpy: ReturnType<typeof vi.fn>

async function loadResilience() {
  vi.resetModules()

  purgeMock = vi.fn(() => ORDER.push('purge'))
  broadcastMock = vi.fn(() => ORDER.push('broadcast'))

  vi.doMock('@/sw/purgeApiCache', () => ({
    purgeServiceWorkerApiCache: purgeMock,
    postPurgeApiCacheToServiceWorker: vi.fn(),
    purgeApiCacheStorage: vi.fn(async () => 0),
    isApiReadCacheName: () => false,
    API_CACHE_BUCKET_PREFIX: 'teslasync-api-reads',
  }))
  vi.doMock('@/lib/broadcast', () => ({
    broadcast: broadcastMock,
    subscribe: () => () => {},
    useBroadcast: () => {},
    TAB_ID: 'test-tab',
    __resetBroadcastForTests: () => {},
  }))

  return import('@/lib/resilience')
}

beforeEach(() => {
  ORDER.length = 0
  assignSpy = vi.fn(() => ORDER.push('navigate'))
  reloadSpy = vi.fn(() => ORDER.push('reload'))

  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      href: 'https://teslasync.example/drives/42',
      assign: assignSpy,
      reload: reloadSpy,
    },
  })
  window.sessionStorage.clear()
  window.localStorage.clear()
  delete (window as { __TESLASYNC_REAUTH_URL__?: string }).__TESLASYNC_REAUTH_URL__
})

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.doUnmock('@/sw/purgeApiCache')
  vi.doUnmock('@/lib/broadcast')
  vi.resetModules()
})

describe('navigateToReauth — identity transition', () => {
  it('sends rejected app tokens to the server picker without visiting the browser IdP', async () => {
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    const { navigateToReauth } = await loadResilience()

    navigateToReauth()

    expect(getServerBaseUrl()).toBe('https://srv.example.com')
    expect(getAccessToken()).toBeNull()
    expect(purgeMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock).toHaveBeenCalledWith({ type: 'auth.logout' })
    expect(assignSpy).toHaveBeenCalledWith('/?connect=1')
    expect(ORDER.indexOf('purge')).toBeLessThan(ORDER.indexOf('navigate'))
  })

  it('purges the cached API reads before navigating to the IdP', async () => {
    const { navigateToReauth } = await loadResilience()

    navigateToReauth()

    expect(purgeMock).toHaveBeenCalledTimes(1)
    expect(assignSpy).toHaveBeenCalledTimes(1)
    expect(ORDER.indexOf('purge')).toBeLessThan(ORDER.indexOf('navigate'))
  })

  it('broadcasts auth.logout so sibling tabs purge too', async () => {
    const { navigateToReauth } = await loadResilience()

    navigateToReauth()

    expect(broadcastMock).toHaveBeenCalledWith({ type: 'auth.logout' })
    expect(ORDER.indexOf('broadcast')).toBeLessThan(ORDER.indexOf('navigate'))
  })

  it('still purges when the IdP handoff is disabled and we fall back to reload', async () => {
    const { navigateToReauth } = await loadResilience()
    ;(window as { __TESLASYNC_REAUTH_URL__?: string }).__TESLASYNC_REAUTH_URL__ = ''

    navigateToReauth()

    expect(purgeMock).toHaveBeenCalledTimes(1)
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(ORDER.indexOf('purge')).toBeLessThan(ORDER.indexOf('reload'))
  })

  it('preserves the return URL handoff alongside the purge', async () => {
    const { navigateToReauth } = await loadResilience()

    navigateToReauth()

    expect(window.sessionStorage.getItem('teslasync-return-url')).toBe(
      'https://teslasync.example/drives/42',
    )
    expect(assignSpy.mock.calls[0][0]).toContain(
      `rd=${encodeURIComponent('https://teslasync.example/drives/42')}`,
    )
  })

  it('navigates even when the broadcast bus is unavailable', async () => {
    const { navigateToReauth } = await loadResilience()
    broadcastMock.mockImplementation(() => {
      throw new Error('BroadcastChannel closed')
    })

    expect(() => navigateToReauth()).not.toThrow()
    expect(purgeMock).toHaveBeenCalledTimes(1)
    expect(assignSpy).toHaveBeenCalledTimes(1)
  })

  it('purges on every caller, not just the first — the purge is idempotent', async () => {
    const { navigateToReauth } = await loadResilience()

    navigateToReauth()
    navigateToReauth()

    expect(purgeMock).toHaveBeenCalledTimes(2)
    expect(broadcastMock).toHaveBeenCalledTimes(2)
  })
})

describe('resilientFetch — network failures are not expired sessions', () => {
  it('does not sign out when both the API request and its auth probe cannot connect', async () => {
    const { resilientFetch, getConnectionStatus } = await loadResilience()
    const networkError = new TypeError('Failed to fetch')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(networkError)

    await expect(resilientFetch('/vehicles', { retries: 0 })).rejects.toBe(networkError)
    expect(fetchMock).toHaveBeenCalledTimes(navigator.onLine ? 2 : 1)
    expect(assignSpy).not.toHaveBeenCalled()
    expect(purgeMock).not.toHaveBeenCalled()
    expect(getConnectionStatus()).toBe('offline')
    fetchMock.mockRestore()
  })

  it('redirects to reauthenticate only when the probe detects an auth response', async () => {
    const { resilientFetch } = await loadResilience()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))

    await expect(resilientFetch('/vehicles', { retries: 0 }))
      .rejects.toMatchObject({ status: 401 })
    expect(assignSpy).toHaveBeenCalledTimes(1)
    expect(purgeMock).toHaveBeenCalledTimes(1)
    fetchMock.mockRestore()
  })

  it('does not sign out when the auth probe reaches a failing server', async () => {
    const { resilientFetch } = await loadResilience()
    const networkError = new TypeError('Failed to fetch')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))

    await expect(resilientFetch('/vehicles', { retries: 0 })).rejects.toBe(networkError)
    expect(assignSpy).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })

  it('still recognizes an identity-provider redirect from the manual probe', async () => {
    const { resilientFetch } = await loadResilience()
    const redirect = new Response(null)
    Object.defineProperty(redirect, 'type', { value: 'opaqueredirect' })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(redirect)

    await expect(resilientFetch('/vehicles', { retries: 0 }))
      .rejects.toMatchObject({ status: 401 })
    expect(assignSpy).toHaveBeenCalledTimes(1)
    fetchMock.mockRestore()
  })
})

describe('resilientFetch — GET-only version diagnostic', () => {
  it.each([
    ['401', () => new Response(null, { status: 401 })],
    ['403', () => new Response(null, { status: 403 })],
    ['HTML login page', () => new Response('<title>Sign in</title>', {
      headers: { 'Content-Type': 'text/html' },
    })],
    ['opaque redirect', () => {
      const response = new Response(null)
      Object.defineProperty(response, 'type', { value: 'opaqueredirect' })
      return response
    }],
  ] as const)('uses supported GET to classify %s after an initial network TypeError', async (_label, authResponse) => {
    const { resilientFetch } = await loadResilience()
    const networkError = new TypeError('Failed to fetch')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      if (input === '/api/v1/vehicles') throw networkError
      if (input !== '/api/v1/system/version') throw new Error('Unexpected diagnostic URL')
      if (options?.method !== 'GET') {
        return new Response(null, { status: 405, headers: { Allow: 'GET' } })
      }
      return authResponse()
    })

    try {
      await expect(resilientFetch('/vehicles', { retries: 0 }))
        .rejects.toMatchObject({ status: 401 })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/system/version', {
        method: 'GET',
        redirect: 'manual',
      })
      expect(assignSpy).toHaveBeenCalledTimes(1)
      expect(purgeMock).toHaveBeenCalledTimes(1)
      expect(ORDER.indexOf('purge')).toBeLessThan(ORDER.indexOf('navigate'))
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('retains the initiating request and its TypeError when supported GET returns healthy JSON', async () => {
    const { resilientFetch } = await loadResilience()
    const networkError = new TypeError('Failed to fetch')
    const controller = new AbortController()
    const body = JSON.stringify({ acknowledged: true })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      if (input === '/api/v1/vehicles') throw networkError
      if (input !== '/api/v1/system/version') throw new Error('Unexpected diagnostic URL')
      if (options?.method !== 'GET') {
        return new Response(null, { status: 405, headers: { Allow: 'GET' } })
      }
      return new Response(JSON.stringify({ app_version: 'test' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    try {
      await expect(resilientFetch('/vehicles', {
        retries: 0,
        timeout: 250,
        method: 'POST',
        body,
        headers: { 'X-Diagnostic-Test': 'original' },
        credentials: 'include',
        signal: controller.signal,
      })).rejects.toBe(networkError)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/vehicles', {
        method: 'POST',
        body,
        headers: expect.any(Headers),
        credentials: 'include',
        signal: expect.any(AbortSignal),
      })
      expect(Array.from(new Headers(fetchMock.mock.calls[0][1]?.headers).entries()))
        .toEqual([['x-diagnostic-test', 'original']])
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/system/version', {
        method: 'GET',
        redirect: 'manual',
      })
      expect(controller.signal.aborted).toBe(false)
      expect(assignSpy).not.toHaveBeenCalled()
      expect(purgeMock).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('does not probe or reauthenticate after caller cancellation of an initial TypeError', async () => {
    const { resilientFetch } = await loadResilience()
    const controller = new AbortController()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      controller.abort()
      throw new TypeError('Failed to fetch')
    })

    try {
      await expect(resilientFetch('/vehicles', { retries: 0, signal: controller.signal }))
        .rejects.toMatchObject({ name: 'AbortError' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(assignSpy).not.toHaveBeenCalled()
      expect(purgeMock).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('does not issue a diagnostic request while the browser is offline', async () => {
    const { resilientFetch, getConnectionStatus } = await loadResilience()
    const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    try {
      await expect(resilientFetch('/vehicles', { retries: 0 }))
        .rejects.toMatchObject({ status: 0, message: 'No network connection' })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(getConnectionStatus()).toBe('offline')
      expect(assignSpy).not.toHaveBeenCalled()
      expect(purgeMock).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
      onlineSpy.mockRestore()
    }
  })

  it('keeps timeout aborts distinct from network TypeErrors without a diagnostic request', async () => {
    const { resilientFetch } = await loadResilience()
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, options) => (
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    ))

    try {
      const request = resilientFetch('/vehicles', { retries: 0, timeout: 25 })
      const rejected = expect(request).rejects.toMatchObject({
        status: 408,
        message: 'Request timed out',
      })
      await vi.advanceTimersByTimeAsync(25)
      await rejected
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(assignSpy).not.toHaveBeenCalled()
      expect(purgeMock).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
      vi.useRealTimers()
    }
  })
})
