/**
 * TeslaChargingSessionsPage — contract + hardening tests.
 *
 * The page is the "Fleet Charging Sessions" dashboard for Tesla business
 * accounts. It fans two TanStack Query hooks (`useTeslaChargingSessions` +
 * `useVehicles`) and a refresh mutation through the real
 * `useUnits`/`useFormatting`/`useRangeState` boundary into a decision-first
 * operational brief followed by the business-account note, KPI band,
 * cost/type analysis, location analysis, and virtualized session history.
 *
 * Two layers are exercised:
 *
 *   1. The three exported pure helpers (`formatDurationSeconds`,
 *      `buildMonthlyCost`, `groupSessions`) — including the hardening this
 *      change adds: em-dash on NaN/negative durations and skipping
 *      unparseable timestamps so a single bad row can't emit a "NaN-NaN"
 *      chart bucket.
 *
 *   2. The page end-to-end against a mocked `request()` — full render,
 *      loading affordances, a failed-request banner, honest empty states,
 *      the Refresh-from-Tesla mutation, the 403 business-account branch, the
 *      vehicle filter re-query, and labelled landmark regions.
 *
 * Network is mocked at the `@/api/client` boundary (repo convention — see
 * CostAnalysisPage.test.tsx). `useSettings` / `useTimezone` come from the
 * global stubs in src/test-setup.ts (km / $ / en-US), and the lazy leaflet
 * map is stubbed so tests never touch canvas/leaflet.
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

// Stub the lazy-loaded leaflet map so tests never touch canvas/leaflet and we
// can assert how many geo-tagged points reach it.
vi.mock('./TeslaChargingSessionsMap', () => ({
  default: ({ sessions }: { sessions: unknown[] }) => (
    <div data-testid="sessions-map">map:{sessions.length}</div>
  ),
}))

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { SelectedVehicleProvider } from '@/store/selectedVehicle'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'
import TeslaChargingSessionsPage, {
  formatDurationSeconds,
  buildMonthlyCost,
  groupSessions,
} from './TeslaChargingSessionsPage'
import type {
  TeslaChargingSession,
  TeslaChargingSessionSummary,
} from '@/api/hooks/useCharging'
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
    state: 'online',
    healthy: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  } as Vehicle
}

function makeSession(overrides: Partial<TeslaChargingSession> = {}): TeslaChargingSession {
  return {
    id: 1,
    session_id: 1,
    vin: 'VIN00000000000007',
    charger_id: null,
    site_location_name: 'Fremont Supercharger',
    charge_start_datetime: '2025-01-15T12:00:00Z',
    charge_stop_datetime: '2025-01-15T12:30:00Z',
    total_energy_added_wh: 20000,
    peak_power_kw: 120,
    max_charge_rate_kw: 150,
    charge_duration_s: 1800,
    charger_type: 'SUPERCHARGER',
    currency_code: 'USD',
    total_cost: 5,
    per_kwh_rate: 0.25,
    idle_fee: 0,
    congestion_fee: 0,
    latitude: 37.5,
    longitude: -121.9,
    fetched_at: '2025-01-16T00:00:00Z',
    created_at: '2025-01-16T00:00:00Z',
    ...overrides,
  }
}

// Three sessions across three months / two charger families / two sites, all
// geo-tagged. Mid-month noon timestamps keep the local-tz month bucket stable
// on any CI runner.
const defaultSessions: TeslaChargingSession[] = [
  makeSession({
    id: 1, session_id: 101, charge_start_datetime: '2025-01-15T12:00:00Z',
    total_energy_added_wh: 20000, total_cost: 5, charger_type: 'SUPERCHARGER',
    site_location_name: 'Fremont Supercharger', peak_power_kw: 120,
    charge_duration_s: 1800, latitude: 37.5, longitude: -121.9,
  }),
  makeSession({
    id: 2, session_id: 102, charge_start_datetime: '2025-02-20T12:00:00Z',
    total_energy_added_wh: 30000, total_cost: 7, charger_type: 'SUPERCHARGER',
    site_location_name: 'Fremont Supercharger', peak_power_kw: 150,
    charge_duration_s: 3600, latitude: 37.5, longitude: -121.9,
  }),
  makeSession({
    id: 3, session_id: 103, charge_start_datetime: '2025-03-10T12:00:00Z',
    total_energy_added_wh: 10000, total_cost: 3, charger_type: 'DESTINATION',
    site_location_name: 'Hotel Downtown', peak_power_kw: 11,
    charge_duration_s: 7200, latitude: 34.0, longitude: -118.2,
  }),
]

// KPI band reads the server summary, NOT the client range-filtered sessions,
// so these are deliberately distinct numbers to prove that boundary.
const defaultSummary: TeslaChargingSessionSummary = {
  total_sessions: 42,
  total_wh: 123000,
  total_cost: 99.5,
  avg_cost_per_kwh: 0.234,
  peak_power_kw: 250,
}

const emptySummary: TeslaChargingSessionSummary = {
  total_sessions: 0,
  total_wh: null,
  total_cost: null,
  avg_cost_per_kwh: null,
  peak_power_kw: null,
}

interface InstallOpts {
  vehicles?: Vehicle[]
  sessions?: TeslaChargingSession[]
  summary?: TeslaChargingSessionSummary
  sessionsPending?: boolean
  sessionsError?: boolean
  refreshImpl?: (path: string) => Promise<unknown>
}

function install(opts: InstallOpts = {}) {
  const {
    vehicles = [makeVehicle()],
    sessions = defaultSessions,
    summary = defaultSummary,
    sessionsPending = false,
    sessionsError = false,
    refreshImpl,
  } = opts

  mockedRequest.mockImplementation((path: string) => {
    if (path === '/vehicles') return Promise.resolve(vehicles)
    // Refresh must be matched BEFORE the GET prefix (it shares the stem).
    if (path.startsWith('/tesla/charging/sessions/refresh')) {
      if (refreshImpl) return refreshImpl(path)
      return Promise.resolve({ sessions, summary, upserted: sessions.length })
    }
    if (path.startsWith('/tesla/charging/sessions')) {
      if (sessionsPending) return never()
      if (sessionsError) return Promise.reject(new Error('sessions boom'))
      return Promise.resolve({ sessions, summary })
    }
    // ChartContainer annotation/saved-view probes and anything else.
    return Promise.resolve([])
  })
}

function renderPage(initialEntries: string[] = ['/tesla/charging/sessions']) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SelectedVehicleProvider>
            <TeslaChargingSessionsPage />
          </SelectedVehicleProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
  window.localStorage.clear()
  // fmtNumber/fmtInt read module-global precision/locale that useSettings
  // seeds in production; pin them so currency/number assertions are stable.
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
  install()
})

/* ── Pure helpers ─────────────────────────────────────── */

