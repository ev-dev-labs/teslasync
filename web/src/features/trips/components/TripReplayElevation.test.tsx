import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TripReplayElevation, type TripReplayElevationPoint } from './TripReplayElevation';

const captured = vi.hoisted(() => ({
  points: [] as TripReplayElevationPoint[],
  onClick: undefined as ((state: { activeTooltipIndex?: number } | null) => void) | undefined,
  connectNulls: undefined as boolean | undefined,
  cursor: undefined as number | undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, string>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => values?.[name] ?? name),
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => String(value) }),
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock('@/components/layout', async () => ({
  ChartCard: (await import('@/components/charts')).ChartContainer,
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
    Area: ({ connectNulls }: { connectNulls?: boolean }) => {
      captured.connectNulls = connectNulls;
      return null;
    },
    ReferenceLine: ({ x }: { x: number }) => {
      captured.cursor = x;
      return null;
    },
    XAxis: inert, YAxis: inert, CartesianGrid: inert, Tooltip: inert, ChartTooltip: inert,
    chartGrid: {}, axisTick: {}, AREA_DEFAULTS: {}, areaGradient: inert,
  };
});

function point(index: number, elevation: number | null): TripReplayElevationPoint {
  return { index, elevation, distance: index * 2, speed: null };
}

beforeEach(() => {
  captured.points = [];
  captured.onClick = undefined;
  captured.cursor = undefined;
  captured.connectNulls = undefined;
});
afterEach(cleanup);

describe('TripReplayElevation', () => {
  it('retains the section and shows unknown altitude instead of a flat zero trace', () => {
    render(<TripReplayElevation data={[point(0, null), point(1, null)]} currentIndex={0} onClickIndex={vi.fn()} distanceUnit="km" />);
    expect(screen.getByText('Elevation Profile')).toBeInTheDocument();
    expect(screen.getByText('No elevation data available')).toBeInTheDocument();
    expect(captured.points).toEqual([]);
    expect(screen.queryByText(/↑/)).not.toBeInTheDocument();
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
