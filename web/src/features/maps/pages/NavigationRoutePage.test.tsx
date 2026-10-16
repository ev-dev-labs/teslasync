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
 *   1. SHELL       — independent fleet loading/failure does not hide usable
 *                    navigation; the empty "select a vehicle" state.
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
 * Network is never hit: the data hooks, the page-owned history hook's request,
 * fetch, the live-connection hook, the unit formatters, the chart
 * primitives, shared vehicle context, and the heavy DataTable are all stubbed.
 * i18n is stubbed so visible copy is the English fallback with
 * {{placeholder}} interpolation applied.
 */

import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';
import type { LocationSnapshot } from '@/api/types';
import { formatDateTime } from '@/lib/dateFormat';

vi.unmock('@/lib/timezone');

// ── Hoisted, per-test controllable state ─────────────────────────────
// Every field is a knob a single test can flip; the mock factories below
// read straight from `h` so a test only mutates state, never re-mocks.
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  liveStatus: 'connected' as 'connected' | 'reconnecting' | 'disconnected' | 'unknown',
  vehiclesLoading: false,
  vehiclesResolved: true,
  vehiclesFetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  vehiclesError: null as Error | null,
  latest: null as LocationSnapshot | null,
  latestLoading: false,
  latestPending: false,
  latestFetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  latestError: null as unknown,
  charging: null as { expected_energy_pct_at_arrival?: number | null } | null,
  chargingError: null as Error | null,
  realChartFrames: false,
  history: [] as LocationSnapshot[],
  historyMode: 'resolve' as 'resolve' | 'reject' | 'pending',
  dateLocale: 'en-US',
  dateMode: 'vehicle' as 'vehicle' | 'user' | 'utc',
  userTimezone: 'UTC',
  refetchLatest: vi.fn(),
  refetchCharging: vi.fn(),
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

vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return {
    ...actual,
    useSettings: () => {
      const result = actual.useSettings();
      return {
        ...result,
        locale: h.dateLocale,
        settings: {
          ...result.settings,
          locale: h.dateLocale,
          tz_display_default: h.dateMode,
          timezone_user: h.userTimezone,
        },
      };
    },
  };
});

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
      data: h.vehiclesResolved ? [] : undefined,
      isLoading: h.vehiclesLoading,
      isPending: !h.vehiclesResolved && h.vehiclesError == null,
      isSuccess: h.vehiclesResolved && h.vehiclesError == null,
      fetchStatus: h.vehiclesFetchStatus,
      error: h.vehiclesError,
      isError: h.vehiclesError != null,
      refetch: vi.fn(),
    }),
    useLocationSnapshotLatest: () => ({
      data: h.latest,
      isLoading: h.latestLoading,
      isPending: h.latestPending || h.latestLoading,
      isSuccess: !h.latestPending && !h.latestLoading && h.latestError == null,
      fetchStatus: h.latestFetchStatus,
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
      error: h.chargingError,
      isError: h.chargingError != null,
      refetch: h.refetchCharging,
    }),
  };
});

