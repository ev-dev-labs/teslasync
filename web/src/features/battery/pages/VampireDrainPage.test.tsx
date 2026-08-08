/**
 * VampireDrainPage — contract + hardening tests.
 *
 * VampireDrainPage is the "phantom drain" dashboard. It fans two TanStack
 * Query hooks (drain stats + the paginated parked-window events) out through
 * the real `useUnits` display boundary into a KPI band, a trend/gauge bento, a
 * daily-drain/tips bento, and a drain-sessions table. Every panel is
 * independently gated on select-a-vehicle / loading / error / empty so a user
 * never sees a blank surface.
 *
 * These tests drive the page end-to-end — the real hooks + the real
 * unit-conversion/formatting boundary run against a mocked `request()` — so the
 * branches a user actually hits are exercised:
 *
 *   1. Full render: title, KPI band (avg/median/p95/observed), the drain-rate
 *      gauge (SI %/day), both bento panels, and the sessions table with
 *      per-row badges + SI→°C ambient formatting (incl. the nullable ambient
 *      column rendering "—").
 *   2. No vehicle: an empty fleet keeps every panel on its select-a-vehicle
 *      empty state and — critically — never fires the vampire-drain requests
 *      (the queries stay disabled), so we don't hammer the API for a null id.
 *   3. Loading: the per-panel skeletons replace the KPI cards / gauge / charts
 *      while both queries are in flight, never a half-populated dashboard.
 *   4. Error + graceful degrade: a failed stats query surfaces a retryable
 *      banner in the KPI band and gauge while the independent events query
 *      still renders the trend/daily/table, and Retry re-fires the stats
 *      request.
 *   5. Empty window: a vehicle with a valid stats object but zero qualifying
 *      events shows honest "—" KPIs (not fabricated zeros), an empty gauge,
 *      empty charts, and an empty sessions table — all with the same
 *      no-sessions copy.
 *   6. Sorting: the externally-controlled DataTable re-orders when a column
 *      header is toggled (started_at → duration).
 *   7. a11y: the KPI + bento sections expose landmark regions, the icon-only
 *      refresh control has an accessible name, and the table exposes its
 *      column headers.
 *
 * Network is mocked at the `@/api/client` boundary (repo convention — see the
 * sibling EnergyPage.test.tsx). `useSettings` / `useTimezone` come from the
 * global stubs in src/test-setup.ts, so the real formatters render km / °C / %
 * at 2dp.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

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
import { ToastProvider } from '@/components/feedback/Toast'
import { SelectedVehicleProvider } from '@/store/selectedVehicle'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'
import VampireDrainPage from './VampireDrainPage'
import type { Vehicle } from '@/types/vehicle'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>
const never = () => new Promise<never>(() => {})

/* ── Local mirrors of the page's internal response contracts ───────────── */

interface VampireDrainEvent {
  started_at: string
  ended_at: string
  duration_hours: number
  start_battery_pct: number
  end_battery_pct: number
  drain_pct: number
  drain_pct_per_day: number
  ambient_temp_c_avg: number | null
}

interface VampireDrainStats {
  vehicle_id: number
  event_count: number
  total_observed_hours: number
  avg_drain_pct_per_day: number | null
  median_drain_pct_per_day: number | null
  p95_drain_pct_per_day: number | null
  sample_window_days: number
}

/* ── Fixtures ──────────────────────────────────────────────────────────── */

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 7,
    vehicle_id: 7,
    vin: 'VIN00000000000007',
    display_name: 'Model 3 Test',
    model: 'Model 3',
    trim_badging: 'Long Range',
    exterior_color: 'DeepBlue',
    wheel_type: 'Aero19',
    state: 'online',
    healthy: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  } as Vehicle
}

// Distinct numbers so the display boundary yields unique, unambiguous cells.
const defaultStats: VampireDrainStats = {
  vehicle_id: 7,
  event_count: 3,
  total_observed_hours: 72.5,
  avg_drain_pct_per_day: 2.34,
  median_drain_pct_per_day: 1.81,
  p95_drain_pct_per_day: 4.56,
  sample_window_days: 30,
}

// Durations are deliberately NOT monotonic with time so the sort test can
// observe a reorder: started_at desc = A,B,C (start pct 90,70,50) but
// duration desc = B,C,A (start pct 70,50,90).
const eventA: VampireDrainEvent = {
  started_at: '2025-06-03T20:00:00Z',
  ended_at: '2025-06-04T02:00:00Z',
  duration_hours: 6.0,
  start_battery_pct: 90,
  end_battery_pct: 84,
  drain_pct: 6.0,
  drain_pct_per_day: 8.0,
  ambient_temp_c_avg: 25.0,
}
const eventB: VampireDrainEvent = {
  started_at: '2025-06-02T20:00:00Z',
  ended_at: '2025-06-03T06:00:00Z',
  duration_hours: 10.0,
  start_battery_pct: 70,
  end_battery_pct: 67,
  drain_pct: 3.0,
  drain_pct_per_day: 4.0,
  ambient_temp_c_avg: null,
}
const eventC: VampireDrainEvent = {
  started_at: '2025-06-01T20:00:00Z',
  ended_at: '2025-06-02T04:00:00Z',
  duration_hours: 8.0,
  start_battery_pct: 50,
  end_battery_pct: 49,
  drain_pct: 1.0,
  drain_pct_per_day: 2.0,
  ambient_temp_c_avg: 10.0,
}
const defaultEvents: VampireDrainEvent[] = [eventA, eventB, eventC]

