/**
 * DriveDetailPage contract tests.
 *
 * DriveDetailPage is the orchestration layer for a single drive: it pulls the
 * drive + derived stats from `useDriveDetailData`, owns the page-level loading
 * skeleton, error surface and (new) not-found empty state, computes the route
 * title + vehicle meta line, gates the numeric-summary panels behind a
 * "does this drive have meaningful telemetry?" heuristic, and drives the share
 * dialog. These tests exercise every branch a user can reach by controlling the
 * hook's return value and stubbing the heavy chart / map / AI leaf components
 * (each has its own suite) so the assertions target the page's own logic:
 *
 *   1. Loading   → the skeleton renders and nothing else (no page chrome).
 *   2. Error     → PageContainer's error surface shows the message; every
 *                  section is withheld.
 *   3. Not found → drive is null with no error → an explicit empty state, never
 *                  a blank page (the hardening this elevation adds).
 *   4. Rich drive→ the route-title heading, the vehicle meta line, and all
 *                  gated + always-on sections render; no telemetry-gap banner.
 *   5. Empty drive→ all-zero aggregates → the numeric panels collapse to a
 *                  single telemetry-gap banner while the always-on sections
 *                  (timeline, map, why-ended) still render; the title falls
 *                  back to the generic label.
 *   6. Telemetry rows keep the numeric panels alive even with zero aggregates.
 *   7. Zero-energy meaningful drive hides ONLY the cost-savings panel.
 *   8. The Share action opens + closes the (stubbed) share dialog.
 *   9. Back / Replay / Print controls are accessible and replay links to the id.
 *  10. Id-scoped controls disappear when the route carries no drive id.
 *
 * `useSettings` / `useTimezone` come from the global stubs in
 * src/test-setup.ts; react-i18next is stubbed locally so the English fallbacks
 * render deterministically (the repo convention — see TimelinePage.test.tsx).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { DriveDetail } from '@/types/driving'
import type { Vehicle } from '@/types/vehicle'
import type { LatLngExpression } from '@/components/maps'
import type {
  ChartDataPoint,
  DriveStats,
  SpeedSegment,
  SpeedHistogramBucket,
} from '../components/drive-detail/types'

/* ── react-i18next: deterministic English-fallback rendering ─────────────── */
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

/* ── Controlled hook state + stubbed leaf components ─────────────────────── */
interface HookReturn {
  drive: DriveDetail | null
  vehicle: Vehicle | null
  isLoading: boolean
  error: Error | null
  /**
   * Raw query result forwarded by the real hook so the page can derive the
   * shared trust contract. Optional here: when omitted the mock synthesises
   * one from `drive` + `error`, which keeps every pre-existing case working
   * while letting a test model "retained rows + failed refresh" explicitly.
   */
  driveQuery?: {
    data?: DriveDetail
    error?: unknown
    isError?: boolean
    isFetching?: boolean
    dataUpdatedAt?: number
    refetch?: () => unknown
  }
  chartData: ChartDataPoint[]
  stats: DriveStats | null
  trail: LatLngExpression[]
  startPos: [number, number] | undefined
  endPos: [number, number] | undefined
  centerPos: [number, number]
  speedSegments: SpeedSegment[]
  speedHistData: SpeedHistogramBucket[]
}

const hookState: { current: HookReturn } = { current: emptyState() }

/** Mirrors what `useDrive()` would return for the current controlled state. */
function synthesiseDriveQuery(state: HookReturn): NonNullable<HookReturn['driveQuery']> {
  return state.driveQuery ?? {
    data: state.drive ?? undefined,
    error: state.error ?? undefined,
    isError: state.error != null,
    isFetching: false,
    dataUpdatedAt: state.drive != null ? 1_000 : 0,
    refetch: () => {},
  }
}

vi.mock('../components/drive-detail', () => {
  const stub = (testid: string) => () => <div data-testid={testid} />
  return {
    useDriveDetailData: () => ({
      ...hookState.current,
      driveQuery: synthesiseDriveQuery(hookState.current),
    }),
    DriveDetailSkeleton: () => <div data-testid="drive-skeleton" />,
    HeroGauges: stub('hero-gauges'),
    DriveTimeline: stub('drive-timeline'),
    DriveStatCards: stub('stat-cards'),
    SupervisedDrivingPanel: stub('fsd-panel'),
    MoreDetailsPanel: stub('more-details'),
    EnergySummaryPanel: stub('energy-summary'),
    CostSavingsPanel: stub('cost-savings'),
    RouteMapSection: stub('route-map'),
    JourneyDetailsPanel: stub('journey-details'),
    DriveOverviewChart: stub('overview-chart'),
    SocChart: stub('soc-chart'),
    ElevationChart: stub('elevation-chart'),
    TemperatureSection: stub('temperature'),
    SpeedHistogramChart: stub('speed-histogram'),
    PowerProfileChart: stub('power-profile'),
    TirePressureSection: stub('tire-pressure'),
    WhyEndedPanel: stub('why-ended'),
  }
})