// The location-history hook uses a real useQuery — mock the client, not
// the query, keeping the react-query
// loading/error/refetch machinery exercised end-to-end.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    request: (path: string, options?: RequestInit) => {
      if (path.startsWith('/location-snapshots?')) {
        h.requestSpy(path, options);
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
    EmbeddedChart: (props: ComponentProps<typeof actual.EmbeddedChart>) => h.realChartFrames
      ? <actual.EmbeddedChart {...props} />
      : <chartTestDoubles.EmbeddedChart {...props}>
        {typeof props.children === 'function'
          ? props.children({ annotations: [], hidden: false, hiddenSeries: null })
          : props.children}
      </chartTestDoubles.EmbeddedChart>,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    AreaChart: ({ data }: { data?: unknown[] }) => (
      <div data-testid="area-chart" data-points={Array.isArray(data) ? data.length : 0} data-values={JSON.stringify(data)} />
    ),
    LineChart: ({ data }: { data?: unknown[] }) => (
      <div data-testid="line-chart" data-points={Array.isArray(data) ? data.length : 0} data-values={JSON.stringify(data)} />
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
    mobilePresentation,
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
    mobilePresentation?: {
      roles: Readonly<Record<string, string>>;
      displayValue: (row: T, key: string) => string | number | null | undefined;
    };
  }) {
    return (
      <table data-testid={tableId} data-sort-key={sortKey ?? ''} data-sort-dir={sortDir ?? ''}
        data-mobile-fields={mobilePresentation ? JSON.stringify(Object.keys(mobilePresentation.roles)) : undefined}
        data-mobile-values={mobilePresentation ? JSON.stringify(data.map((row) =>
          Object.fromEntries(Object.keys(mobilePresentation.roles).map((key) => [key, mobilePresentation.displayValue(row, key)])))) : undefined}>
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

/** Scope the page command, keeping it distinct from the source-refresh dot. */
function getHeaderRefresh(): HTMLElement {
  const commands = document.querySelector<HTMLElement>('[data-role="page-header"] [data-action-group="secondary"]');
  if (!commands) throw new Error('Page refresh command group not found');
  return within(commands).getByRole('button', { name: /^Refresh$/i });
}

beforeEach(() => {
  h.vehicleId = 7;
  h.liveStatus = 'connected';
  h.vehiclesLoading = false;
  h.vehiclesResolved = true;
  h.vehiclesFetchStatus = 'idle';
  h.vehiclesError = null;
  h.latest = baseLatest();
  h.latestLoading = false;
  h.latestPending = false;
  h.latestFetchStatus = 'idle';
  h.latestError = null;
  h.charging = { expected_energy_pct_at_arrival: 85 };
  h.chargingError = null;
  h.realChartFrames = false;
  h.history = baseHistory();
  h.historyMode = 'resolve';
  h.dateLocale = 'en-US';
  h.dateMode = 'vehicle';
  h.userTimezone = 'UTC';
  onlineManager.setOnline(true);
  h.refetchLatest.mockReset();
  h.refetchCharging.mockReset();
  h.requestSpy.mockReset();
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.clearAllMocks();
});

describe('NavigationRoutePage — independent source posture', () => {
  it('preserves the latest-200 request, key and inherited retry/stale policy without range bounds', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: 2, retryDelay: 0, staleTime: 60_000 } },
    });
    h.historyMode = 'reject';
    const view = render(buildTree(qc));
    await waitFor(() => expect(h.requestSpy).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(qc.getQueryState(['location-history', 7])?.status).toBe('error'));
    const query = qc.getQueryCache().find({ queryKey: ['location-history', 7], exact: true });
    expect(query?.options).toMatchObject({ retry: 2, staleTime: 60_000 });
    expect(h.requestSpy).toHaveBeenCalledWith(
      '/location-snapshots?vehicle_id=7&limit=200',
      { signal: expect.any(AbortSignal) },
    );

    h.historyMode = 'resolve';
    fireEvent.click(getHeaderRefresh());
    await screen.findByTestId('maps:navigation-location-history');
    expect(qc.getQueryData(['location-history', 7])).toBe(h.history);
    const calls = h.requestSpy.mock.calls.length;
    view.unmount();
    render(buildTree(qc));
    expect(screen.getByTestId('maps:navigation-location-history')).toBeInTheDocument();
    expect(h.requestSpy).toHaveBeenCalledTimes(calls);
  });

  it('cancels the old vehicle request and keys the next request by the selected vehicle', async () => {
    h.historyMode = 'pending';
    const { qc, rerender, unmount } = renderPage();
    await waitFor(() => expect(h.requestSpy).toHaveBeenCalledTimes(1));
    const firstOptions = h.requestSpy.mock.calls[0][1] as RequestInit;
    expect(firstOptions.signal?.aborted).toBe(false);
    expect(qc.getQueryState(['location-history', 7])?.fetchStatus).toBe('fetching');

    h.vehicleId = 8;
    rerender(buildTree(qc));
    await waitFor(() => expect(h.requestSpy).toHaveBeenCalledTimes(2));
    expect(firstOptions.signal?.aborted).toBe(true);
    expect(h.requestSpy).toHaveBeenLastCalledWith(
      '/location-snapshots?vehicle_id=8&limit=200',
      { signal: expect.any(AbortSignal) },
    );
    const nextOptions = h.requestSpy.mock.calls[1][1] as RequestInit;
    unmount();
    expect(nextOptions.signal?.aborted).toBe(true);
  });

  it('retains history charts, rows and measured zero through refresh failure and recovers on Refresh', async () => {
    h.history = [{ ...baseHistory()[0], speed_mph: 0, destination_name: 'Retained destination' }];
    const { qc } = renderPage();
    await screen.findByTestId('maps:navigation-location-history');
    const retained = qc.getQueryData(['location-history', 7]);
    h.historyMode = 'reject';
    fireEvent.click(getHeaderRefresh());
    await waitFor(() => expect(qc.getQueryState(['location-history', 7])?.status).toBe('error'));
    await screen.findByText('Retained source data');
    expect(qc.getQueryData(['location-history', 7])).toBe(retained);
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-points', '1');
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '1');
    expect(within(screen.getByTestId('maps:navigation-location-history')).getByText('Retained destination')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Route metrics' })).getByText('0.00 km/h')).toBeInTheDocument();
    expect(screen.queryByText('No location snapshots recorded yet.')).not.toBeInTheDocument();

    h.historyMode = 'resolve';
    h.history = [{ ...baseHistory()[0], destination_name: 'Recovered destination' }];
    fireEvent.click(getHeaderRefresh());
    await waitFor(() => expect(qc.getQueryState(['location-history', 7])?.status).toBe('success'));
    await waitFor(() => expect(within(screen.getByTestId('maps:navigation-location-history')).getByText('Recovered destination')).toBeInTheDocument());
    expect(screen.queryByText('Retained source data')).not.toBeInTheDocument();
    expect(qc.getQueryState(['location-history', 7])?.error).toBeNull();
  });

  it('preserves unknown measurement gaps and false/zero facts without changing history order or complete tables', async () => {
    h.latest = { ...baseLatest(), miles_to_arrival: undefined, minutes_to_arrival: undefined, route_traffic_delay_s: undefined };
    h.history = [
      { ...baseHistory()[0], speed_mph: undefined, miles_to_arrival: undefined, minutes_to_arrival: undefined, located_at_home: undefined, located_at_work: undefined, homelink_nearby: undefined },
      { ...baseHistory()[1], speed_mph: 0, miles_to_arrival: 0, minutes_to_arrival: 0, located_at_home: false, located_at_work: true, homelink_nearby: false },
    ];
    renderPage();
    await waitFor(() => expect(screen.getByTestId('area-chart')).toHaveAttribute('data-points', '2'));
    const speedRows = JSON.parse(screen.getByTestId('area-chart').getAttribute('data-values')!) as { speed: number | null; miles: number | null }[];
    expect(speedRows.map(({ speed, miles }) => ({ speed, miles }))).toEqual([
      { speed: null, miles: null }, { speed: 0, miles: 0 },
    ]);
    const presence = JSON.parse(screen.getByTestId('line-chart').getAttribute('data-values')!) as { home: number | null; work: number | null; homelink: number | null }[];
    expect(presence.map(({ home, work, homelink }) => ({ home, work, homelink }))).toEqual([
      { home: null, work: null, homelink: null }, { home: 0, work: 1, homelink: 0 },
    ]);
    const nav = screen.getByRole('region', { name: 'Navigation status' });
    expect(within(nav).getByText('Unknown')).toBeInTheDocument();
    expect(within(nav).queryByText('0s delay')).not.toBeInTheDocument();
    const destinations = screen.getByTestId('maps:navigation-recent-destinations');
    expect(within(destinations).getAllByText('—')).toHaveLength(2);
    expect(within(destinations).getByText('0.00 km')).toBeInTheDocument();
    expect(within(destinations).getByText('0.00 min')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Route metrics' })).getByText('0.00 km/h')).toBeInTheDocument();
    expect(within(screen.getByTestId('maps:navigation-location-history')).getAllByRole('row')).toHaveLength(3);
  });

  it('shows unknown average speed when history has no measured speed and retains known zero route metrics', async () => {
    h.latest = { ...baseLatest(), miles_to_arrival: 0, minutes_to_arrival: 0, route_traffic_delay_s: 0 };
    h.history = [{ ...baseHistory()[0], speed_mph: undefined }];
    renderPage();
    await waitFor(() => expect(screen.getByTestId('area-chart')).toHaveAttribute('data-points', '1'));
    const metrics = screen.getByRole('region', { name: 'Route metrics' });
    expect(within(metrics).getByText('0.00 km')).toBeInTheDocument();
    expect(within(metrics).getByText('0.00 min')).toBeInTheDocument();
    expect(within(metrics).getByText('0s')).toBeInTheDocument();
    expect(within(metrics).queryByText('0.00 km/h')).not.toBeInTheDocument();
    expect(within(metrics).getByText('—')).toBeInTheDocument();
  });
  it('keeps the active route while the fleet and history are loading', () => {
    h.vehiclesLoading = true;
    h.historyMode = 'pending';

    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: /Navigation & route/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Route metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Navigation status' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Navigation status' })).getByText('Downtown Office')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('keeps usable navigation visible when the independent fleet source fails', () => {
    h.vehiclesError = new Error('vehicles down');
    h.historyMode = 'pending';

    renderPage();

    expect(screen.getByRole('region', { name: 'Route metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Navigation status' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Navigation status' })).getByText('Downtown Office')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('keeps a retained route and arrival telemetry during a latest-source refresh failure', () => {
    h.latestError = new Error('latest refresh failed');
    h.historyMode = 'pending';
    renderPage();

    expect(within(screen.getByRole('region', { name: 'Navigation status' })).getByText('Downtown Office')).toBeInTheDocument();
    expect(screen.getByText('85.00%')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Route metrics' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
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
  it('opens real mixed-source details while retaining route navigation and history controls', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('72.00 km/h')).toBeInTheDocument());
    const band = screen.getByRole('region', { name: 'Route metrics' });
    fireEvent.click(within(band).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Route metrics details' });
    expect(within(drawer).getByText('Expected arrival percentage comes from independent charging telemetry, not a calculation from the route history.')).toBeInTheDocument();
    expect(within(drawer).getByText('85.00%')).toBeInTheDocument();
    expect(screen.getByTestId('maps:navigation-location-history')).toBeInTheDocument();
    expect(getHeaderRefresh()).toBeInTheDocument();
  });
  it('derives the KPI band, shows the active route, and labels every region', () => {
    h.historyMode = 'pending'; // focus on latest-driven, synchronous content

    renderPage();

    // KPI band: 5000 m → 5.0 km, 12 min, 600 s (echoed), 85 %.
    expect(screen.getAllByText('5.00 km').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('12.00 min').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/600s/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('85.00%')).toBeInTheDocument();

    // Navigation-status hero: active badge + destination.
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Navigation status' })).getByText('Downtown Office'),
    ).toBeInTheDocument();

    // Header actions.
    expect(getHeaderRefresh()).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();

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
    expect(screen.getByText('At work')).toBeInTheDocument();
    expect(screen.getByText('Away')).toBeInTheDocument();
  });

  it('feeds the sorted history to both charts and renders the data tables', async () => {
    renderPage();

    // Speed profile (Area) + presence (Line) each receive all 3 points.
    const area = await screen.findByTestId('area-chart');
    expect(area).toHaveAttribute('data-points', '3');
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '3');

    // Avg speed: (10+20+30)/3 = 20 m/s → 72.0 km/h.
    expect(screen.getByText('72.00 km/h')).toBeInTheDocument();

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

  it('keeps history timestamps readable in the monospace caption role and original newest-first order', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-05-01T10:00:00Z'));
    try {
      renderPage();

      const history = await screen.findByTestId('maps:navigation-location-history');
      const timeCells = within(history).getAllByRole('row').slice(1).map((row) =>
        within(row).getAllByRole('cell')[0],
      );
      const expectedTimes = ['just now', '30m ago', '1h ago'];
      expect(timeCells.map((cell) => cell.querySelector('.whitespace-nowrap')?.textContent)).toEqual(expectedTimes);
      timeCells.forEach((cell, index) => {
        expect(cell.firstElementChild).toHaveClass('font-mono', 'text-xs', 'text-[var(--text-muted)]');
        expect(cell.firstElementChild).not.toHaveAttribute('mono');
        expect(within(cell).getByText(expectedTimes[index])).toHaveClass('whitespace-nowrap');
      });
    } finally {
      now.mockRestore();
    }
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
    expect(screen.getAllByText('No active route selected')).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: 'Route details' })).queryByText(/600s/)).not.toBeInTheDocument();
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
    // An empty history has no measured average, not a measured stationary speed.
    const metrics = within(screen.getByRole('region', { name: 'Route metrics' }));
    const average = metrics.getByText('Avg speed').closest('[data-operational-metric]');
    expect(average?.querySelector('[data-operational-value]')).toHaveTextContent('—');
    expect(metrics.queryByText('0.00 km/h')).not.toBeInTheDocument();
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
    expect(container.querySelectorAll('[class*="--skeleton-bg"]').length).toBeGreaterThanOrEqual(3);
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

describe('NavigationRoutePage — original trust, dates, zero coordinates and delay', () => {
  it('keeps every initial paused history panel unresolved and resumes into the real rows', async () => {
    onlineManager.setOnline(false);
    const { qc } = renderPage();
    await waitFor(() => expect(qc.getQueryState(['location-history', 7])?.fetchStatus).toBe('paused'));

    const charts = screen.getByRole('region', { name: 'Route charts' });
    const details = screen.getByRole('region', { name: 'Route details' });
    const history = screen.getByRole('region', { name: 'Location history' });
    expect(within(charts).getAllByRole('status', { name: 'Location history' })).toHaveLength(2);
    expect(within(details).getByRole('status', { name: 'Location history' })).toHaveTextContent('Refresh paused');
    expect(within(history).getByRole('status', { name: 'Location history' })).toHaveTextContent('Refresh paused');
    for (const message of [
      'No location history available for this vehicle.',
      'No presence history available.',
      'No destination history available.',
      'No location snapshots recorded yet.',
    ]) {
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    }
    expect(within(screen.getByRole('region', { name: 'Navigation status' })).getByText('Downtown Office')).toBeInTheDocument();
    expect(screen.getByText('85.00%')).toBeInTheDocument();
    expect(h.requestSpy).not.toHaveBeenCalled();

    onlineManager.setOnline(true);
    await screen.findByTestId('maps:navigation-location-history');
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-points', '3');
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '3');
    expect(h.requestSpy).toHaveBeenCalledTimes(1);
  });

  it.each(['idle', 'fetching', 'paused'] as const)(
    'does not infer inactive navigation from an initial %s latest query',
    (fetchStatus) => {
      h.latest = null;
      h.latestPending = true;
      h.latestFetchStatus = fetchStatus;
      h.historyMode = 'pending';
      renderPage();
      const nav = screen.getByRole('region', { name: 'Navigation status' });
      const details = screen.getByRole('region', { name: 'Route details' });
      expect(within(nav).getByRole('status', { name: 'Navigation' })).toBeInTheDocument();
      expect(within(details).getAllByRole('status', { name: 'Navigation' })).toHaveLength(2);
      expect(within(nav).queryByText('Inactive')).not.toBeInTheDocument();
      expect(screen.queryByText('No active route selected')).not.toBeInTheDocument();
      expect(screen.queryByText(/No active navigation/)).not.toBeInTheDocument();
      expect(screen.getByText('85.00%')).toBeInTheDocument();
      if (fetchStatus === 'paused') {
        expect(within(nav).getByRole('status', { name: 'Navigation' })).toHaveTextContent('Refresh paused');
        expect(within(nav).getByText('Unknown')).toBeInTheDocument();
      }
    },
  );

  it.each(['idle', 'fetching', 'paused'] as const)(
    'does not ask for vehicle selection before the initial %s fleet prerequisite resolves',
    (fetchStatus) => {
      h.vehicleId = null;
      h.vehiclesResolved = false;
      h.vehiclesFetchStatus = fetchStatus;
      const { rerender, qc } = renderPage();
      expect(screen.getByRole('status', { name: 'Vehicle' })).toBeInTheDocument();
      expect(screen.queryByText('Select a vehicle to view navigation and route data.')).not.toBeInTheDocument();
      expect(h.requestSpy).not.toHaveBeenCalled();

      h.vehiclesResolved = true;
      h.vehiclesFetchStatus = 'idle';
      rerender(buildTree(qc));
      expect(screen.getByText('Select a vehicle to view navigation and route data.')).toBeInTheDocument();
      expect(h.requestSpy).not.toHaveBeenCalled();
    },
  );

  it('preserves fleet failure recovery instead of presenting a selection prerequisite', () => {
    h.vehicleId = null;
    h.vehiclesResolved = false;
    h.vehiclesError = new Error('fleet unavailable');
    renderPage();
    expect(screen.getByText(/Can't reach server/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Retry$/ })).toBeInTheDocument();
    expect(screen.queryByText('Select a vehicle to view navigation and route data.')).not.toBeInTheDocument();
    expect(h.requestSpy).not.toHaveBeenCalled();
  });

  it('keeps retained history and the measured route delay visible while refresh is paused', async () => {
    h.latestFetchStatus = 'paused';
    const { qc } = renderPage();
    await screen.findByTestId('maps:navigation-location-history');
    onlineManager.setOnline(false);
    void qc.refetchQueries({ queryKey: ['location-history', 7] });
    await waitFor(() => expect(qc.getQueryState(['location-history', 7])?.fetchStatus).toBe('paused'));
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-points', '3');
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '3');
    expect(screen.getByTestId('maps:navigation-recent-destinations')).toBeInTheDocument();
    expect(screen.getByTestId('maps:navigation-location-history')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Route details' })).getByText('600s delay')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Navigation status' })).getByText('Downtown Office')).toBeInTheDocument();
  });

  it('reactively applies effective saved locale and timezone to chart, recent, hero and mobile timestamps without changing source rows', async () => {
    h.dateMode = 'utc';
    const { qc, rerender } = renderPage();
    await screen.findByTestId('maps:navigation-location-history');
    const rawHistory = h.history;
    const assertTimes = (locale: string, tz: string) => {
      const expected = (instant: string) => formatDateTime(instant, { locale, tz });
      const area = JSON.parse(screen.getByTestId('area-chart').getAttribute('data-values')!) as { time: string; speed: number }[];
      const presence = JSON.parse(screen.getByTestId('line-chart').getAttribute('data-values')!) as { time: string }[];
      const recent = screen.getByTestId('maps:navigation-recent-destinations');
      const recentMobile = JSON.parse(recent.getAttribute('data-mobile-values')!) as { time: string }[];
      const historyMobile = JSON.parse(screen.getByTestId('maps:navigation-location-history').getAttribute('data-mobile-values')!) as { time: string }[];
      expect(area.map((row) => row.time)).toEqual(rawHistory.map((row) => expected(row.created_at)));
      expect(presence.map((row) => row.time)).toEqual(area.map((row) => row.time));
      expect(area.map((row) => row.speed)).toEqual([36, 72, 108]);
      expect(recentMobile.map((row) => row.time)).toEqual(rawHistory.slice(0, 2).map((row) => expected(row.created_at)));
      expect(historyMobile.map((row) => row.time)).toEqual([...rawHistory].reverse().map((row) => expected(row.created_at)));
      expect(within(recent).getByText(expected(rawHistory[0].created_at))).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Navigation status' })).getByText(expected(baseLatest().route_last_updated!))).toBeInTheDocument();
    };
    assertTimes('en-US', 'UTC');
    const originalTimes = screen.getByTestId('area-chart').getAttribute('data-values');
    const requestCount = h.requestSpy.mock.calls.length;
    h.dateMode = 'user';
    h.userTimezone = 'America/Los_Angeles';
    h.dateLocale = 'de-DE';
    rerender(buildTree(qc));
    assertTimes('de-DE', 'America/Los_Angeles');
    expect(screen.getByTestId('area-chart').getAttribute('data-values')).not.toBe(originalTimes);
    expect(h.history).toBe(rawHistory);
    expect(h.requestSpy).toHaveBeenCalledTimes(requestCount);
  });

  it.each([
    { latitude: 0, longitude: 12, lat: '0.000000', lon: '12.000000', current: '0.0000, 12.0000' },
    { latitude: -12, longitude: 0, lat: '-12.000000', lon: '0.000000', current: '-12.0000, 0.0000' },
  ])('preserves measured zero coordinates at $current in current, desktop and mobile history', async ({ latitude, longitude, lat, lon, current }) => {
    h.latest = { ...baseLatest(), latitude, longitude };
    h.history = [
      { ...baseHistory()[0], latitude, longitude },
      { ...baseHistory()[1], latitude: undefined, longitude: undefined },
    ];
    renderPage();
    const table = await screen.findByTestId('maps:navigation-location-history');
    expect(screen.getByText(current)).toBeInTheDocument();
    expect(screen.queryByText(/GPS coordinates not available/)).not.toBeInTheDocument();
    expect(within(table).getByText(lat)).toBeInTheDocument();
    expect(within(table).getByText(lon)).toBeInTheDocument();
    const mobile = JSON.parse(table.getAttribute('data-mobile-values')!) as { latitude: string; longitude: string }[];
    expect(mobile).toMatchObject([
      { latitude: '—', longitude: '—' },
      { latitude: lat, longitude: lon },
    ]);
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

  describe('NavigationRoutePage — modernization preservation', () => {
    it('keeps time, coordinates and work available through the existing mobile table contract', async () => {
      renderPage();
      const history = await screen.findByTestId('maps:navigation-location-history');
      expect(JSON.parse(history.getAttribute('data-mobile-fields')!)).toEqual([
        'destination_name', 'time', 'latitude', 'longitude', 'located_at_home', 'located_at_work',
      ]);
      const values = JSON.parse(history.getAttribute('data-mobile-values')!) as Record<string, string>[];
      expect(values[0]).toMatchObject({
        latitude: '37.300000', longitude: '-122.300000', located_at_home: 'No', located_at_work: 'No',
      });
      const destinations = screen.getByTestId('maps:navigation-recent-destinations');
      expect(JSON.parse(destinations.getAttribute('data-mobile-fields')!)).toEqual(['destination', 'distance', 'eta', 'time']);
      const recent = JSON.parse(destinations.getAttribute('data-mobile-values')!) as Record<string, string>[];
      expect(recent[0].time).toBeTruthy();
      expect(recent[0]).toMatchObject({ destination: 'Supercharger LA', distance: '9.00 km', eta: '20.00 min' });
    });

    it('renders real chart alternatives with every speed, distance and presence gap', async () => {
      h.realChartFrames = true;
      h.history = [
        { ...baseHistory()[0], speed_mph: undefined, miles_to_arrival: undefined, located_at_home: undefined },
        { ...baseHistory()[1], speed_mph: 0, miles_to_arrival: 0, homelink_nearby: false },
      ];
      renderPage();
      const speed = await screen.findByRole('table', { name: 'Speed & distance history — data table' });
      expect(within(speed).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
        'Time', 'Speed (km/h)', 'Distance to arrival (km)',
      ]);
      expect(within(speed).getAllByRole('row')).toHaveLength(3);
      expect(within(speed).getAllByText('—')).toHaveLength(2);
      expect(within(speed).getByText('0.00 km/h')).toBeInTheDocument();
      expect(within(speed).getByText('0.00 km')).toBeInTheDocument();
      const presence = screen.getByRole('table', { name: 'Home / work presence — data table' });
      expect(within(presence).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
        'Time', 'At home', 'At work', 'HomeLink',
      ]);
      expect(within(presence).getAllByRole('row')).toHaveLength(3);
      expect(within(presence).getAllByText('—')).toHaveLength(2);
      expect(within(presence).getAllByText('No')).toHaveLength(3);
      expect(within(presence).getByText('Yes')).toBeInTheDocument();
    });

    it.each([
      { case: 'missing snapshot', loading: false, error: null, label: 'Unknown' },
      { case: 'pending snapshot', loading: true, error: null, label: 'Loading...' },
      { case: 'failed snapshot', loading: false, error: new Error('latest failed'), label: 'Error' },
    ])('does not label $case as an observed inactive route', ({ loading, error, label }) => {
      h.latest = null;
      h.latestLoading = loading;
      h.latestError = error;
      h.historyMode = 'pending';
      renderPage();
      const nav = screen.getByRole('region', { name: 'Navigation status' });
      expect(within(nav).getByText(label)).toBeInTheDocument();
      expect(within(nav).queryByText('Inactive')).not.toBeInTheDocument();
      expect(within(nav).queryByText(/No active navigation/)).not.toBeInTheDocument();
      expect(screen.getByText('85.00%')).toBeInTheDocument();
    });

    it('refreshes independent arrival energy and offers its own failed-source recovery without erasing navigation', async () => {
      h.charging = null;
      h.chargingError = new Error('arrival unavailable');
      renderPage();
      await waitFor(() => expect(h.requestSpy).toHaveBeenCalledTimes(1));
      const brief = screen.getByRole('region', { name: 'Route metrics' });
      fireEvent.click(within(brief).getByRole('button', { name: 'Retry' }));
      expect(h.refetchCharging).toHaveBeenCalledTimes(1);
      expect(h.refetchLatest).not.toHaveBeenCalled();
      expect(h.requestSpy).toHaveBeenCalledTimes(1);
      expect(within(screen.getByRole('region', { name: 'Navigation status' })).getByText('Downtown Office')).toBeInTheDocument();
      fireEvent.click(getHeaderRefresh());
      expect(h.refetchCharging).toHaveBeenCalledTimes(2);
      expect(h.refetchLatest).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(h.requestSpy).toHaveBeenCalledTimes(2));
    });

    it('reports empty independent history and arrival evidence as incomplete rather than available', async () => {
      h.history = [];
      h.charging = null;
      renderPage();
      await screen.findByText('No location snapshots recorded yet.');
      const brief = screen.getByRole('region', { name: 'Route metrics' });
      assertOperationalBriefDisclosure(brief, 'Independent sources incomplete');
      assertOperationalBriefDisclosure(brief, 'Source data available', { absent: true });
      expect(within(brief).getByText('5.00 km')).toBeInTheDocument();
    });

    it.each([
      { case: 'measured zero', seconds: 0, tone: 'success' },
      { case: 'below warning', seconds: 299, tone: 'success' },
      { case: 'warning boundary', seconds: 300, tone: 'warning' },
      { case: 'last warning', seconds: 900, tone: 'warning' },
      { case: 'danger boundary', seconds: 901, tone: 'danger' },
    ])('keeps $case traffic duration and badge on the same existing semantic role', ({ seconds, tone }) => {
      h.latest = { ...baseLatest(), route_traffic_delay_s: seconds };
      h.historyMode = 'pending';
      renderPage();
      const details = screen.getByRole('region', { name: 'Route details' });
      expect(within(details).getByText(`${seconds}s`)).toHaveClass(`text-[var(--semantic-${tone})]`);
      expect(within(details).getByText(`${seconds}s delay`)).toHaveClass(`text-[var(--semantic-${tone})]`);
    });
  });
});
