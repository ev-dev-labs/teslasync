import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartContainerProps } from '@/components/charts';
import { analyzeTrueCost } from '../../lib/trueCost';
import type { TrueCostSectionProps } from './types';

const boundary = vi.hoisted(() => ({
  containers: vi.fn<(props: ChartContainerProps) => void>(),
  axes: vi.fn<(props: Record<string, unknown>) => void>(),
  isHidden: vi.fn<(key: string) => boolean>(() => false),
}));

vi.mock('@/hooks/useChartPalette', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useChartPalette')>(),
  useChartPalette: vi.fn(),
}));
vi.mock('react-i18next', async () => {
  const { createInstance } = await import('i18next');
  const translations = createInstance();
  await translations.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });
  return { useTranslation: () => ({ t: translations.getFixedT('en') }) };
});
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ message }: { message: string }) => <p>{message}</p>,
}));
vi.mock('./TrueCostSectionBody', () => ({
  TrueCostSectionBody: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/charts', () => {
  const wrap = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const series = (props: Record<string, unknown>) =>
    <output data-testid={`series-${props.dataKey}`}>{JSON.stringify(props)}</output>;
  return {
    ChartContainer: (props: ChartContainerProps) => {
      boundary.containers(props);
      return <div>{typeof props.children === 'function' ? props.children({
        annotations: [], hidden: false,
        hiddenSeries: {
          hidden: new Set<string>(), isHidden: boundary.isHidden,
          toggle: vi.fn(), reset: vi.fn(),
        },
      }) : props.children}</div>;
    },
    Area: series, Bar: series, Line: series,
    AreaChart: wrap, BarChart: wrap, ComposedChart: wrap, ResponsiveContainer: wrap,
    YAxis: (props: Record<string, unknown>) => { boundary.axes(props); return null; },
    ReferenceLine: (props: Record<string, unknown>) =>
      <output data-testid="zero-line">{JSON.stringify(props)}</output>,
    CartesianGrid: () => null, XAxis: () => null, Tooltip: () => null,
    ChartTooltip: () => null, ChartLegend: () => null, axisTick: {}, chartGrid: null,
  };
});

import { resolveChartPalette, useChartPalette } from '@/hooks/useChartPalette';
import { chartTokens } from '@/lib/tokens';
import { TrueCostCumulativeChart } from './TrueCostCumulativeChart';
import { TrueCostMonthlyCostChart } from './TrueCostMonthlyCostChart';
import { TrueCostEnergyCostTrend } from './TrueCostEnergyCostTrend';
import { TrueCostMonthlyDeltaChart } from './TrueCostMonthlyDeltaChart';
import { TrueCostPerDistanceChart } from './TrueCostPerDistanceChart';

const props: TrueCostSectionProps = {
  analysis: analyzeTrueCost({
    total_charging_cost: 100, equivalent_gas_cost: 300, total_km: 1000,
    total_sessions: 8, total_savings: 200,
    cost_per_km_ev: 0.1, cost_per_km_ice: 0.3,
    monthly_breakdown: [
      { month: '2025-01', ev_cost: 40, equiv_gas_cost: 120, energy_wh: 40_000, savings: 80, cumulative_savings: 80 },
      { month: '2025-03', ev_cost: 60, equiv_gas_cost: 30, energy_wh: 60_000, savings: -30, cumulative_savings: 50 },
    ],
  }),
  state: {
    enabled: true, hasData: true, isResolved: true, isLoading: false,
    isFetching: false, isPaused: false, refreshPaused: false,
    error: null, refreshError: null, onRetry: vi.fn(),
  },
  display: {
    distanceUnit: 'mi', energyUnit: 'kWh',
    formatNumber: value => String(value),
    formatCurrency: value => `$${value}`,
    formatSignedCurrency: value => `$${value}`,
    formatDistanceKm: value => `${value} km`,
    distanceValueKm: value => value / 1.609344,
    costPerDistanceValue: value => value * 1.609344,
    formatCostPerDistance: value => String(value),
    formatEnergy: value => `${Number(value) / 1000} kWh`,
    energyValue: value => value / 1000,
    formatMonth: value => value,
  },
  gasUnit: 'gallon',
};

function charts() {
  return <>
    <TrueCostCumulativeChart {...props} />
    <TrueCostMonthlyCostChart {...props} />
    <TrueCostEnergyCostTrend {...props} />
    <TrueCostMonthlyDeltaChart {...props} />
    <TrueCostPerDistanceChart {...props} />
  </>;
}

function readSeries(key: string, index = 0): Record<string, unknown> {
  return JSON.parse(screen.getAllByTestId(`series-${key}`)[index].textContent ?? '{}');
}

beforeEach(() => {
  boundary.containers.mockClear();
  boundary.axes.mockClear();
  boundary.isHidden.mockReset().mockImplementation(key => key === 'evCost');
  vi.mocked(useChartPalette).mockReturnValue(resolveChartPalette('cb_safe'));
});
afterEach(cleanup);

describe('true-cost saved chart palette', () => {
  it.each(['cb_safe', 'neon'])('uses %s at all five charts without changing series identities', preference => {
    const palette = resolveChartPalette(preference);
    vi.mocked(useChartPalette).mockReturnValue(palette);
    render(charts());
    expect(readSeries('derivedCumulativeDelta')).toMatchObject({
      stroke: palette[4], fill: palette[4], fillOpacity: 0.08, strokeWidth: 2,
      name: 'Derived cumulative fuel delta', type: 'monotone',
    });
    expect(readSeries('evCost', 0)).toMatchObject({ fill: palette[0], hide: true, name: 'Recorded EV cost' });
    expect(readSeries('gasCost')).toMatchObject({ fill: palette[5], hide: false, name: 'Modeled gas equivalent' });
    expect(readSeries('evCost', 1)).toMatchObject({ fill: palette[0], hide: true, yAxisId: 'cost' });
    expect(readSeries('energy')).toMatchObject({
      stroke: palette[2], hide: false, yAxisId: 'energy', strokeWidth: 2, dot: { r: 3 },
    });
    expect(readSeries('derivedFuelDelta')).toMatchObject({ fill: palette[3] });
    const distance = boundary.containers.mock.calls[4][0];
    expect(distance.data).toEqual([
      { category: 'Recorded EV', cost: 0.1 * 1.609344, fill: palette[0] },
      { category: 'Modeled gas', cost: 0.3 * 1.609344, fill: palette[5] },
    ]);
    expect(JSON.parse(screen.getByTestId('zero-line').textContent ?? '{}'))
      .toEqual({ y: 0, stroke: chartTokens.axisStroke });
  });

  it('reacts to palette changes while preserving populated data, scales, exports and saved legend keys', () => {
    const view = render(charts());
    const before = boundary.containers.mock.calls.map(([container]) => container);
    const axesBefore = boundary.axes.mock.calls.map(([axis]) => axis);
    vi.mocked(useChartPalette).mockReturnValue(resolveChartPalette('neon'));
    view.rerender(charts());
    const after = boundary.containers.mock.calls.slice(5).map(([container]) => container);
    expect(after).toHaveLength(5);
    after.forEach((container, index) => {
      expect(container.exportable).toBe(true);
      expect(container.exportData).toEqual(before[index].exportData);
      expect(container.exportFilename).toBe(before[index].exportFilename);
      expect(container.chartKey).toBe(before[index].chartKey);
      expect(container.dataColumns?.map(({ key, label, format }) => ({
        key, label, formatted: format?.(12.5),
      }))).toEqual(before[index].dataColumns?.map(({ key, label, format }) => ({
        key, label, formatted: format?.(12.5),
      })));
      if (index !== 4) expect(container.data).toEqual(before[index].data);
    });
    expect(after.map(container => container.chartKey)).toEqual([
      undefined, 'true-cost-monthly-cost', 'true-cost-energy-cost', undefined, undefined,
    ]);
    expect(after.map(container => container.exportData)).toEqual([
      [
        { month: '2025-01', derived_fuel_delta: 80, derived_cumulative_delta: 80, api_savings: 80, api_cumulative_savings: 80 },
        { month: '2025-03', derived_fuel_delta: -30, derived_cumulative_delta: 50, api_savings: -30, api_cumulative_savings: 50 },
      ],
      [{ month: '2025-01', ev_cost: 40, equiv_gas_cost: 120 }, { month: '2025-03', ev_cost: 60, equiv_gas_cost: 30 }],
      [{ month: '2025-01', ev_cost: 40, energy_wh: 40_000 }, { month: '2025-03', ev_cost: 60, energy_wh: 60_000 }],
      [{ month: '2025-01', derived_fuel_delta: 80, api_savings: 80 }, { month: '2025-03', derived_fuel_delta: -30, api_savings: -30 }],
      [{ category: 'ev', cost_per_km: 0.1 }, { category: 'modeled_gas', cost_per_km: 0.3 }],
    ]);
    expect(after[2].data).toEqual([
      { month: '2025-01', monthLabel: '2025-01', evCost: 40, energy: 40, energyWh: 40_000 },
      { month: '2025-03', monthLabel: '2025-03', evCost: 60, energy: 60, energyWh: 60_000 },
    ]);
    const axisContract = ({ tickFormatter, ...axis }: Record<string, unknown>) => ({
      ...axis,
      formatted: typeof tickFormatter === 'function' ? tickFormatter(12.5) : undefined,
    });
    expect(boundary.axes.mock.calls.slice(6).map(([axis]) => axisContract(axis)))
      .toEqual(axesBefore.map(axisContract));
    expect(readSeries('evCost', 0).hide).toBe(true);
    expect(readSeries('evCost', 1).hide).toBe(true);
    expect(readSeries('gasCost').hide).toBe(false);
    expect(readSeries('energy').hide).toBe(false);
    expect(readSeries('derivedCumulativeDelta').fill).toBe(resolveChartPalette('neon')[4]);
  });
});
