import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';
import type { ChartTooltipProps } from '@/components/charts';
import type { CostForecastMonth, CostHistoricalMonth } from '@/types/charging';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';

const mocks = vi.hoisted(() => ({
  forecast: vi.fn(), vehicles: vi.fn(), refetch: vi.fn(), refetchVehicles: vi.fn(), tooltip: vi.fn(),
  formatCurrency: (value: number) => `$${value.toFixed(2)}`,
  tooltipMounted: vi.fn(), renderTooltip: false,
}));

vi.mock('@/api/hooks/useCharging', () => ({ useCostForecast: mocks.forecast }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: mocks.vehicles }));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    currencySymbol: '$',
    formatCurrency: mocks.formatCurrency,
  }),
}));
vi.mock('@/hooks/useDateLabels', () => ({
  useDateLabels: () => ({ formatMonthName: (value: string) => value.slice(0, 3) }),
}));
vi.mock('@/lib/timezone', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => 'America/New_York',
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const React = await import('react');
  return {
    ...actual,
    LineChart: ({ data, children }: { data: readonly unknown[]; children?: ReactNode }) => (
      <div data-testid="forecast-line-chart" data-json={JSON.stringify(data)}>{children}</div>
    ),
    BarChart: ({ data, children }: { data: readonly unknown[]; children?: ReactNode }) => (
      <div data-testid="classic-bar-chart" data-json={JSON.stringify(data)}>{children}</div>
    ),
    Line: ({ dataKey, strokeDasharray, connectNulls, name }: {
      dataKey: string; strokeDasharray?: string; connectNulls?: boolean; name: string;
    }) => (
      <span data-testid={`series-${dataKey}`} data-dash={strokeDasharray}
        data-connect-nulls={String(connectNulls)}>{name}</span>
    ),
    Bar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Cell: ({ strokeDasharray }: { strokeDasharray?: string }) => (
      <span data-testid="classic-cost-bar" data-dash={strokeDasharray} />
    ),
    XAxis: ({ dataKey }: { dataKey: string }) => <span data-testid="month-axis" data-key={dataKey} />,
    YAxis: ({ tickFormatter, width }: { tickFormatter: (value: number) => string; width: number }) => (
      <span data-testid="currency-axis" data-zero={tickFormatter(0)} data-width={width} />
    ),
    Tooltip: (props: { content?: unknown }) => {
      mocks.tooltip(props);
      if (!mocks.renderTooltip || typeof props.content !== 'function') return null;
      return React.createElement(props.content as ComponentType<{
        active: boolean; label: string; payload: { payload: unknown }[];
      }>, { active: true, label: 'Mar', payload: [{ payload: { month: 'Mar', cost: 130, period: 'forecast' } }] });
    },
    ChartTooltip: (props: ChartTooltipProps) => {
      React.useEffect(() => { if (mocks.renderTooltip) mocks.tooltipMounted(); }, []);
      return mocks.renderTooltip ? <span data-testid="mounted-forecast-tooltip" /> : <actual.ChartTooltip {...props} />;
    },
    Legend: ({ payload }: { payload: readonly { value: string }[] }) => (
      <div data-testid="cost-legend">{payload.map(item => <span key={item.value}>{item.value}</span>)}</div>
    ),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    chartGrid: null,
    useThemeChartPalette: () => ({ primary: '#2563eb', neutral: '#64748b' }),
    useMeasuredAxisWidth: () => 40,
  };
});

import CostForecastWidget from './CostForecastWidget';

const data = {
  historical: [{ month: 'January', cost: 100 }, { month: 'February', cost: 120 }],
  forecast: [{ month: 'March', cost: 130 }, { month: 'April', cost: 140 }],
} satisfies {
  historical: Pick<CostHistoricalMonth, 'month' | 'cost'>[];
  forecast: Pick<CostForecastMonth, 'month' | 'cost'>[];
};
const packs = Object.entries(PACK_APPEARANCES) as [Exclude<PackId, 'classic'>, string][];

function query(overrides: Record<string, unknown> = {}) {
  return {
    data, error: null, isLoading: false, isFetching: false, isStale: false, isError: false,
    dataUpdatedAt: Date.now(), refetch: mocks.refetch, ...overrides,
  };
}

