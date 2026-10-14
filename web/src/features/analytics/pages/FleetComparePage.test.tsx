/**
 * FleetComparePage contract tests.
 *
 * The page fans a handful of TanStack Query hooks (vehicles, live state,
 * lifetime driving stats, cost breakdown, monthly mileage) out to a selector
 * toolbar, a KPI band, two side-by-side status cards, two trend charts, and a
 * winner-annotated comparison table. These tests exercise the page end-to-end —
 * the real hooks + real unit-conversion/formatting boundary run against a
 * mocked `request()` — so every branch a user can hit is covered:
 *
 *   1. Full render: title, both selectors, KPI band, status cards, and the
 *      lifetime comparison table with real metric labels + formatted values.
 *   2. Winner semantics — `getWinner`/`winnerCell` across all three branches:
 *      'higher' (A wins Total Drives), 'lower' (B wins Avg Efficiency),
 *      'neutral' (Avg Speed is a tie), and the `a === b` equality tie
 *      (equal Total Distance never annotates a winner). The ✓ is the
 *      non-color a11y signal that must sit next to — and only next to —
 *      the winning cell.
 *   3. Swap — the ⇄ control exchanges the two selected vehicles in place.
 *   4. Single-vehicle account — a focused EmptyState (not empty selectors),
 *      and its "Manage vehicles" CTA navigates to /vehicles.
 *   5. Loading — persistent section shells, never a fabricated table/selectors.
 *   6. Trend panels degrade: empty monthly rollups → EmptyStates (never a
 *      blank panel); a monthly fetch failure → <QueryError> in both panels.
 *   7. The disambiguation banner is visible by default, hides on dismiss and
 *      persists that choice to localStorage, and stays hidden on a later
 *      mount once dismissed.
 *
 * Network is mocked at the `@/api/client` boundary (the repo convention — see
 * GasPriceAutoPollPage.test.tsx / DiskForecastPage.test.tsx). `useSettings`
 * and `useTimezone` come from the global stubs in src/test-setup.ts, so the
 * real `useUnits`/`useFormatting` formatters render km / °C / $ / kWh.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ComponentProps, ReactNode } from 'react'

const trendEvidence = vi.hoisted(() => vi.fn())

vi.mock('../components/fleet-compare-modernization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/fleet-compare-modernization')>()
  return {
    ...actual,
    FleetTrendCard: (props: ComponentProps<typeof actual.FleetTrendCard>) => {
      trendEvidence(props)
      return <actual.FleetTrendCard {...props} />
    },
  }
})

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>()
  const { chartTestDoubles } = await import('@/test/chartTestDoubles')
  return { ...actual, ...chartTestDoubles }
})
vi.mock('@/components/charts/EmbeddedChart', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles')
  return { EmbeddedChart: chartTestDoubles.EmbeddedChart }
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
import { ToastProvider } from '@/components/feedback/Toast'
import { ThemeProvider } from '@/components/ui/ThemeProvider'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'
import FleetComparePage from './FleetComparePage'
import type { Vehicle } from '@/types/vehicle'
import type { VehicleState, VehicleStateReadings } from '@/api/types'
import type { DrivingStats } from '@/types/driving'
import { vehicleKeys } from '@/api/hooks/useVehicles'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const BANNER_KEY = 'phase40.compareBanner.dismissed.fleet'

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

function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 72,
    rated_range: 400,
    ideal_range: 420,
    odometer: 12345,
    inside_temp: 21,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2025.10',
    ...overrides,
  }
}

function makeStats(overrides: Partial<DrivingStats> = {}): DrivingStats {
  return {
    totalDrives: 210,
    totalDistanceKm: 5000,
    totalDurationS: 360000,
    avgEfficiencyWhKm: 170,
    avgSpeedKmh: 60,
    topSpeedKmh: 180,
    regenRatio: 0.5,
    regenEnergyWh: 12000,
    co2SavedKg: 320,
    ...overrides,
  }
}

// Vehicle B is tuned so every winner branch has a deterministic outcome:
//   Total Drives (higher)   A 210 > B 140   → A wins
//   Total Distance (higher) A 5000 = B 5000 → tie via the a===b branch
//   Avg Efficiency (lower)  A 170 > B 155   → B wins
//   Avg Speed (neutral)     A 60 vs B 62    → tie via the neutral branch
const statsA = makeStats()
const statsB = makeStats({
  totalDrives: 140,
  totalDistanceKm: 5000,
  avgEfficiencyWhKm: 155,
  avgSpeedKmh: 62,
  topSpeedKmh: 190,
  regenRatio: 0.3,
  co2SavedKg: 300,
})

const costA = { total_charging_cost: 500, total_wh: 45000, total_sessions: 80 }
const costB = { total_charging_cost: 650, total_wh: 52000, total_sessions: 95 }

function monthly(id: number, months: Array<{ year_month: string; total_km: number; drive_count: number }>) {
  return {
    vehicle_id: id,
    months: months.map((m) => ({
      ...m,
      total_wh_consumed: null,
      avg_efficiency_wh_per_km: null,
    })),
  }
}

const monthlyA = monthly(1, [
  { year_month: '2025-01', total_km: 400, drive_count: 20 },
  { year_month: '2025-02', total_km: 550, drive_count: 25 },
])
const monthlyB = monthly(2, [
  { year_month: '2025-02', total_km: 300, drive_count: 18 },
  { year_month: '2025-03', total_km: 480, drive_count: 22 },
])

interface InstallOptions {
  vehicles?: Vehicle[]
  /** /vehicles never resolves — drives the page-level loading shell. */
  vehiclesPending?: boolean
  monthlyEmpty?: boolean
  monthlyError?: boolean
  monthlyPendingB?: boolean
  monthlyErrorB?: boolean
  monthlyForA?: typeof monthlyA
  stateResponse?: { state?: Partial<VehicleStateReadings> | null; live: boolean } | null
  statePending?: boolean
  stateEvidence?: {
    live: boolean
    observed_at: string | null
    freshness: 'fresh' | 'stale' | 'unknown'
    verified_fields: string[]
  }
}

