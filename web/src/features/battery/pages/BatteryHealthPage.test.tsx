/**
 * BatteryHealthPage — comprehensive unit + integration coverage.
 *
 * This file exercises every export of BatteryHealthPage.tsx:
 *   - the default page component (all render states + branches + interactions), and
 *   - the pure helpers it now exports for testability: gaugeColor, healthVariant,
 *     healthLabel, degradationColor, buildInsights, buildRecommendations,
 *     computeEnergyBreakdown.
 *
 * Strategy (mirrors the repo convention in VehicleCostPage.test.tsx):
 *   - All data hooks (useEnergy / useCharging / useVehicles), the vehicle
 *     selector and the alert context are mocked with hoisted vi.fn()s so the
 *     network is never touched and each render is deterministic.
 *   - react-i18next is mocked to resolve the developer fallback string and
 *     interpolate `{{vars}}`, so assertions read the real English copy.
 *   - The chart-annotation hooks used transitively by <ChartContainer> are
 *     stubbed to empty/no-op so the chart chrome mounts without react-query.
 *   - The global test-setup mock for useSettings supplies km / °C, so the real
 *     useUnits()/unit-conversion path runs (identity conversions here).
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * slice tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';

// jsdom lacks matchMedia; framer-motion (<FadeIn>) reads it at module load for
// the reduced-motion preference. Install a no-op before any import runs.
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

// Shared, hoisted test doubles + a fallback-resolving `t` so the factories
// below and the specs can both reach them.
const {
  tImpl,
  healthMock,
  degradationMock,
  sessionsMock,
  chargingLiveMock,
  selectedVehicleMock,
  alertContextMock,
} = vi.hoisted(() => {
  const tImpl = (key: string, second?: unknown, third?: unknown): string => {
    const template =
      typeof second === 'string'
        ? second
        : second && typeof second === 'object' && 'defaultValue' in (second as Record<string, unknown>)
          ? String((second as Record<string, unknown>).defaultValue)
          : key;
    const vars =
      third && typeof third === 'object'
        ? (third as Record<string, unknown>)
        : second && typeof second === 'object'
          ? (second as Record<string, unknown>)
          : undefined;
    if (!vars) return template;
    return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
      name in vars ? String(vars[name]) : `{{${name}}}`,
    );
  };
  return {
    tImpl,
    healthMock: vi.fn(),
    degradationMock: vi.fn(),
    sessionsMock: vi.fn(),
    chargingLiveMock: vi.fn(),
    selectedVehicleMock: vi.fn(),
    alertContextMock: vi.fn(),
  };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: tImpl,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useEnergy', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useEnergy')>('@/api/hooks/useEnergy');
  return {
    ...actual,
    useBatteryHealthAnalytics: (...args: unknown[]) => healthMock(...args),
    useBatteryDegradation: (...args: unknown[]) => degradationMock(...args),
  };
});

vi.mock('@/api/hooks/useCharging', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useCharging')>('@/api/hooks/useCharging');
  return {
    ...actual,
    useChargingSessionsPaginated: (...args: unknown[]) => sessionsMock(...args),
  };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles');
  return {
    ...actual,
    useChargingTelemetryLatest: (...args: unknown[]) => chargingLiveMock(...args),
  };
});

vi.mock('@/hooks/useSelectedVehicle', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSelectedVehicle')>('@/hooks/useSelectedVehicle');
  return {
    ...actual,
    useSelectedVehicle: () => selectedVehicleMock(),
  };
});

vi.mock('@/hooks/useAlertContext', () => ({
  useAlertContext: () => alertContextMock(),
}));

// <ChartContainer> pulls annotation hooks transitively; stub them so the chart
// chrome mounts without hitting react-query / the network.
vi.mock('@/api/hooks/useAnnotations', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useAnnotations')>('@/api/hooks/useAnnotations');
  return {
    ...actual,
    useChartAnnotationsAsData: () => ({ annotations: [], isLoading: false }),
    useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

import BatteryHealthPage, {
  gaugeColor,
  healthVariant,
  healthLabel,
  degradationColor,
  buildInsights,
  buildRecommendations,
  computeEnergyBreakdown,
} from './BatteryHealthPage';
import { CHART_COLORS } from '@/components/charts';
import type { BatteryHealthAnalytics } from '@/types/energy';
import type { ChargingSession } from '@/api/types';

const t = tImpl as unknown as TFunction;

/* ── Fixtures ─────────────────────────────────────────────────────── */

