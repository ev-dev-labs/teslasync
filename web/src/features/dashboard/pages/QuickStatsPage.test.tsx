/**
 * QuickStatsPage — orchestration, conversion + branch coverage.
 *
 * QuickStatsPage is the fleet-snapshot page. Its own behaviour (the surface
 * under test) is:
 *
 *   1. Fleet KPI band — loading / error / empty / data branches, plus the
 *      SI-boundary conversions it owns (analytics emits kilometres + Wh/km;
 *      the page converts to the user's distance unit and multiplies kWh→Wh
 *      before formatting). The km path is identity; the mi path exercises the
 *      real `convertDistanceFromSI` + the page's Wh/km→Wh/mi factor.
 *   2. Vehicle spotlight — loading / error / empty / hero branches and the
 *      exact props handed to <VehicleHeroCard>.
 *   3. <FleetComparisonPanel> prop wiring (entries / loading / error / onRetry).
 *   4. Workspace-owned selection — no competing local picker; selection
 *      changes scope the spotlight without re-scoping the fleet KPI rollup.
 *   5. Toolbar refresh → refetches analytics + state + vehicles.
 *   6. Quick-link navigation.
 *   7. Null-safe analytics extraction (a partial payload must not throw).
 *
 * Strategy (mirrors web/src/features/admin/pages/VehicleCostPage.test.tsx):
 *   - Every data hook + the vehicle selector + useUnits / useFormatting are
 *     mocked with hoisted vi.fn()s so the network is never touched and each
 *     render is deterministic. The page keeps using the REAL number
 *     formatters + REAL convertDistanceFromSI, so conversions are genuinely
 *     exercised.
 *   - react-i18next resolves the developer fallback string.
 *   - The two heavy children are stubbed to capture the exact props the page
 *     computed, so orchestration assertions stay crisp.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * page tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { getWorkspaceRouteScope } from '@/lib/workspaceScope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (<FadeIn>) + PageContainer's freshness
// chip read it at module load for the reduced-motion preference.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// Shared, hoisted test doubles so the mock factories below and the specs can
// both reach them.
const {
  analyticsMock,
  vehiclesMock,
  vehicleStateMock,
  selectedVehicleMock,
  useUnitsMock,
  useFormattingMock,
  navigateMock,
  captured,
  heroIntegration,
} = vi.hoisted(() => ({
  analyticsMock: vi.fn(),
  vehiclesMock: vi.fn(),
  vehicleStateMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  useUnitsMock: vi.fn(),
  useFormattingMock: vi.fn(),
  navigateMock: vi.fn(),
  captured: {} as Record<string, Record<string, unknown>>,
  heroIntegration: { enabled: false },
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/api/hooks/useAnalytics', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useAnalytics')>(
    '@/api/hooks/useAnalytics',
  );
  return { ...actual, useAnalyticsSummary: (...args: unknown[]) => analyticsMock(...args) };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>(
    '@/api/hooks/useVehicles',
  );
  return {
    ...actual,
    useVehicles: (...args: unknown[]) => vehiclesMock(...args),
    useVehicleState: (...args: unknown[]) => vehicleStateMock(...args),
  };
});

vi.mock('@/hooks/useSelectedVehicle', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSelectedVehicle')>(
    '@/hooks/useSelectedVehicle',
  );
  return { ...actual, useSelectedVehicle: () => selectedVehicleMock() };
});

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => useUnitsMock() }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => useFormattingMock() }));

// Stub the two heavy children; capture the exact props the page computed.
vi.mock('@/components/vehicles', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const { VehicleHeroCard } = await vi.importActual<typeof import('@/components/vehicles/VehicleHeroCard')>(
    '@/components/vehicles/VehicleHeroCard',
  );
  return {
    VehicleHeroCard: (props: import('@/components/vehicles/VehicleHeroCard').VehicleHeroCardProps) => {
      captured.hero = { ...props };
      if (heroIntegration.enabled) return React.createElement(VehicleHeroCard, props);
      return React.createElement('div', { 'data-testid': 'vehicle-hero' });
    },
  };
});

vi.mock('@/features/dashboard/components/FleetComparisonPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    FleetComparisonPanel: (props: Record<string, unknown>) => {
      captured.fleet = props;
      return React.createElement('div', { 'data-testid': 'fleet-comparison' });
    },
  };
});

import QuickStatsPage from './QuickStatsPage';
import type { Vehicle } from '@/types/vehicle';
import type { AnalyticsSummary } from '@/types/analytics';

/* ── Fixtures ─────────────────────────────────────────────────────── */