const useFsdInsightsRangeMock = vi.hoisted(() => vi.fn(() => ({
    data: {
      drive_analytics: {
        contributing_drives: [],
      },
    },
    error: null,
    isError: false,
    isPending: false,
    isFetching: false,
    fetchStatus: 'idle',
    dataUpdatedAt: 1_000,
    refetch: vi.fn(),
    isStale: false,
  })))

vi.mock('@/api/hooks/useAnalytics', () => ({
  useFsdInsightsRange: useFsdInsightsRangeMock,
}))

vi.mock('@/components/ai/AIDriveCoaching', () => ({
  AIDriveCoaching: ({ driveId }: { driveId?: string }) => (
    <div data-testid="ai-coaching" data-drive-id={driveId ?? ''} />
  ),
}))
vi.mock('@/components/ai/AISpeedProfileInsights', () => ({
  AISpeedProfileInsights: ({ driveId }: { driveId?: string }) => (
    <div data-testid="ai-speed-insights" data-drive-id={driveId ?? ''} />
  ),
}))

vi.mock('../components/ShareDriveDialog', () => ({
  ShareDriveDialog: ({
    driveId,
    open,
    onClose,
  }: {
    driveId: string
    open: boolean
    onClose: () => void
  }) =>
    open ? (
      <div role="dialog" aria-label="Share drive" data-drive-id={driveId}>
        <button type="button" onClick={onClose}>
          close share dialog
        </button>
      </div>
    ) : null,
}))

import DriveDetailPage from './DriveDetailPage'

/* ── Fixtures ────────────────────────────────────────────────────────────── */
function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN00000000000001',
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

function makeDrive(overrides: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: 42,
    vehicleId: 1,
    startTs: '2025-03-01T10:00:00Z',
    endTs: '2025-03-01T10:45:00Z',
    durationS: 2700,
    distanceM: 32000,
    startAddress: 'Downtown Seattle',
    endAddress: 'SeaTac Airport',
    startLat: 47.6,
    startLon: -122.33,
    endLat: 47.44,
    endLon: -122.3,
    startBatteryPct: 82,
    endBatteryPct: 68,
    energyUsedWh: 7200,
    regenEnergyWh: 900,
    avgSpeedMps: 20,
    maxSpeedMps: 31,
    avgPowerW: 15000,
    outsideTempAvgC: 14,
    insideTempAvgC: 21,
    score: 88,
    endedStatus: 'parked',
    createdAt: '2025-03-01T10:45:05Z',
    updatedAt: '2025-03-01T10:45:05Z',
    positions: [],
    telemetry: [],
    ...overrides,
  }
}

function makeStats(overrides: Partial<DriveStats> = {}): DriveStats {
  return {
    maxSpd: 112,
    avgSpd: 72,
    minSpd: 8,
    powerMax: 120,
    powerMin: -40,
    avgPower: 15,
    energyWh: 7200,
    regenWh: 900,
    consumptionWhKm: 225,
    elevGain: 120,
    elevLoss: 90,
    avgOutsideTemp: 14,
    avgInsideTemp: 21,
    hasAnyTemp: true,
    insideTemps: [21],
    outsideTemps: [14],
    driverTemps: [],
    passengerTemps: [],
    climateStatus: 'On',
    avgFanSpeed: 3,
    maxFanSpeed: 6,
    startRange: 300,
    endRange: 250,
    odometerStart: 10000,
    odometerEnd: 10032,
    hasTirePressure: true,
    efficiencyPctPer100: 0.4,
    ...overrides,
  }
}

function emptyState(): HookReturn {
  return {
    drive: null,
    vehicle: null,
    isLoading: false,
    error: null,
    chartData: [],
    stats: null,
    trail: [],
    startPos: undefined,
    endPos: undefined,
    centerPos: [47.6, -122.3],
    speedSegments: [],
    speedHistData: [],
  }
}

function loadedState(
  driveOverrides: Partial<DriveDetail> = {},
  statsOverrides: Partial<DriveStats> = {},
): HookReturn {
  return {
    ...emptyState(),
    drive: makeDrive(driveOverrides),
    vehicle: makeVehicle(),
    stats: makeStats(statsOverrides),
  }
}

