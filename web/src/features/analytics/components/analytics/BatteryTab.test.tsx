/**
 * BatteryTab — behaviour + hardening coverage.
 *
 * BatteryTab is the Battery slice of the Fleet Analytics page. It threads a
 * single `UseQueryResult<FleetAnalytics>` down into (a) a five-card KPI band
 * summarising the LATEST battery-trend row and (b) four self-sufficient
 * <AnalyticsPanel> charts (health timeline, capacity, range, degradation &
 * cycles). Every panel owns its own loading / error / empty state, so the four
 * chart panels must never all vanish behind one `{data && …}` gate.
 *
 * This suite drives every branch:
 *   - loading  → the KPI band renders as a skeleton (no labels/values) and the
 *     panels render pulsing skeletons; no chart is drawn.
 *   - empty    → the band still renders all five labelled cards with an em-dash
 *     placeholder (latest === null) and all four panels show the shared empty
 *     state; no chart is drawn.
 *   - error    → all four panels render a retryable QueryError; clicking Retry
 *     is wired to the query's refetch.
 *   - populated→ the KPI band surfaces the LATEST row's values through the real
 *     numberFormat + real useUnits/formatEnergy code paths, all four charts
 *     render, each series binds its dataKey, and the range series is projected
 *     into the user's distance unit.
 *   - null-safe→ a latest row full of nulls collapses to safe zeros, never NaN
 *     or a crash.
 *   - units    → flipping the user's distance preference to miles re-projects
 *     both the "Est. Range" card and the range chart via the REAL
 *     convertDistanceFromSI, and relabels the accessible chart title.
 *
 * Only the leaf primitives that can't render meaningfully in jsdom are doubled:
 * the recharts barrel (`ResponsiveContainer` measures 0×0 in jsdom so series
 * data would be unobservable) and framer-motion's <FadeIn>. `useOnlineStatus`
 * is pinned online so QueryError stays on its retryable "Can't reach server"
 * branch, and `useSettings` is a mutable double so the distance-unit branch is
 * testable. Everything else — <MetricCard>, <AnalyticsPanel>, <EmptyState>,
 * <QueryError>, <Skeleton>, the real useUnits + lib/unitConversion +
 * lib/numberFormat — renders for real, so the label → value → unit wiring is
 * exercised end-to-end. Network is never touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/feedback';
import type { ReactNode } from 'react';
import type { FleetAnalytics } from '@/api/types';
import { BatteryTab } from './BatteryTab';
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

// ── Mutable settings double so the distance-unit branch is testable. The real
//    useUnits + lib/unitConversion run on top of this, so conversion is real. ──
const settingsRef = vi.hoisted(() => ({ unit_of_length: 'km' as 'km' | 'mi' }));

vi.mock('@/hooks/useSettings', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        unit_of_length: settingsRef.unit_of_length,
        unit_of_temp: 'C',
        unit_of_pressure: 'bar',
        locale: 'en-US',
        decimal_precision: 2,
      },
      isMiles: settingsRef.unit_of_length === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

// ── recharts barrel double: ResponsiveContainer passes children through, and
//    each chart surfaces its `data` prop (as JSON) plus its series so the
//    page-computed values + dataKey bindings are directly assertable. ──
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
    AreaChart: makeChart('chart-area'),
    LineChart: makeChart('chart-line'),
    ComposedChart: makeChart('chart-composed'),
    Area: Series,
    Line: Series,
    XAxis: Inert,
    YAxis: Inert,
    Tooltip: Inert,
    Legend: Inert,
  };
});

type BatteryRow = FleetAnalytics['battery_trend'][number];

function row(over: Partial<BatteryRow> = {}): BatteryRow {
  return {
    date: '2026-01-01',
    health_score: 95,
    capacity_wh: 75000,
    degradation_pct: 1.5,
    range_km: 500,
    cycle_count: 100,
    ...over,
  };
}

function analytics(trend: BatteryRow[]): FleetAnalytics {
  return { battery_trend: trend } as unknown as FleetAnalytics;
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
          <BatteryTab query={query} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** All `chart-line` data payloads parsed back from JSON (there are two). */
