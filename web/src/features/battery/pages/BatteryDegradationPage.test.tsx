/**
 * BatteryDegradationPage — behaviour + hardening coverage.
 *
 * The page exposes a single default export. This suite drives it through every
 * meaningful branch by mocking its two data hooks (`useBatteryHealthAnalytics` /
 * `useBatteryDegradation`), the selected vehicle, and the unit preference.
 * Network is never touched.
 *
 * Facets covered:
 *   - loading: page + panel scaffolding renders; KPI values, the health gauge,
 *     the projection chart, and the prediction block are all withheld (skeletons).
 *   - populated happy path: honest KPI tiles, SOH gauge health verdict, the
 *     projection chart surface (role="img"), the prediction block, the charging-
 *     habits banner, risk-factor scores, recommendations, health-factor sub-cards,
 *     the degradation history table, and hook-wiring (stringified vehicle id).
 *   - SOH verdict branches (Excellent / Good / Degraded) via `sohColor`+Badge.
 *   - Observation-duration formatting (`ageLabel`: months / "Ny Mm" / "N years"),
 *     provenance, missing/non-finite guards, and no inferred physical pack age.
 *   - unit boundary: switching the display unit to miles re-runs the real SI
 *     converter (km → mi) at the render edge for the odometer/range columns.
 *   - empty states: every data source shows its own placeholder; the charging
 *     banner preserves zero counts without inventing a ratio for an empty sample.
 *   - degradation-absent branch: prediction/habits/risk/recommendations each fall
 *     back to their own empty state while the health-driven panels stay intact.
 *   - per-query error isolation: a health-query 5xx surfaces QueryError in every
 *     health-driven panel (including the hardened gauge) without touching the
 *     degradation panels, and vice-versa.
 *   - a11y + interaction: labelled region landmarks, the projection chart image
 *     label, without a duplicate vehicle-scope combobox.
 */
import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/resilience';
import { convertDistanceFromSI, formatTemperature as formatTemperatureFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import type { BatteryDegradationHealth } from '../components/battery-degradation-modernization/BatteryDegradationStats';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { downloadCSV } from '@/lib/csvExport';
import { formatDate, formatDateTime, formatDayKey } from '@/lib/dateFormat';

const savedDatePreferences = vi.hoisted(() => ({
  locale: 'en-US',
  timezone: 'UTC',
}));
const messageTranslations = vi.hoisted(() => ({} as Record<string, string>));
vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => savedDatePreferences.timezone,
}));
vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return {
    ...actual,
    useSettings: () => {
      const result = actual.useSettings();
      return {
        ...result,
        locale: savedDatePreferences.locale,
        settings: {
          ...result.settings,
          tz_display_default: 'user',
          timezone_user: savedDatePreferences.timezone,
        },
      };
    },
  };
});

vi.mock('@/lib/csvExport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: vi.fn(),
}));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles, EmbeddedChart: actual.EmbeddedChart };
});

// ── i18n stub: resolve the fallback (or the key when it IS the template) and
//    interpolate any {{var}} placeholders from the options bag. ──────────────
vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(messageTranslations[key] ?? second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      return interpolate(key, second as Record<string, unknown>);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── framer-motion: strip animation props, keep motion.div + useReducedMotion. ──
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              k === 'animate' ||
              k === 'initial' ||
              k === 'exit' ||
              k === 'transition' ||
              k === 'whileHover' ||
              k === 'whileTap' ||
              k === 'whileInView' ||
              k === 'viewport' ||
              k === 'variants'
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── Data + environment hooks, driven per test. ──
vi.mock('@/api/hooks/useEnergy', () => ({
  useBatteryHealthAnalytics: vi.fn(),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
const analysisRange = vi.hoisted(() => ({
  startInstant: '2024-03-10T15:42:19.125Z',
  endInstantExclusive: '2024-03-11T15:42:19.125Z',
  timezone: 'America/Los_Angeles',
}));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: () => analysisRange }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => ['var(--series-0)', 'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'],
}));

// The projection chart uses <ChartContainer annotations=…>, whose annotation
// hooks reach for a <ToastProvider> (via useMutationToast) and the network.
// Neither is relevant here — stub them to inert no-ops so the chart mounts.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => makeQuery({ data: [] }),
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import BatteryDegradationPage from './BatteryDegradationPage';

