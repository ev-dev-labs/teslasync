/**
 * DrivingTab — behaviour + hardening coverage.
 *
 * DrivingTab is the Driving slice of the Fleet Analytics page. It threads a
 * single `UseQueryResult<FleetAnalytics>` down into (a) a six-card performance
 * band (<DrivingPerformanceCards>), (b) seven self-sufficient <AnalyticsPanel>
 * charts (speed / distance / duration distributions, hourly pattern, temp-vs-
 * efficiency scatter, daily trend, efficiency trend), and (c) a temperature
 * stats panel (<DrivingTemperatureStats>). Every panel owns its own loading /
 * error / empty state, so the chart panels must never all vanish behind one
 * `{data && …}` gate.
 *
 * This suite drives every branch:
 *   - loading  → the performance band + every panel render skeletons; no card
 *     labels leak through and no chart is drawn.
 *   - empty    → all eight panels (7 chart + 1 temperature) surface the shared
 *     empty state; no chart is drawn.
 *   - error    → all eight panels render a retryable QueryError; clicking Retry
 *     is wired to the query's refetch, and the banner wins over stale data.
 *   - populated→ all seven charts render, each series binds its dataKey, every
 *     chart is an accessible image, and both sibling bands compose in.
 *   - units    → this is the hardening payload. The backend serves distance in
 *     SI km and efficiency in Wh/km; the daily-trend, hourly and efficiency-
 *     trend series are now projected into the user's unit through the REAL
 *     convertDistanceFromSI so the plotted magnitude matches the axis label
 *     (previously raw km leaked under an "mi" label). Miles + Fahrenheit
 *     preferences re-project every affected series and relabel the charts.
 *   - filter   → the efficiency trend keeps only positive-efficiency rows.
 *   - null-safe→ a row full of nulls collapses to safe zeros, never NaN.
 *
 * Only the leaf primitives that can't render meaningfully in jsdom are doubled:
 * the recharts barrel (ResponsiveContainer measures 0×0 in jsdom so series data
 * would be unobservable) and framer-motion's <FadeIn>. `useOnlineStatus` is
 * pinned online so QueryError stays on its retryable branch, and `useSettings`
 * is a mutable double so the unit branches are testable. Everything else —
 * <MetricCard>, <AnalyticsPanel>, <EmptyState>, <QueryError>, <Skeleton>, the
 * real useUnits + lib/unitConversion + lib/numberFormat, and both sibling
 * components — renders for real, so the wiring is exercised end-to-end. Network
 * is never touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/feedback';
import type { ReactNode } from 'react';
import type { FleetAnalytics } from '@/api/types';
import { DrivingTab } from './DrivingTab';
import type { FleetAnalyticsQuery } from './constants';

// ── i18n: echo the English fallback (2nd arg) so assertions read on copy. ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── keep QueryError on its online "Can't reach server" branch (enabled Retry). ──
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

// ── framer-motion wrapper: render children directly, drop the animation. ──
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  // MetricBar animates its fill via `motion.div`, and the real `ToastProvider`
  // (rendered here, not mocked) needs `AnimatePresence` for its toast stack
  // transitions. Both now come from this barrel rather than 'framer-motion'
  // directly, so the mock must supply them too.
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div';
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

// ── Mutable settings double so the unit branches are testable. The real
//    useUnits + lib/unitConversion run on top of this, so conversion is real. ──
const settingsRef = vi.hoisted(() => ({
  unit_of_length: 'km' as 'km' | 'mi',
  unit_of_temp: 'C' as 'C' | 'F',
}));

vi.mock('@/hooks/useSettings', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        unit_of_length: settingsRef.unit_of_length,
        unit_of_temp: settingsRef.unit_of_temp,
        unit_of_pressure: 'bar',
        locale: 'en-US',
        decimal_precision: 2,
      },
      isMiles: settingsRef.unit_of_length === 'mi',
      isFahrenheit: settingsRef.unit_of_temp === 'F',
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

// ── recharts barrel double: ResponsiveContainer passes children through, each
//    chart surfaces its `data` prop (as JSON), each cartesian series surfaces
//    its dataKey binding, and Scatter surfaces its projected `data` array so
//    the page-computed conversions are directly assertable. ──
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const Inert = () => null;
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const makeChart =
    (testid: string) =>
    ({ data, children }: { data?: unknown; children?: ReactNode }) => (
      <div data-testid={testid}>
        <span data-testid={`${testid}-data`}>{JSON.stringify(data ?? [])}</span>
        {children}
      </div>
    );
  const Series = ({
    dataKey,
    name,
    stroke,
  }: {
    dataKey?: string;
    name?: string;
    stroke?: string;
  }) => (
    <span
      data-testid={`series-${String(dataKey ?? '')}`}
      data-key={String(dataKey ?? '')}
      data-name={String(name ?? '')}
      data-stroke={String(stroke ?? '')}
    />
  );
  const ScatterSeries = ({ data, fill }: { data?: unknown; fill?: string }) => (
    <span data-testid="series-scatter" data-fill={String(fill ?? '')}>
      <span data-testid="series-scatter-data">{JSON.stringify(data ?? [])}</span>
    </span>
  );
  return {
    ...actual,
    ChartTooltip: Inert,
    ChartGradient: Inert,
    chartGrid: null,
    axisTick: {},
    axisTickSm: {},
    chartMarginLabeled: {},
    chartAnimation: {},
    AREA_DEFAULTS: {},
    CHART_COLORS: ['#c0', '#c1', '#c2', '#c3', '#c4', '#c5'],
    safe: (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0),
    ResponsiveContainer: Passthrough,
    BarChart: makeChart('chart-bar'),
    ComposedChart: makeChart('chart-composed'),
    AreaChart: makeChart('chart-area'),
    ScatterChart: makeChart('chart-scatter'),
    Bar: Series,
    Line: Series,
    Area: Series,
    Scatter: ScatterSeries,
    XAxis: Inert,
    YAxis: Inert,
    ZAxis: Inert,
    Tooltip: Inert,
    Legend: Inert,
  };
});

// ── data builders ────────────────────────────────────────────────────────────

function stat(min = 0, avg = 0, max = 0): Record<string, number> {
  return { min, max, avg, median: avg, p95: max, count: 10 };
}

/** Build a FleetAnalytics whose `drive_analytics` is empty by default. */
function analytics(over: Record<string, unknown> = {}): FleetAnalytics {
  return {
    drive_analytics: {
      speed_distribution: [],
      distance_distribution: [],
      hourly_pattern: [],
      temp_vs_efficiency: [],
      daily_trend: [],
      duration_distribution: [],
      ...over,
    },
  } as unknown as FleetAnalytics;
}

