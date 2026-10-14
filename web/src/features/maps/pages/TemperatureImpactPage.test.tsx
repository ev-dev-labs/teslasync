/**
 * TemperatureImpactPage — behaviour + hardening coverage.
 *
 * The page has a single default export: the "how outside temperature affects
 * driving efficiency" analytics page. This suite drives it through every
 * meaningful branch by mocking only its data + environment hooks
 * (`useTemperatureImpact` / `useSelectedVehicle` / `useUnits`), the AI narrator,
 * the forms row, the motion primitives, and the charts barrel. Everything on
 * the render boundary is REAL: the page's SI→display conversion runs through the
 * genuine `formatTemperature` / `formatDistance` (from `@/lib/unitConversion`,
 * wired into the `useUnits` double) plus the real `convertTempFromSI` and
 * `fmtNumber`, so the unit maths + KPI aggregation are actually exercised.
 * Network is never touched.
 *
 * Facets covered:
 *   - no-vehicle guard: "select a vehicle" copy everywhere, AI gets no id, and
 *     the hook is invoked with the empty vehicle scope.
 *   - loading: sections show skeletons; no empty/error copy leaks through.
 *   - error (no data): every data-bound section surfaces a retryable QueryError
 *     and Retry calls refetch.
 *   - error (retained data): a failed background refetch keeps last-good content
 *     on screen instead of collapsing into retry panels (hardening).
 *   - populated (km): honest KPI tiles, the full 5-bucket legend, the optimal
 *     analysis copy + delta, the contextual tips, and the recent-drives table.
 *   - unit boundary (mi/°F): re-labels the efficiency unit + runs the real
 *     Wh/km→Wh/mi and °C→°F converters through to KPI + table cells.
 *   - partial data (monthly-only): point sections empty while the seasonal panel
 *     still renders.
 *   - out-of-range clamping (bug fix): extreme temps land in the nearest EDGE
 *     bucket, not the middle one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within, fireEvent, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  formatTemperature as libFormatTemperature,
  formatDistance as libFormatDistance,
  type UnitPref,
} from '@/lib/unitConversion';
import type { TemperatureImpactResponse, TemperatureImpactPoint } from '@/api/hooks/useAnalytics';
import type { ChartDataColumn, ChartDataRow, EmbeddedChartProps } from '@/components/charts';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const chartFrames = vi.hoisted(() => [] as {
  title: string;
  data?: ReadonlyArray<ChartDataRow>;
  columns?: ReadonlyArray<ChartDataColumn>;
}[]);
const scatterSeries = vi.hoisted(() => [] as ReadonlyArray<ChartDataRow>[]);
const savedDates = vi.hoisted(() => ({
  locale: 'en-US',
  mode: 'utc' as 'utc' | 'user' | 'vehicle',
  timezone: 'UTC',
}));

vi.mock('@/hooks/useSettings', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({
    settings: {
      tz_display_default: savedDates.mode,
      timezone_user: savedDates.timezone,
      locale: savedDates.locale,
      decimal_precision: 2,
      currency_symbol: '$',
      base_cost_per_kwh: 0.12,
    },
    locale: savedDates.locale,
    decimals: 2,
    settingsUnavailable: false,
  }),
}));

vi.mock('@/lib/timezone', async (importOriginal) =>
  await importOriginal<typeof import('@/lib/timezone')>(),
);

// ── i18n stub: resolve a string fallback (or the options-bag defaultValue) and
//    interpolate {{var}} placeholders so assertions read on human copy. ────────
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
      return interpolate(second, third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── motion primitives: render children verbatim (strip animation). ──
vi.mock('@/components/motion', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  StaggerContainer: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  StaggerItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// ── charts barrel: preserve scatter inputs without a chart layout engine;
//    the legend, KPI band, badges, table and data alternatives remain assertable.
vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const Null = () => null;
  return {
    ...chartTestDoubles,
    ChartTooltip: Null,
    CHART_COLORS: ['#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'],
    AREA_DEFAULTS: {},
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    ScatterChart: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Scatter: ({ data, children }: { data: ReadonlyArray<ChartDataRow>; children?: ReactNode }) => {
      scatterSeries.push(data);
      return <>{children}</>;
    },
    Cell: Null,
    XAxis: Null,
    YAxis: Null,
    CartesianGrid: Null,
    Tooltip: Null,
    LineChart: Null,
    Line: Null,
    Legend: Null,
    ReferenceLine: Null,
    ComposedChart: Null,
    Bar: Null,
    ChartLegend: Null,
    EmbeddedChart: ({ children, title, data, dataColumns }: EmbeddedChartProps) => {
      chartFrames.push({ title, data, columns: dataColumns });
      return <>{typeof children === 'function' ? children({ annotations: [], hidden: false, hiddenSeries: null }) : children}</>;
    },
  };
});

vi.mock('../components/EfficiencyDetectivePanel', () => ({
  EfficiencyDetectivePanel: () => null,
}));

// ── forms row: VehicleSelect is a bare marker. ──
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

// ── AI narrator: surfaces the vehicleId it was handed so the parent wiring is
//    assertable (production gates its own visibility on ai_mode). ──
vi.mock('@/components/ai/AICabinTemperatureImpactNarrative', () => ({
  AICabinTemperatureImpactNarrative: ({ vehicleId }: { vehicleId?: string | number }) => (
    <div data-testid="ai-narrative" data-vehicle-id={vehicleId ?? ''} />
  ),
}));

// ── side-effect-only hooks + data/environment hooks, driven per test. ──
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/api/hooks/useAnalytics', () => ({ useTemperatureImpact: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => ['var(--series-cold)', 'var(--series-cool)', 'var(--series-mild)', 'var(--series-warm)', 'var(--series-hot)'],
}));

import { useTemperatureImpact } from '@/api/hooks/useAnalytics';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import TemperatureImpactPage from './TemperatureImpactPage';

const mockTempImpact = useTemperatureImpact as unknown as ReturnType<typeof vi.fn>;
const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

// Display-label helpers. The page renders bucket ranges with a U+2013 en-dash
// and a °C/°F suffix — mirror that exactly so assertions read on real copy.
const NDASH = '\u2013';
const B_COLD = '< 0°C';
const B0to10 = `0${NDASH}10°C`;
const B10to20 = `10${NDASH}20°C`;
const B20to30 = `20${NDASH}30°C`;
const B_HOT = '≥ 30°C';

// 1 mile in km — matches the KM_PER_MILE constant the page uses, so the mi
// boundary assertions read on concrete numbers rather than re-deriving maths.
const KM_PER_MILE = 1.609344;

 
function makeQuery(over: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    isPending: false,
    status: 'success',
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function point(over: Partial<TemperatureImpactPoint> = {}): TemperatureImpactPoint {
  return { outside_temp: 15, efficiency_wh_km: 150, distance_km: 30, drive_date: '2026-01-15T12:00:00Z', ...over };
}

/**
 * One point in each of the five temperature buckets. Efficiency is deliberately
 * NOT monotonic with temperature — the 10–20°C bucket (150) is the most
 * efficient (best) and the >30°C bucket (220) the least (worst) — so the page's
 * own best/worst selection is observable rather than trivially ordered.
 */
