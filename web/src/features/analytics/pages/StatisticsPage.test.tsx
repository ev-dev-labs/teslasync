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
 *     header instants, including the exclusive end and rolling 24-hour scope.
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

vi.unmock('@/api/hooks/useAnnotations');

// i18n stub: return the fallback string, interpolating {{var}} tokens so
// assertions can target the rendered English copy.
const displayState = vi.hoisted(() => ({ locale: 'en-US', timezone: '', language: 'en' }));

vi.mock('react-i18next', async () => {
  const { createInstance } = await import('i18next');
  const { default: en } = await import('@/i18n/en.json');
  const translations = createInstance();
  await translations.init({
    lng: 'en', fallbackLng: 'en',
    resources: {
      en: { translation: en },
      fr: { translation: { statistics: { ageMonths_one: 'mois', ageMonths_other: 'mois' } } },
    },
  });
  return {
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (key === 'statistics.ageMonths') {
        return translations.t(key, { ...(fallbackOrOpts as { count: number; defaultValue: string }), lng: displayState.language });
      }
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
  };
});

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
      settings: { ...defaults, unit_of_length: unitState.length, locale: displayState.locale,
        timezone_user: displayState.timezone, tz_display_default: displayState.timezone ? 'user' : 'vehicle' },
      isMiles: unitState.length === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: displayState.locale,
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
import { calendarRangeToInstants } from '@/lib/dateRange';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { ToastProvider } from '@/components/feedback/Toast';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
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
function qr<T>(over: Record<string, unknown> = {}): T {
  return { data: undefined, isLoading: false, error: null, refetch: vi.fn(), ...over } as T;
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
    estimated_capacity_wh: 71_500,
    original_capacity_wh: 75_000,
    degradation_rate_pct_per_year: 2.34,
    battery_age_months: 30,
    total_cycles: 412,
    avg_depth_of_discharge_pct: 0,
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
    ] as ReturnType<typeof useSelectedVehicle>['vehicles'],
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
  const page = () => (
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <ToastProvider>
            <StatisticsPage />
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const result = render(page());
  return { ...result, client, rerenderPage: () => result.rerender(page()) };
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
  displayState.locale = 'en-US';
  displayState.timezone = '';
  displayState.language = 'en';
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
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
  it('renders recorded state shares from the real summary hook and restored seconds envelope', async () => {
    const actual = await vi.importActual<typeof import('@/api/hooks/useAnalytics')>('@/api/hooks/useAnalytics');
    mockStateSummary.mockImplementation(actual.useStateSummary);
    const response = {
      vehicle_id: 1,
      days: 7,
      start: '2026-10-01T00:00:00Z',
      end: '2026-10-08T00:00:00Z',
      total_seconds: 28_800,
      by_state: [
        { state: 'driving', total_seconds: 7_200, percentage: 25, transition_count: 10 },
        { state: 'parked', total_seconds: 18_000, percentage: 62.5, transition_count: 5 },
        { state: 'charging', total_seconds: 3_600, percentage: 12.5, transition_count: 3 },
      ],
    };
    mockedRequest.mockImplementation((path: unknown) => {
      if (path === '/vehicle-states/summary?vehicle_id=1') return Promise.resolve(response);
      if (typeof path === 'string' && path.startsWith('/analytics/period-stats')) return periodStatsHandler();
      if (typeof path === 'string' && path.startsWith('/annotations')) return Promise.resolve([]);
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByText('500 km');

    await waitFor(() => {
      const table = screen.getByRole('table', { name: 'State distribution — data table' });
      for (const [state, share] of [['driving', '25'], ['parked', '63'], ['charging', '13']]) {
        const row = within(table).getAllByRole('row').find(candidate => within(candidate).queryByText(state));
        expect(row).toBeDefined();
        expect(within(row!).getByText(share)).toBeInTheDocument();
      }
    });
    const call = mockedRequest.mock.calls.find(args => args[0] === '/vehicle-states/summary?vehicle_id=1');
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(response.by_state[0]).toEqual({
      state: 'driving', total_seconds: 7_200, percentage: 25, transition_count: 10,
    });
  });

  it('discloses capped and partial reasons beside retained comparison rows through failure and recovery', async () => {
    const partial = {
      is_partial: true,
      reasons: ['drive_record_cap_reached', 'charging_record_cap_reached', 'future_source_reason'],
    };
    const data = { ...makeFleet(2), partial_result: partial };
    const retry = vi.fn();
    mockFleet.mockReturnValue(qr({ data, isSuccess: true, refetch: retry }));
    const { rerenderPage } = renderPage();
    await screen.findByText('500 km');

    const assertRetained = () => {
      const notice = screen.getByTestId('statistics-fleet-partial');
      expect(notice).toHaveAttribute('data-data-state', 'partial');
      expect(notice).toHaveTextContent('Available results remain visible and are not treated as complete.');
      for (const reason of partial.reasons) expect(within(notice).getByText(reason)).toBeInTheDocument();
      const table = screen.getByRole('table', { name: 'Vehicle comparison — data table' });
      expect(within(table).getByText('Car 1')).toBeInTheDocument();
      expect(within(table).getByText('Car 2')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Distance and energy bar chart comparing all vehicles in the fleet' })).toBeInTheDocument();
      expect(notice.parentElement).toContainElement(table);
    };
    assertRetained();
    fireEvent.click(within(screen.getByTestId('statistics-fleet-partial')).getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(mockMileage.mock.results.at(-1)?.value.refetch).not.toHaveBeenCalled();
    expect(mockStateSummary.mock.results.at(-1)?.value.refetch).not.toHaveBeenCalled();
    retry.mockClear();
    mockFleet.mockReturnValue(qr({ data, error: new Error('refresh failed'), isError: true, refetch: retry }));
    rerenderPage();
    assertRetained();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();

    mockFleet.mockReturnValue(qr({ data, isFetching: true, fetchStatus: 'fetching', refetch: retry }));
    rerenderPage();
    assertRetained();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('statistics-fleet-partial')).getByRole('button', { name: 'Refresh' })).toBeDisabled();

    mockFleet.mockReturnValue(qr({ data: { ...makeFleet(2), partial_result: { is_partial: false, reasons: [] } }, isSuccess: true }));
    rerenderPage();
    expect(screen.queryByTestId('statistics-fleet-partial')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Vehicle comparison — data table' })).toHaveTextContent('Car 2');
  });

  it('retains a partial notice when the producer supplies no reason list', async () => {
    mockFleet.mockReturnValue(qr({ data: { ...makeFleet(2), partial_result: { is_partial: true, reasons: null } } }));
    renderPage();
    await screen.findByText('500 km');
    expect(screen.getByTestId('statistics-fleet-partial')).toHaveTextContent('not treated as complete');
  });

  it('shows active chart loading without claiming successful empty results', async () => {
    mockStateSummary.mockReturnValue(qr({ isLoading: true, isPending: true, fetchStatus: 'fetching' }));
    mockFleet.mockReturnValue(qr({ isLoading: true, isPending: true, fetchStatus: 'fetching' }));
    renderPage();
    await screen.findByText('500 km');
    expect(document.querySelectorAll('[data-chart-state="loading"]')).toHaveLength(2);
    expect(screen.getAllByText('Loading chart…')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Export chart' })).not.toBeInTheDocument();
    expect(screen.queryByText('No state distribution data')).not.toBeInTheDocument();
    expect(screen.queryByText('Add more vehicles to compare')).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.queryByTestId('statistics-fleet-partial')).not.toBeInTheDocument();
  });

  it('explains paused first chart loads without claiming empty history or a vehicle outage', async () => {
    mockStateSummary.mockReturnValue(qr({ isLoading: true, isPending: true, fetchStatus: 'paused' }));
    mockFleet.mockReturnValue(qr({ isLoading: true, isPending: true, fetchStatus: 'paused' }));
    renderPage();
    await screen.findByText('500 km');
    expect(screen.getAllByText('Refresh paused')).toHaveLength(2);
    expect(screen.queryByTestId('statistics-state-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('statistics-fleet-loading')).not.toBeInTheDocument();
    expect(screen.queryByText('No state distribution data')).not.toBeInTheDocument();
    expect(screen.queryByText('Add more vehicles to compare')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it.each(['state', 'fleet'] as const)('threads independent %s source states into chart controls and retains exports on refresh', async (source) => {
    const mockSource = source === 'state' ? mockStateSummary : mockFleet;
    const title = source === 'state' ? 'State distribution' : 'Vehicle comparison';
    const otherTitle = source === 'state' ? 'Vehicle comparison' : 'State distribution';
    const data = source === 'state' ? makeStateSummary() : makeFleet(2);
    const emptyData = source === 'state' ? [] : makeFleet(1);
    const retry = vi.fn();
    mockSource.mockReturnValue(qr({
      isLoading: true, isPending: true, fetchStatus: 'fetching', refetch: retry,
    }));
    const { rerenderPage } = renderPage();
    await screen.findByText('500 km');

    const chart = (name: string) => {
      const figure = screen.getAllByText(name).map(element => element.closest('figure')).find(Boolean);
      expect(figure).not.toBeNull();
      return figure!;
    };
    const assertUnavailable = (phase: string) => {
      expect(chart(title)).toHaveAttribute('data-chart-state', phase);
      expect(within(chart(title)).queryByRole('button', { name: 'Export chart' })).not.toBeInTheDocument();
      expect(chart(otherTitle)).toHaveAttribute('data-chart-state', 'ready');
      expect(within(chart(otherTitle)).getByRole('button', { name: 'Export chart' })).toBeEnabled();
    };
    assertUnavailable('loading');

    mockSource.mockReturnValue(qr({ error: new Error(`${source} initial failure`), isError: true, refetch: retry }));
    rerenderPage();
    assertUnavailable('error');
    fireEvent.click(within(chart(title)).getByRole('button', { name: /retry|try again/i }));
    expect(retry).toHaveBeenCalledOnce();

    mockSource.mockReturnValue(qr({ data: emptyData, isSuccess: true }));
    rerenderPage();
    assertUnavailable('empty');

    for (const refresh of [
      { isFetching: true, fetchStatus: 'fetching' },
      { isError: true, error: new Error(`${source} refresh failure`) },
      { fetchStatus: 'paused' },
      { isSuccess: true },
    ]) {
      mockSource.mockReturnValue(qr({ data, refetch: retry, ...refresh }));
      rerenderPage();
      expect(chart(title)).toHaveAttribute('data-chart-state', 'ready');
      expect(within(chart(title)).getByRole('table', { name: `${title} — data table` })).toHaveTextContent(
        source === 'state' ? 'driving' : 'Car 2',
      );
      const exportButton = within(chart(title)).getByRole('button', { name: 'Export chart' });
      expect(exportButton).toBeEnabled();
      fireEvent.click(exportButton);
      expect(screen.getByText('Download data as CSV')).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
    }
  });

  it('distinguishes successful empty fleet results from measured zero comparison values', async () => {
    mockFleet.mockReturnValue(qr({ data: makeFleet(0), isSuccess: true }));
    const { rerenderPage } = renderPage();
    await screen.findByText('500 km');
    expect(screen.getByText('Add more vehicles to compare')).toBeInTheDocument();
    expect(screen.queryByTestId('statistics-fleet-partial')).not.toBeInTheDocument();

    const data = makeFleet(2);
    data.vehicle_comparison.forEach(vehicle => { vehicle.distance = 0; vehicle.energy = 0; });
    mockFleet.mockReturnValue(qr({ data, isSuccess: true }));
    rerenderPage();
    expect(screen.queryByText('Add more vehicles to compare')).not.toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Vehicle comparison — data table' });
    expect(within(table).getAllByText('0')).toHaveLength(4);
    expect(within(table).queryByText('—')).not.toBeInTheDocument();
  });

  it('keeps all three sections and both charts visible during independent retained refresh failures', async () => {
    mockStateSummary.mockReturnValue(qr({ data: makeStateSummary(), error: new Error('state refresh failed') }));
    mockFleet.mockReturnValue(qr({ data: makeFleet(2), error: new Error('fleet refresh failed') }));
    renderPage();
    await screen.findByText('500 km');

    expect(screen.getByRole('region', { name: 'Totals and averages' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Battery health and vehicle states' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mileage and fleet comparison' })).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Vehicle state distribution pie chart' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Distance and energy bar chart comparing all vehicles in the fleet' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Add more vehicles to compare')).not.toBeInTheDocument();
  });

  it('marks a paused retained state source without claiming the vehicle is offline and retries only that source', async () => {
    const retryState = vi.fn();
    const retryFleet = vi.fn();
    mockStateSummary.mockReturnValue(qr({ data: makeStateSummary(), fetchStatus: 'paused', refetch: retryState }));
    mockFleet.mockReturnValue(qr({ data: makeFleet(2), refetch: retryFleet }));
    renderPage();
    await screen.findByText('500 km');

    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    expect(within(warning).getByText('State distribution may be out of date')).toBeInTheDocument();
    expect(warning).not.toHaveTextContent(/offline/i);
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(retryState).toHaveBeenCalledOnce();
    expect(retryFleet).not.toHaveBeenCalled();
    expect(screen.getByText('92.00')).toBeInTheDocument();
  });

  it('keeps raw state identities and measured zero while leaving shares unknown when a duration is missing', async () => {
    mockStateSummary.mockReturnValue(qr({ data: [
      { state: 'driving', totalMin: 0, count: 1 },
      { state: 'charging', count: 1 },
    ] }));
    renderPage();
    await screen.findByText('500 km');

    const table = screen.getByRole('table', { name: 'State distribution — data table' });
    expect(within(table).getByText('driving')).toBeInTheDocument();
    expect(within(table).getByText('charging')).toBeInTheDocument();
    expect(within(table).getAllByText('—')).toHaveLength(2);
    expect(within(table).queryByText('0')).not.toBeInTheDocument();
  });

  it('preserves a measured zero share and every unknown state row in the accessible chart table', async () => {
    mockStateSummary.mockReturnValue(qr({ data: [
      { state: 'driving', totalMin: 0, count: 1 },
      { state: 'new_source_state', totalMin: 30, count: 1 },
    ] }));
    renderPage();
    await screen.findByText('500 km');

    const table = screen.getByRole('table', { name: 'State distribution — data table' });
    expect(within(table).getByText('0')).toBeInTheDocument();
    expect(within(table).getByText('100')).toBeInTheDocument();
    expect(within(table).getAllByText('new_source_state')).toHaveLength(2);
    expect(within(table).getByText('digitalTwin.statusLabel.driving')).toBeInTheDocument();
  });

  it('treats prototype property names as unknown state identities without dropping their measured shares', async () => {
    mockStateSummary.mockReturnValue(qr({ data: [
      { state: 'constructor', totalMin: 10, count: 1 },
      { state: 'toString', totalMin: 20, count: 1 },
      { state: '__proto__', totalMin: 70, count: 1 },
    ] }));
    renderPage();
    await screen.findByText('500 km');

    const table = screen.getByRole('table', { name: 'State distribution — data table' });
    for (const [state, share] of [['constructor', '10'], ['toString', '20'], ['__proto__', '70']]) {
      const row = within(table).getAllByRole('row').find(candidate => within(candidate).queryAllByText(state).length > 0);
      expect(row).toBeDefined();
      expect(within(row!).getAllByText(state)).toHaveLength(2);
      expect(within(row!).getByText(share)).toBeInTheDocument();
    }
  });

  it('preserves complete vehicle names and distinguishes missing comparison values from measured zero', async () => {
    const fleet = makeFleet(2);
    fleet.vehicle_comparison[0].name = 'A very long synthetic vehicle name retained in full';
    mockFleet.mockReturnValue(qr({ data: { vehicle_comparison: [
      { ...fleet.vehicle_comparison[0], distance: 0, energy: 0 },
      { ...fleet.vehicle_comparison[1], name: null, distance: null, energy: null },
    ] } }));
    renderPage();
    await screen.findByText('500 km');

    const table = screen.getByRole('table', { name: 'Vehicle comparison — data table' });
    expect(within(table).getByText('A very long synthetic vehicle name retained in full')).toBeInTheDocument();
    expect(within(table).getByText('Vehicle 2')).toBeInTheDocument();
    expect(within(table).getAllByText('0')).toHaveLength(2);
    expect(within(table).getAllByText('—')).toHaveLength(2);
  });

  it('forwards the period query abort signal and gives the page refresh a mobile-sized target', async () => {
    renderPage();
    await screen.findByText('500 km');

    const call = mockedRequest.mock.calls.find(args => args[0] === '/analytics/period-stats?vehicle_id=1');
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
    const refresh = screen.getAllByRole('button', { name: 'Refresh' }).find(el => el.tagName === 'BUTTON');
    expect(refresh).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-9');
  });

  it('reviews totals, kilometre cost denominators and mixed mileage windows without another request', async () => {
    renderPage();
    const totals = screen.getByTestId('statistics-totals-brief');
    await within(totals).findByText('500 km');
    expect(totals.querySelectorAll('[data-value-state="value"]')).toHaveLength(5);
    const averages = screen.getByTestId('statistics-averages-brief');
    expect(averages.querySelectorAll('[data-value-state="value"]')).toHaveLength(3);
    const mileage = screen.getByTestId('statistics-mileage-brief');
    expect(within(mileage).getByText('Mixed lifetime and last-30-day windows')).toBeInTheDocument();
    expect(within(mileage).getByText('Last 30 days divided by 30')).toBeInTheDocument();
    const calls = periodStatsCallCount();
    fireEvent.click(within(averages).getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Recorded cost divided by source kilometres; not display-distance units.')).toBeInTheDocument();
    expect(within(drawer).getByText('$0.50')).toBeInTheDocument();
    expect(periodStatsCallCount()).toBe(calls);
  });

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
    expect(within(totals).getByText('Total distance')).toBeInTheDocument();
    expect(await within(totals).findByText('500 km')).toBeInTheDocument();
    expect(within(totals).getByText('42')).toBeInTheDocument();
    expect(within(totals).getByText('100.00 kWh')).toBeInTheDocument();
    expect(within(totals).getByText('$250.00')).toBeInTheDocument();
    expect(within(totals).getByText('50.00 kg')).toBeInTheDocument();

    const averages = screen.getByRole('region', { name: 'Averages' });
    // 500 km / 42 drives = 11.90 km
    expect(within(averages).getByText('11.90 km')).toBeInTheDocument();
    expect(within(averages).getByText('160.00 Wh/km')).toBeInTheDocument();
    // 250 cost / 500 km = 0.50 at the selected two decimals.
    expect(within(averages).getByText('$0.50')).toBeInTheDocument();
  });

  it.each(['km', 'mi'] as const)('discloses the existing CO₂ estimate in the occurrence and details without recalculating mass in %s', async length => {
    unitState.length = length;
    renderPage();

    const totals = screen.getByTestId('statistics-totals-brief');
    await within(totals).findByText('50.00 kg');
    const co2 = totals.querySelector('[data-operational-metric="statistics-co2"]');
    expect(co2).toHaveTextContent('CO₂ saved');
    expect(co2).toHaveTextContent('Estimated CO₂ savings, not measured emissions.');
    expect(co2).toHaveTextContent('completed-drive distance in kilometres × 0.120 kg CO₂/km');
    expect(co2).toHaveTextContent('fixed ICE baseline and assuming zero EV emissions');
    expect(co2).toHaveTextContent('Grid emissions vary and are not deducted.');
    // The returned fixture is 50 kg, not 500 km × 0.120 = 60 kg.
    expect(within(totals).queryByText('60.00 kg')).not.toBeInTheDocument();
    const calls = periodStatsCallCount();
    fireEvent.click(within(totals).getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('50.00 kg')).toBeInTheDocument();
    expect(within(drawer).getByText('Estimated CO₂ savings, not measured emissions.')).toBeInTheDocument();
    expect(within(drawer).getByText(/Grid emissions vary and are not deducted/)).toBeInTheDocument();
    expect(within(drawer).getByText('Period statistics; CO₂ is a distance-based estimate with a fixed ICE baseline, excluding grid emissions.')).toBeInTheDocument();
    expect(periodStatsCallCount()).toBe(calls);
  });

  it('shows loading skeletons while the period-stats query is pending', async () => {
    periodStatsHandler = () => new Promise(() => {}); // never resolves

    renderPage();

    expect(screen.getByTestId('statistics-totals-brief')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('statistics-averages-brief')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('statistics-totals-brief').querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(screen.queryByText('No statistics yet')).not.toBeInTheDocument();
  });

  it.each([
    ['km', '160.00 Wh/km'],
    ['mi', '257.50 Wh/mi'],
  ] as const)('discloses the charging numerator and efficiency proxy without recomputing returned values in %s', async (length, efficiency) => {
    unitState.length = length;
    renderPage();

    const totals = screen.getByTestId('statistics-totals-brief');
    await within(totals).findByText('100.00 kWh');
    const energy = totals.querySelector('[data-operational-metric="statistics-total-energy"]');
    expect(energy).toHaveTextContent('Total energy');
    expect(energy).toHaveTextContent('Charging-session energy added, not measured drive energy used; numerator of the efficiency proxy.');

    const averages = screen.getByTestId('statistics-averages-brief');
    const proxy = averages.querySelector('[data-operational-metric="statistics-average-efficiency"]');
    expect(proxy).toHaveTextContent(efficiency);
    expect(proxy).toHaveTextContent('Charging-energy/distance proxy: charging-session energy added divided by completed-drive distance, not measured driving efficiency.');
    // The fixture intentionally returns 160 Wh/km, not 100 kWh / 500 km = 200 Wh/km.
    expect(within(averages).queryByText(length === 'km' ? '200.00 Wh/km' : '321.87 Wh/mi')).not.toBeInTheDocument();
    expect(within(averages).getByText('$0.50')).toBeInTheDocument();
  });

  it.each([undefined, null, NaN, Infinity, -Infinity, '12', false])(
    'does not turn absent or invalid period measurements (%s) into zero',
    async value => {
      periodStatsHandler = () => Promise.resolve(makeStats({
        total_distance: value, total_drives: value, energy_used: value,
        total_cost: value, co2_saved: value, avg_efficiency: value,
      }));
      renderPage();
      const totals = screen.getByTestId('statistics-totals-brief');
      const state = value == null ? 'missing' : 'invalid';
      await waitFor(() => expect(totals.querySelectorAll(`[data-value-state="${state}"]`)).toHaveLength(5));
      const averages = screen.getByTestId('statistics-averages-brief');
      expect(averages.querySelectorAll('[data-value-state="missing"]')).toHaveLength(state === 'missing' ? 3 : 2);
      expect(averages.querySelectorAll(`[data-value-state="${state}"]`)).toHaveLength(state === 'missing' ? 3 : 1);
      expect(within(averages).getAllByText('No measurement supplied')).toHaveLength(state === 'missing' ? 3 : 2);
    },
  );

  it.each([undefined, null, NaN, Infinity, -1, 0, 1.5, '2'])(
    'requires a known positive integer drive count (%s) for average distance',
    async total_drives => {
      periodStatsHandler = () => Promise.resolve(makeStats({ total_drives }));
      renderPage();
      const averages = screen.getByTestId('statistics-averages-brief');
      await waitFor(() => expect(within(averages).getByText('$0.50')).toBeInTheDocument());
      expect(averages.querySelectorAll('[data-value-state="missing"]')).toHaveLength(1);
      expect(within(averages).getByText('No measurement supplied')).toBeInTheDocument();
    },
  );

  it('preserves measured zero totals but withholds averages without denominators', async () => {
    periodStatsHandler = () => Promise.resolve(makeStats({
      total_distance: 0, total_drives: 0, energy_used: 0,
      total_cost: 0, co2_saved: 0, avg_efficiency: 0,
    }));
    renderPage();
    const totals = screen.getByTestId('statistics-totals-brief');
    await waitFor(() => expect(totals.querySelectorAll('[data-value-state="value"]')).toHaveLength(5));
    expect(within(totals).getByText('0 km')).toBeInTheDocument();
    expect(within(totals).getByText('$0.00')).toBeInTheDocument();
    const averages = screen.getByTestId('statistics-averages-brief');
    expect(averages.querySelectorAll('[data-value-state="missing"]')).toHaveLength(2);
    expect(within(averages).getByText('0.00 Wh/km')).toBeInTheDocument();
  });

  it('preserves zero average distance with positive count and zero cost/km with positive distance', async () => {
    periodStatsHandler = () => Promise.resolve(makeStats({ total_distance: 0, total_drives: 2 }));
    const { unmount } = renderPage();
    await screen.findByText('0.00 km');
    unmount();
    periodStatsHandler = () => Promise.resolve(makeStats({ total_distance: 0.5, total_cost: 0 }));
    renderPage();
    await waitFor(() => expect(within(screen.getByTestId('statistics-averages-brief')).getByText('$0.00')).toBeInTheDocument());
  });

  it('preserves signed fractional measurements and source-kilometre cost under imperial display', async () => {
    unitState.length = 'mi';
    periodStatsHandler = () => Promise.resolve(makeStats({
      total_distance: 0.5, total_drives: 2, energy_used: -0.25,
      total_cost: -0.125, co2_saved: -0.5, avg_efficiency: -10.5,
    }));
    renderPage();
    const totals = screen.getByTestId('statistics-totals-brief');
    await within(totals).findByText('-0.25 kWh');
    expect(within(totals).getByText('-0.50 kg')).toBeInTheDocument();
    const averages = screen.getByTestId('statistics-averages-brief');
    expect(within(averages).getByText('0.16 mi')).toBeInTheDocument();
    expect(within(averages).getByText('-16.90 Wh/mi')).toBeInTheDocument();
    expect(within(averages).getByText('$-0.25')).toBeInTheDocument();
  });

  it.each([undefined, null, NaN, Infinity, -Infinity, '500'])(
    'requires known distance (%s) for both distance and cost averages',
    async total_distance => {
      periodStatsHandler = () => Promise.resolve(makeStats({ total_distance }));
      renderPage();
      const averages = screen.getByTestId('statistics-averages-brief');
      await within(averages).findByText('160.00 Wh/km');
      expect(averages.querySelectorAll('[data-value-state="missing"]')).toHaveLength(2);
    },
  );

  it('retains signed distance but requires positive distance for cost/km', async () => {
    periodStatsHandler = () => Promise.resolve(makeStats({ total_distance: -0.5, total_drives: 2 }));
    renderPage();
    const averages = screen.getByTestId('statistics-averages-brief');
    await within(averages).findByText('-0.25 km');
    expect(averages.querySelectorAll('[data-value-state="missing"]')).toHaveLength(1);
  });

  it.each([undefined, null, NaN, Infinity, '0', false])(
    'withholds cost/km when cost is not a known measurement (%s)',
    async total_cost => {
      periodStatsHandler = () => Promise.resolve(makeStats({ total_cost }));
      renderPage();
      const averages = screen.getByTestId('statistics-averages-brief');
      await within(averages).findByText('11.90 km');
      expect(averages.querySelectorAll('[data-value-state="missing"]')).toHaveLength(1);
      expect(within(averages).getByText('No measurement supplied')).toBeInTheDocument();
    },
  );

  it('surfaces a retry-able error when the period-stats request fails', async () => {
    periodStatsHandler = () => Promise.reject(new Error('period stats down'));

    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Statistics' }).querySelectorAll('[data-value-state="missing"]')).toHaveLength(5);
  });

  it('re-fetches the period stats when the error retry button is clicked', async () => {
    periodStatsHandler = () => Promise.reject(new Error('boom'));

    renderPage();

    await screen.findByRole('button', { name: 'Retry' });
    const before = periodStatsCallCount();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(periodStatsCallCount()).toBeGreaterThan(before));
  });

  it('shows a guided empty state when period stats resolve empty', async () => {
    periodStatsHandler = () => Promise.resolve(null);

    renderPage();

    expect(await screen.findByText('No statistics yet')).toBeInTheDocument();
    expect(
      screen.getByText(/no completed driving or charging history/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Complete a drive or charging session/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View drives' })).toHaveAttribute('href', '/drives');
    expect(screen.getByRole('region', { name: 'Statistics' }).querySelectorAll('[data-value-state="missing"]')).toHaveLength(5);
  });

  it('renders the battery-health gauge and its stat cards on the happy path', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    expect(screen.getByText('Health')).toBeInTheDocument();
    expect(screen.getByText('92.00')).toBeInTheDocument();
    expect(screen.getByText('Capacity')).toBeInTheDocument();
    expect(screen.getByText('71.50 kWh')).toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText('30.00 months')).toBeInTheDocument();
  });

  it.each([
    [0, '0.00 months'],
    [1, '1.00 month'],
    [1.5, '1.50 months'],
    [1234.5, '1,234.50 months'],
  ])('formats source calendar months (%s) with numeric formatting and plural selection', async (age, expected) => {
    const battery = Object.freeze(makeBattery({ battery_age_months: age }));
    mockBattery.mockReturnValue(qr({ data: battery }));
    renderPage();
    const brief = screen.getByTestId('statistics-battery-brief');
    expect(within(brief).getByText(expected)).toBeInTheDocument();
    expect(battery.battery_age_months).toBe(age);
  });

  it.each([
    ['2026-03-01T07:59:59Z', '2026-02-28T23:59:59-08:00'],
    ['2026-03-01T08:00:00Z', '2026-03-01T00:00:00-08:00'],
    ['2026-03-01T08:00:00Z', 'invalid-date'],
    ['2026-03-01T08:00:00Z', null],
    ['2026-03-01T08:00:00Z', undefined],
  ])('keeps calendar-month age with saved locale/timezone at %s and source date %s', async (now, date) => {
    displayState.locale = 'fr-FR';
    displayState.timezone = 'America/Los_Angeles';
    displayState.language = 'fr';
    setGlobalLocale(displayState.locale);
    vi.setSystemTime(new Date(now));
    try {
      mockBattery.mockReturnValue(qr({ data: makeBattery({ battery_age_months: 1234.5 }) }));
      mockMileage.mockReturnValue(qr({ data: makeMileage({ first_drive_at: date, last_drive_at: date }) }));
      renderPage();
      expect(within(screen.getByTestId('statistics-battery-brief')).getByText(/1\s234,50 mois/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([undefined, null, NaN, Infinity, -Infinity, '30'])(
    'does not invent calendar-month age from missing or invalid age (%s)',
    async battery_age_months => {
      mockBattery.mockReturnValue(qr({ data: makeBattery({ battery_age_months }) }));
      renderPage();
      const age = screen.getByTestId('statistics-battery-brief')
        .querySelector('[data-operational-metric="statistics-battery-age"]');
      expect(age).toHaveAttribute('data-value-state', battery_age_months == null ? 'missing' : 'invalid');
      expect(age).not.toHaveTextContent('0.00 months');
      expect(age).not.toHaveTextContent('NaN');
      expect(age).not.toHaveTextContent('Infinity');
    },
  );

  it.each([undefined, null, NaN, Infinity, -Infinity, '92'])(
    'does not present missing or invalid health (%s) as measured zero',
    async current_soh => {
      const battery = Object.freeze(makeBattery({ current_soh }));
      mockBattery.mockReturnValue(qr({ data: battery }));
      renderPage();
      await screen.findByRole('region', { name: 'Statistics' });
      const health = screen.getByRole('group', { name: 'Health' });
      expect(within(health).getByText('—')).toBeInTheDocument();
      expect(health).not.toHaveAttribute('aria-valuenow');
      expect(screen.getByTestId('statistics-battery-brief')).toBeInTheDocument();
      expect(screen.getByText('71.50 kWh')).toBeInTheDocument();
      expect(battery.current_soh).toBe(current_soh);
    },
  );

  it.each([
    { current_soh: 0, estimated_capacity_wh: 0, original_capacity_wh: 75_000, history: [], prediction: { has_enough_data: false } },
    { current_soh: 0, estimated_capacity_wh: 0, history: [{ soh_pct: NaN, capacity_wh: 0 }], prediction: { has_enough_data: false } },
    { current_soh: 0, estimated_capacity_wh: 71_500, original_capacity_wh: null, history: [], prediction: { has_enough_data: false } },
    { current_soh: 92, estimated_capacity_wh: NaN, original_capacity_wh: 75_000, history: [], prediction: null },
    { current_soh: 0, current_soh_available: false },
  ])('keeps unsupported health unknown without hiding other metrics: %j', async overrides => {
    mockBattery.mockReturnValue(qr({ data: makeBattery(overrides) }));
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(within(screen.getByRole('group', { name: 'Health' })).getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('meter', { name: 'Health' })).not.toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByTestId('statistics-battery-brief')).toBeInTheDocument();
  });

  it.each([
    {},
    { estimated_capacity_wh: 0, history: [{ soh_pct: 0, capacity_wh: 0 }] },
    { estimated_capacity_wh: 0, prediction: { has_enough_data: true } },
    { estimated_capacity_wh: 0, current_soh_available: true },
  ])('preserves measured zero health with source evidence: %j', async evidence => {
    mockBattery.mockReturnValue(qr({ data: makeBattery({
      current_soh: 0, degradation_rate_pct_per_year: 0, total_cycles: 0, battery_age_months: 0, ...evidence,
    }) }));
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByRole('meter', { name: 'Health' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByTestId('statistics-battery-brief').querySelectorAll('[data-value-state="missing"]')).toHaveLength(0);
    expect(screen.getByText('0.00 months')).toBeInTheDocument();
  });

  it.each([92.34, -2.34, 102.34])('preserves fractional and signed health %s without rounding or clamping its reading', async current_soh => {
    mockBattery.mockReturnValue(qr({ data: makeBattery({ current_soh, degradation_rate_pct_per_year: -1.25, battery_age_months: 2.5 }) }));
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    const health = screen.getByRole(current_soh >= 0 && current_soh <= 100 ? 'meter' : 'group', { name: 'Health' });
    expect(within(health).getByText(current_soh.toFixed(2))).toBeInTheDocument();
    expect(screen.getByText('-1.25 %/yr')).toBeInTheDocument();
    expect(screen.getByText('2.50 months')).toBeInTheDocument();
  });

  it('retains unknown health and measured neighbors during failed battery refresh', async () => {
    const refetch = vi.fn();
    mockBattery.mockReturnValue(qr({ data: makeBattery({ current_soh: null }), error: new Error('refresh failed'), refetch }));
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(within(screen.getByRole('group', { name: 'Health' })).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('71.50 kWh')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('renders battery empty and error placeholders without blanking the panel', async () => {
    mockBattery.mockReturnValue(qr({ data: undefined }));
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByText('No battery health data available')).toBeInTheDocument();
    expect(screen.getByTestId('statistics-battery-brief').querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    unmount();

    mockBattery.mockReturnValue(qr({ error: new Error('battery down') }));
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('statistics-battery-brief').querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
  });

  it('renders the mileage summary cards on the happy path', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByText('Daily average')).toBeInTheDocument();
    expect(screen.getByText('Yearly projection')).toBeInTheDocument();
    expect(screen.getByText('8,000 km')).toBeInTheDocument();
  });

  it('distinguishes active mileage loading, paused first load, successful empty and measured zero', async () => {
    const retryMileage = vi.fn();
    const retryBattery = vi.fn();
    mockBattery.mockReturnValue(qr({ data: makeBattery(), refetch: retryBattery }));
    mockMileage.mockReturnValue(qr({ isLoading: true, isPending: true, fetchStatus: 'fetching' }));
    const { rerenderPage } = renderPage();
    await screen.findByText('500 km');
    expect(within(screen.getByTestId('statistics-mileage-brief')).getByText('Loading statistics')).toBeInTheDocument();
    expect(screen.queryByText('No mileage data available')).not.toBeInTheDocument();

    mockMileage.mockReturnValue(qr({ isPending: true, fetchStatus: 'paused', refetch: retryMileage }));
    rerenderPage();
    expect(within(screen.getByTestId('statistics-mileage-brief')).getByText('Refresh paused')).toBeInTheDocument();
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Refresh paused');
    expect(notice).not.toHaveTextContent(/offline/i);
    expect(screen.queryByText('No mileage data available')).not.toBeInTheDocument();
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry unavailable sources: Mileage summary' }));
    expect(retryMileage).toHaveBeenCalledOnce();
    expect(retryBattery).not.toHaveBeenCalled();

    mockMileage.mockReturnValue(qr({ data: null, isSuccess: true, fetchStatus: 'idle' }));
    rerenderPage();
    expect(screen.getByText('No mileage data available')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    mockMileage.mockReturnValue(qr({ data: makeMileage({ lifetime_km: 0, last_30d_km: 0, drive_count_lifetime: 0 }), isSuccess: true }));
    rerenderPage();
    const brief = screen.getByTestId('statistics-mileage-brief');
    expect(within(brief).getAllByText('0 km')).toHaveLength(2);
    expect(within(brief).getByText('0.00 km')).toBeInTheDocument();
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(0);
    expect(screen.queryByText('No mileage data available')).not.toBeInTheDocument();
  });

  it('retains mileage through refresh progress, failure and pause, retries only mileage and recovers', async () => {
    const retryMileage = vi.fn();
    const retryFleet = vi.fn();
    mockFleet.mockReturnValue(qr({ data: makeFleet(2), refetch: retryFleet }));
    mockMileage.mockReturnValue(qr({ data: makeMileage(), isFetching: true, fetchStatus: 'fetching', refetch: retryMileage }));
    const { rerenderPage } = renderPage();
    await screen.findByText('500 km');
    expect(within(screen.getByTestId('statistics-mileage-brief')).getByText('Refreshing')).toBeInTheDocument();
    expect(screen.getByText('8,000 km')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();

    mockMileage.mockReturnValue(qr({ data: makeMileage(), error: new Error('mileage refresh failed'), refetch: retryMileage }));
    rerenderPage();
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveTextContent('Mileage summary may be out of date');
    expect(screen.getByText('8,000 km')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(retryMileage).toHaveBeenCalledOnce();
    expect(retryFleet).not.toHaveBeenCalled();

    mockMileage.mockReturnValue(qr({ data: makeMileage(), fetchStatus: 'paused', refetch: retryMileage }));
    rerenderPage();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByTestId('stale-refresh-warning')).not.toHaveTextContent(/offline/i);
    expect(screen.getByText('8,000 km')).toBeInTheDocument();

    mockMileage.mockReturnValue(qr({ data: makeMileage({ lifetime_km: 9000 }), isSuccess: true, refetch: retryMileage }));
    rerenderPage();
    expect(screen.getByText('9,000 km')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('92.00')).toBeInTheDocument();
  });

  it('renders mileage empty and error placeholders without blanking the panel', async () => {
    mockMileage.mockReturnValue(qr({ data: undefined }));
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByText('No mileage data available')).toBeInTheDocument();
    expect(screen.getByTestId('statistics-mileage-brief').querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    unmount();

    mockMileage.mockReturnValue(qr({ error: new Error('mileage down') }));
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('statistics-mileage-brief').querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
  });

  it('renders the state-distribution chart figure when data is present', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });

    expect(
      screen.getByRole('heading', { level: 3, name: 'State distribution' }),
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
      screen.getByRole('heading', { level: 3, name: 'Vehicle comparison' }),
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

  it.each(['2025-03-15', '2025-03-16'])('passes calendar instants through the fleet request and key with exclusive end %s', async (endDate) => {
    const actual = await vi.importActual<typeof import('@/api/hooks/useAnalytics')>('@/api/hooks/useAnalytics');
    mockFleet.mockImplementation(actual.useFleetAnalytics);
    mockedRequest.mockImplementation((path: string) => Promise.resolve(
      path.startsWith('/analytics/fleet') ? makeFleet(2) : makeStats(),
    ));
    const { startInstant, endInstantExclusive } = calendarRangeToInstants({
      startDate: '2025-03-01',
      endDate,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const { client } = renderPage([`/statistics?from=2025-03-01&to=${endDate}`]);
    await screen.findByRole('region', { name: 'Statistics' });

    const params = new URLSearchParams({ start: startInstant, end: endInstantExclusive });
    await waitFor(() => expect(issuedPaths()).toContain(`/analytics/fleet?${params}`));
    expect(mockFleet).toHaveBeenCalledWith({ start: startInstant, end: endInstantExclusive });
    await waitFor(() => expect(client.getQueryData(
      actual.analyticsKeys.fleet(undefined, startInstant, endInstantExclusive),
    )).toEqual(makeFleet(2)));
    expect(screen.getByRole('group', {
      name: 'Distance and energy bar chart comparing all vehicles in the fleet',
    })).toBeInTheDocument();
  });

  it('preserves precise rolling 24-hour bounds in the fleet request and key', async () => {
    const actual = await vi.importActual<typeof import('@/api/hooks/useAnalytics')>('@/api/hooks/useAnalytics');
    mockFleet.mockImplementation(actual.useFleetAnalytics);
    mockedRequest.mockImplementation((path: string) => Promise.resolve(
      path.startsWith('/analytics/fleet') ? makeFleet(2) : makeStats(),
    ));
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-14T17:45:46.022Z'));
    try {
      const start = '2026-10-13T17:45:46.022Z';
      const end = '2026-10-14T17:45:46.022Z';
      const { client } = renderPage(['/statistics?time_scope=24h']);
      const params = new URLSearchParams({ start, end });
      await waitFor(() => expect(issuedPaths()).toContain(`/analytics/fleet?${params}`));
      expect(mockFleet).toHaveBeenCalledWith({ start, end });
      await waitFor(() => expect(client.getQueryData(
        actual.analyticsKeys.fleet(undefined, start, end),
      )).toEqual(makeFleet(2)));
    } finally {
      now.mockRestore();
    }
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

  it('keeps vehicle selection in the shared header for empty and populated fleets', async () => {
    mockSelectedVehicle.mockReturnValue({
      vehicleId: null,
      vehicle: null,
      vehicles: [],
      setVehicleId: vi.fn(),
    });
    const { unmount } = renderPage();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    unmount();

    installHappyPath();
    renderPage();
    expect(screen.queryByRole('combobox', { name: 'Select Vehicle' })).not.toBeInTheDocument();
    expect(mockSelectedVehicle).toHaveBeenCalled();
  });

  it('consumes the selected vehicle from the shared context without a local picker', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Statistics' });
    expect(mockSelectedVehicle).toHaveBeenCalled();
    expect(screen.queryByRole('combobox', { name: 'Select Vehicle' })).not.toBeInTheDocument();
    expect(setVehicleIdSpy).not.toHaveBeenCalled();
  });

  it('converts distance and efficiency to imperial units when preferred', async () => {
    unitState.length = 'mi';
    renderPage();

    const totals = await screen.findByRole('region', { name: 'Statistics' });
    // 500 km → 310.69 mi → fmtInt → 311 mi
    expect(await within(totals).findByText('311 mi')).toBeInTheDocument();

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
      screen.getByRole('group', {
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
    expect(screen.queryByRole('combobox', { name: 'Select Vehicle' })).not.toBeInTheDocument();
  });
});
