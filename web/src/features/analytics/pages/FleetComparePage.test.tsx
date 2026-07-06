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
 *   5. Loading — the page shows its spinner shell, never the table/selectors.
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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'
import FleetComparePage from './FleetComparePage'
import type { Vehicle } from '@/types/vehicle'
import type { VehicleState } from '@/api/types'
import type { DrivingStats } from '@/types/driving'

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
}

const never = () => new Promise<never>(() => {})

function install(opts: InstallOptions = {}) {
  const {
    vehicles = [makeVehicle(), makeVehicle({ id: 2, vehicle_id: 2, display_name: 'Model Y P', model: 'Model Y', trim_badging: 'Performance', state: 'asleep' })],
    vehiclesPending = false,
    monthlyEmpty = false,
    monthlyError = false,
  } = opts

  const idOf = (path: string) => new URLSearchParams(path.split('?')[1] ?? '').get('vehicle_id')

  mockedRequest.mockImplementation((path: string) => {
    const stateMatch = path.match(/\/vehicles\/(\d+)\/state/)
    if (stateMatch) {
      const id = Number(stateMatch[1])
      const state = id === 1 ? makeState({ vehicle_id: 1 }) : makeState({ vehicle_id: 2, battery_level: 65, is_locked: false, sentry_mode: true, state: 'asleep' })
      return Promise.resolve({ state, live: false })
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
      if (monthlyError) return Promise.reject(new Error('monthly boom'))
      if (monthlyEmpty) return Promise.resolve(monthly(Number(idOf(path)), []))
      return Promise.resolve(idOf(path) === '2' ? monthlyB : monthlyA)
    }
    if (path.startsWith('/settings')) return Promise.resolve({ chart_palette: 'cb_safe' })
    return Promise.resolve({})
  })
}

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname}</div>
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  return render(
    <MemoryRouter initialEntries={['/fleet-compare']}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <FleetComparePage />
        </ToastProvider>
      </QueryClientProvider>
      <LocationProbe />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
  window.localStorage.clear()
  // Formatting is driven by module-global precision/locale that useSettings
  // would normally seed; pin them so the assertions are deterministic.
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
  install()
})

describe('FleetComparePage', () => {
  it('renders the full comparison once two vehicles + their stats load', async () => {
    renderPage()

    // Page chrome + both selectors.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Fleet Comparison' }),
    ).toBeInTheDocument()
    const selectA = (await screen.findByLabelText('Vehicle A')) as HTMLSelectElement
    const selectB = screen.getByLabelText('Vehicle B') as HTMLSelectElement

    // Auto-select fills the first two vehicles.
    await waitFor(() => expect(selectA.value).toBe('1'))
    expect(selectB.value).toBe('2')

    // Settle: the table shows real values only once both stats queries resolve.
    // There is a transient auto-select window where the values are still 0.00.
    await screen.findByText('210.00')

    // The lifetime table renders every metric row label (Avg Efficiency /
    // Charging Cost / CO₂ Saved also appear as KPI-band labels → getAllByText).
    for (const label of [
      'Total Drives', 'Total Distance', 'Avg Efficiency', 'Avg Speed', 'Top Speed',
      'Regen Ratio', 'CO₂ Saved', 'Charging Cost', 'Total Energy', 'Charge Sessions',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }

    // Real formatting boundary: km stays km, currency uses $, 2dp default.
    expect(screen.getAllByText('5,000.00 km').length).toBe(2)
    // KPI band interpolates the i18n "A vs B" connector with live/lifetime data.
    expect(await screen.findByText('72% vs 65%')).toBeInTheDocument()
    expect(await screen.findByText('$500 vs $650')).toBeInTheDocument()

    // Vehicle names surface as the table's value-column headers.
    expect(screen.getAllByText('Model 3 LR').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Model Y P').length).toBeGreaterThan(0)
  })

  it('annotates the winner with a ✓ across higher / lower / tie semantics', async () => {
    renderPage()

    // Settle past the transient auto-select window before reading cell values.
    // 'higher' → A (210) beats B (140): ✓ sits with the winner only.
    const drivesWinner = await screen.findByText('210.00')
    expect(within(drivesWinner).getByText('✓')).toBeInTheDocument()
    expect(within(screen.getByText('140.00')).queryByText('✓')).toBeNull()

    // 'lower' → B (155 Wh/km) beats A (170 Wh/km).
    const effWinner = screen.getByText('155.00 Wh/km')
    expect(within(effWinner).getByText('✓')).toBeInTheDocument()
    expect(within(screen.getByText('170.00 Wh/km')).queryByText('✓')).toBeNull()

    // 'neutral' → Avg Speed never annotates a winner even though the values differ.
    expect(within(screen.getByText('60.00 km/h')).queryByText('✓')).toBeNull()
    expect(within(screen.getByText('62.00 km/h')).queryByText('✓')).toBeNull()

    // a === b → equal Total Distance is a tie despite the 'higher' semantic.
    for (const cell of screen.getAllByText('5,000.00 km')) {
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

    // No selectors and no comparison table in this degenerate state.
    expect(screen.queryByLabelText('Vehicle A')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()

    // The CTA routes the user to vehicle management.
    fireEvent.click(screen.getByRole('button', { name: 'Manage vehicles' }))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/vehicles'),
    )
  })

  it('renders the page-level loading shell while vehicles are still loading', () => {
    install({ vehiclesPending: true })
    renderPage()

    // Header is always present; the body is the spinner shell, never the
    // selectors, table, or the single-vehicle empty state.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Fleet Comparison' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Vehicle A')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('Add a second vehicle to compare')).toBeNull()
  })

  it('degrades the trend panels to empty states when there are no monthly rollups', async () => {
    install({ monthlyEmpty: true })
    renderPage()

    // Settle stats first (real drive count), then assert both trend panels
    // degraded to their empty states rather than a transient skeleton.
    await screen.findByText('210.00')
    expect(
      await screen.findByText('No monthly data available yet'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('No drive data available yet'),
    ).toBeInTheDocument()
    // The rest of the page still renders — the table is unaffected.
    expect(screen.getAllByText('Total Drives').length).toBeGreaterThan(0)
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
