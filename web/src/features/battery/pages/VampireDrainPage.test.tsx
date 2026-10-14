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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.unmock('@/lib/timezone')

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>()
  const { chartTestDoubles } = await import('@/test/chartTestDoubles')
  return {
    ...actual,
    ...chartTestDoubles,
    EmbeddedChart: vi.fn(chartTestDoubles.EmbeddedChart),
  }
})

const widgetFailure = vi.hoisted(() => ({ culprit: false }))
vi.mock('../components/vampire-drain-modernization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/vampire-drain-modernization')>()
  return {
    ...actual,
    VampireCulpritPanel: (props: Parameters<typeof actual.VampireCulpritPanel>[0]) => {
      if (widgetFailure.culprit) throw new Error('Synthetic culprit render failure')
      return <actual.VampireCulpritPanel {...props} />
    },
  }
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
import { EmbeddedChart } from '@/components/charts'
import { ToastProvider } from '@/components/feedback/Toast'
import { SelectedVehicleProvider } from '@/store/selectedVehicle'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'
import * as settingsHooks from '@/hooks/useSettings'
import VampireDrainPage, { buildDailyDrainRollup } from './VampireDrainPage'
import type { Vehicle } from '@/types/vehicle'
import type { ParkTruth, VampireSplit } from '@/types/teslaPhysics'

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
  park?: ParkTruth
  split?: VampireSplit
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
    park,
    split,
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
    if (path.startsWith('/physics/park-truth') && park) return Promise.resolve(park)
    if (path.startsWith('/physics/vampire') && split) return Promise.resolve(split)
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

function metricValues(label: string) {
  return screen.getAllByText(label).map((element) =>
    element.closest('[data-operational-metric]')?.querySelector('[data-operational-value]')?.textContent
      ?? element.closest('[data-stat]')?.querySelector('[data-stat-value]')?.parentElement?.textContent,
  )
}

function sessionsTable() {
  return screen.getByRole('table', { name: 'Drain sessions' })
}

function panelTitle(name: string) {
  return screen.getAllByRole('heading', { name }).find((element) => element.hasAttribute('data-card-title'))
}

beforeEach(() => {
  mockedRequest.mockReset()
  vi.mocked(EmbeddedChart).mockClear()
  widgetFailure.culprit = false
  onlineManager.setOnline(true)
  window.localStorage.clear()
  // fmtNumber / LinearGauge read module-global precision + locale that
  // useSettings would normally seed; pin them so assertions are deterministic.
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
  const settingsResult = settingsHooks.useSettings()
  vi.spyOn(settingsHooks, 'useSettings').mockReturnValue({
    ...settingsResult,
    settings: { ...settingsResult.settings, timezone_user: 'UTC' },
  })
  install()
})

afterEach(() => {
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})

