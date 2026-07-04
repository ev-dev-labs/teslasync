/**
 * MapOverviewPage — contract + hardening tests.
 *
 * The page is the "Map Overview" live-location dashboard. It fans one
 * TanStack Query hook (`useVehicles`) and three raw `request()` queries
 * (latest position, 50-point history, latest location snapshot) through the
 * real `useUnits` SI→display boundary into six surfaces: a live-status KPI
 * band, a hero leaflet map, a location-details rail, a quick-links rail, a
 * recent-route playback panel, and a recent-history table.
 *
 * Two layers are exercised:
 *
 *   1. The no-vehicle guard hardening this change adds — the guard now only
 *      fires once the fleet has genuinely loaded and is empty, so a slow or
 *      failed `/vehicles` request shows a spinner / error banner instead of a
 *      misleading "set up TeslaSync" prompt.
 *
 *   2. The page end-to-end against a mocked `request()` — full render, the
 *      no-GPS warning branch, honest per-section empty states, the three
 *      independent query error branches (map / location / history) with their
 *      Retry affordances, the latest-position loading skeletons, the SI→km and
 *      SI→mi unit boundary, the shareable map-layer switch, the hash-router
 *      quick links, and labelled landmark regions.
 *
 * Network is mocked at the `@/api/client` boundary (repo convention — see
 * TeslaChargingSessionsPage.test.tsx). `useTimezone` comes from the global stub
 * in src/test-setup.ts; the jsdom-hostile leaflet barrel (`@/components/maps`)
 * is replaced with inert stubs that capture the props the production component
 * would hand to leaflet so we can assert on them.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

/* ── Hoisted mutable state shared with the (hoisted) vi.mock factories ─── */
const h = vi.hoisted(() => ({
  unit: { current: 'km' as 'km' | 'mi' },
  maps: {
    polylines: [] as Array<Array<[number, number]>>,
    tileStyles: [] as string[],
    layerCurrents: [] as string[],
    playbackCounts: [] as number[],
    playbackLabels: [] as string[],
  },
}))

/* ── Network boundary ─────────────────────────────────────────────────── */
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

/* ── react-i18next: deterministic English-fallback rendering ──────────── */
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

/* ── Controllable unit preference (defaults to km, matches global stub) ── */
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

/* ── Inert leaflet barrel — capture props, never touch canvas/leaflet ──── */
vi.mock('@/components/maps', () => ({
  MapContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  Marker: ({ children }: { children?: ReactNode }) => (
    <div data-testid="map-marker">{children}</div>
  ),
  Popup: ({ children }: { children?: ReactNode }) => <div data-testid="map-popup">{children}</div>,
  Polyline: ({ positions }: { positions: Array<[number, number]> }) => {
    h.maps.polylines.push(positions)
    return <div data-testid="map-polyline" data-count={positions.length} />
  },
  MapTileLayer: ({ style }: { style: string }) => {
    h.maps.tileStyles.push(style)
    return null
  },
  MapInvalidator: () => null,
  MapLayerSwitcher: ({
    current,
    onChange,
  }: {
    current: string
    onChange: (s: string) => void
  }) => {
    h.maps.layerCurrents.push(current)
    return (
      <button type="button" aria-label="Change map layer" onClick={() => onChange('satellite')}>
        layer:{current}
      </button>
    )
  },
  RoutePlayback: ({ points, ariaLabel }: { points: unknown[]; ariaLabel?: string }) => {
    h.maps.playbackCounts.push(points.length)
    h.maps.playbackLabels.push(ariaLabel ?? '')
    return (
      <div data-testid="route-playback" data-count={points.length} aria-label={ariaLabel}>
        playback:{points.length}
      </div>
    )
  },
  vehicleIcon: () => ({}),
}))

import { request } from '@/api/client'
import { SelectedVehicleProvider } from '@/store/selectedVehicle'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'
import MapOverviewPage from './MapOverviewPage'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>
const never = () => new Promise<never>(() => {})

/* ── Fixtures ─────────────────────────────────────────────────────────── */

function makeVehicle(overrides: Record<string, unknown> = {}) {
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
  }
}

