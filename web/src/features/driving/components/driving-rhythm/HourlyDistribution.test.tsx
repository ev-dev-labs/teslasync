import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { convertDistanceFromSI } from '@/lib/unitConversion';
import { buildDrivingRhythm } from '../../lib/drivingRhythm';
import { HourlyDistribution } from './HourlyDistribution';

type ContainerProps = ComponentProps<
  typeof import('@/components/charts').ChartContainer
>;
type PlotProps = ComponentProps<
  typeof import('./HourlyDistributionPlot').HourlyDistributionPlot
>;

const captured = vi.hoisted(() => ({
  container: null as ContainerProps | null,
  plot: null as PlotProps | null,
  distance: 'km' as 'km' | 'mi' | 'ft',
  precision: 3,
}));

vi.mock('@/components/charts', () => ({
  ChartContainer: (props: ContainerProps) => {
    captured.container = props;
    return typeof props.children === 'function'
      ? props.children({ annotations: [], hidden: false, hiddenSeries: null })
      : props.children;
  },
}));

vi.mock('./HourlyDistributionPlot', () => ({
  HourlyDistributionPlot: (props: PlotProps) => {
    captured.plot = props;
    return null;
  },
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: () => null,
  QueryError: () => null,
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: captured.distance } }),
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: (value: unknown) => Number(value).toFixed(0),
    fmtNumber: (value: unknown) => Number(value).toFixed(captured.precision),
  }),
}));

afterEach(cleanup);

function renderHour(distance: unknown, measuredDistanceDrives = 1) {
  const summary = buildDrivingRhythm([], { timeZone: 'UTC' });
  summary.total = 3;
  const hour = {
    hour: 7,
    drives: 1,
    share: 1 / 3,
    distanceM: 0,
    measuredDistanceDrives,
  };
  // Exercise malformed runtime payloads without weakening production types.
  Reflect.set(hour, 'distanceM', distance);
  summary.hourly = [hour];
  render(
    <HourlyDistribution
      summary={summary}
      state={{
        isLoading: false,
        retained: false,
        error: null,
        onRetry: vi.fn(),
      }}
    />,
  );
  return captured.plot!.rows[0];
}

describe('HourlyDistribution numeric adapters', () => {
  it.each(['km', 'mi', 'ft'] as const)(
    'preserves fractional and signed values in %s across chart, table and export',
    (unit) => {
      captured.distance = unit;
      const row = renderHour(-1234.56789);
      expect(row.distance).toBe(convertDistanceFromSI(-1234.56789, unit));
      expect(row.share).toBe((1 / 3) * 100);
      expect(captured.container!.data).toBe(captured.plot!.rows);
      expect(captured.container!.exportData).toBe(captured.plot!.rows);
      const column = captured.container!.dataColumns!.find(
        (entry) => entry.key === 'distance',
      )!;
      expect(column.label).toBe(`Logged distance (${unit})`);
      expect(column.format!(row.distance)).toBe(
        `${row.distance!.toFixed(3)} ${unit}`,
      );
    },
  );

  it.each([null, undefined, NaN, Infinity, -Infinity, '1234'])(
    'preserves a null gap for invalid distance %s',
    (distance) => {
      expect(renderHour(distance).distance).toBeNull();
    },
  );

  it('distinguishes an unmeasured distance from measured zero', () => {
    expect(renderHour(0, 0).distance).toBeNull();
    cleanup();
    expect(renderHour(0).distance).toBe(0);
  });

  it('keeps positive fractions even below display precision', () => {
    captured.distance = 'km';
    captured.precision = 1;
    const row = renderHour(0.12345);
    expect(row.distance).toBe(0.00012345);
    expect(captured.container!.exportData).toBe(captured.plot!.rows);
  });
});
