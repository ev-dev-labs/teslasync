/**
 * NavigationRoutePage — behaviour + hardening coverage.
 *
 * NavigationRoutePage default-exports a single page component that
 * orchestrates a KPI metrics band, a navigation-status hero, a row of
 * location-status cards, a speed-profile + presence chart bento, a
 * traffic-delay + waypoints + recent-destinations bento, and a full
 * location-history table. The file-local helpers/sub-components
 * (`headingToCardinal`, `buildWaypoints`, `LocationStatusCard`,
 * `TrafficDelayBadge`, `RouteField`, `PanelHeading`) are not exported, so
 * they are exercised transitively through the page render.
 *
 * What is covered:
 *   1. SHELL       — page-level loading (Spinner) / error (message) gate
 *                    everything; the empty "select a vehicle" state.
 *   2. READY       — metrics band derives SI→display values, the nav hero
 *                    shows the active route, every a11y region is labelled,
 *                    and the header actions render.
 *   3. CARDS       — the five location-status cards (current location, GPS
 *                    fix, heading, home, work) render their derived values.
 *   4. CHARTS/TABLES — the speed + presence charts receive the sorted
 *                    history, and the recent-destinations + location-history
 *                    tables render rows via the real column renderers.
 *   5. SORT        — sortable location-history headers toggle sortKey/dir
 *                    (handleSort) and actually reorder the rows.
 *   6. REFRESH     — the Refresh action refetches both the latest snapshot
 *                    and the history query.
 *   7. NO ROUTE    — an inactive snapshot blanks the route metrics, flips
 *                    the badge to "Inactive", and shows the empty states.
 *   8. NO GPS      — a zeroed location surfaces the GPS-unavailable banner
 *                    and the "Location unavailable" card value.
 *   9. EMPTY/ERR/LOADING — every history-bound section degrades to its own
 *                    EmptyState / QueryError / Skeleton, and Retry is wired
 *                    to refetch (both the history and latest queries).
 *  10. HEADING     — headingToCardinal maps degrees to a cardinal, wraps
 *                    negatives (the hardening), and falls back when unknown.
 *
 * Network is never hit: the data hooks, the direct `request()` history
 * fetch, the live-connection hook, the unit formatters, the chart
 * primitives, the vehicle picker, and the heavy DataTable are all stubbed.
 * i18n is stubbed so visible copy is the English fallback with
 * {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { LocationSnapshot } from '@/api/types';

// ── Hoisted, per-test controllable state ─────────────────────────────
// Every field is a knob a single test can flip; the mock factories below
// read straight from `h` so a test only mutates state, never re-mocks.
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  liveStatus: 'connected' as 'connected' | 'reconnecting' | 'disconnected' | 'unknown',
  vehiclesLoading: false,
  vehiclesError: null as Error | null,
  latest: null as LocationSnapshot | null,
  latestLoading: false,
  latestError: null as unknown,
  charging: null as { expected_energy_pct_at_arrival?: number | null } | null,
  history: [] as LocationSnapshot[],
  historyMode: 'resolve' as 'resolve' | 'reject' | 'pending',
  refetchLatest: vi.fn(),
  requestSpy: vi.fn(),
}));

// i18n → English-fallback resolver with {{placeholder}} interpolation.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

// Deterministic unit formatting: distance→km, speed→km/h, and a
// formatDuration that echoes the seconds it was handed so the page's
// wiring (which field feeds the badge/metric) stays assertable. The page
// still uses the REAL pure `convertSpeedFromSI`/`convertDistanceFromSI`
// (km == meters/1000, km/h == m/s * 3.6), so those derivations are exact.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
    formatDistance: (v: number | null | undefined) => `${v ?? 0} km`,
    formatSpeed: (v: number | null | undefined) => `${v ?? 0} km/h`,
    formatTemperature: (v: number | null | undefined) => `${v ?? 0} °C`,
    formatPressure: (v: number | null | undefined) => `${v ?? 0} bar`,
    formatEnergy: (v: number | null | undefined) => `${v ?? 0} kWh`,
    formatDuration: (v: number | null | undefined) => `${v ?? 0}s`,
    formatPower: (v: number | null | undefined) => `${v ?? 0} kW`,
  }),
}));

vi.mock('@/hooks/useLiveConnection', () => ({
  useLiveConnection: () => ({ status: h.liveStatus, lastMessageAt: null }),
}));

// The three data hooks the page reads are stubbed to synchronous, per-test
// controllable query-shaped objects (the latest one supplies the freshness
// fields PageContainer's DataFreshnessAuto reads).
vi.mock('@/api/hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: () => ({
      data: [],
      isLoading: h.vehiclesLoading,
      error: h.vehiclesError,
      isError: h.vehiclesError != null,
      refetch: vi.fn(),
    }),
    useLocationSnapshotLatest: () => ({
      data: h.latest,
      isLoading: h.latestLoading,
      error: h.latestError,
      isError: h.latestError != null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 1_700_000_000_000,
      refetch: h.refetchLatest,
    }),
    useChargingTelemetryLatest: () => ({
      data: h.charging,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    }),
  };
});

// The location-history list is fetched via a direct request() inside a real
// useQuery — so we mock the client, not the query, keeping the react-query
// loading/error/refetch machinery exercised end-to-end.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    request: (path: string, _options?: unknown) => {
      h.requestSpy(path);
      if (path.startsWith('/location-snapshots?')) {
        if (h.historyMode === 'reject') return Promise.reject(new Error('history boom'));
        if (h.historyMode === 'pending') return new Promise(() => {});
        return Promise.resolve(h.history);
      }
      return Promise.resolve(null);
    },
  };
});

// Chart primitives → markers. ResponsiveContainer passes children through
// (real recharts renders nothing at 0×0 in jsdom); AreaChart/LineChart echo
// the length of the data they received so the page's memoised derivations
// (sort + null-safety) are directly assertable without recharts.
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    AreaChart: ({ data }: { data?: unknown[] }) => (
      <div data-testid="area-chart" data-points={Array.isArray(data) ? data.length : 0} />
    ),
    LineChart: ({ data }: { data?: unknown[] }) => (
      <div data-testid="line-chart" data-points={Array.isArray(data) ? data.length : 0} />
    ),
  };
});

// DataTable → a lightweight table that still invokes the page's column
// renderers (so the cell logic under test runs) and exposes the current
// sort state + a per-column sort button when the column is sortable.
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  function DataTableStub<T>({
    data,
    columns,
    tableId,
    keyExtractor,
    sortKey,
    sortDir,
    onSort,
  }: {
    data: readonly T[];
    columns: ReadonlyArray<{
      key: string;
      header: ReactNode;
      sortable?: boolean;
      render?: (row: T) => ReactNode;
    }>;
    tableId?: string;
    keyExtractor: (row: T) => string | number;
    sortKey?: string;
    sortDir?: 'asc' | 'desc';
    onSort?: (key: string) => void;
  }) {
    return (
      <table data-testid={tableId} data-sort-key={sortKey ?? ''} data-sort-dir={sortDir ?? ''}>
        <thead>
          <tr>
            {columns.map((c) =>
              c.sortable && onSort ? (
                <th key={c.key}>
                  <button type="button" onClick={() => onSort(c.key)}>
                    {c.header}
                  </button>
                </th>
              ) : (
                <th key={c.key}>{c.header}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={keyExtractor(row)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(row) : null}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return { ...actual, DataTable: DataTableStub };
});

vi.mock('@/components/forms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/forms')>();
  return { ...actual, VehicleSelect: () => <div data-testid="vehicle-select" /> };
});

import NavigationRoutePage from './NavigationRoutePage';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via FadeIn and
// the Spinner's useMotionPreference). ResizeObserver/IntersectionObserver
// polyfills already live in test-setup.ts.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// SI snapshot: meters / m·s⁻¹ / seconds on the wire.
function baseLatest(): LocationSnapshot {
  return {
    id: 1,
    latitude: 37.5,
    longitude: -122.25,
    heading: 0,
    gps_state: 'GpsValid',
    speed_mph: 15,
    destination_name: 'Downtown Office',
    miles_to_arrival: 5000,
    minutes_to_arrival: 12,
    route_traffic_delay_s: 600,
    route_last_updated: '2024-05-01T10:00:00Z',
    located_at_home: false,
    located_at_work: true,
    homelink_nearby: false,
    created_at: '2024-05-01T10:00:00Z',
  };
}

// Three snapshots: SI speeds 10/20/30 m·s⁻¹ (avg 20 → 72 km/h), distinct
// coords + two named destinations for the recent-destinations dedupe.
function baseHistory(): LocationSnapshot[] {
  return [
    {
      id: 11,
      created_at: '2024-05-01T09:00:00Z',
      speed_mph: 10,
      miles_to_arrival: 9000,
      minutes_to_arrival: 20,
      latitude: 37.1,
      longitude: -122.1,
      destination_name: 'Supercharger LA',
      located_at_home: true,
      located_at_work: false,
    },
    {
      id: 12,
      created_at: '2024-05-01T09:30:00Z',
      speed_mph: 20,
      miles_to_arrival: 6000,
      minutes_to_arrival: 12,
      latitude: 37.2,
      longitude: -122.2,
      destination_name: 'Work HQ',
      located_at_home: false,
      located_at_work: true,
    },
    {
      id: 13,
      created_at: '2024-05-01T10:00:00Z',
      speed_mph: 30,
      miles_to_arrival: 3000,
      minutes_to_arrival: 6,
      latitude: 37.3,
      longitude: -122.3,
      located_at_home: false,
      located_at_work: false,
    },
  ];
}

function buildTree(qc: QueryClient) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/maps/navigation']}>
        <NavigationRoutePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { qc, ...render(buildTree(qc)) };
}

// Both the header action and the freshness chip expose the accessible name
// "Refresh"; the header button is the only one whose visible text is
// "Refresh" (the chip shows a relative timestamp).
function getHeaderRefresh(): HTMLElement {
  const match = screen
    .getAllByRole('button', { name: /^Refresh$/i })
    .find((b) => b.textContent?.trim() === 'Refresh');
  if (!match) throw new Error('header Refresh button not found');
  return match;
}

beforeEach(() => {
  h.vehicleId = 7;
  h.liveStatus = 'connected';
  h.vehiclesLoading = false;
  h.vehiclesError = null;
  h.latest = baseLatest();
  h.latestLoading = false;
  h.latestError = null;
  h.charging = { expected_energy_pct_at_arrival: 85 };
  h.history = baseHistory();
  h.historyMode = 'resolve';
  h.refetchLatest.mockReset();
  h.requestSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NavigationRoutePage — shell gating', () => {
  it('shows the page-level spinner and hides all content while vehicles load', () => {
    h.vehiclesLoading = true;
    h.historyMode = 'pending';

    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: /Navigation & Route/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /Loading/ })).toBeInTheDocument();
    // Body regions are gated out behind the spinner.
    expect(screen.queryByRole('region', { name: 'Route metrics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Navigation status' })).not.toBeInTheDocument();
  });

  it('renders the vehicles error message instead of the page body', () => {
    h.vehiclesError = new Error('vehicles down');
    h.historyMode = 'pending';

    renderPage();

    // ErrorDisplay renders production-safe structured copy rather than the
    // raw error.message — status-less errors fall into the network branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Route metrics' })).not.toBeInTheDocument();
  });

  it('prompts to select a vehicle and never fetches history when none is active', () => {
    h.vehicleId = null;

    renderPage();

    expect(
      screen.getByText('Select a vehicle to view navigation and route data.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Route metrics' })).not.toBeInTheDocument();
    // The history query is `enabled: vehicleId !== null` — so it stays idle.
    expect(h.requestSpy).not.toHaveBeenCalled();
  });
});

describe('NavigationRoutePage — ready state', () => {
  it('derives the KPI band, shows the active route, and labels every region', () => {
    h.historyMode = 'pending'; // focus on latest-driven, synchronous content

    renderPage();

    // KPI band: 5000 m → 5.0 km, 12 min, 600 s (echoed), 85 %.
    expect(screen.getAllByText('5.0 km').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('12 min').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/600s/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('85%')).toBeInTheDocument();

    // Navigation-status hero: active badge + destination.
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Navigation status' })).getByText('Downtown Office'),
    ).toBeInTheDocument();

    // Header actions.
    expect(getHeaderRefresh()).toBeInTheDocument();
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();

    // a11y: all six section landmarks are labelled regions.
    for (const name of [
      'Route metrics',
      'Navigation status',
      'Location status',
      'Route charts',
      'Route details',
      'Location history',
    ]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('renders the five location-status cards with derived values', () => {
    h.historyMode = 'pending';

    renderPage();

    // Current location (valid coords, 4 dp), GPS fix (GpsValid → locked),
    // heading 0 → "N (0°)", work present, home away.
    expect(screen.getByText('37.5000, -122.2500')).toBeInTheDocument();
    expect(screen.getByText('locked')).toBeInTheDocument();
    expect(screen.getByText('N (0°)')).toBeInTheDocument();
    expect(screen.getByText('At Work')).toBeInTheDocument();
    expect(screen.getByText('Away')).toBeInTheDocument();
  });

  it('feeds the sorted history to both charts and renders the data tables', async () => {
    renderPage();

    // Speed profile (Area) + presence (Line) each receive all 3 points.
    const area = await screen.findByTestId('area-chart');
    expect(area).toHaveAttribute('data-points', '3');
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '3');

    // Avg speed: (10+20+30)/3 = 20 m/s → 72.0 km/h.
    expect(screen.getByText('72.0 km/h')).toBeInTheDocument();

    // Recent-destinations table dedupes to the two named stops.
    const recent = screen.getByTestId('maps:navigation-recent-destinations');
    expect(within(recent).getByText('Supercharger LA')).toBeInTheDocument();
    expect(within(recent).getByText('Work HQ')).toBeInTheDocument();

    // Location-history table renders a row per snapshot with 6-dp coords.
    const history = screen.getByTestId('maps:navigation-location-history');
    expect(within(history).getByText('37.100000')).toBeInTheDocument();
    expect(within(history).getAllByText('Yes').length).toBeGreaterThanOrEqual(1);
  });

  it('toggles sort key/direction from sortable headers and reorders rows (handleSort)', async () => {
    renderPage();

    const latHeader = await screen.findByRole('button', { name: 'Lat' });
    expect(screen.getByTestId('maps:navigation-location-history')).toHaveAttribute(
      'data-sort-key',
      'time',
    );
    expect(screen.getByTestId('maps:navigation-location-history')).toHaveAttribute(
      'data-sort-dir',
      'desc',
    );

    // First click on a NEW key → ascending.
    fireEvent.click(latHeader);
    let table = screen.getByTestId('maps:navigation-location-history');
    expect(table).toHaveAttribute('data-sort-key', 'latitude');
    expect(table).toHaveAttribute('data-sort-dir', 'asc');
    // Ascending by latitude → 37.1 is the first data row.
    const rowsAsc = within(table).getAllByRole('row');
    expect(within(rowsAsc[1]).getByText('37.100000')).toBeInTheDocument();

    // Second click on the SAME key → toggles to descending.
    fireEvent.click(screen.getByRole('button', { name: 'Lat' }));
    table = screen.getByTestId('maps:navigation-location-history');
    expect(table).toHaveAttribute('data-sort-dir', 'desc');
    const rowsDesc = within(table).getAllByRole('row');
    expect(within(rowsDesc[1]).getByText('37.300000')).toBeInTheDocument();
  });

  it('refetches both the latest snapshot and the history on Refresh', async () => {
    renderPage();

    await waitFor(() => expect(h.requestSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(getHeaderRefresh());

    expect(h.refetchLatest).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.requestSpy).toHaveBeenCalledTimes(2));
  });
});

describe('NavigationRoutePage — degraded route/data states', () => {
  it('blanks the route metrics and shows empty states when no route is active', () => {
    h.latest = { ...baseLatest(), destination_name: undefined };
    h.charging = null;
    h.historyMode = 'pending';

    renderPage();

    expect(screen.getByText('Inactive')).toBeInTheDocument();
    // Distance + ETA + Traffic Delay + Energy metrics all fall back to em-dash.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/No active navigation/)).toBeInTheDocument();
    expect(screen.getByText('No active route selected')).toBeInTheDocument();
  });

  it('explains when an active route omits waypoint metadata', () => {
    h.latest = { ...baseLatest(), destination_name: '' };
    h.historyMode = 'pending';

    renderPage();

    expect(
      screen.getByText('The active route does not include waypoint details.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/vehicle navigation supplies waypoint metadata/)).toBeInTheDocument();
  });

  it('surfaces the GPS-unavailable banner and card when coordinates are zeroed', () => {
    h.latest = { ...baseLatest(), latitude: 0, longitude: 0 };
    h.historyMode = 'pending';

    renderPage();

    expect(screen.getByText(/GPS coordinates not available/)).toBeInTheDocument();
    expect(screen.getByText('Location unavailable')).toBeInTheDocument();
  });

  it('renders a per-section EmptyState for every history-bound panel when empty', async () => {
    h.history = [];

    renderPage();

    expect(
      await screen.findByText('No location history available for this vehicle.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No presence history available.')).toBeInTheDocument();
    expect(screen.getByText('No destination history available.')).toBeInTheDocument();
    expect(screen.getByText('No location snapshots recorded yet.')).toBeInTheDocument();
    // No moving speeds → avg speed collapses to 0.0 km/h (never NaN).
    expect(screen.getByText('0.0 km/h')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('shows QueryError in every history section and wires Retry to a refetch', async () => {
    h.historyMode = 'reject';

    renderPage();

    // Speed profile + presence + recent destinations + location history.
    const errors = await screen.findAllByText(/Can't reach server/i);
    expect(errors).toHaveLength(4);
    const retries = screen.getAllByRole('button', { name: /^Retry$/i });
    expect(retries).toHaveLength(4);

    await waitFor(() => expect(h.requestSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(retries[0]);
    await waitFor(() => expect(h.requestSpy).toHaveBeenCalledTimes(2));
  });

  it('shows skeletons (not charts) while the history request is in flight', () => {
    h.historyMode = 'pending';

    const { container } = renderPage();

    // Metrics/nav (from the latest snapshot) still render...
    expect(screen.getByText('Active')).toBeInTheDocument();
    // ...but the history-bound charts are skeletons, not resolved markers.
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(3);
  });

  it('surfaces QueryError in the latest-snapshot sections and wires its Retry', async () => {
    h.latest = null;
    h.latestError = new Error('latest boom');
    h.historyMode = 'pending';

    renderPage();

    // Nav hero + traffic-delay panel + waypoints panel each show the error.
    const errors = screen.getAllByText(/Can't reach server/i);
    expect(errors.length).toBeGreaterThanOrEqual(3);

    const retries = screen.getAllByRole('button', { name: /^Retry$/i });
    fireEvent.click(retries[0]);
    expect(h.refetchLatest).toHaveBeenCalledTimes(1);
  });
});

describe('NavigationRoutePage — heading cardinal (edge hardening)', () => {
  it('maps a heading to a cardinal, wraps negatives, and falls back when unknown', () => {
    h.latest = { ...baseLatest(), heading: -45 };
    h.historyMode = 'pending';

    const { rerender, qc } = renderPage();

    // -45° == 315° == NW (a bare `% 8` would strand this on an em-dash).
    expect(screen.getByText('NW (-45°)')).toBeInTheDocument();

    // 0° → due North.
    h.latest = { ...baseLatest(), heading: 0 };
    rerender(buildTree(qc));
    expect(screen.getByText('N (0°)')).toBeInTheDocument();

    // Missing heading → the "Unknown" fallback, card marked inactive.
    h.latest = { ...baseLatest(), heading: undefined };
    rerender(buildTree(qc));
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
