/**
 * StatisticsPage contract + hardening tests.
 *
 * StatisticsPage is a data-dense analytics page with five independent data
 * sources threaded through three bento sections:
 *   1. Period totals + averages   — an inline `useQuery` period-stats call
 *      driven through the mocked `@/api/client` `request` seam.
 *   2. Battery health + State distribution.
 *   3. Mileage summary + Vehicle comparison.
 *
 * The four hook-backed sources (battery / mileage / state-summary / fleet) are
 * mocked at the hook boundary so each source's loading / error / empty / loaded
 * branch can be driven deterministically and asserted in isolation (recharts
 * renders nothing meaningful in jsdom, so the tests assert the page's own
 * branch selection — figure vs. empty-state — rather than SVG internals). The
 * display hooks (`useUnits` / `useFormatting` / `useChartPalette`) and every
 * shared component render for real, so the SI→display unit conversion at the
 * render boundary is exercised end-to-end for both metric (km) and imperial
 * (mi) preferences.
 *
 * Facets covered:
 *   - Shell: h1 title, subtitle, document-title side effect.
 *   - Period totals + averages: all five KPI cards + three average cards with
 *     exact km-converted values (region-scoped to disambiguate shared labels).
 *   - Loading / error / empty branches for the period-stats query.
 *   - Battery, mileage, state-distribution and fleet-comparison each: loaded +
 *     empty (+ error where the source surfaces one).
 *   - `total_min` snake_case fallback for the deleted state-summary endpoint.
 *   - Bug-fix regression guard: the fleet comparison is scoped by BOTH the URL
 *     `from` AND `to` dates (previously the end date was silently dropped).
 *   - Request contract: snake_case `vehicle_id`, no `/api/v1` double-prefix.
 *   - Interactions: refresh re-fetches; picking a vehicle dispatches selection.
 *   - Imperial unit conversion of distance + efficiency.
 *   - a11y: labelled metric regions, named chart figures, named refresh + picker.
 *
 * Network never touches the real backend — the `request` seam is mocked and the
 * four data hooks are stubbed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// i18n stub: return the fallback string, interpolating {{var}} tokens so
// assertions can target the rendered English copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const o = fallbackOrOpts as Record<string, unknown>;
        if (typeof o.defaultValue === 'string') return o.defaultValue;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Mutable unit preference so a single file can exercise both the metric (km)
// and imperial (mi) display-conversion branches. Hoisted so the settings mock
// factory may close over it.
const unitState = vi.hoisted(() => ({ length: 'km' as 'km' | 'mi' }));

// File-level useSettings mock (overrides the global test-setup stub). Mirrors
// the production defaults so every transitive consumer sees the same shape,
// but lets `unit_of_length` flip per test.
vi.mock('@/hooks/useSettings', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSettings')>();
  const defaults = {
    unit_of_length: 'km' as const,
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
    ai_cost_cap_cents: 0,
  };
  return {
    ...actual,
    useSettings: () => ({
      settings: { ...defaults, unit_of_length: unitState.length },
      isMiles: unitState.length === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('@/api/hooks/useAnalytics', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useAnalytics')>();
  return {
    ...actual,
    useMileageStats: vi.fn(),
    useStateSummary: vi.fn(),
    useFleetAnalytics: vi.fn(),
  };
});

vi.mock('@/api/hooks/useEnergy', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useEnergy')>();
  return { ...actual, useBatteryHealthAnalytics: vi.fn() };
});

vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { request } from '@/api/client';
import { useMileageStats, useStateSummary, useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { ToastProvider } from '@/components/feedback/Toast';
import StatisticsPage from './StatisticsPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;
const mockMileage = vi.mocked(useMileageStats);
const mockStateSummary = vi.mocked(useStateSummary);
const mockFleet = vi.mocked(useFleetAnalytics);
const mockBattery = vi.mocked(useBatteryHealthAnalytics);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

let periodStatsHandler: () => Promise<unknown>;
let setVehicleIdSpy: ReturnType<typeof vi.fn>;

/** Minimal `UseQueryResult`-shaped stub for the mocked data hooks. */
function qr(over: Record<string, unknown> = {}): any {
  return { data: undefined, isLoading: false, error: null, refetch: vi.fn(), ...over };
}

