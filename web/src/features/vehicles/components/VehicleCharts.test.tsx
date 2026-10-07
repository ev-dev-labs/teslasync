/**
 * VehicleCharts — behaviour + hardening contract.
 *
 * `VehicleCharts` composes four independent panels for the vehicle-detail page
 * from already-fetched props (it owns no data source): a live GPS map, a vehicle
 * configuration grid, a car-display-preferences grid, and a speed-history area
 * chart. These tests pin every branch a user can reach plus the hardening this
 * elevation added:
 *
 *   - MAP      → renders only when the vehicle has a real fix, plots the marker
 *                at the live coord, draws the polyline only for 2+ VALID points,
 *                drops the (0,0) "no fix" placeholder from the trail, exposes the
 *                map as a named region, and drives the tile style from the layer
 *                switcher; the whole panel disappears at (0,0)/undefined coords;
 *   - CONFIG   → renders each field, scrubs Go's `<nil>` sentinel via cleanNil,
 *                maps tri-state booleans to Yes/No/Active/Off/Present and an em
 *                dash when unknown, formats SW %; hidden when no snapshot;
 *   - PREFS    → surfaces parsed Tesla setting enums + a 24h Yes/No; hidden when
 *                no snapshot;
 *   - SPEED    → converts the SI `speed_mph` samples through the REAL
 *                convertSpeedFromSI at the render boundary (km/h vs mph), reverses
 *                to oldest→newest, drops non-finite samples to null gaps, and —
 *                the hardening this suite locks in — shows the empty state (never
 *                a blank chart frame) when there are no positions OR no finite
 *                speed at all;
 *   - a11y     → every decorative section icon is aria-hidden and the map carries
 *                an accessible region label.
 *
 * Conventions mirror the sibling RouteMapSection / SOCRouteChart suites: the
 * jsdom-hostile `@/components/maps` + `@/components/charts` barrels are replaced
 * with inert prop-capturing stubs (leaflet/recharts measure a 0×0 bbox in jsdom),
 * `react-i18next` echoes the inline English fallback and runs `{{token}}`
 * interpolation, `FadeIn` is a passthrough (its framer-motion/matchMedia reach is
 * irrelevant), and `useUnits` is the settings-backed boundary hook mocked to drive
 * the km/mi branch while the REAL convertSpeedFromSI runs. GlassPanel + MetricCard
 * render for real. Interactions use `fireEvent` (repo convention — user-event is
 * not installed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { ReactNode } from 'react'

import { VehicleCharts } from './VehicleCharts'
import { convertSpeedFromSI } from '@/lib/unitConversion'
import type {
  VehicleState,
  Position,
  VehicleConfigSnapshot,
  UserPreferenceSnapshot,
} from '@/api/types'

/* ── Hoisted controllable state (read inside the vi.mock factories) ─────────── */
const unitCtl = vi.hoisted(() => ({ speed: 'km/h' as 'km/h' | 'mph' }))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const interpolate = (s: string, opts?: Record<string, unknown>) => {
    if (!opts) return s
    let out = s
    for (const [k, v] of Object.entries(opts)) out = out.replace(`{{${k}}}`, String(v))
    return out
  }
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        if (opts && typeof opts.defaultValue === 'string')
          return interpolate(opts.defaultValue, opts)
        return interpolate(fallback ?? key, opts)
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: unitCtl.speed === 'mph' ? 'mi' : 'km',
      speed: unitCtl.speed,
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: 2,
    },
  }),
}))