const never = () => new Promise<never>(() => {})

function install(opts: InstallOptions = {}) {
  const {
    vehicles = [makeVehicle(), makeVehicle({ id: 2, vehicle_id: 2, display_name: 'Model Y P', model: 'Model Y', trim_badging: 'Performance', state: 'asleep' })],
    vehiclesPending = false,
    monthlyEmpty = false,
    monthlyError = false,
    monthlyPendingB = false,
    monthlyErrorB = false,
    monthlyForA = monthlyA,
    stateEvidence,
    stateResponse,
    statePending = false,
  } = opts

  const idOf = (path: string) => new URLSearchParams(path.split('?')[1] ?? '').get('vehicle_id')

  mockedRequest.mockImplementation((path: string) => {
    const stateMatch = path.match(/\/vehicles\/(\d+)\/state/)
    if (stateMatch) {
      if (statePending) return never()
      if (stateResponse !== undefined) return Promise.resolve(stateResponse)
      const id = Number(stateMatch[1])
      const state = id === 1 ? makeState({ vehicle_id: 1 }) : makeState({ vehicle_id: 2, battery_level: 65, is_locked: false, sentry_mode: true, state: 'asleep' })
      return Promise.resolve({ state, live: false, ...stateEvidence })
    }
    if (path === '/vehicles') {
      return vehiclesPending ? never() : Promise.resolve(vehicles)
    }
    if (path.startsWith('/drives/stats')) {
      return Promise.resolve(idOf(path) === '2' ? statsB : statsA)
    }
    if (path.startsWith('/analytics/tco')) {
      return Promise.resolve(idOf(path) === '2' ? costB : costA)
    }
    if (path.startsWith('/mileage/monthly')) {
      if (idOf(path) === '2' && monthlyPendingB) return never()
      if (idOf(path) === '2' && monthlyErrorB) return Promise.reject(new Error('monthly peer boom'))
      if (monthlyError) return Promise.reject(new Error('monthly boom'))
      if (monthlyEmpty) return Promise.resolve(monthly(Number(idOf(path)), []))
      return Promise.resolve(idOf(path) === '2' ? monthlyB : monthlyForA)
    }
    if (path.startsWith('/settings')) return Promise.resolve({ chart_palette: 'cb_safe' })
    return Promise.resolve({})
  })
}

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname}</div>
}

