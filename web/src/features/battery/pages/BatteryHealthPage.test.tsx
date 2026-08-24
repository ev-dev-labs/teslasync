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
  degradationTone,
  healthTone,
  buildInsights,
  buildRecommendations,
  computeEnergyBreakdown,
} from './BatteryHealthPage';
import { CHART_COLORS } from '@/components/charts';
import { gaugeTone, severityTokens } from '@/lib/tokens';
import type { BatteryChargingAnalysis, BatteryHealthAnalytics } from '@/types/energy';

const t = tImpl as unknown as TFunction;

/* ── Fixtures ─────────────────────────────────────────────────────── */

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

function makeChargeLevelDistribution() {
  return Array.from({ length: 10 }, (_, index) => ({
    min_soc_pct: index * 10,
    max_soc_pct: index * 10 + 9,
    start_count: 0,
    end_count: 0,
  }));
}

const EMPTY_CHARGING_ANALYSIS: BatteryChargingAnalysis = {
  charge_level_distribution: makeChargeLevelDistribution(),
  avg_start_soc_pct: null,
  avg_end_soc_pct: null,
  ac_session_count: 0,
  dc_session_count: 0,
  supercharger_count: 0,
  dc_fast_count: 0,
  deep_discharge_count: 0,
  ac_energy_wh: 0,
  dc_energy_wh: 0,
  total_sessions: 0,
};

const MIXED_CHARGING_ANALYSIS: BatteryChargingAnalysis = {
  charge_level_distribution: makeChargeLevelDistribution().map((bucket, index) => ({
    ...bucket,
    start_count: index === 1 ? 1 : index === 2 ? 2 : 0,
    end_count: index === 8 ? 2 : index === 9 ? 1 : 0,
  })),
  avg_start_soc_pct: 21.7,
  avg_end_soc_pct: 85,
  ac_session_count: 2,
  dc_session_count: 1,
  supercharger_count: 1,
  dc_fast_count: 0,
  deep_discharge_count: 0,
  ac_energy_wh: 70_000,
  dc_energy_wh: 50_000,
  total_sessions: 3,
};

const HEALTH_DEFAULTS: BatteryHealthAnalytics = {
  vehicle_id: 42,
  current_soh: 96,
  estimated_capacity_wh: 72_500,
  original_capacity_wh: 75_000,
  degradation_rate_pct_per_year: 2.1,
  battery_age_months: 18,
  total_cycles: 320,
  avg_depth_of_discharge_pct: 55,
  fast_charge_pct: 20,
  full_charge_pct: 10,
  charge_habits_score: 88,
  stress_level: 'Low',
  temp_exposure_score: 90,
  temp_exposure_reason: null,
  history: [
    { date: '2024-01-01', odometer_m: 1_000_000, soh_pct: 99, capacity_wh: 74000, range_m: 500_000 },
    { date: '2024-06-01', odometer_m: 8_000_000, soh_pct: 97, capacity_wh: 73000, range_m: 480_000 },
    { date: '2024-12-01', odometer_m: 15_000_000, soh_pct: 96, capacity_wh: 72500, range_m: 470_000 },
  ],
  prediction: TRUSTWORTHY_PREDICTION,
  projections: [],
  charging_habits: {
    fast_charge_count: 1,
    slow_charge_count: 4,
    deep_discharge_count: 0,
    charge_to_full_count: 1,
    high_soc_count: 1,
    avg_energy_per_session: 35,
    total_count: 5,
  },
  risk_factors: [],
  recommendations: [],
  charging_analysis: EMPTY_CHARGING_ANALYSIS,
  capacity_source: 'model_estimate',
};

