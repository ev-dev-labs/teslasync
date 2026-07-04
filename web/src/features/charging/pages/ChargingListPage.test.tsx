/**
 * ChargingListPage contract + hardening tests.
 *
 * ChargingListPage is a data-dense list shell: it reads a wide window of
 * charging sessions (`useChargingSessionsPaginated`) plus an optimizer feed
 * (`useChargingOptimizer`), then derives period stats, anomaly flags, notable
 * sessions, collection counts, a daily trend, and a paginated + date-grouped
 * list from them. The three data hooks and `useSelectedVehicle` are mocked at
 * the hook boundary so every branch — no-vehicle, loading, error, empty, and
 * the fully-populated happy path — is exercised deterministically. The heavy
 * chart/panel children (`MetricSwitcherChart`, the five `charging-list` panels,
 * and each `ChargingSessionCard`) are stubbed with prop-capturing markers so the
 * assertions target THE PAGE'S own orchestration (branch selection, threshold
 * gating, bulk-selection wiring, and the SI→display distance conversion) rather
 * than recharts/leaflet internals, which render nothing meaningful in jsdom.
 *
 * The display hooks (`useUnits`/`useFormatting` → `useSettings`) render for real
 * with a mutable unit preference so the SI→display distance conversion at the
 * render boundary is exercised for BOTH metric (km) and imperial (mi). The
 * `toDistanceDisplay` callback captured off a card carries a regression guard
 * for the fixed 1000× unit bug: it now scales km→metres before feeding the SI
 * converter, so a 50 km charge reads "50 km" / "31 mi", not "0.05 km".
 *
 * Network never touches the real backend — the charging hooks are stubbed and
 * `@/api/client`'s `request` seam is neutralised so no stray query (VehicleSelect,
 * SavedViewMenu) can fire.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options object so assertions can target the rendered English copy. A bare
// key with no fallback echoes the key.
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

// Mutable unit preference so one file exercises both the metric (km) and
// imperial (mi) display-conversion branches. Hoisted so the settings mock
// factory can close over it.
const unitState = vi.hoisted(() => ({ length: 'km' as 'km' | 'mi' }));

// File-level useSettings mock (overrides the global test-setup stub) so
// `useUnits`/`useFormatting` see a stable shape while `unit_of_length` flips.
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

// Network kill-switch: neutralise the shared fetch seam so any peripheral query
// (VehicleSelect's fleet list, SavedViewMenu's saved views) stays benignly
// pending instead of hitting the real backend. `isApiError` etc. stay real.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn(() => new Promise(() => {})) };
});

// The three charging data hooks are replaced with controllable vi.fns.
vi.mock('@/api/hooks/useCharging', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useCharging')>();
  return {
    ...actual,
    useChargingSessionsPaginated: vi.fn(),
    useChargingOptimizer: vi.fn(),
    useBulkDeleteCharging: vi.fn(),
  };
});

vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// Prop-capturing stub for each rendered session card. Records the page's real
// `toDistanceDisplay` callback + `distanceUnit`, renders an anomaly marker when
// flagged, and a keyboard-operable toggle that drives bulk-selection wiring.
const captured = vi.hoisted(() => ({
  toDistanceDisplay: null as null | ((km: number) => number),
  distanceUnit: '' as string,
}));

vi.mock('../components/ChargingSessionCard', () => ({
  ChargingSessionCard: (props: any) => {
    captured.toDistanceDisplay = props.toDistanceDisplay;
    captured.distanceUnit = props.distanceUnit;
    return (
      <div data-testid={`session-card-${props.session.id}`}>
        <span>{`session ${props.session.id}`}</span>
        {props.anomaly ? (
          <span data-testid={`anomaly-${props.session.id}`}>{props.anomaly.message}</span>
        ) : null}
        <button
          type="button"
          aria-label={`toggle ${props.session.id}`}
          onClick={() => props.onToggleSelect?.(props.session.id, !props.selected)}
        >
          {props.selected ? 'selected' : 'select'}
        </button>
      </div>
    );
  },
}));

// Stub the five analytical panels (they mount recharts) but keep the pure
// compute* helpers real so the page's threshold gating runs against genuine data.
vi.mock('../components/charging-list', async (importActual) => {
  const actual = await importActual<typeof import('../components/charging-list')>();
  const stub = (testId: string) => () => <div data-testid={testId} />;
  return {
    ...actual,
    AcDcStatsPanel: stub('acdc-panel'),
    BatteryLevelChart: stub('battery-dist-panel'),
    EfficiencyPanel: stub('efficiency-panel'),
    ChargerSpecsPanel: stub('specs-panel'),
    OptimizerSection: stub('optimizer-panel'),
  };
});

// Stub the trend chart (recharts) — echo its title + testId so the trend branch
// can be asserted without mounting a chart.
vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  return {
    ...actual,
    MetricSwitcherChart: (props: any) => (
      <div data-testid={props.testId}>{props.title}</div>
    ),
  };
});

// PageHeaderSticky is scroll-driven: it stays `null` until an IntersectionObserver
// reports the anchor has scrolled off-screen — impossible to trigger in jsdom, and
// the global IO mock's synthetic entry lacks `boundingClientRect`, which crashes
// its callback. Stub it to a passthrough that always renders the summary inside
// the same labelled region so the sticky content stays assertable.
vi.mock('@/components/layout/PageHeaderSticky', () => ({
  PageHeaderSticky: ({ children, ariaLabel, testId }: any) => (
    <div role="region" aria-label={ariaLabel} data-testid={testId}>
      {children}
    </div>
  ),
}));

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

import { ToastProvider } from '@/components/feedback/Toast';
import ChargingListPage, { formatHour } from './ChargingListPage';
import { useChargingSessionsPaginated, useChargingOptimizer, useBulkDeleteCharging } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import type { ChargingSession } from '@/api/types';

const mockSessions = vi.mocked(useChargingSessionsPaginated);
const mockOptimizer = vi.mocked(useChargingOptimizer);
const mockBulkDelete = vi.mocked(useBulkDeleteCharging);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    isStale: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeSession(over: Partial<ChargingSession> = {}): ChargingSession {
  const started = over.started_at ?? '2024-06-15T10:00:00Z';
  return {
    id: 1,
    vehicle_id: 1,
    started_at: started,
    ended_at: '2024-06-15T11:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: 100_000,
    end_odometer_m: 150_000,
    start_lat: 37.5,
    start_lng: -122.4,
    start_place: 'Home',
    total_energy_added_wh: 30_000,
    peak_power_w: 11_000,
    avg_power_w: 6_000,
    cost_decimal: 4.5,
    cost_currency: 'USD',
    charger_type: 'Home',
    cable_type: 'Type2',
    startedAt: started,
    duration_min: 60,
    ...over,
  };
}

// Six hand-crafted sessions with known categories (home×2, supercharger×2,
// dc×2), one free-to-charge home session, and one telemetry-gap anomaly (0 kWh
// over an hour). Wide date span so any "now" passes the date filter with the
// 2000→2100 URL window.
const SESSIONS: ChargingSession[] = [
  makeSession({ id: 1, charger_type: 'Home', total_energy_added_wh: 30_000, cost_decimal: 4.5, start_soc_pct: 20, end_soc_pct: 80, peak_power_w: 11_000, avg_power_w: 6_000, started_at: '2024-06-15T06:00:00Z', ended_at: '2024-06-15T11:00:00Z', start_place: 'Home Garage', cable_type: 'Type2' }),
  makeSession({ id: 2, charger_type: 'Supercharger', total_energy_added_wh: 40_000, cost_decimal: 15, start_soc_pct: 10, end_soc_pct: 70, peak_power_w: 150_000, avg_power_w: 80_000, started_at: '2024-06-14T12:00:00Z', ended_at: '2024-06-14T12:30:00Z', start_place: 'SC Downtown', cable_type: 'Tesla' }),
  makeSession({ id: 3, charger_type: 'CCS', total_energy_added_wh: 25_000, cost_decimal: 8, start_soc_pct: 30, end_soc_pct: 75, peak_power_w: 50_000, avg_power_w: 33_000, started_at: '2024-06-13T09:00:00Z', ended_at: '2024-06-13T09:45:00Z', start_place: 'EVgo', cable_type: 'CCS' }),
  makeSession({ id: 4, charger_type: 'Home', total_energy_added_wh: 20_000, cost_decimal: 0, start_soc_pct: 40, end_soc_pct: 85, peak_power_w: 7_000, avg_power_w: 6_500, started_at: '2024-06-12T22:00:00Z', ended_at: '2024-06-13T02:00:00Z', start_place: 'Home Garage', cable_type: 'Type2' }),
  makeSession({ id: 5, charger_type: 'Supercharger', total_energy_added_wh: 35_000, cost_decimal: 12, start_soc_pct: 15, end_soc_pct: 65, peak_power_w: 120_000, avg_power_w: 70_000, started_at: '2024-06-11T13:00:00Z', ended_at: '2024-06-11T13:40:00Z', start_place: 'SC Mall', cable_type: 'Tesla' }),
  makeSession({ id: 6, charger_type: 'CCS', total_energy_added_wh: 0, cost_decimal: 0, start_soc_pct: 50, end_soc_pct: 50, peak_power_w: null, avg_power_w: null, started_at: '2024-06-10T10:00:00Z', ended_at: '2024-06-10T11:00:00Z', start_place: 'Broken Charger', cable_type: null, end_odometer_m: 100_000 }),
];

function installHappyPath() {
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 1,
    vehicle: null,
    vehicles: [{ id: 1, display_name: 'Model 3', vin: 'VIN1' }] as any,
    setVehicleId: vi.fn(),
  });
  mockSessions.mockReturnValue(qr({ data: SESSIONS }));
  mockOptimizer.mockReturnValue(qr({ data: {} }));
  mockBulkDelete.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  } as any);
}

function renderPage(entries: string[] = ['/charging?from=2000-01-01&to=2100-01-01']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ChargingListPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  unitState.length = 'km';
  captured.toDistanceDisplay = null;
  captured.distanceUnit = '';
  installHappyPath();
});

/* ─────────────────────────── Pure helper unit tests ─────────────────────── */

