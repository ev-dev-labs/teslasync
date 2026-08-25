/**
 * TimelinePage contract tests.
 *
 * TimelinePage fans two TanStack Query hooks — GET /vehicle-states/timeline
 * (FSM transition events) and GET /vehicle-states/summary (per-state dwell +
 * transition counts) — plus the fleet list into a vehicle picker, a four-tile
 * KPI band, a proportional state-distribution bar, a daily-breakdown chart, a
 * per-state dwell panel, and a paginated transitions table. These tests drive
 * the page end-to-end (real hooks + real formatting boundary against a mocked
 * `request()`), covering every branch a user can reach:
 *
 *   1. Full render: title, KPI band, all four section panels, and the
 *      transitions table populated from the timeline payload.
 *   2. Duration formatting at the hour/minute boundary — the regression this
 *      elevation fixes: 7199s must render "2h" (never "1h 60m") and 3599s must
 *      render "1h" (never "60m").
 *   3. Empty payloads → every section shows its explicit EmptyState copy and
 *      the KPI band still renders zeroed values (never a hidden section).
 *   4. Both state queries pending → the page shows its spinner shell, never the
 *      KPI band.
 *   5. A timeline fetch failure → an <AlertBanner> with the error message,
 *      while the page shell still renders.
 *   6. The icon-only refresh control exposes an accessible name and refetches.
 *   7. The labelled vehicle selector lists the fleet and re-scopes the queries
 *      to the picked vehicle.
 *
 * Network is mocked at the `@/api/client` boundary (the repo convention — see
 * FleetComparePage.test.tsx / DiskForecastPage.test.tsx). `useSettings` /
 * `useTimezone` come from the global stubs in src/test-setup.ts; react-i18next
 * is stubbed locally so the English fallbacks render deterministically.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>()
  const { chartTestDoubles } = await import('@/test/chartTestDoubles')
  return { ...actual, ...chartTestDoubles }
})

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        const interpolate = (s: string) =>
          opts
            ? Object.keys(opts).reduce(
                (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
                s,
              )
            : s
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { SelectedVehicleProvider } from '@/store/selectedVehicle'
import TimelinePage from './TimelinePage'
import type { Vehicle } from '@/types/vehicle'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

/* ── Fixtures ─────────────────────────────────────────── */

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN0000000000001',
    display_name: 'Model 3 LR',
    model: 'Model 3',
    trim_badging: 'Long Range',
    exterior_color: 'DeepBlue',
    wheel_type: 'Aero19',
    state: 'online',
    healthy: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

interface ByStateRow {
  state: string
  total_seconds: number
  percentage: number
  transition_count: number
}

// Vehicle 1 dwell chosen so the KPI band exercises the boundary bug fix:
//   driving  7199s (1h59m59s) → "2h"  (never "1h 60m")
//   charging 3599s (59m59s)   → "1h"  (never "60m")
//   idle+sleep = online 1000 + asleep 500 = 1500s → "25m"
//   totalTransitions = 4 + 3 + 2 + 1 = 10
const summaryRowsV1: ByStateRow[] = [
  { state: 'driving', total_seconds: 7199, percentage: 58.5, transition_count: 4 },
  { state: 'charging', total_seconds: 3599, percentage: 29.3, transition_count: 3 },
  { state: 'online', total_seconds: 1000, percentage: 8.1, transition_count: 2 },
  { state: 'asleep', total_seconds: 500, percentage: 4.1, transition_count: 1 },
]

// Vehicle 2 has a deliberately distinct transition total (5 + 2 = 7) so a
// vehicle switch is observable purely from rendered output.
const summaryRowsV2: ByStateRow[] = [
  { state: 'driving', total_seconds: 3600, percentage: 66.7, transition_count: 5 },
  { state: 'charging', total_seconds: 1800, percentage: 33.3, transition_count: 2 },
]

function summaryFor(id: number) {
  const rows = id === 2 ? summaryRowsV2 : summaryRowsV1
  const total = rows.reduce((s, r) => s + r.total_seconds, 0)
  return { vehicle_id: id, days: 7, total_seconds: total, by_state: rows }
}

const transitions = [
  { ts: '2025-03-01T10:00:00Z', from_state: 'asleep', to_state: 'driving', trigger_field: 'shift_state', trigger_value: 'D' },
  { ts: '2025-03-01T11:00:00Z', from_state: 'driving', to_state: 'charging', trigger_field: 'charge_state', trigger_value: null },
  { ts: '2025-03-02T09:00:00Z', from_state: 'charging', to_state: 'online', trigger_field: null, trigger_value: null },
]

