/**
 * PowerOutputChart — contract, branch, hardening + a11y cover.
 *
 * <PowerOutputChart data loading /> is the presentational per-drive peak/regen
 * power area chart in the drivetrain-health stack. It never fetches: the parent
 * hands it a pre-shaped `ChartDataPoint[]`, so the tests drive it directly with
 * hand-built samples.
 *
 * Recharts renders 0×0 under jsdom (no layout engine), so the real `<AreaChart>`
 * never paints its SVG — which would make the component's own wiring (the two
 * `powerMax` / `powerMin` series keys, their violet/red strokes, the
 * `dtPwrMax/MinGrad` fills, the `date` X key, the "kW" Y label, and the zero
 * reference line) invisible to the DOM. Following the repo convention (see the
 * SocChart / PowerHistoryChart tests) we swap the shared `@/components/charts`
 * barrel for lightweight doubles that surface those props as inspectable
 * attributes. Only the pixel-pushing chart library + container chrome are
 * stubbed; PowerOutputChart's own logic (the `<= 1`-sample empty branch, the
 * null guard, the URL-hidden-series wiring, and the SR fallback-table shaping)
 * still runs.
 *
 * The URL-persisted hidden-series hook is mocked through a `vi.hoisted` holder
 * so each test can decide which series has been toggled off in the URL and
 * assert both the per-`<Area>` `hide` flag and the legend's dimming state.
 *
 * Facets covered:
 *   1. READY chrome  — titled + subtitled heading, labelled `img` region, the
 *                      fixed 300px height, the `drivetrain-power-output` chartKey.
 *   2. READY series  — every sample reaches the chart; peak/regen areas wire the
 *                      right keys, strokes, gradient fills, and i18n names.
 *   3. READY axes    — both gradients mount, X keys on `date`, Y labels "kW",
 *                      grid + tooltip + the zero reference line render.
 *   4. READY table   — the SR/forced-colors fallback table is built from every
 *                      sample using the snake_case display keys.
 *   5. LEGEND idle   — nothing toggled → both traces visible, legend un-dimmed.
 *   6. LEGEND toggle — hiding `powerMax` in the URL hides only that `<Area>` and
 *                      dims only its legend entry; the shared chartKey is used.
 *   7. EMPTY (0)     — an empty dataset flags the container empty, no chart body.
 *   8. THRESHOLD (1) — a lone sample is not chartable (`<= 1`) → empty state.
 *   9. LOADING       — the loading flag withholds the chart body.
 *  10. NULL-SAFE     — an (untyped-at-runtime) undefined data prop renders the
 *                      empty state instead of throwing on `.length`.
 *  11. HARDENING     — nullish peak/regen samples coerce to 0 in the table cells.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { ChartDataPoint } from './constants';

// ── Controllable URL-hidden-series state shared with the hoisted hook mock. ──
const H = vi.hoisted(() => ({
  chartKeyArg: '' as string,
  hiddenKeys: new Set<string>(),
}));

// i18n stub: resolve the fallback string so assertions read real user copy.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// URL-persisted hidden-series hook: a controllable double so a test can pretend
// a series was toggled off in the URL and assert the source both hides that
// `<Area>` and dims it in the legend. Also records the chartKey it was called
// with so we can pin the URL-state namespace.
vi.mock('@/hooks/useHiddenSeries', () => ({
  useHiddenSeries: (chartKey: string) => {
    H.chartKeyArg = chartKey;
    return {
      hidden: H.hiddenKeys,
      isHidden: (k: string) => H.hiddenKeys.has(k),
      toggle: vi.fn(),
      reset: vi.fn(),
    };
  },
}));

// charts: prop-echoing doubles. Recharts' <ResponsiveContainer> measures 0×0
// under jsdom, so the real chart never paints — the doubles surface the wiring.
// The ChartContainer double mirrors the real one: it always surfaces the SR
// fallback table data, but only renders the chart body when neither loading nor
// empty (a spinner / empty marker takes its place otherwise).
vi.mock('@/components/charts', () => ({
  ChartContainer: ({
    title,
    subtitle,
    ariaLabel,
    chartKey,
    loading,
    empty,
    height,
    data,
    dataColumns,
    children,
  }: {
    title?: string;
    subtitle?: string;
    ariaLabel?: string;
    chartKey?: string;
    loading?: boolean;
    empty?: boolean;
    height?: number;
    data?: ReadonlyArray<Record<string, unknown>>;
    dataColumns?: ReadonlyArray<{ key: string; label: string }>;
    children?: ReactNode;
  }) => (
    <section
      data-testid="chart-container"
      data-loading={String(!!loading)}
      data-empty={String(!!empty)}
      data-height={String(height ?? '')}
      data-chartkey={String(chartKey ?? '')}
      data-table={JSON.stringify(data ?? [])}
      data-columns={JSON.stringify((dataColumns ?? []).map((c) => c.key))}
    >
      <h3>{title}</h3>
      {subtitle ? <p data-testid="chart-subtitle">{subtitle}</p> : null}
      {/* Mirror the real container: a labelled img region that swaps in a
          spinner / empty marker before ever rendering the chart body. */}
      <div role="img" aria-label={ariaLabel}>
        {loading ? (
          <div data-testid="chart-loading" />
        ) : empty ? (
          <div data-testid="chart-empty" />
        ) : (
          children
        )}
      </div>
    </section>
  ),
  ChartLegend: ({ state }: { state?: { isHidden?: (k: string) => boolean } }) => (
    <div
      data-testid="chart-legend"
      data-has-state={String(!!state)}
      data-max-hidden={String(state?.isHidden?.('powerMax') ?? '')}
      data-min-hidden={String(state?.isHidden?.('powerMin') ?? '')}
    />
  ),
  ChartTooltip: () => null,
  AREA_DEFAULTS: {},
  areaGradient: (id: string, color: string) => (
    <div data-testid="area-gradient" data-id={id} data-color={color} />
  ),
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
    <div data-testid="area-chart" data-count={String((data ?? []).length)}>
      {children}
    </div>
  ),
  Area: ({
    dataKey,
    stroke,
    fill,
    name,
    hide,
  }: {
    dataKey?: string;
    stroke?: string;
    fill?: string;
    name?: string;
    hide?: boolean;
  }) => (
    <div
      data-testid="area"
      data-key={String(dataKey)}
      data-stroke={String(stroke)}
      data-fill={String(fill)}
      data-name={String(name)}
      data-hide={String(!!hide)}
    />
  ),
  XAxis: ({ dataKey }: { dataKey?: string }) => (
    <div data-testid="x-axis" data-key={String(dataKey)} />
  ),
  YAxis: ({ label }: { label?: { value?: string } }) => (
    <div data-testid="y-axis" data-label={String(label?.value ?? '')} />
  ),
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ReferenceLine: ({ y, stroke }: { y?: number; stroke?: string }) => (
    <div data-testid="reference-line" data-y={String(y)} data-stroke={String(stroke)} />
  ),
}));