const GATED_NUMERIC_SECTIONS = [
  'hero-gauges',
  'stat-cards',
  'more-details',
  'energy-summary',
  'cost-savings',
] as const

const ALWAYS_ON_SECTIONS = [
  'drive-timeline',
  'fsd-panel',
  'route-map',
  'journey-details',
  'overview-chart',
  'soc-chart',
  'elevation-chart',
  'temperature',
  'speed-histogram',
  'power-profile',
  'tire-pressure',
  'why-ended',
  'ai-coaching',
  'ai-speed-insights',
] as const

const NO_TELEMETRY_BANNER = 'No telemetry recorded for this drive'
const NOT_FOUND_COPY =
  'This drive could not be found. It may have been deleted, or the link is incorrect.'

function renderPage(path = '/drives/42', routePath = '/drives/:id') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={<DriveDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  hookState.current = emptyState()
  useFsdInsightsRangeMock.mockClear()
  window.localStorage.clear()
})

/* ── Tests ───────────────────────────────────────────────────────────────── */
describe('DriveDetailPage', () => {
  it('renders only the loading skeleton while telemetry is loading', () => {
    hookState.current = { ...emptyState(), isLoading: true }
    renderPage()

    expect(screen.getByTestId('drive-skeleton')).toBeInTheDocument()
    // No page chrome or sections while the skeleton owns the screen.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.queryByTestId('hero-gauges')).toBeNull()
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
  })

  it('surfaces the query error and withholds every drive section', () => {
    hookState.current = { ...emptyState(), error: new Error('drive fetch exploded') }
    renderPage()

    // ErrorDisplay renders production-safe structured copy rather than the
    // raw error.message — status-less errors fall into the network branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()
    // The generic title still anchors the page…
    expect(screen.getByRole('heading', { level: 1, name: 'Drive Detail' })).toBeInTheDocument()
    // …but the error surface replaces the sections, and the empty state is NOT
    // shown (error takes precedence over the not-found branch).
    expect(screen.queryByTestId('hero-gauges')).toBeNull()
    expect(screen.queryByTestId('drive-timeline')).toBeNull()
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
    expect(screen.queryByTestId('drive-skeleton')).toBeNull()
  })

  it('keeps the retained drive on screen when a BACKGROUND refresh fails', () => {
    // Regression guard for the data-trust contract: `error` being set does
    // NOT mean the page has nothing to show. A refetch that fails over an
    // already-loaded drive must downgrade trust, not delete the record the
    // operator is reading.
    const loaded = loadedState()
    hookState.current = {
      ...loaded,
      error: new Error('refresh exploded'),
      driveQuery: {
        data: loaded.drive ?? undefined,
        error: new Error('refresh exploded'),
        isError: true,
        isFetching: false,
        dataUpdatedAt: 1_000,
        refetch: () => {},
      },
    }
    renderPage()

    // Sections survive…
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
    expect(screen.getByTestId('drive-timeline')).toBeInTheDocument()
    // …the page-level error surface never fires…
    expect(screen.queryByText("Can't reach server")).toBeNull()
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
    // …and the non-blocking staleness warning explains the gap instead.
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument()
  })

  it('warns when retained FSD evidence could not be refreshed', () => {
    hookState.current = loadedState()
    useFsdInsightsRangeMock.mockReturnValueOnce({
      data: {
        drive_analytics: {
          contributing_drives: [],
        },
      },
      error: new Error('FSD refresh failed'),
      isError: true,
      isPending: false,
      isFetching: false,
      fetchStatus: 'idle',
      dataUpdatedAt: 1_000,
      refetch: vi.fn(),
      isStale: true,
    })

    renderPage()

    expect(screen.getByText('Supervised driving may be out of date')).toBeInTheDocument()
    expect(screen.getByTestId('fsd-panel')).toBeInTheDocument()
  })

  it('does not query FSD analytics until an ongoing drive ends', () => {
    hookState.current = loadedState({ endTs: null })

    renderPage()

    expect(useFsdInsightsRangeMock).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      'UTC',
      true,
    )
    expect(screen.getByTestId('fsd-panel')).toBeInTheDocument()
  })

  it('shows an explicit empty state (never a blank page) when the drive is missing', () => {
    hookState.current = emptyState() // drive null, no error, not loading
    renderPage()

    expect(screen.getByText(NOT_FOUND_COPY)).toBeInTheDocument()
    // No sections, but also no error surface / skeleton — the empty branch only.
    expect(screen.queryByTestId('hero-gauges')).toBeNull()
    expect(screen.queryByTestId('drive-timeline')).toBeNull()
    expect(screen.queryByTestId('drive-skeleton')).toBeNull()
  })

  it('renders every section, the route-title heading, and the vehicle meta line for a rich drive', () => {
    hookState.current = loadedState()
    renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Downtown Seattle → SeaTac Airport' }),
    ).toBeInTheDocument()
    // Meta line = vehicle name · start date · start time → end time.
    expect(screen.getByText(/Model 3 LR/)).toBeInTheDocument()

    for (const id of GATED_NUMERIC_SECTIONS) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    for (const id of ALWAYS_ON_SECTIONS) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    // AI surfaces receive the drive id so they can scope their requests.
    expect(screen.getByTestId('ai-coaching')).toHaveAttribute('data-drive-id', '42')
    expect(useFsdInsightsRangeMock).toHaveBeenCalledWith(
      '1',
      '2025-03-01T09:58:00.000Z',
      '2025-03-01T10:47:00.001Z',
      expect.any(String),
      true,
    )
    // A rich drive never shows the telemetry-gap banner.
    expect(screen.queryByText(NO_TELEMETRY_BANNER)).toBeNull()
  })

  it('collapses the numeric panels into a telemetry-gap banner for an all-zero drive', () => {
    hookState.current = loadedState(
      { distanceM: 0, startAddress: null, endAddress: null, telemetry: [], positions: [] },
      { maxSpd: 0, energyWh: 0 },
    )
    renderPage()

    expect(screen.getByText(NO_TELEMETRY_BANNER)).toBeInTheDocument()
    // Every numeric-summary section is withheld…
    for (const id of GATED_NUMERIC_SECTIONS) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    // …while the always-on sections (which self-gate internally) still render.
    expect(screen.getByTestId('drive-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('route-map')).toBeInTheDocument()
    expect(screen.getByTestId('why-ended')).toBeInTheDocument()
    // With no addresses the title falls back to the generic label.
    expect(screen.getByRole('heading', { level: 1, name: 'Drive Detail' })).toBeInTheDocument()
  })

  it('keeps the numeric panels alive when only raw telemetry rows exist (zero aggregates)', () => {
    const rawTelemetryRow = {
      timestamp: '2025-03-01T10:00:10Z',
    } as unknown as DriveDetail['telemetry'][number]
    hookState.current = loadedState(
      { distanceM: 0, telemetry: [rawTelemetryRow] },
      { maxSpd: 0, energyWh: 0 },
    )
    renderPage()

    // Telemetry rows count as "meaningful" → no banner, panels render.
    expect(screen.queryByText(NO_TELEMETRY_BANNER)).toBeNull()
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
    expect(screen.getByTestId('stat-cards')).toBeInTheDocument()
  })

  it('hides only the cost-savings panel when energy is zero but the drive is otherwise meaningful', () => {
    hookState.current = loadedState({ distanceM: 20000 }, { energyWh: 0, maxSpd: 90 })
    renderPage()

    // Meaningful via distance → energy summary shows, cost savings gated off.
    expect(screen.getByTestId('energy-summary')).toBeInTheDocument()
    expect(screen.queryByTestId('cost-savings')).toBeNull()
    // The rest of the numeric band is unaffected.
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
    expect(screen.getByTestId('stat-cards')).toBeInTheDocument()
    expect(screen.queryByText(NO_TELEMETRY_BANNER)).toBeNull()
  })

  it('opens and closes the share dialog through the Share action', () => {
    hookState.current = loadedState()
    renderPage()

    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog', { name: 'Share drive' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('data-drive-id', '42')

    fireEvent.click(screen.getByRole('button', { name: 'close share dialog' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('exposes accessible back / replay / print controls and links replay to the drive id', () => {
    hookState.current = loadedState()
    renderPage()

    // Icon-only back button must carry an accessible name.
    expect(screen.getByRole('button', { name: 'Back to drives' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument()
    const replay = screen.getByRole('link', { name: /Replay/i })
    expect(replay).toHaveAttribute('href', '/drives/42/replay')
  })

  it('omits id-scoped controls when the route carries no drive id', () => {
    hookState.current = loadedState()
    renderPage('/drives', '/drives')

    // Back-to-drives is always available…
    expect(screen.getByRole('button', { name: 'Back to drives' })).toBeInTheDocument()
    // …but replay / share / why-ended are gated on the :id param.
    expect(screen.queryByRole('link', { name: /Replay/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    expect(screen.queryByTestId('why-ended')).toBeNull()
  })
})
