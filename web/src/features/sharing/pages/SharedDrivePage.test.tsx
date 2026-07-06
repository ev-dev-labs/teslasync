/**
 * SharedDrivePage — contract + hardening tests.
 *
 * `features/sharing/pages/SharedDrivePage` is the public, chrome-less drive
 * report shown to unauthenticated recipients of a share link. Its own logic
 * (everything the leaf components don't own) is:
 *
 *   1. `normalizeSharedDriveData` — the v2-SI / legacy-v1 wire discriminator +
 *      the km/min/kmh → SI conversion for legacy payloads.
 *   2. The four unit-aware display helpers (elevation ft/m, efficiency Wh/mi vs
 *      Wh/km, and the SI→display boundary threaded through `useUnits`).
 *   3. The map/elevation/speed derivations (`mapPoints`, `center`, chart data).
 *   4. Branch rendering: loading spinner, error/expired view, the honest
 *      "no route data" empty state, and every optional stat card that gates on
 *      a nullable field.
 *
 * These tests control the `useSharedDrive` query hook + the unit preference and
 * replace the two jsdom-hostile barrels (leaflet `@/components/maps`, recharts
 * `@/components/charts`) with inert prop-capturing stubs so the assertions
 * target the page's own logic. `react-i18next` is stubbed locally for
 * deterministic English-fallback rendering (repo convention — see
 * DriveDetailPage.test.tsx / MapOverviewPage.test.tsx); `useSettings` is
 * stubbed per-file (file-level vi.mock wins over the setupFiles registration)
 * so `useUnits` derives a controllable km/mi boundary from real conversion
 * math.
 *
 * Hardening exercised by this suite:
 *   - the discriminator keys on the *presence* of `payload_version`, not the
 *     value `=== 'v2'`, so a v1-tagged SI payload is passed through instead of
 *     re-run through the km→m converters (which read absent km fields as
 *     undefined → NaN → '—').
 *   - the "no route data" fallback fires for `mapPoints.length <= 1` (a single
 *     point cannot draw the >1-point hero polyline), never leaving a blank
 *     map region with no explanation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { SharedDriveData, SharedDriveDataV1 } from '@/types/sharing'

/* ── Hoisted mutable state shared with the (hoisted) vi.mock factories ────── */
const h = vi.hoisted(() => ({
  query: {
    current: { data: undefined as unknown, isLoading: false, error: null as Error | null },
  },
  unit: { current: 'km' as 'km' | 'mi' },
  maps: {
    containerCenters: [] as unknown[],
    containerZooms: [] as number[],
    polylines: [] as Array<Array<[number, number]>>,
    markers: [] as Array<{ center: unknown; color: unknown }>,
    tileStyles: [] as string[],
  },
  charts: {
    areaData: [] as Array<Record<string, number>>,
    lineData: [] as Array<Record<string, number>>,
  },
}))

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

/* ── Controllable unit preference (defaults to km, matches global stub) ──── */
vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings')
  const base = {
    unit_of_temp: 'C' as const,
    unit_of_pressure: 'bar' as const,
    preferred_range: 'rated' as const,
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark' as const,
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon' as const,
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant' as const,
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle' as const,
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable' as const,
    time_format_default: 'relative' as const,
    chart_palette: 'cb_safe' as const,
    ai_mode: 'off' as const,
    ai_features: {},
    ai_provider_config: {},
  }
  return {
    ...actual,
    useSettings: () => ({
      settings: { ...base, unit_of_length: h.unit.current },
      isMiles: h.unit.current === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  }
})

/* ── Controllable public-share query ─────────────────────────────────────── */
vi.mock('@/api/hooks/useSharing', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useSharing')>('@/api/hooks/useSharing')
  return { ...actual, useSharedDrive: () => h.query.current }
})

/* ── Inert leaflet barrel — capture props, never touch canvas/leaflet ────── */
vi.mock('@/components/maps', () => ({
  MapContainer: ({
    center,
    zoom,
    children,
  }: {
    center: unknown
    zoom: number
    children?: ReactNode
  }) => {
    h.maps.containerCenters.push(center)
    h.maps.containerZooms.push(zoom)
    return <div data-testid="map-container">{children}</div>
  },
  Polyline: ({ positions }: { positions: Array<[number, number]> }) => {
    h.maps.polylines.push(positions)
    return <div data-testid="map-polyline" data-count={positions.length} />
  },
  CircleMarker: ({ center, pathOptions }: { center: unknown; pathOptions?: { color?: string } }) => {
    h.maps.markers.push({ center, color: pathOptions?.color })
    return <div data-testid="map-marker" data-color={pathOptions?.color} />
  },
  MapTileLayer: ({ style }: { style: string }) => {
    h.maps.tileStyles.push(style)
    return null
  },
}))