function widget(packId: unknown, cols = 2, vehicleId: number | null = 42) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <CostForecastWidget vehicleId={vehicleId ?? undefined} size={{ cols, rows: 2 }} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function mount(packId: Exclude<PackId, 'classic'>, cols = 2) {
  const view = render(widget(packId, cols));
  await waitFor(() => expect(view.container.querySelector(
    `[data-widget-family="line"][data-widget-appearance="${PACK_APPEARANCES[packId]}"]`,
  )).not.toBeNull());
  return view;
}

interface ChartRow {
  month: string;
  cost: number | null;
  period: 'actual' | 'forecast';
  actualCost?: number | null;
  forecastCost?: number | null;
}

function lineRows(): ChartRow[] {
  return JSON.parse(screen.getByTestId('forecast-line-chart').getAttribute('data-json') ?? '[]') as ChartRow[];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.renderTooltip = false;
  mocks.forecast.mockReturnValue(query());
  mocks.vehicles.mockReturnValue({ data: [{ id: 7 }], refetch: mocks.refetchVehicles });
});

it.each([false, true])('registers grouped currency and month axes in the real chart (line=%s)', async asLine => {
  const charts = await vi.importActual<typeof import('@/components/charts')>('@/components/charts');
  const Chart = asLine ? charts.LineChart : charts.BarChart;
  const Series = asLine ? charts.Line : charts.Bar;
  const { container } = render(
    <Chart width={360} height={240} data={[
      { month: 'Jan', cost: 100 },
      { month: 'Feb', cost: 120 },
    ]}>
      <>
        <charts.XAxis dataKey="month" />
        <charts.YAxis tickFormatter={value => `$${value}`} />
      </>
      <Series dataKey="cost" isAnimationActive={false} />
    </Chart>,
  );
  await waitFor(() => expect(container.querySelectorAll(
    '.recharts-yAxis .recharts-cartesian-axis-tick-value',
  ).length).toBeGreaterThan(2));
  expect(container.querySelector('.recharts-yAxis')).toHaveTextContent('$');
  expect(container.querySelector('.recharts-xAxis')).toHaveTextContent('Jan');
  expect(container.querySelector('.recharts-xAxis')).toHaveTextContent('Feb');
});

