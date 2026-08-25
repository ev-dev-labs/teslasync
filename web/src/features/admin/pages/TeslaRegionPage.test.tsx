/**
 * TeslaRegionPage contract tests.
 *
 * The page has a single export (the page component) but composes three real
 * child panels + two data hooks. These tests drive every branch of its
 * derive-and-compose logic through the *real* components so behaviour, not
 * implementation, is what's asserted:
 *
 *   1. Loading            → KPI skeleton is shown; endpoint detail is not yet.
 *   2. Configured (NA)    → zone label, zone badge, base URL, copy control,
 *                           host + protocol KV rows, "Configured" KPI status.
 *   3. Configured (EU)    → the `eu` branch of the zone-label ternary + badge,
 *                           and the endpoint hero does NOT leak the NA label.
 *   4. Not configured     → EmptyState CTA, "Not configured" KPI, `—` fallbacks.
 *   5. Query error        → QueryError network branch; Retry refetches.
 *   6. Header refresh      → POSTs to the refresh endpoint exactly once.
 *   7. Refresh in flight  → the control is disabled AND `aria-busy` (a11y).
 *   8. Landmarks          → the three labelled region landmarks are present.
 *   9. Reference panel    → the About panel always lists all three zones,
 *                           including when the account data is null.
 *
 * Network is faked at the shared `@/api/client.request` seam — the same seam
 * the real `useTeslaUserRegion` / `useRefreshTeslaRegion` hooks call — so the
 * hooks, PageContainer, and every panel run unmocked. This mirrors the
 * convention used by the sibling admin-page tests (FleetTelemetryCoveragePage,
 * DLQInspectorPage, …).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
  // QueryError imports isApiError from the client to branch on HTTP status.
  // Stub it so the mock module is complete and QueryError falls to its
  // generic network-error branch (status === undefined).
  isApiError: () => false,
}))

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import TeslaRegionPage from './TeslaRegionPage'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

interface RegionEnvelope {
  data: { region: string; fleet_api_base_url: string } | null
  fetched_at: string | null
}

const NA_URL = 'https://fleet-api.prd.na.vn.cloud.tesla.com'
const NA_HOST = 'fleet-api.prd.na.vn.cloud.tesla.com'
const EU_URL = 'https://fleet-api.prd.eu.vn.cloud.tesla.com'

const NA_ZONE = 'North America & Asia-Pacific (excl. China)'
const EU_ZONE = 'Europe, Middle East & Africa'
const CN_ZONE = 'China'

function envelope(
  region: string,
  url: string,
  fetchedAt: string | null = '2026-01-02T03:04:05Z',
): RegionEnvelope {
  return { data: { region, fleet_api_base_url: url }, fetched_at: fetchedAt }
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/tesla-region']}>
        <ToastProvider>
          <TeslaRegionPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const endpointRegion = () =>
  screen.getByRole('region', { name: 'Fleet API endpoint' })
const overviewRegion = () =>
  screen.getByRole('region', { name: 'Region overview' })
const aboutRegion = () =>
  screen.getByRole('region', { name: 'About your region' })

// PageContainer also renders a keyboard-operable DataFreshness refresh button.
// Its accessible name begins "Refresh data", so the exact "Refresh" matcher
// below continues to identify the page-level command.
function headerRefreshButton(): HTMLButtonElement {
  const match = screen
    .getAllByRole('button', { name: 'Refresh' })
    .find((el) => el.tagName === 'BUTTON')
  if (!match) throw new Error('header Refresh <button> not found')
  return match as HTMLButtonElement
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('TeslaRegionPage', () => {
  it('shows the KPI skeleton while the region query is loading', async () => {
    let resolve: (v: RegionEnvelope) => void = () => {}
    mockedRequest.mockReturnValueOnce(
      new Promise<RegionEnvelope>((r) => {
        resolve = r
      }),
    )

    renderPage()

    // KPI band renders its own loading skeleton…
    expect(screen.getByTestId('stat-grid-skeleton')).toBeInTheDocument()
    // …and the endpoint detail (base-URL row) has not rendered yet.
    expect(screen.queryByText('Fleet API base URL')).toBeNull()
    // The header refresh control is available even during the first load.
    expect(headerRefreshButton()).toBeEnabled()

    // Settle the query so React-Query teardown is clean.
    resolve({ data: null, fetched_at: null })
    await waitFor(() =>
      expect(screen.queryByTestId('stat-grid-skeleton')).toBeNull(),
    )
  })

  it('renders the resolved NA endpoint with zone label, badge, URL and KV rows', async () => {
    mockedRequest.mockResolvedValue(envelope('North America', NA_URL))

    renderPage()

    const endpoint = await waitFor(() => {
      const el = endpointRegion()
      expect(within(el).getByText(NA_URL)).toBeInTheDocument()
      return el
    })

    // Zone label (na branch of the ternary) + zone badge inside the hero.
    expect(within(endpoint).getByText(NA_ZONE)).toBeInTheDocument()
    expect(within(endpoint).getAllByText('NA').length).toBeGreaterThan(0)

    // Copy control is labelled for assistive tech.
    expect(
      within(endpoint).getByRole('button', {
        name: 'Copy Fleet API base URL',
      }),
    ).toBeInTheDocument()

    // KV rows derived from the URL: host + protocol.
    expect(within(endpoint).getByText(NA_HOST)).toBeInTheDocument()
    expect(within(endpoint).getByText('HTTPS')).toBeInTheDocument()

    // KPI status reflects a configured account.
    expect(within(overviewRegion()).getByText('Configured')).toBeInTheDocument()

    // No empty/error surfaces while configured.
    expect(screen.queryByText('No region on record')).toBeNull()
  })

  it('renders the EU zone label and badge, and keeps the NA label out of the hero', async () => {
    mockedRequest.mockResolvedValue(envelope('Europe', EU_URL))

    renderPage()

    const endpoint = await waitFor(() => {
      const el = endpointRegion()
      expect(within(el).getByText(EU_URL)).toBeInTheDocument()
      return el
    })

    expect(within(endpoint).getByText(EU_ZONE)).toBeInTheDocument()
    expect(within(endpoint).getAllByText('EU').length).toBeGreaterThan(0)
    // The na branch must not leak into the endpoint hero (it only appears in
    // the always-on About panel).
    expect(within(endpoint).queryByText(NA_ZONE)).toBeNull()
  })

  it('renders the empty state and "Not configured" KPI when nothing is on record', async () => {
    mockedRequest.mockResolvedValue({
      data: { region: '', fleet_api_base_url: '' },
      fetched_at: null,
    })

    renderPage()

    const endpoint = await waitFor(() => {
      const el = endpointRegion()
      expect(within(el).getByText('No region on record')).toBeInTheDocument()
      return el
    })

    // KPI status flips to "Not configured" with em-dash placeholders.
    const overview = overviewRegion()
    expect(within(overview).getByText('Not configured')).toBeInTheDocument()
    expect(within(overview).getAllByText('—').length).toBeGreaterThan(0)

    // The empty state exposes its own refresh CTA (distinct from the header).
    expect(
      within(endpoint).getByRole('button', { name: 'Refresh' }),
    ).toBeInTheDocument()
  })

  it('renders the QueryError network branch and retries on demand', async () => {
    mockedRequest.mockRejectedValue(new Error('network boom'))

    renderPage()

    const endpoint = await waitFor(() => {
      const el = endpointRegion()
      expect(within(el).getByText("Can't reach server")).toBeInTheDocument()
      return el
    })

    const callsBefore = mockedRequest.mock.calls.length
    fireEvent.click(within(endpoint).getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(callsBefore),
    )
    expect(mockedRequest).toHaveBeenLastCalledWith(
      '/tesla/user/region',
      expect.anything(),
    )
  })

  it('POSTs to the refresh endpoint exactly once when the header action is clicked', async () => {
    mockedRequest.mockResolvedValue(envelope('North America', NA_URL))

    renderPage()

    await waitFor(() => expect(screen.getByText(NA_URL)).toBeInTheDocument())

    fireEvent.click(headerRefreshButton())

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/tesla/user/region/refresh', {
        method: 'POST',
      }),
    )
    const postCalls = mockedRequest.mock.calls.filter(
      ([, opts]) => (opts as { method?: string } | undefined)?.method === 'POST',
    )
    expect(postCalls).toHaveLength(1)
  })

  it('marks the header refresh control disabled and aria-busy while a refresh is in flight', async () => {
    let resolveRefresh: (v: RegionEnvelope) => void = () => {}
    mockedRequest.mockImplementation(
      (path: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return new Promise<RegionEnvelope>((r) => {
            resolveRefresh = r
          })
        }
        return Promise.resolve(envelope('North America', NA_URL))
      },
    )

    renderPage()

    await waitFor(() => expect(screen.getByText(NA_URL)).toBeInTheDocument())

    const refreshBtn = headerRefreshButton()
    expect(refreshBtn).toBeEnabled()

    fireEvent.click(refreshBtn)

    // Pending mutation → the control locks and announces busy state to AT.
    await waitFor(() => expect(refreshBtn).toBeDisabled())
    expect(refreshBtn).toHaveAttribute('aria-busy', 'true')

    // Settle the in-flight refresh for a clean teardown.
    resolveRefresh(envelope('North America', NA_URL))
    await waitFor(() => expect(refreshBtn).toBeEnabled())
  })

  it('exposes the three labelled region landmarks for navigation', async () => {
    mockedRequest.mockResolvedValue(envelope('North America', NA_URL))

    renderPage()

    await waitFor(() => expect(screen.getByText(NA_URL)).toBeInTheDocument())

    expect(overviewRegion()).toBeInTheDocument()
    expect(endpointRegion()).toBeInTheDocument()
    expect(aboutRegion()).toBeInTheDocument()
    expect(headerRefreshButton()).toBeInTheDocument()
  })

  it('always lists all three Fleet API zones in the reference panel, even with null data', async () => {
    mockedRequest.mockResolvedValue({ data: null, fetched_at: null })

    renderPage()

    // Wait for the query to resolve to the empty endpoint state before
    // asserting — the About panel's static content renders immediately and
    // would otherwise let the assertions race ahead of the loading skeleton.
    await waitFor(() =>
      expect(
        within(endpointRegion()).getByText('No region on record'),
      ).toBeInTheDocument(),
    )

    const about = aboutRegion()
    expect(within(about).getByText('Fleet API zones')).toBeInTheDocument()
    expect(within(about).getByText(NA_ZONE)).toBeInTheDocument()
    expect(within(about).getByText(EU_ZONE)).toBeInTheDocument()
    expect(within(about).getByText(CN_ZONE)).toBeInTheDocument()
  })
})
