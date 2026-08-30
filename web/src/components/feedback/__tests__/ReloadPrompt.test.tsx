import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import ReloadPrompt from '../ReloadPrompt'

/**
 * Application-root PWA host.
 *
 * Two review findings are pinned here:
 *
 *  - HIGH: the `auth.logout` broadcast funnel must purge the cached API reads
 *    in every sibling tab, not just in the tab that navigated.
 *  - a11y: the offline wrapper must not carry an `aria-label` on a roleless
 *    <div> (ignored by assistive technology), and must not introduce a second
 *    live region competing with `<OfflineBanner>`.
 */

const purgeMock = vi.hoisted(() => vi.fn())
const bus = vi.hoisted(() => ({
  handler: undefined as ((msg: unknown) => void) | undefined,
  unsubscribe: vi.fn(),
}))
const state = vi.hoisted(() => ({ online: false }))

vi.mock('@/sw/purgeApiCache', () => ({
  purgeServiceWorkerApiCache: purgeMock,
}))

vi.mock('@/lib/broadcast', () => ({
  broadcast: vi.fn(),
  subscribe: (handler: (msg: unknown) => void) => {
    bus.handler = handler
    return bus.unsubscribe
  },
}))

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => state.online,
}))

vi.mock('@/hooks/useServiceWorkerBridge', () => ({
  useServiceWorkerBridge: vi.fn(),
  useServiceWorkerCacheStatus: () => ({
    status: null,
    entries: [],
    oldestCachedAt: null,
    newestCachedAt: null,
    timestampedCount: 0,
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
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}))

beforeEach(() => {
  purgeMock.mockClear()
  bus.unsubscribe.mockClear()
  bus.handler = undefined
  state.online = false
})

describe('auth.logout broadcast funnel', () => {
  it('purges the cached API reads when a sibling tab signs out', () => {
    render(<ReloadPrompt />)
    expect(purgeMock).not.toHaveBeenCalled()

    bus.handler?.({ type: 'auth.logout' })

    expect(purgeMock).toHaveBeenCalledTimes(1)
  })

  it('ignores unrelated bus traffic', () => {
    render(<ReloadPrompt />)

    bus.handler?.({ type: 'theme.changed', themeId: 'neon-cyan', modeId: 'dark' })
    bus.handler?.({ type: 'install.dismissed' })
    bus.handler?.({ type: 'queryInvalidate', keys: [['vehicles']] })

    expect(purgeMock).not.toHaveBeenCalled()
  })

  it('purges on every logout message, because the purge is idempotent', () => {
    render(<ReloadPrompt />)

    bus.handler?.({ type: 'auth.logout' })
    bus.handler?.({ type: 'auth.logout' })

    expect(purgeMock).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes from the bus on unmount', () => {
    const { unmount } = render(<ReloadPrompt />)
    expect(bus.unsubscribe).not.toHaveBeenCalled()

    unmount()

    expect(bus.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('listens even while online — a sign-out is not an offline-only event', () => {
    state.online = true
    render(<ReloadPrompt />)

    bus.handler?.({ type: 'auth.logout' })

    expect(purgeMock).toHaveBeenCalledTimes(1)
  })
})

describe('offline disclosure accessibility', () => {
  it('renders the disclosure only while offline', () => {
    state.online = true
    render(<ReloadPrompt />)
    expect(screen.queryByTestId('pwa-offline-disclosure')).not.toBeInTheDocument()
  })

  it('uses a bare positioning wrapper with no role and no aria-label', () => {
    render(<ReloadPrompt />)
    const wrapper = screen.getByTestId('pwa-offline-disclosure')

    // An aria-label on a roleless <div> is ignored by assistive technology,
    // and adding a role here would duplicate <OfflineBanner>'s announcement.
    expect(wrapper).not.toHaveAttribute('aria-label')
    expect(wrapper).not.toHaveAttribute('role')
    expect(wrapper).not.toHaveAttribute('aria-live')
  })

  it('delegates semantics to a single non-live note inside the wrapper', () => {
    render(<ReloadPrompt />)
    const notice = screen.getByTestId('cached-data-notice-empty')

    expect(notice).toHaveAttribute('role', 'note')
    expect(notice).toHaveAttribute('aria-live', 'off')
    expect(notice).toHaveTextContent(/offline/i)
  })

  it('creates exactly one ARIA live region for the offline state', () => {
    render(<ReloadPrompt />)

    // `<OfflineBanner>` — now owned by this host rather than by `<Layout>` —
    // is the single announcer. The cached-data disclosure beside it is a
    // non-live note, so the transition is spoken once, not twice.
    const statuses = screen.queryAllByRole('status')
    expect(statuses).toHaveLength(1)
    expect(screen.getByTestId('offline-banner')).toContainElement(statuses[0])
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(screen.queryAllByRole('note')).toHaveLength(1)
  })

  it('mounts the offline announcer regardless of route or presentation mode', () => {
    // Ownership must not be positional: the host is rendered by `main.tsx`
    // for every route, including the six that never mount `<Layout>`.
    render(<ReloadPrompt />)
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()
  })
})
