/**
 * DriveDetailPage contract tests.
 *
 * Query readiness separates active loading, cold pause and resolved absence.
 * Retained reports survive refresh failures, and independently paused FSD
 * evidence gets its own notice. Report anchors and section shells remain
 * available through loading, failure, empty/zero data and recovery.
 * Heavy chart, map and AI leaves are stubbed to test page orchestration.
 *
 * `useSettings` / `useTimezone` come from the global stubs in
 * src/test-setup.ts; react-i18next is stubbed locally so the English fallbacks
 * render deterministically (the repo convention — see TimelinePage.test.tsx).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ComponentProps, ReactNode } from 'react'
import type { DataStateSource } from '@/api/dataState'
import type { FsdDriveAnalytics } from '@/types/fsd'
import { BUTTON_BASE, BUTTON_VARIANTS } from '@/components/ui'
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
  timezone?: string
  isLoading: boolean
  error: Error | null
  /**
   * Raw query result forwarded by the real hook so the page can derive the
   * shared trust contract. Optional here: when omitted the mock synthesises
   * one from `drive` + `error`, which keeps every pre-existing case working
   * while letting a test model "retained rows + failed refresh" explicitly.
   */
  driveQuery?: DataStateSource<DriveDetail | null>
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
    data: state.drive ?? (state.isLoading || state.error ? undefined : null),
    error: state.error ?? undefined,
    isError: state.error != null,
    isPending: state.isLoading,
    isFetching: state.isLoading,
    isSuccess: !state.isLoading && !state.error,
    fetchStatus: state.isLoading ? 'fetching' : 'idle',
    dataUpdatedAt: state.drive != null ? 1_000 : 0,
    refetch: () => {},
  }
}

vi.mock('../components/drive-detail', async () => {
  const { SupervisedDrivingPanel } = await vi.importActual<
    typeof import('../components/drive-detail/SupervisedDrivingPanel')
  >('../components/drive-detail/SupervisedDrivingPanel')
  const stub = (testid: string) => () => <div data-testid={testid} />
  return {
    useDriveDetailData: () => ({
      ...hookState.current,
      timezone: hookState.current.timezone ?? 'UTC',
      driveQuery: synthesiseDriveQuery(hookState.current),
    }),
    DriveDetailSkeleton: () => <div data-testid="drive-skeleton" />,
    HeroGauges: stub('hero-gauges'),
    DrivePhysicsDebriefPanel: stub('physics-debrief'),
    DriveTimeline: stub('drive-timeline'),
    DriveStatCards: stub('stat-cards'),
    SupervisedDrivingPanel: (props: ComponentProps<typeof SupervisedDrivingPanel>) => (
      <div data-testid="fsd-panel" data-loading={String(props.isLoading)}>
        <SupervisedDrivingPanel {...props} />
      </div>
    ),
    GearTheaterPanel: stub('gear-theater'),
    SilentCounterPanel: stub('silent-counter'),
    DriveLedgerCompactPanel: stub('drive-ledger-compact'),
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
    RoadAnomalyPanel: stub('road-anomalies'),
  }
})