const mockHealth = useBatteryHealthAnalytics as unknown as ReturnType<typeof vi.fn>;
const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

 
function makeQuery(over: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

const HEALTH: BatteryDegradationHealth = {
  valid_charge_count: 100,
  valid_start_soc_count: 100,
  valid_end_soc_count: 100,
  valid_dod_count: 100,
  vehicle_id: 7,
  current_soh: 91,
  estimated_capacity_wh: 72_500,
  original_capacity_wh: 78_000,
  degradation_rate_pct_per_year: 2.1,
  battery_age_months: null,
  observation_duration_months: 30, // → "2y 6m"
  observation_started_at: '2023-01-01T00:00:00Z',
  observation_source: 'battery_health_history',
  total_cycles: 412,
  avg_depth_of_discharge_pct: 40, // cycle-depth score = round(100 - 40) = 60
  fast_charge_pct: 35,
  full_charge_pct: 10,
  charge_habits_score: 82,
  stress_level: 'Medium',
  temp_exposure_score: 70,
  temp_exposure_reason: null,
  temp_exposure_available: true,
  temp_sample_count: 10,
  history: [
    { date: '2023-01-01', odometer_m: 10_000_000, soh_pct: 99, capacity_wh: 78000, range_m: 500_000 },
    { date: '2023-06-01', odometer_m: 20_000_000, soh_pct: 95, capacity_wh: 75000, range_m: 480_000 },
    { date: '2024-01-01', odometer_m: 30_000_000, soh_pct: 91, capacity_wh: 72500, range_m: 455_000 },
  ],
  prediction: {
    fit_valid: true,
    crossing_status: 'future_crossing',
    has_enough_data: true,
    slope_per_year: -2.1,
    years_to_80_pct: 5.3,
    predicted_date: '2029-06',
    projection_points: [],
  },
  charging_habits: {
    fast_charge_count: 40,
    slow_charge_count: 60,
    deep_discharge_count: 5,
    charge_to_full_count: 3,
    high_soc_count: 8,
    avg_energy_per_session_wh: 38_000,
    total_count: 100,
  },
  projections: [
    { date: '2025-01', health_pct: 89, confidence_low: 87, confidence_high: 91 },
    { date: '2026-01', health_pct: 87, confidence_low: 84, confidence_high: 90 },
  ],
  risk_factors: [
    { name: 'fast_charge_ratio', score: 40, label: 'Medium', detail: '40% of charges are fast' },
    { name: 'high_soc_charging', score: 20, label: 'Low', detail: 'Rarely charges above 90%' },
  ],
  recommendations: ['Charge to 80% for daily use', 'Avoid Superchargers when possible'],
  charging_analysis: {
    charge_level_distribution: [],
    avg_start_soc_pct: 30,
    avg_end_soc_pct: 80,
    ac_session_count: 60,
    dc_session_count: 40,
    supercharger_count: 30,
    dc_fast_count: 10,
    deep_discharge_count: 5,
    ac_energy_wh: 2_000_000,
    dc_energy_wh: 1_000_000,
    total_sessions: 100,
  },
  capacity_source: 'model_estimate',
};

const FLEET = [
  { id: 7, display_name: 'My Model 3', vin: 'VIN00007' },
  { id: 8, display_name: 'My Model Y', vin: 'VIN00008' },
];

const setVehicleId = vi.fn();
function selected(vehicleId: number | null) {
  return {
    vehicleId,
    vehicle: vehicleId != null ? FLEET.find((v) => v.id === vehicleId) ?? null : null,
    vehicles: FLEET,
    setVehicleId,
  };
}

// A deterministic energy formatter matching the hook contract (Wh → kWh).
const formatEnergy = (v: number | null | undefined, opts?: { precision?: number }): string =>
  `${(Number(v ?? 0) / 1000).toFixed(opts?.precision ?? 1)} kWh`;

function unitReturn(distance: 'km' | 'mi'): UseUnitsResult {
  return {
    unitPrefs: {
      distance, speed: distance === 'mi' ? 'mph' : 'km/h',
      temperature: '°C', pressure: 'bar', energy: 'kWh', duration: 'h',
      power: 'kW', precision: 2, locale: 'en-US',
    },
    formatEnergy,
    formatDistance: (v: number) => String(v),
    formatSpeed: (v: number) => String(v),
    formatTemperature: (v: number) => String(v),
    formatPressure: (v: number) => String(v),
    formatDuration: (v: number) => String(v),
    formatPower: (v: number) => String(v),
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <BatteryDegradationPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const TREND_IMG = 'Battery health trend and approximate prediction band chart';
const kpiRegion = () => screen.getByRole('region', { name: 'Battery health summary' });
const heroRegion = () => screen.getByRole('region', { name: 'Health trend & projection' });

/** Read the real shared stat's value and adjacent unit, not legacy MetricCard markup. */
function metricValue(region: HTMLElement, label: string): string {
  const tile = within(region).getByText(label).closest('[data-operational-metric]');
  return tile?.querySelector('[data-operational-value]')?.textContent ?? '';
}

beforeEach(() => {
  for (const key of Object.keys(messageTranslations)) delete messageTranslations[key];
  analysisRange.startInstant = '2024-03-10T15:42:19.125Z';
  analysisRange.endInstantExclusive = '2024-03-11T15:42:19.125Z';
  savedDatePreferences.locale = 'en-US';
  savedDatePreferences.timezone = 'UTC';
  vi.mocked(downloadCSV).mockClear();
  mockHealth.mockReset();
  mockSelected.mockReset();
  mockUnits.mockReset();
  setVehicleId.mockReset();

  mockUnits.mockReturnValue(unitReturn('km'));
  mockSelected.mockReturnValue(selected(7));
  mockHealth.mockReturnValue(makeQuery({ data: HEALTH }));
});

describe('BatteryDegradationPage — date-preference boundary', () => {
  it('uses the header range for health analysis and follows changes without a second picker', () => {
    const view = renderPage();
    expect(mockHealth).toHaveBeenLastCalledWith('7', {
      start: analysisRange.startInstant, end: analysisRange.endInstantExclusive,
    });
    expect(screen.queryByRole('combobox', { name: /vehicle|date range/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/start date|end date/i)).not.toBeInTheDocument();
    analysisRange.startInstant = '2024-03-09T00:00:00-08:00';
    analysisRange.endInstantExclusive = '2024-03-11T00:00:00-07:00';
    view.rerender(
      <MemoryRouter><QueryClientProvider client={new QueryClient()}>
        <BatteryDegradationPage />
      </QueryClientProvider></MemoryRouter>,
    );
    expect(mockHealth).toHaveBeenLastCalledWith('7', {
      start: analysisRange.startInstant, end: analysisRange.endInstantExclusive,
    });
    expect(metricValue(kpiRegion(), 'Current SOH')).toContain('91');
  });
  it('preserves populated counts and SI capacity with the canonical session-energy contract', () => {
    const source = structuredClone(HEALTH);
    source.charging_habits.avg_energy_per_session_wh = 38_125.5;
    expect(source.charging_habits).not.toHaveProperty('avg_energy_per_session');
    mockHealth.mockReturnValue(makeQuery({ data: source }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Current SOH')).toContain('91');
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toContain('72.5');
    expect(screen.getByRole('table', { name: 'Degradation history' })).toHaveTextContent(`${fmtNumber(91)}%`);
    expect(source.charging_habits.fast_charge_count).toBe(40);
    expect(source.charging_habits.slow_charge_count).toBe(60);
    expect(source.charging_habits.avg_energy_per_session_wh).toBe(38_125.5);
  });

  it.each(['America/Los_Angeles', 'Pacific/Kiritimati'])(
    'preserves calendar days while rendering observation instants in %s',
    (timezone) => {
      savedDatePreferences.locale = 'de-DE';
      savedDatePreferences.timezone = timezone;
      const source = structuredClone(HEALTH);
      source.history[0].range_sampled_at = '2023-01-01T00:05:00Z';
      source.history[0].odometer_sampled_at = '2023-01-01T23:55:00Z';
      mockHealth.mockReturnValue(makeQuery({ data: source }));
      renderPage();
      const opts = { locale: 'de-DE', tz: timezone };
      const table = screen.getByRole('table', { name: 'Degradation history' });
      expect(table).toHaveTextContent(formatDayKey('2023-01-01', opts));
      expect(table).toHaveTextContent(formatDateTime(source.history[0].range_sampled_at, opts));
      expect(table).toHaveTextContent(formatDateTime(source.history[0].odometer_sampled_at, opts));
      expect(kpiRegion()).toHaveTextContent(
        `Start: ${formatDate(HEALTH.observation_started_at, opts)};`,
      );
      expect(screen.getByText(/Juni 2029/)).toBeInTheDocument();
      expect(source.history[0].date).toBe(HEALTH.history[0].date);
      expect(source.history[0].range_sampled_at).toBe('2023-01-01T00:05:00Z');
      expect(source.history[0].odometer_sampled_at).toBe('2023-01-01T23:55:00Z');
      expect(source.projections).toEqual(HEALTH.projections);
    },
  );

  it.each(['2023-02-29', 'invalid', '', undefined, null])(
    'renders missing or invalid calendar date %s as unknown',
    (date) => {
      const source = structuredClone(HEALTH);
      source.history = [source.history[0]];
      Reflect.set(source.history[0], 'date', date);
      Reflect.set(source, 'observation_started_at', date === '2023-02-29' ? 'invalid' : date);
      source.prediction.predicted_date = '2029-13';
      mockHealth.mockReturnValue(makeQuery({ data: source }));
      renderPage();
      expect(screen.getByRole('table', { name: 'Degradation history' })).toHaveTextContent('—');
      expect(kpiRegion()).toHaveTextContent('Start: —;');
      expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
      expect(source.history[0].date).toBe(date);
    },
  );
});

describe('BatteryDegradationPage — fitted evidence contract', () => {
  it.each([undefined, null, {}, 'invalid'])('preserves independent shells for malformed arrays %s', value => {
    const source = structuredClone(HEALTH);
    for (const key of ['history', 'projections', 'risk_factors', 'recommendations']) {
      Reflect.set(source, key, value);
    }
    mockHealth.mockReturnValue(makeQuery({ data: source }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Current SOH')).toContain('91');
    for (const title of ['Risk factors', 'Recommendations', 'Degradation history', 'Range loss over time']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Risk data will appear once charging history is available.')).toBeInTheDocument();
  });

  it('rejects malformed nested rows without discarding valid fractional and zero measurements', () => {
    const source = structuredClone(HEALTH);
    Reflect.set(source, 'history', [null, 'invalid', {
      date: '2023-01-01', soh_pct: 101, capacity_wh: -1, range_m: -1, odometer_m: '0',
    }, {
      date: '2023-06-01', soh_pct: 0, capacity_wh: 0, range_m: 0, odometer_m: 0,
    }, {
      date: '2024-01-01', soh_pct: 91.25, capacity_wh: 72500.5, range_m: 455000.5, odometer_m: 30000000.5,
    }]);
    Reflect.set(source, 'risk_factors', [null, {}, { name: 'fast_charge_ratio', score: -1, label: {}, detail: {} }]);
    Reflect.set(source, 'recommendations', [null, {}, 'Valid advice']);
    Reflect.set(source, 'stress_level', 'unrecognized');
    mockHealth.mockReturnValue(makeQuery({ data: source }));
    renderPage();
    const table = screen.getByRole('table', { name: 'Degradation history' });
    expect(table).toHaveTextContent('—');
    expect(table).toHaveTextContent('0%');
    expect(table).toHaveTextContent('91.25');
    expect(table).not.toHaveTextContent('101%');
    expect(screen.getByText('Valid advice')).toBeInTheDocument();
    expect(screen.queryByText(/High stress detected/)).not.toBeInTheDocument();
  });

  it.each([-1, 101, '0'])('renders invalid SOH %s neutrally rather than as a verdict', value => {
    const source = structuredClone(HEALTH);
    Reflect.set(source, 'current_soh', value);
    Reflect.set(source, 'estimated_capacity_wh', -1);
    mockHealth.mockReturnValue(makeQuery({ data: source }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Current SOH')).toContain('—');
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toContain('—');
    expect(screen.getByText('Battery health is not available yet.')).toBeInTheDocument();
    expect(screen.queryByText('Degraded')).not.toBeInTheDocument();
  });

  it.each([undefined, null, NaN, Infinity, -1, 0.5, '0'])(
    'does not interpret invalid charging count %s as observed evidence',
    value => {
      const source = structuredClone(HEALTH);
      Reflect.set(source.charging_habits, 'fast_charge_count', value);
      Reflect.set(source.charging_habits, 'deep_discharge_count', value);
      Reflect.set(source, 'valid_dod_count', value);
      mockHealth.mockReturnValue(makeQuery({ data: source }));
      renderPage();
      expect(screen.getByText(/—% fast charges, — deep discharges/)).toBeInTheDocument();
      expect(screen.getByText('Cycle depth').closest('[data-testid="glass-panel"]') ??
        screen.getByText('Cycle depth').parentElement?.parentElement).toHaveTextContent('—/100');
    },
  );

  it.each([[91, 89], [-1, 91], [NaN, 91], [undefined, 91]])(
    'keeps invalid forecast bounds %s–%s unknown while preserving projected health',
    (low, high) => {
      const source = structuredClone(HEALTH);
      Reflect.set(source.projections[1], 'confidence_low', low);
      Reflect.set(source.projections[1], 'confidence_high', high);
      mockHealth.mockReturnValue(makeQuery({ data: source }));
      renderPage();
      const table = screen.getByRole('table', { name: 'Health trend & projection — data table' });
      const forecast = within(table).getByText('2026-01').closest('tr')!;
      expect(within(forecast).getAllByRole('cell').map(cell => cell.textContent))
        .toEqual(['2026-01', '—', '87.00%', '—', '—']);
    },
  );

  it.each([
    ['no_future_crossing', 'does not predict a future crossing'],
    ['below_threshold', 'already at or below 80%'],
  ] as const)('distinguishes %s without inventing zero years', (crossing_status, message) => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH,
      prediction: { ...HEALTH.prediction, crossing_status, years_to_80_pct: null, predicted_date: null },
    } }));
    renderPage();
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
    expect(screen.queryByText(/in approximately/)).not.toBeInTheDocument();
  });

  it.each([0, -0.125, 0.125])('preserves signed fractional fitted slope %s', slope_per_year => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, prediction: { ...HEALTH.prediction, slope_per_year },
    } }));
    renderPage();
    const region = screen.getByRole('region', { name: 'Degradation model evidence' });
    expect(metricValue(region, 'Fitted SOH trend')).toBe(`${fmtNumber(slope_per_year)}%/yr`);
  });

  it.each([undefined, null, NaN, Infinity])('does not present invalid slope %s as zero', slope_per_year => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH,
      degradation_rate_pct_per_year: null,
      degradation_rate_available: false,
      prediction: { ...HEALTH.prediction, fit_valid: false, slope_per_year },
    } }));
    renderPage();
    expect(screen.getByText(/Need a valid fit/)).toBeInTheDocument();
    expect(screen.queryByText(/in approximately/)).not.toBeInTheDocument();
    expect(metricValue(kpiRegion(), 'Degradation rate')).toBe('—');
  });

  it('does not infer fit validity from sample count or numeric zero', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, prediction: { ...HEALTH.prediction, fit_valid: undefined, slope_per_year: 0 },
    } }));
    renderPage();
    expect(screen.getByText(/Need a valid fit/)).toBeInTheDocument();
    expect(screen.queryByText(/in approximately/)).not.toBeInTheDocument();
  });
});

