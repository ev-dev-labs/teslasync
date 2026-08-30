import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  delete (window as { __TESLASYNC_REAUTH_URL__?: string }).__TESLASYNC_REAUTH_URL__
})

afterEach(() => {
  vi.doUnmock('@/sw/purgeApiCache')
  vi.doUnmock('@/lib/broadcast')
  vi.resetModules()
})

describe('navigateToReauth — identity transition', () => {
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