const ANALYTICS: AnalyticsSummary = {
  totalVehicles: 4,
  totalDrives: 128,
  totalChargingSessions: 47,
  totalDistanceKm: 12345,
  totalEnergyKwh: 450,
  totalCost: 321,
  avgEfficiencyWhKm: 158,
  co2SavedKg: 210,
  vehicleComparison: [
    { id: '1', name: 'Model Y', distance: 8000, energy: 1400, efficiency: 175 },
    { id: '2', name: 'Model 3', distance: 4345, energy: 640, efficiency: 147 },
  ],
};

const STATE = { state: 'online', battery_level: 72 };

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN-001',
    display_name: 'Model Y',
    model: 'modely',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Vehicle;
}

interface FakeQuery {
  data?: unknown;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  isPending: boolean;
  isSuccess: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    isPending: false,
    isSuccess: true,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function setUnits(distance: 'km' | 'mi') {
  useUnitsMock.mockReturnValue({
    unitPrefs: { distance, temperature: '°C', power: 'kW' },
    formatEnergy: (wh: number) => `${(wh ?? 0) / 1000} kWh`,
  });
}

function renderPage(path = '/quick-stats') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <main id="main-content">
          <QuickStatsPage />
        </main>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  heroIntegration.enabled = false;
  analyticsMock.mockReset();
  vehiclesMock.mockReset();
  vehicleStateMock.mockReset();
  selectedVehicleMock.mockReset();
  useUnitsMock.mockReset();
  useFormattingMock.mockReset();
  navigateMock.mockReset();
  for (const key of Object.keys(captured)) delete captured[key];

  // Default happy path — each spec overrides only what it needs.
  analyticsMock.mockReturnValue(makeQuery({ data: ANALYTICS }));
  vehiclesMock.mockReturnValue(makeQuery({ data: [makeVehicle()] }));
  vehicleStateMock.mockReturnValue(makeQuery({ data: { state: STATE } }));
  selectedVehicleMock.mockReturnValue({
    vehicleId: 1,
    vehicle: makeVehicle(),
    vehicles: [makeVehicle(), makeVehicle({ id: 2, vin: 'VIN-002', display_name: 'Model 3' })],
    setVehicleId: vi.fn(),
  });
  setUnits('km');
  useFormattingMock.mockReturnValue({
    currencySymbol: '$',
    formatCurrency: (amount: number, decimals?: number) =>
      `$${Number(amount ?? 0).toFixed(decimals ?? 2)}`,
  });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('QuickStatsPage', () => {
  it('renders the page shell and requests the 30-day fleet rollup', () => {
    renderPage();

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Quick stats' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Fleet snapshot · last 30 days')).toBeInTheDocument();
    // Both bento children mount — no gutted panels.
    expect(screen.getByTestId('fleet-comparison')).toBeInTheDocument();
    expect(screen.getByText('Powered by TeslaSync')).toBeInTheDocument();
    // Window is the documented ANALYTICS_WINDOW_DAYS constant.
    expect(analyticsMock).toHaveBeenCalledWith(30);
  });

