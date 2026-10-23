/**
 * BatteryDegradationTrendWidget — behaviour, branch + hardening coverage.
 *
 * The widget is the dashboard's battery-state-of-health tile. Its surface
 * under test:
 *
 *   1. Responsive layout: standard/wide renders a titled shell + a
 *      max-range hero (WidgetBigNumber) + a range-trend area chart; compact
 *      (1×1) drops the title, icon and chart and shows the hero only.
 *   2. The range-trend chart path: it plots the converted `avg_range`
 *      series and applies the shared dashed CartesianGrid. (Regression
 *      guard for the `{...chartGrid}` → `{chartGrid}` fix — the grid
 *      previously received React-internal props instead of its styling.)
 *   3. The hero range prefers `current_range`, falling back to the last
 *      monthly-trend range; a genuine `0` is a measured reading, never
 *      the missing-data placeholder.
 *   4. The since-new delta distinguishes zero, missing and negative rates.
 *   5. Loading / error / empty branches (never a blank panel). The error
 *      branch surfaces the shared QueryError panel — before the fix the widget
 *      only forwarded `isError` and a fetch failure masqueraded as "no data".
 *   6. Freshness-control refresh → refetch.
 *   7. Null-safety of a malformed / partial payload (no crash; em-dash
 *      placeholders; the chart preserves gaps rather than inventing zeros).
 *   8. Vehicle selection: an explicit `vehicleId` wins, otherwise the first
 *      vehicle from `useVehicles` is used.
 *
 * Strategy (mirrors AnalyticsSummaryWidget.test.tsx + ElevationProfile.test.tsx):
 *   - The data hooks are mocked with hoisted vi.fn()s so the network is never
 *     touched. The widget keeps the REAL number formatter + REAL chart palette
 *     builder (only useTheme is stubbed so useThemeChartPalette resolves).
 *   - recharts primitives are replaced with DOM doubles that expose their key
 *     props via data-* attributes, so the chart path renders under jsdom and is
 *     genuinely assertable (ResponsiveContainer renders 0×0 otherwise).
 *   - react-i18next resolves the developer fallback string.
 *   - matchMedia is shimmed so framer-motion (via the freshness chip) settles.
 *   - Renders are wrapped in <MemoryRouter> because the error branch mounts
 *     <QueryError>, which calls useNavigate.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * dashboard tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (useReducedMotion, read by the
// freshness chip) reads it at module load. Report reduced motion so the
// freshness dot settles deterministically.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
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

const { degradationMock, vehiclesMock, unitsMock } = vi.hoisted(() => ({
  degradationMock: vi.fn(),
  vehiclesMock: vi.fn(),
  unitsMock: vi.fn(),
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

vi.mock('@/api/hooks/useEnergy', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useEnergy')>('@/api/hooks/useEnergy');
  return { ...actual, useBatteryDegradation: (...args: unknown[]) => degradationMock(...args) };
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles');
  return { ...actual, useVehicles: () => vehiclesMock() };
});

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles, useMeasuredAxisWidth: vi.fn(actual.useMeasuredAxisWidth) };
});

// useThemeChartPalette() calls useTheme(), which throws outside a
// <ThemeProvider>. Stub useTheme with a fixed theme/mode so the REAL
// buildChartPalette runs and yields a genuine series palette. Mocking the
// provider (rather than wrapping it) also avoids its on-mount settings fetch.
vi.mock('@/components/ui/ThemeProvider', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/ThemeProvider')>(
    '@/components/ui/ThemeProvider',
  );
  return {
    ...actual,
    useTheme: () => ({
      themeId: 'neon-cyan',
      modeId: 'dark',
      theme: {
        id: 'neon-cyan',
        name: 'Neon Cyan',
        primary: '#00b4d8',
        primaryRGB: '0,180,216',
        accent: '#e63946',
        accentRGB: '230,57,70',
      },
      mode: { id: 'dark', name: 'Dark', colorScheme: 'dark' },
      setTheme: vi.fn(),
      setMode: vi.fn(),
      setCustomColors: vi.fn(),
      themes: {},
      modes: {},
    }),
  };
});

// Replace the recharts primitives the widget renders (via the @/components/charts
// barrel) with DOM doubles that expose their props. `...actual` keeps every
// other recharts export real, so the barrel and `chartGrid` (a <CartesianGrid/>
// element built at module load) resolve against the same doubles.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  const React = await vi.importActual<typeof import('react')>('react');
  type P = Record<string, unknown> & { children?: ReactNode };
  const ResponsiveContainer = (props: P) =>
    React.createElement('div', { 'data-testid': 'responsive-container' }, props.children as ReactNode);
  const AreaChart = (props: P) =>
    React.createElement(
      'div',
      {
        'data-testid': 'area-chart',
        'data-points': String(Array.isArray(props.data) ? props.data.length : 0),
        'data-margin': JSON.stringify(props.margin),
      },
      React.createElement('svg', null, props.children as ReactNode),
    );
  const Area = (props: P) =>
    React.createElement('g', {
      'data-testid': 'area',
      'data-key': String(props.dataKey ?? ''),
      'data-name': String(props.name ?? ''),
      'data-stroke': String(props.stroke ?? ''),
    });
  const CartesianGrid = (props: P) =>
    React.createElement('g', {
      'data-testid': 'cartesian-grid',
      'data-dash': String(props.strokeDasharray ?? ''),
    });
  const ReferenceLine = (props: P) =>
    React.createElement('g', { 'data-testid': 'reference-line', 'data-y': String(props.y ?? '') });
  const XAxis = (props: P) =>
    React.createElement('g', { 'data-testid': 'x-axis', 'data-key': String(props.dataKey ?? '') });
  const YAxis = (props: P) => React.createElement('g', {
    'data-testid': 'y-axis',
    'data-width': String(props.width),
    'data-domain': JSON.stringify(props.domain),
    'data-tick': JSON.stringify(props.tick),
    'data-label': (props.tickFormatter as (v: number) => string)(95.123456),
  });
  const Tooltip = () => React.createElement('g', { 'data-testid': 'tooltip' });
  return { ...actual, ResponsiveContainer, AreaChart, Area, CartesianGrid, ReferenceLine, XAxis, YAxis, Tooltip };
});

import BatteryDegradationTrendWidget from './BatteryDegradationTrendWidget';
import { useMeasuredAxisWidth } from '@/components/charts';
import type { WidgetSize } from './types';
import type { DegradationData } from '@/types/energy';

/* ── Fixtures ─────────────────────────────────────────────────────── */