// jsdom lacks matchMedia (framer-motion's useReducedMotion via <FadeIn>).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

import { PowerOutputChart } from './PowerOutputChart';

// Minimal per-sample fixture — PowerOutputChart reads `date` (X), `powerMax`,
// and `powerMin` (the two series); the remaining fields are irrelevant here.
function point(overrides: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return {
    date: '2026-07-01',
    powerMax: 250,
    powerMin: -70,
    outsideTemp: 20,
    distance: 40,
    ...overrides,
  };
}

const twoSamples = (): ChartDataPoint[] => [
  point({ date: '2026-07-01', powerMax: 250, powerMin: -70 }),
  point({ date: '2026-07-02', powerMax: 300, powerMin: -90 }),
];

beforeEach(() => {
  H.chartKeyArg = '';
  H.hiddenKeys = new Set();
});

afterEach(cleanup);

describe('PowerOutputChart — ready state', () => {
  it('renders the titled, subtitled, labelled chart figure at the 300px height under the shared chartKey', () => {
    render(<PowerOutputChart data={twoSamples()} />);

    expect(screen.getByRole('heading', { name: 'Power Output History' })).toBeInTheDocument();
    expect(screen.getByTestId('chart-subtitle')).toHaveTextContent(
      'Peak and regen power per drive over time',
    );
    expect(
      screen.getByRole('img', {
        name: 'Per-drive peak and regen motor power output history area chart',
      }),
    ).toBeInTheDocument();

    const container = screen.getByTestId('chart-container');
    expect(container).toHaveAttribute('data-height', '300');
    expect(container).toHaveAttribute('data-empty', 'false');
    expect(container).toHaveAttribute('data-loading', 'false');
    expect(container).toHaveAttribute('data-chartkey', 'drivetrain-power-output');
    // The URL-state namespace the source subscribed to matches the chartKey.
    expect(H.chartKeyArg).toBe('drivetrain-power-output');
  });

  it('feeds every drive sample to the area chart and wires the peak + regen series', () => {
    render(
      <PowerOutputChart
        data={[
          point({ date: '2026-07-01', powerMax: 250, powerMin: -70 }),
          point({ date: '2026-07-02', powerMax: 300, powerMin: -90 }),
          point({ date: '2026-07-03', powerMax: 280, powerMin: -60 }),
        ]}
      />,
    );

    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-count', '3');

    const areas = screen.getAllByTestId('area');
    expect(areas).toHaveLength(2);

    // Peak Power → violet, filled from the max gradient.
    expect(areas[0]).toHaveAttribute('data-key', 'powerMax');
    expect(areas[0]).toHaveAttribute('data-name', 'Peak Power (kW)');
    expect(areas[0]).toHaveAttribute('data-stroke', '#8b5cf6');
    expect(areas[0]).toHaveAttribute('data-fill', 'url(#dtPwrMaxGrad)');

    // Regen Power → red, filled from the min gradient.
    expect(areas[1]).toHaveAttribute('data-key', 'powerMin');
    expect(areas[1]).toHaveAttribute('data-name', 'Regen Power (kW)');
    expect(areas[1]).toHaveAttribute('data-stroke', '#ef4444');
    expect(areas[1]).toHaveAttribute('data-fill', 'url(#dtPwrMinGrad)');
  });

  it('mounts both source gradients, keys the X axis on date, labels the Y axis kW, and draws grid, tooltip + zero line', () => {
    render(<PowerOutputChart data={twoSamples()} />);

    const grads = screen.getAllByTestId('area-gradient');
    const byId = Object.fromEntries(
      grads.map((g) => [g.getAttribute('data-id'), g.getAttribute('data-color')]),
    );
    expect(byId.dtPwrMaxGrad).toBe('#8b5cf6');
    expect(byId.dtPwrMinGrad).toBe('#ef4444');

    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'date');
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-label', 'kW');
    expect(screen.getByTestId('cartesian-grid')).toBeInTheDocument();
    expect(screen.getByTestId('tooltip')).toBeInTheDocument();

    // Power dips below zero on regen — a y=0 reference line anchors the split.
    expect(screen.getByTestId('reference-line')).toHaveAttribute('data-y', '0');
  });

  it('builds the accessible fallback data table from every sample using the snake_case display keys', () => {
    render(<PowerOutputChart data={twoSamples()} />);

    const container = screen.getByTestId('chart-container');
    expect(JSON.parse(container.getAttribute('data-columns') ?? '[]')).toEqual([
      'date',
      'power_max_kw',
      'power_min_kw',
    ]);

    const table = JSON.parse(container.getAttribute('data-table') ?? '[]');
    expect(table).toHaveLength(2);
    expect(table[0]).toEqual({ date: '2026-07-01', power_max_kw: 250, power_min_kw: -70 });
    expect(table[1]).toEqual({ date: '2026-07-02', power_max_kw: 300, power_min_kw: -90 });
  });
});