/** A fully-populated drive_analytics payload (SI: km, Wh/km, °C, km/h, kW). */
function populated(over: Record<string, unknown> = {}): FleetAnalytics {
  return analytics({
    speed_distribution: [{ range: '0-50', count: 5 }],
    distance_distribution: [{ range: '0-10', count: 3 }],
    duration_distribution: [{ range: '0-15', count: 2 }],
    hourly_pattern: [{ hour: 8, drives: 4, distance: 20 }],
    temp_vs_efficiency: [{ temp: 20, efficiency: 150, distance: 12 }],
    daily_trend: [{ date: '2026-01-01', drives: 2, distance: 10, efficiency: 150 }],
    speed_stats: stat(0, 40, 120),
    power_stats: stat(0, 20, 150),
    regen_stats: stat(0, 10, 60),
    distance_stats: stat(0, 15, 80),
    temperature: { inside: stat(18, 21, 24), outside: stat(5, 12, 20) },
    ...over,
  });
}

interface QueryOverride {
  data?: FleetAnalytics | undefined;
  error?: Error | null;
  isLoading?: boolean;
  isError?: boolean;
  refetch?: () => void;
}

function makeQuery(over: QueryOverride = {}): FleetAnalyticsQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  } as unknown as FleetAnalyticsQuery;
}

function renderTab(query: FleetAnalyticsQuery) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <DrivingTab query={query} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type Row = Record<string, number | string>;

