/**
 * StatusApiDocsPage contract tests.
 *
 * StatusApiDocsPage is a static documentation surface for the public
 * `/api/v1/status/*` endpoints — self-hosted operators wire it into Grafana,
 * Uptime Kuma, Home Assistant, etc. There is no live data: the value is in the
 * completeness and correctness of the documented contract, the copy
 * affordances, and the escape hatch back to System Status.
 *
 * These tests drive the page end-to-end against the real shared components
 * (PageContainer, MetricCard, GlassPanel, KVList, InlineCallout) and the real
 * `StatusApiEndpointCard` sub-component (method badge, copy button, accordion).
 * Only `useNavigate` is mocked so navigation is observable without a history
 * stack, and `react-i18next` is stubbed to fall back to the inline English
 * defaults with `{{n}}` / `{{path}}` interpolation.
 *
 * Coverage:
 *   1. Page chrome — h1 title, subtitle, and the document/tab title.
 *   2. KPI band — four metric cards; the "Endpoints" figure is DERIVED from the
 *      documented list (never hardcoded) and agrees with the rendered card
 *      count and the "N routes" badge.
 *   3. Overview panel — base-path + auth/content-type facts.
 *   4. Integrations panel — every supported target + wiring hint is listed.
 *   5. Endpoint grid — one GET card per documented route, each rendering its
 *      full public path; query hints appear only where applicable.
 *   6. a11y — each icon-only copy control carries a *path-specific* accessible
 *      name (the hardening fix) so screen-reader users can tell them apart.
 *   7. Copy — clicking a copy control writes that endpoint's path to clipboard.
 *   8. Accordion — the example JSON is collapsed by default and revealed on
 *      demand (aria-expanded toggles false → true).
 *   9. Escape hatch — "Back to System Status" routes to /system-status.
 *  10. Footer — the callout links to the project issue tracker.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
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

import StatusApiDocsPage from './StatusApiDocsPage'

/** The documented contract, in render order. The page derives its counts. */
const DOCUMENTED_PATHS = [
  '/api/v1/status',
  '/api/v1/status/components',
  '/api/v1/status/resources',
  '/api/v1/status/uptime',
  '/api/v1/status/incidents',
  '/api/v1/status/live',
] as const

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/docs/status-api']}>
        <StatusApiDocsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  navigateMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StatusApiDocsPage — page chrome', () => {
  it('renders the page title + subtitle and sets the document tab title', () => {
    renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Status API' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Stable contract for external integrations'),
    ).toBeInTheDocument()
    expect(document.title).toContain('Status API')
  })

  it('summarises the surface in four KPI cards, deriving the endpoint count from the documented list', () => {
    renderPage()

    const kpi = screen.getByRole('region', { name: 'API surface summary' })
    // The "Endpoints" figure must equal the number of documented routes —
    // guards against a future hardcoded literal drifting out of sync.
    expect(
      within(kpi).getByText(String(DOCUMENTED_PATHS.length)),
    ).toBeInTheDocument()
    expect(within(kpi).getByText('REST + SSE')).toBeInTheDocument()
    expect(within(kpi).getByText('JSON')).toBeInTheDocument()
    expect(within(kpi).getByText('Additive-only')).toBeInTheDocument()
  })
})

describe('StatusApiDocsPage — overview & integrations', () => {
  it('documents the base path and the core request facts', () => {
    renderPage()

    expect(screen.getByText('Base path')).toBeInTheDocument()
    expect(screen.getByText('Content-Type')).toBeInTheDocument()
    expect(
      screen.getByText('ForwardAuth or Authorization header'),
    ).toBeInTheDocument()
    // The base path is documented both as an overview fact AND as the
    // `/status` endpoint path, so it appears at least twice.
    expect(screen.getAllByText('/api/v1/status').length).toBeGreaterThanOrEqual(2)
  })

  it('lists every supported integration target with its wiring hint', () => {
    renderPage()

    for (const name of [
      'Grafana',
      'Uptime Kuma',
      'Home Assistant',
      'Healthchecks.io',
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByText('JSON datasource')).toBeInTheDocument()
    expect(screen.getByText('REST sensor')).toBeInTheDocument()
  })
})

describe('StatusApiDocsPage — endpoint reference', () => {
  it('renders one GET card per documented endpoint, each showing its public path', () => {
    renderPage()

    const grid = screen.getByRole('region', { name: 'Endpoints' })
    // One GET method badge per documented route.
    expect(within(grid).getAllByText('GET')).toHaveLength(DOCUMENTED_PATHS.length)
    // Every documented path is rendered verbatim (exact match — so
    // `/api/v1/status` does not collide with `/api/v1/status/components`).
    for (const path of DOCUMENTED_PATHS) {
      expect(within(grid).getByText(path)).toBeInTheDocument()
    }
    // The "N routes" count badge agrees with the documented count.
    expect(
      within(grid).getByText(`${DOCUMENTED_PATHS.length} routes`),
    ).toBeInTheDocument()
  })

  it('surfaces query-string hints only for endpoints that accept them', () => {
    renderPage()

    const grid = screen.getByRole('region', { name: 'Endpoints' })
    // Exactly two documented endpoints (uptime, incidents) take query params.
    expect(within(grid).getAllByText('Query')).toHaveLength(2)
    expect(
      within(grid).getByText(/window=24h \| 7d \| 30d \| 90d \| 1y/),
    ).toBeInTheDocument()
    expect(within(grid).getByText(/active=1 \| limit=N/)).toBeInTheDocument()
  })

  it('gives each icon-only copy control a path-specific accessible name', () => {
    renderPage()

    // Distinct, path-specific labels — not six identical "Copy endpoint path".
    expect(
      screen.getByRole('button', {
        name: 'Copy endpoint path /api/v1/status',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Copy endpoint path /api/v1/status/live',
      }),
    ).toBeInTheDocument()
    // One copy control per documented endpoint.
    expect(
      screen.getAllByRole('button', { name: /^Copy endpoint path / }),
    ).toHaveLength(DOCUMENTED_PATHS.length)
  })

  it('copies the endpoint path to the clipboard when a copy control is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    renderPage()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Copy endpoint path /api/v1/status/components',
      }),
    )

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('/api/v1/status/components'),
    )
  })

  it('keeps the example JSON collapsed until the operator expands it', async () => {
    renderPage()

    const grid = screen.getByRole('region', { name: 'Endpoints' })
    const [firstExample] = within(grid).getAllByRole('button', {
      name: 'Example response',
    })

    // Collapsed by default: the /status example payload is not in the DOM.
    expect(firstExample).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByText(/"status": "operational"/),
    ).not.toBeInTheDocument()

    fireEvent.click(firstExample)

    expect(firstExample).toHaveAttribute('aria-expanded', 'true')
    expect(
      await screen.findByText(/"status": "operational"/),
    ).toBeInTheDocument()
  })
})

describe('StatusApiDocsPage — navigation & footer', () => {
  it('routes back to System Status when the back action is used', () => {
    renderPage()

    fireEvent.click(
      screen.getByRole('button', { name: /Back to System Status/i }),
    )

    expect(navigateMock).toHaveBeenCalledWith('/system-status')
    expect(navigateMock).toHaveBeenCalledTimes(1)
  })

  it('links the footer callout to the project issue tracker', () => {
    renderPage()

    const link = screen.getByRole('link', { name: /Open an issue/i })
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/ev-dev-labs/teslasync/issues',
    )
  })
})
