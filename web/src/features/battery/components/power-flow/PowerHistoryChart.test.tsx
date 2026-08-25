/**
 * PowerHistoryChart contract + hardening tests.
 *
 * The chart is a presentational view over a pre-shaped `PowerHistoryPoint[]`
 * plus the loading / error flags its parent owns. It never fetches, so the
 * tests drive it directly with hand-built props rather than mocking the
 * network.
 *
 * Recharts renders 0×0 under jsdom (no layout engine), so the real AreaChart
 * never paints its SVG/areas — which would make the component's own wiring
 * (series keys, names, stroke colours, gradient fills, and the two
 * `tickFormatter`s) invisible to the DOM. Following the repo convention
 * (see SentryModeChart / SmallMultiplesChart tests) we swap the shared
 * `@/components/charts` barrel for lightweight doubles that surface the
 * `data` prop and each series' props as inspectable attributes. Only the
 * pixel-pushing chart library + container chrome are stubbed; the
 * component's own logic still runs.
 *
 * Coverage:
 *   1. Error — a retry-able QueryError inside a titled GlassPanel, `onRetry`
 *      forwarded, no chart (also pins error-over-data precedence).
 *   2. Error precedence — the error wins over a concurrent loading flag +
 *      populated data.
 *   3. Ready — the labelled `img` region carries the title / subtitle /
 *      aria description.
 *   4. Ready — every datum is handed to the AreaChart and the four stacked
 *      series wire the right keys, names, stroke colours, and gradient fills.
 *   5. Ready — the four source gradients get their ids + FLOW_COLORS.
 *   6. Ready — the X axis is keyed on `time` and routes samples through
 *      `formatDateShort`; a NaN sample degrades to "—" instead of throwing
 *      (regression: the old `new Date(v).toISOString()` threw RangeError).
 *   7. Ready — the Y axis routes samples through `fmtWatts` (W → kW scaling).
 *   8. Ready — tooltip + legend are mounted.
 *   9. Loading — the container is flagged loading and no series leak through.
 *  10. Empty — an explicit `[]` shows the empty container, no series.
 *  11. Null-safety (regression) — an (untyped-at-runtime) `undefined` data
 *      prop renders the empty state instead of crashing on `.length`.
 *  12. `className` is forwarded onto the container (ready) and the panel
 *      (error).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

import { FLOW_COLORS } from './constants';

/* ── i18n: resolve t(key, fallback) → fallback so copy is deterministic and
 *    locale-file independent. Applies to QueryError's copy too. ─────────── */
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

/* ── charts: surface the container flags, per-series props, and the axis
 *    tickFormatter outputs for inspection. The XAxis double deliberately
 *    exercises the formatter with a NaN sample so a formatter that throws
 *    (the pre-hardening `.toISOString()` path) would blow up the render. ── */
const VALID_TICK = Date.UTC(2026, 6, 4, 18, 0, 0); // 2026-07-04T18:00:00Z

vi.mock('@/components/charts', () => ({
  ChartContainer: ({
    title,
    subtitle,
    ariaLabel,
    loading,
    empty,
    height,
    className,
    children,
  }: {
    title?: string;
    subtitle?: string;
    ariaLabel?: string;
    loading?: boolean;
    empty?: boolean;
    height?: number;
    className?: string;
    children?: ReactNode | ((context: {
      hiddenSeries: { isHidden: (key: string) => boolean };
    }) => ReactNode);
  }) => {
    const content = typeof children === 'function'
      ? children({ hiddenSeries: { isHidden: () => false } })
      : children;
    return (
      <section
        data-testid="chart-container"
        data-loading={String(!!loading)}
        data-empty={String(!!empty)}
        data-height={String(height ?? '')}
        className={className}
      >
        <h3>{title}</h3>
        {subtitle ? <p data-testid="chart-subtitle">{subtitle}</p> : null}
        <div role="img" aria-label={ariaLabel}>
          {loading ? (
            <div data-testid="chart-loading" />
          ) : empty ? (
            <div data-testid="chart-empty" />
          ) : (
            content
          )}
        </div>
      </section>
    );
  },
  ChartLegend: () => <div data-testid="chart-legend" />,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({
    data,
    children,
  }: {
    data?: unknown[];
    children?: ReactNode;
  }) => (
    <div data-testid="area-chart" data-count={String((data ?? []).length)}>
      {children}
    </div>
  ),
  Area: ({
    dataKey,
    name,
    stroke,
    fill,
  }: {
    dataKey?: string;
    name?: string;
    stroke?: string;
    fill?: string;
  }) => (
    <div
      data-testid="area"
      data-key={String(dataKey)}
      data-name={String(name)}
      data-stroke={String(stroke)}
      data-fill={String(fill)}
    />
  ),
  ChartGradient: ({ id, color }: { id?: string; color?: string }) => (
    <div data-testid="chart-gradient" data-id={String(id)} data-color={String(color)} />
  ),
  XAxis: ({
    dataKey,
    tickFormatter,
  }: {
    dataKey?: string;
    tickFormatter?: (v: number) => string;
  }) => (
    <div
      data-testid="x-axis"
      data-key={String(dataKey)}
      data-sample={tickFormatter ? tickFormatter(VALID_TICK) : ''}
      data-sample-bad={tickFormatter ? tickFormatter(Number.NaN) : ''}
    />
  ),
  YAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => (
    <div
      data-testid="y-axis"
      data-sample-kw={tickFormatter ? tickFormatter(1500) : ''}
      data-sample-w={tickFormatter ? tickFormatter(500) : ''}
    />
  ),
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  ChartTooltip: () => null,
  // Non-component barrel values the source spreads / renders inline.
  chartGrid: <div data-testid="chart-grid" />,
  axisTick: {},
  chartMarginLabeled: {},
  AREA_DEFAULTS: {},
}));

