import type { ReactNode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON } from '@/lib/colors';
import { analyzeShareCard } from '../../lib/shareCard';
import { ShareCardMonthlyTrend } from './ShareCardMonthlyTrend';
import type { ShareCardSectionProps } from './types';

const captured = vi.hoisted(() => ({
  palette: [] as readonly string[],
  card: {} as Record<string, unknown>,
  chart: {} as Record<string, unknown>,
  series: [] as Record<string, unknown>[],
  hidden: ['energy'],
}));

vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => captured.palette,
}));

vi.mock('@/components/layout', () => ({
  ChartCard: (props: Record<string, unknown> & {
    children: (context: { hiddenSeries: { isHidden: (id: string) => boolean } }) => ReactNode;
  }) => {
    captured.card = props;
    return props.children({
      hiddenSeries: { isHidden: (id) => captured.hidden.includes(id) },
    });
  },
}));

vi.mock('@/components/charts', () => {
  const childrenOnly = ({ children }: { children?: ReactNode }) => children;
  const series = (props: Record<string, unknown>) => {
    captured.series.push(props);
    return null;
  };
  return {
    Bar: series,
    Line: series,
    ComposedChart: (props: Record<string, unknown> & { children?: ReactNode }) => {
      captured.chart = props;
      return props.children;
    },
    ResponsiveContainer: childrenOnly,
    ChartLegend: () => null,
    ChartTooltip: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
    axisTick: {},
    chartGrid: null,
  };
});

vi.mock('./ShareCardSectionBody', () => ({
  ShareCardSectionBody: ({ children }: { children: ReactNode }) => children,
}));

function props(): ShareCardSectionProps {
  const analysis = analyzeShareCard([], {
    startLabel: '2026-01-01',
    endLabel: '2026-03-31',
    startInstant: '2026-01-01T00:00:00Z',
    endInstantExclusive: '2026-04-01T00:00:00Z',
    timezone: 'UTC',
  });
  return {
    analysis: {
      ...analysis,
      eligibleRows: 3,
      monthly: [
        { month: '2026-01', driveCount: 2, distanceM: 12000, distanceSupportRows: 2, energyWh: 2400, energySupportRows: 2 },
        { month: '2026-02', driveCount: 0, distanceM: null, distanceSupportRows: 0, energyWh: null, energySupportRows: 0 },
        { month: '2026-03', driveCount: 1, distanceM: 0, distanceSupportRows: 1, energyWh: 0, energySupportRows: 1 },
      ],
    },
    state: {
      enabled: true, hasData: true, isInitialLoading: false, isInitialPaused: false,
      initialError: null, isResolved: true, isRefreshing: false,
      cachedRefreshError: null, cachedRefreshPaused: false, onRetry: vi.fn(),
    },
    display: {
      distanceUnit: 'km', durationUnit: 's', energyUnit: 'kWh',
      formatNumber: (value) => String(value),
      formatDistance: (value) => `${value} m`,
      formatDuration: (value) => `${value} s`,
      formatEnergy: (value) => `${value} Wh`,
      formatSpeed: (value) => `${value} m/s`,
      formatTemperature: (value) => `${value} C`,
      formatEfficiency: (value) => String(value),
      formatPercent: (value) => String(value),
      formatMonth: (month) => month,
      distanceValue: (meters) => meters / 1000,
      durationValue: (seconds) => seconds,
      energyValue: (wattHours) => wattHours / 1000,
    },
  };
}

afterEach(cleanup);

describe('ShareCardMonthlyTrend palette adoption', () => {
  it('reacts to palette preferences without changing series IDs, order, axes or visibility', () => {
    captured.palette = CHART_COLORS_CB_SAFE;
    captured.series = [];
    const input = props();
    const { rerender } = render(<ShareCardMonthlyTrend {...input} />);
    const originalRows = captured.chart.data;
    const originalExports = captured.card.exportData;

    const checkSeries = (palette: readonly string[]) => {
      expect(captured.series.map(({ dataKey, yAxisId, name, hide, fill, stroke }) => ({
        dataKey, yAxisId, name, hide, color: fill ?? stroke,
      }))).toEqual([
        { dataKey: 'distance', yAxisId: 'distance', name: 'Distance', hide: false, color: palette[0] },
        { dataKey: 'energy', yAxisId: 'energy', name: 'Energy', hide: true, color: palette[1] },
        { dataKey: 'driveCount', yAxisId: 'count', name: 'Drive count', hide: false, color: palette[2] },
      ]);
      expect(captured.series[1].connectNulls).toBe(false);
    };
    checkSeries(CHART_COLORS_CB_SAFE);
    captured.palette = CHART_COLORS_NEON;
    captured.series = [];
    rerender(<ShareCardMonthlyTrend {...input} />);
    checkSeries(CHART_COLORS_NEON);
    expect(captured.chart.data).toBe(originalRows);
    expect(captured.card.exportData).toBe(originalExports);
    expect(captured.card.chartKey).toBe('share-card-monthly');
  });

  it('preserves populated display values, unknown gaps, measured zeros and canonical SI exports', () => {
    captured.palette = CHART_COLORS_CB_SAFE;
    captured.series = [];
    render(<ShareCardMonthlyTrend {...props()} />);
    expect(captured.chart.data).toEqual([
      { month: '2026-01', label: '2026-01', driveCount: 2, distance: 12, distanceM: 12000, energy: 2.4, energyWh: 2400 },
      { month: '2026-02', label: '2026-02', driveCount: 0, distance: null, distanceM: null, energy: null, energyWh: null },
      { month: '2026-03', label: '2026-03', driveCount: 1, distance: 0, distanceM: 0, energy: 0, energyWh: 0 },
    ]);
    expect(captured.card.data).toEqual(captured.chart.data);
    expect(captured.card.exportable).toBe(true);
    expect(captured.card.exportFilename).toBe('share-card-monthly-evidence');
    expect(captured.card.exportData).toEqual([
      { month: '2026-01', drive_count: 2, distance_m: 12000, energy_wh: 2400 },
      { month: '2026-02', drive_count: 0, distance_m: null, energy_wh: null },
      { month: '2026-03', drive_count: 1, distance_m: 0, energy_wh: 0 },
    ]);
  });
});