const TREND = [
  { month: 'Jan', avg_health: 99, avg_capacity: 74, avg_range: 400 },
  { month: 'Feb', avg_health: 97, avg_capacity: 73, avg_range: 392 },
  { month: 'Mar', avg_health: 95, avg_capacity: 72, avg_range: 385 },
];

// Legacy `current_health` deliberately differs from `current_health_pct` so the
// coalescing-precedence assertions are unambiguous.
const BASE: Record<string, unknown> = {
  current_health: 88,
  current_capacity: 72,
  current_cycles: 512,
  current_range: 385,
  current_temp: 20,
  stress_level: 'Low',
  fast_charge_ratio: 0.2,
  snapshots: [],
  monthly_trend: TREND,
  prediction: null,
  charging_habits: null,
  current_health_pct: 95.4,
  degradation_rate_pct_per_month: 0.42,
  projected_80pct_date: null,
  projections: [],
  risk_factors: [],
  recommendations: [],
};

function makeData(overrides: Record<string, unknown> = {}): DegradationData {
  return { ...BASE, ...overrides } as unknown as DegradationData;
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

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <BatteryDegradationTrendWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.mocked(useMeasuredAxisWidth).mockClear();
  degradationMock.mockReset();
  vehiclesMock.mockReset();
  degradationMock.mockReturnValue(makeQuery({ data: makeData() }));
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
  unitsMock.mockReset();
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
});
afterEach(() => vi.restoreAllMocks());