import { PowerHistoryChart, type PowerHistoryPoint } from './PowerHistoryChart';

type ChartProps = ComponentProps<typeof PowerHistoryChart>;

function point(overrides: Partial<PowerHistoryPoint> = {}): PowerHistoryPoint {
  return {
    time: VALID_TICK,
    label: 'Jul 4',
    solar: 4200,
    battery: -800,
    grid: 300,
    load: 3700,
    soc: 82,
    ...overrides,
  };
}

function renderChart(overrides: Partial<ChartProps> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: ChartProps = {
    data: [],
    loading: false,
    error: null,
    onRetry,
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <PowerHistoryChart {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

afterEach(() => {
  cleanup();
});

describe('PowerHistoryChart — error state', () => {
  it('renders a retry-able error in a titled panel, forwards onRetry, and hides the chart', () => {
    const onRetry = vi.fn();
    renderChart({
      error: new Error('boom'),
      onRetry,
      data: [point()], // error must win even with data present
    });

    // Panel title is shown even in the error state — never a blank rectangle.
    expect(screen.getByText('Power Over Time')).toBeInTheDocument();
    // Plain Error (no ApiError.status) → QueryError's online network branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    // The chart body must not leak through in the error state.
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-container')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prefers the error over a concurrent loading flag and populated data', () => {
    renderChart({
      error: new Error('down'),
      loading: true,
      data: [point(), point({ time: VALID_TICK + 60_000 })],
    });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByTestId('chart-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });
});

describe('PowerHistoryChart — ready state', () => {
  it('mounts a labelled img region carrying the title, subtitle, and aria description', () => {
    renderChart({ data: [point()] });

    expect(
      screen.getByRole('heading', { name: 'Power Over Time' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('chart-subtitle')).toHaveTextContent(
      'Solar, battery, and grid power flow',
    );
    expect(
      screen.getByRole('img', {
        name: 'Solar, battery, grid, and home power flow stacked area chart over time',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('chart-container')).toHaveAttribute(
      'data-empty',
      'false',
    );
  });

  it('hands every datum to the AreaChart and wires the four stacked series', () => {
    renderChart({
      data: [point(), point({ time: VALID_TICK + 60_000 }), point({ time: VALID_TICK + 120_000 })],
    });

    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-count', '3');

    const areas = screen.getAllByTestId('area');
    expect(areas).toHaveLength(4);

    // solar → amber
    expect(areas[0]).toHaveAttribute('data-key', 'solar');
    expect(areas[0]).toHaveAttribute('data-name', 'Solar');
    expect(areas[0]).toHaveAttribute('data-stroke', FLOW_COLORS.solar);
    expect(areas[0]).toHaveAttribute('data-fill', 'url(#pfGradSolar)');

    // battery → emerald (labelled "Battery", keyed "battery")
    expect(areas[1]).toHaveAttribute('data-key', 'battery');
    expect(areas[1]).toHaveAttribute('data-name', 'Battery');
    expect(areas[1]).toHaveAttribute('data-stroke', FLOW_COLORS.battery);
    expect(areas[1]).toHaveAttribute('data-fill', 'url(#pfGradBattery)');

    // grid → purple
    expect(areas[2]).toHaveAttribute('data-key', 'grid');
    expect(areas[2]).toHaveAttribute('data-name', 'Grid');
    expect(areas[2]).toHaveAttribute('data-stroke', FLOW_COLORS.grid);
    expect(areas[2]).toHaveAttribute('data-fill', 'url(#pfGradGrid)');

    // home is keyed on the `load` field but labelled "Home", filled from home
    expect(areas[3]).toHaveAttribute('data-key', 'load');
    expect(areas[3]).toHaveAttribute('data-name', 'Home');
    expect(areas[3]).toHaveAttribute('data-stroke', FLOW_COLORS.home);
    expect(areas[3]).toHaveAttribute('data-fill', 'url(#pfGradHome)');
  });

  it('defines the four source gradients with their ids and FLOW_COLORS', () => {
    renderChart({ data: [point()] });

    const grads = screen.getAllByTestId('chart-gradient');
    expect(grads).toHaveLength(4);

    const byId = Object.fromEntries(
      grads.map((g) => [g.getAttribute('data-id'), g.getAttribute('data-color')]),
    );
    expect(byId.pfGradSolar).toBe(FLOW_COLORS.solar);
    expect(byId.pfGradBattery).toBe(FLOW_COLORS.battery);
    expect(byId.pfGradGrid).toBe(FLOW_COLORS.grid);
    expect(byId.pfGradHome).toBe(FLOW_COLORS.home);
  });

  it('keys the X axis on time and routes samples through formatDateShort without throwing on a bad value', () => {
    renderChart({ data: [point()] });

    const xAxis = screen.getByTestId('x-axis');
    expect(xAxis).toHaveAttribute('data-key', 'time');

    // A valid epoch → a real short date: not the raw ISO string, not "—".
    const sample = xAxis.getAttribute('data-sample') ?? '';
    expect(sample).not.toBe('—');
    expect(sample).not.toContain('T'); // not a leaked ISO string
    expect(sample).toMatch(/[A-Za-z]/);
    expect(sample).toMatch(/\d/);

    // Regression: a NaN sample must degrade to the "—" placeholder rather
    // than throw `RangeError: Invalid time value` (old `.toISOString()` path).
    expect(xAxis).toHaveAttribute('data-sample-bad', '—');
  });

  it('routes the Y axis through fmtWatts, auto-scaling watts to kW past 1000', () => {
    renderChart({ data: [point()] });

    const yAxis = screen.getByTestId('y-axis');
    expect(yAxis.getAttribute('data-sample-kw')).toContain('kW');
    expect(yAxis.getAttribute('data-sample-kw')).toMatch(/1[.,]5/);
    expect(yAxis).toHaveAttribute('data-sample-w', '500 W');
  });

  it('mounts the tooltip and legend', () => {
    renderChart({ data: [point()] });

    expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    expect(screen.getByTestId('chart-legend')).toBeInTheDocument();
  });
});

describe('PowerHistoryChart — loading + empty states', () => {
  it('flags the container loading and renders no series while loading', () => {
    renderChart({ loading: true, data: [point()] });

    const container = screen.getByTestId('chart-container');
    expect(container).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('chart-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('area')).toHaveLength(0);
  });

  it('shows the empty container (no series) for an explicit empty dataset', () => {
    renderChart({ data: [] });

    const container = screen.getByTestId('chart-container');
    expect(container).toHaveAttribute('data-empty', 'true');
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });
});

describe('PowerHistoryChart — null safety', () => {
  it('does not crash and renders the empty state when data is undefined', () => {
    // The prop is typed non-null, but the untyped API can transiently omit it.
    // A missing `Array.isArray` guard would throw on `data.length`.
    expect(() =>
      renderChart({ data: undefined as unknown as PowerHistoryPoint[] }),
    ).not.toThrow();

    expect(screen.getByTestId('chart-container')).toHaveAttribute(
      'data-empty',
      'true',
    );
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });
});

describe('PowerHistoryChart — styling passthrough', () => {
  it('forwards className onto the chart container in the ready state', () => {
    renderChart({ data: [point()], className: 'xl:col-span-2' });

    expect(screen.getByTestId('chart-container')).toHaveClass('xl:col-span-2');
  });

  it('forwards className onto the glass panel in the error state', () => {
    const { container } = renderChart({
      error: new Error('boom'),
      className: 'xl:col-span-2',
    });

    const panel = container.firstChild as HTMLElement;
    expect(panel.className).toContain('xl:col-span-2');
    expect(panel.className).toContain('p-4');
  });
});
