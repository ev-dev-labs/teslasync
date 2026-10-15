import type { ComponentProps, ReactNode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { chartTokens } from '@/lib/tokens';
import { EfficiencyTrend } from './EfficiencyTrend';
import { buildEfficiencyModel } from './model';
import { fakeDrive, fakeQuery, fakeUnits } from './fixtures';

const chart = vi.hoisted(() => ({
  frame: vi.fn(),
  areaChart: vi.fn(),
  xAxis: vi.fn(),
  yAxis: vi.fn(),
  area: vi.fn(),
  grid: vi.fn(),
  gradient: vi.fn(),
  annotations: vi.fn(),
}));

vi.mock('./EfficiencyChart', () => ({
  EfficiencyChart: (props: ComponentProps<typeof import('./EfficiencyChart').EfficiencyChart>) => {
    chart.frame(props);
    return <>{typeof props.children === 'function'
      ? props.children({ annotations: [], hidden: false, hiddenSeries: null }) : props.children}</>;
  },
}));
vi.mock('@/components/charts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  AreaChart: (props: { children: ReactNode }) => {
    chart.areaChart(props);
    return <>{props.children}</>;
  },
  XAxis: (props: unknown) => { chart.xAxis(props); return null; },
  YAxis: (props: unknown) => { chart.yAxis(props); return null; },
  Area: (props: unknown) => { chart.area(props); return null; },
  CartesianGrid: (props: unknown) => { chart.grid(props); return null; },
  Tooltip: () => null,
  ChartTooltip: () => null,
  AREA_DEFAULTS: { type: 'monotone', connectNulls: false, strokeWidth: 2 },
  areaGradient: (...args: unknown[]) => { chart.gradient(...args); return null; },
  renderAnnotationLines: (...args: unknown[]) => { chart.annotations(...args); return null; },
}));

function presentation(miles = false, count = 3) {
  const units = fakeUnits(miles);
  const drives = Array.from({ length: count }, (_, index) => fakeDrive({
    id: index + 1, startTs: `2026-10-0${index + 1}T12:00:00Z`,
    energyUsedWh: 7500 + index * 1000,
  }));
  return {
    units, model: buildEfficiencyModel(drives, units.unitPrefs),
    source: { state: deriveDataState(fakeQuery(drives)), loading: false, malformed: false },
    selectedVehicleId: 7,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.style.removeProperty('--font-sans');
  document.documentElement.style.removeProperty('--font-scale');
});

