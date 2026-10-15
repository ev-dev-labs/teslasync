import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CostForecastSection } from './CostForecastSection';
import { forecastData } from './fixtures.test-utils';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => {
      const oldTranslations: Record<string, string> = {
        'costAnalysis.forecast.confidence': '95% Confidence',
        'costAnalysis.forecast.chartAria': 'Historical and projected monthly charging cost with confidence band',
      };
      return oldTranslations[key] ?? fallback;
    },
  }),
}));
vi.mock('@/hooks/useChartPalette', () => ({ useChartPalette: () => ['var(--chart-1)', 'var(--chart-2)'] }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('./ForecastDetails', () => ({
  ForecastDetails: () => <div data-testid="forecast-details" />,
}));
vi.mock('./CostStatSection', () => ({
  CostStatSection: ({ children, isEmpty, emptyMessage }: {
    children: ReactNode; isEmpty: boolean; emptyMessage: string;
  }) => <section>{isEmpty ? emptyMessage : children}</section>,
}));
vi.mock('@/components/charts', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Rows = ({ data, children }: { data: unknown[]; children?: ReactNode }) =>
    <div data-testid="chart-rows" data-rows={JSON.stringify(data)}>{children}</div>;
  const Series = ({ dataKey, name, connectNulls, hide }: {
    dataKey: string; name?: string; connectNulls?: boolean; hide?: boolean;
  }) => <span data-series={dataKey} data-connect-nulls={String(connectNulls)} data-hide={String(hide)}>{name}</span>;
  return {
    EmbeddedChart: ({ ariaLabel, data, exportData, dataColumns, children }: {
      ariaLabel: string; data: unknown[]; exportData?: unknown[];
      dataColumns: unknown[]; children: ReactNode | ((context: {
        hiddenSeries: { isHidden: (key: string) => boolean };
      }) => ReactNode);
    }) => <div role="img" aria-label={ariaLabel} data-rows={JSON.stringify(data)}
      data-export={JSON.stringify(exportData)} data-columns={JSON.stringify(dataColumns)}>
      {typeof children === 'function'
        ? children({ hiddenSeries: { isHidden: () => false } }) : children}
    </div>,
    ResponsiveContainer: Pass, ComposedChart: Rows, LineChart: Rows,
    Area: Series, Line: Series, ChartLegend: () => null, ChartTooltip: () => null,
    CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
    chartGrid: {}, axisTickSm: {}, AREA_DEFAULTS: {}, areaGradient: () => null,
  };
});

afterEach(cleanup);

describe('CostForecastSection prediction interval', () => {
  it('uses approximate prediction terminology even when old confidence translations exist', () => {
    render(<CostForecastSection forecastData={forecastData} />);
    expect(screen.getByRole('img', {
      name: 'Historical and projected monthly charging cost with an approximate prediction interval',
    })).toBeInTheDocument();
    expect(screen.getByText('Approximate prediction interval')).toBeInTheDocument();
    expect(screen.queryByText(/95%|confidence|calibrat/i)).not.toBeInTheDocument();
  });

  it('preserves populated history, projections, bounds, export rows and the separate rate trend', () => {
    const { container } = render(<CostForecastSection forecastData={forecastData} />);
    const chart = screen.getByRole('img', { name: /approximate prediction interval/ });
    const rows = [
      ...forecastData.historical.map(({ month, cost }) => ({ month, actual: cost })),
      { month: '2026-04', forecast: 16, ci_low: 12, ci_band: 8, ci_high: 20 },
      { month: '2026-05', forecast: 18 },
    ];
    expect(JSON.parse(chart.getAttribute('data-rows')!)).toEqual(rows);
    expect(JSON.parse(chart.getAttribute('data-export')!)).toEqual(rows);
    expect(JSON.parse(chart.getAttribute('data-columns')!)).toEqual([
      { key: 'month', label: 'Month' },
      { key: 'actual', label: 'Actual Cost' },
      { key: 'forecast', label: 'Projected Cost' },
      { key: 'ci_low', label: 'Lower bound' },
      { key: 'ci_high', label: 'Upper bound' },
    ]);
    for (const key of ['actual', 'forecast', 'ci_low', 'ci_band']) {
      expect(container.querySelector(`[data-series="${key}"]`)).toHaveAttribute('data-connect-nulls', 'false');
      expect(container.querySelector(`[data-series="${key}"]`)).toHaveAttribute('data-hide', 'false');
    }
    expect(JSON.parse(screen.getAllByTestId('chart-rows')[1].getAttribute('data-rows')!))
      .toEqual(forecastData.historical);
    expect(container.querySelector('[data-series="cost_per_kwh"]')).toBeInTheDocument();
    expect(screen.getByTestId('forecast-details')).toBeInTheDocument();
  });

  it('retains the history threshold and renders the rate trend independently', () => {
    render(<CostForecastSection forecastData={{
      ...forecastData, historical: forecastData.historical.slice(0, 2),
    }} />);
    expect(screen.getByText('Need at least 3 months of charging data for cost forecasting.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /approximate prediction interval/ })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Monthly average cost per kilowatt-hour trend' })).toBeInTheDocument();
  });
});
