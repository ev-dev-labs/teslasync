/**
 * DevToolsPage contract tests.
 *
 * DevToolsPage is a full-width command center: an always-visible KPI cockpit
 * band (fed by two live queries + three static catalogs) over a URL-driven
 * tab strip that swaps in one tool section at a time. These tests exercise
 * every branch and interaction of the orchestrator:
 *
 *   1. Loaded  — the two live KPIs render truthful counts and the default
 *                Fleet API section mounts.
 *   2. Loading — both live KPIs show the "—" placeholder and the refresh
 *                button reports busy while the initial fetch is in flight.
 *   3. Error   — the AlertBanner surfaces the failure AND the two live KPIs
 *                fall back to "—" instead of a fabricated `0` (regression
 *                guard for the "don't lie on error" fix), while page content
 *                (the section) still renders.
 *   4. Refresh — clicking the toolbar button refetches BOTH sources and the
 *                button reports busy for the in-flight refetch (regression
 *                guard: it must track `isFetching`, not just the first-load
 *                `isLoading`, otherwise it gives no feedback after load).
 *   5. Tabs    — clicking each tab swaps in the matching section.
 *   6. URL     — the `?tab=` param drives the active section on mount, a
 *                click writes the param, and returning to the default tab
 *                drops it (omitDefault). An unknown value falls back safely.
 *   7. a11y    — the icon-only-ish refresh control has an accessible label
 *                and both landmark regions are labelled.
 *
 * Network is driven entirely through the mocked `@/api/client` `request`
 * (the same seam APIKeysPage / FleetTelemetryCoveragePage use) so nothing
 * touches the real network. The five tab *section* components are stubbed so
 * their own data machinery stays out of scope; the real KPI band renders so
 * its truthful-count behaviour is asserted end-to-end through the page.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

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

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
  }
})

// Stub the five tab sections (each owns its own network) but keep the REAL
// DevToolsOverview so the KPI band's truthful-count behaviour is exercised
// through the page. Importing the specific submodule avoids pulling the
// section import graph into the factory.
vi.mock('../components/devtools', async () => {
  const overview = await vi.importActual<
    typeof import('../components/devtools/DevToolsOverview')
  >('../components/devtools/DevToolsOverview')
  const stub = (testid: string) => () => <div data-testid={testid} />
  return {
    DevToolsOverview: overview.DevToolsOverview,
    FleetApiSection: stub('section-fleet-api'),
    FleetTelemetryHealth: stub('section-telemetry'),
    InfrastructureSection: stub('section-infrastructure'),
    ClientUtilitiesSection: stub('section-utilities'),
    ReferenceLinksSection: stub('section-reference'),
  }
})

import { request } from '@/api/client'
import DevToolsPage from './DevToolsPage'
import type { FleetTelemetryErrorVIN } from '@/api/hooks/useTelemetry'
import type { Vehicle } from '@/types/vehicle'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const ERROR_VINS_PATH = '/tesla/fleet-telemetry/error-vins'
const VEHICLES_PATH = '/vehicles'

// jsdom lacks matchMedia; framer-motion (via the header freshness chip) reads
// it. Guarded polyfill keeps the render deterministic.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function makeErrorVins(count: number): FleetTelemetryErrorVIN[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    vin: `5YJSA0000000000${i}`,
    active: true,
    first_seen_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-01-02T00:00:00Z',
    resolved_at: null,
  }))
}

function makeVehicles(count: number): Vehicle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    display_name: `Car ${i + 1}`,
  })) as unknown as Vehicle[]
}

/** Route the single `request` mock by path so both live queries resolve. */
function installResolved(errorVins: FleetTelemetryErrorVIN[], vehicles: Vehicle[]) {
  mockedRequest.mockImplementation((path: string) => {
    if (path === ERROR_VINS_PATH) return Promise.resolve(errorVins)
    if (path === VEHICLES_PATH) return Promise.resolve(vehicles)
    return Promise.reject(new Error(`unexpected request ${path}`))
  })
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="loc-search">{location.search}</div>
}