describe('BatteryDegradationPage — loading', () => {
  it('keeps the page shell but withholds KPI values, gauge, prediction, and table', () => {
    mockHealth.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    renderPage();

    expect(screen.getByRole('heading', { name: 'Battery degradation', level: 1 })).toBeInTheDocument();
    // Shared stats retain their labels while withholding all measured values.
    expect(kpiRegion().querySelector('[data-operational-value]')).toBeNull();
    expect(kpiRegion().querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(kpiRegion().querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    assertOperationalBriefDisclosure(kpiRegion(), 'Loading source evidence', { contains: true });
    expect(screen.queryByText('Retained source evidence')).not.toBeInTheDocument();
    // The gauge verdict badge is withheld while its skeleton stands in.
    expect(screen.queryByText('Excellent')).toBeNull();
    // The prediction block is a skeleton, so its copy is absent.
    expect(screen.queryByText(/in approximately/)).toBeNull();
    // The history table is replaced by a skeleton while health data loads.
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('BatteryDegradationPage — stats source trust', () => {
  const statsIds = ['battery-degradation-summary', 'battery-degradation-prediction-stats'];

  it.each([
    { name: 'failed refresh', error: new ApiError('refresh failed', 500), isError: true },
    { name: 'paused refresh', fetchStatus: 'paused' },
    { name: 'expired source', dataUpdatedAt: Date.now() - 25 * 60 * 60 * 1000 },
  ])('labels both retained stats bands after $name and recovers their trust', ({ name: _name, ...query }) => {
    const refetch = vi.fn();
    mockHealth.mockReturnValue(makeQuery({ data: HEALTH, refetch, ...query }));
    const view = renderPage();
    for (const id of statsIds) {
      const brief = screen.getByTestId(id);
      assertOperationalBriefDisclosure(brief, 'Retained source evidence', { contains: true });
      assertOperationalBriefDisclosure(brief, 'Available source readings', { absent: true, contains: true });
      expect(brief).not.toHaveAttribute('aria-busy', 'true');
    }
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toBe('72.5 kWh');
    expect(metricValue(screen.getByTestId(statsIds[1]), 'Fitted SOH trend')).toBe('-2.10%/yr');
    const warning = screen.getByTestId('stale-refresh-warning');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    mockHealth.mockReturnValue(makeQuery({ data: HEALTH }));
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}>
      <BatteryDegradationPage />
    </QueryClientProvider></MemoryRouter>);
    for (const id of statsIds) {
      expect(screen.getByTestId(id)).toHaveTextContent('Available source readings');
      expect(screen.getByTestId(id)).not.toHaveTextContent('Retained source evidence');
    }
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('keeps paused-without-data distinct from retained and actively loading stats', () => {
    mockHealth.mockReturnValue(makeQuery({ fetchStatus: 'paused', isLoading: true }));
    renderPage();
    expect(kpiRegion()).toHaveTextContent('Battery analytics loading is paused.');
    expect(screen.queryByTestId('battery-degradation-summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Retained source evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading source evidence')).not.toBeInTheDocument();
  });

  it('preserves successful empty history and measured zero readings without retained status', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, history: [], projections: [], current_soh: 0, current_soh_available: true,
      estimated_capacity_wh: 0, estimated_capacity_wh_available: true,
      degradation_rate_pct_per_year: 0, degradation_rate_available: true,
      prediction: { ...HEALTH.prediction, slope_per_year: 0, crossing_status: 'no_future_crossing' },
    } }));
    renderPage();
    for (const id of statsIds) {
      expect(screen.getByTestId(id)).toHaveTextContent('Available source readings');
    }
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('0.00%');
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toBe('0.0 kWh');
    expect(metricValue(screen.getByTestId(statsIds[1]), 'Fitted SOH trend')).toBe('0.00%/yr');
    expect(screen.getByText('No degradation records found.')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });
});

describe('BatteryDegradationPage — populated (km)', () => {
  it.each(['vin_estimate', 'model_estimate', 'default', 'other_source'])(
    'exposes exact nominal baseline evidence for %s separately from current capacity',
    (capacity_source) => {
      mockHealth.mockReturnValue(makeQuery({ data: {
        ...HEALTH, capacity_source, original_capacity_wh: 78000.125,
      } }));
      renderPage();
      const summary = kpiRegion();
      expect(within(summary).getAllByText(
        new RegExp(`capacity_source=${capacity_source}; original_capacity_wh=78000\\.125`),
      )[0]).toHaveTextContent('assumption, not an observed or calibrated original pack capacity');
      expect(within(summary).getAllByText(/Nominal baseline evidence:/)[0])
        .toHaveTextContent('telemetry-derived estimator');
      expect(within(summary).getAllByText(/Nominal baseline evidence:/)[0])
        .toHaveTextContent('candidate BD-C01');
      expect(metricValue(summary, 'Estimated capacity')).toBe('72.5 kWh');
      expect(metricValue(summary, 'Current SOH')).toBe('91.00%');
    },
  );

  it('does not treat nominal baseline evidence as an observed estimator', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, capacity_source: 'default', original_capacity_wh: 75000,
      estimated_capacity_wh_available: false, current_soh_available: false,
    } }));
    renderPage();
    expect(within(kpiRegion()).getAllByText(/Nominal baseline evidence:/)[0])
      .toHaveTextContent('Observed current-capacity estimator unavailable');
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toBe('—');
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('—');
  });

  it('derives honest KPI tiles from /analytics/battery-health', () => {
    renderPage();
    const kpi = kpiRegion();

    expect(metricValue(kpi, 'Current SOH')).toBe('91.00%');
    expect(metricValue(kpi, 'Estimated capacity')).toBe('72.5 kWh');
    expect(metricValue(kpi, 'Degradation rate')).toBe('2.10%/yr');
    // Recorded observation duration 30 months → 2 years, 6 months.
    expect(metricValue(kpi, 'Observation duration')).toBe('2y 6m');
    expect(kpi).toHaveTextContent('Start: Jan 1, 2023; source: battery_health_history');
    expect(kpi).toHaveTextContent('it is not true pack age');
  });

  it.each([null, undefined])('does not fabricate estimated capacity from an absent value %s', (capacity) => {
    const health = { ...HEALTH };
    Reflect.set(health, 'estimated_capacity_wh', capacity);
    mockHealth.mockReturnValue(makeQuery({ data: health }));
    renderPage();
    const kpi = kpiRegion();
    expect(metricValue(kpi, 'Estimated capacity')).toBe('—');
    expect(within(kpi).getByText('Estimated capacity').closest('[data-operational-metric]'))
      .toHaveAttribute('data-value-state', 'missing');
    expect(within(kpi).queryByText('0.0 kWh', { exact: true })).not.toBeInTheDocument();
    expect(metricValue(kpi, 'Current SOH')).toBe('91.00%');
  });

  it('preserves a supplied zero capacity without replacing it with a nominal estimate', () => {
    mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, estimated_capacity_wh: 0 } }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toBe('0.0 kWh');
    expect(within(kpiRegion()).getByText('Estimated capacity').closest('[data-operational-metric]'))
      .toHaveAttribute('data-value-state', 'value');
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('91.00%');
  });

  it('honors explicit no-evidence flags instead of showing a dead battery', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, current_soh: 0, estimated_capacity_wh: 0,
      current_soh_available: false, estimated_capacity_wh_available: false,
    } }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('—');
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toBe('—');
    expect(within(heroRegion()).getByText('Battery health is not available yet.')).toBeInTheDocument();
    expect(within(heroRegion()).queryByText('Degraded')).not.toBeInTheDocument();
  });

  it('preserves measured zero health and capacity when evidence is available', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, current_soh: 0, estimated_capacity_wh: 0,
      current_soh_available: true, estimated_capacity_wh_available: true,
    } }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('0.00%');
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toBe('0.0 kWh');
    expect(within(heroRegion()).getByText('Degraded')).toBeInTheDocument();
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'keeps missing or invalid health %s unknown',
    (soh) => {
      mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, current_soh: soh } }));
      renderPage();
      expect(metricValue(kpiRegion(), 'Current SOH')).toBe('—');
      expect(within(heroRegion()).getByText('Battery health is not available yet.')).toBeInTheDocument();
    },
  );

  it('retains fractional capacity and a valid signed degradation rate', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, current_soh: 91.25, estimated_capacity_wh: 72550.5,
      degradation_rate_pct_per_year: -0.125,
    } }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('91.25%');
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toBe('72.6 kWh');
    expect(metricValue(kpiRegion(), 'Degradation rate')).toBe('-0.13%/yr');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('keeps invalid capacity %s unknown', (capacity) => {
    mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, estimated_capacity_wh: capacity } }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toBe('—');
  });

  it('renders the SOH gauge verdict and the projection chart surface', () => {
    renderPage();
    const hero = heroRegion();

    // soh 91 (> 90) → "Excellent".
    expect(within(hero).getByText('Excellent')).toBeInTheDocument();
    expect(within(hero).getByRole('group', { name: TREND_IMG })).toBeInTheDocument();
  });

  it('renders the prediction block and the charging-habits banner', () => {
    renderPage();

    // years_to_80_pct 5.3 → "~5.30 years", plus the predicted date.
    expect(screen.getByText(/in approximately/)).toBeInTheDocument();
    expect(screen.getByText(/Jun 2029/)).toBeInTheDocument();
    expect(metricValue(screen.getByText('Total cycles').closest('[data-operational-brief]') as HTMLElement, 'Total cycles')).toBe('412.00');

    // 40 fast + 60 slow → 40% fast charges; 5 deep discharges; Medium stress.
    expect(screen.getByText(/40% fast charges/)).toBeInTheDocument();
    expect(screen.getByText(/5 deep discharges/)).toBeInTheDocument();
    expect(screen.getByText(/Consider reducing fast charging frequency/)).toBeInTheDocument();
  });

  it('renders risk factors, recommendations, and health-factor sub-cards', () => {
    renderPage();

    // Risk factor #1 — label, score bar sublabel, and detail copy.
    expect(screen.getByText('fast charge ratio')).toBeInTheDocument();
    expect(screen.getByText('40/100')).toBeInTheDocument();
    expect(screen.getByText('40% of charges are fast')).toBeInTheDocument();

    expect(screen.getByText('Charge to 80% for daily use')).toBeInTheDocument();

    // Health factors: charge-habits (82), temperature (70), cycle-depth (60).
    expect(screen.getByText('Charge habits').closest('div')?.querySelector('span')?.textContent).toBeTruthy();
    expect(screen.getByText('82.00/100')).toBeInTheDocument();
    expect(screen.getByText('70.00/100')).toBeInTheDocument();
    expect(screen.getByText('60.00/100')).toBeInTheDocument();
  });

  it('translates Health message codes and formats typed operands only at display', () => {
    messageTranslations['battery.degradation.riskLabel.elevated'] = 'Erhöht';
    messageTranslations['battery.degradation.riskDetail.temperature_exposure'] = 'Zelltemperatur: {{temperature}}';
    messageTranslations['battery.degradation.recommendation.high_soc_charging'] = 'Ladelimit: {{threshold}}%';
    const units = unitReturn('mi');
    units.unitPrefs.temperature = '°F';
    units.formatTemperature = vi.fn(value => formatTemperatureFromSI(value, units.unitPrefs, { precision: 1 }));
    mockUnits.mockReturnValue(units);
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH,
      risk_factors: [{
        name: 'temperature_exposure', score: 70, available: true,
        label: 'Elevated', label_code: 'elevated',
        detail: 'Average cell temperature: 46.0°C', detail_code: 'temperature_exposure',
        operands: { avg_cell_temp_c: 46 },
      }],
      recommendation_messages: [{
        code: 'high_soc_charging', fallback: 'Reduce daily charge limit to 80% for everyday driving',
        operands: { threshold_soc_pct: 80 },
      }],
    } }));
    renderPage();
    expect(screen.getByText('Erhöht')).toBeInTheDocument();
    expect(screen.getByText('Zelltemperatur: 114.8°F')).toBeInTheDocument();
    expect(units.formatTemperature).toHaveBeenCalledWith(46);
    expect(screen.getByText(`Ladelimit: ${fmtNumber(80)}%`)).toBeInTheDocument();
    expect(screen.queryByText('Charge to 80% for daily use')).not.toBeInTheDocument();
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('91.00%');
  });

  it('preserves unknown and invalid-operand message fallbacks without inventing measurements', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH,
      risk_factors: [{
        name: 'fast_charge_ratio', score: 40, label: 'Moderate',
        detail: 'Existing risk detail', detail_code: 'fast_charge_ratio',
        operands: { percent: NaN },
      }],
      recommendation_messages: [
        { code: 'future_advice', fallback: 'Advice from a newer server' },
        { code: 'high_soc_charging', fallback: 'Existing charge limit advice', operands: { threshold_soc_pct: 101 } },
      ],
    } }));
    renderPage();
    expect(screen.getByText('Existing risk detail')).toBeInTheDocument();
    expect(screen.getByText('Advice from a newer server')).toBeInTheDocument();
    expect(screen.getByText('Existing charge limit advice')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it.each([
    { temp_exposure_available: false },
    { temp_sample_count: 0 },
    { temp_sample_count: 9 },
    { temp_exposure_reason: 'insufficient_data' },
    { temp_exposure_score: null },
  ])('keeps unavailable thermal evidence neutral: %j', (thermal) => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, ...thermal,
      risk_factors: [...HEALTH.risk_factors, {
        name: 'temperature_exposure', score: null, available: false, label: 'Unknown', detail: '',
      }],
    } }));
    renderPage();
    const card = screen.getByText('Temperature exposure').closest('div')!;
    expect(within(card).getByText('—/100')).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.queryByText('70.00/100')).not.toBeInTheDocument();
    expect(screen.queryByText(/Average cell temperature:/)).not.toBeInTheDocument();
    expect(screen.getByText('82.00/100')).toBeInTheDocument();
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('91.00%');
  });

  it.each([
    [10, 'text-[var(--semantic-success)]'],
    [70, 'text-[var(--semantic-danger)]'],
  ])('preserves measured thermal score %s with lower-is-better semantics', (score, tone) => {
    mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, temp_exposure_score: score } }));
    renderPage();
    const card = screen.getByText('Temperature exposure').closest('div')!;
    expect(within(card).getByText(`${fmtNumber(score)}/100`)).toHaveClass(tone);
  });

  it('uses thermal availability to suppress a stale numeric risk observation', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, temp_exposure_available: false, temp_sample_count: 0,
      risk_factors: [...HEALTH.risk_factors, {
        name: 'temperature_exposure', score: 70, available: true, label: 'Elevated',
        detail: 'Average cell temperature: 42.0°C',
      }],
    } }));
    renderPage();
    expect(screen.queryByText('Elevated')).not.toBeInTheDocument();
    expect(screen.queryByText('Average cell temperature: 42.0°C')).not.toBeInTheDocument();
    expect(screen.queryByText('70/100')).not.toBeInTheDocument();
    expect(screen.getByText('40/100')).toBeInTheDocument();
  });

  it('renders the degradation history table and wires the hooks with the string vehicle id', () => {
    renderPage();

    const table = screen.getByRole('table', { name: 'Degradation history' });
    for (const header of ['Date', 'Odometer', 'SOH %', 'Capacity', 'Range']) {
      expect(within(table).getByText(header)).toBeInTheDocument();
    }
    // Odometer 20,000 km rendered in km at global precision 2.
    expect(within(table).getByText('20,000.00 km')).toBeInTheDocument();
    // Capacity 75,000 Wh → 75.0 kWh (precision 1).
    expect(within(table).getByText('75.0 kWh')).toBeInTheDocument();

    expect(mockHealth).toHaveBeenCalledWith('7', {
      start: analysisRange.startInstant, end: analysisRange.endInstantExclusive,
    });
    expect(mockHealth).toHaveBeenCalledTimes(1);
  });
});

