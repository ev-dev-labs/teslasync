import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetUtilizationForecast } from '@/api/hooks/useFleetOps';
import { chartTokens } from '@/lib/tokens';
import { UtilizationForecastChart } from './UtilizationForecastChart';

const capture = vi.hoisted(() => ({
  area: vi.fn(),
  line: vi.fn(),
  axis: vi.fn(),
  chart: vi.fn(),
  card: vi.fn(),
}));

vi.mock('@/components/charts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  ComposedChart: (props: { children: ReactNode }) => {
    capture.chart(props);
    return <>{props.children}</>;
  },
  Area: (props: unknown) => { capture.area(props); return null; },
  Line: (props: unknown) => { capture.line(props); return null; },
  YAxis: (props: unknown) => { capture.axis(props); return null; },
  XAxis: () => null,
  Tooltip: () => null,
  axisTick: {},
  chartGrid: null,
}));

vi.mock('@/components/layout', () => ({
  ChartCard: (props: { children: ReactNode }) => {
    capture.card(props);
    return <>{props.children}</>;
  },
  LayoutCard: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const forecast: FleetUtilizationForecast = {
  from: '2026-10-01T00:00:00Z',
  to: '2026-10-02T00:00:00Z',
  generated_at: '2026-10-01T00:00:00Z',
  quality: 'good',
  history_drive_count: 35,
  history_day_count: 20,
  limitations: [],
  points: [{
    vehicle_id: 7,
    vehicle_display_name: 'Test pool vehicle',
    forecast_date: '2026-10-01T00:00:00Z',
    available_s: 86400,
    reserved_s: 7200,
    maintenance_downtime_s: 0,
    historical_expected_s: 3600,
    expected_utilization_pct: 25,
    lower_utilization_pct: 10,
    upper_utilization_pct: 40,
  }],
};

beforeEach(() => vi.clearAllMocks());

describe('utilization forecast presentation', () => {
  it('uses restrained chart roles while preserving the offset band, expected line and bounds', () => {
    render(<UtilizationForecastChart forecast={forecast} loading={false} error={null} onRetry={vi.fn()} />);

    expect(capture.area.mock.calls.map(([props]) => props)).toEqual([
      expect.objectContaining({ dataKey: 'lower', stackId: 'band', stroke: 'none', fill: 'transparent' }),
      expect.objectContaining({
        dataKey: 'uncertainty',
        stackId: 'band',
        stroke: 'none',
        fill: chartTokens.series[1],
        fillOpacity: 0.08,
      }),
    ]);
    expect(capture.line.mock.calls[0]?.[0]).toMatchObject({
      dataKey: 'expected', stroke: chartTokens.series[0], strokeWidth: 2, dot: false,
    });
    expect(capture.axis.mock.calls[0]?.[0]).toMatchObject({ domain: [0, 100], unit: '%' });
    const data = [{ date: '2026-10-01', expected: 25, lower: 10, uncertainty: 30, upper: 40 }];
    expect(capture.chart.mock.calls[0]?.[0]).toMatchObject({ data });
    expect(capture.card.mock.calls[0]?.[0]).toMatchObject({
      data,
      exportable: true,
      chartKey: 'fleet-ops-utilization',
      empty: false,
      dataColumns: [
        { key: 'date', label: 'Date' },
        { key: 'expected', label: 'Expected utilization' },
        { key: 'lower', label: 'Lower bound' },
        { key: 'upper', label: 'Upper bound' },
      ],
    });
  });
});
