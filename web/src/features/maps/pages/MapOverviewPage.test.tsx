/**
 * MapOverviewPage — contract + hardening tests.
 *
 * The page is the "Map Overview" recorded-location dashboard. It fans one
 * TanStack Query hook (`useVehicles`) and three raw `request()` queries
 * (latest position, 50-point history, latest location snapshot) through the
 * real `useUnits` SI→display boundary into six surfaces: an observed-status KPI
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
 *      SI→mi unit boundary, the shareable map-layer switch, registered router
 *      quick links, and labelled landmark regions.
 *
 * Network is mocked at the `@/api/client` boundary (repo convention — see
 * TeslaChargingSessionsPage.test.tsx). `useTimezone` comes from the global stub
 * in src/test-setup.ts; the jsdom-hostile leaflet barrel (`@/components/maps`)
 * is replaced with inert stubs that capture the props the production component
 * would hand to leaflet so we can assert on them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

/* ── Hoisted mutable state shared with the (hoisted) vi.mock factories ─── */
const h = vi.hoisted(() => ({
  unit: { current: 'km' as 'km' | 'mi' },
  motion: { reduce: false },
  dates: { locale: 'en-US', timezone: 'UTC', mode: 'vehicle' as 'vehicle' | 'user' | 'utc' },
  maps: {
    polylines: [] as Array<Array<[number, number]>>,
    tileStyles: [] as string[],
    layerCurrents: [] as string[],
    playbackCounts: [] as number[],
    playbackLabels: [] as string[],
    trailColors: [] as string[],
  },
}))

vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone')
  return { ...actual, useTimezone: () => h.dates.timezone }
})

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: h.motion.reduce, durationMs: h.motion.reduce ? 0 : 250 }),
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
      settings: { ...base, unit_of_length: h.unit.current, locale: h.dates.locale, tz_display_default: h.dates.mode },
      isMiles: h.unit.current === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: h.dates.locale,
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  }
})

/* ── Inert leaflet barrel — capture props, never touch canvas/leaflet ──── */
vi.mock('@/components/maps', () => ({
  MapContainer: ({ children, center, zoomAnimation, fadeAnimation, markerZoomAnimation }: {
    children?: ReactNode; center?: [number, number]; zoomAnimation?: boolean; fadeAnimation?: boolean; markerZoomAnimation?: boolean
  }) => (
    <div data-testid="map-container" data-center={JSON.stringify(center)} data-zoom-animation={String(zoomAnimation)}
      data-fade-animation={String(fadeAnimation)} data-marker-animation={String(markerZoomAnimation)}>{children}</div>
  ),
  Marker: ({ children }: { children?: ReactNode }) => (
    <div data-testid="map-marker">{children}</div>
  ),
  Popup: ({ children }: { children?: ReactNode }) => <div data-testid="map-popup">{children}</div>,
  Polyline: ({ positions, color }: { positions: Array<[number, number]>; color: string }) => {
    h.maps.polylines.push(positions)
    h.maps.trailColors.push(color)
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
import { SelectedVehicleProvider, useSelectedVehicleStore } from '@/store/selectedVehicle'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'
import { formatDateTime } from '@/lib/dateFormat'
import { Button } from '@/components/ui'
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
  locationPending?: boolean
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
    locationPending = false,
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
      if (locationPending) return never()
      if (locationError) return Promise.reject(new Error('location boom'))
      return Promise.resolve(location)
    }
    return Promise.resolve([])
  })
}

function RouterEvidence() {
  const location = useLocation()
  const { setVehicleId } = useSelectedVehicleStore()
  return (
    <>
      <span data-testid="router-destination">{location.pathname}{location.search}</span>
      <Button onClick={() => setVehicleId(8)}>Select test vehicle B</Button>
    </>
  )
}