function makeStats(over: Record<string, unknown> = {}) {
  return {
    total_distance: 500, // SI km
    total_drives: 42,
    energy_used: 100,
    total_cost: 250,
    co2_saved: 50,
    avg_efficiency: 160, // SI Wh/km
    ...over,
  };
}

function makeBattery(over: Record<string, unknown> = {}) {
  return {
    current_soh: 92,
    estimated_capacity: 71.5,
    original_capacity: 75,
    degradation_rate_yr: 2.34,
    battery_age_months: 30,
    total_cycles: 412,
    avg_depth_of_discharge: 0,
    fast_charge_pct: 0,
    full_charge_pct: 0,
    charge_habits_score: 0,
    temp_exposure_score: 0,
    history: [],
    ...over,
  };
}

function makeMileage(over: Record<string, unknown> = {}) {
  return {
    vehicle_id: 1,
    lifetime_km: 8000,
    last_7d_km: 200,
    last_30d_km: 900,
    last_365d_km: 8000,
    drive_count_lifetime: 321,
    drive_count_30d: 30,
    first_drive_at: null,
    last_drive_at: null,
    ...over,
  };
}

function makeStateSummary() {
  return [
    { state: 'driving', totalMin: 120, count: 10 },
    { state: 'parked', totalMin: 300, count: 5 },
    { state: 'charging', totalMin: 60, count: 3 },
  ];
}

/** Partial FleetAnalytics — the page only reads `vehicle_comparison`. */
function makeFleet(vehicleCount = 2) {
  return {
    vehicle_comparison: Array.from({ length: vehicleCount }).map((_, i) => ({
      id: i + 1,
      name: `Car ${i + 1}`,
      distance: 1000 * (i + 1), // SI km
      energy: 200 * (i + 1),
      efficiency: 160,
      drives: 10,
    })),
  };
}

function installHappyPath() {
  setVehicleIdSpy = vi.fn();
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 1,
    vehicle: null,
    vehicles: [
      { id: 1, display_name: 'Car One', vin: 'VIN1' },
      { id: 2, display_name: 'Car Two', vin: 'VIN2' },
    ] as any,
    setVehicleId: setVehicleIdSpy,
  });
  mockBattery.mockReturnValue(qr({ data: makeBattery() }));
  mockMileage.mockReturnValue(qr({ data: makeMileage() }));
  mockStateSummary.mockReturnValue(qr({ data: makeStateSummary() }));
  mockFleet.mockReturnValue(qr({ data: makeFleet(2) }));
}

function renderPage(initialEntries: string[] = ['/statistics']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <StatisticsPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Every request path issued so far (drops the non-string signal arg). */
function issuedPaths(): string[] {
  return mockedRequest.mock.calls
    .map((c) => c[0])
    .filter((p): p is string => typeof p === 'string');
}

function periodStatsCallCount(): number {
  return issuedPaths().filter((p) => p.startsWith('/analytics/period-stats')).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  unitState.length = 'km';
  periodStatsHandler = () => Promise.resolve(makeStats());
  mockedRequest.mockImplementation((path: unknown) => {
    if (typeof path === 'string') {
      if (path.startsWith('/analytics/period-stats')) return periodStatsHandler();
      if (path.startsWith('/settings')) return Promise.resolve({});
      if (path.startsWith('/annotations')) return Promise.resolve([]);
    }
    return Promise.resolve(null);
  });
  installHappyPath();
});

