/**
 * EnergyPage — contract + hardening tests.
 *
 * EnergyPage is the "Energy Intelligence" dashboard. It fans independent
 * energy, charging-session, charging-telemetry, and idle-drain queries through
 * the real `useUnits` / `useFormatting` display boundary into an operational
 * brief, KPI band, driver investigation, efficiency/cost hero, lifetime
 * metrics, two gas-comparison cards, four charts, and a sessions table.
 *
 * These tests drive the page end-to-end — the real hooks + real
 * unit-conversion/formatting boundary run against a mocked `request()` — so the
 * branches a user actually hits are exercised:
 *
 *   1. Full render: title, KPI band (SI→display cost/distance), lifetime energy,
 *      charger-type badges, and the recent-sessions table.
 *   2. Gas-savings regression: `gasEquivalent` derives from SI meters converted
 *      to miles for the configured MPG model (200 km → $19.88), NOT raw meters
 *      × 0.12 (which produced a ~$24,000 "equivalent" after the SI cutover).
 *   3. Loading — the dedicated skeleton replaces the page while stats are
 *      in flight, never a half-populated dashboard.
 *   4. Error — a failed stats query surfaces a retryable <QueryError> banner
 *      while the independent sessions table still renders (graceful degrade),
 *      and Retry re-fires the stats request.
 *   5. Empty — replay / brand-new accounts get an honest empty hero (not four
 *      zeroed gauges) plus an empty sessions table, and the cost cards withhold
 *      comparisons when no measured distance or complete cost coverage exists.
 *   6. Anti-stub / a11y — every analytics section renders (four chart panels +
 *      hero + lifetime), charger buckets resolve to all three type labels, and
 *      the landmark regions expose their accessible names.
 *
 * Network is mocked at the `@/api/client` boundary (repo convention — see
 * FleetComparePage.test.tsx). `useSettings` / `useTimezone` come from the global
 * stubs in src/test-setup.ts, so the real formatters render km / kWh / $ at
 * 2dp.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    start: '2025-06-01',
    end: '2025-06-30',
    setRange: vi.fn(),
  }),
}))

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings')
  const settings = {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark',
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 4,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant',
    currency_symbol: '$',
    locale: 'en-US',
    timezone_user: '',
  }
  return {
    ...actual,
    useSettings: () => ({
      settings,
      isMiles: false,
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { SelectedVehicleProvider } from '@/store/selectedVehicle'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'
import EnergyPage from './EnergyPage'
import type { EnergyStats } from '@/types/energy'
import type { ChargingSession } from '@/api/types'
import type { Vehicle } from '@/types/vehicle'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>
const never = () => new Promise<never>(() => {})

/* ── Fixtures ─────────────────────────────────────────── */

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

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 100,
    vehicle_id: 7,
    started_at: '2025-06-01T02:00:00Z',
    ended_at: '2025-06-01T03:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 60,
    delta_soc_pct: 40,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 10000,
    peak_power_w: 50000,
    avg_power_w: 40000,
    cost_decimal: 2,
    cost_currency: 'USD',
    charger_type: null,
    cable_type: null,
    startedAt: '2025-06-01T02:00:00Z',
    duration_min: 60,
    ...overrides,
  }
}

// Numbers picked so the display boundary yields clean, unique assertions:
//   total_distance_m 200_000 → 200 km; costs sum to $10; energy sums to 45 kWh.
const defaultStats: EnergyStats = {
  vehicle_id: 7,
  period_days: 30,
  total_energy_used_wh: 40000,
  total_energy_charged_wh: 45000,
  total_wh: 45000,
  total_cost: 12,
  total_distance_m: 200000,
  avg_efficiency_wh_per_m: 0.18,
  co2_saved_kg: 30,
  daily_breakdown: [
    { date: '2025-06-01', energy_wh: 10000, cost: 3, distance_m: 50000, efficiency_wh_per_m: 0.2 },
    { date: '2025-06-02', energy_wh: 12000, cost: 4, distance_m: 60000, efficiency_wh_per_m: 0.19 },
    { date: '2025-06-03', energy_wh: 14000, cost: 2, distance_m: 90000, efficiency_wh_per_m: 0.16 },
    // The start-bounded endpoint can include rows after a historical range's
    // selected end. The page must filter these before deriving its metrics.
    { date: '2025-07-01', energy_wh: 100000, cost: 20, distance_m: 1000000, efficiency_wh_per_m: 0.1 },
  ],
};

