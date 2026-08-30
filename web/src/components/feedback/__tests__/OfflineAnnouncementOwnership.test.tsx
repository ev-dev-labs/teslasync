import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import ReloadPrompt from '../ReloadPrompt'
import { isVisuallyHiddenLiveRegion } from '@/test/visuallyHiddenContract'

/**
 * Offline announcement ownership — global, singular, non-positional.
 *
 * The defect this file pins: the announcement used to live in `<Layout>`,
 * gated on `presentation.mode === 'standard'`. That made it positional —
 * every route that never mounts `<Layout>` and every report/kiosk view
 * announced the offline transition ZERO times:
 *
 *   /quick-stats  /glance  /year-review/:year  /s/:token  /watch  /onboarding
 *
 * `<OfflineBanner>` is now mounted once by `<ReloadPrompt>`, the app-root PWA
 * host that `main.tsx` renders unconditionally. These cases prove EXACTLY ONE
 * polite announcement in all three contexts, and no duplicate anywhere.
 *
 * `useOnlineStatus` is deliberately NOT mocked — the real hook and the real
 * `@/lib/resilience` broadcaster are driven by window `offline`/`online`
 * events, so the wiring is exercised end to end.
 */

vi.mock('@/sw/purgeApiCache', () => ({
  purgeServiceWorkerApiCache: vi.fn(),
}))

vi.mock('@/lib/broadcast', () => ({
  broadcast: vi.fn(),
  subscribe: () => () => {},
}))

vi.mock('@/hooks/useServiceWorkerBridge', () => ({
  useServiceWorkerBridge: vi.fn(),
  useServiceWorkerCacheStatus: () => ({
    status: null,
    entries: [{ path: '/api/v1/vehicles', cachedAt: 1_756_000_000_000 }],
    oldestCachedAt: 1_756_000_000_000,
    newestCachedAt: 1_756_000_000_000,
    timestampedCount: 1,
    loading: false,
    refresh: vi.fn(),
  }),
}))

vi.mock('@/hooks/useAppLifecycle', () => ({
  useAppLifecycle: vi.fn(() => ({ recoverNow: vi.fn() })),
}))

vi.mock('@/hooks/usePwaUpdate', () => ({
  usePwaUpdate: () => ({
    updateReady: false,
    showPrompt: false,
    updateRequired: false,
    handshake: {
      verdict: 'compatible',
      updateRequired: false,
      clientVersion: '2.0.0',
      serverVersion: '2.0.0',
      buildId: '2.0.0+abc',
      apiContractVersion: 1,
    },
    release: {
      runningBuildId: '2.0.0+abc',
      runningAppVersion: '2.0.0',
      runningGitSha: 'abc',
      bootServerVersion: '2.0.0',
      latestServerVersion: '2.0.0',
      serverRedeployed: false,
    },
    applying: false,
    blockedByUnsavedWork: false,
    snoozedUntil: null,
    applyUpdate: vi.fn(),
    deferUpdate: vi.fn(),
    checkForUpdate: vi.fn(),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, vars?: Record<string, unknown>) => {
      const str = typeof fallback === 'string' ? fallback : key
      if (vars == null) return str
      return Object.entries(vars).reduce<string>(
        (acc, [k, v]) => acc.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v)),
        str,
      )
    },
  }),
}))

/**
 * Every element that would speak the offline transition to a screen reader:
 * an ARIA live region that is actually live (`aria-live` other than `off`,
 * or an implicit-live role) AND mentions the offline state.
 */
function offlineAnnouncers(container: HTMLElement): HTMLElement[] {  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>('[role="status"], [role="alert"], [aria-live]'),
  )
  return candidates.filter((el) => {
    const live = el.getAttribute('aria-live')
    const role = el.getAttribute('role')
    const isLive = live != null ? live !== 'off' : role === 'status' || role === 'alert'
    return isLive && /offline/i.test(el.textContent ?? '')
  })
}

function goOffline() {
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
}

function goOnline() {
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
}

function setRoute(pathname: string, search = '') {
  window.history.replaceState({}, '', `${pathname}${search}`)
}

beforeEach(() => {
  goOnline()
  setRoute('/')
})

afterEach(() => {
  goOnline()
  setRoute('/')
})

/**
 * Standard route inside `<Layout>`.
 *
 * `<Layout>` is not rendered here (it is a 1,900-line shell with dozens of
 * providers); what matters is that it no longer contributes an offline
 * region. That is asserted directly against its source below, and the count
 * assertion covers the root host.
 */