const useFsdInsightsForDriveMock = vi.hoisted(() => vi.fn((): DataStateSource<{
  drive_analytics: Pick<FsdDriveAnalytics, 'contributing_drives'>
}> => ({
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
  useFsdInsightsForDrive: useFsdInsightsForDriveMock,
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
  'more-details',
  'cost-savings',
] as const

const ALWAYS_ON_SECTIONS = [
  'physics-debrief',
  'gear-theater',
  'fsd-panel',
  'silent-counter',
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
  'road-anomalies',
  'ai-coaching',
  'ai-speed-insights',
] as const

const NO_TELEMETRY_BANNER = 'No telemetry recorded for this drive'
const NOT_FOUND_COPY =
  'This drive could not be found. It may have been deleted, or the link is incorrect.'

function renderPage(path = '/drives/42', routePath = '/drives/:id') {
  const page = () => (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={<DriveDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
  const result = render(page())
  return { ...result, rerenderPage: () => result.rerender(page()) }
}

beforeEach(() => {
  hookState.current = emptyState()
  useFsdInsightsForDriveMock.mockClear()
  window.localStorage.clear()
})

/* ── Tests ───────────────────────────────────────────────────────────────── */
describe('DriveDetailPage', () => {
  it('uses the loaded drive business timezone for FSD evidence, not workspace scope', () => {
    hookState.current = { ...loadedState(), timezone: 'Pacific/Auckland' }
    renderPage()
    expect(useFsdInsightsForDriveMock).toHaveBeenCalledWith('1', '42', 'Pacific/Auckland', true)
  })

  it('does not announce absence for an unresolved idle drive source', () => {
    hookState.current = { ...emptyState(), driveQuery: { isPending: true, fetchStatus: 'idle' } }
    renderPage()

    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
    expect(screen.queryByTestId('drive-skeleton')).toBeNull()
    expect(screen.getByRole('region', { name: 'Route' })).toBeInTheDocument()
  })

  it('uses source readiness rather than the aggregate loading flag', () => {
    hookState.current = {
      ...emptyState(),
      driveQuery: { isPending: true, isFetching: true, fetchStatus: 'fetching' },
    }
    renderPage()

    expect(screen.getByTestId('drive-skeleton')).toBeInTheDocument()
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
  })

  it('discloses a cold paused drive and recovers without claiming it is missing', () => {
    const refetch = vi.fn()
    hookState.current = {
      ...emptyState(),
      isLoading: true,
      driveQuery: { isPending: true, fetchStatus: 'paused', refetch },
    }
    const { rerenderPage } = renderPage()

    expect(screen.getByText('Refresh paused')).toBeInTheDocument()
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
    expect(screen.queryByTestId('drive-skeleton')).toBeNull()
    expect(screen.getByRole('region', { name: 'Route' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Drive detail' }))
    expect(refetch).toHaveBeenCalledOnce()

    hookState.current = loadedState()
    rerenderPage()
    expect(screen.queryByText('Refresh paused')).toBeNull()
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
  })

  it('discloses independently paused FSD without treating it as loading or hiding the drive', () => {
    hookState.current = loadedState()
    const refetch = vi.fn()
    useFsdInsightsForDriveMock.mockReturnValueOnce({
      isPending: true, fetchStatus: 'paused', refetch,
    })
    const { rerenderPage } = renderPage()

    expect(screen.getByText('Refresh paused')).toBeInTheDocument()
    expect(screen.getByTestId('fsd-panel')).toHaveAttribute('data-loading', 'false')
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Supervised driving' }))
    expect(refetch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Retry supervised-driving evidence' })).toBeNull()
    rerenderPage()
    expect(screen.queryByText('Refresh paused')).toBeNull()
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
  })

  it('does not disclose paused FSD before its drive prerequisite exists', () => {
    useFsdInsightsForDriveMock.mockReturnValueOnce({
      isPending: true, fetchStatus: 'paused',
    })
    renderPage()

    expect(screen.queryByText('Refresh paused')).toBeNull()
    expect(screen.getByTestId('fsd-panel')).toHaveAttribute('data-loading', 'false')
  })

  it('distinguishes active FSD loading from successfully empty evidence', () => {
    hookState.current = loadedState()
    useFsdInsightsForDriveMock.mockReturnValueOnce({
      isPending: true, isFetching: true, fetchStatus: 'fetching',
    })
    const { rerenderPage } = renderPage()
    expect(screen.getByTestId('fsd-panel')).toHaveAttribute('data-loading', 'true')

    rerenderPage()
    expect(screen.getByTestId('fsd-panel')).toHaveAttribute('data-loading', 'false')
    expect(screen.queryByText('Refresh paused')).toBeNull()
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry supervised-driving evidence' })).toBeNull()
  })

  it('retries a cold FSD failure without refetching the drive and recovers', () => {
    const driveRefetch = vi.fn()
    const fsdRefetch = vi.fn()
    const loaded = loadedState()
    hookState.current = {
      ...loaded,
      driveQuery: { data: loaded.drive, isSuccess: true, fetchStatus: 'idle', refetch: driveRefetch },
    }
    useFsdInsightsForDriveMock.mockReturnValueOnce({
      isError: true, error: new Error('FSD failed'), fetchStatus: 'idle', refetch: fsdRefetch,
    })
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Retry supervised-driving evidence' }))
    expect(fsdRefetch).toHaveBeenCalledOnce()
    expect(driveRefetch).not.toHaveBeenCalled()
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Route' })).toBeInTheDocument()

    rerenderPage()
    expect(screen.queryByText(/could not be loaded/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry supervised-driving evidence' })).toBeNull()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
  })

  it('clears a retained refresh failure after recovery without losing report sections', () => {
    const loaded = loadedState()
    hookState.current = {
      ...loaded,
      driveQuery: {
        data: loaded.drive, isError: true, error: new Error('refresh failed'),
        fetchStatus: 'idle', dataUpdatedAt: 1_000,
      },
    }
    const { rerenderPage } = renderPage()
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()

    hookState.current = loaded
    rerenderPage()
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull()
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
  })

  it('keeps report context and section placeholders while telemetry is loading', () => {
    hookState.current = { ...emptyState(), isLoading: true }
    renderPage()

    expect(screen.getByTestId('drive-skeleton')).toBeInTheDocument()
    // No page chrome or sections while the skeleton owns the screen.
    expect(screen.getByRole('heading', { level: 1, name: 'Drive detail' })).toBeInTheDocument()
    expect(screen.queryByTestId('hero-gauges')).toBeNull()
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
    expect(screen.getByText('No Route data is available for this drive.')).toBeInTheDocument()
  })

  it('surfaces the query error without hiding independent evidence or report shells', () => {
    hookState.current = { ...emptyState(), error: new Error('drive fetch exploded') }
    renderPage()

    // ErrorDisplay renders production-safe structured copy rather than the
    // raw error.message — status-less errors fall into the network branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()
    // The generic title still anchors the page…
    expect(screen.getByRole('heading', { level: 1, name: 'Drive detail' })).toBeInTheDocument()
    // …but the error surface replaces the sections, and the empty state is NOT
    // shown (error takes precedence over the not-found branch).
    expect(screen.queryByTestId('hero-gauges')).toBeNull()
    expect(screen.queryByTestId('drive-timeline')).toBeNull()
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
    expect(screen.getByText('No Route data is available for this drive.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Route' })).toBeInTheDocument()
    expect(screen.getByTestId('drive-ledger-compact')).toBeInTheDocument()
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
    expect(screen.getByTestId('journey-details')).toBeInTheDocument()
    // …the page-level error surface never fires…
    expect(screen.queryByText("Can't reach server")).toBeNull()
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull()
    // …and the non-blocking staleness warning explains the gap instead.
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument()
  })

  it('warns when retained FSD evidence could not be refreshed', () => {
    hookState.current = loadedState()
    const refetch = vi.fn()
    useFsdInsightsForDriveMock.mockReturnValueOnce({
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
      refetch,
      isStale: true,
    })

    const { rerenderPage } = renderPage()

    expect(screen.getByText('Supervised driving may be out of date')).toBeInTheDocument()
    expect(screen.getByTestId('fsd-panel')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText(/could not be loaded/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refetch).toHaveBeenCalledOnce()
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
    rerenderPage()
    expect(screen.queryByText('Supervised driving may be out of date')).toBeNull()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('still loads drive-scoped FSD analytics for an in-progress drive', () => {
    hookState.current = loadedState({ endTs: null })

    renderPage()

    expect(useFsdInsightsForDriveMock).toHaveBeenCalledWith(
      '1',
      '42',
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
    expect(useFsdInsightsForDriveMock).toHaveBeenCalledWith(
      '1',
      '42',
      expect.any(String),
      true,
    )
    // A rich drive never shows the telemetry-gap banner.
    expect(screen.queryByText(NO_TELEMETRY_BANNER)).toBeNull()
  })

  it('retains all canonical and drilldown shells with a telemetry-gap notice for an all-zero drive', () => {
    hookState.current = loadedState(
      { distanceM: 0, startAddress: null, endAddress: null, telemetry: [], positions: [] },
      { maxSpd: 0, energyWh: 0 },
    )
    renderPage()

    expect(screen.getByText(NO_TELEMETRY_BANNER)).toBeInTheDocument()
    // Every numeric-summary section is withheld…
    for (const id of GATED_NUMERIC_SECTIONS) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    // …while the always-on sections (which self-gate internally) still render.
    expect(screen.getByTestId('journey-details')).toBeInTheDocument()
    expect(screen.getByTestId('route-map')).toBeInTheDocument()
    expect(screen.getByTestId('why-ended')).toBeInTheDocument()
    // With no addresses the title falls back to the generic label.
    expect(screen.getByRole('heading', { level: 1, name: 'Drive detail' })).toBeInTheDocument()
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
    expect(screen.queryByTestId('stat-cards')).toBeNull()
  })

  it('does not hide cost evidence for a recorded zero-energy drive', () => {
    hookState.current = loadedState({ distanceM: 20000 }, { energyWh: 0, maxSpd: 90 })
    renderPage()

    // Meaningful via distance → energy summary shows, cost savings gated off.
    expect(screen.getByTestId('more-details')).toBeInTheDocument()
    expect(screen.getByTestId('cost-savings')).toBeInTheDocument()
    // The rest of the numeric band is unaffected.
    expect(screen.getByTestId('hero-gauges')).toBeInTheDocument()
    expect(screen.queryByTestId('stat-cards')).toBeNull()
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
    expect(screen.getByRole('link', { name: 'Back to drives' })).toHaveAttribute('href', '/drives')
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument()
    const replay = screen.getByRole('link', { name: /Replay/i })
    expect(replay).toHaveAttribute('href', '/drives/42/replay')
  })

  it('omits id-scoped controls when the route carries no drive id', () => {
    hookState.current = loadedState()
    renderPage('/drives', '/drives')

    // Back-to-drives is always available…
    expect(screen.getByRole('link', { name: 'Back to drives' })).toHaveAttribute('href', '/drives')
    // …but replay / share / why-ended are gated on the :id param.
    expect(screen.queryByRole('link', { name: /Replay/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    expect(screen.queryByTestId('why-ended')).toBeNull()
  })

  it('renders back and replay as single native links with shared neutral chrome and decorative icons', () => {
    hookState.current = loadedState()
    renderPage()

    const back = screen.getByRole('link', { name: 'Back to drives' })
    const replay = screen.getByRole('link', { name: 'Replay' })
    expect(back).toHaveClass(...BUTTON_BASE.split(' '), ...BUTTON_VARIANTS.ghost.split(' '))
    expect(replay).toHaveClass(...BUTTON_BASE.split(' '), ...BUTTON_VARIANTS.secondary.split(' '))
    for (const link of [back, replay]) {
      expect(link.tagName).toBe('A')
      expect(link.querySelector('button, a, [tabindex]')).toBeNull()
      expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      expect(link.querySelector('svg')).toHaveAttribute('focusable', 'false')
    }
    expect(screen.queryByRole('button', { name: 'Back to drives' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull()
  })

  it('keeps every header action touch-sized below md without changing destinations or share ownership', () => {
    hookState.current = loadedState()
    renderPage()

    for (const action of [
      screen.getByRole('link', { name: 'Back to drives' }),
      screen.getByRole('link', { name: 'Replay' }),
      screen.getByRole('button', { name: 'Share' }),
      screen.getByRole('button', { name: 'Print' }),
    ]) {
      expect(action).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9')
    }
    expect(screen.getByRole('link', { name: 'Replay' })).toHaveAttribute('href', '/drives/42/replay')
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('dialog', { name: 'Share drive' })).toHaveAttribute('data-drive-id', '42')
  })

  it.each([
    { name: 'missing record', loaded: false },
    { name: 'retained rich record', loaded: true },
  ])('preserves all twenty-one report anchors and eight jump destinations for $name', ({ loaded }) => {
    hookState.current = loaded ? loadedState() : emptyState()
    const { container } = renderPage()

    const sectionIds = [
      'overview', 'journey', 'route', 'energy-evidence', 'cost-estimate',
      'fsd-evidence', 'silent-counter', 'telemetry', 'battery-trace',
      'speed-distribution', 'power-trace', 'elevation-trace', 'temperature-trace',
      'tire-trace', 'speed-insights', 'physics-debrief', 'physics-ledger',
      'coaching', 'gear-theater', 'road-analysis', 'why-ended',
    ]
    for (const id of sectionIds) {
      expect(container.querySelector(`section#${id}`)).toBeInTheDocument()
    }
    expect(container.querySelectorAll('section[id][aria-label]')).toHaveLength(21)
    const navigation = screen.getByRole('navigation', { name: 'Drive report sections' })
    expect(Array.from(navigation.querySelectorAll('a'), link => link.getAttribute('href'))).toEqual([
      '#overview', '#journey', '#route', '#energy', '#telemetry', '#supervised', '#physics', '#diagnostics',
    ])
    expect(screen.getByTestId('drive-ledger-compact')).toBeInTheDocument()
    expect(screen.getByTestId('gear-theater')).toBeInTheDocument()
    expect(screen.getByTestId('silent-counter')).toBeInTheDocument()
  })
})
