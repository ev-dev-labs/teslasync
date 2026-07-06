/**
 * CostPerKwhChart — behaviour + hardening coverage.
 *
 * The component owns four mutually-exclusive presentation paths driven by its
 * props: an `error` short-circuits to a retryable <CostSection> banner; a
 * truthy `isLoading` and an empty row set are both delegated to
 * <ChartContainer> (loading takes precedence); otherwise the cost-per-kWh
 * line chart is drawn. This suite drives every path and asserts the real
 * behaviour that matters:
 *   - the panel chrome (localized title heading + accessible chart label)
 *     always frames the section,
 *   - the null-safe, memoised row derivation feeds the SAME rows to BOTH the
 *     recharts line series and the ChartContainer screen-reader / CSV fallback
 *     table (they can never diverge),
 *   - the per-point `?? 0` / `?? ''` guards and the `data ?? []` crash guard
 *     (an `undefined` prop must render an empty chart, never throw),
 *   - the loading / empty branches withhold the chart but keep the chrome,
 *   - the series/axis bindings + the currency-formatted Y axis,
 *   - and the error branch surfaces a retryable QueryError whose Retry button
 *     invokes `onRetry`, winning even over supplied data.
 *
 * Only the `@/components/charts` barrel and the two display hooks
 * (`useChartPalette` / `useFormatting`, whose real implementations reach
 * TanStack Query for settings) are doubled — ChartContainer's real
 * ResponsiveContainer renders 0×0 in jsdom, so the series/data would otherwise
 * be unobservable. The error path renders the REAL <CostSection> +
 * <QueryError> so the rendered `role="alert"` + Retry copy are genuinely
 * exercised. `@testing-library/user-event` is not a dependency of this repo,
 * so `fireEvent` drives the interaction. Network is never touched (this
 * component has no data source of its own).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { CostPerKwhChart } from './CostPerKwhChart';

// ── i18n: resolve the string fallback (2nd arg) so assertions read on copy. ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── display hooks: deterministic, network-free doubles. palette[2] is the
//    colour the component picks for the line; formatCurrency is the Y-axis
//    tick formatter (2-decimal currency). ──
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => ['#111111', '#222222', '#33d1c3', '#444444'],
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals?: number) => `$${amount.toFixed(decimals ?? 2)}`,
  }),
}));

// ── keep the real QueryError on its online "Can't reach server" branch so the
//    Retry button is enabled (offline would disable it + auto-retry instead). ──
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

// ── charts barrel double: ResponsiveContainer renders its children so the
//    LineChart double can surface the component-computed `data` (as JSON) plus
//    the series/axis bindings for direct assertion. ChartContainer mirrors the
//    real loading → empty → children precedence and exposes the wired props
//    (title, aria label, fallback `data`, columns, height, loading, empty). ──
vi.mock('@/components/charts', () => {
  const Inert = () => null;
  return {
    AREA_DEFAULTS: { type: 'monotone', strokeWidth: 2 },
    chartGrid: { stroke: 'rgba(255,255,255,0.06)' },
    axisTickSm: { fontSize: 11 },
    ChartTooltip: Inert,
    CartesianGrid: Inert,
    Tooltip: Inert,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ChartContainer: ({
      title,
      ariaLabel,
      data,
      dataColumns,
      height,
      loading,
      empty,
      children,
    }: {
      title?: string;
      ariaLabel?: string;
      data?: ReadonlyArray<Record<string, unknown>>;
      dataColumns?: ReadonlyArray<{ key: string; label: string }>;
      height?: number;
      loading?: boolean;
      empty?: boolean;
      children?: ReactNode;
    }) => (
      <section aria-label="chart-container" data-height={String(height ?? '')}>
        <h3>{title}</h3>
        <div role="img" aria-label={ariaLabel}>
          <span data-testid="cc-data">{JSON.stringify(data ?? [])}</span>
          <span data-testid="cc-columns">{JSON.stringify(dataColumns ?? [])}</span>
          <span data-testid="cc-loading">{String(!!loading)}</span>
          <span data-testid="cc-empty">{String(!!empty)}</span>
        </div>
        {loading ? (
          <div data-testid="cc-loading-state" role="status" aria-label="Loading" />
        ) : empty ? (
          <div data-testid="cc-empty-state" />
        ) : (
          children
        )}
      </section>
    ),
    LineChart: ({
      data,
      children,
    }: {
      data?: ReadonlyArray<Record<string, unknown>>;
      children?: ReactNode;
    }) => (
      <div data-testid="line-chart">
        <span data-testid="line-chart-data">{JSON.stringify(data ?? [])}</span>
        {children}
      </div>
    ),
    Line: ({
      dataKey,
      name,
      stroke,
    }: {
      dataKey?: string;
      name?: string;
      stroke?: string;
    }) => (
      <span
        data-testid="line-series"
        data-key={String(dataKey ?? '')}
        data-name={String(name ?? '')}
        data-stroke={String(stroke ?? '')}
      />
    ),
    XAxis: ({ dataKey }: { dataKey?: string }) => (
      <span data-testid="x-axis" data-key={String(dataKey ?? '')} />
    ),
    YAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => (
      <span data-testid="y-tick">
        {typeof tickFormatter === 'function' ? tickFormatter(0.1523) : ''}
      </span>
    ),
  };
});

type Point = { date: string; costPerKwh: number };

const TREND: Point[] = [
  { date: 'Jan 01', costPerKwh: 0.12 },
  { date: 'Jan 08', costPerKwh: 0.15 },
  { date: 'Jan 15', costPerKwh: 0.11 },
];

function renderChart(
  data: Point[] | undefined = TREND,
  extra: { isLoading?: boolean; error?: unknown; onRetry?: () => void } = {},
) {
  return render(
    <MemoryRouter>
      <CostPerKwhChart data={data as Point[]} {...extra} />
    </MemoryRouter>,
  );
}

/** Rows the recharts LineChart double received as its `data` prop. */
function readChartRows(): Point[] {
  return JSON.parse(screen.getByTestId('line-chart-data').textContent || '[]');
}