describe('BatteryDegradationTrendWidget axis gutter', () => {
  it.each([2, 3])('measures converted range labels and explicit bounds at %i columns', cols => {
    degradationMock.mockReturnValue(makeQuery({ data: makeData({
      monthly_trend: [
        { month: 'Jan', avg_range: 412 },
        { month: 'Feb', avg_range: 405 },
        { month: 'Mar', avg_range: Number.NaN },
        { month: 'Apr', avg_range: null },
      ],
    }) }));
    renderWidget({ cols, rows: 2 });
    const options = vi.mocked(useMeasuredAxisWidth).mock.lastCall![0];
    expect(options.labels).toEqual(['412', '405']);
    expect(options.fontSize).toBe(10);
    expect(options.minWidth).toBe(60);
    expect(options.padding).toBe(24);
    const axis = screen.getByTestId('y-axis');
    expect(Number(axis.getAttribute('data-width'))).toBeGreaterThanOrEqual(60);
    expect(axis).toHaveAttribute('data-label', '95');
    expect(axis).toHaveAttribute('data-domain', JSON.stringify(['dataMin - 5', 'dataMax + 5']));
    expect(JSON.parse(screen.getByTestId('area-chart').getAttribute('data-margin')!).left).toBe(4);
  });

  it('keeps compact summaries chart-free and disables measurement', () => {
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.queryByTestId('area-chart')).toBeNull();
    expect(vi.mocked(useMeasuredAxisWidth).mock.lastCall![0].enabled).toBe(false);
  });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('BatteryDegradationTrendWidget', () => {
  it('preserves the chart and all summaries when its cached refresh fails', () => {
    degradationMock.mockReturnValue(makeQuery({ data: makeData(), error: new Error('transient'), isError: true }));
    renderWidget();
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-points', '3');
    expect(screen.getByText('Max range at 100%')).toBeInTheDocument();
    expect(screen.getByText('385')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('renders the titled shell with the max-range headline and degradation delta', () => {
    renderWidget();

    // Titled shell — no gutted panel.
    expect(screen.getByText('Battery degradation')).toBeInTheDocument();

    // Headline is the current max range (current_range 385 km), whole units.
    expect(screen.getByText('Max range at 100%')).toBeInTheDocument();
    expect(screen.getByText('385')).toBeInTheDocument();

    // Delta vs the first trend month (400 km) and the since-new subtitle.
    expect(screen.getByText('−3.8%')).toBeInTheDocument();
    expect(screen.getByText('since new (400 km)')).toBeInTheDocument();
  });

  it('plots the range series with the shared dashed grid', () => {
    renderWidget();

    // Three trend points reach the chart.
    const chart = screen.getByTestId('area-chart');
    expect(chart).toHaveAttribute('data-points', '3');

    // The area draws the `avg_range` series, labelled from i18n, with a
    // theme-derived stroke colour.
    const area = screen.getByTestId('area');
    expect(area).toHaveAttribute('data-key', 'range');
    expect(area).toHaveAttribute('data-name', 'Range');
    expect(area.getAttribute('data-stroke')).toMatch(/^#[0-9a-f]{6}$/i);

    // Regression guard: `{chartGrid}` forwards the shared dashed styling. The
    // old `<CartesianGrid {...chartGrid} />` spread dropped it (data-dash '').
    expect(screen.getByTestId('cartesian-grid')).toHaveAttribute('data-dash', '3 3');

    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'month');

    // The chart path renders — not the "need more data" fallback.
    expect(screen.queryByText('More data needed for trend')).not.toBeInTheDocument();
  });

  it('shows the "more data needed" fallback when there is a single trend point', () => {
    degradationMock.mockReturnValue(
      makeQuery({ data: makeData({ monthly_trend: [TREND[0]] }) }),
    );
    renderWidget();

    expect(screen.getByText('More data needed for trend')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    // Headline still renders alongside the fallback.
    expect(screen.getByText('Max range at 100%')).toBeInTheDocument();
  });

  it('treats a genuine 0 range as real data (nullish, not falsy, coalescing)', () => {
    degradationMock.mockReturnValue(
      makeQuery({ data: makeData({ current_range: 0 }) }),
    );
    renderWidget();

    // Measured 0 renders as a real headline, never the missing placeholder.
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('−100.0%')).toBeInTheDocument();
  });

  it('falls back to the last trend range when current_range is absent', () => {
    degradationMock.mockReturnValue(
      makeQuery({ data: makeData({ current_range: undefined }) }),
    );
    renderWidget();

    expect(screen.getByText('385')).toBeInTheDocument();
  });

  it('keeps a genuine zero degradation visible', () => {
    degradationMock.mockReturnValue(
      makeQuery({ data: makeData({ current_range: 400 }) }),
    );
    renderWidget();

    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
  });

  it('shows the empty state (keeping the titled shell) when there is no data', () => {
    degradationMock.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget();

    expect(screen.getByText('Battery degradation')).toBeInTheDocument();
    expect(screen.getByText('No degradation data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Headline remains visible with an unknown reading.
    expect(screen.getByText('Max range at 100%')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('renders a skeleton placeholder while the query is loading', () => {
    degradationMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    const shell = container.querySelector('[aria-busy="true"][data-data-state="initial"]');
    expect(shell).toBeInTheDocument();
    const skeletons = shell?.querySelectorAll('.h-full.min-h-24.rounded-xl[aria-hidden="true"]');
    expect(skeletons).toHaveLength(1);
    expect(skeletons?.[0]).toHaveClass('w-full', 'bg-[var(--skeleton-bg)]');
    expect(skeletons?.[0]).not.toHaveClass('animate-pulse');
    expect(skeletons?.[0].childElementCount).toBe(0);
    expect(screen.queryByText('SoH')).not.toBeInTheDocument();
    expect(screen.queryByText('Degradation')).not.toBeInTheDocument();
    expect(screen.queryByText('Cycles')).not.toBeInTheDocument();
    expect(screen.queryByText('No degradation data')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('responsive-container')).not.toBeInTheDocument();
    expect(container.querySelector('[data-operational-value]')).not.toBeInTheDocument();
  });

  it('surfaces the error panel (not the empty state) when the query fails', () => {
    // Regression guard: the widget now forwards `error` so a fetch failure is
    // distinguishable from genuinely-empty data.
    degradationMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The misleading "no data" empty state must NOT appear on error.
    expect(screen.queryByText('No degradation data')).not.toBeInTheDocument();
    expect(screen.queryByText('SoH')).not.toBeInTheDocument();
    // The error branch replaces the header, so there is no refresh control.
    expect(screen.queryByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });

  it('drops the title and chart in the compact 1×1 layout, keeping the headline', () => {
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('Max range at 100%')).toBeInTheDocument();
    expect(screen.getByText('385')).toBeInTheDocument();
    // Compact hides the title and the chart.
    expect(screen.queryByText('Battery degradation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('refetches when the freshness control is activated', () => {
    const q = makeQuery({ data: makeData() });
    degradationMock.mockReturnValue(q);
    renderWidget();

    const refresh = screen.getByRole('button', { name: /Refresh data/ });
    expect(q.refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('is null-safe: a malformed payload renders em-dash placeholders without crashing', () => {
    degradationMock.mockReturnValue(
      makeQuery({
        data: makeData({
          current_range: undefined,
          current_health_pct: undefined,
          current_health: undefined,
          current_cycles: null,
          degradation_rate_pct_per_month: null,
          monthly_trend: [
            { month: 'A' },
            { month: 'B', avg_health: null, avg_range: undefined },
          ],
        }),
      }),
    );

    expect(() => renderWidget()).not.toThrow();

    // The headline collapses to the em-dash placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('Max range at 100%')).toBeInTheDocument();
    // Missing range samples are not coerced into a zero-range chart.
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.getByText('More data needed for trend')).toBeInTheDocument();
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget();
    expect(degradationMock).toHaveBeenCalledWith('7');
  });

  it('uses the explicit vehicleId prop over the vehicle list', () => {
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(degradationMock).toHaveBeenCalledWith('42');
  });
});