function renderPage(options: { client?: QueryClient; entry?: string } = {}) {
  const client = options.client ?? new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  })
  const result = render(
    <MemoryRouter initialEntries={[options.entry ?? '/live']}>
      <QueryClientProvider client={client}>
        <SelectedVehicleProvider>
          <RouterEvidence />
          <Routes>
            <Route path="/live" element={<MapOverviewPage />} />
            <Route path="/navigation" element={<span>Navigation destination</span>} />
            <Route path="/geofences" element={<span>Geofences destination</span>} />
            <Route path="/locations" element={<span>Locations destination</span>} />
          </Routes>
        </SelectedVehicleProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...result, client }
}

const latestCalls = () =>
  mockedRequest.mock.calls.filter((c) => String(c[0]).includes('/positions?limit=1')).length

beforeEach(() => {
  mockedRequest.mockReset()
  window.localStorage.clear()
  window.location.hash = ''
  h.unit.current = 'km'
  h.motion.reduce = false
  h.dates.locale = 'en-US'
  h.dates.timezone = 'UTC'
  h.dates.mode = 'vehicle'
  onlineManager.setOnline(true)
  h.maps.polylines.length = 0
  h.maps.tileStyles.length = 0
  h.maps.layerCurrents.length = 0
  h.maps.playbackCounts.length = 0
  h.maps.playbackLabels.length = 0
  h.maps.trailColors.length = 0
  // fmtNumber reads module-global precision/locale that useSettings seeds in
  // production; pin them so lat/lon/heading assertions are stable.
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
  install()
})

afterEach(() => onlineManager.setOnline(true))

/* ── Full render ──────────────────────────────────────────────────────── */

describe('MapOverviewPage — full render', () => {
  it('renders every surface once the fleet + position + location load (km)', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Map overview' }),
    ).toBeInTheDocument()

    // KPI band derives live status from the latest position (SI → km).
    expect(await screen.findByText('90.00 km/h')).toBeInTheDocument()
    expect(screen.getByText('Observed speed')).toBeInTheDocument()
    expect(screen.getByText('42.00°')).toBeInTheDocument()
    expect(screen.getByText('37.5000, -121.9000')).toBeInTheDocument()
    expect(screen.getByText('Last observed')).toBeInTheDocument()

    // Every section panel is present — nothing stubbed out.
    expect(screen.getByRole('heading', { name: 'Location details' })).toBeInTheDocument()
    expect(screen.getByText('Quick links')).toBeInTheDocument()
    expect(screen.getByText('Recent route playback')).toBeInTheDocument()
    expect(screen.getByText('Recent location history')).toBeInTheDocument()

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

    expect(await screen.findByText('At home')).toBeInTheDocument()
    expect(screen.getByText('At work')).toBeInTheDocument()
    expect(screen.getByText('HomeLink nearby')).toBeInTheDocument()
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

    expect(await screen.findByText('55.92 mph')).toBeInTheDocument()
    expect(screen.queryByText('90.00 km/h')).toBeNull()
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
    expect(screen.getByText(/appears after the selected vehicle reports valid GPS positions/)).toBeInTheDocument()

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
    expect(screen.queryByText('Observed speed')).toBeNull()
  })
})

/* ── Loading / failure hardening around the fleet gate ────────────────── */

describe('MapOverviewPage — fleet gate hardening', () => {
  it('shows a loading spinner (not the no-vehicle prompt) while /vehicles is in flight', async () => {
    install({ vehiclesPending: true })
    renderPage()

    expect(await screen.findByRole('status', { name: /Loading/ })).toBeInTheDocument()
    // Regression guard: the misleading empty-state prompt must NOT appear
    // just because the fleet hasn't resolved yet.
    expect(screen.queryByText('Set up TeslaSync')).toBeNull()
    expect(screen.queryByText('No vehicle selected')).toBeNull()
  })

  it('surfaces the fleet error (not the no-vehicle prompt) when /vehicles fails', async () => {
    install({ vehiclesError: true })
    renderPage()

    // ErrorDisplay renders production-safe structured copy rather than the
    // raw error.message — status-less errors fall into the network branch.
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument()
    expect(screen.queryByText('Set up TeslaSync')).toBeNull()
  })
})

/* ── Per-section query errors ─────────────────────────────────────────── */

