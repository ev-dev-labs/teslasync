/**
 * TorqueHistoryChart — behaviour + hardening coverage.
 *
 * TorqueHistoryChart is the drivetrain-health motor-torque panel: a single-series
 * gradient-filled area chart of drive-inverter torque (Nm) over recent snapshots,
 * framed by a ChartContainer that also emits the screen-reader / CSV fallback
 * table, plus a zero reference line. Torque is already an SI-neutral quantity
 * (newton-metres), so — unlike its temperature siblings — this chart applies NO
 * unit conversion; its job is purely to (a) guard the incoming snapshot window
 * against nulls / undefined and (b) delegate loading / empty presentation to
 * ChartContainer. It has a single export (the component); this suite exercises
 * every branch and the behaviour that would silently regress rather than smoke
 * rendering:
 *
 *   1. Panel chrome & a11y — the i18n title + subtitle and the mandatory
 *      accessible chart-figure label always frame the section, and the fixed
 *      280px height is threaded.
 *   2. Populated trace — the guarded rows reach <AreaChart> untouched; the single
 *      torque <Area> binds its key / colour / gradient fill / i18n name; the
 *      gradient def is wired; the x-axis binds the snapshot `time`; the zero
 *      <ReferenceLine> anchors the baseline; and the projected { time, torque }
 *      rows + localized column headers reach the a11y fallback table.
 *   3. Loading — a truthy `loading` withholds the chart (loading beats data) but
 *      keeps the chrome.
 *   4. Empty & null-safety (the hardening) — a single snapshot, an empty array,
 *      an all-null-torque window, AND an `undefined` data prop all surface the
 *      ChartContainer empty state instead of a blank panel or a `.length`-of-
 *      undefined crash; a window with at least one real torque is NOT empty; and
 *      the caller-supplied array is never mutated.
 *
 * Per the repo convention (see StatorTempChart.test.tsx): react-i18next is
 * stubbed to echo the English fallback so asserted copy is decoupled from the
 * locale bundle; <FadeIn> is flattened; and the `@/components/charts` barrel is
 * doubled — its real ResponsiveContainer renders 0x0 in jsdom, so the series /
 * data / gradient / reference bindings would otherwise be unobservable. The
 * ChartContainer double mirrors the real loading -> empty -> children precedence.
 * Network is never touched (this component has no data source of its own).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { MotorChartDataPoint } from './constants';

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

// ── Flatten the entry animation — framer-motion / matchMedia are irrelevant. ──
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// ── charts barrel double: ResponsiveContainer + AreaChart render their children
//    so the series / data / gradient / reference bindings surface as testable
//    DOM. ChartContainer mirrors the real loading -> empty -> children precedence
//    and exposes the wired props (title, subtitle, aria label, fallback data,
//    columns, height, loading, empty). ──
vi.mock('@/components/charts', () => {
  const Inert = () => null;
  return {
    AREA_DEFAULTS: { type: 'monotone', strokeWidth: 2 },
    ChartTooltip: Inert,
    Tooltip: Inert,
    CartesianGrid: Inert,
    YAxis: Inert,
    Legend: Inert,
    ChartGradient: (p: { id?: string; color?: string }) => (
      <span
        data-testid="chart-gradient"
        data-id={String(p.id ?? '')}
        data-color={String(p.color ?? '')}
      />
    ),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ChartContainer: ({
      title,
      subtitle,
      ariaLabel,
      data,
      dataColumns,
      height,
      loading,
      empty,
      children,
    }: {
      title?: string;
      subtitle?: string;
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
        <p data-testid="cc-subtitle">{subtitle}</p>
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
    AreaChart: ({
      data,
      children,
    }: {
      data?: ReadonlyArray<Record<string, unknown>>;
      children?: ReactNode;
    }) => (
      <div data-testid="area-chart">
        <span data-testid="area-chart-data">{JSON.stringify(data ?? [])}</span>
        {/* Real recharts roots an <svg>; mirror it so the source's <defs> is valid. */}
        <svg>{children}</svg>
      </div>
    ),
    Area: (p: { dataKey?: string; name?: string; stroke?: string; fill?: string }) => (
      <span
        data-testid="area-series"
        data-key={String(p.dataKey ?? '')}
        data-name={String(p.name ?? '')}
        data-stroke={String(p.stroke ?? '')}
        data-fill={String(p.fill ?? '')}
      />
    ),
    XAxis: (p: { dataKey?: string }) => (
      <span data-testid="x-axis" data-key={String(p.dataKey ?? '')} />
    ),
    ReferenceLine: (p: { y?: number; stroke?: string }) => (
      <span
        data-testid="reference-line"
        data-y={String(p.y ?? '')}
        data-stroke={String(p.stroke ?? '')}
      />
    ),
  };
});