describe.each(packs)('cost forecast %s (%s)', (packId) => {
  it('composes the real headline, periods, forecast plot, accessible samples and refresh action', async () => {
    const { container } = await mount(packId);
    expect(screen.getByTitle('Cost forecast')).toBeInTheDocument();
    expect(screen.getByText('$270.00')).toBeInTheDocument();
    expect(screen.getByText('Next 2 months')).toBeInTheDocument();
    expect(screen.getByText('Jan – Feb')).toBeInTheDocument();
    expect(screen.getByText('Mar – Apr')).toBeInTheDocument();
    expect(screen.getByText('Future costs are estimates.')).toBeInTheDocument();
    expect(lineRows()).toEqual([
      { month: 'Jan', cost: 100, period: 'actual', actualCost: 100, forecastCost: null },
      { month: 'Feb', cost: 120, period: 'actual', actualCost: 120, forecastCost: 120 },
      { month: 'Mar', cost: 130, period: 'forecast', actualCost: null, forecastCost: 130 },
      { month: 'Apr', cost: 140, period: 'forecast', actualCost: null, forecastCost: 140 },
    ]);
    expect(screen.getByTestId('series-actualCost')).not.toHaveAttribute('data-dash');
    expect(screen.getByTestId('series-forecastCost')).toHaveAttribute('data-dash', '6 5');
    expect(screen.getByTestId('series-forecastCost')).toHaveAttribute('data-connect-nulls', 'false');
    expect(screen.getByTestId('currency-axis')).toHaveAttribute('data-zero', '$0.00');
    expect(screen.getByTestId('month-axis')).toHaveAttribute('data-key', 'month');
    expect(within(screen.getByTestId('cost-legend')).getByText('Actual')).toBeInTheDocument();
    expect(within(screen.getByTestId('cost-legend')).getByText('Forecast')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Cost forecast — data table' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText('$130.00')).toBeInTheDocument();
    expect(screen.queryByTestId('classic-bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(container.querySelector('.lucide-trending-up')).not.toBeNull();
    expect(mocks.forecast).toHaveBeenCalledTimes(1);
    expect(mocks.forecast).toHaveBeenCalledWith('42', 6, 'America/New_York');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.refetchVehicles).not.toHaveBeenCalled();
  });

  it('preserves the compact headline branch without mounting a chart or inventing a meter', async () => {
    await mount(packId, 1);
    expect(screen.getByText('$270.00')).toBeInTheDocument();
    expect(screen.getByText('Next 2 months')).toBeInTheDocument();
    expect(screen.getByText('Jan – Feb')).toBeInTheDocument();
    expect(screen.queryByTestId('forecast-line-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('classic-bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('keeps unknown costs as chart gaps and an unknown total while retaining a measured zero', async () => {
    mocks.forecast.mockReturnValue(query({ data: {
      ...data, forecast: [{ month: 'March', cost: null }, { month: 'April', cost: 0 }],
    } }));
    const { container } = await mount(packId);
    expect(container.querySelector('[data-data-state="partial"]')).not.toBeNull();
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
    expect(container.querySelector('.widget-big-number')).not.toHaveTextContent('$0.00');
    expect(lineRows().slice(-2).map(row => row.forecastCost)).toEqual([null, 0]);
    expect(screen.getByTestId('series-forecastCost')).toHaveAttribute('data-connect-nulls', 'false');
    const table = screen.getByRole('table', { name: 'Cost forecast — data table' });
    expect(within(table).getByText('—')).toBeInTheDocument();
    expect(within(table).getByText('$0.00')).toBeInTheDocument();
  });

  it('retains the empty source shell, period sections and recovery without a false zero', async () => {
    mocks.forecast.mockReturnValue(query({ data: null, dataUpdatedAt: 0 }));
    await mount(packId);
    expect(screen.getByText('No forecast data')).toBeInTheDocument();
    expect(screen.getByText('Future costs are estimates.')).toBeInTheDocument();
    expect(screen.getByText('Actual')).toBeInTheDocument();
    expect(screen.getAllByText('Forecast')).toHaveLength(2);
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});

it('keeps an active tooltip mounted during background query updates', async () => {
  mocks.renderTooltip = true;
  const view = await mount('v4');
  await waitFor(() => expect(mocks.tooltipMounted).toHaveBeenCalledOnce());
  mocks.forecast.mockReturnValue(query({ isFetching: true }));
  view.rerender(widget('v4'));
  await waitFor(() => expect(view.container).toHaveTextContent('$270.00'));
  expect(screen.getByTestId('mounted-forecast-tooltip')).toBeInTheDocument();
  expect(mocks.tooltipMounted).toHaveBeenCalledOnce();
});

it('preserves Classic and unknown-ID recovery, including its original solid/dashed bars and compact body', () => {
  const view = render(widget('classic'));
  expect(screen.getByText('$270.00')).toBeInTheDocument();
  expect(screen.getByTestId('classic-bar-chart')).toBeInTheDocument();
  expect(screen.getAllByTestId('classic-cost-bar').map(bar => bar.getAttribute('data-dash')))
    .toEqual([null, null, '3 3', '3 3']);
  expect(screen.queryByText('Future costs are estimates.')).not.toBeInTheDocument();
  view.rerender(widget('retired-pack'));
  expect(screen.getByTestId('classic-bar-chart')).toBeInTheDocument();
  view.rerender(widget('classic', 1));
  expect(screen.getByText('$270.00')).toBeInTheDocument();
  expect(screen.queryByTestId('classic-bar-chart')).not.toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
});

it('switches all seven real PackBoundary selections without changing source scope or losing Classic recovery', async () => {
  const view = render(widget('classic', 3));
  for (const [packId, appearance] of packs) {
    view.rerender(widget(packId, 3));
    await waitFor(() => expect(view.container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());
    expect(screen.getByText('$270.00')).toBeInTheDocument();
    expect(lineRows().map(row => row.cost)).toEqual([100, 120, 130, 140]);
  }
  view.rerender(widget('classic', 3));
  expect(screen.getByTestId('classic-bar-chart')).toBeInTheDocument();
  expect(mocks.forecast.mock.calls.every(args =>
    args[0] === '42' && args[1] === 6 && args[2] === 'America/New_York')).toBe(true);
  expect(mocks.refetch).not.toHaveBeenCalled();
});

it('retains readings and the last-success timestamp during failed background refreshes', async () => {
  const updatedAt = Date.now() - 60_000;
  mocks.forecast.mockReturnValue(query({
    error: new Error('refresh unavailable'), isError: true, isStale: true, dataUpdatedAt: updatedAt,
  }));
  const { container } = await mount('v4');
  expect(screen.getByText('$270.00')).toBeInTheDocument();
  expect(screen.getByTestId('forecast-line-chart')).toBeInTheDocument();
  expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(
    'Previously loaded data remains visible while affected sources recover.',
  );
  expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
  expect(screen.getByRole('button', { name: /^Refresh data/ })).toHaveAccessibleName(/1m ago/);
});

it('preserves source failure and loading shells instead of calling either an empty forecast', () => {
  mocks.forecast.mockReturnValue(query({ data: undefined, error: new Error('source unavailable'), isError: true }));
  const view = render(widget('v2'));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('No forecast data')).not.toBeInTheDocument();
  mocks.forecast.mockReturnValue(query({ data: undefined, isLoading: true, isFetching: true }));
  view.rerender(widget('v2'));
  expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByTestId('forecast-line-chart')).not.toBeInTheDocument();
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
});

it('preserves signed costs and a valid zero total without normalizing either into missing data', async () => {
  mocks.forecast.mockReturnValue(query({ data: {
    historical: [{ month: 'January', cost: -20 }], forecast: [{ month: 'February', cost: 0 }],
  } }));
  await mount('v7');
  expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
  expect(lineRows().map(row => row.cost)).toEqual([-20, 0]);
  expect(screen.getByText('$-20.00')).toBeInTheDocument();
});

it('keeps the existing six-period chart window and does not fabricate a total for absent forecast rows', async () => {
  mocks.forecast.mockReturnValue(query({ data: {
    historical: Array.from({ length: 8 }, (_, index) => ({ month: `Month ${index}`, cost: index })),
    forecast: [],
  } }));
  const { container } = await mount('v3');
  expect(lineRows().map(row => row.cost)).toEqual([2, 3, 4, 5, 6, 7]);
  expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
});

it('degrades malformed arrays and invalid costs without crashing a presentation or inventing a reading', async () => {
  mocks.forecast.mockReturnValue(query({ data: {
    historical: 'invalid', forecast: [null, { month: 'April', cost: Number.POSITIVE_INFINITY }],
  } }));
  const { container } = await mount('v5');
  expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
  expect(lineRows().map(row => row.cost)).toEqual([null]);
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
});

it('recovers vehicle discovery independently when no vehicle can be resolved', async () => {
  mocks.vehicles.mockReturnValue({ data: [], refetch: mocks.refetchVehicles });
  mocks.forecast.mockReturnValue(query({ data: null, dataUpdatedAt: 0 }));
  const view = render(widget('v1', 1, null));
  await waitFor(() => expect(view.container.querySelector('[data-widget-appearance="studio"]')).not.toBeNull());
  expect(mocks.forecast).toHaveBeenCalledWith(null, 6, 'America/New_York');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(mocks.refetchVehicles).toHaveBeenCalledOnce();
  expect(mocks.refetch).not.toHaveBeenCalled();
});

it('formats a single source-correct tooltip at the actual/forecast join instead of duplicating its anchor', async () => {
  await mount('v6');
  interface TooltipInput {
    active: boolean;
    label: string;
    payload: { dataKey: string; payload: ChartRow }[];
  }
  const props = mocks.tooltip.mock.calls.at(-1)?.[0] as { content: (input: TooltipInput) => ReactNode };
  const actual: ChartRow = { month: 'Feb', cost: 120, period: 'actual' };
  const tooltip = render(<>{props.content({
    active: true, label: 'Feb', payload: [
      { dataKey: 'actualCost', payload: actual }, { dataKey: 'forecastCost', payload: actual },
    ],
  })}</>);
  const tooltipView = within(tooltip.container);
  expect(within(tooltipView.getByRole('tooltip')).getAllByText('$120.00')).toHaveLength(1);
  expect(tooltipView.getByRole('tooltip')).toHaveTextContent('Actual:');
  tooltip.rerender(<>{props.content({
    active: true, label: 'Mar', payload: [
      { dataKey: 'forecastCost', payload: { month: 'Mar', cost: 130, period: 'forecast' } },
    ],
  })}</>);
  expect(tooltipView.getByRole('tooltip')).toHaveTextContent('Forecast:');
  expect(tooltipView.getByRole('tooltip')).toHaveTextContent('$130.00');
});