describe('formatDurationSeconds', () => {
  it('formats hours + minutes and floors sub-minute remainders', () => {
    expect(formatDurationSeconds(0)).toBe('0m')
    expect(formatDurationSeconds(90)).toBe('1m') // 1m30s → floor 1m
    expect(formatDurationSeconds(3600)).toBe('1h 0m')
    expect(formatDurationSeconds(3660)).toBe('1h 1m')
    expect(formatDurationSeconds(7325)).toBe('2h 2m') // 2h2m5s
  })

  it('returns an em dash for null/undefined/NaN/Infinity/negative input', () => {
    expect(formatDurationSeconds(null)).toBe('—')
    expect(formatDurationSeconds(undefined)).toBe('—')
    expect(formatDurationSeconds(Number.NaN)).toBe('—')
    expect(formatDurationSeconds(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatDurationSeconds(-120)).toBe('—')
  })
})

describe('buildMonthlyCost', () => {
  it('groups by calendar month, sums cost, and sorts ascending', () => {
    const out = buildMonthlyCost([
      makeSession({ charge_start_datetime: '2025-03-10T12:00:00Z', total_cost: 3 }),
      makeSession({ charge_start_datetime: '2025-01-15T12:00:00Z', total_cost: 5 }),
      makeSession({ charge_start_datetime: '2025-01-20T12:00:00Z', total_cost: 2 }),
    ])
    expect(out).toEqual([
      { month: '2025-01', total: 7 },
      { month: '2025-03', total: 3 },
    ])
  })

  it('treats a null total_cost as zero', () => {
    const out = buildMonthlyCost([
      makeSession({ charge_start_datetime: '2025-05-12T12:00:00Z', total_cost: null }),
      makeSession({ charge_start_datetime: '2025-05-14T12:00:00Z', total_cost: 4 }),
    ])
    expect(out).toEqual([{ month: '2025-05', total: 4 }])
  })

  it('skips rows with a missing or unparseable timestamp (no NaN-NaN bucket)', () => {
    const out = buildMonthlyCost([
      makeSession({ charge_start_datetime: '', total_cost: 9 }),
      makeSession({ charge_start_datetime: 'not-a-date', total_cost: 9 }),
      makeSession({ charge_start_datetime: '2025-06-12T12:00:00Z', total_cost: 6 }),
    ])
    expect(out).toEqual([{ month: '2025-06', total: 6 }])
    expect(out.some((b) => b.month.includes('NaN'))).toBe(false)
  })
})

describe('groupSessions', () => {
  it('rolls up count/energy/cost per key with null-safe sums', () => {
    const buckets = groupSessions(
      [
        makeSession({ charger_type: 'SUPERCHARGER', total_energy_added_wh: 20000, total_cost: 5 }),
        makeSession({ charger_type: 'SUPERCHARGER', total_energy_added_wh: 30000, total_cost: null }),
        makeSession({
          charger_type: 'DESTINATION',
          total_energy_added_wh: null as unknown as number,
          total_cost: 3,
        }),
      ],
      (s) => s.charger_type ?? 'Unknown',
    )
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]))
    expect(byKey.SUPERCHARGER).toEqual({ key: 'SUPERCHARGER', count: 2, energyWh: 50000, cost: 5 })
    expect(byKey.DESTINATION).toEqual({ key: 'DESTINATION', count: 1, energyWh: 0, cost: 3 })
  })
})