describe('EfficiencyTrend display-boundary typography', () => {
  it.each([false, true])('labels the per-drive subset and discloses real counts (miles=%s)', miles => {
    const units = fakeUnits(miles);
    const rows = Array.from({ length: 40 }, (_, id) => fakeDrive({
      id, startTs: new Date(Date.UTC(2026, 9, 4, 12, -id)).toISOString(),
      distanceM: 50000 + id * 1000,
      energyUsedWh: (50000 + id * 1000) * (0.15 + id * 0.001),
    }));
    rows.push(fakeDrive({ id: 40, energyUsedWh: 0 }));
    rows.push(fakeDrive({ id: 41, startTs: '2026-09-01T12:00:00Z' }));
    const model = buildEfficiencyModel(rows, units.unitPrefs, '2026-10-01T00:00:00Z');
    const source = { state: deriveDataState(fakeQuery(rows)), loading: false, malformed: false };
    render(<EfficiencyTrend model={model} units={units} source={source} selectedVehicleId={7} />);
    const unit = miles ? 'Wh/mi' : 'Wh/km';
    expect(chart.frame).toHaveBeenLastCalledWith(expect.objectContaining({
      title: `Per-drive efficiency (${unit})`,
      ariaLabel: 'Per-drive efficiency subset area chart',
      subtitle: 'Up to 30 eligible drive observations in reverse source order; not daily averages.',
      metadata: {
        sourceLabel: 'Showing 30 of 40 eligible drives from 41 range-filtered loaded drives.',
        unitLabel: unit,
      },
      data: model.dailyTrend, empty: false, source,
    }));
    expect(model.dailyTrend).toHaveLength(30);
    expect(chart.areaChart.mock.lastCall?.[0].data).toBe(model.dailyTrend);
    // Same-day drives stay distinct and keep the original first-30 reversal.
    expect(model.dailyTrend.map(row => row.distance)).toEqual(
      rows.slice(0, 30).reverse().map(row => model.toDistanceDisplay(row.distanceM)),
    );
    expect(model.dailyTrend[0].efficiency).toBe(Math.round(model.toEfficiencyDisplay(179)));
    expect(model.dailyTrend[29].efficiency).toBe(Math.round(model.toEfficiencyDisplay(150)));
  });

  it('reads the current font and scale for both axes on each render', () => {
    document.documentElement.style.setProperty('--font-sans', 'Georgia, serif');
    document.documentElement.style.setProperty('--font-scale', '1');
    const props = presentation();
    const view = render(<EfficiencyTrend {...props} />);
    const tick = { fill: chartTokens.axisStroke, fontFamily: 'Georgia, serif', fontSize: 12 };
    expect(chart.xAxis).toHaveBeenLastCalledWith(expect.objectContaining({ dataKey: 'date', tick }));
    expect(chart.yAxis).toHaveBeenLastCalledWith(expect.objectContaining({ tick }));

    document.documentElement.style.setProperty('--font-sans', 'Arial, sans-serif');
    document.documentElement.style.setProperty('--font-scale', '2');
    view.rerender(<EfficiencyTrend {...props} />);
    const scaledTick = { ...tick, fontFamily: 'Arial, sans-serif', fontSize: 24 };
    expect(chart.xAxis).toHaveBeenLastCalledWith(expect.objectContaining({ tick: scaledTick }));
    expect(chart.yAxis).toHaveBeenLastCalledWith(expect.objectContaining({ tick: scaledTick }));
    expect(chart.areaChart).toHaveBeenLastCalledWith(expect.objectContaining({ data: props.model.dailyTrend }));
  });

  it.each([false, true])('preserves populated data, units and annotation scope (miles=%s)', miles => {
    const props = presentation(miles);
    render(<EfficiencyTrend {...props} />);
    expect(props.model.dailyTrend).toHaveLength(3);
    expect(chart.frame).toHaveBeenCalledWith(expect.objectContaining({
      data: props.model.dailyTrend, empty: false,
      annotations: { vehicleId: 7, scope: 'efficiency', chartId: 'efficiency-daily-trend' },
      dataColumns: [
        expect.objectContaining({ key: 'date' }),
        expect.objectContaining({ key: 'efficiency', kind: 'measurement' }),
        expect.objectContaining({ key: 'distance', kind: 'measurement' }),
      ],
    }));
    expect(chart.areaChart.mock.lastCall?.[0].data).toBe(props.model.dailyTrend);
    expect(chart.area).toHaveBeenCalledWith(expect.objectContaining({
      dataKey: 'efficiency', name: miles ? 'Wh/mi' : 'Wh/km',
      type: 'monotone', connectNulls: false, strokeWidth: 2,
      stroke: chartTokens.series[0], fill: 'url(#effGrad)',
    }));
    expect(chart.grid).toHaveBeenCalledWith(expect.objectContaining({ stroke: chartTokens.gridStroke }));
    expect(chart.gradient).toHaveBeenCalledWith('effGrad', chartTokens.series[0], 0.08);
    expect(chart.annotations).toHaveBeenCalledWith([], expect.any(Function));
    expect(chart.annotations.mock.lastCall?.[1]('2026-10-01')).toBe('2026-10-01');
  });

  it.each([0, 2])('retains the insufficient-data threshold for %s observations', count => {
    render(<EfficiencyTrend {...presentation(false, count)} />);
    expect(chart.frame).toHaveBeenCalledWith(expect.objectContaining({
      empty: true,
      metadata: expect.objectContaining({
        sourceLabel: `Showing ${count} of ${count} eligible drives from ${count} range-filtered loaded drives.`,
      }),
    }));
  });
});