const never = () => new Promise<never>(() => {})
const idOf = (path: string) =>
  new URLSearchParams(path.split('?')[1] ?? '').get('vehicle_id')

interface InstallOptions {
  vehicles?: Vehicle[]
  timelinePending?: boolean
  summaryPending?: boolean
  timelineError?: boolean
  summaryError?: boolean
  emptyTimeline?: boolean
  emptySummary?: boolean
}

function install(opts: InstallOptions = {}) {
  const {
    vehicles = [
      makeVehicle(),
      makeVehicle({ id: 2, vehicle_id: 2, vin: 'VIN0000000000002', display_name: 'Model Y P', model: 'Model Y' }),
    ],
    timelinePending = false,
    summaryPending = false,
    timelineError = false,
    summaryError = false,
    emptyTimeline = false,
    emptySummary = false,
  } = opts

  mockedRequest.mockImplementation((path: string) => {
    if (path === '/vehicles') return Promise.resolve(vehicles)
    if (path.startsWith('/vehicle-states/timeline')) {
      if (timelinePending) return never()
      if (timelineError) return Promise.reject(new Error('timeline boom'))
      if (emptyTimeline) return Promise.resolve({ transitions: [] })
      return Promise.resolve({ transitions })
    }
    if (path.startsWith('/vehicle-states/summary')) {
      if (summaryPending) return never()
      if (summaryError) return Promise.reject(new Error('summary boom'))
      if (emptySummary) return Promise.resolve({ vehicle_id: 1, days: 7, total_seconds: 0, by_state: [] })
      return Promise.resolve(summaryFor(Number(idOf(path) ?? '1')))
    }
    return Promise.resolve({})
  })
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  return render(
    <MemoryRouter initialEntries={['/timeline']}>
      <QueryClientProvider client={client}>
        <SelectedVehicleProvider>
          <TimelinePage />
        </SelectedVehicleProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
  window.localStorage.clear()
  install()
})