/* ── Inert recharts barrel — capture the derived chart data, render nothing ─ */
vi.mock('@/components/charts', () => ({
  ChartContainer: ({
    title,
    ariaLabel,
    children,
  }: {
    title?: string
    ariaLabel?: string
    children?: ReactNode
  }) => (
    <section aria-label={ariaLabel}>
      <h3>{title}</h3>
      {children}
    </section>
  ),
  ChartGradient: () => null,
  chartGrid: {},
  axisTick: {},
  AREA_DEFAULTS: {},
  AreaChart: ({ data }: { data: Array<Record<string, number>> }) => {
    h.charts.areaData = data
    return <div data-testid="area-chart" data-count={data.length} />
  },
  LineChart: ({ data }: { data: Array<Record<string, number>> }) => {
    h.charts.lineData = data
    return <div data-testid="line-chart" data-count={data.length} />
  },
  Area: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

/* ── Motion barrel → inert passthrough (avoid framer timing/act churn) ────── */
vi.mock('@/components/motion', async () => {
  const actual = await vi.importActual<typeof import('@/components/motion')>('@/components/motion')
  return { ...actual, FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</> }
})

import SharedDrivePage from './SharedDrivePage'

/* ── Fixtures ────────────────────────────────────────────────────────────── */
function makeV2(
  overrides: Partial<SharedDriveData> = {},
  driveOverrides: Partial<SharedDriveData['drive']> = {},
): SharedDriveData {
  return {
    payload_version: 'v2',
    title: 'Morning Commute',
    description: 'A scenic drive',
    drive: {
      date: '2025-03-01',
      distance_m: 5000,
      duration_s: 600,
      start_address: 'Seattle',
      end_address: 'Tacoma',
      start_battery: 80,
      end_battery: 65,
      elevation_gain: 120,
      elevation_loss: 90,
      max_speed_mps: 30,
      avg_speed_mps: 20,
      efficiency_wh_per_m: 0.15,
      ...driveOverrides,
    },
    vehicle: { model: 'Model 3', color: 'Midnight Silver' },
    map_points: [
      { lat: 47.6, lng: -122.3 },
      { lat: 47.5, lng: -122.2 },
      { lat: 47.4, lng: -122.1 },
    ],
    elevation_profile: [
      { distance_m: 0, elevation_m: 100 },
      { distance_m: 1000, elevation_m: 150 },
    ],
    speed_profile: [
      { distance_m: 0, speed_mps: 10 },
      { distance_m: 1000, speed_mps: 20 },
    ],
    telemetry: null,
    ...overrides,
  }
}

function makeLegacy(overrides: Partial<SharedDriveDataV1> = {}): SharedDriveDataV1 {
  return {
    title: 'Legacy Trip',
    description: 'Old format',
    drive: {
      date: '2024-06-15',
      distance_km: 5,
      duration_min: 10,
      start_address: 'Portland',
      end_address: 'Salem',
      start_battery: 90,
      end_battery: 70,
      elevation_gain: 120,
      elevation_loss: 60,
      max_speed_kmh: 108,
      avg_speed_kmh: 72,
      efficiency_wh_km: 150,
    },
    vehicle: { model: 'Model Y', color: 'Pearl White' },
    map_points: [
      { lat: 45.5, lng: -122.6 },
      { lat: 45.2, lng: -122.9 },
      { lat: 44.9, lng: -123.0 },
    ],
    elevation_profile: [
      { distance_km: 0, elevation_m: 50 },
      { distance_km: 1, elevation_m: 80 },
    ],
    speed_profile: [
      { distance_km: 0, speed_kmh: 36 },
      { distance_km: 1, speed_kmh: 72 },
    ],
    telemetry: null,
    ...overrides,
  }
}

function setData(
  data: SharedDriveData | SharedDriveDataV1 | undefined,
  opts: { isLoading?: boolean; error?: Error | null } = {},
) {
  h.query.current = {
    data,
    isLoading: opts.isLoading ?? false,
    error: opts.error ?? null,
  }
}

function renderPage(token = 'abc123') {
  return render(
    <MemoryRouter initialEntries={[`/s/${token}`]}>
      <Routes>
        <Route path="/s/:token" element={<SharedDrivePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.query.current = { data: undefined, isLoading: false, error: null }
  h.unit.current = 'km'
  h.maps.containerCenters = []
  h.maps.containerZooms = []
  h.maps.polylines = []
  h.maps.markers = []
  h.maps.tileStyles = []
  h.charts.areaData = []
  h.charts.lineData = []
})

/* ── Tests ───────────────────────────────────────────────────────────────── */
describe('SharedDrivePage — loading / error / empty branches', () => {
  it('renders only the loading spinner while the share is loading', () => {
    setData(undefined, { isLoading: true })
    renderPage()

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    // No page chrome or report content while the spinner owns the screen.
    expect(screen.queryByText('Shared Drive Report')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Morning Commute' })).toBeNull()
  })

  it('shows the expired/unavailable view when the query errors', () => {
    setData(undefined, { error: new Error('gone') })
    renderPage()

    expect(screen.getByRole('heading', { name: 'Share Link Unavailable' })).toBeInTheDocument()
    expect(
      screen.getByText('This shared drive link has expired or been revoked.'),
    ).toBeInTheDocument()
    const home = screen.getByRole('link', { name: 'Go to TeslaSync' })
    expect(home).toHaveAttribute('href', '/')
    // The success chrome is withheld.
    expect(screen.queryByText('Shared Drive Report')).toBeNull()
  })

  it('shows the expired view when there is no data (revoked token / empty response)', () => {
    setData(undefined) // not loading, no error, no data
    renderPage()

    expect(screen.getByRole('heading', { name: 'Share Link Unavailable' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
  })
})

describe('SharedDrivePage — rich v2 payload (metric)', () => {
  it('renders the branded header, title, description and route meta line', () => {
    setData(makeV2())
    renderPage()

    expect(screen.getByText('Shared Drive Report')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Morning Commute' })).toBeInTheDocument()
    expect(screen.getByText('A scenic drive')).toBeInTheDocument()
    expect(screen.getByText('2025-03-01')).toBeInTheDocument()
    expect(screen.getByText('Seattle → Tacoma')).toBeInTheDocument()
  })

  it('renders every stat card with SI→km/display-converted values', () => {
    setData(makeV2())
    renderPage()

    expect(screen.getByText('5.0 km')).toBeInTheDocument() // 5000 m
    expect(screen.getByText('10m')).toBeInTheDocument() // 600 s
    expect(screen.getByText('150 Wh/km')).toBeInTheDocument() // 0.15 Wh/m
    expect(screen.getByText('80% → 65%')).toBeInTheDocument()
    expect(screen.getByText('108 km/h')).toBeInTheDocument() // 30 m/s
    expect(screen.getByText('72 km/h')).toBeInTheDocument() // 20 m/s
    expect(screen.getByText('120 m')).toBeInTheDocument() // elevation gain
  })

  it('renders the vehicle badge with the model and colour', () => {
    setData(makeV2())
    renderPage()

    expect(screen.getByText('Tesla Model 3')).toBeInTheDocument()
    expect(screen.getByText('Midnight Silver')).toBeInTheDocument()
  })

  it('renders labelled elevation + speed chart regions with converted data', () => {
    setData(makeV2())
    renderPage()

    // Accessible chart regions (section[aria-label]) with headings.
    expect(screen.getByRole('heading', { name: 'Elevation Profile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Speed Profile' })).toBeInTheDocument()
    expect(
      screen.getByRole('region', {
        name: 'Shared drive elevation profile area chart by distance',
      }),
    ).toBeInTheDocument()

    // Elevation: distance km (1000 m → 1 km), elevation stays metres.
    expect(h.charts.areaData.map((p) => p.distance)).toEqual([0, 1])
    expect(h.charts.areaData.map((p) => p.elevation)).toEqual([100, 150])
    // Speed: 10/20 m/s → 36/72 km/h.
    expect(h.charts.lineData.map((p) => p.speed)).toEqual([36, 72])
  })

  it('renders the hero map with a polyline, start/end markers, and midpoint centre', () => {
    setData(makeV2())
    renderPage()

    expect(screen.getByTestId('map-container')).toBeInTheDocument()
    expect(screen.getByTestId('map-polyline')).toHaveAttribute('data-count', '3')
    // Start (green) + end (red) markers.
    expect(h.maps.markers.map((m) => m.color)).toEqual(
      expect.arrayContaining(['#22c55e', '#ef4444']),
    )
    // Centre is the middle map point; zoom + dark tiles are threaded through.
    expect(h.maps.containerCenters).toContainEqual([47.5, -122.2])
    expect(h.maps.containerZooms).toContain(7)
    expect(h.maps.tileStyles).toContain('dark')
  })

  it('renders the footer attribution and external learn-more link', () => {
    setData(makeV2())
    renderPage()

    expect(
      screen.getByText('Shared via TeslaSync — Self-hosted Tesla Fleet Intelligence'),
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Learn more →' })
    expect(link).toHaveAttribute('href', 'https://github.com/ev-dev-labs/teslasync')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('hides the description meta line when the description is empty', () => {
    setData(makeV2({ description: '' }))
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Morning Commute' })).toBeInTheDocument()
    expect(screen.queryByText('A scenic drive')).toBeNull()
  })
})

describe('SharedDrivePage — imperial boundary', () => {
  it('flips every value + unit label to imperial when the preference is miles', () => {
    h.unit.current = 'mi'
    setData(makeV2())
    renderPage()

    expect(screen.getByText('3.1 mi')).toBeInTheDocument() // 5000 m
    expect(screen.getByText('241 Wh/mi')).toBeInTheDocument() // 150 Wh/km * 1.609
    expect(screen.getByText('67 mph')).toBeInTheDocument() // 30 m/s max
    expect(screen.getByText('45 mph')).toBeInTheDocument() // 20 m/s avg
    expect(screen.getByText('394 ft')).toBeInTheDocument() // 120 m elevation gain
    // Elevation chart converts metres → feet for imperial viewers.
    expect(h.charts.areaData.map((p) => Math.round(p.elevation))).toEqual([328, 492])
  })
})

describe('SharedDrivePage — payload discriminator + legacy normalisation', () => {
  it('passes a v1-tagged SI payload through untouched (no NaN corruption)', () => {
    // Regression guard: the discriminator keys on the *presence* of
    // payload_version, not `=== 'v2'`. A v1-tagged SI payload must NOT be
    // re-run through the km→m converters (which would read absent km fields
    // as undefined → NaN → '—').
    setData(makeV2({ payload_version: 'v1' }))
    renderPage()

    expect(screen.getByText('5.0 km')).toBeInTheDocument()
    expect(screen.getByText('108 km/h')).toBeInTheDocument()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('normalises a legacy (unversioned) km/min/kmh payload into SI display values', () => {
    setData(makeLegacy())
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Legacy Trip' })).toBeInTheDocument()
    expect(screen.getByText('5.0 km')).toBeInTheDocument() // 5 km
    expect(screen.getByText('10m')).toBeInTheDocument() // 10 min
    expect(screen.getByText('150 Wh/km')).toBeInTheDocument() // efficiency_wh_km
    expect(screen.getByText('108 km/h')).toBeInTheDocument() // max_speed_kmh
    expect(screen.getByText('72 km/h')).toBeInTheDocument() // avg_speed_kmh
    expect(screen.getByText('Tesla Model Y')).toBeInTheDocument()
    // Profiles are re-based to SI then reconverted for display.
    expect(h.charts.areaData.map((p) => p.elevation)).toEqual([50, 80])
    expect(h.charts.lineData.map((p) => p.speed)).toEqual([36, 72])
  })
})

describe('SharedDrivePage — optional cards + empty states', () => {
  it('hides every optional stat card whose field is null, keeping distance + duration', () => {
    setData(
      makeV2(
        {},
        {
          start_battery: null,
          end_battery: null,
          efficiency_wh_per_m: null,
          max_speed_mps: null,
          avg_speed_mps: null,
          elevation_gain: null,
        },
      ),
    )
    renderPage()

    // Always-on cards remain.
    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('5.0 km')).toBeInTheDocument()
    expect(screen.getByText('Duration')).toBeInTheDocument()
    // Nullable cards are withheld (never rendered blank).
    expect(screen.queryByText('Battery')).toBeNull()
    expect(screen.queryByText('Efficiency')).toBeNull()
    expect(screen.queryByText('Max Speed')).toBeNull()
    expect(screen.queryByText('Avg Speed')).toBeNull()
    expect(screen.queryByText('Elevation Gain')).toBeNull()
  })

  it('shows the honest "no route data" empty state when all profiles are absent', () => {
    setData(makeV2({ map_points: null, elevation_profile: null, speed_profile: null }))
    renderPage()

    expect(
      screen.getByText('Route data is not available for this shared drive.'),
    ).toBeInTheDocument()
    // No hero map, no charts — but the stat cards still anchor the report.
    expect(screen.queryByTestId('map-container')).toBeNull()
    expect(screen.queryByTestId('area-chart')).toBeNull()
    expect(screen.queryByTestId('line-chart')).toBeNull()
    expect(screen.getByText('5.0 km')).toBeInTheDocument()
  })

  it('falls back to the empty state for a single map point that cannot draw a polyline', () => {
    // Hardening: a lone point can't render the >1-point hero polyline, so the
    // page must surface the empty state (mapPoints.length <= 1) instead of a
    // silent, blank map region.
    setData(
      makeV2({
        map_points: [{ lat: 47.6, lng: -122.3 }],
        elevation_profile: null,
        speed_profile: null,
      }),
    )
    renderPage()

    expect(
      screen.getByText('Route data is not available for this shared drive.'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('map-container')).toBeNull()
  })
})