function makeLatest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-latest',
    vehicle_id: 7,
    latitude: 37.5,
    longitude: -121.9,
    speed: 25, // SI m/s → 90.0 km/h / 55.9 mph
    power: null,
    heading: 42, // distinct from every history heading (80/85/90)
    elevation: null,
    odometer: null,
    battery_level: null,
    created_at: '2025-01-15T12:05:00Z',
    ...overrides,
  }
}

// Newest-first, as the /positions endpoint returns.
const defaultHistory = [
  { id: 'p3', vehicle_id: 7, latitude: 37.52, longitude: -121.92, speed: 18, heading: 80, created_at: '2025-01-15T12:02:00Z' },
  { id: 'p2', vehicle_id: 7, latitude: 37.51, longitude: -121.91, speed: 19, heading: 85, created_at: '2025-01-15T12:01:00Z' },
  { id: 'p1', vehicle_id: 7, latitude: 37.5, longitude: -121.9, speed: 20, heading: 90, created_at: '2025-01-15T12:00:00Z' },
]

function makeLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    vehicle_id: 7,
    located_at_home: true,
    located_at_work: false,
    homelink_nearby: true,
    active_route: false,
    destination_name: '',
    created_at: '2025-01-15T12:05:00Z',
    ...overrides,
  }
}

interface InstallOpts {
  vehicles?: Array<Record<string, unknown>>
  latest?: Record<string, unknown> | null
  history?: Array<Record<string, unknown>>
  location?: Record<string, unknown>
  vehiclesPending?: boolean
  vehiclesError?: boolean
  latestPending?: boolean
  latestError?: boolean
  historyPending?: boolean
  historyError?: boolean
  locationError?: boolean
}

