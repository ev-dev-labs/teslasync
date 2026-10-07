import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChartCardProps } from '@/components/layout';
import { ScoreTrendChart } from './ScoreTrendChart';
import { ScoreCategoryChart } from './ScoreCategoryChart';
import { ScoreDistributionChart } from './ScoreDistributionChart';

const frame = vi.hoisted(() => {
  const value: { props: ChartCardProps | null } = { props: null };
  return value;
});

vi.mock('@/components/layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/layout')>();
  return {
    ...actual,
    ChartCard: (props: ChartCardProps) => {
      frame.props = props;
      return <div>{typeof props.children === 'function'
        ? props.children({ annotations: [], hidden: false, hiddenSeries: null })
        : props.children}</div>;
    },
  };
});

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const Host = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Series = ({ dataKey, name }: { dataKey: string; name?: string }) =>
    <span data-testid={`series-${dataKey}`}>{name}</span>;
  return {
    ...actual,
    ResponsiveContainer: Host, LineChart: Host, BarChart: Host,
    Line: Series, Bar: Series, Cell: () => null,
    XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null,
    ChartLegend: () => null, ReferenceLine: () => null, renderAnnotationLines: () => null,
  };
});

beforeEach(() => { frame.props = null; });

describe('score chart adapters preserve canonical capabilities', () => {
  it('forwards every prepared trend row, all four series and the persisted annotation/legend identity', () => {
    const data = Array.from({ length: 21 }, (_, index) => ({
      date: `Day ${index}`, score: index, efficiency: index, smoothness: index, speed: index,
    }));
    render(<ScoreTrendChart data={data} vehicleId={7} scoreColor="var(--theme-primary)"
      colors={{ efficiency: 'green', smoothness: 'cyan', speed: 'purple' }} />);
    expect(frame.props?.data).toEqual(data);
    expect(frame.props?.data).toHaveLength(21);
    expect(frame.props?.dataColumns?.map((column) => column.key)).toEqual(['date', 'score', 'efficiency', 'smoothness', 'speed']);
    expect(frame.props).toMatchObject({
      height: 300, size: 'standard', toolbar: true, exportable: true,
      chartKey: 'drive-score-trend',
      annotations: { vehicleId: 7, scope: 'efficiency', chartId: 'drive-score-trend' },
    });
    for (const key of ['score', 'efficiency', 'smoothness', 'speed']) {
      expect(screen.getByTestId(`series-${key}`)).toBeInTheDocument();
    }
  });

  it('keeps unknown and measured-zero category values distinct in the accessible data', () => {
    render(<ScoreCategoryChart data={[
      { name: 'Efficiency', value: null, max: 40, fill: 'green' },
      { name: 'Smoothness', value: 0, max: 30, fill: 'cyan' },
      { name: 'Speed Discipline', value: 30, max: 30, fill: 'purple' },
    ]} />);
    expect(frame.props?.data).toEqual([
      { name: 'Efficiency', value: null, max: 40 },
      { name: 'Smoothness', value: 0, max: 30 },
      { name: 'Speed Discipline', value: 30, max: 30 },
    ]);
    expect(frame.props).toMatchObject({ height: 260, size: 'standard', toolbar: true, exportable: true });
    expect(screen.getByTestId('series-value')).toBeInTheDocument();
    expect(screen.getByTestId('series-max')).toBeInTheDocument();
  });

  it('retains all five histogram bins including real zero counts and the original export frame', () => {
    const data = ['0–20', '20–40', '40–60', '60–80', '80–100']
      .map((range, index) => ({ range, count: index, color: 'var(--theme-primary)' }));
    render(<ScoreDistributionChart data={data} />);
    expect(frame.props?.data).toEqual(data.map(({ range, count }) => ({ range, count })));
    expect(frame.props?.dataColumns?.map((column) => column.key)).toEqual(['range', 'count']);
    expect(frame.props).toMatchObject({ height: 240, size: 'standard', toolbar: true, exportable: true });
    expect(screen.getByTestId('series-count')).toBeInTheDocument();
  });
});