// A valid stats object for a vehicle with no qualifying parked windows: the
// percentile fields are JSON null (a real "no data" signal, not a fabricated 0).
const emptyStats: VampireDrainStats = {
  vehicle_id: 7,
  event_count: 0,
  total_observed_hours: 0,
  avg_drain_pct_per_day: null,
  median_drain_pct_per_day: null,
  p95_drain_pct_per_day: null,
  sample_window_days: 30,
}

interface InstallOpts {
  vehicles?: Vehicle[]
  stats?: VampireDrainStats
  statsPending?: boolean
  statsError?: boolean
  events?: VampireDrainEvent[]
  eventsPending?: boolean
  eventsError?: boolean
}

function install(opts: InstallOpts = {}) {
  const {
    vehicles = [makeVehicle()],
    stats = defaultStats,
    statsPending = false,
    statsError = false,
    events = defaultEvents,
    eventsPending = false,
    eventsError = false,
  } = opts

  mockedRequest.mockImplementation((path: string) => {
    if (path === '/vehicles') return Promise.resolve(vehicles)
    if (path.startsWith('/vampire-drain/stats')) {
      if (statsPending) return never()
      if (statsError) return Promise.reject(new Error('stats boom'))
      return Promise.resolve(stats)
    }
    if (path.startsWith('/vampire-drain')) {
      if (eventsPending) return never()
      if (eventsError) return Promise.reject(new Error('events boom'))
      return Promise.resolve({ vehicle_id: 7, events })
    }
    return Promise.resolve({})
  })
}

const statsCallCount = () =>
  mockedRequest.mock.calls.filter((c) => String(c[0]).startsWith('/vampire-drain/stats')).length
const eventsCallCount = () =>
  mockedRequest.mock.calls.filter((c) => {
    const p = String(c[0])
    return p.startsWith('/vampire-drain') && !p.startsWith('/vampire-drain/stats')
  }).length

