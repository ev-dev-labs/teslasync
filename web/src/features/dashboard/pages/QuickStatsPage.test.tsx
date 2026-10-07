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
 *   4. Vehicle picker — visibility (>1 vehicle), change → setVehicleId with a
 *      parsed id, and the guard that rejects the empty placeholder.
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
import { render, screen, fireEvent } from '@testing-library/react';
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
} = vi.hoisted(() => ({
  analyticsMock: vi.fn(),
  vehiclesMock: vi.fn(),
  vehicleStateMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  useUnitsMock: vi.fn(),
  useFormattingMock: vi.fn(),
  navigateMock: vi.fn(),
  captured: {} as Record<string, Record<string, unknown>>,
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
  return {
    VehicleHeroCard: (props: Record<string, unknown>) => {
      captured.hero = props;
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
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function setUnits(distance: 'km' | 'mi') {
  useUnitsMock.mockReturnValue({
    unitPrefs: { distance },
    formatEnergy: (wh: number) => `${(wh ?? 0) / 1000} kWh`,
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <QuickStatsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
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
    formatCurrency: (amount: number, decimals?: number) =>
      `$${Number(amount ?? 0).toFixed(decimals ?? 2)}`,
  });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('QuickStatsPage', () => {
  it('renders the page shell and requests the 30-day fleet rollup', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Quick Stats' }),
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
      'Distance Driven',
      'Drives',
      'Charging Sessions',
      'Energy Used',
      'Total Cost',
      'Avg Efficiency',
      'CO₂ Saved',
      'Fleet Vehicles',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Distance: 12345 km → identity → "12,345 km".
    expect(screen.getByText('12,345 km')).toBeInTheDocument();
    // Energy: 450 kWh → *1000 → formatEnergy(450000) → "450 kWh".
    expect(screen.getByText('450 kWh')).toBeInTheDocument();
    // Cost: formatCurrency(321, 0) → "$321".
    expect(screen.getByText('$321')).toBeInTheDocument();
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
    expect(screen.getByText('7,671 mi')).toBeInTheDocument();
    // 158 Wh/km * 1.609344 = 254.276… → "254.28 Wh/mi".
    expect(screen.getByText('254.28 Wh/mi')).toBeInTheDocument();
    // The identity-unit strings must be gone once converted.
    expect(screen.queryByText('12,345 km')).not.toBeInTheDocument();
    expect(screen.queryByText('158.00 Wh/km')).not.toBeInTheDocument();
  });

  it('shows the stat-grid skeleton while the rollup is loading (no cards yet)', () => {
    analyticsMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    renderPage();

    expect(screen.getByTestId('stat-grid-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Distance Driven')).not.toBeInTheDocument();
  });

  it('shows a retry-able error when the rollup fails', () => {
    const q = makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 });
    analyticsMock.mockReturnValue(q);
    renderPage();

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(q.refetch).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(q.refetch).toHaveBeenCalledTimes(1);
    // KPI cards are not rendered in the error state.
    expect(screen.queryByText('Distance Driven')).not.toBeInTheDocument();
  });

  it('shows the empty state when the rollup resolves to no data', () => {
    analyticsMock.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();

    expect(screen.getByText('No fleet metrics available yet')).toBeInTheDocument();
    expect(screen.queryByText('Distance Driven')).not.toBeInTheDocument();
  });

  it('is null-safe: a partial rollup renders zeros instead of throwing', () => {
    // Backend contract says every field is present, but the page must not
    // assume it — a `{}` payload must degrade to zeros with an empty compare.
    analyticsMock.mockReturnValue(makeQuery({ data: {} as AnalyticsSummary }));
    renderPage();

    expect(screen.getByText('Distance Driven')).toBeInTheDocument();
    expect(screen.getByText('0 km')).toBeInTheDocument();
    expect(screen.getByText('0 kWh')).toBeInTheDocument();
    expect((captured.fleet.entries as unknown[]).length).toBe(0);
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

  it('shows a spotlight skeleton (not the hero/empty) while vehicles load', () => {
    vehiclesMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderPage();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-hero')).not.toBeInTheDocument();
    expect(screen.queryByText('No vehicle found')).not.toBeInTheDocument();
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
      screen.queryByRole('button', { name: 'Vehicle Details' }),
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

  it('renders the vehicle picker only for multi-vehicle fleets', () => {
    const multi = renderPage();
    expect(
      screen.getByRole('combobox', { name: 'Select vehicle' }),
    ).toBeInTheDocument();
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

  it('re-scopes the spotlight on a valid pick and ignores the empty option', () => {
    const setVehicleId = vi.fn();
    selectedVehicleMock.mockReturnValue({
      vehicleId: 1,
      vehicle: makeVehicle(),
      vehicles: [makeVehicle(), makeVehicle({ id: 2, vin: 'VIN-002', display_name: 'Model 3' })],
      setVehicleId,
    });
    renderPage();

    const picker = screen.getByRole('combobox', { name: 'Select vehicle' });
    fireEvent.change(picker, { target: { value: '2' } });
    expect(setVehicleId).toHaveBeenCalledWith(2);

    // The empty placeholder must be guarded out (Number('') → 0, not > 0).
    setVehicleId.mockClear();
    fireEvent.change(picker, { target: { value: '' } });
    expect(setVehicleId).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole('button', { name: 'Open Dashboard' }));
    expect(navigateMock).toHaveBeenCalledWith('/');

    fireEvent.click(screen.getByRole('button', { name: 'Vehicle Details' }));
    expect(navigateMock).toHaveBeenCalledWith('/vehicles/1');

    fireEvent.click(screen.getByRole('button', { name: 'View Analytics' }));
    expect(navigateMock).toHaveBeenCalledWith('/statistics');
  });
});