// One session per charger family so the breakdown resolves all three labels:
//   Tesla → Supercharger, non-Tesla type (CCS) → DC Fast, null → Home/AC.
const defaultSessions: ChargingSession[] = [
  makeSession({
    id: 101,
    total_energy_added_wh: 20000,
    cost_decimal: 5,
    charger_type: 'Tesla Supercharger',
    started_at: '2025-06-01T02:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 60,
    peak_power_w: 120000,
  }),
  makeSession({
    id: 102,
    total_energy_added_wh: 15000,
    cost_decimal: 3,
    charger_type: 'CCS',
    started_at: '2025-06-02T09:00:00Z',
    start_soc_pct: 40,
    end_soc_pct: 70,
    peak_power_w: 50000,
  }),
  makeSession({
    id: 103,
    total_energy_added_wh: 10000,
    cost_decimal: 2,
    charger_type: null,
    started_at: '2025-06-03T20:00:00Z',
    start_soc_pct: 50,
    end_soc_pct: 80,
    peak_power_w: 7000,
  }),
]

interface InstallOpts {
  vehicles?: Vehicle[]
  stats?: EnergyStats | null
  statsPending?: boolean
  statsError?: boolean
  sessions?: ChargingSession[]
  sessionsError?: boolean
  telemetry?: unknown
  idleStats?: {
    event_count: number
    total_observed_hours: number
    avg_drain_pct_per_day: number | null
    median_drain_pct_per_day: number | null
    p95_drain_pct_per_day: number | null
    sample_window_days: number
  }
  idleError?: boolean
}

function install(opts: InstallOpts = {}) {
  const {
    vehicles = [makeVehicle()],
    stats = defaultStats,
    statsPending = false,
    statsError = false,
    sessions = defaultSessions,
    sessionsError = false,
    telemetry = { vehicle_id: 7, ts: '2025-06-03T20:00:00Z', lifetime_energy_used: 54321 },
    idleStats = {
      event_count: 8,
      total_observed_hours: 320,
      avg_drain_pct_per_day: 1.2,
      median_drain_pct_per_day: 0.9,
      p95_drain_pct_per_day: 2.4,
      sample_window_days: 90,
    },
    idleError = false,
  } = opts

  mockedRequest.mockImplementation((path: string) => {
    if (path === '/vehicles') return Promise.resolve(vehicles)
    if (path.includes('/energy?start=')) {
      if (statsPending) return never()
      if (statsError) return Promise.reject(new Error('energy boom'))
      return Promise.resolve(stats)
    }
    if (path.startsWith('/charging?')) {
      return sessionsError
        ? Promise.reject(new Error('charging history boom'))
        : Promise.resolve(sessions)
    }
    if (path.startsWith('/charging-telemetry/latest')) return Promise.resolve(telemetry)
    if (path.startsWith('/vampire-drain/stats')) {
      return idleError
        ? Promise.reject(new Error('idle drain boom'))
        : Promise.resolve(idleStats)
    }
    if (path.startsWith('/saved-views')) return Promise.resolve([])
    if (path.startsWith('/annotations')) return Promise.resolve([])
    return Promise.resolve({})
  })
}

const energyCallCount = () =>
  mockedRequest.mock.calls.filter((c) => String(c[0]).includes('/energy?start=')).length