// FadeIn reaches for framer-motion + matchMedia via useMotionPreference; a
// passthrough keeps the test focused on VehicleCharts' own logic.
vi.mock('@/components/motion/FadeIn', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// Capture the leaflet plumbing — the visual children just echo the props
// VehicleCharts feeds them so marker/trail/tile decisions are assertable.
vi.mock('@/components/maps', () => ({
  vehicleIcon: () => ({ __icon: true }),
  MapContainer: ({
    children,
    center,
    zoom,
  }: {
    children?: ReactNode
    center: unknown
    zoom: number
  }) => (
    <div data-testid="map-container" data-center={JSON.stringify(center)} data-zoom={String(zoom)}>
      {children}
    </div>
  ),
   
  Marker: ({ position }: any) => (
    <div data-testid="marker" data-position={JSON.stringify(position)} />
  ),
   
  Polyline: ({ positions, pathOptions }: any) => (
    <div
      data-testid="polyline"
      data-count={String((positions ?? []).length)}
      data-color={pathOptions?.color}
    />
  ),
  MapTileLayer: ({ style }: { style?: string }) => (
    <div data-testid="tile-layer" data-style={style} />
  ),
  MapInvalidator: () => <div data-testid="map-invalidator" />,
   
  MapLayerSwitcher: ({ current, onChange }: any) => (
    <div data-testid="layer-switcher">
      {(['dark', 'satellite', 'streets', 'terrain'] as const).map((s) => (
        <button key={s} type="button" aria-pressed={current === s} onClick={() => onChange(s)}>
          {s}
        </button>
      ))}
    </div>
  ),
}))

// Recharts measures the SVG bbox and jsdom returns 0×0, so the chart barrel is
// replaced with inert stubs. AreaChart exposes its `data` (the derived speed
// series) and Area exposes its `name` so conversion + labelling are assertable.
vi.mock('@/components/charts', async () => ({
  ...(await import('@/test/chartTestDoubles')).chartTestDoubles,
   
  AreaChart: ({ data, children }: any) => (
    <div data-testid="area-chart" data-series={JSON.stringify(data)}>
      {children}
    </div>
  ),
   
  Area: ({ name, dataKey }: any) => (
    <div data-testid="area" data-name={String(name)} data-datakey={String(dataKey)} />
  ),
   
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ChartTooltip: () => null,
  AREA_DEFAULTS: {},
  areaGradient: () => null,
}))

/* ── Fixtures ──────────────────────────────────────────────────────────────── */
function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 47.6062,
    longitude: -122.3321,
    heading: 90,
    speed: 0,
    power: 0,
    battery_level: 72,
    rated_range: 500,
    ideal_range: 480,
    odometer: 12_000,
    inside_temp: 21,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2025.1',
    ...overrides,
  }
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    vehicle_id: 1,
    ts: '2025-03-01T10:00:00Z',
    latitude: 47.61,
    longitude: -122.34,
    heading: 90,
    speed_mph: 10,
    elevation_m: 40,
    gps_state: 'fix',
    source: 'telemetry',
    ...overrides,
  }
}

function makeConfig(overrides: Partial<VehicleConfigSnapshot> = {}): VehicleConfigSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    created_at: '2025-03-01T00:00:00Z',
    ...overrides,
  }
}

function makePrefs(overrides: Partial<UserPreferenceSnapshot> = {}): UserPreferenceSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    created_at: '2025-03-01T00:00:00Z',
    ...overrides,
  }
}

interface RenderOpts {
  state?: VehicleState
  positions?: Position[]
  vehicleConfigData?: VehicleConfigSnapshot | null
  userPrefData?: UserPreferenceSnapshot | null
}

function renderCharts(opts: RenderOpts = {}) {
  return render(
    <VehicleCharts
      state={opts.state ?? makeState()}
      positions={opts.positions}
      vehicleConfigData={'vehicleConfigData' in opts ? opts.vehicleConfigData : null}
      userPrefData={'userPrefData' in opts ? opts.userPrefData : null}
    />,
  )
}

/** Parse the JSON the AreaChart stub captured as its `data` prop. */
function chartSeries(): Array<{ time: string; speed: number | null }> {
  const el = screen.getByTestId('area-chart')
  return JSON.parse(el.getAttribute('data-series') ?? '[]')
}

/** The nearest MetricCard body wrapping a label — used to scope value asserts. */
function cardFor(label: string): HTMLElement {
  return screen.getByText(label).closest('div') as HTMLElement
}