function lineChartRows(): Array<Array<Record<string, number>>> {
  return screen
    .getAllByTestId('chart-line-data')
    .map((el) => JSON.parse(el.textContent || '[]'));
}

/** The single line chart carrying the projected `range` field. */
function rangeRows(): Array<Record<string, number>> {
  return lineChartRows().find((rows) => rows.length > 0 && 'range' in rows[0]) ?? [];
}

// The KPI band reads the LAST row as "latest". Two rows prove that selection.
const TREND: BatteryRow[] = [
  row({ date: '2026-01-01', health_score: 96.7, capacity_wh: 78000, degradation_pct: 1.11, range_km: 505, cycle_count: 210 }),
  row({ date: '2026-02-01', health_score: 92.4, capacity_wh: 75000, degradation_pct: 3.21, range_km: 480, cycle_count: 312 }),
];

beforeEach(() => {
  settingsRef.unit_of_length = 'km';
});

// ── Loading ─────────────────────────────────────────────────────────────────

describe('BatteryTab — loading', () => {
  it('renders skeletons and withholds both the KPI values and the charts', () => {
    const { container } = renderTab(makeQuery({ isLoading: true }));

    // The KPI band is a skeleton — no card labels or values leak through.
    expect(screen.queryByText('Health Score')).toBeNull();
    expect(screen.queryByText('Est. Range')).toBeNull();
    // Pulsing skeletons are on screen…
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // …but no chart has been drawn yet.
    expect(screen.queryByTestId('chart-area')).toBeNull();
    expect(screen.queryAllByTestId('chart-line')).toHaveLength(0);
    expect(screen.queryByTestId('chart-composed')).toBeNull();
  });
});

// ── Empty ───────────────────────────────────────────────────────────────────

describe('BatteryTab — empty', () => {
  it('keeps all five labelled cards (em-dash) and shows an empty state per panel', () => {
    renderTab(makeQuery({ data: analytics([]) }));

    // Band never disappears: every labelled card is present…
    expect(screen.getByText('Health Score')).toBeInTheDocument();
    expect(screen.getByText('Capacity')).toBeInTheDocument();
    expect(screen.getByText('Est. Range')).toBeInTheDocument();
    // …and each of the five values collapses to the em-dash placeholder.
    expect(screen.getAllByText('—')).toHaveLength(5);

    // All four panels surface the shared empty state rather than a blank panel.
    expect(screen.getAllByText('No battery trend data available')).toHaveLength(4);
    expect(screen.getAllByRole('status')).toHaveLength(4);

    // No chart is drawn on the empty branch.
    expect(screen.queryByTestId('chart-area')).toBeNull();
  });
});

// ── Error ───────────────────────────────────────────────────────────────────

describe('BatteryTab — error', () => {
  it('renders a retryable error in every panel and wires Retry to refetch', () => {
    const refetch = vi.fn();
    renderTab(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    // One QueryError per panel, all on the online (alert) branch.
    expect(screen.getAllByRole('alert')).toHaveLength(4);
    expect(screen.getAllByText("Can't reach server")).toHaveLength(4);

    const retries = screen.getAllByRole('button', { name: /retry/i });
    expect(retries).toHaveLength(4);

    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);

    // The error banner is shown instead of any chart.
    expect(screen.queryByTestId('chart-area')).toBeNull();
  });

  it('prioritises the error banner over stale data', () => {
    // Even if TanStack Query retained the last-good rows, isError wins.
    renderTab(makeQuery({ isError: true, error: new Error('stale'), data: analytics(TREND) }));
    expect(screen.getAllByText("Can't reach server")).toHaveLength(4);
    expect(screen.queryByTestId('chart-area')).toBeNull();
  });
});

// ── Populated ───────────────────────────────────────────────────────────────

