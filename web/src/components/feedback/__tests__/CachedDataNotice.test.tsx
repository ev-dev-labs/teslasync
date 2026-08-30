import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { CachedDataNotice } from '../CachedDataNotice'

/**
 * Cached-read disclosure (PWA-02) — honesty and announcement semantics.
 *
 * Two review findings are pinned here:
 *
 *  - the BLANKET disclosure must lead with the OLDEST capture time. A page
 *    renders several cached reads at once; quoting the newest understates how
 *    stale the worst panel on screen is, which is precisely the lie this
 *    component exists to prevent.
 *  - the notice owns its own ARIA semantics. It is either a live region or a
 *    labelled non-live note — never a bare wrapper carrying an `aria-label`
 *    that assistive technology ignores, and never a second live region
 *    competing with `<OfflineBanner>`.
 */

const state = vi.hoisted(() => ({
  online: false,
  oldestCachedAt: null as number | null,
  newestCachedAt: null as number | null,
  timestampedCount: 0,
  entries: [] as Array<{ path: string; cachedAt: number | null }>,
}))

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => state.online,
}))

vi.mock('@/hooks/useServiceWorkerBridge', () => ({
  useServiceWorkerCacheStatus: () => ({
    status: null,
    entries: state.entries,
    oldestCachedAt: state.oldestCachedAt,
    newestCachedAt: state.newestCachedAt,
    timestampedCount: state.timestampedCount,
    loading: false,
    refresh: vi.fn(),
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

const OLDEST = new Date('2026-08-26T09:00:00Z').getTime()
const NEWEST = new Date('2026-08-26T14:00:00Z').getTime()

function setEntries(entries: Array<{ path: string; cachedAt: number | null }>) {
  const stamps = entries
    .map((e) => e.cachedAt)
    .filter((v): v is number => v != null)
  state.entries = entries
  state.timestampedCount = stamps.length
  state.oldestCachedAt = stamps.length === 0 ? null : Math.min(...stamps)
  state.newestCachedAt = stamps.length === 0 ? null : Math.max(...stamps)
}

beforeEach(() => {
  state.online = false
  setEntries([])
})

describe('visibility', () => {
  it('renders nothing while online', () => {
    state.online = true
    setEntries([{ path: '/api/v1/vehicles', cachedAt: NEWEST }])
    const { container } = render(<CachedDataNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders while online when the caller knowingly shows a snapshot', () => {
    state.online = true
    render(<CachedDataNotice cachedAt={NEWEST} alwaysShow />)
    expect(screen.getByTestId('cached-data-notice')).toBeInTheDocument()
  })

  it('says so plainly when offline with nothing cached', () => {
    render(<CachedDataNotice />)
    expect(screen.getByTestId('cached-data-notice-empty')).toHaveTextContent(
      /offline and nothing is cached/i,
    )
  })
})

describe('blanket disclosure uses the OLDEST timestamp', () => {
  it('quotes the oldest entry, not the newest', () => {
    setEntries([
      { path: '/api/v1/vehicles', cachedAt: NEWEST },
      { path: '/api/v1/drives', cachedAt: OLDEST },
    ])

    const notice = render(<CachedDataNotice />).getByTestId('cached-data-notice')

    expect(notice).toHaveAttribute('data-scope', 'blanket')
    expect(notice).toHaveAttribute('data-cached-at', String(OLDEST))
    expect(notice).not.toHaveAttribute('data-cached-at', String(NEWEST))
  })

  it('discloses the full range when entries differ', () => {
    setEntries([
      { path: '/api/v1/vehicles', cachedAt: NEWEST },
      { path: '/api/v1/drives', cachedAt: OLDEST },
    ])

    const notice = render(<CachedDataNotice />).getByTestId('cached-data-notice')

    expect(notice).toHaveTextContent(/captured between/i)
    expect(notice).toHaveAttribute('data-cached-at-newest', String(NEWEST))
  })

  it('does not fabricate a range when every entry shares one timestamp', () => {
    setEntries([
      { path: '/api/v1/vehicles', cachedAt: OLDEST },
      { path: '/api/v1/drives', cachedAt: OLDEST },
    ])

    const notice = render(<CachedDataNotice />).getByTestId('cached-data-notice')

    expect(notice).not.toHaveTextContent(/captured between/i)
    expect(notice).toHaveAttribute('data-cached-at-newest', '')
  })

  it('does not fabricate a range for a single entry', () => {
    setEntries([{ path: '/api/v1/vehicles', cachedAt: OLDEST }])
    const notice = render(<CachedDataNotice />).getByTestId('cached-data-notice')
    expect(notice).not.toHaveTextContent(/captured between/i)
  })

  it('warns explicitly when no capture time could be read', () => {
    setEntries([{ path: '/api/v1/vehicles', cachedAt: null }])
    expect(render(<CachedDataNotice />).getByTestId('cached-data-notice')).toHaveTextContent(
      /capture time is unknown/i,
    )
  })
})

describe('per-view disclosure', () => {
  it('quotes the supplied timestamp and ignores the worker-wide range', () => {
    setEntries([
      { path: '/api/v1/vehicles', cachedAt: OLDEST },
      { path: '/api/v1/drives', cachedAt: NEWEST },
    ])

    const notice = render(<CachedDataNotice cachedAt={NEWEST} />).getByTestId(
      'cached-data-notice',
    )

    expect(notice).toHaveAttribute('data-scope', 'view')
    expect(notice).toHaveAttribute('data-cached-at', String(NEWEST))
    expect(notice).not.toHaveTextContent(/captured between/i)
  })
})

describe('offline state and announcement semantics', () => {
  it('states the offline condition in visible text, not only in an aria-label', () => {
    setEntries([{ path: '/api/v1/vehicles', cachedAt: OLDEST }])
    expect(render(<CachedDataNotice />).getByTestId('cached-data-notice')).toHaveTextContent(
      /you're offline/i,
    )
  })

  it('omits the offline lead-in when the caller shows a snapshot while online', () => {
    state.online = true
    setEntries([{ path: '/api/v1/vehicles', cachedAt: OLDEST }])
    expect(
      render(<CachedDataNotice cachedAt={OLDEST} alwaysShow />).getByTestId(
        'cached-data-notice',
      ),
    ).not.toHaveTextContent(/you're offline/i)
  })

  it('is a polite live region by default', () => {
    setEntries([{ path: '/api/v1/vehicles', cachedAt: OLDEST }])
    const notice = render(<CachedDataNotice />).getByTestId('cached-data-notice')

    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveAttribute('aria-live', 'polite')
    // A live region names itself through its content; a competing aria-label
    // would replace the announced text.
    expect(notice).not.toHaveAttribute('aria-label')
  })

  it('becomes a labelled, non-live note when another region owns the announcement', () => {
    setEntries([{ path: '/api/v1/vehicles', cachedAt: OLDEST }])
    const notice = render(<CachedDataNotice announce={false} />).getByTestId(
      'cached-data-notice',
    )

    expect(notice).toHaveAttribute('role', 'note')
    expect(notice).toHaveAttribute('aria-live', 'off')
    expect(notice).toHaveAccessibleName('Cached data disclosure')
  })

  it('applies the same policy to the nothing-cached variant', () => {
    const live = render(<CachedDataNotice />).getByTestId('cached-data-notice-empty')
    expect(live).toHaveAttribute('role', 'status')

    const quiet = render(<CachedDataNotice announce={false} />).getAllByTestId(
      'cached-data-notice-empty',
    )[1]
    expect(quiet).toHaveAttribute('role', 'note')
    expect(quiet).toHaveAttribute('aria-live', 'off')
  })
})
