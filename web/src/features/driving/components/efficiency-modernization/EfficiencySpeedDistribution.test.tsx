import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { convertSpeedFromSI } from '@/lib/unitConversion';
import { EfficiencySpeedDistribution } from './EfficiencySpeedDistribution';
import { buildEfficiencyModel, efficiencyColor } from './model';
import { fakeDrive, fakeQuery, fakeUnits } from './fixtures';
import type { DrivesPresentation } from './types';

const captured = vi.hoisted(() => ({
  data: [] as unknown[],
  columns: [] as { key: string }[],
  empty: false,
  plotted: [] as unknown[],
}));

vi.mock('./EfficiencyChart', () => ({
  EfficiencyChart: ({ children, data, dataColumns, empty }: {
    children: ReactNode;
    data: unknown[];
    dataColumns: { key: string }[];
    empty: boolean;
  }) => {
    captured.data = data;
    captured.columns = dataColumns;
    captured.empty = empty;
    return <>{children}</>;
  },
}));

vi.mock('@/components/charts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Nothing = () => null;
  return {
    ResponsiveContainer: Container,
    BarChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => {
      captured.plotted = data;
      return <>{children}</>;
    },
    Bar: Container,
    Cell: ({ fill }: { fill: string }) => <span data-testid="speed-cell" data-fill={fill} />,
    CartesianGrid: Nothing, XAxis: Nothing, YAxis: Nothing,
    Tooltip: Nothing, ChartTooltip: Nothing,
  };
});

function presentation(miles: boolean, efficiencies: number[], speeds?: number[]): DrivesPresentation {
  const units = fakeUnits(miles);
  const rows = efficiencies.map((efficiency, index) => fakeDrive({
    id: index,
    distanceM: 1000,
    energyUsedWh: efficiency,
    avgSpeedMps: speeds?.[index] ?? 5,
  }));
  return {
    units, model: buildEfficiencyModel(rows, units.unitPrefs),
    source: { state: deriveDataState(fakeQuery(rows)), loading: false, malformed: false },
  };
}

describe('EfficiencySpeedDistribution raw-mean classification', () => {
  it.each([false, true])('classifies an unrounded mean before display conversion (miles=%s)', miles => {
    const props = presentation(miles, [139.6, 140]);
    const bucket = props.model.speedDist[0];
    expect(bucket.avgEffWhKm).toBeCloseTo(139.8);
    expect(bucket.avgEff).toBe(Math.round(props.model.toEfficiencyDisplay(139.8)));
    render(<EfficiencySpeedDistribution {...props} />);
    expect(screen.getByTestId('speed-cell')).toHaveAttribute('data-fill', efficiencyColor(139.8));
    expect(efficiencyColor(bucket.avgEff)).not.toBe(efficiencyColor(139.8));
    const expected = [{ range: `0–30 ${props.units.unitPrefs.speed}`, avgEff: bucket.avgEff, count: 2 }];
    expect(captured.data).toEqual(expected);
    expect(captured.plotted).toEqual(expected);
    expect(captured.columns.map(column => column.key)).toEqual(['range', 'avgEff', 'count']);
    expect(captured.empty).toBe(false);
  });

  it.each([140, 170, 200, 240])('preserves the exact raw boundary at %s Wh/km', boundary => {
    const props = presentation(false, [boundary - 0.2, boundary], [0, 10]);
    render(<EfficiencySpeedDistribution {...props} />);
    expect(screen.getAllByTestId('speed-cell').map(cell => cell.getAttribute('data-fill')))
      .toEqual([efficiencyColor(boundary - 0.2), efficiencyColor(boundary)]);
    expect(efficiencyColor(boundary - 0.2)).not.toBe(efficiencyColor(boundary));
  });

  it.each([false, true])('preserves populated speed buckets and display/export values (miles=%s)', miles => {
    const unit = fakeUnits(miles).unitPrefs.speed;
    const mpsPerDisplayUnit = 1 / convertSpeedFromSI(1, unit);
    const props = presentation(miles, [100, 150, 180, 220, 250],
      [0, 31, 61, 91, 121].map(speed => speed * mpsPerDisplayUnit));
    render(<EfficiencySpeedDistribution {...props} />);
    expect(captured.data).toEqual(['0–30', '30–60', '60–90', '90–120', '120+']
      .map((range, index) => ({
        range: `${range} ${unit}`,
        avgEff: Math.round(props.model.toEfficiencyDisplay([100, 150, 180, 220, 250][index])),
        count: 1,
      })));
    expect(screen.getAllByTestId('speed-cell').map(cell => cell.getAttribute('data-fill')))
      .toEqual([100, 150, 180, 220, 250].map(efficiencyColor));
  });

  it('retains half-open speed boundaries and excludes ineligible measurements', () => {
    const props = presentation(false, [150, 150, 150, 150, 150, 150, 150, 0],
      [0, 30, 60, 90, 120, 999, -1, 10].map(speed => speed / 3.6));
    expect(props.model.speedDist.map(bucket => bucket.count)).toEqual([1, 1, 1, 1, 1]);
    render(<EfficiencySpeedDistribution {...props} />);
    expect(captured.data).toHaveLength(5);
  });

  it('preserves the empty chart for missing eligible measurements', () => {
    render(<EfficiencySpeedDistribution {...presentation(false, [0])} />);
    expect(captured.data).toEqual([]);
    expect(captured.plotted).toEqual([]);
    expect(captured.empty).toBe(true);
    expect(screen.queryByTestId('speed-cell')).not.toBeInTheDocument();
  });
});
