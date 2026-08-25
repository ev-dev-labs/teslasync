/**
 * CostAnalysisPage — contract + hardening tests.
 *
 * CostAnalysisPage is the "Cost Analysis" dashboard. It fans two TanStack
 * Query hooks (paginated charging sessions + a deterministic cost forecast)
 * through the real `useCostAnalysisData` derive + the real
 * `useUnits`/`useFormatting` SI→display boundary into nine sections: a KPI
 * band, two cost-trend charts, a charger-type breakdown, a gas-vs-EV savings
 * calculator, a monthly breakdown table, a time-of-use analysis, a forecast
 * section, and a lifetime + environmental-impact pair.
 *
 * These tests drive the page end-to-end — real derive hook + real
 * unit-conversion/formatting boundary against a mocked `request()` — so the
 * branches a user actually hits are exercised:
 *
 *   1. Full render: title, all nine section headings, KPI band (SI→display
 *      cost/energy/distance), resolved charger-type family labels, and the
 *      monthly table rows.
 *   2. Cost-per-distance regression: `costPerDist` derives from SI meters
 *      converted ONCE to the display unit ($0.060/km for 100 km @ $6), NOT the
 *      pre-SI double-conversion that inflated it ~1600x to ~$96.56/km. The gas
 *      calculator's gallons still derive from miles (mpg is miles-based).
 *   3. Loading — while sessions are in flight the data sections show their
 *      loading affordances (chart spinners) and the KPI values are withheld,
 *      never a half-populated dashboard.
 *   4. Error — a failed sessions query surfaces retryable "Can't reach server"
 *      banners while the independent forecast section still renders its chart
 *      (graceful degrade), and Retry re-fires the sessions request.
 *   5. Empty — brand-new / replay accounts get honest per-section empty states
 *      (and zeroed KPI cards) with no divide-by-zero in the savings math.
 *   6. Savings calculator interaction — editing the gas price recomputes the
 *      gas-equivalent cost, and Reset Defaults restores it.
 *   7. a11y + anti-stub — the landmark regions expose accessible names and the
 *      opt-in AI narration stays absent in ai_mode='off' (deterministic content
 *      is always the canonical view).
 *
 * Network is mocked at the `@/api/client` boundary (repo convention — see
 * EnergyPage.test.tsx). `useSettings` / `useTimezone` come from the global
 * stubs in src/test-setup.ts (km / °C / ai_mode='off'), so the real formatters
 * render km / kWh / $ at 2dp.
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

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { SelectedVehicleProvider } from '@/store/selectedVehicle'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'
import CostAnalysisPage from './CostAnalysisPage'
import type { ChargingSession } from '@/api/types'
import type { CostForecastData } from '@/types/charging'
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
    id: 1,
    vehicle_id: 7,
    started_at: '2025-06-15T12:00:00Z',
    ended_at: '2025-06-15T13:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 60,
    delta_soc_pct: 40,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 10000,
    peak_power_w: 7000,
    avg_power_w: 6000,
    cost_decimal: 2,
    cost_currency: 'USD',
    charger_type: null,
    cable_type: null,
    startedAt: '2025-06-15T12:00:00Z',
    duration_min: 60,
    ...overrides,
  }
}

// Numbers picked so the SI→display boundary yields clean, unique assertions:
//   - 3 sessions across 3 months (2025-04 / -05 / -06)
//   - costs sum to $6.00, energy sums to 60 kWh → avg $0.100/kWh
//   - one session moved the odometer exactly 100 km → cost-per-km = $0.060
//   - one session per charger family so the breakdown resolves all three labels
const defaultSessions: ChargingSession[] = [
  makeSession({
    id: 1,
    started_at: '2025-04-15T12:00:00Z',
    ended_at: '2025-04-15T13:00:00Z',
    total_energy_added_wh: 30000,
    cost_decimal: 3.6,
    start_odometer_m: 0,
    end_odometer_m: 100000, // 100 km moved → drives cost-per-distance
    charger_type: 'Tesla Supercharger',
    peak_power_w: 120000,
  }),
  makeSession({
    id: 2,
    started_at: '2025-05-15T12:00:00Z',
    ended_at: '2025-05-15T13:00:00Z',
    total_energy_added_wh: 20000,
    cost_decimal: 2.4,
    charger_type: null,
    peak_power_w: 7000, // Home / AC
  }),
  makeSession({
    id: 3,
    started_at: '2025-06-15T12:00:00Z',
    ended_at: '2025-06-15T13:00:00Z',
    total_energy_added_wh: 10000,
    cost_decimal: 0, // free session
    charger_type: 'CCS',
    peak_power_w: 50000, // Public DC (>22kW, non-Tesla)
  }),
]

const defaultForecast: CostForecastData = {
  historical: [
    { month: '2025-02', cost: 40, kwh: 300, sessions: 8, cost_per_kwh: 0.133 },
    { month: '2025-03', cost: 45, kwh: 320, sessions: 9, cost_per_kwh: 0.14 },
    { month: '2025-04', cost: 50, kwh: 350, sessions: 10, cost_per_kwh: 0.143 },
  ],
  forecast: [
    { month: '2025-05', cost: 52, cost_low: 48, cost_high: 56, kwh: 360 },
    { month: '2025-06', cost: 54, cost_low: 49, cost_high: 59, kwh: 370 },
  ],
  breakdown: {
    home: { pct: 70, avg_cost_per_kwh: 0.12, monthly_avg: 35 },
    supercharger: { pct: 30, avg_cost_per_kwh: 0.34, monthly_avg: 15 },
  },
  gas_comparison: {
    avg_km_per_month: 1200,
    gas_cost_per_month: 120,
    ev_cost_per_month: 50,
    monthly_savings: 70,
    annual_savings: 840,
    lifetime_savings: 8400,
  },
  insights: ['You charge mostly at home — great for savings.'],
}

const emptyForecast: CostForecastData = {
  historical: [],
  forecast: [],
  breakdown: {
    home: { pct: 0, avg_cost_per_kwh: 0, monthly_avg: 0 },
    supercharger: { pct: 0, avg_cost_per_kwh: 0, monthly_avg: 0 },
  },
  gas_comparison: {
    avg_km_per_month: 0,
    gas_cost_per_month: 0,
    ev_cost_per_month: 0,
    monthly_savings: 0,
    annual_savings: 0,
    lifetime_savings: 0,
  },
  insights: [],
}

interface InstallOpts {
  vehicles?: Vehicle[]
  sessions?: ChargingSession[]
  sessionsPending?: boolean
  sessionsError?: boolean
  forecast?: CostForecastData | null
  forecastError?: boolean
}

function install(opts: InstallOpts = {}) {
  const {
    vehicles = [makeVehicle()],
    sessions = defaultSessions,
    sessionsPending = false,
    sessionsError = false,
    forecast = defaultForecast,
    forecastError = false,
  } = opts

  mockedRequest.mockImplementation((path: string) => {
    if (path === '/vehicles') return Promise.resolve(vehicles)
    if (path.startsWith('/charging?')) {
      if (sessionsPending) return never()
      if (sessionsError) return Promise.reject(new Error('charging boom'))
      return Promise.resolve(sessions)
    }
    if (path.startsWith('/analytics/cost-forecast')) {
      if (forecastError) return Promise.reject(new Error('forecast boom'))
      return Promise.resolve(forecast ?? emptyForecast)
    }
    if (path.startsWith('/saved-views')) return Promise.resolve([])
    if (path.startsWith('/annotations')) return Promise.resolve([])
    return Promise.resolve({})
  })
}

const chargingCallCount = () =>
  mockedRequest.mock.calls.filter((c) => String(c[0]).startsWith('/charging?')).length

function renderPage(initialEntries: string[] = ['/cost-analysis']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SelectedVehicleProvider>
            <CostAnalysisPage />
          </SelectedVehicleProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
  window.localStorage.clear()
  // fmtNumber/fmtWithUnit read module-global precision/locale that useSettings
  // would normally seed; pin them so assertions are deterministic.
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
  install()
})

describe('CostAnalysisPage', () => {
  it('renders the full dashboard with every section once sessions + forecast load', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Cost Analysis' }),
    ).toBeInTheDocument()

    // KPI band derived at the SI→display boundary: $6 total / 60 kWh → $0.100,
    // 100 km moved → $0.060/km, 60 kWh total energy.
    expect(await screen.findByText('$0.100')).toBeInTheDocument()
    expect(screen.getAllByText('$6.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3 sessions').length).toBeGreaterThan(0)
    expect(screen.getAllByText('60.0 kWh').length).toBeGreaterThan(0)

    // All nine section headings are present — nothing stubbed out.
    expect(screen.getByText('Monthly Cost Trend')).toBeInTheDocument()
    expect(screen.getAllByText('Cost by Charger Type').length).toBeGreaterThan(0)
    expect(screen.getByText('Gas vs Electric Savings Calculator')).toBeInTheDocument()
    expect(screen.getByText('Monthly Cost Breakdown')).toBeInTheDocument()
    expect(screen.getByText('Electricity Rate Analysis (Time-of-Use)')).toBeInTheDocument()
    expect(screen.getAllByText('Cost Forecast').length).toBeGreaterThan(0)
    expect(screen.getByText('Lifetime Summary')).toBeInTheDocument()
    expect(screen.getByText('Environmental Impact')).toBeInTheDocument()

    // Charger buckets resolve to all three human-readable family labels.
    expect(screen.getAllByText('Supercharger').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Home').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Public DC').length).toBeGreaterThan(0)

    // The monthly breakdown table renders a real row per calendar month.
    expect(screen.getAllByText('2025-04').length).toBeGreaterThan(0)
  })

  it('derives cost-per-distance from SI meters once (no ~1600x double-conversion)', async () => {
    renderPage()

    // 100 km moved for $6 total → $0.060/km at the display boundary.
    expect(await screen.findByText('$0.060')).toBeInTheDocument()

    // Regression guard: the pre-SI code fed miles into a meters converter,
    // dividing by ~1609 twice and printing ~$96.56/km.
    expect(screen.queryByText(/96\.5/)).toBeNull()

    // The gas calculator still uses miles for gallons (mpg is miles-based):
    // 100 km ≈ 62.14 mi ÷ 30 mpg × $3.50 → "$7.25" gas-equivalent cost.
    expect(await screen.findByText('$7.25')).toBeInTheDocument()
  })

  it('shows loading affordances while sessions are in flight and withholds KPI values', async () => {
    install({ sessionsPending: true })
    renderPage()

    // Once the fleet loads and the vehicle auto-selects, the enabled-but-pending
    // sessions query drives the data sections into their loading state.
    const spinners = await screen.findAllByRole('status', { name: /Loading/i })
    expect(spinners.length).toBeGreaterThan(0)

    // The KPI values are not fabricated while data is loading.
    expect(screen.queryByText('$0.100')).toBeNull()
    expect(screen.queryByText('60.0 kWh')).toBeNull()
  })

  it('surfaces retryable error banners and still renders the independent forecast', async () => {
    install({ sessionsError: true })
    renderPage()

    // Network-class failure → the actionable "Can't reach server" banner,
    // rendered per data section (never gated behind one page-level guard).
    const banners = await screen.findAllByText("Can't reach server")
    expect(banners.length).toBeGreaterThan(0)

    // The forecast query is independent and succeeded — its confidence-band
    // chart still renders, proving graceful degradation.
    expect(
      screen.getByRole('img', {
        name: /Historical and projected monthly charging cost/i,
      }),
    ).toBeInTheDocument()

    // Retry re-fires the failed sessions request.
    const before = chargingCallCount()
    expect(before).toBeGreaterThanOrEqual(1)
    const retry = screen.getAllByRole('button', { name: 'Retry' })[0]
    fireEvent.click(retry)
    await waitFor(() => expect(chargingCallCount()).toBeGreaterThan(before))
  })

  it('renders honest empty states with no divide-by-zero when there is no data', async () => {
    install({ sessions: [], forecast: emptyForecast })
    renderPage()

    // Section-level empty states instead of blank panels.
    expect(await screen.findByText('No monthly data available')).toBeInTheDocument()
    expect(screen.getByText('Not enough data for comparison')).toBeInTheDocument()
    expect(
      screen.getByText('Need at least 3 months of charging data for cost forecasting.'),
    ).toBeInTheDocument()

    // KPI cards fold to honest zeros; savingsPercent === 0 must not NaN out.
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull()

    // No populated values leak through the empty branch.
    expect(screen.queryByText('$0.100')).toBeNull()
  })

  it('recomputes the gas-equivalent cost when the gas price changes and Reset restores it', async () => {
    renderPage()

    // Baseline gas-equivalent cost at the default $3.50/gal.
    expect(await screen.findByText('$7.25')).toBeInTheDocument()
    expect(screen.queryByText('$14.50')).toBeNull()

    // Doubling the gas price doubles the gas-equivalent cost (62.14 mi ÷ 30 mpg
    // × $7.00 → "$14.50").
    const gasPriceInput = screen.getByLabelText('Gas Price ($/gal)')
    fireEvent.change(gasPriceInput, { target: { value: '7' } })
    await waitFor(() => expect(screen.getAllByText('$14.50').length).toBeGreaterThan(0))
    expect(screen.queryByText('$7.25')).toBeNull()

    // Reset Defaults restores the $3.50/gal assumption.
    fireEvent.click(screen.getByRole('button', { name: 'Reset Defaults' }))
    await waitFor(() => expect(screen.getAllByText('$7.25').length).toBeGreaterThan(0))
    expect(screen.queryByText('$14.50')).toBeNull()
  })

  it('exposes landmark regions and keeps the opt-in AI narration absent in ai_mode=off', async () => {
    renderPage()

    // Wait for data so the KPI region has rendered its cards.
    await screen.findByText('$0.100')

    // Landmark regions expose their accessible names for screen-reader nav.
    expect(screen.getByRole('region', { name: 'Cost summary metrics' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Cost trends' })).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Lifetime and environmental impact' }),
    ).toBeInTheDocument()

    // ai_mode='off' (global test-setup stub) → the AI narration surface is
    // entirely absent; the deterministic dashboard is the canonical view.
    expect(
      screen.queryByTestId('ai-feature-cost-forecast-narration-root'),
    ).not.toBeInTheDocument()
  })
})