describe('TimelinePage', () => {
  it('renders the KPI band, every section panel, and the transitions table', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Timeline' }),
    ).toBeInTheDocument()

    // Wait for the summary to settle — Total Transitions = sum of the per-state
    // transition counts (4 + 3 + 2 + 1 = 10).
    expect(await screen.findByText('10', {}, { timeout: 8000 })).toBeInTheDocument()
    const kpiBand = screen.getByRole('region', { name: 'Summary metrics' })
    expect(within(kpiBand).getByText('Total Transitions')).toBeInTheDocument()
    expect(within(kpiBand).getByText('Total Transitions')).toBeInTheDocument()

    // All four section panels render their titles (never hidden).
    expect(screen.getByText('State Distribution')).toBeInTheDocument()
    expect(screen.getByText('Daily Breakdown')).toBeInTheDocument()
    expect(screen.getByText('Time by State')).toBeInTheDocument()
    expect(screen.getByText('State Transitions')).toBeInTheDocument()

    // Regression: EmbeddedChart used to default to fluid sizing, silently
    // ignoring these explicit heights. ResponsiveContainer then measured an
    // auto-sized grid track and expanded the chart down the entire page.
    const dailyChart = screen.getByRole('img', {
      name: 'Daily transition counts by vehicle state',
    })
    expect(dailyChart).toHaveAttribute('data-chart-height', '256')
    expect(dailyChart).toHaveAttribute('data-chart-mobile-height', '224')
    expect(dailyChart).toHaveAttribute('data-chart-fluid', 'false')

    // With data present, sections are NOT showing their empty copy.
    expect(screen.queryByText('No daily transition activity yet')).toBeNull()
    expect(screen.queryByText('No state transitions recorded')).toBeNull()

    // Transitions table: one row per event, with trigger fields + state badges.
    const table = screen.getByRole('table')
    expect(within(table).getByText('shift_state')).toBeInTheDocument()
    expect(within(table).getByText('charge_state')).toBeInTheDocument()
    // 'driving' surfaces as row1 to_state AND row2 from_state.
    expect(within(table).getAllByText('driving').length).toBe(2)
  })

  it('formats dwell durations without rolling over to "60m" / "1h 60m"', async () => {
    renderPage()

    // Settle the summary (Total Transitions = 10), then read the KPI band fresh.
    await screen.findByText('10', {}, { timeout: 8000 })
    const kpiBand = screen.getByRole('region', { name: 'Summary metrics' })

    // 7199s → "2h", 3599s → "1h", 1500s → "25m".
    expect(within(kpiBand).getByText('2h')).toBeInTheDocument()
    expect(within(kpiBand).getByText('1h')).toBeInTheDocument()
    expect(within(kpiBand).getByText('25m')).toBeInTheDocument()

    // The regression guard: neither overflow string is ever emitted.
    expect(within(kpiBand).queryByText('1h 60m')).toBeNull()
    expect(within(kpiBand).queryByText('60m')).toBeNull()
  })

  it('degrades every section to an explicit empty state when there is no activity', async () => {
    install({ emptyTimeline: true, emptySummary: true })
    renderPage()

    // Table + daily-breakdown empty copy.
    expect(await screen.findByText('No state transitions recorded')).toBeInTheDocument()
    expect(screen.getByText('No daily transition activity yet')).toBeInTheDocument()
    // Shared copy used by BOTH the distribution bar and the time-by-state panel.
    expect(screen.getAllByText('No state distribution available yet').length).toBe(2)

    // The KPI band still renders zeroed values rather than vanishing.
    const kpiBand = screen.getByRole('region', { name: 'Summary metrics' })
    expect(within(kpiBand).getByText('Total Transitions')).toBeInTheDocument()
    expect(within(kpiBand).getAllByText('0m').length).toBe(3)
  })

  it('shows the page-level loading shell while both state queries are pending', async () => {
    install({ timelinePending: true, summaryPending: true })
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Timeline' }),
    ).toBeInTheDocument()

    // Once the vehicle is auto-selected and the queries start fetching, the
    // page swaps to its spinner shell — the KPI band is gone.
    await waitFor(() =>
      expect(screen.getByRole('status', { name: /Loading/ })).toBeInTheDocument(),
    )
    expect(screen.queryByText('Total Transitions')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Summary metrics' })).toBeNull()
  })

  it('surfaces an AlertBanner when the timeline query fails', async () => {
    install({ timelineError: true })
    renderPage()

    // AlertBanner interpolates the fallback title + the normalised error text.
    expect(
      await screen.findByText('Failed to load data: timeline boom'),
    ).toBeInTheDocument()

    // The banner does not replace the page — the shell + KPI band still render.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Timeline' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Summary metrics' }),
    ).toBeInTheDocument()
  })

  it('refetches through the accessible icon-only refresh control', async () => {
    renderPage()

    // Settle the initial load before interacting.
    await screen.findByText('10', {}, { timeout: 8000 })

    // The icon-only button carries a distinct accessible name (the a11y fix);
    // it must not collide with the DataFreshness "Refresh" control.
    const refresh = screen.getByRole('button', { name: 'Refresh timeline' })
    expect(refresh).toBeInTheDocument()

    const before = mockedRequest.mock.calls.length
    fireEvent.click(refresh)

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(before),
    )
  })

  it('lists the fleet and re-scopes the queries when a vehicle is picked', async () => {
    renderPage()

    const select = (await screen.findByLabelText('Select Vehicle')) as HTMLSelectElement
    expect(within(select).getByRole('option', { name: 'Model 3 LR' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Model Y P' })).toBeInTheDocument()

    // Vehicle 1 is auto-selected → 10 transitions in the KPI band.
    await screen.findByText('10', {}, { timeout: 8000 })

    fireEvent.change(select, { target: { value: '2' } })

    // Vehicle 2's distinct total (7) proves the queries re-scoped to it.
    expect(await screen.findByText('7', {}, { timeout: 8000 })).toBeInTheDocument()
    const kpiBand = screen.getByRole('region', { name: 'Summary metrics' })
    expect(within(kpiBand).getByText('7')).toBeInTheDocument()
    expect(within(kpiBand).queryByText('10')).toBeNull()
  })

  it('opens state-transition evidence without leaving the timeline', async () => {
    renderPage()

    const inspect = await screen.findByRole('button', {
      name: 'Inspect transition asleep to driving',
    })
    fireEvent.click(inspect)

    const drawer = screen.getByRole('dialog', { name: 'asleep → driving' })
    expect(within(drawer).getByText('State transition')).toBeInTheDocument()
    expect(within(drawer).getByText('shift_state')).toBeInTheDocument()
    expect(within(drawer).getByText('D')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'Vehicle' }))
      .toHaveAttribute('href', '/vehicles/1')
    expect(within(drawer).getByRole('link', { name: 'Telemetry evidence' }))
      .toHaveAttribute(
        'href',
        '/signals?from=2025-03-01&to=2025-03-01&signals=shift_state',
      )

    fireEvent.click(within(drawer).getByText('Close'))
    expect(screen.queryByRole('dialog', { name: 'asleep → driving' })).toBeNull()
  })
})