function install(opts: InstallOpts = {}) {
  const {
    vehicles = [makeVehicle()],
    latest = makeLatest(),
    history = defaultHistory,
    location = makeLocation(),
    vehiclesPending = false,
    vehiclesError = false,
    latestPending = false,
    latestError = false,
    historyPending = false,
    historyError = false,
    locationError = false,
  } = opts

  mockedRequest.mockImplementation((path: string) => {
    if (path === '/vehicles') {
      if (vehiclesPending) return never()
      if (vehiclesError) return Promise.reject(new Error('vehicles boom'))
      return Promise.resolve(vehicles)
    }
    if (path.includes('/positions?limit=1')) {
      if (latestPending) return never()
      if (latestError) return Promise.reject(new Error('latest boom'))
      return Promise.resolve(latest == null ? [] : [latest])
    }
    if (path.includes('/positions?limit=50')) {
      if (historyPending) return never()
      if (historyError) return Promise.reject(new Error('history boom'))
      return Promise.resolve(history)
    }
    if (path.startsWith('/location-snapshots/latest')) {
      if (locationError) return Promise.reject(new Error('location boom'))
      return Promise.resolve(location)
    }
    return Promise.resolve([])
  })
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <MemoryRouter initialEntries={['/maps']}>
      <QueryClientProvider client={client}>
        <SelectedVehicleProvider>
          <MapOverviewPage />
        </SelectedVehicleProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const latestCalls = () =>
  mockedRequest.mock.calls.filter((c) => String(c[0]).includes('/positions?limit=1')).length

beforeEach(() => {
  mockedRequest.mockReset()
  window.localStorage.clear()
  window.location.hash = ''
  h.unit.current = 'km'
  h.maps.polylines.length = 0
  h.maps.tileStyles.length = 0
  h.maps.layerCurrents.length = 0
  h.maps.playbackCounts.length = 0
  h.maps.playbackLabels.length = 0
  // fmtNumber reads module-global precision/locale that useSettings seeds in
  // production; pin them so lat/lon/heading assertions are stable.
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
  install()
})

/* ── Full render ──────────────────────────────────────────────────────── */

describe('MapOverviewPage — full render', () => {
  it('renders every surface once the fleet + position + location load (km)', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Map Overview' }),
    ).toBeInTheDocument()

    // KPI band derives live status from the latest position (SI → km).
    expect(await screen.findByText('90.0 km/h')).toBeInTheDocument()
    expect(screen.getByText('Current Speed')).toBeInTheDocument()
    expect(screen.getByText('42°')).toBeInTheDocument()
    expect(screen.getByText('37.5000, -121.9000')).toBeInTheDocument()
    expect(screen.getByText('Last Updated')).toBeInTheDocument()

    // Every section panel is present — nothing stubbed out.
    expect(screen.getByText('Location Details')).toBeInTheDocument()
    expect(screen.getByText('Quick Links')).toBeInTheDocument()
    expect(screen.getByText('Recent Route Playback')).toBeInTheDocument()
    expect(screen.getByText('Recent Location History')).toBeInTheDocument()

    // The hero map rendered with the vehicle marker + popup name (scoped to the
    // popup so it doesn't collide with the vehicle-picker <option>).
    const popup = screen.getByTestId('map-popup')
    expect(within(popup).getByText('Model 3 Test')).toBeInTheDocument()
    expect(screen.getByTestId('map-container')).toBeInTheDocument()

    // The 3-point trail reaches the (stubbed) polyline.
    expect(h.maps.polylines.at(-1)).toHaveLength(3)

    // Route playback receives all 3 points, time-ordered ascending.
    const playback = await screen.findByTestId('route-playback')
    expect(playback).toHaveAttribute('data-count', '3')
  })

  it('renders location-details tri-state badges and a null odometer as an em dash', async () => {
    renderPage()

    expect(await screen.findByText('At Home')).toBeInTheDocument()
    expect(screen.getByText('At Work')).toBeInTheDocument()
    expect(screen.getByText('HomeLink Nearby')).toBeInTheDocument()
    expect(screen.getByText('Odometer')).toBeInTheDocument()

    // located_at_home=true → Yes, located_at_work=false → No.
    expect(screen.getAllByText('Yes').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('No').length).toBeGreaterThanOrEqual(1)
    // odometer is null → em dash placeholder (never a fabricated 0).
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('flips the whole conversion boundary to miles when the preference is mi', async () => {
    h.unit.current = 'mi'
    renderPage()

    expect(await screen.findByText('55.9 mph')).toBeInTheDocument()
    expect(screen.queryByText('90.0 km/h')).toBeNull()
  })
})

/* ── GPS-missing branch ───────────────────────────────────────────────── */

describe('MapOverviewPage — no GPS fix', () => {
  it('warns and folds the map to an empty state when the fix is 0,0', async () => {
    install({ latest: makeLatest({ latitude: 0, longitude: 0, speed: null, heading: null }) })
    renderPage()

    expect(
      await screen.findByText(/GPS coordinates not available/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No GPS data available\. Location data requires Fleet Telemetry streaming/),
    ).toBeInTheDocument()

    // KPI lat/lon collapses to an em dash rather than showing "0, 0".
    expect(screen.queryByText(/0\.0000, 0\.0000/)).toBeNull()
    // No marker/popup when there is no valid fix.
    expect(screen.queryByTestId('map-container')).toBeNull()
  })
})

/* ── Empty states ─────────────────────────────────────────────────────── */

describe('MapOverviewPage — empty data', () => {
  it('shows honest per-section empty states when history is empty', async () => {
    install({ history: [] })
    renderPage()

    expect(
      await screen.findByText('Not enough GPS points to replay a route yet.'),
    ).toBeInTheDocument()
    expect(screen.getByText('No location history found.')).toBeInTheDocument()

    // No trail polyline and no playback widget with too few points.
    expect(screen.queryByTestId('route-playback')).toBeNull()
    expect(h.maps.polylines).toHaveLength(0)
  })

  it('renders NoVehicleSelected once the fleet has loaded and is genuinely empty', async () => {
    install({ vehicles: [] })
    renderPage()

    expect(await screen.findByText('No vehicle selected')).toBeInTheDocument()
    expect(screen.getByText('Set up TeslaSync')).toBeInTheDocument()
    // The data scaffolding never mounts without a vehicle.
    expect(screen.queryByText('Current Speed')).toBeNull()
  })
})

/* ── Loading / failure hardening around the fleet gate ────────────────── */

describe('MapOverviewPage — fleet gate hardening', () => {
  it('shows a loading spinner (not the no-vehicle prompt) while /vehicles is in flight', async () => {
    install({ vehiclesPending: true })
    renderPage()

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    // Regression guard: the misleading empty-state prompt must NOT appear
    // just because the fleet hasn't resolved yet.
    expect(screen.queryByText('Set up TeslaSync')).toBeNull()
    expect(screen.queryByText('No vehicle selected')).toBeNull()
  })

  it('surfaces the fleet error (not the no-vehicle prompt) when /vehicles fails', async () => {
    install({ vehiclesError: true })
    renderPage()

    expect(await screen.findByText('vehicles boom')).toBeInTheDocument()
    expect(screen.queryByText('Set up TeslaSync')).toBeNull()
  })
})

/* ── Per-section query errors ─────────────────────────────────────────── */

describe('MapOverviewPage — per-section errors', () => {
  it('shows a retryable QueryError in the map hero when the latest position fails', async () => {
    install({ latestError: true })
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Map Overview' })).toBeInTheDocument()
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument()

    const before = latestCalls()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(latestCalls()).toBeGreaterThan(before))
  })

  it('isolates a location-snapshot failure to the Location Details rail', async () => {
    install({ locationError: true })
    renderPage()

    // Map hero still renders (latest is fine) …
    expect(await screen.findByTestId('map-container')).toBeInTheDocument()
    // … while the location rail shows its own error, not a blank panel.
    expect(screen.getByText('Location Details')).toBeInTheDocument()
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()
  })

  it('shows errors in BOTH the playback and history panels when history fails', async () => {
    install({ historyError: true })
    renderPage()

    await screen.findByText('Recent Route Playback')
    // Two independent surfaces read the same history query.
    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByTestId('route-playback')).toBeNull()
  })
})