const POINTS: TemperatureImpactPoint[] = [
  point({ outside_temp: -5, efficiency_wh_km: 210, distance_km: 12, drive_date: '2026-01-05T12:00:00Z' }), // < 0°C
  point({ outside_temp: 5, efficiency_wh_km: 200, distance_km: 20, drive_date: '2026-01-10T12:00:00Z' }), // 0–10°C
  point({ outside_temp: 15, efficiency_wh_km: 150, distance_km: 30, drive_date: '2026-01-15T12:00:00Z' }), // 10–20°C best
  point({ outside_temp: 25, efficiency_wh_km: 180, distance_km: 40, drive_date: '2026-01-20T12:00:00Z' }), // 20–30°C
  point({ outside_temp: 35, efficiency_wh_km: 220, distance_km: 50, drive_date: '2026-01-25T12:00:00Z' }), // > 30°C worst
];

const AVG_WH_KM = (210 + 200 + 150 + 180 + 220) / 5; // 192

const MONTHLY = [
  { month: '2026-01', avg_temp: 5, avg_efficiency: 190, drive_count: 5, total_distance: 100 },
];

function fullData(over: Partial<TemperatureImpactResponse> = {}): TemperatureImpactResponse {
  return { points: POINTS, efficiency: [], vampire_drain: [], monthly_trend: MONTHLY, ...over };
}

 
function selected(vehicleId: number | null) {
  return {
    vehicleId,
    vehicle: null,
    vehicles: vehicleId != null ? [{ id: vehicleId, display_name: 'Model 3', vin: 'VIN7' }] : [],
    setVehicleId: vi.fn(),
  };
}