/* ── Page ─────────────────────────────────────────────── */

describe('TeslaChargingSessionsPage', () => {
  it('renders the full dashboard once sessions + summary load', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fleet Charging Sessions' }),
    ).toBeInTheDocument()

    const brief = screen.getByTestId('charging-operational-brief')
    expect(
      within(brief).getByText('Cost, energy, and session evidence in one operating view'),
    ).toBeInTheDocument()

    // KPI band derives from the SERVER summary (not the filtered sessions).
    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(within(brief).getByText('3')).toBeInTheDocument()
    expect(within(brief).getByText('60.0 kWh')).toBeInTheDocument()
    expect(within(brief).getByText('$15.00')).toBeInTheDocument()
    expect(within(brief).getByText('1h 10m')).toBeInTheDocument()
    expect(screen.getByText('123.0 kWh')).toBeInTheDocument()
    expect(screen.getByText('$99.50')).toBeInTheDocument()
    expect(screen.getByText('$0.234')).toBeInTheDocument()
    expect(screen.getByText('250')).toBeInTheDocument()
    expect(screen.getAllByText('Total Sessions').length).toBeGreaterThan(1)
    expect(screen.getByText('Peak Power')).toBeInTheDocument()

    // Every section panel is present — nothing stubbed out.
    expect(screen.getByText('Monthly Charging Cost')).toBeInTheDocument()
    expect(screen.getByText('Energy by Charger Type')).toBeInTheDocument()
    expect(screen.getByText('Session Locations')).toBeInTheDocument()
    expect(screen.getByText('Top Locations by Cost')).toBeInTheDocument()
    expect(screen.getByText('Charging Sessions')).toBeInTheDocument()

    // Charger-type breakdown resolves both families (labels are uppercased).
    expect(screen.getAllByText('SUPERCHARGER').length).toBeGreaterThan(0)
    expect(screen.getAllByText('DESTINATION').length).toBeGreaterThan(0)

    // Top-locations ranking renders both sites by spend.
    expect(screen.getAllByText('Fremont Supercharger').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Hotel Downtown').length).toBeGreaterThan(0)

    // All three geo-tagged sessions reach the (stubbed) map.
    expect(await screen.findByTestId('sessions-map')).toHaveTextContent('map:3')

    // The sessions table rendered (header present, not the empty state).
    expect(screen.getByText('Peak (kW)')).toBeInTheDocument()
    expect(screen.queryByText(/No fleet charging sessions yet/)).toBeNull()
  })

  it('shows loading affordances while the sessions query is in flight', async () => {
    install({ sessionsPending: true })
    renderPage()

    expect(
      await screen.findByRole('status', { name: 'Loading monthly charging costs…' }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument()

    // KPI values are withheld — never a half-populated dashboard.
    expect(screen.queryByText('123.0 kWh')).toBeNull()
    expect(screen.queryByText('$99.50')).toBeNull()
  })

  it('surfaces a failure banner and folds KPIs to placeholders when the request errors', async () => {
    install({ sessionsError: true })
    renderPage()

    expect(await screen.findByText("Can't reach server")).toBeInTheDocument()

    // No stale/fabricated KPI values leak through the error branch.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('123.0 kWh')).toBeNull()
  })

  it('renders honest per-section empty states when there is no data', async () => {
    install({ sessions: [], summary: emptySummary })
    renderPage()

    expect(
      await screen.findByText(/No fleet charging sessions yet/),
    ).toBeInTheDocument()
    expect(screen.getByText(/No cost data yet/)).toBeInTheDocument()
    expect(screen.getByText('No charger breakdown yet.')).toBeInTheDocument()
    expect(screen.getByText('No location data available yet.')).toBeInTheDocument()
    expect(screen.getByText('No location breakdown yet.')).toBeInTheDocument()

    // KPI band still renders, folded to honest zero / em-dash placeholders.
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByText('No sessions in this analysis window')).toBeInTheDocument()
    expect(screen.queryByText('123.0 kWh')).toBeNull()
  })

  it('surfaces fee exposure and partial cost coverage as attention items', async () => {
    install({
      sessions: [
        makeSession({
          idle_fee: 2,
          congestion_fee: 1,
          total_cost: null,
        }),
      ],
    })
    renderPage()

    expect(await screen.findByText('Charging fees need review')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review all' }))
    expect(screen.getByText('Cost coverage is incomplete')).toBeInTheDocument()
    expect(screen.getByText(/sessions have no reported cost/i)).toBeInTheDocument()
  })

  it('fires the refresh mutation against the Tesla sync endpoint on click', async () => {
    renderPage()
    await screen.findByText('42')

    fireEvent.click(screen.getByRole('button', { name: /Refresh from Tesla/ }))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/tesla/charging/sessions/refresh?vin=VIN00000000000007',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('surfaces the business-account note when a refresh returns 403', async () => {
    install({
      refreshImpl: () =>
        Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 })),
    })
    renderPage()
    await screen.findByText('42')

    fireEvent.click(screen.getByRole('button', { name: /Refresh from Tesla/ }))

    expect(await screen.findByText('Business account required')).toBeInTheDocument()
  })

  it('re-queries sessions for the selected vehicle when the filter changes', async () => {
    renderPage()
    await screen.findByText('42')

    const select = screen.getByRole('combobox', { name: 'Select vehicle' })
    fireEvent.change(select, { target: { value: 'VIN00000000000007' } })

    await waitFor(() => {
      expect(
        mockedRequest.mock.calls.some((c) =>
          String(c[0]).startsWith('/tesla/charging/sessions?vin=VIN00000000000007'),
        ),
      ).toBe(true)
    })
  })

  it('exposes labelled landmark regions and an accessible vehicle filter', async () => {
    renderPage()
    await screen.findByText('42')

    expect(screen.getByRole('region', { name: 'Summary metrics' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Cost analysis' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Session locations' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Charging sessions table' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Select vehicle' })).toBeInTheDocument()

    const actions = screen.getByRole('group', { name: 'Actions' })
    expect(actions.querySelector('[data-action-group="context"]')).toContainElement(
      screen.getByRole('combobox', { name: 'Select vehicle' }),
    )
    expect(actions.querySelector('[data-action-group="primary"]')).toContainElement(
      screen.getByRole('button', { name: 'Refresh from Tesla' }),
    )

    const brief = screen.getByTestId('charging-operational-brief')
    const analysis = screen.getByRole('region', { name: 'Cost analysis' })
    const history = screen.getByRole('region', { name: 'Charging sessions table' })
    expect(
      brief.compareDocumentPosition(analysis) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      analysis.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
