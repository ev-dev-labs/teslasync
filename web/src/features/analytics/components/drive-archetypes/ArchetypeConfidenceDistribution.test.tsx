import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { Drive } from '@/types/driving';
import { summarizeArchetypes } from '../../lib/driveArchetypes';
import { ArchetypeConfidenceDistribution } from './ArchetypeConfidenceDistribution';
import type { ArchetypeQueryState } from './types';

const { chartCard } = vi.hoisted(() => ({ chartCard: vi.fn() }));

vi.mock('@/components/layout', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/layout')>(),
  ChartCard: (props: { children: ReactNode }) => {
    chartCard(props);
    return <div>{props.children}</div>;
  },
}));

vi.mock('@/components/charts', () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="margin-chart">{children}</div>,
  CartesianGrid: () => null,
  ChartTooltip: () => null,
  CHART_COLORS: ['var(--chart-1)'],
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  axisTick: {},
}));

function drive(index: number): Drive {
  return {
    id: index + 1, vehicleId: 1,
    startTs: new Date(Date.UTC(2026, 2, index + 1, index % 2 ? 14 : 8)).toISOString(),
    endTs: null, durationS: 1200, distanceM: index % 2 ? 140000 + index * 100 : 12000 + index * 100,
    energyUsedWh: index % 2 ? 23000 + index * 100 : 2400 + index * 10,
    avgSpeedMps: index % 2 ? 28 + index / 100 : 8 + index / 100,
    outsideTempAvgC: 15 + index / 10,
    startAddress: null, endAddress: null, startLat: null, startLon: null,
    endLat: null, endLon: null, startBatteryPct: null, endBatteryPct: null,
    regenEnergyWh: null, maxSpeedMps: null, avgPowerW: null,
    insideTempAvgC: null, score: null, endedStatus: null, createdAt: '', updatedAt: '',
  };
}

function source(overrides: Partial<ArchetypeQueryState> = {}): ArchetypeQueryState {
  return {
    vehicleSelected: true, hasData: true, isLoading: false, isResolved: true,
    isFetching: false, isPaused: false, refreshPaused: false,
    error: null, refreshError: null, onRetry: vi.fn(), ...overrides,
  };
}

const belowFloor = summarizeArchetypes([drive(0), drive(1)], { timeZone: 'UTC' });
const populated = summarizeArchetypes(Array.from({ length: 24 }, (_, index) => drive(index)), { timeZone: 'UTC' });

function show(summary = belowFloor, state = source()) {
  return render(
    <MemoryRouter>
      <ArchetypeConfidenceDistribution summary={summary} state={state} />
    </MemoryRouter>,
  );
}

describe('ArchetypeConfidenceDistribution assignment publication', () => {
  it.each([
    ['insufficient_drives', /2 eligible drives.*at least 20 are required/],
    ['insufficient_variation', /no standardized feature dimension varies/],
    ['insufficient_partition', /no candidate realized every requested cluster/],
  ] as const)('withholds fallback rows for %s while retaining the limitation', (status, message) => {
    show({ ...belowFloor, status });
    expect(chartCard).toHaveBeenLastCalledWith(expect.objectContaining({
      data: [], exportData: [], exportable: false,
    }));
    expect(screen.getByTestId('drive-archetypes-confidence')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByTestId('margin-chart')).not.toBeInTheDocument();
    expect(screen.queryByText(/ambiguity boundary/)).not.toBeInTheDocument();
    expect(belowFloor.featureRanges.distanceM).toEqual({ min: 12000, median: 76050, max: 140100 });
    expect(belowFloor.source.eligibleObservedTempRows).toBe(2);
  });

  it.each([
    [{ vehicleSelected: false, hasData: false, isResolved: false }, /Select a vehicle/],
    [{ hasData: false, isResolved: false }, /availability has not resolved/],
    [{ hasData: false, isPaused: true, isResolved: false }, /no empty response is inferred/],
    [{ refreshError: new Error('refresh failed') }, /2 eligible drives.*at least 20 are required/],
  ] as const)('preserves explicit source alternatives below the floor', (overrides, message) => {
    show(belowFloor, source(overrides));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(chartCard).toHaveBeenLastCalledWith(expect.objectContaining({ data: [], exportData: [] }));
  });

  it('preserves loading and fatal-error recovery below the floor', () => {
    const retry = vi.fn();
    const view = show(belowFloor, source({ hasData: false, isLoading: true, isResolved: false }));
    expect(screen.getByRole('status', { name: 'Loading Drive archetypes' })).toBeInTheDocument();
    view.rerender(
      <MemoryRouter>
        <ArchetypeConfidenceDistribution
          summary={belowFloor}
          state={source({ hasData: false, isResolved: false, error: new Error('unavailable'), onRetry: retry })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Drive evidence is unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('preserves all five populated margin bins, shares, and exports during a retained refresh', () => {
    expect(populated.status).toBe('clustered');
    show(populated, source({ refreshError: new Error('refresh failed') }));
    const bins = [
      { margin: '< 0.10', min: 0, max: 0.1 },
      { margin: '0.10–0.24', min: 0.1, max: 0.25 },
      { margin: '0.25–0.49', min: 0.25, max: 0.5 },
      { margin: '0.50–0.74', min: 0.5, max: 0.75 },
      { margin: '0.75–1.00', min: 0.75, max: 1.000001 },
    ];
    const rows = bins.map(({ margin, min, max }) => {
      const count = populated.assignments.filter((item) => item.assignmentMargin >= min && item.assignmentMargin < max).length;
      return { margin, count, share: count / populated.assignments.length * 100 };
    });
    expect(chartCard).toHaveBeenLastCalledWith(expect.objectContaining({
      data: rows, exportData: rows, exportable: true,
    }));
    expect(screen.getByTestId('margin-chart')).toBeInTheDocument();
    expect(screen.getByText(/ambiguity boundary/)).toBeInTheDocument();
    expect(screen.getByText(/most recently loaded evidence remains visible/)).toBeInTheDocument();
  });

  it('withdraws previously populated rows when the window drops below the clustering floor', () => {
    const view = show(populated);
    view.rerender(
      <MemoryRouter>
        <ArchetypeConfidenceDistribution summary={belowFloor} state={source()} />
      </MemoryRouter>,
    );
    expect(chartCard).toHaveBeenLastCalledWith(expect.objectContaining({
      data: [], exportData: [], exportable: false,
    }));
    expect(screen.getByText(/2 eligible drives.*at least 20 are required/)).toBeInTheDocument();
  });
});
