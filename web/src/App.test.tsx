import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, cleanup, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { initReactI18next } from 'react-i18next'
import i18n from 'i18next'

import { setBaseTitle, __resetTitleStoreForTests } from '@/lib/titleStore'
import {
  resetProductPreferences,
  updateProductPreferences,
} from '@/lib/productPreferences'

/**
 * App.tsx elevation coverage.
 *
 * The file is the SPA's route table plus three pieces of real logic:
 *   - `resolveReturnRedirect` — the pure post-re-auth redirect decision.
 *   - `RecentPagesRecorder`   — the debounced route → recent-pages recorder.
 *   - `SafeRoute`             — the per-route Suspense + ErrorBoundary shell.
 * plus the `<App>` composition that wires the redirect side effect.
 *
 * We mock `react-router-dom` to (a) spy on the imperative `navigate()` and
 * (b) neutralise `<Routes>` so mounting `<App>` never triggers a lazy page
 * chunk import (which would drag the whole feature graph into jsdom).
 * `MemoryRouter` / `useLocation` are kept REAL so the recorder + route shell
 * resolve their location from a genuine router context. The feedback shell
 * (ErrorBoundary / SuspenseProgressBoundary / PageLoadSkeleton) is exercised
 * for real — only `<App>`'s always-mounted chrome is stubbed out.
 */

const { navigateSpy, recordPageViewSpy } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  recordPageViewSpy: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateSpy, Routes: () => null }
})

// Capture recordPageView while keeping the real classify/label helpers so
// the recorder's title-resolution branch is genuinely exercised.
vi.mock('@/lib/recentPages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/recentPages')>()
  return { ...actual, recordPageView: recordPageViewSpy }
})

// The frontend error reporter would otherwise attempt a network POST when
// the ErrorBoundary catches — stub it out.
vi.mock('@/lib/errorReporter', () => ({
  reportFrontendError: vi.fn(),
  installGlobalErrorReporting: vi.fn(),
}))

// Neutralise <App>'s always-mounted chrome so the composition renders in
// isolation. These are covered by their own unit tests.
vi.mock('./components/layout/Layout', () => ({ default: () => null }))
vi.mock('./components/layout/ScrollRestoration', () => ({ ScrollRestoration: () => null }))
vi.mock('@/features/onboarding/components/OnboardingGate', () => ({ OnboardingGate: () => null }))
vi.mock('@/components/ui/DensityApplier', () => ({ DensityApplier: () => null }))
vi.mock('@/components/ui/ContextMenu', () => ({ ContextMenuRoot: () => null }))
vi.mock('@/components/a11y', () => ({ RouteAnnouncer: () => null }))

import App, {
  RecentPagesRecorder,
  SafeRoute,
  resolvePreferredLandingRedirect,
  resolveReturnRedirect,
  stripTitleSuffix,
  RECENT_PAGES_RECORD_DELAY_MS,
} from './App'

const RETURN_URL_KEY = 'teslasync-return-url'

async function setupI18n() {
  if (i18n.isInitialized) return
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })
}

beforeEach(async () => {
  await setupI18n()
  navigateSpy.mockReset()
  recordPageViewSpy.mockReset()
  sessionStorage.clear()
  localStorage.clear()
  resetProductPreferences()
  window.history.replaceState({}, '', '/')
  __resetTitleStoreForTests()
})

afterEach(() => {
  cleanup()
})

// ── stripTitleSuffix ─────────────────────────────────────────────────────
describe('App :: stripTitleSuffix', () => {
  it('strips the canonical " — TeslaSync" suffix', () => {
    expect(stripTitleSuffix('Battery Health — TeslaSync')).toBe('Battery Health')
  })

  it('returns the input unchanged when the suffix is absent', () => {
    expect(stripTitleSuffix('Battery Health')).toBe('Battery Health')
    expect(stripTitleSuffix('')).toBe('')
  })

  it('only strips a trailing suffix, not a mid-string occurrence', () => {
    // The suffix appears in the middle — must be left intact.
    expect(stripTitleSuffix('A — TeslaSync B')).toBe('A — TeslaSync B')
  })
})