describe('MapOverviewPage — per-section errors', () => {
  it('shows a retryable QueryError in the map hero when the latest position fails', async () => {
    install({ latestError: true })
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Map overview' })).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'Location details' })).toBeInTheDocument()
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()
  })

  it('shows errors in BOTH the playback and history panels when history fails', async () => {
    install({ historyError: true })
    renderPage()

    await screen.findByText('Recent route playback')
    // Two independent surfaces read the same history query.
    await waitFor(() => {
      expect(screen.getAllByText("Can't reach server").length).toBeGreaterThanOrEqual(2)
    })
    expect(screen.queryByTestId('route-playback')).toBeNull()
  })
})

/* ── Loading affordances for the position query ───────────────────────── */

describe('MapOverviewPage — position loading', () => {
  it('withholds KPI values behind skeletons while the latest position loads', async () => {
    install({ latestPending: true })
    const { container } = renderPage()

    // The page shell mounts (fleet resolved) …
    expect(await screen.findByRole('heading', { name: 'Location details' })).toBeInTheDocument()
    // … but the KPI band shows skeletons, not half-populated metrics.
    const band = screen.getByRole('region', { name: 'Vehicle status' })
    expect(within(band).getByText('Observed speed')).toBeInTheDocument()
    expect(band).toHaveAttribute('aria-busy', 'true')
    expect(band.querySelector('[data-operational-value]')).toBeNull()
    expect(screen.queryByText('90.00 km/h')).toBeNull()
    expect(container.querySelectorAll('[class*="--skeleton-bg"]').length).toBeGreaterThan(0)
  })
})

/* ── Interactions ─────────────────────────────────────────────────────── */

describe('MapOverviewPage — interactions', () => {
  it('opens retained position evidence without changing map layers or playback', async () => {
    renderPage()
    const band = await screen.findByRole('region', { name: 'Vehicle status' })
    await waitFor(() => expect(within(band).getByText('90.00 km/h')).toBeInTheDocument())
    fireEvent.click(within(band).getByRole('button', { name: 'Review details' }))
    const drawer = screen.getByRole('dialog', { name: 'Vehicle status details' })
    expect(within(drawer).getByText(/Polling every 15 s checks for positions/)).toBeInTheDocument()
    expect(within(drawer).getAllByText(/latest-50-position history request/).length).toBeGreaterThan(0)
    expect(screen.getByTestId('map-marker')).toBeInTheDocument()
    expect(screen.getByTestId('route-playback')).toBeInTheDocument()
  })
  it('mirrors the chosen map layer into the URL so the view is shareable', async () => {
    renderPage()

    const switcher = await screen.findByRole('button', { name: 'Change map layer' })
    expect(switcher).toHaveTextContent('layer:dark')

    fireEvent.click(switcher)

    // The tile layer re-renders with the new style pulled from the URL.
    await waitFor(() => expect(h.maps.tileStyles.at(-1)).toBe('satellite'))
    expect(await screen.findByText('layer:satellite')).toBeInTheDocument()
  })

  it.each([
    { label: 'Navigation route', path: '/navigation', destination: 'Navigation destination' },
    { label: 'Geofences', path: '/geofences', destination: 'Geofences destination' },
    { label: 'Locations', path: '/locations', destination: 'Locations destination' },
  ])('routes $label to its registered destination', async ({ label, path, destination }) => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: label }))
    expect(await screen.findByText(destination)).toBeInTheDocument()
    expect(screen.getByTestId('router-destination')).toHaveTextContent(path)
    expect(window.location.hash).toBe('')
  })
})

/* ── Accessibility ────────────────────────────────────────────────────── */

describe('MapOverviewPage — accessibility', () => {
  it('exposes labelled landmarks without a duplicate vehicle filter', async () => {
    renderPage()

    // The KPI band and the hero map are both labelled regions. findByRole
    // waits for the fleet + position queries to resolve past the loading shell.
    const status = await screen.findByRole('region', { name: 'Vehicle status' })
    expect(status).toBeInTheDocument()
    const map = screen.getByRole('region', { name: 'Recorded location map' })
    expect(await within(map).findByTestId('map-container')).toBeInTheDocument()

    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument()
  })
})

