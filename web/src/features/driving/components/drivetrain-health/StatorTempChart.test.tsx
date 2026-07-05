/**
 * StatorTempChart — behaviour + hardening coverage.
 *
 * StatorTempChart is the drivetrain-health motor-stator-temperature panel: a
 * three-series line chart (front / rear-left / rear-right) framed by a
 * ChartContainer that also emits the screen-reader / CSV fallback table, plus
 * two horizontal reference lines (Normal 60 °C, Warm 80 °C). Its parent feeds
 * temperatures already converted to the user's display unit, so the component's
 * job is to (a) keep the reference thresholds in that SAME display unit and
 * (b) delegate loading / empty presentation to ChartContainer. It has a single
 * export (the component); this suite exercises every branch and the behaviour
 * that would silently regress rather than smoke rendering:
 *
 *   1. Panel chrome & a11y — the i18n title + subtitle and the mandatory
 *      accessible chart-figure label always frame the section, and the fixed
 *      280px height is threaded.
 *   2. Populated trace — the guarded rows reach <LineChart> untouched; the three
 *      <Line> series bind their key / colour / i18n name; the x-axis binds the
 *      snapshot `time`; and the projected { time, stator, statorRel, statorRer }
 *      rows + localized column headers reach the a11y fallback table.
 *   3. Reference thresholds track the unit preference — the Normal / Warm lines
 *      convert 60 / 80 °C through the REAL convertTempFromSI, so they read 60/80
 *      in °C and 140/176 in °F, and the series / column labels carry the unit.
 *   4. Loading — a truthy `loading` withholds the chart (loading beats data) but
 *      keeps the chrome.
 *   5. Empty & null-safety (the hardening) — a single snapshot, an empty array,
 *      an all-null-temps window, AND an `undefined` data prop all surface the
 *      ChartContainer empty state instead of a blank panel or a `.length`-of-
 *      undefined crash; a window with at least one real temp is NOT empty; and
 *      the caller-supplied array is never mutated.
 *
 * Per the repo convention (see ElevationChart.test.tsx / CostPerKwhChart.test.tsx):
 * react-i18next is stubbed to echo the English fallback so asserted copy is
 * decoupled from the locale bundle; <FadeIn> is flattened; and the
 * `@/components/charts` barrel is doubled — its real ResponsiveContainer renders
 * 0×0 in jsdom, so the series / data / reference bindings would otherwise be
 * unobservable. The ChartContainer double mirrors the real loading → empty →
 * children precedence. `useUnits` is doubled off hoisted state so the temperature
 * preference is deterministic, while convertTempFromSI is the REAL (pure) module
 * so the threshold conversion is genuinely exercised. Network is never touched
 * (this component has no data source of its own).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { MotorChartDataPoint } from './constants';

// ── Hoisted mutable state driving the mocked temperature preference per test. ──
const state = vi.hoisted(() => ({ temperature: '°C' as string }));

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

// ── Unit prefs: control the temperature unit the thresholds / labels bind. ──
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: state.temperature } }),
}));

// ── charts barrel double: ResponsiveContainer + LineChart render their children
//    so the series / data / reference bindings surface as testable DOM.
//    ChartContainer mirrors the real loading → empty → children precedence and
//    exposes the wired props (title, subtitle, aria label, fallback data,
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
    Line: (p: { dataKey?: string; name?: string; stroke?: string }) => (
      <span
        data-testid="line-series"
        data-key={String(p.dataKey ?? '')}
        data-name={String(p.name ?? '')}
        data-stroke={String(p.stroke ?? '')}
      />
    ),
    XAxis: (p: { dataKey?: string }) => (
      <span data-testid="x-axis" data-key={String(p.dataKey ?? '')} />
    ),
    ReferenceLine: (p: { y?: number; stroke?: string; label?: { value?: string } }) => (
      <span
        data-testid="reference-line"
        data-y={String(p.y ?? '')}
        data-stroke={String(p.stroke ?? '')}
        data-label={String(p.label?.value ?? '')}
      />
    ),
  };
});

import { StatorTempChart } from './StatorTempChart';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePoint(over: Partial<MotorChartDataPoint> = {}): MotorChartDataPoint {
  return {
    time: '09:00',
    stator: 55,
    statorRel: 50,
    statorRer: 48,
    torque: 120,
    speed: null,
    axle: 3000,
    ...over,
  };
}

const POINTS: MotorChartDataPoint[] = [
  makePoint({ time: '09:00', stator: 55, statorRel: 50, statorRer: 48 }),
  makePoint({ time: '09:05', stator: 62, statorRel: 58, statorRer: 54 }),
  makePoint({ time: '09:10', stator: 70, statorRel: 66, statorRer: 60 }),
];

function renderChart(data: MotorChartDataPoint[] = POINTS, loading = false) {
  return render(<StatorTempChart data={data} loading={loading} />);
}

/** Rows the recharts LineChart double received as its `data` prop. */
function readChartRows(): MotorChartDataPoint[] {
  return JSON.parse(screen.getByTestId('line-chart-data').textContent || '[]');
}