/** All ComposedChart `data` payloads (there are two: hourly + daily trend). */
function composedDataSets(): Row[][] {
  return screen
    .getAllByTestId('chart-composed-data')
    .map((el) => JSON.parse(el.textContent || '[]'));
}
function hourlyRows(): Row[] {
  return composedDataSets().find((r) => r.length > 0 && 'hour' in r[0]) ?? [];
}
function dailyRows(): Row[] {
  return composedDataSets().find((r) => r.length > 0 && 'date' in r[0]) ?? [];
}
function scatterRows(): Array<Record<string, number>> {
  return JSON.parse(screen.getByTestId('series-scatter-data').textContent || '[]');
}
function effTrendRows(): Row[] {
  return JSON.parse(screen.getByTestId('chart-area-data').textContent || '[]');
}

beforeEach(() => {
  settingsRef.unit_of_length = 'km';
  settingsRef.unit_of_temp = 'C';
});

// ── Loading ───────────────────────────────────────────────────────────────────

describe('DrivingTab — loading', () => {
  it('renders skeletons and withholds the performance cards and every chart', () => {
    const { container } = renderTab(makeQuery({ isLoading: true }));

    // Panel titles always render (they frame the section)…
    expect(screen.getByText('Speed Distribution')).toBeInTheDocument();
    expect(screen.getByText('Efficiency Trend')).toBeInTheDocument();
    // …but the performance band is a skeleton — no card labels leak through…
    expect(screen.queryByText('Top Speed')).toBeNull();
    // …pulsing skeletons are on screen…
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // …and no chart has been drawn yet.
    expect(screen.queryByTestId('chart-bar')).toBeNull();
    expect(screen.queryAllByTestId('chart-composed')).toHaveLength(0);
    expect(screen.queryByTestId('chart-scatter')).toBeNull();
    expect(screen.queryByTestId('chart-area')).toBeNull();
  });
});

// ── Empty ─────────────────────────────────────────────────────────────────────

describe('DrivingTab — empty', () => {
  it('shows an empty state per panel and draws no charts', () => {
    renderTab(makeQuery({ data: analytics() }));

    // Seven chart panels + the temperature panel = eight shared empty states,
    // none of them collapsed behind a single page-level gate.
    expect(screen.getAllByRole('status')).toHaveLength(8);
    expect(screen.getByText('No speed data')).toBeInTheDocument();
    expect(screen.getByText('No daily trend data')).toBeInTheDocument();
    expect(screen.getByText('No efficiency trend data')).toBeInTheDocument();
    expect(screen.getByText('No temperature stats')).toBeInTheDocument();

    // No chart on the empty branch.
    expect(screen.queryByTestId('chart-bar')).toBeNull();
    expect(screen.queryByTestId('chart-scatter')).toBeNull();
  });
});

// ── Error ─────────────────────────────────────────────────────────────────────

describe('DrivingTab — error', () => {
  it('renders a retryable error in every panel and wires Retry to refetch', () => {
    const refetch = vi.fn();
    renderTab(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    // One QueryError per panel (7 chart panels + temperature), all online.
    expect(screen.getAllByRole('alert')).toHaveLength(8);
    expect(screen.getAllByText("Can't reach server")).toHaveLength(8);

    const retries = screen.getAllByRole('button', { name: /retry/i });
    expect(retries).toHaveLength(8);

    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);

    // The error banner is shown instead of any chart.
    expect(screen.queryByTestId('chart-composed')).toBeNull();
  });

  it('prioritises the error banner over stale data', () => {
    // Even if TanStack Query retained the last-good payload, isError wins.
    renderTab(makeQuery({ isError: true, error: new Error('stale'), data: populated() }));
    expect(screen.getAllByText("Can't reach server")).toHaveLength(8);
    expect(screen.queryByTestId('chart-area')).toBeNull();
  });
});

// ── Populated ──────────────────────────────────────────────────────────────────