function makePrefs(distance: 'km' | 'mi', temperature: '°C' | '°F', precision = 2): UnitPref {
  return {
    distance,
    speed: distance === 'mi' ? 'mph' : 'km/h',
    temperature,
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
    precision,
  };
}

/**
 * `useUnits` double that keeps the SI→display formatters REAL (delegating to
 * `@/lib/unitConversion`) while letting each test pin the user's unit prefs.
 */
function units(distance: 'km' | 'mi' = 'km', temperature: '°C' | '°F' = '°C', precision = 2) {
  const prefs = makePrefs(distance, temperature, precision);
  const passthrough = (v: number | null | undefined) => (v == null ? '—' : String(v));
  return {
    unitPrefs: prefs,
    formatTemperature: (v: number | null | undefined) => libFormatTemperature(v, prefs),
    formatDistance: (v: number | null | undefined) => libFormatDistance(v, prefs),
    formatSpeed: passthrough,
    formatEnergy: passthrough,
    formatPressure: passthrough,
    formatDuration: passthrough,
    formatPower: passthrough,
  };
}

function renderPage(): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/analytics/temperature-impact']}>
      <QueryClientProvider client={client}>
        <TemperatureImpactPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpiRegion = () => screen.getByRole('region', { name: 'Summary metrics' });

function latestChart(title: string) {
  const frames = chartFrames.filter((frame) => frame.title === title);
  return frames[frames.length - 1];
}

/** Read a KPI MetricCard's value <p> given its label, scoped to the KPI band. */
function kpiValue(label: string): string {
  const labelEl = within(kpiRegion()).getByText(label);
  return labelEl.closest('[data-operational-metric]')?.querySelector('[data-operational-value]')?.textContent ?? '';
}

beforeEach(() => {
  chartFrames.length = 0;
  scatterSeries.length = 0;
  savedDates.locale = 'en-US';
  savedDates.mode = 'utc';
  savedDates.timezone = 'UTC';
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  mockTempImpact.mockReset();
  mockSelected.mockReset();
  mockUnits.mockReset();

  mockSelected.mockReturnValue(selected(7));
  mockUnits.mockReturnValue(units('km', '°C'));
  mockTempImpact.mockReturnValue(makeQuery({ data: fullData() }));
});