// ── resolveReturnRedirect ────────────────────────────────────────────────
describe('App :: resolveReturnRedirect', () => {
  const ORIGIN = 'https://app.example.com'

  it('returns null for empty / nullish stored values', () => {
    expect(resolveReturnRedirect(null, ORIGIN, '/')).toBeNull()
    expect(resolveReturnRedirect(undefined, ORIGIN, '/')).toBeNull()
    expect(resolveReturnRedirect('', ORIGIN, '/')).toBeNull()
  })

  it('returns null for a malformed URL instead of throwing', () => {
    expect(() => resolveReturnRedirect('::: not a url :::', ORIGIN, '/')).not.toThrow()
    expect(resolveReturnRedirect('::: not a url :::', ORIGIN, '/')).toBeNull()
  })

  it('refuses cross-origin targets (open-redirect guard)', () => {
    expect(resolveReturnRedirect('https://evil.test/steal', ORIGIN, '/')).toBeNull()
  })

  it('returns null when the stored path equals the current path', () => {
    expect(resolveReturnRedirect(`${ORIGIN}/vehicles`, ORIGIN, '/vehicles')).toBeNull()
  })

  it('returns a router-relative path + search + hash for a valid same-origin target', () => {
    expect(
      resolveReturnRedirect(`${ORIGIN}/vehicles/7?tab=charging#top`, ORIGIN, '/'),
    ).toBe('/vehicles/7?tab=charging#top')
  })

  it('returns just the pathname when there is no search or hash', () => {
    expect(resolveReturnRedirect(`${ORIGIN}/drives`, ORIGIN, '/dashboard')).toBe('/drives')
  })
})

describe('App :: resolvePreferredLandingRedirect', () => {
  it('redirects only an initial root entry to the configured page', () => {
    expect(
      resolvePreferredLandingRedirect('/', '/battery'),
    ).toBe('/battery')
    expect(
      resolvePreferredLandingRedirect('/vehicles', '/battery'),
    ).toBeNull()
  })

  it('keeps Dashboard as the root when it is the configured page', () => {
    expect(resolvePreferredLandingRedirect('/', '/')).toBeNull()
  })
})

// ── App composition (redirect wiring) ────────────────────────────────────
describe('App :: post-re-auth redirect wiring', () => {
  function renderApp() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
  }

  it('navigates to the stored return URL and clears it from sessionStorage', () => {
    const target = `${window.location.origin}/vehicles/9?tab=battery#cells`
    sessionStorage.setItem(RETURN_URL_KEY, target)

    renderApp()

    expect(navigateSpy).toHaveBeenCalledTimes(1)
    expect(navigateSpy).toHaveBeenCalledWith('/vehicles/9?tab=battery#cells')
    // One-shot: the key is consumed so a later remount does not re-redirect.
    expect(sessionStorage.getItem(RETURN_URL_KEY)).toBeNull()
  })

  it('clears a cross-origin return URL without navigating', () => {
    sessionStorage.setItem(RETURN_URL_KEY, 'https://evil.example.com/phish')

    renderApp()

    expect(navigateSpy).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(RETURN_URL_KEY)).toBeNull()
  })

  it('does nothing when no return URL is stored', () => {
    renderApp()
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('applies the preferred page only to a startup root entry', () => {
    updateProductPreferences({ landingPage: '/battery' })
    renderApp()
    expect(navigateSpy).toHaveBeenCalledWith('/battery', {
      replace: true,
    })
  })

  it('gives a post-auth return target precedence over the preferred page', () => {
    updateProductPreferences({ landingPage: '/battery' })
    sessionStorage.setItem(
      RETURN_URL_KEY,
      `${window.location.origin}/vehicles`,
    )
    renderApp()
    expect(navigateSpy).toHaveBeenCalledTimes(1)
    expect(navigateSpy).toHaveBeenCalledWith('/vehicles')
  })
})

