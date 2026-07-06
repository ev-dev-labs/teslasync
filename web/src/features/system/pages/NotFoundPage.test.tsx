/**
 * NotFoundPage contract tests.
 *
 * NotFoundPage is the catch-all 404 surface. It logs the unmatched URL,
 * suggests the closest known routes via Levenshtein distance, and offers
 * three escape hatches (back, dashboard, command palette).
 *
 * These tests drive the *page* end-to-end against the real suggestion engine
 * (`@/lib/closestRoute` + the generated `ROUTE_REGISTRY`) and the real
 * `usePageTitle`/`titleStore`. Only `useNavigate` is mocked so navigation is
 * observable without a real history stack, and `react-i18next` is stubbed to
 * fall back to the inline English defaults (with `{{path}}` interpolation).
 *
 * Coverage:
 *   1. Renders the heading + interpolated unmatched path and sets the tab title.
 *   2. Logs the unmatched pathname + search via console.warn.
 *   3. Surfaces the closest route as a "Did you mean" suggestion link inside a
 *      labelled navigation landmark.
 *   4. Hides the suggestion landmark entirely for a path with no near matches
 *      (root '/').
 *   5. "Go to dashboard" routes to '/'.
 *   6. "Go back" uses history.back() when there is somewhere to return to.
 *   7. "Go back" falls back to the dashboard when the 404 is a history
 *      dead-end (direct hit / refresh) — the bug this hardening pass fixes.
 *   8. "Open command palette" dispatches the toggle-command-palette event.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback =
          typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        const interpolate = (s: string) => {
          if (!opts) return s
          return Object.keys(opts).reduce(
            (acc, k) =>
              acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
            s,
          )
        }
        if (opts && typeof opts.defaultValue === 'string')
          return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import NotFoundPage from './NotFoundPage'

function renderPage(path = '/totally-bogus') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <NotFoundPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Shadow `window.history.length` so both back-button branches are testable. */
function setHistoryLength(len: number) {
  Object.defineProperty(window.history, 'length', {
    configurable: true,
    get: () => len,
  })
}

beforeEach(() => {
  navigateMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  // Drop any per-test shadow so the native History.prototype getter returns.
  Reflect.deleteProperty(window.history, 'length')
})

describe('NotFoundPage — content', () => {
  it('renders the heading, the interpolated unmatched path, and the tab title', () => {
    renderPage('/totally-bogus')

    expect(
      screen.getByRole('heading', { level: 2, name: /find that page/i }),
    ).toBeInTheDocument()
    // {{path}} is interpolated into the body copy.
    expect(
      screen.getByText(/\/totally-bogus doesn't match any route\./i),
    ).toBeInTheDocument()
    expect(document.title).toContain('Page not found')
  })

  it('logs the unmatched pathname + search to console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderPage('/oops?y=2')

    expect(warnSpy).toHaveBeenCalledWith('[404]', '/oops?y=2')
  })
})

describe('NotFoundPage — route suggestions', () => {
  it('surfaces the closest known route inside a labelled navigation landmark', () => {
    // '/vehicless' is one edit away from the real '/vehicles' route.
    renderPage('/vehicless')

    const nav = screen.getByRole('navigation', { name: 'Suggested pages' })
    expect(nav).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /vehicles/i })
    expect(link).toHaveAttribute('href', '/vehicles')
    expect(screen.getByText('Did you mean:')).toBeInTheDocument()
  })

  it('hides the suggestion landmark when there are no near matches', () => {
    // normalize('/') collapses to '' → the engine returns no candidates.
    renderPage('/')

    expect(
      screen.queryByRole('navigation', { name: 'Suggested pages' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Did you mean:')).not.toBeInTheDocument()
  })
})

describe('NotFoundPage — escape hatches', () => {
  it('routes to the dashboard when "Go to dashboard" is clicked', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Go to dashboard/i }))

    expect(navigateMock).toHaveBeenCalledWith('/')
  })

  it('uses history.back() for "Go back" when there is history to return to', () => {
    setHistoryLength(3)
    const backSpy = vi
      .spyOn(window.history, 'back')
      .mockImplementation(() => {})

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Go back/i }))

    expect(backSpy).toHaveBeenCalledTimes(1)
    // With real history we must NOT redirect to the dashboard.
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('falls back to the dashboard when "Go back" would dead-end the user', () => {
    // A direct hit / refresh leaves the 404 as the only history entry.
    setHistoryLength(1)
    const backSpy = vi
      .spyOn(window.history, 'back')
      .mockImplementation(() => {})

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Go back/i }))

    expect(navigateMock).toHaveBeenCalledWith('/')
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('dispatches the toggle-command-palette event from "Open command palette"', () => {
    const handler = vi.fn()
    window.addEventListener('toggle-command-palette', handler)

    renderPage()
    fireEvent.click(
      screen.getByRole('button', { name: /Open command palette/i }),
    )

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toHaveProperty(
      'type',
      'toggle-command-palette',
    )

    window.removeEventListener('toggle-command-palette', handler)
  })
})