describe('BatteryTab — populated', () => {
  it('surfaces the LATEST trend row through the real formatters', () => {
    renderTab(makeQuery({ data: analytics(TREND) }));

    // Values come from the second (latest) row, not the first.
    expect(screen.getAllByText('92.4').length).toBeGreaterThan(0);     // health_score, 1dp
    expect(screen.getAllByText('75.0 kWh').length).toBeGreaterThan(0); // capacity_wh via formatEnergy
    expect(screen.getAllByText('3.21').length).toBeGreaterThan(0);     // degradation_pct, 2dp
    expect(screen.getAllByText('480').length).toBeGreaterThan(0);      // range_km → km, 0dp
    expect(screen.getAllByText('312').length).toBeGreaterThan(0);      // cycle_count int
  });

  it('renders all four panels and binds every chart series to its dataKey', () => {
    renderTab(makeQuery({ data: analytics(TREND) }));

    // Panel titles frame each section.
    expect(screen.getByText('Health Score Timeline')).toBeInTheDocument();
    expect(screen.getByText('Capacity Trend')).toBeInTheDocument();
    expect(screen.getByText('Range Trend')).toBeInTheDocument();
    expect(screen.getByText('Degradation & Cycles')).toBeInTheDocument();

    // Four charts: one area, two lines, one composed.
    expect(screen.getByTestId('chart-area')).toBeInTheDocument();
    expect(screen.getAllByTestId('chart-line')).toHaveLength(2);
    expect(screen.getByTestId('chart-composed')).toBeInTheDocument();

    // Each series is bound to its display-boundary field.
    expect(screen.getByTestId('series-health_score')).toBeInTheDocument();
    expect(screen.getByTestId('series-capacity')).toBeInTheDocument();
    expect(screen.getByTestId('series-range')).toBeInTheDocument();
    expect(screen.getByTestId('series-degradation_pct')).toBeInTheDocument();
    expect(screen.getByTestId('series-cycle_count')).toBeInTheDocument();
  });

  it('exposes each chart with accessible semantics and descriptive labels', () => {
    renderTab(makeQuery({ data: analytics(TREND) }));

    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(
      screen.getByRole('group', {
        name: 'Battery degradation and charge cycle count over time',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Battery health score trend over time' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Battery range trend over time (km)' }),
    ).toBeInTheDocument();
  });

  it('projects the range series into km without mutating the source rows', () => {
    renderTab(makeQuery({ data: analytics(TREND) }));

    const rows = rangeRows();
    expect(rows).toHaveLength(2);
    // In km the projected range equals the SI km value, and the raw field is kept.
    expect(rows[1].range).toBe(480);
    expect(rows[1].range_km).toBe(480);
  });
});

// ── Null-safety ─────────────────────────────────────────────────────────────

describe('BatteryTab — null safety', () => {
  it('collapses a latest row full of nulls to safe zeros without crashing', () => {
    const nulled = row({
      date: '2026-03-01',
      health_score: null as unknown as number,
      capacity_wh: null as unknown as number,
      degradation_pct: null as unknown as number,
      range_km: null as unknown as number,
      cycle_count: null as unknown as number,
    });
    renderTab(makeQuery({ data: analytics([nulled]) }));

    expect(screen.getByText('0.0')).toBeInTheDocument();      // health_score → safe(0)
    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();  // capacity_wh → safe(0)
    expect(screen.getByText('0.00')).toBeInTheDocument();     // degradation_pct → safe(0)

    // Charts still render (the row exists) and the range projection is 0, not NaN.
    expect(screen.getByTestId('chart-area')).toBeInTheDocument();
    expect(rangeRows()[0].range).toBe(0);
  });
});

// ── Distance-unit branch ────────────────────────────────────────────────────

describe('BatteryTab — miles preference', () => {
  it('re-projects the range card + chart to miles and relabels the chart', () => {
    settingsRef.unit_of_length = 'mi';
    const trend = [
      row({ date: '2026-01-02', health_score: 90, capacity_wh: 70000, degradation_pct: 2, range_km: 480, cycle_count: 100 }),
    ];
    renderTab(makeQuery({ data: analytics(trend) }));

    // 480 km → ~298 mi through the REAL convertDistanceFromSI.
    expect(screen.getByText('298')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();

    // The projected chart value is the converted distance, not the raw km.
    expect(rangeRows()[0].range).toBeCloseTo(298.26, 1);
    expect(rangeRows()[0].range).not.toBe(480);

    // The accessible chart label reflects the active unit.
    expect(
      screen.getByRole('img', { name: 'Battery range trend over time (mi)' }),
    ).toBeInTheDocument();
  });
});