/** Rows the ChartContainer double received for its SR / CSV fallback table. */
function readFallbackRows(): Point[] {
  return JSON.parse(screen.getByTestId('cc-data').textContent || '[]');
}

describe('CostPerKwhChart — panel chrome & a11y', () => {
  it('always frames the panel with the localized title heading', () => {
    renderChart();
    expect(
      screen.getByRole('heading', { name: /Cost per kWh Trend/i }),
    ).toBeInTheDocument();
  });

  it('exposes the chart as an accessible image with a descriptive label', () => {
    renderChart();
    expect(
      screen.getByRole('img', { name: 'Cost per kilowatt-hour trend line chart' }),
    ).toBeInTheDocument();
  });

  it('wires the date + rate fallback columns and the 260px chart height', () => {
    renderChart();

    const columns = JSON.parse(screen.getByTestId('cc-columns').textContent || '[]');
    expect(columns).toEqual([
      { key: 'date', label: 'Date' },
      { key: 'costPerKwh', label: '$/kWh' },
    ]);
    expect(screen.getByRole('region', { name: 'chart-container' })).toHaveAttribute(
      'data-height',
      '260',
    );
  });
});

describe('CostPerKwhChart — populated', () => {
  it('feeds the SAME null-safe rows to the line chart and the SR/CSV fallback table', () => {
    renderChart(TREND);

    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(readChartRows()).toEqual(TREND);
    expect(readFallbackRows()).toEqual(TREND);
    // The unified `rows` derivation guarantees the two never diverge.
    expect(readChartRows()).toEqual(readFallbackRows());
  });

  it('binds the rate series to the palette[2] stroke, the i18n name and the date X axis', () => {
    renderChart(TREND);

    const series = screen.getByTestId('line-series');
    expect(series).toHaveAttribute('data-key', 'costPerKwh');
    expect(series).toHaveAttribute('data-name', '$/kWh');
    expect(series).toHaveAttribute('data-stroke', '#33d1c3');
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'date');
  });

  it('formats the Y-axis ticks as 2-decimal currency via useFormatting', () => {
    renderChart(TREND);
    // tickFormatter(0.1523) → formatCurrency(0.1523, 2) → "$0.15".
    expect(screen.getByTestId('y-tick')).toHaveTextContent('$0.15');
  });

  it('reports neither a loading nor an empty state when rows are present', () => {
    renderChart(TREND);
    expect(screen.getByTestId('cc-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('cc-empty')).toHaveTextContent('false');
    expect(screen.queryByTestId('cc-empty-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cc-loading-state')).not.toBeInTheDocument();
  });

  it('does not mutate the caller-supplied trend array in place', () => {
    const source: Point[] = [{ date: 'Jan 01', costPerKwh: 0.12 }];
    renderChart(source);
    // The component copies via .map() before rendering — the source is untouched.
    expect(source).toEqual([{ date: 'Jan 01', costPerKwh: 0.12 }]);
  });
});

describe('CostPerKwhChart — null-safety & malformed points', () => {
  it('coerces a missing costPerKwh / date to 0 / empty string so the chart still plots', () => {
    renderChart([
      { date: undefined, costPerKwh: undefined } as unknown as Point,
      { date: 'Feb 01', costPerKwh: 0.2 },
    ]);

    const rows = readChartRows();
    expect(rows[0]).toEqual({ date: '', costPerKwh: 0 });
    expect(rows[1]).toEqual({ date: 'Feb 01', costPerKwh: 0.2 });
    // The guarded rows also reach the fallback table verbatim.
    expect(readFallbackRows()).toEqual(rows);
    // A single guarded point is still data, not an empty state.
    expect(screen.getByTestId('cc-empty')).toHaveTextContent('false');
  });

  it('treats an undefined data prop as an empty chart instead of throwing (crash guard)', () => {
    // Render directly (not via the helper) so a genuine `undefined` reaches the
    // component rather than the helper's default trend.
    const renderUndefined = () =>
      render(
        <MemoryRouter>
          <CostPerKwhChart data={undefined as unknown as Point[]} />
        </MemoryRouter>,
      );
    expect(renderUndefined).not.toThrow();

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('cc-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    // The fallback table receives the guarded (empty) row set.
    expect(readFallbackRows()).toEqual([]);
  });
});

describe('CostPerKwhChart — empty', () => {
  it('renders the empty state and withholds the chart for an empty array; chrome stays', () => {
    renderChart([]);

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('cc-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    // Panel chrome still frames the empty state.
    expect(
      screen.getByRole('heading', { name: /Cost per kWh Trend/i }),
    ).toBeInTheDocument();
  });
});

describe('CostPerKwhChart — loading', () => {
  it('shows the loading state and withholds the chart while isLoading (loading beats data)', () => {
    renderChart(TREND, { isLoading: true });

    expect(screen.getByTestId('cc-loading')).toHaveTextContent('true');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    // Loading takes precedence — the chart is not drawn even though rows exist.
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    // The title still frames the panel while loading.
    expect(
      screen.getByRole('heading', { name: /Cost per kWh Trend/i }),
    ).toBeInTheDocument();
  });
});

describe('CostPerKwhChart — error branch (real CostSection + QueryError)', () => {
  it('renders a retryable QueryError and hides the chart on failure', () => {
    const onRetry = vi.fn();
    renderChart(TREND, { error: new Error('boom'), onRetry });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The chart container is not rendered on the error path.
    expect(screen.queryByRole('region', { name: 'chart-container' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    // The section title still frames the error via CostSection's PanelTitle.
    expect(
      screen.getByRole('heading', { name: /Cost per kWh Trend/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error banner over supplied data (error wins)', () => {
    // Even with a full trend passed, a truthy error short-circuits the render.
    renderChart(TREND, { error: new Error('stale') });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'chart-container' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });
});