const HEALTH_DEFAULTS: BatteryHealthAnalytics = {
  current_soh: 96,
  estimated_capacity: 72.5,
  original_capacity: 75,
  degradation_rate_yr: 2.1,
  battery_age_months: 18,
  total_cycles: 320,
  avg_depth_of_discharge: 55,
  fast_charge_pct: 20,
  full_charge_pct: 10,
  charge_habits_score: 88,
  temp_exposure_score: 90,
  history: [
    { date: '2024-01-01', odometer: 1000, soh_pct: 99, capacity_wh: 74000, range_km: 500 },
    { date: '2024-06-01', odometer: 8000, soh_pct: 97, capacity_wh: 73000, range_km: 480 },
    { date: '2024-12-01', odometer: 15000, soh_pct: 96, capacity_wh: 72500, range_km: 470 },
  ],
};

function makeHealth(overrides: Partial<BatteryHealthAnalytics> = {}): BatteryHealthAnalytics {
  return { ...HEALTH_DEFAULTS, ...overrides };
}

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 42,
    started_at: '2024-01-01T00:00:00Z',
    ended_at: '2024-01-01T01:00:00Z',
    start_soc_pct: 30,
    end_soc_pct: 80,
    delta_soc_pct: 50,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 20000,
    peak_power_w: 7000,
    avg_power_w: 5000,
    cost_decimal: null,
    cost_currency: null,
    charger_type: null,
    cable_type: null,
    startedAt: '2024-01-01T00:00:00Z',
    duration_min: 60,
    ...overrides,
  };
}

interface QueryOverrides {
  data?: unknown;
  isLoading?: boolean;
  error?: unknown;
}

function makeQuery(overrides: QueryOverrides = {}) {
  return {
    data: overrides.data,
    isLoading: overrides.isLoading ?? false,
    isFetching: false,
    isError: overrides.error != null,
    error: overrides.error ?? null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  };
}

// A trustworthy degradation prediction (finite slope, positive years-to-80).
const TRUSTWORTHY_PREDICTION = {
  has_enough_data: true,
  slope_per_year: 2,
  years_to_80_pct: 8.5,
  predicted_date: '2033-01-01',
  projection_points: [
    { month: '2025-01-01', health: 95 },
    { month: '2026-01-01', health: 93 },
  ],
};

// Three sessions: two AC (charger null, low peak) + one DC Supercharger.
const MIXED_SESSIONS: ChargingSession[] = [
  makeSession({ id: 1, start_soc_pct: 20, end_soc_pct: 80, total_energy_added_wh: 30000, charger_type: null, peak_power_w: 7000 }),
  makeSession({ id: 2, start_soc_pct: 15, end_soc_pct: 90, total_energy_added_wh: 50000, charger_type: 'Tesla Supercharger', peak_power_w: 120000 }),
  makeSession({ id: 3, start_soc_pct: 30, end_soc_pct: 85, total_energy_added_wh: 40000, charger_type: null, peak_power_w: 6000 }),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BatteryHealthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Read a MetricCard's value text by its (unique) label. */
function metricCardValue(label: string): string {
  const labelSpan = screen.getByText(label);
  const container = labelSpan.closest('.flex-1');
  const valueEl = container?.querySelector('p.text-xl');
  return valueEl?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({
    vehicleId: 42,
    vehicle: null,
    vehicles: [{ id: 42, display_name: 'Roadie' }],
    setVehicleId: vi.fn(),
  });
  alertContextMock.mockReturnValue({ timestamp: null, signal: null, window: null, hasContext: false });
  healthMock.mockReturnValue(makeQuery({ data: makeHealth() }));
  degradationMock.mockReturnValue(makeQuery({ data: { prediction: null } }));
  sessionsMock.mockReturnValue(makeQuery({ data: [] }));
  chargingLiveMock.mockReturnValue(makeQuery({ data: null }));
});

/* ── Pure helpers ─────────────────────────────────────────────────── */