function renderPage(initialEntries: string[] = ['/vampire-drain']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SelectedVehicleProvider>
            <VampireDrainPage />
          </SelectedVehicleProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const NO_EVENTS = 'No parked-drain sessions recorded in this window yet.'
const NO_VEHICLE = 'Select a vehicle to view its vampire drain.'

beforeEach(() => {
  mockedRequest.mockReset()
  window.localStorage.clear()
  // fmtNumber / LinearGauge read module-global precision + locale that
  // useSettings would normally seed; pin them so assertions are deterministic.
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
  install()
})

describe('VampireDrainPage', () => {
  it('renders the full dashboard once stats + events load', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Vampire Drain' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Analyze phantom energy loss while your vehicle is parked'),
    ).toBeInTheDocument()

    // KPI band — SI %/day read straight from the stats contract.
    expect(await screen.findByText('2.34%')).toBeInTheDocument() // avg KPI card
    expect(screen.getByText('72.5')).toBeInTheDocument() // observed hours
    // median + p95 appear twice: once in the KPI band and once in the gauge side rail.
    expect(screen.getAllByText('1.81%').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('4.56%').length).toBeGreaterThanOrEqual(2)
    // Session count is echoed by both the observed-hours subtitle and the table badge.
    expect(screen.getAllByText('3 sessions').length).toBeGreaterThanOrEqual(2)

    // Gauge rendered the average as its own value node (direct text node "2.34").
    expect(screen.getByText('2.34')).toBeInTheDocument()
    expect(screen.getByText('Avg %/day')).toBeInTheDocument()

    // Every panel is present — nothing stubbed out.
    expect(screen.getByText('Drain Rate Trend')).toBeInTheDocument()
    expect(screen.getByText('Daily Drain While Parked')).toBeInTheDocument()
    expect(screen.getByText('Tips to Reduce Vampire Drain')).toBeInTheDocument()
    expect(screen.getByText(/Disable Sentry Mode/)).toBeInTheDocument()
    expect(screen.getByText('Drain Sessions')).toBeInTheDocument()
  })

  it('renders the sessions table with per-row values, badges, and SI→°C ambient formatting', async () => {
    renderPage()

    // One row per event: duration, start/end SOC, rate, and the loss badge.
    expect(await screen.findByText('6.0h')).toBeInTheDocument()
    expect(screen.getByText('10.0h')).toBeInTheDocument()
    expect(screen.getByText('8.0h')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('84%')).toBeInTheDocument()
    expect(screen.getByText('8.00')).toBeInTheDocument() // rate %/day, 2dp
    // Loss badges render all three severity branches (>5 danger, >2 warning, else success).
    expect(screen.getByText('6.0%')).toBeInTheDocument()
    expect(screen.getByText('3.0%')).toBeInTheDocument()
    expect(screen.getByText('1.0%')).toBeInTheDocument()

    // Ambient is SI °C → display °C at 2dp; the nullable event renders "—".
    expect(screen.getByText('25.00°C')).toBeInTheDocument()
    expect(screen.getByText('10.00°C')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps every panel on its select-a-vehicle empty state and never queries drain for a null id', async () => {
    install({ vehicles: [] })
    renderPage()

    // KPI band, gauge, trend, daily, and table all fall back to the same copy.
    const empties = await screen.findAllByText(NO_VEHICLE)
    expect(empties.length).toBeGreaterThanOrEqual(4)

    // The fleet is fetched, but the disabled queries must NOT hit the drain API.
    await waitFor(() =>
      expect(mockedRequest.mock.calls.some((c) => c[0] === '/vehicles')).toBe(true),
    )
    expect(statsCallCount()).toBe(0)
    expect(eventsCallCount()).toBe(0)
    // No misleading numbers leak while there is no vehicle in scope.
    expect(screen.queryByText('2.34%')).toBeNull()
  })

  it('shows per-panel skeletons while both queries are in flight', async () => {
    install({ statsPending: true, eventsPending: true })
    const { container } = renderPage()

    // Once the fleet resolves the vehicle is auto-selected, the queries enable,
    // and the panels short-circuit to their skeletons.
    await waitFor(() =>
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(4),
    )
    // The KPI cards / gauge value are withheld — no half-populated dashboard.
    expect(screen.queryByText('Avg Drain / day')).toBeNull()
    expect(screen.queryByText('72.5')).toBeNull()
    // Panel chrome still renders so the layout doesn't collapse.
    expect(screen.getByText('Drain Rate Trend')).toBeInTheDocument()
  })

  it('surfaces a retryable error in the KPI band + gauge while events still render, and Retry refetches', async () => {
    install({ statsError: true })
    renderPage()

    // Network-class failure → the actionable "Can't reach server" banner (KPI + gauge).
    const banners = await screen.findAllByText("Can't reach server")
    expect(banners.length).toBeGreaterThanOrEqual(1)

    // The independent events query is unaffected — the table + charts degrade gracefully.
    expect(await screen.findByText('8.00')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()

    // Retry re-fires the failed stats request.
    const before = statsCallCount()
    expect(before).toBeGreaterThanOrEqual(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    await waitFor(() => expect(statsCallCount()).toBeGreaterThan(before))
  })

  it('renders honest empty states (not fabricated zeros) when a vehicle has no qualifying windows', async () => {
    install({ stats: emptyStats, events: [] })
    renderPage()

    // The KPI band still renders, but the percentile cards read "—", not "0.00%".
    expect(await screen.findByText('Observed Hours')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
    // Both the observed subtitle and the table badge fold to zero sessions.
    expect(screen.getAllByText('0 sessions').length).toBeGreaterThanOrEqual(2)

    // Gauge + trend + daily + table all show the same no-sessions copy.
    expect(screen.getAllByText(NO_EVENTS).length).toBeGreaterThanOrEqual(4)
  })

  it('re-orders the externally-controlled table when a column header is toggled', async () => {
    renderPage()

    // Default sort is started_at desc → newest first (event A, start SOC 90%).
    await screen.findByRole('table')
    const firstRow = () =>
      within(screen.getByRole('table')).getAllByRole('row')[1] // [0] is the header row
    expect(within(firstRow()).getByText('90%')).toBeInTheDocument()

    // Toggle to duration desc → longest first (event B, 10.0h, start SOC 70%).
    fireEvent.click(screen.getByRole('button', { name: 'Duration' }))
    await waitFor(() =>
      expect(within(firstRow()).queryByText('70%')).toBeInTheDocument(),
    )
    expect(within(firstRow()).queryByText('90%')).toBeNull()
  })

  it('exposes landmark regions, an accessible refresh control, and table headers', async () => {
    renderPage()

    // Wait for the sessions table (and its headers) to mount before asserting.
    await screen.findByRole('table')

    // Landmark regions let screen-reader users jump between the summary + bento sections.
    expect(screen.getByRole('region', { name: 'Drain summary' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Drain rate trend and gauge' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Daily drain and reduction tips' })).toBeInTheDocument()

    // The icon-only refresh button carries a unique, descriptive accessible name
    // (distinct from the generic freshness-chip "Refresh" control).
    expect(screen.getByRole('button', { name: 'Refresh vampire drain' })).toBeInTheDocument()

    // The sessions table exposes its column headers.
    expect(screen.getByRole('columnheader', { name: 'Started' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Ambient' })).toBeInTheDocument()
  })
})