describe('DrivingTab — populated', () => {
  it('renders all seven panels with their charts and both sibling bands', () => {
    renderTab(makeQuery({ data: populated() }));

    // Every panel title frames its section.
    expect(screen.getByText('Speed Distribution')).toBeInTheDocument();
    expect(screen.getByText('Trip Distance Distribution')).toBeInTheDocument();
    expect(screen.getByText('Hourly Driving Pattern')).toBeInTheDocument();
    expect(screen.getByText('Temperature vs Efficiency')).toBeInTheDocument();
    expect(screen.getByText('Daily Driving Trend')).toBeInTheDocument();
    expect(screen.getByText('Drive Duration Distribution')).toBeInTheDocument();
    expect(screen.getByText('Efficiency Trend')).toBeInTheDocument();

    // Three bar charts, two composed, one scatter, one area = seven charts.
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(3);
    expect(screen.getAllByTestId('chart-composed')).toHaveLength(2);
    expect(screen.getByTestId('chart-scatter')).toBeInTheDocument();
    expect(screen.getByTestId('chart-area')).toBeInTheDocument();

    // Both sibling bands compose in (performance cards + temperature stats).
    expect(screen.getByText('Top Speed')).toBeInTheDocument();
    expect(screen.getByText('Longest Drive')).toBeInTheDocument();
    expect(screen.getByText('Inside Min')).toBeInTheDocument();
    expect(screen.getByText('Outside Max')).toBeInTheDocument();
  });

  it('binds every chart series to its expected dataKey', () => {
    renderTab(makeQuery({ data: populated() }));

    // Three distribution bars all key on `count`.
    expect(screen.getAllByTestId('series-count')).toHaveLength(3);
    // `drives` is a bar (hourly) and a line (daily); `distance` a line + area.
    expect(screen.getAllByTestId('series-drives')).toHaveLength(2);
    expect(screen.getAllByTestId('series-distance')).toHaveLength(2);
    // Efficiency trend area + the scatter series.
    expect(screen.getByTestId('series-efficiency')).toBeInTheDocument();
    expect(screen.getByTestId('series-scatter')).toBeInTheDocument();
  });

  it('exposes each chart as an accessible image with a unit-aware label', () => {
    renderTab(makeQuery({ data: populated() }));

    expect(screen.getAllByRole('img')).toHaveLength(7);
    expect(
      screen.getByRole('img', { name: 'Trip count by speed range' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Daily driving distance and drive count (km)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Daily efficiency trend (Wh/km)' }),
    ).toBeInTheDocument();
  });

  it('passes SI km/Wh-per-km straight through when the unit is metric', () => {
    renderTab(makeQuery({ data: populated() }));

    // km preference → the projected values equal the raw SI values.
    expect(dailyRows()[0].distance).toBe(10);
    expect(hourlyRows()[0].distance).toBe(20);
    expect(effTrendRows()[0].efficiency).toBe(150);
    // The scatter carries the same three fields, unconverted in metric.
    expect(scatterRows()[0]).toEqual({ temp: 20, efficiency: 150, distance: 12 });
  });
});

// ── Distance-unit branch (the hardening payload) ───────────────────────────────

describe('DrivingTab — miles preference', () => {
  it('re-projects distance + efficiency series and relabels the charts', () => {
    settingsRef.unit_of_length = 'mi';
    renderTab(
      makeQuery({
        data: populated({
          hourly_pattern: [{ hour: 8, drives: 4, distance: 16.09344 }],
          temp_vs_efficiency: [{ temp: 20, efficiency: 100, distance: 16.09344 }],
          daily_trend: [{ date: '2026-01-01', drives: 2, distance: 100, efficiency: 100 }],
        }),
      }),
    );

    // 100 km → ~62.14 mi through the REAL convertDistanceFromSI (not raw km).
    expect(dailyRows()[0].distance).toBeCloseTo(62.14, 1);
    expect(dailyRows()[0].distance).not.toBe(100);
    // 16.09344 km → exactly 10 mi.
    expect(hourlyRows()[0].distance).toBeCloseTo(10, 5);
    // Efficiency Wh/km → Wh/mi (× 1.609344).
    expect(effTrendRows()[0].efficiency).toBeCloseTo(160.93, 1);

    // The scatter re-projects distance + efficiency; temp stays (°C).
    expect(scatterRows()[0].distance).toBeCloseTo(10, 5);
    expect(scatterRows()[0].efficiency).toBeCloseTo(160.93, 1);
    expect(scatterRows()[0].temp).toBe(20);

    // Accessible labels reflect the active units.
    expect(
      screen.getByRole('img', { name: 'Daily driving distance and drive count (mi)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Daily efficiency trend (Wh/mi)' }),
    ).toBeInTheDocument();
  });
});

// ── Temperature-unit branch ────────────────────────────────────────────────────

describe('DrivingTab — Fahrenheit preference', () => {
  it('projects scatter temperature and the temperature-stats cards to °F', () => {
    settingsRef.unit_of_temp = 'F';
    renderTab(makeQuery({ data: populated() }));

    // Scatter temp 20 °C → 68 °F through the REAL convertTempFromSI.
    expect(scatterRows()[0].temp).toBe(68);
    // Distance/efficiency untouched by the temperature flip (still metric).
    expect(scatterRows()[0].distance).toBe(12);
    // The temperature-stats band re-projects too: inside min 18 °C → 64.4 °F.
    expect(screen.getByText('64.4')).toBeInTheDocument();
  });
});

// ── Efficiency-trend filter branch ─────────────────────────────────────────────

describe('DrivingTab — efficiency trend filter', () => {
  it('keeps only positive-efficiency rows while daily trend keeps them all', () => {
    renderTab(
      makeQuery({
        data: populated({
          daily_trend: [
            { date: '2026-01-01', drives: 1, distance: 5, efficiency: 150 },
            { date: '2026-01-02', drives: 1, distance: 6, efficiency: 0 },
            { date: '2026-01-03', drives: 1, distance: 7 },
          ],
        }),
      }),
    );

    // Efficiency trend drops the zero + missing-efficiency rows…
    expect(effTrendRows()).toHaveLength(1);
    expect(effTrendRows()[0].efficiency).toBe(150);
    // …but the daily-trend chart still plots every day.
    expect(dailyRows()).toHaveLength(3);
  });

  it('shows the efficiency-trend empty state when no row has efficiency', () => {
    renderTab(
      makeQuery({
        data: populated({
          daily_trend: [{ date: '2026-01-01', drives: 1, distance: 5, efficiency: 0 }],
        }),
      }),
    );

    // The daily trend still renders (it has a row)…
    expect(screen.getAllByTestId('chart-composed').length).toBeGreaterThanOrEqual(1);
    // …while the efficiency-trend panel collapses to its empty state.
    expect(screen.getByText('No efficiency trend data')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-area')).toBeNull();
  });
});

// ── Null-safety ────────────────────────────────────────────────────────────────

describe('DrivingTab — null safety', () => {
  it('collapses null distance/efficiency/temp to safe zeros without NaN', () => {
    renderTab(
      makeQuery({
        data: populated({
          hourly_pattern: [{ hour: 9, drives: null, distance: null }],
          temp_vs_efficiency: [{ temp: null, efficiency: null, distance: null }],
          daily_trend: [{ date: '2026-02-01', drives: null, distance: null, efficiency: 200 }],
        }),
      }),
    );

    // Charts still render — the rows exist, the values are just null.
    expect(screen.getAllByTestId('chart-composed')).toHaveLength(2);
    expect(screen.getByTestId('chart-scatter')).toBeInTheDocument();
    expect(screen.getByTestId('chart-area')).toBeInTheDocument();

    // Every null projection collapses to 0, never NaN.
    expect(hourlyRows()[0].distance).toBe(0);
    expect(dailyRows()[0].distance).toBe(0);
    expect(scatterRows()[0]).toEqual({ temp: 0, efficiency: 0, distance: 0 });
    // The surviving efficiency (200 Wh/km) is preserved through the projection.
    expect(effTrendRows()[0].efficiency).toBe(200);
    expect(Number.isNaN(dailyRows()[0].distance as number)).toBe(false);
  });
});