describe('BatteryHealthPage · pure helpers', () => {
  it('gaugeColor maps SoH bands to the CB-safe palette buckets', () => {
    expect(gaugeColor(95)).toBe(CHART_COLORS[1]);
    expect(gaugeColor(90)).toBe(CHART_COLORS[1]);
    expect(gaugeColor(89.9)).toBe(CHART_COLORS[3]);
    expect(gaugeColor(70)).toBe(CHART_COLORS[3]);
    expect(gaugeColor(69)).toBe(CHART_COLORS[5]);
  });

  it('healthVariant and healthLabel agree across the three health bands', () => {
    expect(healthVariant(90)).toBe('success');
    expect(healthVariant(70)).toBe('warning');
    expect(healthVariant(69.9)).toBe('danger');

    expect(healthLabel(95, t)).toBe('Excellent');
    expect(healthLabel(75, t)).toBe('Good');
    expect(healthLabel(50, t)).toBe('Degraded');
  });

  it('degradationColor thresholds green ≤5, amber ≤15, red above', () => {
    expect(degradationColor(3)).toBe('#10b981');
    expect(degradationColor(5)).toBe('#10b981');
    expect(degradationColor(5.1)).toBe('#f59e0b');
    expect(degradationColor(15)).toBe('#f59e0b');
    expect(degradationColor(15.1)).toBe('#ef4444');
  });

  it('buildInsights branches on SoH band (excellent / good / concern)', () => {
    expect(buildInsights(makeHealth({ current_soh: 96 }), null, t)[0]).toMatchObject({
      title: 'Excellent Health',
      status: 'good',
    });
    expect(buildInsights(makeHealth({ current_soh: 75 }), null, t)[0]).toMatchObject({
      title: 'Good Health',
      status: 'warning',
    });
    expect(buildInsights(makeHealth({ current_soh: 60 }), null, t)[0]).toMatchObject({
      title: 'Health Concern',
      status: 'critical',
    });
  });

  it('buildInsights surfaces fast-charge, deep-discharge and supercharger findings', () => {
    const fastOnly = buildInsights(makeHealth({ fast_charge_pct: 60 }), null, t);
    expect(fastOnly.map((i) => i.title)).toContain('High Fast-Charge Usage');

    const deepSessions: ChargingSession[] = Array.from({ length: 4 }, (_, i) =>
      makeSession({ id: i + 1, start_soc_pct: 5 }),
    );
    const deep = buildInsights(makeHealth(), deepSessions, t);
    expect(deep.map((i) => i.title)).toContain('Deep Discharges Detected');

    const scSessions: ChargingSession[] = Array.from({ length: 5 }, (_, i) =>
      makeSession({ id: i + 1, start_soc_pct: 40, charger_type: 'Tesla Supercharger' }),
    );
    const sc = buildInsights(makeHealth(), scSessions, t);
    expect(sc.map((i) => i.title)).toContain('High Supercharger Usage');
  });

  it('buildRecommendations returns the positive tip when habits are healthy and specific tips otherwise', () => {
    const healthy = buildRecommendations(makeHealth({ fast_charge_pct: 10, full_charge_pct: 10, avg_depth_of_discharge: 40, degradation_rate_yr: 2 }), t);
    expect(healthy).toEqual(['Your battery health looks great — keep up the good habits!']);

    const risky = buildRecommendations(
      makeHealth({ fast_charge_pct: 40, full_charge_pct: 50, avg_depth_of_discharge: 75, degradation_rate_yr: 6 }),
      t,
    );
    expect(risky.length).toBe(4);
    expect(risky).toContain('Your degradation rate is above average — review charging habits.');
    expect(risky).not.toContain('Your battery health looks great — keep up the good habits!');
  });

  it('computeEnergyBreakdown splits AC vs DC, returns null when empty, and stays finite for large totals', () => {
    expect(computeEnergyBreakdown([])).toBeNull();

    const mix = computeEnergyBreakdown(MIXED_SESSIONS);
    expect(mix).not.toBeNull();
    expect(mix?.acCount).toBe(2);
    expect(mix?.dcCount).toBe(1);
    expect(mix?.totalSessions).toBe(3);
    // AC = 30 + 40 = 70 kWh, DC = 50 kWh.
    expect(mix?.pieData[0]).toEqual({ name: 'AC', value: 70, fill: '#10b981' });
    expect(mix?.pieData[1]).toEqual({ name: 'DC', value: 50, fill: '#f59e0b' });

    // Regression guard: 20 AC sessions × 60 kWh = 1200 kWh. The previous
    // `+(fmtNumber(x, 1))` path turned "1,200.0" into NaN once totals crossed
    // 1000. Numeric rounding keeps it finite.
    const big = computeEnergyBreakdown(
      Array.from({ length: 20 }, (_, i) => makeSession({ id: i + 1, total_energy_added_wh: 60000, charger_type: null, peak_power_w: 7000 })),
    );
    expect(Number.isNaN(big?.pieData[0].value)).toBe(false);
    expect(big?.pieData[0].value).toBeCloseTo(1200, 1);
  });
});