import { TorqueHistoryChart } from './TorqueHistoryChart';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePoint(over: Partial<MotorChartDataPoint> = {}): MotorChartDataPoint {
  return {
    time: '09:00',
    stator: 55,
    statorRel: 50,
    statorRer: 48,
    torque: 120,
    speed: 40,
    axle: 3000,
    ...over,
  };
}

const POINTS: MotorChartDataPoint[] = [
  makePoint({ time: '09:00', torque: 120 }),
  makePoint({ time: '09:05', torque: -35 }),
  makePoint({ time: '09:10', torque: 210 }),
];

function renderChart(data: MotorChartDataPoint[] = POINTS, loading = false) {
  return render(<TorqueHistoryChart data={data} loading={loading} />);
}

/** Rows the recharts AreaChart double received as its `data` prop. */
function readChartRows(): MotorChartDataPoint[] {
  return JSON.parse(screen.getByTestId('area-chart-data').textContent || '[]');
}

/** Rows the ChartContainer double received for its SR / CSV fallback table. */
function readFallbackRows(): Array<Record<string, unknown>> {
  return JSON.parse(screen.getByTestId('cc-data').textContent || '[]');
}

/** Column definitions the ChartContainer double received. */
function readColumns(): Array<{ key: string; label: string }> {
  return JSON.parse(screen.getByTestId('cc-columns').textContent || '[]');
}

// ── 1. Panel chrome & a11y ───────────────────────────────────────────────────

describe('TorqueHistoryChart — panel chrome & a11y', () => {
  it('frames the panel with the i18n title and subtitle', () => {
    renderChart();

    expect(screen.getByRole('heading', { name: /Motor Torque/i })).toBeInTheDocument();
    expect(screen.getByTestId('cc-subtitle')).toHaveTextContent(
      'Drive inverter torque output over time',
    );
  });

  it('exposes the chart as an accessible image with a descriptive label', () => {
    renderChart();

    const figure = screen.getByRole('img');
    expect(figure.getAttribute('aria-label')).toContain(
      'Motor inverter torque output history area chart',
    );
  });

  it('threads the fixed 280px chart height to the container', () => {
    renderChart();

    expect(screen.getByRole('region', { name: 'chart-container' })).toHaveAttribute(
      'data-height',
      '280',
    );
  });
});

// ── 2. Populated trace ───────────────────────────────────────────────────────