/** Rows the ChartContainer double received for its SR / CSV fallback table. */
function readFallbackRows(): Array<Record<string, unknown>> {
  return JSON.parse(screen.getByTestId('cc-data').textContent || '[]');
}

/** Column definitions the ChartContainer double received. */
function readColumns(): Array<{ key: string; label: string }> {
  return JSON.parse(screen.getByTestId('cc-columns').textContent || '[]');
}

/** The two reference lines, in DOM order (Normal, then Warm). */
function readReferenceLines(): HTMLElement[] {
  return screen.getAllByTestId('reference-line');
}

beforeEach(() => {
  state.temperature = '°C';
});

// ── 1. Panel chrome & a11y ───────────────────────────────────────────────────

describe('StatorTempChart — panel chrome & a11y', () => {
  it('frames the panel with the i18n title and subtitle', () => {
    renderChart();

    expect(
      screen.getByRole('heading', { name: /Stator Temperature History/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('cc-subtitle')).toHaveTextContent(
      'Motor stator temperature over recent snapshots',
    );
  });

  it('exposes the chart as an accessible image with a descriptive label', () => {
    renderChart();

    const figure = screen.getByRole('img');
    expect(figure.getAttribute('aria-label')).toContain(
      'motor stator temperature history line chart',
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

describe('StatorTempChart — populated trace', () => {
  it('feeds the guarded rows straight to the line chart and reports neither loading nor empty', () => {
    renderChart(POINTS);

    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(readChartRows()).toEqual(POINTS);
    expect(screen.getByTestId('cc-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('cc-empty')).toHaveTextContent('false');
    expect(screen.queryByTestId('cc-empty-state')).not.toBeInTheDocument();
  });

  it('binds the three stator series to their keys, colours and i18n names', () => {
    renderChart();

    const series = screen.getAllByTestId('line-series');
    expect(series).toHaveLength(3);

    const [front, rearLeft, rearRight] = series;
    expect(front).toHaveAttribute('data-key', 'stator');
    expect(front).toHaveAttribute('data-stroke', '#ef4444');
    expect(front.getAttribute('data-name')).toContain('Stator Temp');

    expect(rearLeft).toHaveAttribute('data-key', 'statorRel');
    expect(rearLeft).toHaveAttribute('data-stroke', '#a855f7');
    expect(rearLeft.getAttribute('data-name')).toContain('Rear-Left');

    expect(rearRight).toHaveAttribute('data-key', 'statorRer');
    expect(rearRight).toHaveAttribute('data-stroke', '#06b6d4');
    expect(rearRight.getAttribute('data-name')).toContain('Rear-Right');
  });

  it('binds the x-axis to the snapshot time', () => {
    renderChart();

    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'time');
  });

  it('projects { time, stator, statorRel, statorRer } into the a11y fallback table (dropping torque/speed/axle)', () => {
    renderChart(POINTS);

    expect(readFallbackRows()).toEqual([
      { time: '09:00', stator: 55, statorRel: 50, statorRer: 48 },
      { time: '09:05', stator: 62, statorRel: 58, statorRer: 54 },
      { time: '09:10', stator: 70, statorRel: 66, statorRer: 60 },
    ]);
  });

  it('wires the localized fallback column headers with the active unit', () => {
    renderChart();

    expect(readColumns()).toEqual([
      { key: 'time', label: 'Time' },
      { key: 'stator', label: 'Stator (°C)' },
      { key: 'statorRel', label: 'Rear-Left (°C)' },
      { key: 'statorRer', label: 'Rear-Right (°C)' },
    ]);
  });

  it('does not mutate the caller-supplied rows array', () => {
    const source: MotorChartDataPoint[] = [
      makePoint({ time: '08:00', stator: 40 }),
      makePoint({ time: '08:01', stator: 42 }),
    ];
    renderChart(source);

    expect(source).toHaveLength(2);
    expect(readChartRows()).toEqual(source);
  });
});

// ── 3. Reference thresholds track the unit preference (real conversion) ───────

describe('StatorTempChart — reference thresholds & unit preference', () => {
  it('draws the Normal (60 °C) and Warm (80 °C) lines unchanged in metric', () => {
    renderChart();

    const [normal, warm] = readReferenceLines();
    expect(normal).toHaveAttribute('data-y', '60');
    expect(normal).toHaveAttribute('data-label', 'Normal');
    expect(normal).toHaveAttribute('data-stroke', '#4ade80');

    expect(warm).toHaveAttribute('data-y', '80');
    expect(warm).toHaveAttribute('data-label', 'Warm');
    expect(warm).toHaveAttribute('data-stroke', '#fbbf24');
  });

  it('converts the thresholds to °F so they stay aligned with an imperial trace', () => {
    state.temperature = '°F';
    renderChart();

    const [normal, warm] = readReferenceLines();
    // 60 °C → 140 °F, 80 °C → 176 °F (real convertTempFromSI).
    expect(normal).toHaveAttribute('data-y', '140');
    expect(warm).toHaveAttribute('data-y', '176');
  });

  it('carries the active unit in the series names and column labels (°F)', () => {
    state.temperature = '°F';
    renderChart();

    for (const series of screen.getAllByTestId('line-series')) {
      expect(series.getAttribute('data-name')).toContain('(°F)');
    }
    for (const col of readColumns().slice(1)) {
      expect(col.label).toContain('(°F)');
    }
  });
});

// ── 4. Loading ───────────────────────────────────────────────────────────────

describe('StatorTempChart — loading', () => {
  it('withholds the chart while loading (loading beats data) but keeps the chrome', () => {
    renderChart(POINTS, true);

    expect(screen.getByTestId('cc-loading')).toHaveTextContent('true');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    // Loading takes precedence — the chart is not drawn even though rows exist.
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('reference-line')).toHaveLength(0);
    // The title still frames the panel while loading.
    expect(
      screen.getByRole('heading', { name: /Stator Temperature History/i }),
    ).toBeInTheDocument();
  });
});

// ── 5. Empty & null-safety (the hardening) ───────────────────────────────────

describe('StatorTempChart — empty & null-safety', () => {
  it('reports empty for a single snapshot and withholds the chart; chrome stays', () => {
    renderChart([makePoint()]);

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('cc-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Stator Temperature History/i }),
    ).toBeInTheDocument();
  });

  it('reports empty for an empty array', () => {
    renderChart([]);

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('cc-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });

  it('reports empty when every snapshot has all-null temps (no blank three-line panel)', () => {
    renderChart([
      makePoint({ time: '09:00', stator: null, statorRel: null, statorRer: null }),
      makePoint({ time: '09:05', stator: null, statorRel: null, statorRer: null }),
      makePoint({ time: '09:10', stator: null, statorRel: null, statorRer: null }),
    ]);

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('cc-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });

  it('is NOT empty when at least one snapshot carries a real temperature', () => {
    renderChart([
      makePoint({ time: '09:00', stator: null, statorRel: null, statorRer: null }),
      makePoint({ time: '09:05', stator: null, statorRel: 58, statorRer: null }),
    ]);

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('false');
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  it('treats an undefined data prop as empty instead of throwing on `.length` (crash guard)', () => {
    const renderUndefined = () =>
      render(
        <StatorTempChart data={undefined as unknown as MotorChartDataPoint[]} />,
      );
    expect(renderUndefined).not.toThrow();

    expect(screen.getByTestId('cc-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('cc-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    // The fallback table degrades to an empty row set rather than crashing.
    expect(readFallbackRows()).toEqual([]);
  });
});
