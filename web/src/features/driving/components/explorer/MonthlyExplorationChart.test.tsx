import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import english from '@/i18n/en.json';
import { summarizeExplorer } from '../../lib/explorer';
import type { ExplorerSectionState } from './types';
import { MonthlyExplorationChart } from './MonthlyExplorationChart';

const probes = vi.hoisted(() => ({
  palette: [] as readonly string[],
  hidden: new Set<string>(),
  frame: vi.fn(),
  chart: vi.fn(),
  series: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => probes.palette,
}));

vi.mock('@/components/charts', () => {
  const series = (props: Record<string, unknown>) => {
    probes.series(props);
    return null;
  };
  return {
    ChartContainer: ({
      children,
      ...props
    }: {
      children: (context: {
        hiddenSeries: { isHidden: (key: string) => boolean };
      }) => ReactNode;
      loading: boolean;
    }) => {
      probes.frame(props);
      return props.loading ? (
        <div role="status">Loading</div>
      ) : children({
        hiddenSeries: { isHidden: (key) => probes.hidden.has(key) },
      });
    },
    ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
    ComposedChart: ({ children, ...props }: { children: ReactNode }) => {
      probes.chart(props);
      return children;
    },
    Bar: series,
    Line: series,
    ChartLegend: () => null,
    ChartTooltip: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
    axisTick: {},
    chartGrid: null,
  };
});

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ message }: { message: string }) => <p>{message}</p>,
  QueryError: ({ onRetry }: { onRetry: () => void }) => (
    <div role="alert" onClick={onRetry}>Retry</div>
  ),
}));

const rows = [
  {
    month: '2026-01', newPlaces: 3, repeatArrivals: 2,
    destinationArrivals: 5, cumulativePlaces: 3, newArrivalShare: 0.6,
  },
  {
    month: '2026-02', newPlaces: 1, repeatArrivals: 4,
    destinationArrivals: 5, cumulativePlaces: 4, newArrivalShare: 0.2,
  },
];
const summary = { ...summarizeExplorer([]), monthlyExploration: rows };
const state: ExplorerSectionState = {
  isLoading: false, error: null, onRetry: vi.fn(),
};

function latestSeries() {
  return probes.series.mock.calls.slice(-3).map(([props]) => props);
}

describe('MonthlyExplorationChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    probes.hidden.clear();
    probes.palette = [
      'var(--series-0)', 'var(--series-1)', 'var(--series-2)',
      'var(--series-3)', 'var(--series-4)',
    ];
  });

  it('updates all series colors with the preference palette without changing identity or data', () => {
    const { rerender } = render(
      <MonthlyExplorationChart summary={summary} state={state} />,
    );
    expect(latestSeries()).toEqual([
      expect.objectContaining({
        dataKey: 'newPlaces', name: 'New places', stackId: 'arrivals',
        fill: probes.palette[1], radius: [0, 0, 3, 3], hide: false,
      }),
      expect.objectContaining({
        dataKey: 'repeatArrivals', name: 'Repeat arrivals', stackId: 'arrivals',
        fill: probes.palette[0], radius: [3, 3, 0, 0], hide: false,
      }),
      expect.objectContaining({
        dataKey: 'cumulativePlaces', name: 'Cumulative places',
        stroke: probes.palette[4], strokeWidth: 2, dot: false, hide: false,
      }),
    ]);
    const originalSeries = latestSeries();
    probes.palette = [
      'rgb(56, 94, 126)', 'rgb(56, 97, 79)', 'rgb(116, 88, 41)',
      'rgb(131, 70, 78)', 'rgb(98, 80, 119)',
    ];
    rerender(<MonthlyExplorationChart summary={summary} state={state} />);
    expect(latestSeries()).toEqual([
      { ...originalSeries[0], fill: probes.palette[1] },
      { ...originalSeries[1], fill: probes.palette[0] },
      { ...originalSeries[2], stroke: probes.palette[4] },
    ]);
    expect(probes.chart.mock.lastCall?.[0].data).toBe(rows);
    expect(probes.frame.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      chartKey: 'explorer-monthly-discovery', exportable: true,
      exportFilename: 'explorer-monthly-discovery', exportData: rows, data: rows,
    }));
    expect(probes.frame.mock.lastCall?.[0].dataColumns.map(
      (column: { key: string }) => column.key,
    )).toEqual(['month', 'newPlaces', 'repeatArrivals', 'cumulativePlaces']);
  });

  it('preserves legend visibility independently for populated series', () => {
    probes.hidden.add('repeatArrivals');
    render(<MonthlyExplorationChart summary={summary} state={state} />);
    expect(latestSeries().map((series) => [series.dataKey, series.hide])).toEqual([
      ['newPlaces', false], ['repeatArrivals', true], ['cumulativePlaces', false],
    ]);
  });

  it('matches canonical English title and series fallbacks without translations', () => {
    render(<MonthlyExplorationChart summary={summary} state={state} />);
    expect(probes.frame.mock.lastCall?.[0].title).toBe(english.explorer.discoveries);
    expect(latestSeries().map((series) => series.name)).toEqual([
      english.explorer.newPlaces,
      english.explorer.monthly.repeatSeries,
      english.explorer.monthly.cumulativeSeries,
    ]);
  });

  it('preserves the empty shell and disables export without rows', () => {
    render(<MonthlyExplorationChart summary={summarizeExplorer([])} state={state} />);
    expect(screen.getByTestId('explorer-monthly')).toBeInTheDocument();
    expect(screen.getByText(
      'No non-base destination arrivals are available for a monthly trend.',
    )).toBeInTheDocument();
    expect(probes.frame.mock.lastCall?.[0].exportable).toBe(false);
    expect(probes.series).not.toHaveBeenCalled();
  });

  it('preserves loading and error states with populated data and retry', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <MonthlyExplorationChart summary={summary} state={{ ...state, isLoading: true }} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(probes.frame.mock.lastCall?.[0].exportable).toBe(false);
    rerender(
      <MonthlyExplorationChart
        summary={summary}
        state={{ ...state, error: new Error('Unavailable'), onRetry }}
      />,
    );
    fireEvent.click(screen.getByRole('alert'));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(probes.frame.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ data: [], exportable: false }),
    );
    expect(probes.series).not.toHaveBeenCalled();
  });
});