/* ── Component: gating & async states ─────────────────────────────── */

describe('BatteryHealthPage · states', () => {
  it('renders the no-vehicle guard (not the dashboard) when no vehicle is selected', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
    renderPage();

    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up TeslaSync' })).toBeInTheDocument();
    // Dashboard KPI band is absent.
    expect(screen.queryByText('State of Health')).not.toBeInTheDocument();
    // Hooks still run unconditionally with the (null) id.
    expect(healthMock).toHaveBeenCalledWith(null);
  });

  it('shows the loading skeleton while the health query is in flight', () => {
    healthMock.mockReturnValue(makeQuery({ isLoading: true }));
    renderPage();

    expect(screen.getByTestId('battery-health-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('State of Health')).not.toBeInTheDocument();
  });

  it('shows an empty state (never a blank panel) when the health payload is missing', () => {
    healthMock.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();

    expect(screen.getByText('No battery health data available yet.')).toBeInTheDocument();
    expect(screen.queryByText('State of Health')).not.toBeInTheDocument();
  });
});

/* ── Component: happy-path render ─────────────────────────────────── */

describe('BatteryHealthPage · dashboard render', () => {
  it('renders the full dashboard for a healthy battery and wires hooks with the selected vehicle', () => {
    degradationMock.mockReturnValue(makeQuery({ data: { prediction: TRUSTWORTHY_PREDICTION } }));
    sessionsMock.mockReturnValue(makeQuery({ data: MIXED_SESSIONS }));
    renderPage();

    // Page title (h1) + KPI band accessible name.
    expect(screen.getByRole('heading', { level: 1, name: 'Battery Health' })).toBeInTheDocument();
    expect(screen.getByLabelText('Battery health summary metrics')).toBeInTheDocument();

    // KPI values (precision-tolerant). "Original Capacity" is the unique kWh
    // KPI label ("Current Capacity" is shared with the wear MetricBar below).
    expect(metricCardValue('State of Health')).toContain('96');
    expect(metricCardValue('Original Capacity')).toContain('kWh');
    expect(metricCardValue('Total Cycles')).toContain('320');
    expect(metricCardValue('Battery Age')).toContain('18');

    // Health verdict badge + a11y years-to-80 hero value.
    expect(screen.getByText('Excellent')).toBeInTheDocument();
    expect(screen.getByText('8.5')).toBeInTheDocument();

    // Every chart section title is present (no gutted panels).
    expect(screen.getByText('Capacity Trend & Prediction')).toBeInTheDocument();
    expect(screen.getByText('Estimated Range Over Time')).toBeInTheDocument();
    expect(screen.getByText('Charge Level Distribution')).toBeInTheDocument();
    expect(screen.getByText('AC / DC Energy Breakdown')).toBeInTheDocument();

    // Quick-links navigation is keyboard/screen-reader labelled and linked.
    const nav = screen.getByRole('navigation', { name: 'Explore More' });
    expect(within(nav).getByText('Battery Cells').closest('a')).toHaveAttribute('href', '/battery-cells');

    // Hooks received the correctly-typed vehicle id (string for analytics,
    // number for the paginated/live queries — snake_case option keys).
    expect(healthMock).toHaveBeenCalledWith('42');
    expect(sessionsMock).toHaveBeenCalledWith(42, { limit: 100 });
    expect(chargingLiveMock).toHaveBeenCalledWith(42);
  });

  it('renders the degraded verdict and the matching recommendations for a worn battery', () => {
    healthMock.mockReturnValue(
      makeQuery({
        data: makeHealth({ current_soh: 65, degradation_rate_yr: 6, fast_charge_pct: 40, full_charge_pct: 50, avg_depth_of_discharge: 75 }),
      }),
    );
    renderPage();

    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('Health Concern')).toBeInTheDocument();
    expect(screen.getByText('Your degradation rate is above average — review charging habits.')).toBeInTheDocument();
    expect(screen.getByText('Reduce fast charging frequency to slow degradation.')).toBeInTheDocument();
  });

  it('feeds the charging-statistics panel with real AC/DC session counts', () => {
    sessionsMock.mockReturnValue(makeQuery({ data: MIXED_SESSIONS }));
    renderPage();

    const acRow = screen.getByText('AC Sessions').closest('div') as HTMLElement;
    expect(within(acRow).getByText('2')).toBeInTheDocument();
    const dcRow = screen.getByText('DC / Supercharger').closest('div') as HTMLElement;
    expect(within(dcRow).getByText('1')).toBeInTheDocument();

    // Charging-habit stat tiles derived from the same sessions.
    expect(screen.getByText('Supercharger Sessions')).toBeInTheDocument();
    expect(screen.getByText('Home Charges')).toBeInTheDocument();
  });
});