describe('BatteryDegradationPage — SOH verdict + observation-duration branches', () => {
  it.each([
    [95, 'Excellent'],
    [85, 'Good'],
    [70, 'Degraded'],
  ])('maps SOH %s to the "%s" verdict badge', (soh, verdict) => {
    mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, current_soh: soh } }));
    renderPage();
    expect(within(heroRegion()).getByText(verdict)).toBeInTheDocument();
  });

  it.each([
    [0, '0 months'],
    [6, '6 months'],
    [24, '2 years'],
    [30, '2y 6m'],
  ])('formats a %s-month observation duration as "%s"', (months, label) => {
    mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, observation_duration_months: months } }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Observation duration')).toBe(label);
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'keeps missing or invalid observation duration %s unknown rather than zero months',
    (months) => {
      const health = { ...HEALTH };
      Reflect.set(health, 'observation_duration_months', months);
      mockHealth.mockReturnValue(
        makeQuery({ data: health }),
      );
      renderPage();
      expect(metricValue(kpiRegion(), 'Observation duration')).toBe('—');
      expect(within(kpiRegion()).queryByText('0 months', { exact: true })).not.toBeInTheDocument();
      expect(kpiRegion()).not.toHaveTextContent('NaN');
    },
  );

  it('does not infer pack age from telemetry or a legacy age field', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, battery_age_months: 120, observation_duration_months: null,
      observation_started_at: null, observation_source: 'unavailable',
    } }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Observation duration')).toBe('—');
    expect(within(kpiRegion()).queryByText('Battery age')).not.toBeInTheDocument();
    expect(kpiRegion()).toHaveTextContent('it is not true pack age');
    expect(kpiRegion()).toHaveTextContent('source: unavailable');
    expect(kpiRegion()).toHaveTextContent('Manufacture and replacement dates are unknown');
  });
});