describe('TorqueHistoryChart — populated trace', () => {
  it('feeds the guarded rows straight to the area chart and reports neither loading nor empty', () => {
    renderChart(POINTS);

    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    expect(readChartRows()).toEqual(POINTS);
    expect(screen.getByTestId('cc-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('cc-empty')).toHaveTextContent('false');
    expect(screen.queryByTestId('cc-empty-state')).not.toBeInTheDocument();
  });

  it('binds the torque series to its key, colour, gradient fill and unit-suffixed i18n name', () => {
    renderChart();

    const series = screen.getAllByTestId('area-series');
    expect(series).toHaveLength(1);

    const [torque] = series;
    expect(torque).toHaveAttribute('data-key', 'torque');
    expect(torque).toHaveAttribute('data-stroke', '#00f0ff');
    expect(torque).toHaveAttribute('data-fill', 'url(#dtTorqueGrad)');
    expect(torque.getAttribute('data-name')).toContain('Torque');
    expect(torque.getAttribute('data-name')).toContain('(Nm)');
  });

  it('wires the fill gradient definition with a matching id and colour', () => {
    renderChart();

    const gradient = screen.getByTestId('chart-gradient');
    expect(gradient).toHaveAttribute('data-id', 'dtTorqueGrad');
    expect(gradient).toHaveAttribute('data-color', '#00f0ff');
  });

  it('binds the x-axis to the snapshot time', () => {
    renderChart();

    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'time');
  });

  it('anchors a zero-torque baseline reference line', () => {
    renderChart();

    const refLine = screen.getByTestId('reference-line');
    expect(refLine).toHaveAttribute('data-y', '0');
    expect(refLine).toHaveAttribute('data-stroke', '#64748b');
  });

  it('projects { time, torque } into the a11y fallback table (dropping stator/speed/axle)', () => {
    renderChart(POINTS);

    expect(readFallbackRows()).toEqual([
      { time: '09:00', torque: 120 },
      { time: '09:05', torque: -35 },
      { time: '09:10', torque: 210 },
    ]);
  });

  it('wires the localized fallback column headers', () => {
    renderChart();

    expect(readColumns()).toEqual([
      { key: 'time', label: 'Time' },
      { key: 'torque', label: 'Torque (Nm)' },
    ]);
  });

  it('preserves null torque values in the fallback table rather than coercing them', () => {
    renderChart([
      makePoint({ time: '09:00', torque: 120 }),
      makePoint({ time: '09:05', torque: null }),
    ]);

    expect(readFallbackRows()).toEqual([
      { time: '09:00', torque: 120 },
      { time: '09:05', torque: null },
    ]);
  });

  it('does not mutate the caller-supplied rows array', () => {
    const source: MotorChartDataPoint[] = [
      makePoint({ time: '08:00', torque: 10 }),
      makePoint({ time: '08:01', torque: 20 }),
    ];
    renderChart(source);

    expect(source).toHaveLength(2);
    expect(readChartRows()).toEqual(source);
  });
});

// ── 3. Loading ───────────────────────────────────────────────────────────────

describe('TorqueHistoryChart — loading', () => {
  it('withholds the chart while loading (loading beats data) but keeps the chrome', () => {
    renderChart(POINTS, true);

    expect(screen.getByTestId('cc-loading')).toHaveTextContent('true');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    // Loading takes precedence — the chart is not drawn even though rows exist.
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reference-line')).not.toBeInTheDocument();
    // The title still frames the panel while loading.
    expect(screen.getByRole('heading', { name: /Motor Torque/i })).toBeInTheDocument();
  });
});

// ── 4. Empty & null-safety (the hardening) ───────────────────────────────────

describe('TorqueHistoryChart — empty & null-safety', () => {
  it('reports empty for a single snapshot and withholds the chart; chrome stays', () => {
    renderChart([makePoint()]);

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('cc-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Motor Torque/i })).toBeInTheDocument();
  });

  it('reports empty for an empty array', () => {
    renderChart([]);

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('cc-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(readFallbackRows()).toEqual([]);
  });

  it('reports empty when every snapshot has null torque (no blank single-line panel)', () => {
    renderChart([
      makePoint({ time: '09:00', torque: null }),
      makePoint({ time: '09:05', torque: null }),
      makePoint({ time: '09:10', torque: null }),
    ]);

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('cc-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('is NOT empty when at least one snapshot carries a real torque (including zero)', () => {
    renderChart([
      makePoint({ time: '09:00', torque: null }),
      makePoint({ time: '09:05', torque: 0 }),
    ]);

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('false');
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });

  it('treats an undefined data prop as empty instead of throwing on `.length` (crash guard)', () => {
    const renderUndefined = () =>
      render(<TorqueHistoryChart data={undefined as unknown as MotorChartDataPoint[]} />);
    expect(renderUndefined).not.toThrow();

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('cc-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    // The fallback table degrades to an empty row set rather than crashing.
    expect(readFallbackRows()).toEqual([]);
  });
});