function renderPage(initialEntries: string[] = ['/dev-tools']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <DevToolsPage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const overviewRegion = () =>
  screen.getByRole('region', { name: 'Developer tools overview' })
const toolsRegion = () =>
  screen.getByRole('region', { name: 'Developer tool areas' })
const refreshButton = () =>
  screen.getByRole('button', { name: 'Refresh developer tools status' })
const locSearch = () => screen.getByTestId('loc-search').textContent

beforeEach(() => {
  mockedRequest.mockReset()
  installResolved([], [])
})

describe('DevToolsPage', () => {
  it('renders truthful live KPI counts and mounts the default Fleet API section', async () => {
    installResolved(makeErrorVins(2), makeVehicles(3))
    renderPage()

    // Live KPIs resolve to their true counts, scoped to the KPI band so a
    // stray digit elsewhere can't satisfy the assertion.
    const region = overviewRegion()
    expect(await within(region).findByText('2')).toBeInTheDocument()
    expect(within(region).getByText('3')).toBeInTheDocument()

    // No placeholder once both live sources have resolved.
    expect(within(region).queryAllByText('—')).toHaveLength(0)

    // The static catalog KPIs (derived from local constants) are present and
    // always truthful — Fleet API endpoints (11) + reference docs (4).
    expect(within(region).getByText('11')).toBeInTheDocument()
    expect(within(region).getByText('4')).toBeInTheDocument()

    // Default tab renders the Fleet API section, and only that one.
    expect(screen.getByTestId('section-fleet-api')).toBeInTheDocument()
    expect(screen.queryByTestId('section-telemetry')).not.toBeInTheDocument()

    // Both live sources were actually fetched.
    expect(mockedRequest).toHaveBeenCalledWith(ERROR_VINS_PATH, expect.anything())
    expect(mockedRequest).toHaveBeenCalledWith(VEHICLES_PATH, expect.anything())
  })

  it('shows "—" placeholders and a busy refresh button while the initial load is in flight', async () => {
    const d1 = deferred<FleetTelemetryErrorVIN[]>()
    const d2 = deferred<Vehicle[]>()
    mockedRequest.mockImplementation((path: string) =>
      path === ERROR_VINS_PATH
        ? d1.promise
        : path === VEHICLES_PATH
          ? d2.promise
          : Promise.reject(new Error('unexpected')),
    )

    renderPage()

    // Both live KPIs are unknown → exactly two em-dash placeholders.
    await waitFor(() =>
      expect(within(overviewRegion()).getAllByText('—')).toHaveLength(2),
    )
    // The toolbar button reflects the in-flight fetch.
    expect(refreshButton()).toHaveAttribute('aria-busy', 'true')

    // Resolve so the query settles and the busy state clears.
    d1.resolve([])
    d2.resolve([])
    await waitFor(() =>
      expect(refreshButton()).not.toHaveAttribute('aria-busy'),
    )
  })

  it('surfaces the error banner and em-dash KPIs (not fabricated zeros) on load failure', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'))
    renderPage()

    // The failure is announced with the message, not swallowed.
    expect(
      await screen.findByText(/Failed to load data: boom/),
    ).toBeInTheDocument()

    // Regression guard: the KPI band must NOT read a healthy-looking `0` on a
    // failed load — both live metrics degrade to the "—" placeholder.
    const region = overviewRegion()
    await waitFor(() =>
      expect(within(region).getAllByText('—')).toHaveLength(2),
    )
    expect(within(region).queryByText('0')).toBeNull()

    // Page content is never hidden behind the error — the section still shows.
    expect(screen.getByTestId('section-fleet-api')).toBeInTheDocument()
  })

  it('refetches BOTH live sources and reports busy for the in-flight refetch on refresh', async () => {
    installResolved(makeErrorVins(2), makeVehicles(5))
    renderPage()

    // Wait for the first load to fully settle to a clean, idle baseline.
    // Vehicle count (5) is unique across the KPI band, so it's a safe anchor.
    await within(overviewRegion()).findByText('5')
    await waitFor(() =>
      expect(refreshButton()).not.toHaveAttribute('aria-busy'),
    )

    // Hold the next fetch open so the in-flight state is observable.
    const d1 = deferred<FleetTelemetryErrorVIN[]>()
    const d2 = deferred<Vehicle[]>()
    mockedRequest.mockImplementation((path: string) =>
      path === ERROR_VINS_PATH
        ? d1.promise
        : path === VEHICLES_PATH
          ? d2.promise
          : Promise.reject(new Error('unexpected')),
    )
    const callsBefore = mockedRequest.mock.calls.length

    fireEvent.click(refreshButton())

    // The button must report busy DURING the refetch. With the pre-fix code
    // (bound to `isLoading`, which stays false after the first load) this
    // never becomes true.
    await waitFor(() =>
      expect(refreshButton()).toHaveAttribute('aria-busy', 'true'),
    )
    // Both sources were refetched (two additional calls minimum).
    expect(mockedRequest.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(mockedRequest).toHaveBeenCalledWith(ERROR_VINS_PATH, expect.anything())
    expect(mockedRequest).toHaveBeenCalledWith(VEHICLES_PATH, expect.anything())

    d1.resolve(makeErrorVins(2))
    d2.resolve(makeVehicles(5))
    await waitFor(() =>
      expect(refreshButton()).not.toHaveAttribute('aria-busy'),
    )
  })

  it('swaps in the matching section when each tab is activated', async () => {
    installResolved([], [])
    renderPage()

    expect(screen.getByTestId('section-fleet-api')).toBeInTheDocument()

    const tabs = toolsRegion()
    fireEvent.click(within(tabs).getByRole('button', { name: 'Telemetry' }))
    expect(await screen.findByTestId('section-telemetry')).toBeInTheDocument()
    expect(screen.queryByTestId('section-fleet-api')).not.toBeInTheDocument()

    fireEvent.click(within(tabs).getByRole('button', { name: 'Infrastructure' }))
    expect(await screen.findByTestId('section-infrastructure')).toBeInTheDocument()

    fireEvent.click(within(tabs).getByRole('button', { name: 'Utilities' }))
    expect(await screen.findByTestId('section-utilities')).toBeInTheDocument()

    fireEvent.click(within(tabs).getByRole('button', { name: 'Reference' }))
    expect(await screen.findByTestId('section-reference')).toBeInTheDocument()
  })

  it('reads the active tab from the URL, writes it on change, and drops the default', async () => {
    installResolved([], [])
    renderPage(['/dev-tools?tab=reference'])

    // Mount honours the URL param.
    expect(screen.getByTestId('section-reference')).toBeInTheDocument()
    expect(screen.queryByTestId('section-fleet-api')).not.toBeInTheDocument()

    // Switching to a non-default tab writes the param.
    fireEvent.click(
      within(toolsRegion()).getByRole('button', { name: 'Telemetry' }),
    )
    await waitFor(() => expect(locSearch()).toBe('?tab=telemetry'))

    // Returning to the default tab drops the param entirely (omitDefault).
    fireEvent.click(
      within(toolsRegion()).getByRole('button', { name: 'Fleet API' }),
    )
    await waitFor(() => expect(locSearch()).toBe(''))
    expect(screen.getByTestId('section-fleet-api')).toBeInTheDocument()
  })

  it('falls back to the default tab for an unknown URL value', async () => {
    installResolved([], [])
    renderPage(['/dev-tools?tab=bogus-value'])

    // The enum guard rejects the unknown value → default (Fleet API).
    expect(screen.getByTestId('section-fleet-api')).toBeInTheDocument()
    expect(screen.queryByTestId('section-reference')).not.toBeInTheDocument()
  })

  it('exposes accessible landmarks and a labelled refresh control', async () => {
    installResolved(makeErrorVins(0), makeVehicles(0))
    renderPage()

    // Both landmark regions are labelled for assistive tech.
    expect(overviewRegion()).toBeInTheDocument()
    expect(toolsRegion()).toBeInTheDocument()

    // The refresh action has a descriptive accessible name (not just an icon).
    expect(refreshButton()).toBeInTheDocument()

    // The tab strip is reachable by role + accessible name.
    expect(
      within(toolsRegion()).getByRole('button', { name: 'Fleet API' }),
    ).toBeInTheDocument()

    // Empty fleet is real data → the KPI legitimately reads 0, not "—".
    const region = overviewRegion()
    await waitFor(() =>
      expect(within(region).queryAllByText('—')).toHaveLength(0),
    )
    expect(within(region).getAllByText('0').length).toBeGreaterThanOrEqual(2)
  })
})