beforeEach(() => {
  unitCtl.speed = 'km/h'
})

afterEach(() => {
  cleanup()
})

/* ── LIVE MAP ──────────────────────────────────────────────────────────────── */
describe('VehicleCharts — live map', () => {
  it('renders the map, marker, and coordinate readout when the vehicle has a fix', () => {
    renderCharts({ state: makeState({ latitude: 47.6062, longitude: -122.3321 }) })

    const map = screen.getByTestId('map-container')
    expect(map).toBeInTheDocument()
    expect(map).toHaveAttribute('data-zoom', '14')
    expect(map).toHaveAttribute('data-center', JSON.stringify([47.6062, -122.3321]))
    expect(screen.getByTestId('marker')).toHaveAttribute(
      'data-position',
      JSON.stringify([47.6062, -122.3321]),
    )
    // Coordinate footer renders through fmtNumber (precision 2 from settings).
    expect(screen.getByText('47.61, -122.33')).toBeInTheDocument()
  })

  it('exposes the map as an accessible, labelled region', () => {
    renderCharts()
    expect(screen.getByRole('region', { name: 'Vehicle location map' })).toBeInTheDocument()
  })

  it('draws the trail polyline only when two or more valid GPS points exist', () => {
    const { rerender } = renderCharts({ positions: [makePosition()] })
    // A single point → no polyline (a line needs 2 endpoints).
    expect(screen.queryByTestId('polyline')).toBeNull()

    rerender(
      <VehicleCharts
        state={makeState()}
        positions={[
          makePosition({ latitude: 47.61, longitude: -122.34 }),
          makePosition({ latitude: 47.62, longitude: -122.35 }),
        ]}
        vehicleConfigData={null}
        userPrefData={null}
      />,
    )
    const line = screen.getByTestId('polyline')
    expect(line).toHaveAttribute('data-count', '2')
    expect(line).toHaveAttribute('data-color', '#00f0ff')
  })

  it('drops the (0,0) no-fix placeholder from the trail', () => {
    renderCharts({
      positions: [
        makePosition({ latitude: 0, longitude: 0 }),
        makePosition({ latitude: 47.61, longitude: -122.34 }),
        makePosition({ latitude: 47.62, longitude: -122.35 }),
      ],
    })
    // Three raw points, but the placeholder is filtered → 2 plotted.
    expect(screen.getByTestId('polyline')).toHaveAttribute('data-count', '2')
  })

  it('hides the entire map panel when the vehicle has no location fix', () => {
    renderCharts({ state: makeState({ latitude: 0, longitude: 0 }) })

    expect(screen.queryByTestId('map-container')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Vehicle location map' })).toBeNull()
    expect(screen.queryByText('Location')).toBeNull()
  })

  it('drives the tile-layer style from the map layer switcher', () => {
    renderCharts()
    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'dark')

    fireEvent.click(screen.getByRole('button', { name: 'satellite' }))
    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'satellite')

    fireEvent.click(screen.getByRole('button', { name: 'terrain' }))
    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'terrain')
  })
})