describe('PowerOutputChart — hidden-series (legend) wiring', () => {
  it('shows both traces and an un-dimmed legend when nothing is toggled off', () => {
    render(<PowerOutputChart data={twoSamples()} />);

    const areas = screen.getAllByTestId('area');
    expect(areas[0]).toHaveAttribute('data-hide', 'false');
    expect(areas[1]).toHaveAttribute('data-hide', 'false');

    const legend = screen.getByTestId('chart-legend');
    expect(legend).toHaveAttribute('data-has-state', 'true');
    expect(legend).toHaveAttribute('data-max-hidden', 'false');
    expect(legend).toHaveAttribute('data-min-hidden', 'false');
  });

  it('hides only the peak trace and dims only its legend entry when powerMax is toggled off in the URL', () => {
    H.hiddenKeys = new Set(['powerMax']);
    render(<PowerOutputChart data={twoSamples()} />);

    const areas = screen.getAllByTestId('area');
    // powerMax is hidden; powerMin stays visible.
    expect(areas[0]).toHaveAttribute('data-hide', 'true');
    expect(areas[1]).toHaveAttribute('data-hide', 'false');

    // The legend reads its dim state from the same URL-persisted source.
    const legend = screen.getByTestId('chart-legend');
    expect(legend).toHaveAttribute('data-max-hidden', 'true');
    expect(legend).toHaveAttribute('data-min-hidden', 'false');
  });
});

describe('PowerOutputChart — empty, loading + null safety', () => {
  it('flags the container empty and withholds the chart body for an empty dataset', () => {
    render(<PowerOutputChart data={[]} />);

    const container = screen.getByTestId('chart-container');
    expect(container).toHaveAttribute('data-empty', 'true');
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('area')).toHaveLength(0);
  });

  it('treats a single lone drive as not chartable (a trend needs > 1 point) and shows the empty state', () => {
    render(<PowerOutputChart data={[point()]} />);

    const container = screen.getByTestId('chart-container');
    expect(container).toHaveAttribute('data-empty', 'true');
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('flags the container loading and withholds the chart body while loading', () => {
    render(<PowerOutputChart data={twoSamples()} loading />);

    const container = screen.getByTestId('chart-container');
    expect(container).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('chart-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('is null-safe: an undefined data prop renders the empty state instead of throwing on .length', () => {
    expect(() =>
      render(<PowerOutputChart data={undefined as unknown as ChartDataPoint[]} />),
    ).not.toThrow();

    const container = screen.getByTestId('chart-container');
    expect(container).toHaveAttribute('data-empty', 'true');
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });
});

describe('PowerOutputChart — hardening', () => {
  it('coerces nullish peak/regen samples to 0 in the fallback table cells', () => {
    render(
      <PowerOutputChart
        data={[
          point({
            date: '2026-07-01',
            powerMax: null as unknown as number,
            powerMin: undefined as unknown as number,
          }),
          point({ date: '2026-07-02', powerMax: 300, powerMin: -90 }),
        ]}
      />,
    );

    const container = screen.getByTestId('chart-container');
    const table = JSON.parse(container.getAttribute('data-table') ?? '[]');
    // Without the `?? 0` guard these cells would serialise as null.
    expect(table[0]).toEqual({ date: '2026-07-01', power_max_kw: 0, power_min_kw: 0 });
    expect(table[1].power_max_kw).toBe(300);
  });
});
