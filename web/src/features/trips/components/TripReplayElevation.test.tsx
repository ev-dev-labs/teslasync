import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TripReplayElevation, type TripReplayElevationPoint } from './TripReplayElevation';
import type { ChartCardProps } from '@/components/layout';
import english from '@/i18n/en.json';

const captured = vi.hoisted(() => ({
  palette: ['#91b4d2', '#c0a384'],
  stroke: undefined as string | undefined,
  gradient: undefined as { id: string; color: string; opacity: number } | undefined,
  points: [] as TripReplayElevationPoint[],
  onClick: undefined as ((state: { activeTooltipIndex?: number } | null) => void) | undefined,
  connectNulls: undefined as boolean | undefined,
  cursor: undefined as number | undefined,
  useCatalog: false,
}));

vi.mock('@/hooks/useChartPalette', () => ({ useChartPalette: () => captured.palette }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, string>) => {
      const catalogValue = captured.useCatalog && key.startsWith('replay.elevation.')
        ? english.replay.elevation[key.slice('replay.elevation.'.length) as keyof typeof english.replay.elevation]
        : undefined;
      return (catalogValue ?? fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => values?.[name] ?? name);
    },
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => String(value) }),
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock('@/components/layout', () => ({
  ChartCard: ({ title, subtitle, ariaLabel, children, data, dataColumns }: ChartCardProps) =>
    <div role="region" aria-label={ariaLabel}>
      {title}{subtitle && <div>{subtitle}</div>}{children}
      <div aria-label="Chart sample alternative">
        {dataColumns?.map(column => <span key={column.key}>{column.label}</span>)}
        {data?.map((row, index) => (
          <div key={index} data-testid="sample-row">
            {dataColumns?.map(column => (
              <span key={column.key}>
                {column.format ? column.format(row[column.key]) : String(row[column.key] ?? '—')}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>,
}));

vi.mock('@/components/charts', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const inert = () => null;
  return {
    ChartContainer: ({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) =>
      <div>{title}{subtitle && <div>{subtitle}</div>}{children}</div>,
    ResponsiveContainer: passthrough,
    AreaChart: ({ data, onClick, children }: {
      data: TripReplayElevationPoint[];
      onClick: (state: { activeTooltipIndex?: number } | null) => void;
      children?: ReactNode;
    }) => {
      captured.points = data;
      captured.onClick = onClick;
      return <div>{children}</div>;
    },
    Area: ({ connectNulls, stroke }: { connectNulls?: boolean; stroke?: string }) => {
      captured.connectNulls = connectNulls;
      captured.stroke = stroke;
      return null;
    },
    ReferenceLine: ({ x }: { x: number }) => {
      captured.cursor = x;
      return null;
    },
    XAxis: inert, YAxis: inert, CartesianGrid: inert, Tooltip: inert, ChartTooltip: inert,
    chartGrid: {}, axisTick: {}, AREA_DEFAULTS: {},
    areaGradient: (id: string, color: string, opacity: number) => {
      captured.gradient = { id, color, opacity };
      return null;
    },
  };
});

function point(index: number, elevation: number | null): TripReplayElevationPoint {
  return { index, elevation, distance: index * 2, speed: null };
}

beforeEach(() => {
  captured.palette = ['#91b4d2', '#c0a384'];
  captured.stroke = undefined;
  captured.gradient = undefined;
  captured.points = [];
  captured.onClick = undefined;
  captured.cursor = undefined;
  captured.connectNulls = undefined;
  captured.useCatalog = false;
});
afterEach(cleanup);

describe('TripReplayElevation', () => {
  it('uses a state-neutral translated name for populated, missing-altitude and empty profiles', () => {
    captured.useCatalog = true;
    const onClickIndex = vi.fn();
    const { rerender } = render(
      <TripReplayElevation data={[point(0, 0), point(1, 5)]} currentIndex={0} onClickIndex={onClickIndex} distanceUnit="km" />,
    );
    const name = english.replay.elevation.title;
    expect(screen.getByRole('region', { name })).toBeInTheDocument();
    expect(captured.points).toEqual([point(0, 0), point(1, 5)]);
    captured.onClick?.({ activeTooltipIndex: 1 });
    expect(onClickIndex).toHaveBeenCalledWith(1);

    for (const data of [[point(0, null), point(1, null)], []]) {
      rerender(<TripReplayElevation data={data} currentIndex={0} onClickIndex={onClickIndex} distanceUnit="km" />);
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
      expect(screen.getByText('No elevation data available')).toBeInTheDocument();
    }
    expect(screen.queryByRole('region', { name: english.replay.elevation.aria })).not.toBeInTheDocument();
  });

  it('reacts to the shared palette without changing samples, gaps, cursor or seeking', () => {
    const data = [point(4, 100), point(9, null), point(15, 120)];
    const onClickIndex = vi.fn();
    const { rerender } = render(<TripReplayElevation data={data} currentIndex={9} onClickIndex={onClickIndex} distanceUnit="mi" />);
    expect(captured.gradient).toEqual({ id: 'replayElevationGrad', color: captured.palette[0], opacity: 0.08 });
    captured.palette = ['#385e7e', '#625077'];
    rerender(<TripReplayElevation data={data} currentIndex={9} onClickIndex={onClickIndex} distanceUnit="mi" />);
    expect(captured.stroke).toBe(captured.palette[0]);
    expect(captured.gradient?.color).toBe(captured.palette[0]);
    expect(captured.points).toEqual(data);
    expect(captured.cursor).toBe(18);
    expect(captured.connectNulls).toBe(false);
    expect(onClickIndex).not.toHaveBeenCalled();
  });

  it('provides every sample to the chart alternative with original indices, units, and altitude gaps', () => {
    const data = [point(4, 0), point(9, null), point(15, 310)];
    render(<TripReplayElevation data={data} currentIndex={9} onClickIndex={vi.fn()} distanceUnit="mi" />);
    expect(screen.getByText('Sample')).toBeInTheDocument();
    expect(screen.getByText('Distance (mi)')).toBeInTheDocument();
    expect(screen.getByText('Elevation (m)')).toBeInTheDocument();
    expect(screen.getAllByTestId('sample-row').map(row =>
      Array.from(row.children, cell => cell.textContent),
    )).toEqual([
      ['4', '8', '0'], ['9', '18', '—'], ['15', '30', '310'],
    ]);
    expect(captured.points).toEqual(data);
    expect(captured.connectNulls).toBe(false);
    expect(captured.cursor).toBe(18);
  });

  it('retains the section and shows unknown altitude instead of a flat zero trace', () => {
    render(<TripReplayElevation data={[point(0, null), point(1, null)]} currentIndex={0} onClickIndex={vi.fn()} distanceUnit="km" />);
    expect(screen.getByText('Elevation Profile')).toBeInTheDocument();
    expect(screen.getByText('No elevation data available')).toBeInTheDocument();
    expect(captured.points).toEqual([]);
    expect(screen.queryByText(/↑/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('sample-row').map(row =>
      Array.from(row.children, cell => cell.textContent),
    )).toEqual([['0', '0', '—'], ['1', '2', '—']]);
  });

  it('retains gaps and original sample indices, without invented climbs across a missing observation', () => {
    const data = [point(0, 100), point(1, null), point(2, 300), point(3, 310)];
    render(<TripReplayElevation data={data} currentIndex={2} onClickIndex={vi.fn()} distanceUnit="mi" />);
    expect(captured.points).toEqual(data);
    expect(captured.connectNulls).toBe(false);
    expect(captured.cursor).toBe(4);
    expect(screen.getByText('↑ 10m ↓ 0m')).toBeInTheDocument();
  });

  it('seeks the recorded sample index instead of the chart row offset', () => {
    const onClickIndex = vi.fn();
    render(<TripReplayElevation data={[point(4, 0), point(9, 5)]} currentIndex={4} onClickIndex={onClickIndex} distanceUnit="km" />);
    captured.onClick?.({ activeTooltipIndex: 1 });
    expect(onClickIndex).toHaveBeenCalledWith(9);
    captured.onClick?.(null);
    captured.onClick?.({ activeTooltipIndex: 20 });
    expect(onClickIndex).toHaveBeenCalledTimes(1);
  });

  it('renders a genuinely observed zero elevation, without confusing it with missing altitude', () => {
    render(<TripReplayElevation data={[point(0, 0), point(1, 0)]} currentIndex={0} onClickIndex={vi.fn()} distanceUnit="km" />);
    expect(captured.points).toHaveLength(2);
    expect(screen.queryByText('No elevation data available')).not.toBeInTheDocument();
    expect(screen.getByText('↑ 0m ↓ 0m')).toBeInTheDocument();
  });
});