/* ── VEHICLE CONFIGURATION ─────────────────────────────────────────────────── */
describe('VehicleCharts — vehicle configuration', () => {
  it('renders configuration fields and scrubs Go <nil> sentinels to an em dash', () => {
    renderCharts({
      vehicleConfigData: makeConfig({
        car_type: 'Model 3',
        trim: '<nil>',
        exterior_color: 'Pearl White',
      }),
    })

    expect(screen.getByRole('heading', { name: 'Vehicle Configuration' })).toBeInTheDocument()
    expect(within(cardFor('Model')).getByText('Model 3')).toBeInTheDocument()
    expect(within(cardFor('Color')).getByText('Pearl White')).toBeInTheDocument()
    // `<nil>` is scrubbed by cleanNil → the em-dash fallback.
    expect(cardFor('Trim')).toHaveTextContent('—')
  })

  it('maps tri-state booleans to Yes / No / — and enum-ish labels', () => {
    renderCharts({
      vehicleConfigData: makeConfig({
        europe_vehicle: true,
        right_hand_drive: false,
        // remote_start_enabled + offroad_lightbar_present left undefined → em dash
        rear_seat_heaters: undefined,
      }),
    })

    expect(cardFor('Europe Vehicle')).toHaveTextContent('Yes')
    expect(cardFor('Right-Hand Drive')).toHaveTextContent('No')
    expect(cardFor('Remote Start')).toHaveTextContent('—')
    expect(cardFor('Offroad Lightbar')).toHaveTextContent('—')
  })

  it('renders Active/Off and Present labels and formats SW percentages', () => {
    renderCharts({
      vehicleConfigData: makeConfig({
        remote_start_enabled: true,
        offroad_lightbar_present: true,
        software_update_download_pct: 45,
        software_update_install_pct: 0,
      }),
    })

    expect(cardFor('Remote Start')).toHaveTextContent('Active')
    expect(cardFor('Offroad Lightbar')).toHaveTextContent('Present')
    expect(cardFor('SW Download')).toHaveTextContent('45%')
    // 0 is a real percentage (not nullish) → "0%", not the em dash.
    expect(cardFor('SW Install')).toHaveTextContent('0%')
  })

  it('falls back to "Not Installed" / "None" for absent sunroof + SW version', () => {
    renderCharts({ vehicleConfigData: makeConfig({}) })

    expect(cardFor('Sunroof')).toHaveTextContent('Not Installed')
    expect(cardFor('SW Update')).toHaveTextContent('None')
  })

  it('hides the configuration panel when no snapshot is provided', () => {
    renderCharts({ vehicleConfigData: null })
    expect(screen.queryByRole('heading', { name: 'Vehicle Configuration' })).toBeNull()
    expect(screen.queryByText('Model')).toBeNull()
  })
})

