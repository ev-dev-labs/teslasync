/**
 * SessionCurveChart — behaviour + hardening coverage.
 *
 * The component takes a single `curveData: CurvePoint[]` prop and either plots
 * a power-vs-SOC area chart or, when there is nothing to plot, surfaces an
 * accessible empty state instead of a blank panel. This suite drives every
 * branch and asserts the real behaviour that matters:
 *   - the null-safe + rounded row derivation (the transform feeding BOTH the
 *     recharts series and the ChartContainer screen-reader/CSV fallback),
 *   - the empty branch (undefined prop, empty array) rendering an EmptyState
 *     and withholding the chart,
 *   - the per-point `?? 0` guards,
 *   - the series/axis bindings + accessible chart label + export filename,
 *   - and that the source array is never mutated in place.
 *
 * Only the `@/components/charts` barrel is doubled — its `ResponsiveContainer`
 * renders 0×0 in jsdom, so the series/data would otherwise be unobservable.
 * The `@/components/feedback` EmptyState is the REAL implementation so the
 * rendered `role="status"` + copy are genuinely exercised. Network is never
 * touched (this component has no data source of its own).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { CurvePoint } from './types';
import SessionCurveChart from './SessionCurveChart';

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

// ── charts barrel double: ResponsiveContainer renders its children so the
//    AreaChart double can surface the component-computed `data` (as JSON) plus
//    the series/axis bindings for direct assertion. ChartContainer exposes the
//    props the component wires (title, aria label, fallback `data`, columns,
//    export filename) as testable DOM. CHART_COLORS[0] is the stroke colour. ──
vi.mock('@/components/charts', () => {
  const Inert = () => null;
  return {
    CHART_COLORS: ['#00f0ff', '#ff00aa', '#00ffaa'],
    AREA_DEFAULTS: { type: 'monotone', strokeWidth: 2 },
    chartGrid: { stroke: 'rgba(255,255,255,0.06)' },
    axisTickSm: { fontSize: 11 },
    ChartTooltip: Inert,
    CartesianGrid: Inert,
    Tooltip: Inert,
    areaGradient: (id: string, color: string) => (
      <span data-testid="area-gradient" data-id={id} data-color={color} />
    ),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ChartContainer: ({
      title,
      subtitle,
      ariaLabel,
      data,
      dataColumns,
      exportFilename,
      exportable,
      children,
    }: {
      title?: string;
      subtitle?: string;
      ariaLabel?: string;
      data?: ReadonlyArray<Record<string, unknown>>;
      dataColumns?: ReadonlyArray<{ key: string; label: string }>;
      exportFilename?: string;
      exportable?: boolean;
      children?: ReactNode;
    }) => (
      <section aria-label="chart-container">
        <h3>{title}</h3>
        {subtitle ? <p data-testid="cc-subtitle">{subtitle}</p> : null}
        <div role="img" aria-label={ariaLabel}>
          <span data-testid="cc-data">{JSON.stringify(data ?? [])}</span>
          <span data-testid="cc-columns">{JSON.stringify(dataColumns ?? [])}</span>
          <span data-testid="cc-export-filename">{String(exportFilename ?? '')}</span>
          <span data-testid="cc-exportable">{String(exportable ?? '')}</span>
        </div>
        {children}
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
        {children}
      </div>
    ),
    Area: ({
      dataKey,
      name,
      stroke,
      unit,
    }: {
      dataKey?: string;
      name?: string;
      stroke?: string;
      unit?: string;
    }) => (
      <span
        data-testid="area-series"
        data-key={String(dataKey ?? '')}
        data-name={String(name ?? '')}
        data-stroke={String(stroke ?? '')}
        data-unit={String(unit ?? '')}
      />
    ),
    XAxis: ({ dataKey }: { dataKey?: string }) => (
      <span data-testid="x-axis" data-key={String(dataKey ?? '')} />
    ),
    YAxis: () => <span data-testid="y-axis" />,
  };
});

function renderChart(curveData: CurvePoint[]) {
  return render(
    <MemoryRouter>
      <SessionCurveChart curveData={curveData} />
    </MemoryRouter>,
  );
}

/** Rows the recharts AreaChart double received as its `data` prop. */
function readChartRows(): Array<{ soc: number; power: number }> {
  return JSON.parse(screen.getByTestId('area-chart-data').textContent || '[]');
}