function makeHealth(overrides: Partial<BatteryHealthAnalytics> = {}): BatteryHealthAnalytics {
  return { ...HEALTH_DEFAULTS, ...overrides };
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
  // MetricCard exposes stable `data-role` hooks; the old `p.text-xl` selector
  // pinned the value to a typography class that the shared card no longer uses.
  const valueEl = container?.querySelector('[data-role="metric-value"]');
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

    const deep = buildInsights(makeHealth(), {
      ...EMPTY_CHARGING_ANALYSIS,
      deep_discharge_count: 4,
      total_sessions: 4,
    }, t);
    expect(deep.map((i) => i.title)).toContain('Deep Discharges Detected');

    const sc = buildInsights(makeHealth(), {
      ...EMPTY_CHARGING_ANALYSIS,
      supercharger_count: 5,
      dc_session_count: 5,
      total_sessions: 5,
    }, t);
    expect(sc.map((i) => i.title)).toContain('High Supercharger Usage');
  });

  it('buildRecommendations returns the positive tip when habits are healthy and specific tips otherwise', () => {
    const healthy = buildRecommendations(makeHealth({ fast_charge_pct: 10, full_charge_pct: 10, avg_depth_of_discharge_pct: 40, degradation_rate_pct_per_year: 2 }), t);
    expect(healthy).toEqual(['Your battery health looks great — keep up the good habits!']);

    const risky = buildRecommendations(
      makeHealth({ fast_charge_pct: 40, full_charge_pct: 50, avg_depth_of_discharge_pct: 75, degradation_rate_pct_per_year: 6 }),
      t,
    );
    expect(risky.length).toBe(4);
    expect(risky).toContain('Your degradation rate is above average — review charging habits.');
    expect(risky).not.toContain('Your battery health looks great — keep up the good habits!');
  });

  it('computeEnergyBreakdown splits AC vs DC, returns null when empty, and stays finite for large totals', () => {
    expect(computeEnergyBreakdown(EMPTY_CHARGING_ANALYSIS)).toBeNull();

    const mix = computeEnergyBreakdown(MIXED_CHARGING_ANALYSIS);
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
    const big = computeEnergyBreakdown({
      ...EMPTY_CHARGING_ANALYSIS,
      ac_energy_wh: 1_200_000,
      ac_session_count: 20,
      total_sessions: 20,
    });
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
    expect(screen.getByRole('heading', { level: 1, name: 'Battery Health' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
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
  it('renders the full dashboard for a healthy battery and wires hooks with the selected vehicle', async () => {
    healthMock.mockReturnValue(makeQuery({
      data: makeHealth({ charging_analysis: MIXED_CHARGING_ANALYSIS }),
    }));
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
    expect(
      await screen.findByText(
        'Capacity Trend & Prediction',
        {},
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Estimated Range Over Time')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Charge Level Distribution',
        {},
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('AC / DC Energy Breakdown')).toBeInTheDocument();

    // Quick-links navigation is keyboard/screen-reader labelled and linked.
    const nav = screen.getByRole('navigation', { name: 'Explore More' });
    expect(within(nav).getByText('Battery Cells').closest('a')).toHaveAttribute('href', '/battery-cells');

    // One consolidated analytics request plus the lightweight live snapshot.
    expect(healthMock).toHaveBeenCalledWith('42');
    expect(healthMock).toHaveBeenCalledTimes(1);
    expect(chargingLiveMock).toHaveBeenCalledWith(42);
  });

  it('renders the degraded verdict and the matching recommendations for a worn battery', () => {
    healthMock.mockReturnValue(
      makeQuery({
        data: makeHealth({ current_soh: 65, degradation_rate_pct_per_year: 6, fast_charge_pct: 40, full_charge_pct: 50, avg_depth_of_discharge_pct: 75 }),
      }),
    );
    renderPage();

    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('Health Concern')).toBeInTheDocument();
    expect(screen.getByText('Your degradation rate is above average — review charging habits.')).toBeInTheDocument();
    expect(screen.getByText('Reduce fast charging frequency to slow degradation.')).toBeInTheDocument();
  });

  it('feeds the charging-statistics panel with real AC/DC session counts', async () => {
    healthMock.mockReturnValue(makeQuery({
      data: makeHealth({ charging_analysis: MIXED_CHARGING_ANALYSIS }),
    }));
    renderPage();

    const acRow = (await screen.findByText('AC Sessions')).closest('div') as HTMLElement;
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
  it('renders calm empty states (not blank panels) when there are no charging sessions', async () => {
    renderPage();

    expect(await screen.findByText('No charging session data yet')).toBeInTheDocument();
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

  it('clamps out-of-range state-of-charge so the distribution chart never throws', async () => {
    healthMock.mockReturnValue(makeQuery({
      data: makeHealth({
        charging_analysis: {
          ...MIXED_CHARGING_ANALYSIS,
          charge_level_distribution: [
            { min_soc_pct: -10, max_soc_pct: 149, start_count: 1, end_count: 1 },
          ],
        },
      }),
    }));
    renderPage();

    expect(await screen.findByText('Charge Level Distribution')).toBeInTheDocument();
    expect(screen.queryByText('Charge level distribution failed to load')).not.toBeInTheDocument();
  });

  it('hides the years-to-80 projection when the regression is untrustworthy', () => {
    // Absurd slope → projectionTrustworthy=false → hero shows the em-dash and
    // the projected value never renders.
    healthMock.mockReturnValue(makeQuery({
      data: makeHealth({
        prediction: { ...TRUSTWORTHY_PREDICTION, slope_per_year: 999 },
      }),
    }));
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

/* ── Design-system consistency: tones, severities, heading levels ──── */

describe('BatteryHealthPage · design-system consistency', () => {
  /** The insight card carrying the given copy, tagged with its severity. */
  const insightCard = (title: string) =>
    screen.getByText(title).closest('[data-severity]') as HTMLElement;

  it('maps the health score onto the semantic gauge tones, not a palette index', () => {
    expect(healthTone(95)).toBe('success');
    expect(healthTone(90)).toBe('success');
    expect(healthTone(89.9)).toBe('warning');
    expect(healthTone(70)).toBe('warning');
    expect(healthTone(69)).toBe('danger');
  });

  it('maps the degradation rate onto the same tone vocabulary as every other status bar', () => {
    expect(degradationTone(3)).toBe('success');
    expect(degradationTone(5)).toBe('success');
    expect(degradationTone(5.1)).toBe('warning');
    expect(degradationTone(15)).toBe('warning');
    expect(degradationTone(15.1)).toBe('danger');
  });

  it('keeps the tone thresholds in lockstep with the legacy colour helpers', () => {
    // The colour helpers stay exported for callers that still need a raw CSS
    // string; the tones must not silently drift away from their bands.
    for (const soh of [100, 95, 90, 89.9, 80, 70, 69, 0]) {
      const expected = gaugeColor(soh) === CHART_COLORS[1]
        ? 'success'
        : gaugeColor(soh) === CHART_COLORS[3]
          ? 'warning'
          : 'danger';
      expect(healthTone(soh)).toBe(expected);
    }
    for (const pct of [0, 5, 5.1, 15, 15.1, 40]) {
      expect(gaugeTone[degradationTone(pct)]).toBe(degradationColor(pct));
    }
  });

  it('paints the insight panels from the canonical severity tokens, not a local neon map', () => {
    healthMock.mockReturnValue(
      makeQuery({ data: makeHealth({ current_soh: 96, degradation_rate_pct_per_year: 2 }) }),
    );
    const { container } = renderPage();

    // Excellent health + healthy habits ⇒ a success-severity insight.
    const good = insightCard('Excellent Health');
    expect(good).toHaveAttribute('data-severity', 'success');
    expect(good.className).toContain(severityTokens.success.bg);
    expect(good.className).toContain(severityTokens.success.border);

    // The neon surface fills the insights used to carry are gone for good.
    expect(container.querySelector('[class*="bg-neon-"]')).toBeNull();
  });

  it('escalates the insight severity with the battery condition', () => {
    healthMock.mockReturnValue(
      makeQuery({ data: makeHealth({ current_soh: 60, fast_charge_pct: 60 }) }),
    );
    renderPage();

    expect(insightCard('Health Concern')).toHaveAttribute('data-severity', 'critical');
    expect(insightCard('High Fast-Charge Usage')).toHaveAttribute('data-severity', 'warn');
  });

  it('titles in-panel sections with a panel-level heading, keeping h2 for real sections', () => {
    renderPage();

    // Panel-internal titles are h3 — they sit inside a GlassPanel, so promoting
    // them to h2 would claim a document section they do not own.
    expect(screen.getByRole('heading', { level: 3, name: 'Thermal Monitoring' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Capacity & Range: New vs Now' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Health Overview' })).toBeInTheDocument();

    // The standalone insights section keeps its section-level h2.
    expect(screen.getByRole('heading', { level: 2, name: 'Smart Insights' })).toBeInTheDocument();
  });
});