describe('MapOverviewPage modernization preservation', () => {
  it('does not infer an empty fleet or setup requirement from an initial paused read', async () => {
    onlineManager.setOnline(false)
    renderPage()
    await screen.findByText('Refresh paused')
    expect(screen.queryByText('Set up TeslaSync')).toBeNull()
    expect(screen.queryByText('No vehicle selected')).toBeNull()
    expect(screen.queryByText('No location history found.')).toBeNull()
    expect(screen.queryByText('Not enough GPS points to replay a route yet.')).toBeNull()
    expect(screen.queryByText("Can't reach server")).toBeNull()
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('keeps paused initial position, history and snapshot reads unresolved, not authoritatively empty', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['vehicles'], [makeVehicle()])
    onlineManager.setOnline(false)
    renderPage({ client })
    const band = await screen.findByRole('region', { name: 'Vehicle status' })
    expect(within(band).getByText('Loading source data')).toBeInTheDocument()
    expect(within(band).queryByText('Source data unavailable')).toBeNull()
    expect(screen.getAllByText('Refresh paused').length).toBeGreaterThan(0)
    expect(screen.queryByText('No location history found.')).toBeNull()
    expect(screen.queryByText('Not enough GPS points to replay a route yet.')).toBeNull()
    expect(screen.queryByText(/No GPS data available/)).toBeNull()
    expect(screen.getByText('Odometer')).toBeInTheDocument()
    for (const label of ['At home', 'At work', 'HomeLink nearby']) {
      const row = screen.getByText(label).parentElement!
      expect(within(row).getByText('Unknown')).toBeInTheDocument()
    }
  })

  it.each([
    { name: 'pending', locationPending: true, locationError: false },
    { name: 'failed', locationPending: false, locationError: true },
  ])('retains the independent position odometer while snapshot is $name', async (scenario) => {
    install({ ...scenario, latest: makeLatest({ odometer: 12345 }) })
    renderPage()
    const odometer = await screen.findByText('Odometer')
    await waitFor(() => expect(within(odometer.parentElement!).getByText('12.35 km')).toBeInTheDocument())
    for (const label of ['At home', 'At work', 'HomeLink nearby']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(await screen.findByTestId('map-marker')).toBeInTheDocument()
    if (scenario.locationError) expect(screen.getByText("Can't reach server")).toBeInTheDocument()
  })

  it('preserves a measured zero odometer instead of converting it to unknown', async () => {
    install({ locationError: true, latest: makeLatest({ odometer: 0 }) })
    renderPage()
    const odometer = await screen.findByText('Odometer')
    await waitFor(() => expect(within(odometer.parentElement!).getByText('0.00 km')).toBeInTheDocument())
  })

  it('remounts both camera and replay on a warmed equal-length vehicle switch, but not on a same-vehicle poll', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    const second = makeLatest({ vehicle_id: 8, latitude: 48.85, longitude: 2.35 })
    const secondHistory = defaultHistory.map((row, index) => ({
      ...row, vehicle_id: 8, latitude: 48.85 + index / 100, longitude: 2.35,
    }))
    client.setQueryData(['vehicles'], [makeVehicle(), makeVehicle({ id: 8, display_name: 'Vehicle B' })])
    client.setQueryData(['position-latest', '7'], makeLatest())
    client.setQueryData(['position-history', '7'], defaultHistory)
    client.setQueryData(['location-latest', '7'], makeLocation())
    client.setQueryData(['position-latest', '8'], second)
    client.setQueryData(['position-history', '8'], secondHistory)
    client.setQueryData(['location-latest', '8'], makeLocation({ vehicle_id: 8 }))
    renderPage({ client, entry: '/live?layer=terrain' })
    const originalMap = await screen.findByTestId('map-container')
    const originalPlayback = await screen.findByTestId('route-playback')
    fireEvent.click(screen.getByRole('button', { name: 'Select test vehicle B' }))
    await waitFor(() => expect(screen.getByTestId('map-container')).not.toBe(originalMap))
    const switchedMap = screen.getByTestId('map-container')
    const switchedPlayback = screen.getByTestId('route-playback')
    expect(switchedMap).toHaveAttribute('data-center', '[48.85,2.35]')
    expect(switchedPlayback).not.toBe(originalPlayback)
    expect(switchedPlayback).toHaveAttribute('data-count', '3')
    expect(h.maps.tileStyles.at(-1)).toBe('terrain')
    expect(h.maps.polylines.at(-1)).toEqual(secondHistory.map(row => [row.latitude, row.longitude]))
    client.setQueryData(['position-latest', '8'], { ...second, latitude: 48.86 })
    await waitFor(() => expect(switchedMap).toHaveAttribute('data-center', '[48.86,2.35]'))
    expect(screen.getByTestId('map-container')).toBe(switchedMap)
    expect(screen.getByTestId('route-playback')).toBe(switchedPlayback)
    expect(client.getQueryData(['position-history', '8'])).toEqual(secondHistory)
  })

  it('uses saved locale and timezone for the observation and mobile history, including preference changes', async () => {
    const timestamp = '2025-01-16T00:30:00Z'
    const latest = makeLatest({ created_at: timestamp })
    const history = [{ ...defaultHistory[0], created_at: timestamp }]
    h.dates.locale = 'fr-FR'
    h.dates.timezone = 'America/Los_Angeles'
    h.dates.mode = 'user'
    install({ latest, history })
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 375, height: 100, top: 0, left: 0, right: 375, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    })
    try {
      const { client } = renderPage()
      const band = await screen.findByRole('region', { name: 'Vehicle status' })
      const expected = formatDateTime(timestamp, { locale: h.dates.locale, tz: h.dates.timezone })
      await waitFor(() => expect(within(band).getByText(expected)).toBeInTheDocument())
      fireEvent.click((await screen.findAllByRole('button', { name: 'Quick view' }))[0])
      expect(within(screen.getByRole('dialog')).getByText(expected)).toBeInTheDocument()
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
      h.dates.locale = 'de-DE'
      h.dates.timezone = 'Asia/Tokyo'
      client.setQueryData(['position-latest', '7'], { ...latest })
      const updated = formatDateTime(timestamp, { locale: h.dates.locale, tz: h.dates.timezone })
      await waitFor(() => expect(within(band).getByText(updated)).toBeInTheDocument())
      fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[0])
      expect(within(screen.getByRole('dialog')).getByText(updated)).toBeInTheDocument()
      expect(client.getQueryData(['position-history', '7'])).toEqual(history)
      expect((client.getQueryData(['position-latest', '7']) as { created_at: string }).created_at).toBe(timestamp)
    } finally {
      bounds.mockRestore()
    }
  })

  it('labels an old successful observation as recorded evidence, never current/live', async () => {
    install({ latest: makeLatest({ created_at: '2000-01-01T00:00:00Z' }) })
    renderPage()
    expect(await screen.findByText('Observed speed')).toBeInTheDocument()
    expect(screen.getByText('Last observed')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recorded location map' })).toBeInTheDocument()
    expect(screen.getByText('Latest recorded vehicle position and recent history')).toBeInTheDocument()
    expect(screen.queryByText('Current speed')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Live location map' })).toBeNull()
  })

  it.each([
    { name: 'missing', value: undefined, expected: 'Unknown' },
    { name: 'null', value: null, expected: 'Unknown' },
    { name: 'measured false', value: false, expected: 'No' },
    { name: 'measured true', value: true, expected: 'Yes' },
  ])('preserves HomeLink tri-state for $name evidence', async ({ value, expected }) => {
    install({ location: makeLocation({ homelink_nearby: value }) })
    renderPage()
    const label = await screen.findByText('HomeLink nearby')
    expect(within(label.parentElement!).getByText(expected)).toBeInTheDocument()
    expect(screen.getByTestId('map-marker')).toBeInTheDocument()
  })

  it('labels durable GPS history as historical and resolved emptiness as unavailable', async () => {
    install({ latest: null, history: [] })
    renderPage()
    const band = await screen.findByRole('region', { name: 'Vehicle status' })
    await waitFor(() => expect(within(band).getByText('Source data unavailable')).toBeInTheDocument())
    fireEvent.click(within(band).getByRole('button', { name: 'Review details' }))
    const dialog = screen.getByRole('dialog', { name: 'Vehicle status details' })
    expect(within(dialog).getByText(/Recorded location map: historical/)).toBeInTheDocument()
    expect(screen.getByText('Recent route playback')).toBeInTheDocument()
    expect(screen.getByText('Recent location history')).toBeInTheDocument()
    expect(screen.getByText('HomeLink nearby')).toBeInTheDocument()
  })

  it('keeps genuine position and history after a latest-position refresh failure', async () => {
    const { client } = renderPage()
    await screen.findByTestId('map-marker')
    await screen.findByTestId('route-playback')
    install({ latestError: true })
    await client.refetchQueries({ queryKey: ['position-latest', '7'] })
    const band = screen.getByRole('region', { name: 'Vehicle status' })
    await waitFor(() => expect(within(band).getByText('Retained source data')).toBeInTheDocument())
    expect(screen.getByTestId('map-marker')).toBeInTheDocument()
    expect(screen.getByTestId('route-playback')).toHaveAttribute('data-count', '3')
    expect(within(band).getByText('37.5000, -121.9000')).toBeInTheDocument()
    expect(within(band).getByText('90.00 km/h')).toBeInTheDocument()
  })

  it.each([
    { name: 'normal', reduce: false, animation: 'true' },
    { name: 'reduced or low-bandwidth', reduce: true, animation: 'false' },
  ])('preserves map evidence with $name motion', async ({ reduce, animation }) => {
    h.motion.reduce = reduce
    renderPage()
    const map = await screen.findByTestId('map-container')
    await screen.findByTestId('route-playback')
    expect(map).toHaveAttribute('data-zoom-animation', animation)
    expect(map).toHaveAttribute('data-fade-animation', animation)
    expect(map).toHaveAttribute('data-marker-animation', animation)
    expect(h.maps.trailColors.at(-1)).toBe('var(--semantic-info)')
    expect(h.maps.polylines.at(-1)).toEqual(defaultHistory.map(row => [row.latitude, row.longitude]))
    expect(screen.getByTestId('route-playback')).toHaveAttribute('data-count', '3')
  })

  it('forwards cancellable signals to all three independent reads without aliasing limits', async () => {
    install({ latestPending: true, historyPending: true })
    const installed = mockedRequest.getMockImplementation()!
    mockedRequest.mockImplementation((path: string, options?: unknown) =>
      path.startsWith('/location-snapshots/latest') ? never() : installed(path, options))
    const { unmount } = renderPage()
    const paths = [
      '/vehicles/7/positions?limit=1',
      '/vehicles/7/positions?limit=50',
      '/location-snapshots/latest?vehicle_id=7',
    ]
    await waitFor(() => expect(paths.every(path =>
      mockedRequest.mock.calls.some(args => args[0] === path))).toBe(true))
    const signals = paths.map(path => {
      const call = mockedRequest.mock.calls.find(args => args[0] === path)
      expect(call).toBeDefined()
      const options = call?.[1] as { signal?: AbortSignal } | undefined
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      return options!.signal!
    })
    unmount()
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })

  it('keeps all five precise history fields reachable in narrow-container quick view', async () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 375, height: 100, top: 0, left: 0, right: 375, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    })
    try {
      renderPage()
      const quickViews = await screen.findAllByRole('button', { name: 'Quick view' })
      fireEvent.click(quickViews[0])
      const dialog = screen.getByRole('dialog')
      for (const label of ['Time', 'Lat', 'Lon', 'Speed', 'Heading']) {
        expect(within(dialog).getByText(label)).toBeInTheDocument()
      }
      expect(within(dialog).getByText('37.52000')).toBeInTheDocument()
      expect(within(dialog).getByText('-121.92000')).toBeInTheDocument()
      expect(within(dialog).getByText('64.80 km/h')).toBeInTheDocument()
      expect(within(dialog).getByText('80.00°')).toBeInTheDocument()
    } finally {
      bounds.mockRestore()
    }
  })
})