describe('VampireDrainPage', () => {
  it('renders the full dashboard once stats + events load', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Vampire drain' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Analyze phantom energy loss while your vehicle is parked'),
    ).toBeInTheDocument()

    // KPI band — SI %/day read straight from the stats contract.
    await waitFor(() => expect(metricValues('Avg drain / day')).toContain('2.34%'))
    await screen.findByRole('table', { name: 'Drain sessions' })
    expect(metricValues('Observed hours')).toContain('72.50 h')
    // median + p95 appear twice: once in the KPI band and once in the gauge side rail.
    expect(metricValues('Median drain / day').filter((value) => value === '1.81%').length).toBeGreaterThanOrEqual(2)
    expect(metricValues('P95 drain / day').filter((value) => value === '4.56%').length).toBeGreaterThanOrEqual(2)
    // Session count is echoed by both the observed-hours subtitle and the table badge.
    expect(screen.getAllByText('3 sessions').length).toBeGreaterThanOrEqual(2)

    // Gauge rendered the average as its own value node (direct text node "2.34").
    expect(screen.getByRole('meter', { name: 'Avg %/day' })).toHaveAttribute('aria-valuenow', '2.34')
    expect(screen.getByText('Avg %/day')).toBeInTheDocument()

    // Every panel is present — nothing stubbed out.
    expect(panelTitle('Drain rate trend')).toBeInTheDocument()
    expect(panelTitle('Parked sessions by start date')).toBeInTheDocument()
    expect(screen.getByText('Tips to reduce vampire drain')).toBeInTheDocument()
    expect(screen.getByText(/Disable Sentry Mode/)).toBeInTheDocument()
    expect(panelTitle('Drain sessions')).toBeInTheDocument()
  })

  it('renders the sessions table with per-row values, badges, and SI→°C ambient formatting', async () => {
    renderPage()

    const table = within(await screen.findByRole('table', { name: 'Drain sessions' }))
    // One row per event: duration, start/end SOC, rate, and the loss badge.
    expect(table.getByText('6.00h')).toBeInTheDocument()
    expect(table.getByText('10.00h')).toBeInTheDocument()
    expect(table.getByText('8.00h')).toBeInTheDocument()
    expect(table.getByText('90.00%')).toBeInTheDocument()
    expect(table.getByText('84.00%')).toBeInTheDocument()
    expect(table.getByText('8.00')).toBeInTheDocument() // rate %/day, 2dp
    // Loss badges render all three severity branches (>5 danger, >2 warning, else success).
    expect(table.getByText('6.00%')).toBeInTheDocument()
    expect(table.getByText('3.00%')).toBeInTheDocument()
    expect(table.getByText('1.00%')).toBeInTheDocument()

    // Ambient is SI °C → display °C at 2dp; the nullable event renders "—".
    expect(table.getByText('25.00°C')).toBeInTheDocument()
    expect(table.getByText('10.00°C')).toBeInTheDocument()
    expect(table.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('buckets the daily rollup by the vehicle calendar day, not UTC', () => {
    // 00:30 UTC Jan 15 = 19:30 ET Jan 14 → the bucket belongs to Jan 14 in the
    // vehicle's zone (the old UTC slice filed it under Jan 15).
    const buckets = buildDailyDrainRollup(
      [{ ...eventA, started_at: '2026-01-15T00:30:00Z', drain_pct: 2.0, duration_hours: 6.0 }],
      'America/New_York',
    )
    expect(buckets).toEqual([{ date: '2026-01-14', drain_pct: 2.0, hours: 6.0 }])
  })

  it('sums losses per day, sorts oldest-first, and skips unparseable starts', () => {
    const buckets = buildDailyDrainRollup(
      [
        { ...eventA, started_at: '2026-01-16T12:00:00Z', drain_pct: 1.0, duration_hours: 2.0 },
        { ...eventB, started_at: '2026-01-15T12:00:00Z', drain_pct: 3.0, duration_hours: 4.0 },
        { ...eventC, started_at: '2026-01-15T18:00:00Z', drain_pct: 5.0, duration_hours: 6.0 },
        { ...eventC, started_at: 'not-a-date' },
      ],
      'UTC',
    )
    expect(buckets).toEqual([
      { date: '2026-01-15', drain_pct: 8.0, hours: 10.0 },
      { date: '2026-01-16', drain_pct: 1.0, hours: 2.0 },
    ])
  })

  it('keeps a multi-day session intact in its start-date group, including across DST', () => {
    expect(buildDailyDrainRollup([{
      ...eventA,
      started_at: '2026-03-08T04:30:00Z',
      ended_at: '2026-03-10T04:30:00Z',
      duration_hours: 48,
      drain_pct: 7,
    }], 'America/New_York')).toEqual([
      { date: '2026-03-07', drain_pct: 7, hours: 48 },
    ])
  })

  it.each(['', 'not-a-date', undefined, null])('excludes an invalid or missing start (%s) without borrowing its end date', (started_at) => {
    const event = { ...eventA, started_at } as VampireDrainEvent
    expect(buildDailyDrainRollup([event], 'Pacific/Auckland')).toEqual([])
  })

  it('separates sessions on either side of local midnight without splitting their totals', () => {
    expect(buildDailyDrainRollup([
      { ...eventA, started_at: '2026-01-14T10:59:59Z', drain_pct: 6, duration_hours: 30 },
      { ...eventB, started_at: '2026-01-14T11:00:00Z', drain_pct: 3, duration_hours: 10 },
    ], 'Pacific/Auckland')).toEqual([
      { date: '2026-01-14', drain_pct: 6, hours: 30 },
      { date: '2026-01-15', drain_pct: 3, hours: 10 },
    ])
  })

  it('uses the saved display timezone and locale for start-date grouping and chart labels', async () => {
    const settingsResult = settingsHooks.useSettings()
    vi.mocked(settingsHooks.useSettings).mockReturnValue({
      ...settingsResult,
      locale: 'de-DE',
      settings: {
        ...settingsResult.settings,
        locale: 'de-DE',
        tz_display_default: 'user',
        timezone_user: 'America/New_York',
      },
    })
    // A different vehicle zone must not override the saved user display mode.
    install({
      vehicles: [makeVehicle({ timezone: 'Pacific/Auckland' })],
      events: [{
        ...eventA,
        started_at: '2026-01-15T00:30:00Z',
        ended_at: '2026-01-17T00:30:00Z',
        duration_hours: 48,
      }],
    })
    renderPage()
    await screen.findByRole('table', { name: 'Drain sessions' })

    const chart = [...vi.mocked(EmbeddedChart).mock.calls].reverse()
      .find(([props]) => props.chartKey === 'vampire-drain-daily')?.[0]
    expect(chart).toMatchObject({
      title: 'Parked sessions by start date',
      ariaLabel: 'Whole-session battery loss and parked hours grouped by session start date',
      exportData: [{ date: '2026-01-14', drain_pct: 6, hours: 48 }],
    })
    expect(chart?.dataColumns?.[0].label).toBe('Session start date')
    expect(chart?.dataColumns?.[0].format?.('2026-01-14')).toBe('14. Jan. 2026')
    expect(screen.getByText(/Whole-session battery loss and duration are grouped by start date in America\/New_York/)).toBeInTheDocument()
    expect(screen.queryByText('Daily drain while parked')).not.toBeInTheDocument()
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
      expect(container.querySelectorAll('[class*="--skeleton-bg"]').length).toBeGreaterThanOrEqual(4),
    )
    // The KPI cards / gauge value are withheld — no half-populated dashboard.
    expect(screen.getByRole('region', { name: 'Drain summary' }).querySelector('[data-operational-value]')).toBeNull()
    expect(screen.getByRole('region', { name: 'Drain summary' }).querySelectorAll('[data-operational-metric]')).toHaveLength(4)
    expect(screen.getByRole('region', { name: 'Drain summary' }).querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('72.50 h')).toBeNull()
    // Panel chrome still renders so the layout doesn't collapse.
    expect(screen.getByText('Drain rate trend')).toBeInTheDocument()
  })

  it('surfaces a retryable error in the KPI band + gauge while events still render, and Retry refetches', async () => {
    install({ statsError: true })
    renderPage()

    // Network-class failure → the actionable "Can't reach server" banner (KPI + gauge).
    const banners = await screen.findAllByText("Can't reach server")
    expect(banners.length).toBeGreaterThanOrEqual(1)

    // The independent events query is unaffected — the table + charts degrade gracefully.
    const table = within(await screen.findByRole('table', { name: 'Drain sessions' }))
    expect(table.getByText('8.00')).toBeInTheDocument()
    expect(table.getByText('90.00%')).toBeInTheDocument()

    // Retry re-fires the failed stats request.
    const before = statsCallCount()
    const eventsBefore = eventsCallCount()
    expect(before).toBeGreaterThanOrEqual(1)
    // Recovery names its source; retry must not refetch the independent events.
    install()
    fireEvent.click(screen.getByRole('button', { name: 'Retry Vampire-drain statistics', exact: true }))
    await waitFor(() => expect(statsCallCount()).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByRole('button', {
      name: 'Retry Vampire-drain statistics', exact: true,
    })).not.toBeInTheDocument())
    expect(eventsCallCount()).toBe(eventsBefore)
    expect(within(screen.getByRole('region', { name: 'Drain summary' })).getByText('2.34%')).toBeInTheDocument()
    expect(table.getByText('8.00')).toBeInTheDocument()
    expect(table.getByText('90.00%')).toBeInTheDocument()
  })

  it('renders honest empty states (not fabricated zeros) when a vehicle has no qualifying windows', async () => {
    install({ stats: emptyStats, events: [] })
    renderPage()

    // The KPI band still renders, but the percentile cards read "—", not "0.00%".
    expect(await screen.findByText('Observed hours')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
    // Both the observed subtitle and the table badge fold to zero sessions.
    await waitFor(() => expect(screen.getAllByText('0 sessions').length).toBeGreaterThanOrEqual(2))

    // Gauge + trend + daily + table all show the same no-sessions copy.
    expect(screen.getAllByText(NO_EVENTS).length).toBeGreaterThanOrEqual(4)
  })

  it('re-orders the externally-controlled table when a column header is toggled', async () => {
    renderPage()

    // Default sort is started_at desc → newest first (event A, start SOC 90%).
    await screen.findByRole('table', { name: 'Drain sessions' })
    const firstRow = () =>
      within(sessionsTable()).getAllByRole('row')[1] // [0] is the header row
    expect(within(firstRow()).getByText('90.00%')).toBeInTheDocument()

    // Toggle to duration desc → longest first (event B, 10.0h, start SOC 70%).
    fireEvent.click(within(sessionsTable()).getByRole('button', { name: 'Duration' }))
    await waitFor(() =>
      expect(within(firstRow()).queryByText('70.00%')).toBeInTheDocument(),
    )
    expect(within(firstRow()).queryByText('90.00%')).toBeNull()
  })

  it('exposes landmark regions, an accessible refresh control, and table headers', async () => {
    renderPage()

    // Wait for the sessions table (and its headers) to mount before asserting.
    await screen.findByRole('table', { name: 'Drain sessions' })

    // Landmark regions let screen-reader users jump between the summary + bento sections.
    expect(screen.getByRole('region', { name: 'Drain summary' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Drain rate trend and gauge' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Sessions by start date and reduction tips' })).toBeInTheDocument()

    // The icon-only refresh button carries a unique, descriptive accessible name
    // (distinct from the generic freshness-chip "Refresh" control).
    expect(screen.getByRole('button', { name: 'Refresh vampire drain' })).toBeInTheDocument()

    // The sessions table exposes its column headers.
    expect(within(sessionsTable()).getByRole('columnheader', { name: 'Started' })).toBeInTheDocument()
    expect(within(sessionsTable()).getByRole('columnheader', { name: 'Ambient' })).toBeInTheDocument()
  })

  it.each([
    { name: 'measured-zero', value: 0, status: 'Low' },
    { name: 'low-at-boundary', value: 1.5, status: 'Low' },
    { name: 'medium-above-low-boundary', value: 1.51, status: 'Normal' },
    { name: 'medium-at-boundary', value: 3, status: 'Normal' },
    { name: 'high-above-medium-boundary', value: 3.01, status: 'High' },
  ])('announces the unchanged drain threshold for $name', async ({ value, status }) => {
    install({ stats: { ...defaultStats, avg_drain_pct_per_day: value } })
    renderPage()

    const gauge = await screen.findByRole('meter', { name: 'Avg %/day' })
    expect(gauge).toHaveAttribute('aria-valuenow', String(value))
    expect(gauge).toHaveAttribute('aria-valuemin', '0')
    expect(gauge).toHaveAttribute('aria-valuemax', '5')
    expect(gauge).toHaveAccessibleDescription(expect.stringContaining(status))
    expect(within(gauge.parentElement!).getByText(status, { selector: 'span' })).toBeInTheDocument()
    expect(metricValues('Avg drain / day')).toContain(`${value.toFixed(2)}%`)
  })

  it('retains an above-reference reading without publishing an invalid meter range', async () => {
    install({ stats: { ...defaultStats, avg_drain_pct_per_day: 7.25 } })
    renderPage()

    const gauge = await screen.findByRole('group', { name: 'Avg %/day' })
    expect(within(gauge).getByText('7.25')).toBeInTheDocument()
    expect(gauge).toHaveAccessibleDescription(expect.stringContaining('7.25%'))
    expect(gauge).toHaveAccessibleDescription(expect.stringContaining('High'))
    expect(gauge).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByRole('meter', { name: 'Avg %/day' })).not.toBeInTheDocument()
    expect(metricValues('Avg drain / day')).toContain('7.25%')
    expect(screen.getByText('Reference: ~5 %/day is a high phantom-drain rate. Lower is better.')).toBeInTheDocument()
  })

  it.each([
    { name: 'primary-route', route: '/vampire-drain' },
    { name: 'charging-alias', route: '/charging/vampire-drain' },
  ])('keeps selected-vehicle requests bounded and cancellable on $name', async ({ route }) => {
    renderPage([route])
    await screen.findByRole('table', { name: 'Drain sessions' })

    expect(mockedRequest).toHaveBeenCalledWith('/vampire-drain/stats?vehicle_id=7', {
      signal: expect.any(AbortSignal),
    })
    expect(mockedRequest).toHaveBeenCalledWith('/vampire-drain?vehicle_id=7&limit=200', {
      signal: expect.any(AbortSignal),
    })
    expect(screen.getAllByText('30-day sample window').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('combobox', { name: /vehicle|range/i })).not.toBeInTheDocument()
  })

  it('preserves both daily series and all loaded trend observations in chart export inputs', async () => {
    renderPage()
    await screen.findByRole('table', { name: 'Drain sessions' })

    const calls = vi.mocked(EmbeddedChart).mock.calls.map(([props]) => props)
    const trend = [...calls].reverse().find(props => props.chartKey === 'vampire-drain-rate-trend')
    const daily = [...calls].reverse().find(props => props.chartKey === 'vampire-drain-daily')
    expect(trend).toMatchObject({
      toolbar: true, fullscreen: true, exportable: true,
      height: 288, mobileHeight: 224,
      exportData: [
        { date: '2025-06-01T20:00:00Z', rate: 2 },
        { date: '2025-06-02T20:00:00Z', rate: 4 },
        { date: '2025-06-03T20:00:00Z', rate: 8 },
      ],
      dataColumns: [{ key: 'date' }, { key: 'rate' }],
    })
    expect(daily).toMatchObject({
      toolbar: true, fullscreen: true, exportable: true,
      height: 288, mobileHeight: 224,
      exportData: [
        { date: '2025-06-01', drain_pct: 1, hours: 8 },
        { date: '2025-06-02', drain_pct: 3, hours: 10 },
        { date: '2025-06-03', drain_pct: 6, hours: 6 },
      ],
      dataColumns: [{ key: 'date' }, { key: 'drain_pct' }, { key: 'hours' }],
    })
  })

  it('retains statistics and sessions after refresh failures and retries each source independently', async () => {
    renderPage()
    await screen.findByRole('table', { name: 'Drain sessions' })
    const statsBefore = statsCallCount()
    const eventsBefore = eventsCallCount()
    install({ statsError: true, eventsError: true })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh vampire drain' }))

    await screen.findByText('Vampire-drain statistics may be out of date')
    await screen.findByText('Parked-drain events may be out of date')
    expect(statsCallCount()).toBe(statsBefore + 1)
    expect(eventsCallCount()).toBe(eventsBefore + 1)
    expect(metricValues('Avg drain / day')).toContain('2.34%')
    expect(screen.getByRole('meter', { name: 'Avg %/day' })).toHaveAttribute('aria-valuenow', '2.34')
    expect(within(sessionsTable()).getByText('90.00%')).toBeInTheDocument()
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(2)

    install()
    fireEvent.click(screen.getByRole('button', { name: 'Retry Vampire-drain statistics', exact: true }))
    await waitFor(() => expect(screen.queryByText('Vampire-drain statistics may be out of date')).not.toBeInTheDocument())
    expect(screen.getByText('Parked-drain events may be out of date')).toBeInTheDocument()
    expect(eventsCallCount()).toBe(eventsBefore + 1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry Parked-drain events', exact: true }))
    await waitFor(() => expect(screen.queryByText('Parked-drain events may be out of date')).not.toBeInTheDocument())
    expect(statsCallCount()).toBe(statsBefore + 2)
    expect(eventsCallCount()).toBe(eventsBefore + 2)
  })

  it('keeps retained observations visible when offline refresh pauses instead of inventing a fatal failure', async () => {
    renderPage()
    await screen.findByRole('table', { name: 'Drain sessions' })
    const statsBefore = statsCallCount()
    const eventsBefore = eventsCallCount()
    onlineManager.setOnline(false)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh vampire drain' }))

    await screen.findByText('Vampire-drain statistics may be out of date')
    const warnings = screen.getAllByTestId('stale-refresh-warning')
    expect(warnings.filter(warning => warning.getAttribute('data-refresh-blocked') === 'true')).toHaveLength(2)
    expect(statsCallCount()).toBe(statsBefore)
    expect(eventsCallCount()).toBe(eventsBefore)
    expect(metricValues('Avg drain / day')).toContain('2.34%')
    expect(within(sessionsTable()).getByText('90.00%')).toBeInTheDocument()
    expect(screen.queryByText('Parked-drain events are unavailable. Retry the source above.')).not.toBeInTheDocument()
  })

  it('isolates initial events failure without erasing independently available statistics or tips', async () => {
    install({ eventsError: true })
    renderPage()

    await screen.findAllByRole('button', { name: 'Retry Parked-drain events', exact: true })
    expect(screen.getAllByText('Parked-drain events are unavailable. Retry the source above.')).toHaveLength(3)
    expect(metricValues('Avg drain / day')).toContain('2.34%')
    expect(screen.getByRole('meter', { name: 'Avg %/day' })).toHaveAttribute('aria-valuenow', '2.34')
    expect(screen.getByText(/Disable Sentry Mode/)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Drain sessions' })).not.toBeInTheDocument()
    expect(screen.queryByText('0 sessions')).not.toBeInTheDocument()
  })

  it('preserves confirmed-Park exclusions, unknown versus zero split totals and source honesty', async () => {
    install({
      park: {
        confirmed_park: false, park_confirmed_at: null, neutral_rolling: true, gear: 'N',
        sentry_reported: true, sentry_counted: false,
        cabin_overheat_reported: true, cabin_overheat_counted: false,
        preconditioning_reported: true, preconditioning_counted: false,
        rejected: ['neutral_rolling'], honesty: 'Synthetic source: neutral rolling is not confirmed Park.',
      },
      split: {
        vehicle_id: 7,
        complete_plugged: [],
        unplugged: [{
          kind: 'unplugged', started_at: '2025-06-03T20:00:00Z', ended_at: '2025-06-04T02:00:00Z',
          duration_s: 21600, start_soc_pct: 80, end_soc_pct: 80, drain_pct: 0, park_confirmed: true,
        }],
        complete_plugged_drain_pct: null, unplugged_drain_pct: 0,
        honesty: 'Synthetic source: parked SOC loss is measured, watt-hours are not supplied.',
      },
    })
    renderPage()

    const culprit = within(await screen.findByTestId('vampire-culprits'))
    await waitFor(() => expect(culprit.getAllByText('Off')).toHaveLength(3))
    expect(culprit.getByText('Tonight: unknown')).toBeInTheDocument()
    expect(culprit.queryByText(/Turn Sentry off at home tonight/)).not.toBeInTheDocument()
    expect(metricValues('At-limit plugged')).toContain('—')
    expect(metricValues('After unplug')).toContain('0.00%')
    const split = within(screen.getByTestId('vampire-split'))
    expect(split.getAllByText('Synthetic source: parked SOC loss is measured, watt-hours are not supplied.').length).toBeGreaterThanOrEqual(1)
    expect(within(split.getByRole('table')).getByText('0.00%')).toBeInTheDocument()
    expect(within(sessionsTable()).getByText('6.00h')).toBeInTheDocument()
  })

  it('contains a culprit rendering failure while deterministic neighboring widgets remain usable', async () => {
    widgetFailure.culprit = true
    renderPage()

    await screen.findByRole('table', { name: 'Drain sessions' })
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1)
    expect(metricValues('Avg drain / day')).toContain('2.34%')
    expect(screen.getByRole('meter', { name: 'Avg %/day' })).toHaveAttribute('aria-valuenow', '2.34')
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(2)
    expect(within(sessionsTable()).getByText('90.00%')).toBeInTheDocument()
    expect(screen.getByText(/Disable Sentry Mode/)).toBeInTheDocument()
  })
})