/* ── USER PREFERENCES ──────────────────────────────────────────────────────── */
describe('VehicleCharts — car display preferences', () => {
  it('surfaces parsed Tesla setting enums and the sync-hint copy', () => {
    renderCharts({
      userPrefData: makePrefs({
        setting_distance_unit: 'DistanceUnitMiles',
        setting_temperature_unit: 'TemperatureUnitCelsius',
        setting_charge_unit: 'ChargeUnitPercent',
        setting_tire_pressure_unit: 'PressureUnitPsi',
      }),
    })

    expect(screen.getByRole('heading', { name: 'Car Display Preferences' })).toBeInTheDocument()
    expect(within(cardFor('Distance')).getByText('Miles')).toBeInTheDocument()
    expect(within(cardFor('Temperature')).getByText('Celsius')).toBeInTheDocument()
    expect(within(cardFor('Charge Unit')).getByText('Percent')).toBeInTheDocument()
    expect(within(cardFor('Tire Pressure')).getByText('PSI')).toBeInTheDocument()
    expect(screen.getByText(/These are your vehicle's display settings/)).toBeInTheDocument()
  })

  it('renders the 24h-time flag as Yes / No / —', () => {
    const { rerender } = renderCharts({ userPrefData: makePrefs({ setting_24hr_time: true }) })
    expect(cardFor('24h Time')).toHaveTextContent('Yes')

    rerender(
      <VehicleCharts
        state={makeState()}
        positions={undefined}
        vehicleConfigData={null}
        userPrefData={makePrefs({ setting_24hr_time: false })}
      />,
    )
    expect(cardFor('24h Time')).toHaveTextContent('No')

    rerender(
      <VehicleCharts
        state={makeState()}
        positions={undefined}
        vehicleConfigData={null}
        userPrefData={makePrefs({ setting_24hr_time: undefined })}
      />,
    )
    expect(cardFor('24h Time')).toHaveTextContent('—')
  })

  it('hides the preferences panel when no snapshot is provided', () => {
    renderCharts({ userPrefData: null })
    expect(screen.queryByRole('heading', { name: 'Car Display Preferences' })).toBeNull()
  })
})

/* ── SPEED HISTORY CHART ───────────────────────────────────────────────────── */
describe('VehicleCharts — speed history', () => {
  it('converts the SI speed samples to km/h and orders them oldest → newest', () => {
    renderCharts({
      positions: [
        // API returns newest-first; the chart reverses to oldest→newest.
        makePosition({ ts: '2025-03-01T10:05:00Z', speed_mph: 20 }),
        makePosition({ ts: '2025-03-01T10:00:00Z', speed_mph: 10 }),
      ],
    })

    const series = chartSeries()
    expect(series).toHaveLength(2)
    // 10 m/s → 36 km/h, 20 m/s → 72 km/h (real convertSpeedFromSI).
    expect(series[0].speed).toBe(convertSpeedFromSI(10, 'km/h'))
    expect(series[1].speed).toBe(convertSpeedFromSI(20, 'km/h'))
    // The series is labelled with the resolved display unit.
    expect(screen.getByTestId('area')).toHaveAttribute('data-name', 'Speed km/h')
  })

  it('converts speed to mph when the unit preference is imperial', () => {
    unitCtl.speed = 'mph'
    renderCharts({ positions: [makePosition({ speed_mph: 10 })] })

    const series = chartSeries()
    expect(series[0].speed).toBe(convertSpeedFromSI(10, 'mph'))
    expect(series[0].speed).not.toBe(convertSpeedFromSI(10, 'km/h'))
    expect(screen.getByTestId('area')).toHaveAttribute('data-name', 'Speed mph')
  })

  it('drops non-finite speed samples to null gaps while still plotting the chart', () => {
    renderCharts({
      positions: [
        makePosition({ ts: '2025-03-01T10:00:00Z', speed_mph: 12 }),
        makePosition({ ts: '2025-03-01T10:01:00Z', speed_mph: null }),
      ],
    })

    const series = chartSeries()
    expect(series).toHaveLength(2)
    // Exactly one finite datum and one null gap survive.
    expect(series.filter((d) => d.speed === null)).toHaveLength(1)
    expect(series.filter((d) => typeof d.speed === 'number')).toHaveLength(1)
    expect(screen.getByTestId('area-chart')).toBeInTheDocument()
  })

  it('shows the empty state (never a blank chart) when there are no positions', () => {
    renderCharts({ positions: undefined })

    expect(screen.getByText('Position data will appear here')).toBeInTheDocument()
    expect(screen.queryByTestId('area-chart')).toBeNull()
  })

  it('shows the empty state when positions carry no finite speed at all', () => {
    renderCharts({
      positions: [makePosition({ speed_mph: null }), makePosition({ speed_mph: null })],
    })

    expect(screen.getByText('Position data will appear here')).toBeInTheDocument()
    expect(screen.queryByTestId('area-chart')).toBeNull()
  })

  it('always renders the speed-history heading even with no data', () => {
    renderCharts({ positions: undefined })
    expect(screen.getByRole('heading', { name: 'Speed History' })).toBeInTheDocument()
  })
})

/* ── ACCESSIBILITY + ROBUSTNESS ────────────────────────────────────────────── */
describe('VehicleCharts — accessibility & robustness', () => {
  it('marks every decorative section icon as aria-hidden', () => {
    const { container } = renderCharts({
      positions: [makePosition({ speed_mph: 15 })],
      vehicleConfigData: makeConfig({ car_type: 'Model Y' }),
      userPrefData: makePrefs({ setting_24hr_time: true }),
    })

    // Four section headers (Location, Vehicle Config, Preferences, Speed History)
    // each carry one decorative lucide icon — all hidden from the a11y tree.
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBe(4)
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })

  it('does not throw when positions and both snapshots are undefined/null', () => {
    expect(() =>
      renderCharts({ positions: undefined, vehicleConfigData: null, userPrefData: null }),
    ).not.toThrow()
    // The always-on speed panel still renders its empty state.
    expect(screen.getByText('Position data will appear here')).toBeInTheDocument()
  })
})