/* ── Loading affordances for the position query ───────────────────────── */

describe('MapOverviewPage — position loading', () => {
  it('withholds KPI values behind skeletons while the latest position loads', async () => {
    install({ latestPending: true })
    const { container } = renderPage()

    // The page shell mounts (fleet resolved) …
    expect(await screen.findByText('Location Details')).toBeInTheDocument()
    // … but the KPI band shows skeletons, not half-populated metrics.
    expect(screen.queryByText('Current Speed')).toBeNull()
    expect(screen.queryByText('90.0 km/h')).toBeNull()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })
})

/* ── Interactions ─────────────────────────────────────────────────────── */

describe('MapOverviewPage — interactions', () => {
  it('mirrors the chosen map layer into the URL so the view is shareable', async () => {
    renderPage()

    const switcher = await screen.findByRole('button', { name: 'Change map layer' })
    expect(switcher).toHaveTextContent('layer:dark')

    fireEvent.click(switcher)

    // The tile layer re-renders with the new style pulled from the URL.
    await waitFor(() => expect(h.maps.tileStyles.at(-1)).toBe('satellite'))
    expect(await screen.findByText('layer:satellite')).toBeInTheDocument()
  })

  it('routes the quick links through the hash router', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Navigation Route' }))
    expect(window.location.hash).toBe('#/maps/navigation-route')

    fireEvent.click(screen.getByRole('button', { name: 'Geofences' }))
    expect(window.location.hash).toBe('#/maps/geofences')

    fireEvent.click(screen.getByRole('button', { name: 'Locations' }))
    expect(window.location.hash).toBe('#/maps/locations')
  })
})

/* ── Accessibility ────────────────────────────────────────────────────── */

describe('MapOverviewPage — accessibility', () => {
  it('exposes labelled landmark regions and an accessible vehicle filter', async () => {
    renderPage()

    // The KPI band and the hero map are both labelled regions. findByRole
    // waits for the fleet + position queries to resolve past the loading shell.
    const status = await screen.findByRole('region', { name: 'Vehicle status' })
    expect(status).toBeInTheDocument()
    const map = screen.getByRole('region', { name: 'Live location map' })
    expect(within(map).getByTestId('map-container')).toBeInTheDocument()

    // The vehicle scope picker is a labelled combobox.
    expect(screen.getByRole('combobox', { name: 'Select vehicle' })).toBeInTheDocument()
  })
})