function renderPage(path = '/fleet-compare', client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })) {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <ToastProvider>
            <FleetComparePage />
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
      <LocationProbe />
    </MemoryRouter>,
  )
  return { ...result, client }
}

afterEach(() => {
  onlineManager.setOnline(true)
})

beforeEach(() => {
  mockedRequest.mockReset()
  trendEvidence.mockClear()
  window.localStorage.clear()
  // Formatting is driven by module-global precision/locale that useSettings
  // would normally seed; pin them so the assertions are deterministic.
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
  install()
})

describe('FleetComparePage evidence preservation', () => {
  it('shows active state loading without invented readings', async () => {
    install({ statePending: true })
    const { client } = renderPage()
    await screen.findByLabelText('Vehicle A')
    await waitFor(() => expect(client.getQueryState(vehicleKeys.state(1))?.fetchStatus).toBe('fetching'))
    expect(screen.queryByText('72%')).toBeNull()
    expect(screen.queryByText('Battery')).toBeNull()
    expect(screen.queryByText('Unlocked')).toBeNull()
  })

  it('shows unknown readings, not loading or false, when paused without data', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(vehicleKeys.all, [makeVehicle(), makeVehicle({ id: 2 })])
    onlineManager.setOnline(false)
    renderPage('/fleet-compare', client)
    await waitFor(() => expect(client.getQueryState(vehicleKeys.state(1))?.fetchStatus).toBe('paused'))
    expect(await screen.findAllByText('Battery')).toHaveLength(2)
    expect(screen.queryByRole('progressbar', { name: 'Battery level' })).toBeNull()
    expect(screen.queryByText('Unlocked')).toBeNull()
    expect(screen.queryByText('Sentry OFF')).toBeNull()
  })

  it.each([
    null,
    { state: { vehicle_id: 1 }, live: false },
    { state: { vehicle_id: 1, battery_level: null, rated_range: null, is_locked: null, sentry_mode: null }, live: false },
    { state: { vehicle_id: 1, battery_level: Number.NaN, rated_range: Number.POSITIVE_INFINITY }, live: false },
  ])('renders successful empty state as unknown without fabricated zeros (%j)', async (stateResponse) => {
    install({ stateResponse })
    const { client } = renderPage()
    await waitFor(() => expect(client.getQueryState(vehicleKeys.state(1))?.status).toBe('success'))
    expect(await screen.findAllByText('Battery')).toHaveLength(2)
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.queryByText('Unlocked')).toBeNull()
    expect(screen.queryByRole('progressbar', { name: 'Battery level' })).toBeNull()
  })

  it('preserves durable zero and false through refresh failure and recovery without rewriting cache', async () => {
    const state = makeState({
      battery_level: 0, rated_range: 0, inside_temp: 0, outside_temp: 0,
      is_locked: false, sentry_mode: false,
    })
    install({ stateResponse: { state, live: false } })
    const { client } = renderPage()
    await screen.findAllByText('0%')
    expect(screen.getAllByText('Unlocked')).toHaveLength(2)
    expect(screen.getAllByText('Sentry OFF')).toHaveLength(2)
    expect(screen.getAllByRole('progressbar', { name: 'Battery level' })[0]).toHaveAttribute('aria-valuenow', '0')
    const retained = client.getQueryData(vehicleKeys.state(1))
    const workingRequest = mockedRequest.getMockImplementation()!
    mockedRequest.mockImplementation((path: string, ...args: unknown[]) =>
      path === '/vehicles/1/state' ? Promise.reject(new Error('state refresh failed')) : workingRequest(path, ...args))
    await act(async () => { await client.refetchQueries({ queryKey: vehicleKeys.state(1), exact: true }) })
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument()
    expect(client.getQueryData(vehicleKeys.state(1))).toBe(retained)
    expect(screen.getAllByText('Unlocked')).toHaveLength(2)
    expect(screen.getAllByText('Sentry OFF')).toHaveLength(2)
    expect(screen.getAllByText('0%').length).toBeGreaterThanOrEqual(2)
    mockedRequest.mockImplementation((path: string, ...args: unknown[]) =>
      path === '/vehicles/1/state'
        ? Promise.resolve({ state: makeState({ battery_level: 50, sentry_mode: true }), live: false })
        : workingRequest(path, ...args))
    await act(async () => { await client.refetchQueries({ queryKey: vehicleKeys.state(1), exact: true }) })
    expect(await screen.findByText('50%')).toBeInTheDocument()
    expect(screen.queryByText("Can't reach server")).toBeNull()
    expect(screen.getAllByText('Sentry OFF')).toHaveLength(1)
  })

  const distanceEvidence = () => {
    const calls = trendEvidence.mock.calls.map(([props]) =>
      props as ComponentProps<typeof import('../components/fleet-compare-modernization').FleetTrendCard>)
    const latest = calls.filter(props => props.chartKey === 'fleet-compare-monthly-distance').at(-1)
    if (!latest) throw new Error('Monthly distance evidence must render')
    return latest
  }

  it('keeps missing monthly buckets unknown and observed zero intact', async () => {
    install({ monthlyForA: monthly(1, [
      { year_month: '2025-01', total_km: 0, drive_count: 0 },
      { year_month: '2025-02', total_km: Number.NaN, drive_count: Number.NaN },
    ]) })
    renderPage()
    await waitFor(() => expect(distanceEvidence().data).toEqual([
      { month: '2025-01', distA: 0, distB: null, drivesA: 0, drivesB: null },
      { month: '2025-02', distA: null, distB: 300, drivesA: null, drivesB: 18 },
      { month: '2025-03', distA: null, distB: 480, drivesA: null, drivesB: 22 },
    ]))
    const formatA = distanceEvidence().dataColumns?.find(column => column.key === 'distA')?.format
    expect(formatA?.(null)).toBe('—')
    expect(formatA?.(0)).toBe('0.00')
  })

  it.each([
    { name: 'pending', monthlyPendingB: true, monthlyErrorB: false },
    { name: 'failed', monthlyPendingB: false, monthlyErrorB: true },
  ])('retains the working monthly peer when the other is $name', async (options) => {
    install(options)
    renderPage()
    await waitFor(() => expect(distanceEvidence().data).toEqual([
      { month: '2025-01', distA: 400, distB: null, drivesA: 20, drivesB: null },
      { month: '2025-02', distA: 550, distB: null, drivesA: 25, drivesB: null },
    ]))
    expect(distanceEvidence().hasData).toBe(true)
    expect(screen.getByRole('heading', { name: 'Lifetime statistics', level: 2 })).toBeInTheDocument()
  })

  it('announces only actual winner cells without changing their exported readings', async () => {
    renderPage()
    const table = within(await screen.findByRole('table'))
    const winner = await table.findByText('210')
    expect(within(winner).getByText('Winner')).toHaveClass('sr-only')
    expect(within(table.getByText('140')).queryByText('Winner')).toBeNull()
    for (const tiedCell of table.getAllByText('5,000.00 km')) {
      expect(within(tiedCell).queryByText('Winner')).toBeNull()
    }
  })

  it('retains stale snapshot readings and identifies their observation limits', async () => {
    install({ stateEvidence: {
      live: true, observed_at: '2025-01-01T00:00:00Z', freshness: 'stale',
      verified_fields: ['battery_level', 'rated_range', 'is_locked'],
    } })
    renderPage()
    await screen.findByText('72%')
    expect(screen.getAllByText(/Telemetry stream · Last real observation/)).toHaveLength(2)
    expect(screen.getAllByText(/Telemetry stream.*Stale/)).toHaveLength(2)
    expect(screen.getAllByText('Unverified')).toHaveLength(10)
    expect(screen.getAllByText('Telemetry stream observation does not verify individual reading timestamps or completeness.')).toHaveLength(2)
    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.getByText('Unlocked')).toBeInTheDocument()
  })

  it('keeps independent deep-linked vehicle selection and peer exclusion', async () => {
    renderPage('/vehicle-comparison?leftId=2&rightId=1')
    const left = await screen.findByLabelText('Vehicle A') as HTMLSelectElement
    const right = screen.getByLabelText('Vehicle B') as HTMLSelectElement
    await waitFor(() => expect(left.value).toBe('2'))
    expect(right.value).toBe('1')
    expect(within(left).getByRole('option', { name: 'Model 3 LR' })).toBeDisabled()
    expect(within(right).getByRole('option', { name: 'Model Y P' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Swap vehicles' }))
    await waitFor(() => expect(left.value).toBe('1'))
    expect(right.value).toBe('2')
  })
})

describe('FleetComparePage', () => {
  it('renders the full comparison once two vehicles + their stats load', async () => {
    renderPage()

    // Page chrome + both selectors.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Fleet comparison' }),
    ).toBeInTheDocument()
    const selectA = (await screen.findByLabelText('Vehicle A')) as HTMLSelectElement
    const selectB = screen.getByLabelText('Vehicle B') as HTMLSelectElement

    // Auto-select fills the first two vehicles.
    await waitFor(() => expect(selectA.value).toBe('1'))
    expect(selectB.value).toBe('2')

    // Settle: the table shows real values only once both stats queries resolve.
    // There is a transient auto-select window where the values are still 0.00.
    await screen.findByText('210')

    // The lifetime table renders every metric row label (Avg Efficiency /
    // Charging Cost / CO₂ Saved also appear as KPI-band labels → getAllByText).
    for (const label of [
      'Total drives', 'Total distance', 'Avg efficiency', 'Avg speed', 'Top speed',
      'Regen ratio', 'CO₂ saved', 'Charging cost', 'Total energy', 'Charge sessions',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }

    // Real formatting boundary: km stays km, currency uses $, 2dp default.
    expect(screen.getAllByText('5,000.00 km').length).toBe(2)
    // KPI band interpolates the i18n "A vs B" connector with live/lifetime data.
    const batteryReading = screen.getByText('Battery level · Model 3 LR').closest('[role="listitem"]') as HTMLElement
    expect(await within(batteryReading).findByText('72% vs 65%')).toBeInTheDocument()
    const chargingCostReading = screen.getByText('Charging cost · Model 3 LR').closest<HTMLElement>('[role="listitem"]')
    if (!chargingCostReading) throw new Error('Charging cost · Model 3 LR must belong to a semantic listitem')
    expect(await within(chargingCostReading).findByText('$500.00 vs $650.00')).toBeInTheDocument()

    // Vehicle names surface as the table's value-column headers.
    expect(screen.getAllByText('Model 3 LR').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Model Y P').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Reorder or hide columns' })).not.toBeInTheDocument()
    const comparisonTable = screen.getByRole('table')
    expect(comparisonTable.querySelectorAll('[role="separator"], [draggable="true"]')).toHaveLength(0)
  })

  it('annotates the winner with a ✓ across higher / lower / tie semantics', async () => {
    renderPage()
    const comparisonTable = within(await screen.findByRole('table'))

    // Settle past the transient auto-select window before reading cell values.
    // 'higher' → A (210) beats B (140): ✓ sits with the winner only.
    const drivesWinner = await comparisonTable.findByText('210')
    expect(within(drivesWinner).getByText('✓')).toBeInTheDocument()
    expect(within(comparisonTable.getByText('140')).queryByText('✓')).toBeNull()

    // 'lower' → B (155 Wh/km) beats A (170 Wh/km).
    const effWinner = comparisonTable.getByText('155.00 Wh/km')
    expect(within(effWinner).getByText('✓')).toBeInTheDocument()
    expect(within(comparisonTable.getByText('170.00 Wh/km')).queryByText('✓')).toBeNull()

    // 'neutral' → Avg Speed never annotates a winner even though the values differ.
    expect(within(comparisonTable.getByText('60.00 km/h')).queryByText('✓')).toBeNull()
    expect(within(comparisonTable.getByText('62.00 km/h')).queryByText('✓')).toBeNull()

    // a === b → equal Total Distance is a tie despite the 'higher' semantic.
    for (const cell of comparisonTable.getAllByText('5,000.00 km')) {
      expect(within(cell).queryByText('✓')).toBeNull()
    }
  })

  it('swaps the two selected vehicles in place', async () => {
    renderPage()

    const selectA = (await screen.findByLabelText('Vehicle A')) as HTMLSelectElement
    const selectB = screen.getByLabelText('Vehicle B') as HTMLSelectElement
    await waitFor(() => expect(selectA.value).toBe('1'))
    expect(selectB.value).toBe('2')

    const swap = screen.getByRole('button', { name: 'Swap vehicles' })
    await waitFor(() => expect(swap).not.toBeDisabled())
    fireEvent.click(swap)

    await waitFor(() => expect(selectA.value).toBe('2'))
    expect(selectB.value).toBe('1')
  })

  it('shows a focused empty state (not empty selectors) for single-vehicle accounts', async () => {
    install({ vehicles: [makeVehicle()] })
    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText('Add a second vehicle to compare'),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByText(/Fleet comparison shows two vehicles side-by-side/i),
    ).toBeInTheDocument()

    // No unusable selectors or comparison table; the section shells survive.
    expect(screen.queryByLabelText('Vehicle A')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Lifetime statistics', level: 2 })).toBeInTheDocument()

    // The CTA routes the user to vehicle management.
    fireEvent.click(screen.getByRole('button', { name: 'Manage vehicles' }))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/vehicles'),
    )
  })

  it('renders the page-level loading shell while vehicles are still loading', () => {
    install({ vehiclesPending: true })
    renderPage()

    // Header and section shells survive loading without presenting selectors,
    // a fabricated comparison table, or the single-vehicle empty state.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Fleet comparison' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Vehicle A')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('Add a second vehicle to compare')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Lifetime statistics', level: 2 })).toBeInTheDocument()
  })

  it('degrades the trend panels to empty states when there are no monthly rollups', async () => {
    install({ monthlyEmpty: true })
    renderPage()

    // Settle stats first (real drive count), then assert both trend panels
    // degraded to their empty states rather than a transient skeleton.
    await screen.findByText('210')
    expect(
      await screen.findByText('No monthly data available yet'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('No drive data available yet'),
    ).toBeInTheDocument()
    // The rest of the page still renders — the table is unaffected.
    expect(screen.getAllByText('Total drives').length).toBeGreaterThan(0)
  })

  it('surfaces a QueryError in both trend panels when monthly mileage fails', async () => {
    install({ monthlyError: true })
    renderPage()

    // Both the distance overlay and the drives bar chart show the network error.
    await waitFor(() =>
      expect(screen.getAllByText("Can't reach server").length).toBe(2),
    )
    // A hard failure is not an empty state.
    expect(screen.queryByText('No monthly data available yet')).toBeNull()
  })

  it('shows the disambiguation banner by default and persists dismissal', async () => {
    renderPage()

    const link = await screen.findByRole('link', { name: /Open Period comparison/i })
    expect(
      screen.getByText('Looking to compare time periods instead?'),
    ).toBeInTheDocument()

    // The banner's close control is icon-only; find it via the banner subtree.
    let container: HTMLElement | null = link.parentElement
    while (container && !container.querySelector('button')) {
      container = container.parentElement
    }
    const closeBtn = container?.querySelector('button')
    expect(closeBtn).toBeTruthy()
    fireEvent.click(closeBtn as HTMLButtonElement)

    await waitFor(() =>
      expect(
        screen.queryByText('Looking to compare time periods instead?'),
      ).toBeNull(),
    )
    expect(window.localStorage.getItem(BANNER_KEY)).toBe('1')
  })

  it('keeps the banner hidden on later mounts once dismissed', async () => {
    window.localStorage.setItem(BANNER_KEY, '1')
    renderPage()

    // Wait for the toolbar so the page has fully mounted before asserting absence.
    await screen.findByLabelText('Vehicle A')
    expect(
      screen.queryByText('Looking to compare time periods instead?'),
    ).toBeNull()
  })
})