describe('TemperatureImpactPage — measured values and preserved alternatives', () => {
  it('retains incomplete drive rows without inventing zero measurements or diluting valid averages', () => {
    const missing = point();
    Object.assign(missing, {
      outside_temp: null, efficiency_wh_km: null, distance_km: null,
      drive_date: '2026-01-02T12:00:00Z',
    });
    mockTempImpact.mockReturnValue(makeQuery({
      data: fullData({ points: [
        point({ outside_temp: 0, efficiency_wh_km: 0, distance_km: 0, drive_date: '2026-01-01T12:00:00Z' }),
        missing,
        point({ outside_temp: 25, efficiency_wh_km: 200, drive_date: '2026-01-03T12:00:00Z' }),
      ] }),
    }));
    renderPage();

    expect(kpiValue('Avg efficiency')).toBe('100.00 Wh/km');
    expect(kpiValue('Total data points')).toBe('3');
    expect(kpiValue('Best temp range')).toBe(B0to10);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByText('0.00°C')).toBeInTheDocument();
    expect(within(rows[1]).getByText('0.00 Wh/km')).toBeInTheDocument();
    expect(within(rows[1]).getByText('0.00 km')).toBeInTheDocument();
    expect(within(rows[2]).getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('Independent sources incomplete')).toBeInTheDocument();
    expect(missing.efficiency_wh_km).toBeNull();
  });

  it('keeps empty temperature buckets as gaps with cohort counts and unit-aware chart alternatives', () => {
    mockTempImpact.mockReturnValue(makeQuery({
      data: fullData({ points: [point({ outside_temp: -5, efficiency_wh_km: 210 }), point({ outside_temp: 35, efficiency_wh_km: 220 })] }),
    }));
    renderPage();
    const buckets = chartFrames.find((frame) => frame.title === 'Efficiency by temperature range');
    expect(buckets?.data?.map((row) => row.avg)).toEqual([210, null, null, null, 220]);
    expect(buckets?.data?.map((row) => row.count)).toEqual([1, 0, 0, 0, 1]);
    expect(buckets?.data?.map((row) => row.label)).toEqual([B_COLD, B0to10, B10to20, B20to30, B_HOT]);
    const efficiency = buckets?.columns?.find((column) => column.key === 'avg');
    expect(efficiency?.format?.(null)).toBe('—');
    expect(efficiency?.format?.(0)).toBe('0.00 Wh/km');
    expect(chartFrames.find((frame) => frame.title === 'Temperature vs efficiency')?.columns?.map((column) => column.key))
      .toEqual(['drive_date', 'outside_temp', 'efficiency_wh_km', 'distance_km']);
  });

  it('preserves independent monthly series and measured zero without manufacturing missing temperature or counts', () => {
    mockUnits.mockReturnValue(units('mi', '°F'));
    const missingMonth = { ...MONTHLY[0] };
    Object.assign(missingMonth, { avg_temp: null, drive_count: null });
    mockTempImpact.mockReturnValue(makeQuery({
      data: fullData({ monthly_trend: [
        missingMonth,
        { ...MONTHLY[0], month: '2026-02', avg_temp: 0, drive_count: 0 },
      ] }),
    }));
    renderPage();
    const monthly = chartFrames.find((frame) => frame.title === 'Monthly seasonal trend');
    expect(monthly?.data).toEqual([
      { month: '2026-01', drives: null, temp: null },
      { month: '2026-02', drives: 0, temp: 32 },
    ]);
    expect(monthly?.columns?.map((column) => column.key)).toEqual(['month', 'drives', 'temp']);
    const temperature = monthly?.columns?.find((column) => column.key === 'temp');
    expect(temperature?.format?.(32)).toBe('32.00°F');
    expect(temperature?.format?.(null)).toBe('—');
    expect(kpiValue('Total data points')).toBe('5');
  });

  it('keeps distance reachable in mobile rows and recommendations as readable prose', () => {
    const { container } = renderPage();
    const distance = within(screen.getByRole('table')).getByText('30.00 km');
    expect(distance.closest('td')).not.toHaveClass('hidden');
    const recommendation = screen.getByText(`Best efficiency observed in the ${B10to20} range`);
    expect(recommendation.tagName).toBe('P');
    expect(recommendation).toHaveClass('break-words');
    const legendDot = Array.from(container.querySelectorAll('[aria-hidden="true"]'))
      .find((element) => element instanceof HTMLElement && element.style.backgroundColor === 'var(--series-cold)');
    expect(legendDot).toBeDefined();
  });

  it('distinguishes authoritative empty points from an absent point series and retains paused source data', () => {
    const query = makeQuery({ data: fullData({ points: [], monthly_trend: [] }) });
    mockTempImpact.mockReturnValue(query);
    const view = renderPage();
    expect(kpiValue('Total data points')).toBe('0');
    expect(screen.getByText('Source data unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('No drive data available yet')).toHaveLength(6);

    mockTempImpact.mockReturnValue(makeQuery({ data: Object.assign(fullData(), { points: null }) }));
    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <TemperatureImpactPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(kpiValue('Total data points')).toBe('—');
    expect(screen.getByText('Monthly seasonal trend')).toBeInTheDocument();

    mockTempImpact.mockReturnValue(makeQuery({ data: fullData(), fetchStatus: 'paused' }));
    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <TemperatureImpactPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(kpiValue('Avg efficiency')).toBe('192.00 Wh/km');
    expect(screen.getByText('Retained source data')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('30.00 km')).toBeInTheDocument();
  });
});

describe('TemperatureImpactPage — no vehicle selected', () => {
  it('shows the select-a-vehicle copy, hands the AI narrator no id, and scopes the hook to empty', () => {
    mockSelected.mockReturnValue(selected(null));
    mockTempImpact.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();

    const empties = screen.getAllByText('Select a vehicle to view temperature impact');
    // Every point-based section plus the seasonal panel prompt for a vehicle.
    expect(empties.length).toBeGreaterThanOrEqual(5);
    // KPIs degrade to placeholders, not stale numbers.
    expect(kpiValue('Avg efficiency')).toBe('—');
    // The AI narrator is handed no id when the fleet is unselected.
    expect(screen.getByTestId('ai-narrative')).toHaveAttribute('data-vehicle-id', '');
    // The query hook is scoped to the empty vehicle (disabled upstream).
    expect(mockTempImpact).toHaveBeenCalledWith('');
  });
});

describe('TemperatureImpactPage — loading', () => {
  it('shows skeletons and never flashes the empty or error copy', () => {
    mockTempImpact.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderPage();

    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(screen.queryByText('No drive data available yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    // Aggregates are withheld while the first load is in flight.
    expect(kpiRegion()).toHaveAttribute('aria-busy', 'true');
    expect(kpiRegion().querySelector('[data-operational-value]')).toBeNull();
  });
});

describe('TemperatureImpactPage — error with no data', () => {
  it('surfaces a retryable error in every data section and wires Retry to refetch', () => {
    const refetch = vi.fn();
    mockTempImpact.mockReturnValue(
      makeQuery({ data: undefined, error: new Error('boom'), isError: true, refetch }),
    );
    renderPage();

    const retries = screen.getAllByRole('button', { name: 'Retry' });
    // Scatter, optimal, bucket-line, seasonal, recommendations, recent-drives.
    expect(retries.length).toBeGreaterThanOrEqual(5);

    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);

    // The error takes precedence over the empty copy (never both).
    expect(screen.queryByText('No drive data available yet')).not.toBeInTheDocument();
    // An unavailable source cannot claim a measured zero sample count.
    expect(kpiValue('Total data points')).toBe('—');
    expect(kpiValue('Avg efficiency')).toBe('—');
  });
});

describe('TemperatureImpactPage — error with retained data', () => {
  it('opens source-window and bucket captions in the actual Review details drawer', () => {
    renderPage();
    fireEvent.click(within(kpiRegion()).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Summary metrics details' });
    expect(within(drawer).getAllByText(/source window unspecified/).length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText('Lowest average consumption among populated temperature buckets.').length).toBeGreaterThan(0);
    expect(within(drawer).getByText(`${AVG_WH_KM.toFixed(2)} Wh/km`)).toBeInTheDocument();
  });
  it('keeps the last good analysis on screen when a background refetch errors', () => {
    // TanStack Query retains `data` from the last success even when a later
    // refetch fails, so a transient error must NOT collapse the page into
    // retry panels — the still-valid content stays and the header freshness
    // chip owns the degraded signal.
    mockTempImpact.mockReturnValue(
      makeQuery({ data: fullData(), error: new Error('refetch failed'), isError: true }),
    );
    renderPage();

    expect(kpiValue('Total data points')).toBe('5');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText(/most efficient temperature range/i)).toBeInTheDocument();
    // No section degrades into the retry-only error panel while data exists.
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('TemperatureImpactPage — populated (km)', () => {
  it('renders honest KPI tiles derived from the point aggregates', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Temperature impact', level: 1 })).toBeInTheDocument();
    expect(kpiValue('Avg efficiency')).toBe(`${AVG_WH_KM.toFixed(2)} Wh/km`); // 192.00 Wh/km
    expect(kpiValue('Best temp range')).toBe(B10to20);
    expect(kpiValue('Worst temp range')).toBe(B_HOT);
    expect(kpiValue('Total data points')).toBe('5');
    // The AI narrator receives the selected vehicle id as a string.
    expect(screen.getByTestId('ai-narrative')).toHaveAttribute('data-vehicle-id', '7');
  });

  it('renders the full five-bucket colour legend', () => {
    renderPage();
    // 0–10°C and 20–30°C appear ONLY in the legend (they are neither best nor
    // worst), so finding them proves the whole legend rendered.
    for (const label of [B_COLD, B0to10, B10to20, B20to30, B_HOT]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('explains the optimal range with the best figures and the best-vs-worst delta', () => {
    renderPage();

    const optimal = screen.getByText(/most efficient temperature range/i);
    expect(optimal).toHaveTextContent(B10to20);
    expect(optimal).toHaveTextContent('150.00 Wh/km');
    expect(optimal).toHaveTextContent('across 1 drive.');

    const delta = screen.getByText(/Compared to the worst range/i);
    expect(delta).toHaveTextContent(B_HOT);
    expect(delta).toHaveTextContent('70.00 Wh/km'); // 220 - 150
  });

  describe('TemperatureImpactPage — scoped trust, date and precision corrections', () => {
    it('keeps all six sections unresolved with explicit paused context and retry before the first response', () => {
      const refetch = vi.fn();
      mockTempImpact.mockReturnValue(makeQuery({
        data: undefined, isPending: true, status: 'pending', fetchStatus: 'paused', refetch,
      }));
      const { container } = renderPage();
      const blocked = container.querySelectorAll('[data-refresh-blocked]');
      expect(blocked).toHaveLength(6);
      for (const panel of blocked) {
        expect(panel).toHaveAttribute('role', 'status');
        expect(panel).toHaveTextContent('Refresh paused');
        expect(panel).toHaveTextContent('No requested source has returned usable data yet.');
      }
      expect(screen.queryByText('No drive data available yet')).not.toBeInTheDocument();
      expect(screen.queryByText('Select a vehicle to view temperature impact')).not.toBeInTheDocument();
      expect(screen.queryByText(/device is offline/i)).not.toBeInTheDocument();
      expect(kpiValue('Total data points')).toBe('—');
      const retry = within(blocked[0] as HTMLElement).getByRole('button', { name: 'Retry' });
      fireEvent.click(retry);
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('retains the unselected-vehicle prerequisite even when the disabled query is paused', () => {
      mockSelected.mockReturnValue(selected(null));
      mockTempImpact.mockReturnValue(makeQuery({
        data: undefined, isPending: true, status: 'pending', fetchStatus: 'paused',
      }));
      const { container } = renderPage();
      expect(container.querySelector('[data-refresh-blocked]')).toBeNull();
      expect(screen.getAllByText('Select a vehicle to view temperature impact')).toHaveLength(6);
      expect(mockTempImpact).toHaveBeenCalledWith('');
      expect(screen.getAllByRole('link', { name: 'Manage vehicles' })).toHaveLength(6);
    });

    it('does not turn an initial failure into a paused or empty result', () => {
      mockTempImpact.mockReturnValue(makeQuery({
        data: undefined, isPending: false, isError: true, error: new Error('failed'),
        fetchStatus: 'paused',
      }));
      const { container } = renderPage();
      expect(container.querySelector('[data-refresh-blocked]')).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThanOrEqual(6);
      expect(screen.queryByText('No drive data available yet')).not.toBeInTheDocument();
    });

    it('uses saved date context in cells and chart alternatives and refreshes memoized columns on preference changes', () => {
      const data = fullData({ points: [
        point({ drive_date: '2026-01-01T00:30:00Z' }),
        point({ drive_date: 'invalid-date' }),
      ] });
      const original = JSON.stringify(data);
      mockTempImpact.mockReturnValue(makeQuery({ data }));
      savedDates.mode = 'user';
      savedDates.timezone = 'America/Los_Angeles';
      savedDates.locale = 'de-DE';
      const view = renderPage();
      expect(within(screen.getByRole('table')).getByText('31. Dez. 2025')).toBeInTheDocument();
      expect(within(screen.getByRole('table')).getByText('—')).toBeInTheDocument();
      const dateColumn = () => latestChart('Temperature vs efficiency')?.columns?.find((column) => column.key === 'drive_date');
      expect(dateColumn()?.format?.('2026-01-01T00:30:00Z')).toBe('31. Dez. 2025');
      expect(dateColumn()?.format?.('invalid-date')).toBe('—');

      savedDates.mode = 'utc';
      savedDates.locale = 'en-US';
      view.rerender(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient()}>
            <TemperatureImpactPage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      expect(within(screen.getByRole('table')).getByText('Jan 1, 2026')).toBeInTheDocument();
      expect(screen.queryByText('31. Dez. 2025')).not.toBeInTheDocument();
      expect(dateColumn()?.format?.('2026-01-01T00:30:00Z')).toBe('Jan 1, 2026');
      expect(JSON.stringify(data)).toBe(original);
    });

    it.each([
      ['°C', 12.345, '12.345°C', '12.3°C'],
      ['°F', 54.221, '54.221°F', '54.2°F'],
    ] as const)('keeps unrounded %s chart numbers while formatting only the saved-precision output', (temperature, expected, precise, rounded) => {
      const data = fullData({ monthly_trend: [
        { ...MONTHLY[0], avg_temp: 12.345 },
        { ...MONTHLY[0], month: '2026-02', avg_temp: -12.345 },
      ] });
      const original = JSON.stringify(data);
      mockTempImpact.mockReturnValue(makeQuery({ data }));
      mockUnits.mockReturnValue(units('km', temperature, 3));
      setGlobalPrecision(3);
      renderPage();
      const monthly = () => latestChart('Monthly seasonal trend');
      const column = () => monthly()?.columns?.find((item) => item.key === 'temp');
      expect(monthly()?.data?.[0].temp).toBeCloseTo(expected, 12);
      expect(monthly()?.data?.[1].temp).toBeCloseTo(temperature === '°C' ? -12.345 : 9.779, 12);
      expect(column()?.format?.(monthly()?.data?.[0].temp)).toBe(precise);
      act(() => setGlobalPrecision(1));
      expect(column()?.format?.(monthly()?.data?.[0].temp)).toBe(rounded);
      expect(monthly()?.data?.[0].temp).toBeCloseTo(expected, 12);
      expect(JSON.stringify(data)).toBe(original);
    });

    it.each(['°C', '°F'] as const)('describes the existing inclusive hot membership in %s without changing thresholds or signs', (temperature) => {
      const readings = [-80, -0.01, 0, 9.999, 10, 19.999, 20, 29.999, 30, 60, 70];
      const data = fullData({ points: readings.map((outside_temp) => point({ outside_temp })) });
      const original = JSON.stringify(data);
      mockTempImpact.mockReturnValue(makeQuery({ data }));
      mockUnits.mockReturnValue(units('km', temperature));
      renderPage();
      const buckets = chartFrames.find((frame) => frame.title === 'Efficiency by temperature range');
      expect(buckets?.data?.map((row) => row.count)).toEqual([2, 2, 2, 2, 3]);
      expect(buckets?.data?.[4].label).toBe(temperature === '°C' ? '≥ 30°C' : '≥ 86°F');
      expect(buckets?.data?.map((row) => row.avg)).toEqual([150, 150, 150, 150, 150]);
      const plotted = scatterSeries[scatterSeries.length - 1];
      expect(plotted?.map((row) => row.outside_temp)).toEqual(
        temperature === '°C' ? readings : readings.map((celsius) => celsius * 9 / 5 + 32),
      );
      expect(plotted?.[0].fill).toBe('var(--series-cold)');
      expect(plotted?.[readings.length - 1].fill).toBe('var(--series-hot)');
      expect(JSON.stringify(data)).toBe(original);
    });

    it('keeps plural fallback copy for a best bucket with multiple drives', () => {
      mockTempImpact.mockReturnValue(makeQuery({ data: fullData({ points: [point(), point()] }) }));
      renderPage();
      expect(screen.getByText(/most efficient temperature range/i)).toHaveTextContent('across 2 drives.');
    });
  });

  it('renders the three contextual recommendations', () => {
    renderPage();
    expect(screen.getByText(`Best efficiency observed in the ${B10to20} range`)).toBeInTheDocument();
    expect(screen.getByText(/Precondition your cabin in cold weather/i)).toBeInTheDocument();
    expect(screen.getByText(/Park in shade during hot weather/i)).toBeInTheDocument();
  });

  it('renders the recent-drives table with converted temperature, efficiency, and distance cells', () => {
    renderPage();
    const table = screen.getByRole('table');

    expect(within(table).getByText('Temperature')).toBeInTheDocument();
    expect(within(table).getByText('Efficiency')).toBeInTheDocument();
    expect(within(table).getByText('Distance')).toBeInTheDocument();

    // The 10–20°C drive (temp 15°C, eff 150 Wh/km, dist 30 km).
    expect(within(table).getByText('15.00°C')).toBeInTheDocument();
    expect(within(table).getByText('150.00 Wh/km')).toBeInTheDocument();
    expect(within(table).getByText('30.00 km')).toBeInTheDocument();
  });
});

describe('TemperatureImpactPage — unit boundary (mi/°F)', () => {
  it('re-labels the efficiency unit and runs the real Wh/km→Wh/mi and °C→°F converters', () => {
    mockUnits.mockReturnValue(units('mi', '°F'));
    renderPage();

    // Avg 192 Wh/km → 192 * 1.609344 → 309.09 Wh/mi.
    expect(kpiValue('Avg efficiency')).toBe(`${(AVG_WH_KM * KM_PER_MILE).toFixed(2)} Wh/mi`);
    // Best bucket 10–20°C → 50–68°F.
    expect(kpiValue('Best temp range')).toBe(`50${NDASH}68°F`);
    expect(within(kpiRegion()).queryByText(B10to20)).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    // Temp 15°C → 59°F; eff 150 Wh/km → 241.40 Wh/mi.
    expect(within(table).getByText('59.00°F')).toBeInTheDocument();
    expect(within(table).getByText(`${(150 * KM_PER_MILE).toFixed(2)} Wh/mi`)).toBeInTheDocument();
  });
});

describe('TemperatureImpactPage — partial data (seasonal only)', () => {
  it('renders the seasonal panel while every point-based section shows empty', () => {
    mockTempImpact.mockReturnValue(makeQuery({ data: fullData({ points: [] }) }));
    renderPage();

    // Scatter, optimal, bucket-line, recommendations, recent-drives = 5 empties;
    // the monthly panel keeps its (inert) chart and is NOT one of them.
    const empties = screen.getAllByText('No drive data available yet');
    expect(empties).toHaveLength(5);
    expect(screen.getByText('Monthly seasonal trend')).toBeInTheDocument();
    expect(kpiValue('Total data points')).toBe('0');
  });
});

describe('TemperatureImpactPage — out-of-range temperature clamping', () => {
  it('clamps extreme readings to the nearest edge bucket instead of the middle one', () => {
    // -80°C is below every bucket and 70°C is above every bucket. A middle
    // fallback (the old bug) would file BOTH into 10–20°C; the fix routes them
    // to the coldest / hottest edge buckets respectively.
    mockTempImpact.mockReturnValue(
      makeQuery({
        data: fullData({
          points: [
            point({ outside_temp: -80, efficiency_wh_km: 250, distance_km: 10, drive_date: '2026-01-01T12:00:00Z' }),
            point({ outside_temp: 70, efficiency_wh_km: 350, distance_km: 12, drive_date: '2026-07-01T12:00:00Z' }),
          ],
        }),
      }),
    );
    renderPage();

    // Best = coldest edge (250 Wh/km), Worst = hottest edge (350 Wh/km).
    expect(kpiValue('Best temp range')).toBe(B_COLD);
    expect(kpiValue('Worst temp range')).toBe(B_HOT);
    // The middle bucket must NOT capture the extremes.
    expect(within(kpiRegion()).queryByText(B10to20)).not.toBeInTheDocument();
    expect(kpiValue('Avg efficiency')).toBe('300.00 Wh/km'); // (250 + 350) / 2
  });
});
