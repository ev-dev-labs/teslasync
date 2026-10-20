import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartTokens } from '@/lib/tokens';
import { forecastData } from './fixtures.test-utils';
import { CostForecastSection } from './CostForecastSection';

const captured = vi.hoisted(() => ({
  charts: [] as Record<string, unknown>[],
  series: [] as Record<string, unknown>[],
  palette: ['var(--test-actual)', 'var(--test-forecast)'],
  hidden: new Set<string>(),
  legends: 0,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/hooks/useChartPalette', () => ({ useChartPalette: () => captured.palette }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('./useSourceStatPeriod', () => ({ useIndependentStatPeriod: () => ({ kind: 'unknown' }) }));
vi.mock('./ForecastDetails', () => ({ ForecastDetails: () => <div data-testid="details" /> }));
vi.mock('./CostStatSection', () => ({
  CostStatSection: ({ children, isEmpty, emptyMessage }: {
    children: ReactNode; isEmpty: boolean; emptyMessage: string;
  }) => <section>{isEmpty ? emptyMessage : children}</section>,
}));
vi.mock('@/components/charts', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Series = (props: Record<string, unknown>) => {
    captured.series.push(props);
    return null;
  };
  return {
    EmbeddedChart: (props: Record<string, unknown>) => {
      captured.charts.push(props);
      const children = props.children;
      return <div>{typeof children === 'function'
        ? children({ hiddenSeries: { isHidden: (key: string) => captured.hidden.has(key) } })
        : children as ReactNode}</div>;
    },
    ResponsiveContainer: Pass, ComposedChart: Pass, LineChart: Pass,
    Area: Series, Line: Series, XAxis: () => null, YAxis: () => null,
    CartesianGrid: () => null, Tooltip: () => null, ChartTooltip: () => null,
    ChartLegend: () => { captured.legends++; return null; },
    chartGrid: {}, axisTickSm: {}, AREA_DEFAULTS: { strokeWidth: 2, connectNulls: false },
  };
});
beforeEach(() => {
  captured.charts = [];
  captured.series = [];
  captured.palette = ['var(--test-actual)', 'var(--test-forecast)'];
  captured.hidden.clear();
  captured.legends = 0;
});
afterEach(cleanup);

describe('CostForecastSection restrained chart roles', () => {
  it('retains identity, confidence geometry, legend, exports and fullscreen with bounded fills', () => {
    render(<CostForecastSection forecastData={forecastData} />);
    expect(captured.charts).toHaveLength(2);
    for (const chart of captured.charts) {
      expect(chart.exportable).toBe(true);
      expect(chart.fullscreen).toBe(true);
      expect(chart.exportData).toBe(chart.data);
    }
    expect(captured.charts[0].chartKey).toBe('cost-analysis-forecast');
    expect(captured.legends).toBe(1);
    expect(captured.series.find(s => s.dataKey === 'actual')).toMatchObject({
      stroke: captured.palette[0], fill: captured.palette[0], fillOpacity: 0.08,
      name: 'Actual cost', connectNulls: false,
    });
    expect(captured.series.find(s => s.dataKey === 'forecast')).toMatchObject({
      stroke: captured.palette[1], strokeDasharray: '8 4', name: 'Projected cost',
      connectNulls: false,
    });
    expect(captured.series.find(s => s.dataKey === 'ci_band')).toMatchObject({
      fill: captured.palette[1], fillOpacity: 0.08, stackId: 'ci',
      name: 'Approximate prediction interval',
    });
    expect(captured.charts[0].data).toEqual([
      { month: '2026-01', actual: 10 }, { month: '2026-02', actual: 12 },
      { month: '2026-03', actual: 14 },
      { month: '2026-04', forecast: 16, ci_low: 12, ci_band: 8, ci_high: 20 },
      { month: '2026-05', forecast: 18, ci_low: undefined, ci_band: undefined, ci_high: undefined },
    ]);
  });

  it('uses existing chart roles for absent palette entries and keeps legend hiding', () => {
    captured.palette = [];
    captured.hidden = new Set(['actual', 'forecast', 'ci_band']);
    render(<CostForecastSection forecastData={forecastData} />);
    expect(captured.series.find(s => s.dataKey === 'actual')).toMatchObject({
      stroke: chartTokens.series[0], hide: true,
    });
    expect(captured.series.find(s => s.dataKey === 'forecast')).toMatchObject({
      stroke: chartTokens.series[1], hide: true,
    });
    for (const key of ['ci_low', 'ci_band']) {
      expect(captured.series.find(s => s.dataKey === key)?.hide).toBe(true);
    }
  });

  it.each([null, undefined, NaN, Infinity, -Infinity, '12', ''])(
    'keeps missing or invalid %s as gaps rather than measured zero', raw => {
      // Exercise malformed wire data without weakening the production DTO.
      const data = {
        ...forecastData,
        historical: forecastData.historical.map(row => ({ ...row, cost: raw, cost_per_kwh: raw })),
        forecast: forecastData.forecast.map(row => ({ ...row, cost: raw, cost_low: raw })),
      };
      render(<CostForecastSection forecastData={data as typeof forecastData} />);
      const rows = captured.charts[0].data as Record<string, unknown>[];
      expect(rows.slice(0, 3).every(row => row.actual === undefined)).toBe(true);
      expect(rows.slice(3).every(row => row.forecast === undefined && row.ci_band === undefined)).toBe(true);
      expect((captured.charts[1].data as Record<string, unknown>[])
        .every(row => row.cost_per_kwh === undefined)).toBe(true);
      expect(data.historical[0].cost).toBe(raw);
    },
  );

  it.each([0, -12.125, 0.375])('preserves measured %s without rounding or clamping', cost => {
    const data = {
      ...forecastData,
      historical: forecastData.historical.map(row => ({ ...row, cost, cost_per_kwh: cost })),
      forecast: [{ ...forecastData.forecast[0]!, cost, cost_low: cost - 0.25, cost_high: cost + 0.5 }],
    };
    render(<CostForecastSection forecastData={data} />);
    expect(captured.charts[0].data).toEqual([
      ...data.historical.map(row => ({ month: row.month, actual: cost })),
      { month: data.forecast[0].month, forecast: cost, ci_low: cost - 0.25, ci_band: 0.75, ci_high: cost + 0.5 },
    ]);
    expect(captured.charts[1].data).toEqual(data.historical.map(row => ({ month: row.month, cost_per_kwh: cost })));
  });

  it('keeps both empty section shells and forecast details when the source is missing', () => {
    const { container } = render(<CostForecastSection forecastData={undefined} />);
    expect(container.querySelectorAll('section')).toHaveLength(2);
    expect(container.textContent).toContain('Need at least 3 months');
    expect(container.textContent).toContain('Need at least 2 months');
    expect(container.querySelector('[data-testid="details"]')).not.toBeNull();
    expect(captured.charts).toHaveLength(0);
  });
});