describe('StatisticsPage', () => {
  it('renders the page shell (h1 + subtitle) and sets the document title', async () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Statistics' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Lifetime vehicle statistics and records'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Statistics');

    // Let the period-stats query settle so the loaded region mounts.
    expect(await screen.findByRole('region', { name: 'Statistics' })).toBeInTheDocument();
  });

  it('renders every period-total and average card with km-converted values', async () => {
    renderPage();

    const totals = await screen.findByRole('region', { name: 'Statistics' });
    expect(within(totals).getByText('Total Distance')).toBeInTheDocument();
    expect(within(totals).getByText('500 km')).toBeInTheDocument();
    expect(within(totals).getByText('42')).toBeInTheDocument();
    expect(within(totals).getByText('100.00 kWh')).toBeInTheDocument();
    expect(within(totals).getByText('$250')).toBeInTheDocument();
    expect(within(totals).getByText('50.00 kg')).toBeInTheDocument();

    const averages = screen.getByRole('region', { name: 'Averages' });
    // 500 km / 42 drives = 11.90 km
    expect(within(averages).getByText('11.90 km')).toBeInTheDocument();
    expect(within(averages).getByText('160.00 Wh/km')).toBeInTheDocument();
    // 250 cost / 500 km = 0.500
    expect(within(averages).getByText('$0.500')).toBeInTheDocument();
  });

  it('shows loading skeletons while the period-stats query is pending', async () => {
    periodStatsHandler = () => new Promise(() => {}); // never resolves

    renderPage();

    expect(await screen.findAllByTestId('stat-grid-skeleton')).toHaveLength(2);
    expect(screen.queryByRole('region', { name: 'Statistics' })).not.toBeInTheDocument();
    expect(screen.queryByText('No Data')).not.toBeInTheDocument();
  });

  it('surfaces a retry-able error when the period-stats request fails', async () => {
    periodStatsHandler = () => Promise.reject(new Error('period stats down'));

    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Statistics' })).not.toBeInTheDocument();
  });

  it('re-fetches the period stats when the error retry button is clicked', async () => {
    periodStatsHandler = () => Promise.reject(new Error('boom'));

    renderPage();

    await screen.findByRole('button', { name: 'Retry' });
    const before = periodStatsCallCount();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(periodStatsCallCount()).toBeGreaterThan(before));
  });

  it('shows the "No Data" empty state when period stats resolve empty', async () => {
    periodStatsHandler = () => Promise.resolve(null);

    renderPage();

    expect(await screen.findByText('No Data')).toBeInTheDocument();
    expect(
      screen.getByText('No statistics available for this vehicle.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Statistics' })).not.toBeInTheDocument();
  });

  it('renders the battery-health gauge and its stat cards on the happy path', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    expect(screen.getByText('Health')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('Capacity')).toBeInTheDocument();
    expect(screen.getByText('71.5 kWh')).toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText('30 mo')).toBeInTheDocument();
  });

  it('renders battery empty and error placeholders without blanking the panel', async () => {
    mockBattery.mockReturnValue(qr({ data: undefined }));
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByText('No battery health data available')).toBeInTheDocument();
    expect(screen.queryByText('Capacity')).not.toBeInTheDocument();
    unmount();

    mockBattery.mockReturnValue(qr({ error: new Error('battery down') }));
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Capacity')).not.toBeInTheDocument();
  });

  it('renders the mileage summary cards on the happy path', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByText('Daily Average')).toBeInTheDocument();
    expect(screen.getByText('Yearly Projection')).toBeInTheDocument();
    expect(screen.getByText('8,000 km')).toBeInTheDocument();
  });

  it('renders mileage empty and error placeholders without blanking the panel', async () => {
    mockMileage.mockReturnValue(qr({ data: undefined }));
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByText('No mileage data available')).toBeInTheDocument();
    expect(screen.queryByText('Daily Average')).not.toBeInTheDocument();
    unmount();

    mockMileage.mockReturnValue(qr({ error: new Error('mileage down') }));
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Daily Average')).not.toBeInTheDocument();
  });

  it('renders the state-distribution chart figure when data is present', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    expect(
      screen.getByRole('heading', { level: 3, name: 'State Distribution' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Vehicle state distribution pie chart' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No state distribution data')).not.toBeInTheDocument();
  });

  it('reads the snake_case total_min fallback for state summary rows', async () => {
    mockStateSummary.mockReturnValue(
      qr({ data: [{ state: 'driving', total_min: 90, count: 4 }] }),
    );
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    // total_min is read via fallback → the chart branch renders (no empty state).
    expect(screen.queryByText('No state distribution data')).not.toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Vehicle state distribution pie chart' }),
    ).toBeInTheDocument();
  });

  it('shows the state-distribution empty state when there are no rows', async () => {
    mockStateSummary.mockReturnValue(qr({ data: [] }));
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    expect(screen.getByText('No state distribution data')).toBeInTheDocument();
  });

  it('renders the vehicle-comparison chart with 2+ vehicles', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    expect(
      screen.getByRole('heading', { level: 3, name: 'Vehicle Comparison' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Add more vehicles to compare')).not.toBeInTheDocument();
  });

  it('shows a single-vehicle empty state and a fleet error placeholder', async () => {
    mockFleet.mockReturnValue(qr({ data: makeFleet(1) }));
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByText('Add more vehicles to compare')).toBeInTheDocument();
    unmount();

    mockFleet.mockReturnValue(qr({ error: new Error('fleet down') }));
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('scopes the fleet comparison to BOTH the URL from and to dates', async () => {
    renderPage(['/statistics?from=2025-03-01&to=2025-03-15']);
    await screen.findByRole('region', { name: 'Statistics' });

    // Regression guard: the end date must reach the fleet query. Previously the
    // page called useFleetAnalytics(30, startDate), silently dropping `to`.
    expect(mockFleet).toHaveBeenCalledWith({ start: '2025-03-01', end: '2025-03-15' });
  });

  it('requests period stats with a snake_case vehicle_id and no /api/v1 prefix', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    const paths = issuedPaths();
    expect(paths).toContain('/analytics/period-stats?vehicle_id=1');
    expect(paths.every((p) => !p.includes('/api/v1'))).toBe(true);
    expect(paths.every((p) => !p.includes('vehicleId='))).toBe(true);
  });

  it('re-fetches the stats when the toolbar refresh button is clicked', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    // Both the toolbar <button> and the DataFreshness chip expose a "Refresh"
    // accessible name; target the real <button> element.
    const toolbarRefresh = screen
      .getAllByRole('button', { name: 'Refresh' })
      .find((el) => el.tagName === 'BUTTON');
    const before = periodStatsCallCount();
    fireEvent.click(toolbarRefresh as HTMLElement);

    await waitFor(() => expect(periodStatsCallCount()).toBeGreaterThan(before));
  });

  it('hides the vehicle picker when the fleet is empty and shows it otherwise', async () => {
    mockSelectedVehicle.mockReturnValue({
      vehicleId: null,
      vehicle: null,
      vehicles: [] as any,
      setVehicleId: vi.fn(),
    });
    const { unmount } = renderPage();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    unmount();

    installHappyPath();
    renderPage();
    const picker = screen.getByRole('combobox', { name: 'Select Vehicle' });
    expect(within(picker).getByRole('option', { name: 'Car One' })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: 'Car Two' })).toBeInTheDocument();
  });

  it('dispatches the numeric selection when a vehicle is picked', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    fireEvent.change(screen.getByRole('combobox', { name: 'Select Vehicle' }), {
      target: { value: '2' },
    });

    expect(setVehicleIdSpy).toHaveBeenCalledWith(2);
  });

  it('converts distance and efficiency to imperial units when preferred', async () => {
    unitState.length = 'mi';
    renderPage();

    const totals = await screen.findByRole('region', { name: 'Statistics' });
    // 500 km → 310.69 mi → fmtInt → 311 mi
    expect(within(totals).getByText('311 mi')).toBeInTheDocument();

    const averages = screen.getByRole('region', { name: 'Averages' });
    // 160 Wh/km × 1.609344 → 257.50 Wh/mi
    expect(within(averages).getByText('257.50 Wh/mi')).toBeInTheDocument();
  });

  it('is accessible: labelled metric regions, named chart figures, and named controls', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    expect(screen.getByRole('region', { name: 'Statistics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Averages' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Vehicle state distribution pie chart' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'Distance and energy bar chart comparing all vehicles in the fleet',
      }),
    ).toBeInTheDocument();
    // The toolbar exposes a labelled refresh <button> (distinct from the
    // DataFreshness chip which also carries a "Refresh" accessible name).
    expect(
      screen
        .getAllByRole('button', { name: 'Refresh' })
        .some((el) => el.tagName === 'BUTTON'),
    ).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Select Vehicle' })).toBeInTheDocument();
  });
});