/* ── Component: data-source branches & null safety ────────────────── */

describe('BatteryHealthPage · branches & resilience', () => {
  it('renders calm empty states (not blank panels) when there are no charging sessions', () => {
    sessionsMock.mockReturnValue(makeQuery({ data: [] }));
    renderPage();

    expect(screen.getByText('No charging session data yet')).toBeInTheDocument();
    expect(screen.getByText('No charging data for breakdown')).toBeInTheDocument();
    expect(screen.getByText('No charging statistics yet')).toBeInTheDocument();
  });

  it('surfaces live thermal telemetry when a charging snapshot is present', () => {
    chargingLiveMock.mockReturnValue(
      makeQuery({
        data: {
          module_temp_max: 32,
          module_temp_min: 28,
          num_module_temp_max: 3,
          battery_heater_on: false,
          bms_fullcharge_complete: true,
        },
      }),
    );
    renderPage();

    expect(metricCardValue('Module Temp (Max)')).toContain('32');
    expect(metricCardValue('Module Temp (Max)')).toContain('°C');
    expect(metricCardValue('Full Charge Complete')).toBe('Yes');
    expect(metricCardValue('Battery Heater')).toBe('Off');
    // Spread = 32 − 28 = 4 °C.
    expect(metricCardValue('Temperature Spread')).toContain('4');
    expect(screen.getByText('Module #3')).toBeInTheDocument();
  });

  it('falls back to placeholders when no live charging snapshot is available', () => {
    chargingLiveMock.mockReturnValue(makeQuery({ data: null }));
    renderPage();

    expect(metricCardValue('Full Charge Complete')).toBe('—');
    expect(metricCardValue('Battery Heater')).toBe('—');
    expect(metricCardValue('Module Temp (Max)')).toBe('—');
  });

  it('does not crash and keeps the "New vs Now" panel when the history array is missing', () => {
    // Regression guard: the range cells used to read `health.history.length`
    // directly and threw (caught by the section error boundary) when the
    // backend omitted `history`. They now degrade to a placeholder.
    healthMock.mockReturnValue(makeQuery({ data: { ...makeHealth(), history: undefined } }));
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Battery Health' })).toBeInTheDocument();
    expect(screen.getByText('Range When New')).toBeInTheDocument();
    expect(screen.queryByText('Capacity & range comparison failed to load')).not.toBeInTheDocument();
  });

  it('clamps out-of-range state-of-charge so the distribution chart never throws', () => {
    // start_soc_pct = -5 and end_soc_pct = 150 would index buckets[-1]/[15]
    // and crash before the Math.max/Math.min clamp was added.
    sessionsMock.mockReturnValue(
      makeQuery({
        data: [
          makeSession({ id: 1, start_soc_pct: -5, end_soc_pct: 150 }),
          makeSession({ id: 2, start_soc_pct: 40, end_soc_pct: 80 }),
        ],
      }),
    );
    renderPage();

    expect(screen.getByText('Charge Level Distribution')).toBeInTheDocument();
    expect(screen.queryByText('Charge level distribution failed to load')).not.toBeInTheDocument();
  });

  it('hides the years-to-80 projection when the regression is untrustworthy', () => {
    // Absurd slope → projectionTrustworthy=false → hero shows the em-dash and
    // the projected value never renders.
    degradationMock.mockReturnValue(
      makeQuery({ data: { prediction: { ...TRUSTWORTHY_PREDICTION, slope_per_year: 999 } } }),
    );
    renderPage();

    expect(screen.getByText('Years to 80%')).toBeInTheDocument();
    expect(screen.queryByText('8.5')).not.toBeInTheDocument();
  });

  it('lets the header vehicle picker refetch by mounting the live indicator + selector', () => {
    renderPage();

    // The header actions render the shared VehicleSelect (a combobox) — proves
    // the page exposes the source-of-truth picker rather than a dead panel.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    // Interacting with it routes through the mocked selector without throwing.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '42' } });
    expect(screen.getByRole('heading', { level: 1, name: 'Battery Health' })).toBeInTheDocument();
  });
});