// ── SafeRoute (Suspense + ErrorBoundary shell) ───────────────────────────
describe('App :: SafeRoute', () => {
  function Boom(): JSX.Element {
    throw new Error('kaboom-boundary')
  }

  function NeverResolves(): JSX.Element {
    // Throwing a never-settling promise keeps the component suspended so the
    // Suspense fallback stays mounted.
    throw new Promise<void>(() => {})
  }

  it('renders its children when nothing suspends or throws', () => {
    render(
      <MemoryRouter>
        <SafeRoute name="Happy">
          <div>route-content</div>
        </SafeRoute>
      </MemoryRouter>,
    )
    expect(screen.getByText('route-content')).toBeInTheDocument()
  })

  it('shows the layout-shaped skeleton while a child is suspended', () => {
    render(
      <MemoryRouter>
        <SafeRoute name="Loading">
          <NeverResolves />
        </SafeRoute>
      </MemoryRouter>,
    )
    const skeleton = screen.getByTestId('page-load-skeleton')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
  })

  it('isolates a crashing child behind the ErrorBoundary fallback', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <MemoryRouter>
        <SafeRoute name="Crashing">
          <Boom />
        </SafeRoute>
      </MemoryRouter>,
    )
    // Generic fallback surfaces the heading + the thrown message + a retry.
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('kaboom-boundary')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    errSpy.mockRestore()
  })
})

// ── RecentPagesRecorder (debounced route → store recorder) ───────────────
describe('App :: RecentPagesRecorder', () => {
  beforeEach(() => {
    // Only fake the timer APIs the recorder uses so React's scheduler
    // (which may lean on microtasks / MessageChannel) is left untouched.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderAt(path: string, strict = false) {
    const tree = (
      <MemoryRouter initialEntries={[path]}>
        <RecentPagesRecorder />
      </MemoryRouter>
    )
    return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  }

  it('records the visit only after the settle delay, using the store title', () => {
    setBaseTitle('Vehicle Detail — TeslaSync')
    renderAt('/vehicles/42')

    // Nothing before the debounce window elapses.
    expect(recordPageViewSpy).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(RECENT_PAGES_RECORD_DELAY_MS)
    })

    expect(recordPageViewSpy).toHaveBeenCalledTimes(1)
    expect(recordPageViewSpy).toHaveBeenCalledWith({
      path: '/vehicles/42',
      title: 'Vehicle Detail',
    })
  })

  it('falls back to the raw pathname when neither store nor registry has a title', () => {
    // Default title store ("TeslaSync") + an unknown path → no label source.
    renderAt('/totally-unknown-xyz')
    act(() => {
      vi.advanceTimersByTime(RECENT_PAGES_RECORD_DELAY_MS)
    })
    expect(recordPageViewSpy).toHaveBeenCalledWith({
      path: '/totally-unknown-xyz',
      title: '/totally-unknown-xyz',
    })
  })

  it('cancels the pending record when unmounted before the delay elapses', () => {
    const { unmount } = renderAt('/drives')
    unmount()
    act(() => {
      vi.advanceTimersByTime(RECENT_PAGES_RECORD_DELAY_MS * 4)
    })
    expect(recordPageViewSpy).not.toHaveBeenCalled()
  })

  it('still records exactly once under StrictMode double-invocation', () => {
    // Regression guard: assigning lastPathRef up-front made the remounted
    // effect early-return and never record. The deferred assignment keeps a
    // single record surviving the mount→unmount→mount probe.
    setBaseTitle('Glance — TeslaSync')
    renderAt('/glance', true)
    act(() => {
      vi.advanceTimersByTime(RECENT_PAGES_RECORD_DELAY_MS)
    })
    expect(recordPageViewSpy).toHaveBeenCalledTimes(1)
    expect(recordPageViewSpy).toHaveBeenCalledWith({ path: '/glance', title: 'Glance' })
  })
})