describe('formatHour', () => {
  it('formats the midnight and noon boundaries as 12 AM / 12 PM', () => {
    expect(formatHour(0)).toBe('12 AM');
    expect(formatHour(12)).toBe('12 PM');
  });

  it('formats morning hours as AM and afternoon/evening hours as 12-hour PM', () => {
    expect(formatHour(1)).toBe('1 AM');
    expect(formatHour(9)).toBe('9 AM');
    expect(formatHour(13)).toBe('1 PM');
    expect(formatHour(15)).toBe('3 PM');
    expect(formatHour(23)).toBe('11 PM');
  });
});

/* ─────────────────────────────── Component tests ─────────────────────────── */

describe('ChargingListPage — happy path', () => {
  it('renders the shell, overview KPIs, trend chart, gated insight panels and every session card', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Charging Sessions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Cost, charger type, energy patterns, and battery-friendly scoring'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Charging Sessions');

    // Overview KPI band (unique MetricCard labels).
    expect(screen.getByText('Energy (kWh)')).toBeInTheDocument();
    expect(screen.getByText('Avg rate (kW)')).toBeInTheDocument();

    // Trend chart branch fired (currentStats.count > 0).
    expect(screen.getByTestId('charging-trend-chart')).toBeInTheDocument();

    // Threshold-gated insight panels: 6 sessions clears AC/DC(1), battery(5),
    // efficiency, and specs(5) — but NOT the optimizer(10).
    expect(screen.getByTestId('acdc-panel')).toBeInTheDocument();
    expect(screen.getByTestId('battery-dist-panel')).toBeInTheDocument();
    expect(screen.getByTestId('efficiency-panel')).toBeInTheDocument();
    expect(screen.getByTestId('specs-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('optimizer-panel')).not.toBeInTheDocument();

    // Every session card in the window renders.
    expect(screen.getByTestId('session-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('session-card-6')).toBeInTheDocument();
  });

  it('shows charger-category collection pills and the by-type secondary summary', async () => {
    renderPage();
    expect(await screen.findByText('Supercharger')).toBeInTheDocument();
    expect(screen.getByText('Anomalies')).toBeInTheDocument();
    // 2 home (s1,s4) · 2 supercharger (s2,s5) · 2 dc / CCS (s3,s6).
    expect(screen.getByText('2 home · 2 SC · 2 DC')).toBeInTheDocument();
  });

  it('surfaces the anomaly callout and flags the anomalous session card', async () => {
    renderPage();
    // s6 = 0 kWh over an hour ⇒ one telemetry-gap anomaly.
    expect(await screen.findByText('1 anomaly in this range')).toBeInTheDocument();
    expect(screen.getByTestId('anomaly-6')).toBeInTheDocument();
    expect(screen.queryByTestId('anomaly-1')).not.toBeInTheDocument();
  });

  it('exposes labelled landmark regions and an accessible name on the icon-only card toggle', async () => {
    renderPage();
    expect(await screen.findByRole('region', { name: 'Charging summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'All charging sessions' })).toBeInTheDocument();
    expect(screen.getByLabelText('toggle 1')).toBeInTheDocument();
  });
});

describe('ChargingListPage — bulk selection', () => {
  it('toggles a session into and out of the bulk selection when its checkbox is clicked', async () => {
    renderPage();
    const toggle = await screen.findByLabelText('toggle 1');
    expect(toggle).toHaveTextContent('select');

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByLabelText('toggle 1')).toHaveTextContent('selected'),
    );

    fireEvent.click(screen.getByLabelText('toggle 1'));
    await waitFor(() =>
      expect(screen.getByLabelText('toggle 1')).toHaveTextContent('select'),
    );
  });
});

describe('ChargingListPage — distance conversion (SI regression guard)', () => {
  it('converts km→display via metres so a 50 km charge reads 50 km, not 0.05 km', async () => {
    renderPage();
    await screen.findByTestId('session-card-1');
    expect(captured.toDistanceDisplay).toBeTypeOf('function');
    // Regression: the old code fed km straight into convertDistanceFromSI
    // (which expects metres), producing 0.05. The fix scales km→m first.
    expect(captured.toDistanceDisplay!(50)).toBe(50);
    expect(captured.toDistanceDisplay!(0)).toBe(0);
    expect(captured.distanceUnit).toBe('km');
  });

  it('converts km→miles at the display boundary when the unit preference is imperial', async () => {
    unitState.length = 'mi';
    renderPage();
    await screen.findByTestId('session-card-1');
    // 50 km ⇒ 50_000 m / 1609.344 ≈ 31.07 mi.
    expect(captured.toDistanceDisplay!(50)).toBeCloseTo(31.07, 1);
    expect(captured.distanceUnit).toBe('mi');
  });
});

describe('ChargingListPage — non-happy states', () => {
  it('renders both the range and list empty states when there are no sessions', async () => {
    mockSessions.mockReturnValue(qr({ data: [] }));
    renderPage();

    expect(
      await screen.findByText('No charging sessions in this range'),
    ).toBeInTheDocument();
    expect(screen.getByText('No charging sessions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
    // No trend chart, no session cards, no insight panels when the window is empty.
    expect(screen.queryByTestId('charging-trend-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-card-1')).not.toBeInTheDocument();
  });

  it('renders loading skeletons and no session cards while the query is pending', () => {
    mockSessions.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderPage();

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('session-card-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('charging-trend-chart')).not.toBeInTheDocument();
  });

  it('surfaces a retryable error banner and refetches when Retry is pressed', async () => {
    const refetch = vi.fn();
    mockSessions.mockReturnValue(
      qr({ error: new Error('boom'), isError: true, refetch }),
    );
    renderPage();

    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it('shows the no-vehicle prompt and hides all data sections when no vehicle is selected', async () => {
    mockSelectedVehicle.mockReturnValue({
      vehicleId: null,
      vehicle: null,
      vehicles: [] as any,
      setVehicleId: vi.fn(),
    });
    renderPage();

    expect(await screen.findByText('No vehicle selected')).toBeInTheDocument();
    expect(
      screen.getByText('Add a vehicle to your fleet to see data on this page.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Charging Sessions' }),
    ).toBeInTheDocument();
    // The data scaffolding must not render on the null-vehicle guard path.
    expect(screen.queryByText('Energy (kWh)')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-card-1')).not.toBeInTheDocument();
  });
});