/** Rows the ChartContainer double received for its SR/CSV fallback table. */
function readFallbackRows(): Array<{ soc: number; power: number }> {
  return JSON.parse(screen.getByTestId('cc-data').textContent || '[]');
}

const CURVE: CurvePoint[] = [
  { soc: 10, power: 120.456 },
  { soc: 50, power: 88 },
  { soc: 80, power: 44.04 },
];

describe('SessionCurveChart — panel chrome', () => {
  it('always frames the panel with title, subtitle and an accessible chart label', () => {
    renderChart(CURVE);

    expect(screen.getByRole('heading', { name: 'Power vs SOC' })).toBeInTheDocument();
    expect(screen.getByTestId('cc-subtitle')).toHaveTextContent(
      'Charging power curve for selected session',
    );
    expect(
      screen.getByRole('img', {
        name: 'Charging power versus state-of-charge area chart for the selected session',
      }),
    ).toBeInTheDocument();
  });

  it('wires the SOC/power fallback columns and a stable export filename', () => {
    renderChart(CURVE);

    const columns = JSON.parse(screen.getByTestId('cc-columns').textContent || '[]');
    expect(columns).toEqual([
      { key: 'soc', label: 'SOC %' },
      { key: 'power', label: 'Power (kW)' },
    ]);
    expect(screen.getByTestId('cc-export-filename')).toHaveTextContent('power-vs-soc');
    expect(screen.getByTestId('cc-exportable')).toHaveTextContent('true');
  });
});

describe('SessionCurveChart — populated', () => {
  it('rounds power to one decimal and feeds the SAME rows to the chart and the fallback table', () => {
    renderChart(CURVE);

    const expected = [
      { soc: 10, power: 120.5 }, // 120.456 → 120.5
      { soc: 50, power: 88 },
      { soc: 80, power: 44 }, // 44.04 → 44.0 → 44
    ];
    expect(readChartRows()).toEqual(expected);
    expect(readFallbackRows()).toEqual(expected);
  });

  it('binds the power series to the CHART_COLORS[0] stroke with the kW unit + axis keys', () => {
    renderChart(CURVE);

    const series = screen.getByTestId('area-series');
    expect(series).toHaveAttribute('data-key', 'power');
    expect(series).toHaveAttribute('data-name', 'Power');
    expect(series).toHaveAttribute('data-stroke', '#00f0ff');
    expect(series).toHaveAttribute('data-unit', ' kW');
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'soc');
  });

  it('renders the fill gradient with the expected id + colour and hides the empty state', () => {
    renderChart(CURVE);

    const grad = screen.getByTestId('area-gradient');
    expect(grad).toHaveAttribute('data-id', 'curvePowerGrad');
    expect(grad).toHaveAttribute('data-color', '#00f0ff');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not mutate the caller-supplied curve array in place', () => {
    const source: CurvePoint[] = [{ soc: 10, power: 120.456 }];
    renderChart(source);
    // The component copies via .map() before rounding — the source is untouched.
    expect(source[0].power).toBe(120.456);
  });
});

describe('SessionCurveChart — empty', () => {
  it('shows an accessible empty state and withholds the chart for an empty array', () => {
    renderChart([]);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No curve data for this session.');
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    // Panel chrome (title) still frames the empty state.
    expect(screen.getByRole('heading', { name: 'Power vs SOC' })).toBeInTheDocument();
    // Nothing to export → the fallback table receives an empty row set.
    expect(readFallbackRows()).toEqual([]);
  });

  it('treats an undefined curveData prop as empty instead of throwing (null-safety)', () => {
    expect(() =>
      renderChart(undefined as unknown as CurvePoint[]),
    ).not.toThrow();

    expect(screen.getByRole('status')).toHaveTextContent('No curve data for this session.');
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });
});

describe('SessionCurveChart — malformed points', () => {
  it('coerces undefined soc/power to 0 so the chart still plots (per-point guards)', () => {
    renderChart([{ soc: undefined, power: undefined } as unknown as CurvePoint]);

    expect(readChartRows()).toEqual([{ soc: 0, power: 0 }]);
    // A single (guarded) point is still a curve, not an empty state.
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