  it('renders all eight KPI cards with km-unit conversions + formatting', () => {
    renderPage();

    // Labels (each unique) — every section is present.
    for (const label of [
      'Distance driven',
      'Drives',
      'Charging sessions',
      'Energy used',
      'Total cost',
      'Avg efficiency',
      'CO₂ saved',
      'Fleet vehicles',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Distance: 12345 km → identity → "12,345 km".
    expect(screen.getByText('12,345.00 km')).toBeInTheDocument();
    // Energy: 450 kWh → *1000 → formatEnergy(450000) → "450 kWh".
    expect(screen.getByText('450 kWh')).toBeInTheDocument();
    // Cost: formatCurrency(321, 0) → "$321".
    expect(screen.getByText('$321.00')).toBeInTheDocument();
    // Efficiency: 158 Wh/km, km branch is identity → "158.00 Wh/km".
    expect(screen.getByText('158.00 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('210.00 kg')).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('47')).toBeInTheDocument();
  });

  it('applies the mi branch: real km→mi distance + Wh/km→Wh/mi efficiency', () => {
    setUnits('mi');
    renderPage();

    // 12345 km * 1000 / 1609.344 ≈ 7670.8 → fmtInt → "7,671 mi".
    expect(screen.getByText('7,670.83 mi')).toBeInTheDocument();
    // 158 Wh/km * 1.609344 = 254.276… → "254.28 Wh/mi".
    expect(screen.getByText('254.28 Wh/mi')).toBeInTheDocument();
    // The identity-unit strings must be gone once converted.
    expect(screen.queryByText('12,345.00 km')).not.toBeInTheDocument();
    expect(screen.queryByText('158.00 Wh/km')).not.toBeInTheDocument();
  });

  it('keeps all metric labels and suppresses values while the rollup is loading', () => {
    analyticsMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    renderPage();

    const brief = screen.getByTestId('quick-stats-operational-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(8);
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(screen.getByText('Distance driven')).toBeInTheDocument();
  });

  it('shows a retry-able error when the rollup fails', () => {
    const q = makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 });
    analyticsMock.mockReturnValue(q);
    renderPage();

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(q.refetch).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(q.refetch).toHaveBeenCalledTimes(1);
    // The summary remains visible with unknown readings, alongside recovery.
    expect(screen.getByText('Distance driven')).toBeInTheDocument();
    expect(screen.getByTestId('quick-stats-operational-brief').querySelectorAll('[data-value-state="missing"]')).toHaveLength(8);
  });

  it('shows the empty state when the rollup resolves to no data', () => {
    analyticsMock.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();

    expect(screen.getByText('No fleet metrics available yet')).toBeInTheDocument();
    expect(screen.getByText('Distance driven')).toBeInTheDocument();
  });

  it('keeps all partial-rollup metrics visible and unknown instead of inventing zero', () => {
    analyticsMock.mockReturnValue(makeQuery({ data: {} as AnalyticsSummary }));
    renderPage();

    expect(screen.getByText('Distance driven')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Fleet metrics' })).getAllByText('—')).toHaveLength(8);
    expect(screen.queryByText('0.00 km')).toBeNull();
    expect(screen.queryByText('0 kWh')).toBeNull();
    expect((captured.fleet.entries as unknown[]).length).toBe(0);
  });

  it('distinguishes actual zero from nullable and non-finite metrics without altering valid formulas', () => {
    analyticsMock.mockReturnValue(makeQuery({ data: {
      ...ANALYTICS,
      totalDistanceKm: Number.NaN,
      totalDrives: 0,
      totalChargingSessions: null,
      totalEnergyKwh: null,
      totalCost: null,
      avgEfficiencyWhKm: Number.POSITIVE_INFINITY,
      co2SavedKg: 0,
      totalVehicles: null,
    } }));
    renderPage();
    const metrics = screen.getByRole('region', { name: 'Fleet metrics' });
    expect(within(metrics).getAllByText('—')).toHaveLength(6);
    expect(within(metrics).getByText('0')).toBeInTheDocument();
    expect(within(metrics).getByText('0.00 kg')).toBeInTheDocument();
  });

  it('spotlights the selected vehicle, forwarding identity + live state', () => {
    renderPage();

    expect(screen.getByTestId('vehicle-hero')).toBeInTheDocument();
    const vehicle = captured.hero.vehicle as { id: number; display_name: string; vin: string };
    expect(vehicle.id).toBe(1);
    expect(vehicle.display_name).toBe('Model Y');
    expect(vehicle.vin).toBe('VIN-001');
    // vehicleState is threaded from the state query's `.state`.
    expect(captured.hero.vehicleState).toEqual(STATE);
  });

  it('falls back to a default hero name when the vehicle has no display name', () => {
    selectedVehicleMock.mockReturnValue({
      vehicleId: 1,
      vehicle: makeVehicle({ display_name: '' }),
      vehicles: [makeVehicle({ display_name: '' })],
      setVehicleId: vi.fn(),
    });
    renderPage();

    const vehicle = captured.hero.vehicle as { display_name: string };
    expect(vehicle.display_name).toBe('Tesla');
  });

  it.each([
    { label: 'active loading', fetchStatus: 'fetching' as const, isLoading: true, paused: false },
    { label: 'paused without data', fetchStatus: 'paused' as const, isLoading: false, paused: true },
  ])('passes unresolved trust for $label without inventing an observation', ({ fetchStatus, isLoading, paused }) => {
    heroIntegration.enabled = true;
    vehicleStateMock.mockReturnValue(makeQuery({
      isPending: true, isSuccess: false, isLoading,
      isFetching: !paused, fetchStatus, dataUpdatedAt: Date.now(),
    }));
    renderPage();

    expect(captured.hero.vehicleState).toBeNull();
    expect(captured.hero.dataState).toMatchObject({
      status: 'initial', provenance: 'unknown', hasData: false, isRefreshBlocked: paused,
    });
    expect(captured.hero.observation).toEqual({ observedAt: null, freshness: 'unknown' });
    expect(screen.getByRole('status', { name: 'Loading Telemetry stream' })).toBeInTheDocument();
    expect(screen.getByText('No verified observation time for this vehicle')).toBeInTheDocument();
    expect(screen.queryByText('Live telemetry unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Live vehicle state')).not.toBeInTheDocument();
    if (paused) expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('renders a successful empty state without treating the fetch time as observation', () => {
    heroIntegration.enabled = true;
    vehicleStateMock.mockReturnValue(makeQuery({
      data: { state: undefined, live: false, observedAt: null, freshness: 'unknown' },
    }));
    renderPage();

    expect(captured.hero.dataState).toMatchObject({ status: 'unavailable', hasData: true });
    expect(captured.hero.observation).toEqual({ observedAt: null, freshness: 'unknown' });
    expect(screen.getByText('Live telemetry unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading Telemetry stream' })).not.toBeInTheDocument();
  });

  it('preserves zero, false, null and signed readings with the actual Hero', () => {
    heroIntegration.enabled = true;
    const readings = {
      state: 'parked', battery_level: 0, rated_range: 0, odometer: 0,
      inside_temp: null, outside_temp: -5, power: -2000,
      is_locked: false, sentry_mode: false, is_charging: false,
    };
    const observedAt = Date.now() - 30_000;
    vehicleStateMock.mockReturnValue(makeQuery({
      data: { state: readings, live: true, observedAt, freshness: 'fresh' },
      dataUpdatedAt: observedAt + 20_000,
    }));
    renderPage();

    expect(captured.hero.vehicleState).toBe(readings);
    expect(captured.hero.dataState).toMatchObject({ status: 'ok', provenance: 'live' });
    expect(captured.hero.observation).toEqual({ observedAt, freshness: 'fresh' });
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('-2.00')).toBeInTheDocument();
    expect(screen.getAllByText('-5').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('Telemetry stream observation does not verify individual reading timestamps or completeness.')).toBeInTheDocument();
  });

  it('retains observations through refresh failure and paused refresh, then recovers without duplicate notices', () => {
    heroIntegration.enabled = true;
    const observedAt = Date.now() - 60_000;
    const data = { state: STATE, live: true, observedAt, freshness: 'fresh' };
    const q = makeQuery({ data, error: new Error('state refresh failed'), isError: true });
    vehicleStateMock.mockReturnValue(q);
    const page = renderPage();
    const rerender = () => page.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/quick-stats']}>
          <main id="main-content"><QuickStatsPage /></main>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(captured.hero.vehicleState).toBe(STATE);
    expect(captured.hero.dataState).toMatchObject({ status: 'stale', provenance: 'cached', fatalError: null });
    expect(captured.hero.observation).toEqual({ observedAt, freshness: 'fresh' });
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(screen.queryByText('Live vehicle state')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(q.refetch).toHaveBeenCalledTimes(1);

    vehicleStateMock.mockReturnValue(makeQuery({ data, fetchStatus: 'paused' }));
    rerender();
    expect(captured.hero.dataState).toMatchObject({ status: 'stale', isRefreshBlocked: true, refreshError: null });
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(captured.hero.observation).toEqual({ observedAt, freshness: 'fresh' });

    vehicleStateMock.mockReturnValue(makeQuery({ data, dataUpdatedAt: Date.now() }));
    rerender();
    expect(captured.hero.dataState).toMatchObject({ status: 'ok', provenance: 'live', refreshError: null });
    expect(captured.hero.observation).toEqual({ observedAt, freshness: 'fresh' });
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('forwards fatal state failure and retries without replacing the fleet content', () => {
    heroIntegration.enabled = true;
    const q = makeQuery({ error: new Error('state failed'), isError: true, isSuccess: false });
    vehicleStateMock.mockReturnValue(q);
    renderPage();
    expect(captured.hero.dataState).toMatchObject({ status: 'initialFailure', hasData: false });
    expect(screen.getByText('The live-state request failed. This is a fact about our pipeline, not about the vehicle.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(q.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('12,345.00 km')).toBeInTheDocument();
    expect(screen.queryByText('Live vehicle state')).not.toBeInTheDocument();
  });

  it('uses historical provenance for the same as_of policy even if the retained payload says live', () => {
    const observedAt = Date.parse('2026-10-01T12:00:00Z');
    vehicleStateMock.mockReturnValue(makeQuery({
      data: { state: STATE, live: true, observedAt, freshness: 'stale' },
    }));
    renderPage('/quick-stats?as_of=2026-10-01T12%3A00%3A00Z');
    expect(captured.hero.dataState).toMatchObject({ provenance: 'historical' });
    expect(captured.hero.observation).toEqual({ observedAt, freshness: 'stale' });
    expect(vehicleStateMock).toHaveBeenCalledWith(1);
    expect(analyticsMock).toHaveBeenCalledWith(30);
  });

  it('switches readings and observation metadata together with workspace selection', () => {
    const firstObservation = Date.now() - 60_000;
    vehicleStateMock.mockImplementation((id: number) => makeQuery({
      data: id === 1
        ? { state: STATE, live: true, observedAt: firstObservation, freshness: 'fresh' }
        : { state: { battery_level: 0 }, live: false, observedAt: null, freshness: 'unknown' },
    }));
    const page = renderPage();
    expect(captured.hero.observation).toEqual({ observedAt: firstObservation, freshness: 'fresh' });
    page.unmount();
    selectedVehicleMock.mockReturnValue({ vehicleId: 2, vehicle: makeVehicle({ id: 2 }) });
    renderPage();
    expect(captured.hero.vehicle).toMatchObject({ id: 2 });
    expect(captured.hero.vehicleState).toEqual({ battery_level: 0 });
    expect(captured.hero.observation).toEqual({ observedAt: null, freshness: 'unknown' });
    expect(captured.hero.dataState).toMatchObject({ provenance: 'unknown' });
  });

  it('shows a spotlight skeleton (not the hero/empty) while vehicles load', () => {
    vehiclesMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    selectedVehicleMock.mockReturnValue({
      vehicleId: null,
      vehicle: null,
      vehicles: [],
      setVehicleId: vi.fn(),
    });
    const page = renderPage();
    const spotlight = screen.getByRole('region', { name: 'Vehicle spotlight' });

    const placeholders = spotlight.querySelectorAll('[class~="bg-[var(--skeleton-bg)]"]');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toHaveAttribute('aria-hidden', 'true');
    expect(placeholders[0]).toHaveClass('h-4', 'w-full', 'rounded');
    expect(placeholders[0]).toHaveStyle({ height: '300px' });
    expect(placeholders[0]).not.toHaveClass('animate-pulse');
    expect(within(spotlight).queryByTestId('vehicle-hero')).not.toBeInTheDocument();
    expect(within(spotlight).queryByText('No vehicle found')).not.toBeInTheDocument();
    expect(screen.getByText('12,345.00 km')).toBeInTheDocument();

    page.unmount();
    vehiclesMock.mockReturnValue(makeQuery({ data: [makeVehicle()], isLoading: true }));
    selectedVehicleMock.mockReturnValue({
      vehicleId: 1,
      vehicle: makeVehicle(),
      vehicles: [makeVehicle()],
      setVehicleId: vi.fn(),
    });
    renderPage();
    const cachedSpotlight = screen.getByRole('region', { name: 'Vehicle spotlight' });
    expect(within(cachedSpotlight).getByTestId('vehicle-hero')).toBeInTheDocument();
    expect(captured.hero.vehicle).toMatchObject({ id: 1, display_name: 'Model Y' });
    expect(captured.hero.vehicleState).toEqual(STATE);
    expect(cachedSpotlight.querySelector('.animate-pulse')).toBeNull();
    expect(cachedSpotlight.querySelector('[class~="bg-[var(--skeleton-bg)]"]')).toBeNull();
    expect(within(cachedSpotlight).queryByText('No vehicle found')).not.toBeInTheDocument();
  });

  it('shows a retry-able error in the spotlight when the vehicle list fails', () => {
    // Regression guard: the vehicles data source must offer a recovery
    // affordance just like the analytics band does.
    const vq = makeQuery({ error: new Error('down'), isError: true, dataUpdatedAt: 0 });
    vehiclesMock.mockReturnValue(vq);
    renderPage();

    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(vq.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('vehicle-hero')).not.toBeInTheDocument();
  });

  it('shows an empty state and hides the details link when no vehicle exists', () => {
    selectedVehicleMock.mockReturnValue({
      vehicleId: null,
      vehicle: null,
      vehicles: [],
      setVehicleId: vi.fn(),
    });
    renderPage();

    expect(screen.getByText('No vehicle found')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-hero')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Vehicle details' }),
    ).not.toBeInTheDocument();
  });

  it('wires the fleet-comparison panel with entries, states and a working retry', () => {
    const aq = makeQuery({ data: ANALYTICS });
    analyticsMock.mockReturnValue(aq);
    renderPage();

    expect(captured.fleet.entries).toBe(ANALYTICS.vehicleComparison);
    expect(captured.fleet.loading).toBe(false);
    expect(captured.fleet.error).toBeNull();
    // onRetry is the analytics refetch — invoking it triggers a reload.
    (captured.fleet.onRetry as () => void)();
    expect(aq.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps all eight metrics, comparison and spotlight during failed background refresh', () => {
    analyticsMock.mockReturnValue(makeQuery({ data: ANALYTICS, error: new Error('refresh failed'), isError: true }));
    vehiclesMock.mockReturnValue(makeQuery({ data: [makeVehicle()], error: new Error('registry refresh failed'), isError: true }));
    const { container } = renderPage();
    expect(screen.getByText('12,345.00 km')).toBeInTheDocument();
    expect(screen.getByText('450 kWh')).toBeInTheDocument();
    expect(screen.getByTestId('vehicle-hero')).toBeInTheDocument();
    expect(captured.fleet.entries).toBe(ANALYTICS.vehicleComparison);
    expect(captured.fleet.error).toBeNull();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getAllByText('Cached · refresh failed')).toHaveLength(2);
    expect(container.querySelector('[data-layout-reference]')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Fleet metrics' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open dashboard' })).toBeInTheDocument();
    expect(within(screen.getByTestId('quick-stats-operational-brief')).getByText('Retained readings')).toBeInTheDocument();
  });

  it('opens the real review drawer with fleet scope, source units and all eight measurements', () => {
    renderPage();
    const brief = screen.getByTestId('quick-stats-operational-brief');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(8);
    expect(within(brief).getByText('All fleet vehicles · last 30 days')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Fleet operating summary details' })).toBeInTheDocument();
    expect(within(drawer).getByText('12,345.00 km')).toBeInTheDocument();
    expect(within(drawer).getByText(/source kilometres normalized to metres/)).toBeInTheDocument();
    expect(within(drawer).getByText(/source Wh\/km normalized to Wh\/m/)).toBeInTheDocument();
    expect(within(drawer).getAllByText(/exact rollup bounds and source coverage are not supplied/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('vehicle-hero')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-comparison')).toBeInTheDocument();
  });

  it('does not duplicate the workspace vehicle picker for multi-vehicle or single-vehicle fleets', () => {
    expect(getWorkspaceRouteScope('/quick-stats').vehicle).toBe(true);
    const multi = renderPage();
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
    multi.unmount();

    selectedVehicleMock.mockReturnValue({
      vehicleId: 1,
      vehicle: makeVehicle(),
      vehicles: [makeVehicle()],
      setVehicleId: vi.fn(),
    });
    renderPage();
    // Single-vehicle fleets never render a picker.
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
  });

  it('consumes workspace selection changes without re-scoping the fleet KPI rollup', () => {
    selectedVehicleMock.mockReturnValue({
      vehicleId: 1,
      vehicle: makeVehicle(),
      vehicles: [makeVehicle(), makeVehicle({ id: 2, vin: 'VIN-002', display_name: 'Model 3' })],
      setVehicleId: vi.fn(),
    });
    const first = renderPage();
    expect(captured.hero.vehicle).toMatchObject({ id: 1 });
    first.unmount();
    selectedVehicleMock.mockReturnValue({
      vehicleId: 2,
      vehicle: makeVehicle({ id: 2, display_name: 'Model 3' }),
      vehicles: [makeVehicle(), makeVehicle({ id: 2 })],
      setVehicleId: vi.fn(),
    });
    renderPage();
    expect(captured.hero.vehicle).toMatchObject({ id: 2 });
    expect(vehicleStateMock).toHaveBeenCalledWith(2);
    expect(analyticsMock).toHaveBeenLastCalledWith(30);
    expect(screen.getByText('12,345.00 km')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('refreshes analytics, vehicle state and the vehicle list together', () => {
    const aq = makeQuery({ data: ANALYTICS });
    const sq = makeQuery({ data: { state: STATE } });
    const vq = makeQuery({ data: [makeVehicle()] });
    analyticsMock.mockReturnValue(aq);
    vehicleStateMock.mockReturnValue(sq);
    vehiclesMock.mockReturnValue(vq);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh quick stats' }));
    expect(aq.refetch).toHaveBeenCalledTimes(1);
    expect(sq.refetch).toHaveBeenCalledTimes(1);
    expect(vq.refetch).toHaveBeenCalledTimes(1);
  });

  it('navigates from the quick-link buttons', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Open dashboard' }));
    expect(navigateMock).toHaveBeenCalledWith('/');

    fireEvent.click(screen.getByRole('button', { name: 'Vehicle details' }));
    expect(navigateMock).toHaveBeenCalledWith('/vehicles/1');

    fireEvent.click(screen.getByRole('button', { name: 'View analytics' }));
    expect(navigateMock).toHaveBeenCalledWith('/statistics');
  });

  it('leaves the shell as the sole main landmark while keeping all three sections', () => {
    renderPage();

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main.querySelector('main')).toBeNull();
    expect(within(main).getByRole('region', { name: 'Fleet metrics' })).toBeInTheDocument();
    expect(within(main).getByRole('region', { name: 'Vehicle spotlight' })).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Open dashboard' })).toBeInTheDocument();
    expect(within(main).getByText('Powered by TeslaSync')).toBeInTheDocument();
  });

  it.each([
    { caseId: 'no selection', vehicleId: null },
    { caseId: 'zero identifier', vehicleId: 0 },
    { caseId: 'negative identifier', vehicleId: -1 },
  ])('refreshes only enabled sources with $caseId', ({ vehicleId }) => {
    const analytics = makeQuery({ data: ANALYTICS });
    const vehicles = makeQuery({ data: [] });
    const disabledState = makeQuery({
      error: new Error('Disabled state must not be a participating source'),
      isError: true,
      dataUpdatedAt: 0,
    });
    analyticsMock.mockReturnValue(analytics);
    vehiclesMock.mockReturnValue(vehicles);
    vehicleStateMock.mockReturnValue(disabledState);
    selectedVehicleMock.mockReturnValue({ vehicleId, vehicle: null, vehicles: [] });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh quick stats' }));

    expect(analytics.refetch).toHaveBeenCalledTimes(1);
    expect(vehicles.refetch).toHaveBeenCalledTimes(1);
    expect(disabledState.refetch).not.toHaveBeenCalled();
    expect(vehicleStateMock).toHaveBeenCalledWith(vehicleId ?? 0);
    expect(screen.queryByText('Disabled state must not be a participating source')).toBeNull();
    expect(screen.getByText('12,345.00 km')).toBeInTheDocument();
    expect(screen.getByText('No vehicle found')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-comparison')).toBeInTheDocument();
  });

  it('keeps mobile touch targets and wrapping labels without changing navigation', () => {
    renderPage();

    for (const name of ['Refresh quick stats', 'Open dashboard', 'Vehicle details', 'View analytics']) {
      const action = screen.getByRole('button', { name });
      expect(action).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0');
      expect(action).toHaveClass('focus-visible:outline', 'focus-visible:outline-2');
      if (name !== 'Refresh quick stats') {
        expect(action).toHaveClass('h-auto', 'whitespace-normal', 'max-w-full');
      }
    }
    expect(screen.getAllByRole('button', { name: 'Vehicle details' })).toHaveLength(1);
  });
});