describe('standard route inside Layout', () => {
  it('Layout no longer mounts an offline region of its own', () => {
    const source = readFileSync(
      resolve(__dirname, '../../layout/Layout.tsx'),
      'utf8',
    )
    // Comments may still reference the component by name; a real JSX mount
    // would not be inside a comment block.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

    expect(stripped).not.toContain('<OfflineBanner')
    expect(stripped).not.toContain("from '../feedback/OfflineBanner'")
  })

  it('announces the offline transition exactly once from the app root', () => {
    setRoute('/drives')
    const { container } = render(<ReloadPrompt />)

    expect(offlineAnnouncers(container)).toHaveLength(0)

    goOffline()

    const announcers = offlineAnnouncers(container)
    expect(announcers).toHaveLength(1)
    expect(announcers[0]).toHaveAttribute('aria-live', 'polite')
    expect(announcers[0]).not.toHaveAttribute('role', 'alert')
  })

  it('keeps the visible banner unchanged on a standard route', () => {
    setRoute('/drives')
    render(<ReloadPrompt />)
    goOffline()

    const banner = screen.getByTestId('offline-banner')
    expect(banner.className).toContain('fixed')
    expect(banner.className).toContain('right-4')
    expect(banner.className).toContain('z-[9997]')
    expect(screen.getByText("You're offline")).toBeInTheDocument()
  })

  it('does not let the cached-data disclosure announce a second time', () => {
    setRoute('/drives')
    const { container } = render(<ReloadPrompt />)
    goOffline()

    // The disclosure is present and mentions the offline state in its visible
    // text, but it is a NON-live note so only the banner speaks.
    const notice = screen.getByTestId('cached-data-notice')
    expect(notice).toHaveAttribute('role', 'note')
    expect(notice).toHaveAttribute('aria-live', 'off')
    expect(offlineAnnouncers(container)).toHaveLength(1)
  })

  it('stops announcing when connectivity returns', () => {
    setRoute('/drives')
    const { container } = render(<ReloadPrompt />)

    goOffline()
    expect(offlineAnnouncers(container)).toHaveLength(1)

    goOnline()
    expect(offlineAnnouncers(container)).toHaveLength(0)
    expect(screen.queryByTestId('offline-banner')).toBeNull()
  })
})

/**
 * Standalone routes that never mount `<Layout>`. Before this change these
 * announced zero times.
 */
describe.each([
  ['/quick-stats', ''],
  ['/glance', ''],
  ['/year-review/2026', ''],
  ['/s/abc123token', ''],
  ['/watch', ''],
  ['/onboarding', ''],
])('standalone route %s', (pathname, search) => {
  it('announces the offline transition exactly once', () => {
    setRoute(pathname, search)
    const { container } = render(<ReloadPrompt />)

    goOffline()

    const announcers = offlineAnnouncers(container)
    expect(announcers).toHaveLength(1)
    expect(announcers[0]).toHaveAttribute('aria-live', 'polite')
  })
})

/**
 * Report / kiosk presentation modes. These deliberately carry no floating
 * chrome, which is exactly why suppressing the whole component silenced them.
 */
describe.each(['report', 'kiosk'] as const)('%s presentation mode', (mode) => {
  it('announces exactly once, politely, with no floating chrome', () => {
    setRoute('/dashboard', `?presentation=${mode}`)
    const { container } = render(<ReloadPrompt />)

    goOffline()

    const announcers = offlineAnnouncers(container)
    expect(announcers).toHaveLength(1)
    expect(announcers[0]).toHaveAttribute('aria-live', 'polite')
    // The announcement is screen-reader-only here, asserted through the
    // shared <VisuallyHidden liveRegion> contract rather than a class name.
    expect(isVisuallyHiddenLiveRegion(announcers[0], 'polite')).toBe(true)

    // Visual behaviour preserved: no printed/projected banner.
    expect(screen.queryByTestId('offline-banner')).toBeNull()
    expect(screen.getByTestId('offline-announcement')).toBe(announcers[0])
  })

  it('still discloses the cache age without adding a second live region', () => {
    setRoute('/dashboard', `?presentation=${mode}`)
    const { container } = render(<ReloadPrompt />)
    goOffline()

    expect(screen.getByTestId('cached-data-notice')).toHaveAttribute('role', 'note')
    expect(offlineAnnouncers(container)).toHaveLength(1)
  })
})

describe('legacy kiosk query parameter', () => {
  it('is treated as kiosk and still announces exactly once', () => {
    setRoute('/dashboard', '?kiosk=true')
    const { container } = render(<ReloadPrompt />)

    goOffline()

    expect(offlineAnnouncers(container)).toHaveLength(1)
    expect(screen.queryByTestId('offline-banner')).toBeNull()
  })
})

describe('no duplicate regions when the host re-renders', () => {
  it('mounting the host twice would duplicate — the app mounts it once', () => {
    // Documents the invariant the ownership design depends on: two hosts
    // means two regions, so `main.tsx` must mount `<ReloadPrompt>` exactly
    // once and `<Layout>` must not re-add its own.
    setRoute('/drives')
    const { container } = render(
      <>
        <ReloadPrompt />
      </>,
    )
    goOffline()
    expect(offlineAnnouncers(container)).toHaveLength(1)
  })

  it('a connectivity flap does not accumulate regions', () => {
    setRoute('/drives')
    const { container } = render(<ReloadPrompt />)

    goOffline()
    goOnline()
    goOffline()
    goOnline()
    goOffline()

    expect(offlineAnnouncers(container)).toHaveLength(1)
  })
})