describe('BatteryDegradationPage — unit boundary (miles)', () => {
  it('converts SI km → mi at the render edge for the odometer column', () => {
    mockUnits.mockReturnValue(unitReturn('mi'));
    renderPage();

    // 20,000 km → 20,000,000 m ÷ 1609.344 ≈ 12,427.42 mi (real converter).
    const expected = `${fmtNumber(convertDistanceFromSI(20000 * 1000, 'mi'))} mi`;
    expect(within(screen.getByRole('table', { name: 'Degradation history' })).getByText(expected)).toBeInTheDocument();
    // The km rendering must be gone.
    expect(screen.queryByText('20,000.00 km')).toBeNull();
  });

  describe('BatteryDegradationPage — modernization evidence', () => {
    it.each([null, 0, 500_000])('preserves first retained baseline %s and sample timestamps', range_m => {
      const timestamp = '2022-12-30T15:04:03Z';
      mockHealth.mockReturnValue(makeQuery({ data: {
        ...HEALTH,
        history: HEALTH.history.map((point, i) => i === 0 ? {
          ...point, range_m, odometer_m: null,
          range_sampled_at: range_m == null ? null : timestamp,
          odometer_sampled_at: null,
        } : point),
      } }));
      renderPage();
      const table = screen.getByRole('table', { name: 'Range loss over time — data table' });
      expect(within(table).getByRole('columnheader', { name: 'First retained range estimate' })).toBeInTheDocument();
      expect(within(table).queryByRole('columnheader', { name: 'Original range' })).not.toBeInTheDocument();
      const rows = within(table).getAllByRole('row').slice(1);
      for (const row of rows) {
        const cells = within(row).getAllByRole('cell');
        expect(cells[1]).toHaveTextContent(range_m == null ? '—' : `${fmtNumber(range_m / 1000)} km`);
        expect(cells[4]).toHaveTextContent(range_m == null ? '—' : timestamp);
      }
      const history = screen.getByRole('table', { name: 'Degradation history' });
      const firstRow = within(history).getAllByRole('row')[1];
      expect(within(firstRow).getAllByRole('cell')[1]).toHaveTextContent('—');
      expect(screen.getByText(/not new-pack range/)).toBeInTheDocument();
    });

    it('recovers retained range evidence after a refresh failure', () => {
      const refetch = vi.fn();
      mockHealth.mockReturnValue(makeQuery({
        data: HEALTH, error: new ApiError('refresh failed', 500), isError: true, refetch,
      }));
      const view = renderPage();
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'Range loss over time — data table' })).toBeInTheDocument();
      fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
      expect(refetch).toHaveBeenCalledTimes(1);
      mockHealth.mockReturnValue(makeQuery({ data: HEALTH }));
      view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}>
        <BatteryDegradationPage />
      </QueryClientProvider></MemoryRouter>);
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'Range loss over time — data table' })).toBeInTheDocument();
    });
    it('describes the actual prediction interval sample and approximation without claiming calibrated coverage', () => {
      mockHealth.mockReturnValue(makeQuery({
        data: {
          ...HEALTH,
          prediction: {
            ...HEALTH.prediction,
            interval: {
              method: 'approximate_ols_future_observation', sample_count: 3,
              residual_df: 1, multiplier: 2, empirical_coverage: 'unmeasured',
            },
          },
        },
      }));
      renderPage();
      expect(screen.getByRole('group', { name: TREND_IMG })).toBeInTheDocument();
      const explanations = screen.getAllByText(/Approximate OLS prediction band for a future SOH observation/);
      expect(explanations.length).toBeGreaterThan(0);
      expect(explanations[0]).toHaveTextContent('3 valid dated SOH samples');
      expect(explanations[0]).toHaveTextContent('residual degrees of freedom: 1');
      expect(explanations[0]).toHaveTextContent('Half-width = 2');
      expect(explanations[0]).toHaveTextContent('not a Student-t quantile');
      expect(explanations[0]).toHaveTextContent('empirical coverage remains unmeasured in BD-C01');
      expect(screen.queryByRole('img', { name: /95% confidence/ })).not.toBeInTheDocument();
    });

    it('does not infer the fit sample count from retained history when interval metadata is absent', () => {
      renderPage();
      expect(screen.getAllByText(/fit sample basis and multiplier unavailable/).length).toBeGreaterThan(0);
      expect(screen.getByRole('table', { name: 'Health trend & projection — data table' })).toBeInTheDocument();
    });

    it('exposes every forecast point and both prediction bounds without mutating SI history', () => {
      renderPage();
      const table = screen.getByRole('table', { name: 'Health trend & projection — data table' });
      for (const label of ['Date', 'Actual health %', 'Projected %', 'Lower bound', 'Upper bound']) {
        expect(within(table).getByRole('columnheader', { name: label })).toBeInTheDocument();
      }
      expect(within(table).getAllByRole('row')).toHaveLength(6);
      const observed = within(table).getByText('2024-01-01').closest('tr') as HTMLTableRowElement;
      expect(within(observed).getAllByRole('cell').map(cell => cell.textContent))
        .toEqual(['2024-01-01', '91.00%', '—', '—', '—']);
      const firstForecast = within(table).getByText('2025-01').closest('tr') as HTMLTableRowElement;
      expect(within(firstForecast).getAllByRole('cell').map(cell => cell.textContent))
        .toEqual(['2025-01', '—', '89.00%', '87.00%', '91.00%']);
      const forecast = within(table).getByText('2026-01').closest('tr') as HTMLTableRowElement;
      expect(within(forecast).getAllByRole('cell').map(cell => cell.textContent))
        .toEqual(['2026-01', '—', '87.00%', '84.00%', '90.00%']);
      expect(HEALTH.history[1].odometer_m).toBe(20_000_000);
      expect(HEALTH.history[1].capacity_wh).toBe(75_000);
    });

    it('exports original observation dates without graphical join values or new health samples', () => {
      renderPage();
      const figure = screen.getByRole('table', { name: 'Health trend & projection — data table' }).closest('figure');
      expect(figure).not.toBeNull();
      fireEvent.click(within(figure!).getByRole('button', { name: 'Export chart' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
      expect(downloadCSV).toHaveBeenCalledOnce();
      const csv = vi.mocked(downloadCSV).mock.calls[0][1];
      const rows = csv.trim().split(/\r?\n/);
      expect(rows).toHaveLength(6);
      expect(rows[0]).not.toContain('forecast_join');
      expect(rows[3]).toBe('2024-01-01,91,,,,');
      expect(rows[4]).toBe('2025-01,,89,87,91,4');
    });

    it('keeps absent forecast bounds unknown instead of filling an uncertainty band', () => {
      const health = { ...HEALTH, projections: HEALTH.projections.map(point => ({ ...point })) };
      Reflect.set(health.projections[1], 'confidence_low', null);
      Reflect.set(health.projections[1], 'confidence_high', null);
      mockHealth.mockReturnValue(makeQuery({ data: health }));
      renderPage();
      const table = screen.getByRole('table', { name: 'Health trend & projection — data table' });
      const forecast = within(table).getByText('2026-01').closest('tr') as HTMLTableRowElement;
      expect(within(forecast).getAllByRole('cell').map(cell => cell.textContent))
        .toEqual(['2026-01', '—', '87.00%', '—', '—']);
    });

    it('labels accessible range readings in the selected display unit', () => {
      mockUnits.mockReturnValue(unitReturn('mi'));
      renderPage();
      const table = screen.getByRole('table', { name: 'Range loss over time — data table' });
      expect(within(table).getAllByText('310.69 mi')).toHaveLength(4);
      expect(within(table).getByText('282.72 mi')).toBeInTheDocument();
      expect(within(table).queryByText(/ km$/)).not.toBeInTheDocument();
    });

    it.each([
      { name: 'workspace has no vehicle', vehicle: null, query: {}, message: 'No vehicle selected' },
      { name: 'initial analytics refresh is paused', vehicle: 7, query: { fetchStatus: 'paused' }, message: 'Battery analytics loading is paused.' },
    ])('does not assert resolved-empty history when $name', ({ vehicle, query, message }) => {
      mockSelected.mockReturnValue(selected(vehicle));
      mockHealth.mockReturnValue(makeQuery(query));
      renderPage();
      expect(screen.getAllByText(new RegExp(message)).length).toBeGreaterThanOrEqual(8);
      expect(screen.getByRole('heading', { name: 'Degradation history' })).toBeInTheDocument();
      expect(screen.queryByText(/minimum 3 snapshots/)).not.toBeInTheDocument();
      expect(screen.queryByText('No degradation records found.')).not.toBeInTheDocument();
      expect(screen.queryByText('Excellent')).not.toBeInTheDocument();
    });

    it('retains estimates and history after a background refresh failure', () => {
      mockHealth.mockReturnValue(makeQuery({
        data: HEALTH, error: new ApiError('refresh failed', 500), isError: true,
      }));
      renderPage();
      expect(metricValue(kpiRegion(), 'Estimated capacity')).toBe('72.5 kWh');
      expect(screen.getByRole('table', { name: 'Degradation history' })).toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'Health trend & projection — data table' })).toBeInTheDocument();
      expect(screen.queryByText('Server error')).not.toBeInTheDocument();
    });

    it('provides source retry in the summary after an initial fatal failure', () => {
      const refetch = vi.fn();
      mockHealth.mockReturnValue(makeQuery({
        data: undefined, error: new ApiError('initial failure', 500), isError: true, refetch,
      }));
      renderPage();
      fireEvent.click(within(kpiRegion()).getByRole('button', { name: /retry/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Excellent')).not.toBeInTheDocument();
    });
  });
});