function renderPage(initialEntries: string[] = ['/energy']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SelectedVehicleProvider>
            <EnergyPage />
          </SelectedVehicleProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
  window.localStorage.clear()
  // fmtNumber/fmtInt read module-global precision/locale that useSettings would
  // normally seed; pin them so assertions are deterministic.
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
  install()
})

describe('EnergyPage', () => {
  it('renders the full dashboard once stats + sessions load', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Energy Intelligence' }),
    ).toBeInTheDocument()

    // KPI band derived at the SI→display boundary: 200_000 m → "200 km",
    // $10 over 45 kWh → "$0.22"/kWh, $10 over 200 km → "$0.05"/km.
    expect(await screen.findByText('200 km')).toBeInTheDocument()
    expect(screen.getByText('$0.22')).toBeInTheDocument()
    expect(screen.getByText('$0.05')).toBeInTheDocument()
    // Yearly projection appears both as a KPI and as the annual card EV cost.
    expect(screen.getAllByText('$121.67').length).toBeGreaterThan(0)

    // Lifetime energy comes straight from live charging telemetry.
    expect(screen.getByText('54,321.00')).toBeInTheDocument()

    // The decision brief combines measured drive consumption, real 90-day
    // parked-drain evidence, a usage projection, and explicit unsupported
    // charging-loss semantics instead of manufacturing a percentage.
    expect(screen.getByText('1.20%/day')).toBeInTheDocument()
    expect(screen.getByText('Projected 30-day use')).toBeInTheDocument()
    expect(screen.getByText('Not measured')).toBeInTheDocument()
    expect(screen.getByText('Efficiency driver investigation')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review temperature impact' })).toHaveAttribute('href', '/temperature-impact')
    expect(screen.getByRole('link', { name: 'Review speed profile' })).toHaveAttribute('href', '/speed-profile')
    expect(screen.getByRole('link', { name: 'Review route efficiency' })).toHaveAttribute('href', '/route-efficiency')

    // Recent-sessions table renders real rows with per-type badges. 'CCS' is
    // the raw type echoed only in the table; 'Supercharger' also appears in the
    // charger-breakdown legend.
    expect(screen.getByText('Recent Charging Sessions')).toBeInTheDocument()
    expect(screen.getByText('CCS')).toBeInTheDocument()
    expect(screen.getAllByText('Supercharger').length).toBeGreaterThan(0)
  })

  it('projects gas savings from SI distance and configured fuel assumptions', async () => {
    renderPage()

    // The period-total card is labelled with the resolved window length.
    expect(await screen.findByText('30-Day Total')).toBeInTheDocument()

    // 200 km → 124.27 mi; /25 mpg × $4/gal = $19.88 gas equivalent.
    // Recorded EV cost is $10, so modeled savings are $9.88.
    expect(await screen.findByText('$19.88')).toBeInTheDocument()
    expect(await screen.findByText('$9.88')).toBeInTheDocument()

    // Regression guard: raw-meters × 0.12 would have printed "$24,000.00".
    expect(screen.queryByText('$24,000.00')).toBeNull()
  })

  it('labels a charging-cost premium honestly instead of calling it savings', async () => {
    install({
      sessions: [
        makeSession({
          id: 201,
          total_energy_added_wh: 45000,
          cost_decimal: 30,
        }),
      ],
    })
    renderPage()

    expect(
      await screen.findByText('Recorded electric cost exceeds the gas model'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Higher by')).toHaveLength(2)
    expect(screen.getByText('$10.12')).toBeInTheDocument()
    expect(screen.getAllByText(/more$/)).toHaveLength(2)
    expect(screen.queryByText('Electric operation remains cost-favorable')).not.toBeInTheDocument()
  })

  it('shows the loading skeleton while energy stats are in flight', async () => {
    install({ statsPending: true })
    renderPage()

    // Once the fleet loads and the vehicle is auto-selected, the stats query is
    // enabled and the page short-circuits to its dedicated skeleton.
    expect(await screen.findByTestId('energy-page-skeleton')).toBeInTheDocument()
    // The real dashboard chrome is withheld during loading.
    expect(screen.queryByRole('heading', { level: 1, name: 'Energy Intelligence' })).toBeNull()
    expect(screen.queryByText('Recent Charging Sessions')).toBeNull()
  })

  it('surfaces a retryable error banner and still degrades gracefully when stats fail', async () => {
    install({ statsError: true })
    renderPage()

    // Network-class failure → the actionable "Can't reach server" banner.
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry' })

    // The independent sessions query is unaffected — the table still renders.
    expect(await screen.findByText('CCS')).toBeInTheDocument()

    // Retry re-fires the failed stats request.
    const before = energyCallCount()
    expect(before).toBeGreaterThanOrEqual(1)
    fireEvent.click(retry)
    await waitFor(() => expect(energyCallCount()).toBeGreaterThan(before))
  })

  it('renders an honest empty hero and withholds unsupported savings', async () => {
    // No vehicles → selection is null → stats + sessions queries stay disabled.
    install({ vehicles: [], stats: null, sessions: [] })
    renderPage()

    // Honest empty hero instead of four misleading zero gauges.
    expect(await screen.findByText(/No energy data yet/i)).toBeInTheDocument()
    expect(
      screen.getByText('No charging sessions fall within the selected analysis window.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No charger-type energy is available for the selected analysis window.'),
    ).toBeInTheDocument()
    // The sessions table degrades to its own empty state, not a blank panel.
    expect(screen.getByText('No charging sessions recorded')).toBeInTheDocument()

    // No drive distance or cost coverage means savings are unknown, not zero.
    expect(screen.queryByText(/0\.00% less/)).toBeNull()
    expect(
      screen.getAllByText('Complete charging-cost coverage is required before savings are modeled.'),
    ).toHaveLength(2)
  })

  it('keeps supported sections visible when an independent source fails', async () => {
    install({ idleError: true })
    renderPage()

    expect(await screen.findByTestId('energy-partial-data')).toHaveTextContent(
      'Unavailable sources: idle-drain history.',
    )
    expect(screen.getByText('Recent Charging Sessions')).toBeInTheDocument()
    expect(screen.getByText('CCS')).toBeInTheDocument()
    expect(screen.getByText('Not measured')).toBeInTheDocument()
  })

  it('withholds savings and projections when session cost coverage is partial', async () => {
    install({
      sessions: [
        makeSession({ id: 201, total_energy_added_wh: 10000, cost_decimal: 2 }),
        makeSession({ id: 202, total_energy_added_wh: 12000, cost_decimal: null }),
      ],
    })
    renderPage()

    expect(await screen.findByText('Cost coverage is partial')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 returned sessions include cost/)).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Complete charging-cost coverage is required before savings are modeled.'),
    ).toHaveLength(2)
  })

  it('renders every analytics section with accessible landmarks (no stubbed panels)', async () => {
    renderPage()

    // Charger buckets resolve to all three human-readable family labels once the
    // sessions query settles (this also anchors the section assertions below).
    expect(await screen.findByText('DC Fast')).toBeInTheDocument()
    expect(screen.getByText('Home/AC')).toBeInTheDocument()

    // All four chart panels + hero + lifetime are present — nothing stubbed out.
    expect(screen.getByText('Energy & Cost Daily')).toBeInTheDocument()
    expect(screen.getByText('Efficiency Trend')).toBeInTheDocument()
    expect(screen.getByText('Charging by Time of Day')).toBeInTheDocument()
    expect(screen.getByText('Charger Type Breakdown')).toBeInTheDocument()
    expect(screen.getByText('Efficiency & Cost Overview')).toBeInTheDocument()
    expect(screen.getByText('Lifetime Metrics')).toBeInTheDocument()

    // Landmark regions expose their accessible names for screen-reader nav.
    expect(screen.getByRole('region', { name: 'Energy overview' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Cost savings versus gas' })).toBeInTheDocument()
  })
})