describe('BatteryDegradationPage — empty states', () => {
  it('explains recorded charge equivalents separately from fractional per-drive SOC drops', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, total_cycles: 0.5, total_cycles_available: true,
      valid_energy_count: 2, valid_dod_count: 3, avg_depth_of_discharge_pct: 12.345,
    } }));
    renderPage();
    const evidence = screen.getByText('Total cycles').closest('[data-operational-brief]');
    expect(evidence).toHaveTextContent('0.50');
    expect(evidence).toHaveTextContent(/recorded energy added across 2 valid charging sessions divided by nominal original capacity/);
    expect(evidence).toHaveTextContent(/not a measured lifetime count/);
    expect(evidence).toHaveTextContent(/across 3 valid recorded drives/);
    expect(evidence).toHaveTextContent(/per-drive SOC change, not depth of a full discharge\/recharge cycle/);
    expect(screen.getByText('Avg DoD').parentElement).toHaveTextContent(`${fmtNumber(12.345)}%`);
  });

  it('does not present missing charge throughput as zero charge equivalents', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, total_cycles: null, total_cycles_available: false, valid_energy_count: 0,
      avg_depth_of_discharge_pct: null, valid_dod_count: 0,
    } }));
    renderPage();
    expect(screen.getByText('Avg DoD').parentElement).toHaveTextContent('—%');
    expect(screen.getByText('Total cycles').parentElement).not.toHaveTextContent('0.00');
  });

  it('keeps counts and all evidence shells when denominators and scores are unavailable', () => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH,
      valid_charge_count: 0,
      valid_start_soc_count: 0,
      valid_end_soc_count: 0,
      valid_dod_count: 0,
      charge_habits_score: null,
      stress_level: null,
      avg_depth_of_discharge_pct: 0,
      charging_habits: { ...HEALTH.charging_habits, fast_charge_count: 0, slow_charge_count: 0, deep_discharge_count: 0 },
      risk_factors: [{ name: 'fast_charge_ratio', score: 0, available: false, label: 'Unknown', detail: '' }],
      recommendations: [],
    } }));
    renderPage();
    expect(screen.getByText(/—% fast charges, 0 deep discharges/)).toBeInTheDocument();
    expect(screen.queryByText(/optimal for battery longevity/)).not.toBeInTheDocument();
    const risk = screen.getByRole('progressbar', { name: 'Risk score' });
    expect(risk).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('Cycle depth')).toBeInTheDocument();
    expect(screen.getByText('Charge habits')).toBeInTheDocument();
    expect(screen.getByText(/Recommendations will appear/)).toBeInTheDocument();
    const dod = screen.getByText('Avg DoD').parentElement;
    expect(dod).toHaveTextContent('—%');
  });

  it.each([undefined, NaN, Infinity, -1, 0, 0.5])('withholds fast-charge ratios for invalid or empty denominators %s', value => {
    mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, valid_charge_count: value } }));
    renderPage();
    expect(screen.getByText(/—% fast charges, 5 deep discharges/)).toBeInTheDocument();
    expect(screen.getByText('Fast charge').parentElement).toHaveTextContent('—%');
    expect(screen.getByText('Cycle depth').parentElement).toHaveTextContent('60.00/100');
  });

  it.each([undefined, NaN, Infinity, -1, 101])('does not score invalid DoD %s', value => {
    mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, avg_depth_of_discharge_pct: value } }));
    renderPage();
    expect(screen.getByText('Avg DoD').parentElement).toHaveTextContent('—%');
  });

  it.each([0, 12.5])('preserves measured DoD %s and fractional cycles', value => {
    mockHealth.mockReturnValue(makeQuery({ data: {
      ...HEALTH, avg_depth_of_discharge_pct: value, total_cycles: 0.5,
    } }));
    renderPage();
    expect(screen.getByText('Avg DoD').parentElement).toHaveTextContent(`${fmtNumber(value)}%`);
    expect(screen.getByText('Total cycles').closest('[data-operational-brief]')).toHaveTextContent('0.50');
    expect(screen.getByText('Cycle depth').parentElement).toHaveTextContent(`${fmtNumber(100 - value)}/100`);
  });

  it('shows a dedicated placeholder for every empty data source', () => {
    mockHealth.mockReturnValue(makeQuery({
      data: {
        ...HEALTH,
        history: [],
        prediction: { ...HEALTH.prediction, has_enough_data: false },
        charging_habits: {
          ...HEALTH.charging_habits,
          fast_charge_count: 0,
          slow_charge_count: 0,
          deep_discharge_count: 0,
          total_count: 0,
        },
        projections: [],
        risk_factors: [],
        recommendations: [],
      },
    }));
    renderPage();

    // Projection chart (ChartContainer) empties to its shared placeholder.
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.getByText(/Range data will appear/)).toBeInTheDocument();
    expect(screen.getByText(/Need a valid fit/)).toBeInTheDocument();
    expect(screen.getByText(/Risk data will appear/)).toBeInTheDocument();
    expect(screen.getByText(/Recommendations will appear/)).toBeInTheDocument();
    expect(screen.getByText('No degradation records found.')).toBeInTheDocument();
    expect(screen.getByText(/Capacity estimates appear after enough charging/)).toBeInTheDocument();

    // MDC-025/026: a zero-sized sample has no ratio (0/0), but its count is known.
    expect(screen.getByText(/—% fast charges, 0 deep discharges/)).toBeInTheDocument();
    expect(screen.queryByText(/0% fast charges/)).not.toBeInTheDocument();
  });

  it('renders a measured zero fast-charge ratio when slow charges establish a sample', () => {
    mockHealth.mockReturnValue(makeQuery({
      data: {
        ...HEALTH,
        charging_habits: {
          ...HEALTH.charging_habits,
          fast_charge_count: 0,
          slow_charge_count: 20,
          deep_discharge_count: 0,
          total_count: 20,
        },
      },
    }));
    renderPage();
    expect(screen.getByText(/0% fast charges, 0 deep discharges/)).toBeInTheDocument();
    expect(screen.queryByText(/—% fast charges/)).not.toBeInTheDocument();
    expect(metricValue(kpiRegion(), 'Estimated capacity')).toBe('72.5 kWh');
  });

  it('keeps summary metrics when consolidated prediction details are empty', () => {
    mockHealth.mockReturnValue(makeQuery({
      data: {
        ...HEALTH,
        prediction: { ...HEALTH.prediction, has_enough_data: false },
        charging_habits: {
          ...HEALTH.charging_habits,
          fast_charge_count: 0,
          slow_charge_count: 0,
          deep_discharge_count: 0,
          total_count: 0,
        },
        projections: [],
        risk_factors: [],
        recommendations: [],
      },
    }));
    renderPage();

    expect(screen.getByText(/Need a valid fit/)).toBeInTheDocument();
    expect(screen.getByText(/Risk data will appear/)).toBeInTheDocument();
    expect(screen.getByText(/Recommendations will appear/)).toBeInTheDocument();
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('91.00%');
  });
});

describe('BatteryDegradationPage — consolidated query errors', () => {
  it('surfaces the analytics error in every data panel, including the gauge and prediction', () => {
    mockHealth.mockReturnValue(
      makeQuery({ data: undefined, error: new ApiError('boom', 500), isError: true }),
    );
    renderPage();

    expect(screen.getAllByText('Server error').length).toBeGreaterThanOrEqual(3);
    expect(within(heroRegion()).queryByText('Degraded')).toBeNull();
    expect(screen.queryByText(/in approximately/)).toBeNull();
  });
});

describe('BatteryDegradationPage — a11y + interaction', () => {
  it('exposes labelled landmarks and the chart without duplicating the vehicle picker', () => {
    renderPage();

    expect(screen.getByRole('region', { name: 'Battery health summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Health trend & projection' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: TREND_IMG })).toBeInTheDocument();

    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
    expect(setVehicleId).not.toHaveBeenCalled();
  });
});
