import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChartDataColumn, ChartDataRow } from '@/components/charts';
import { analyzeSleepEfficiency } from '../../lib/sleepEfficiencyAnalysis';
import { SentryComparisonChart } from './SentryComparisonChart';
import type { SleepEfficiencyQueryState } from './types';

const captured = vi.hoisted(() => ({
  data: [] as ChartDataRow[],
  exportData: [] as ChartDataRow[],
  columns: [] as ChartDataColumn[],
  hidden: '',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: (value: unknown) => String(value),
    fmtNumber: (value: unknown) => String(value),
  }),
}));

vi.mock('@/components/charts', () => ({
  ChartContainer: ({ data, exportData, dataColumns, children }: {
    data: ChartDataRow[];
    exportData: ChartDataRow[];
    dataColumns: ChartDataColumn[];
    children: (context: {
      hiddenSeries: { isHidden: (key: string) => boolean };
    }) => ReactNode;
  }) => {
    captured.data = data;
    captured.exportData = exportData;
    captured.columns = dataColumns;
    return <>{children({ hiddenSeries: { isHidden: (key) => key === captured.hidden } })}</>;
  },
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bars">{children}</div>,
  YAxis: ({ yAxisId, unit, orientation = 'left' }: {
    yAxisId: string; unit: string; orientation?: string;
  }) => <div data-testid={`axis-${yAxisId}`} data-unit={unit} data-orientation={orientation} />,
  Bar: ({ dataKey, yAxisId, hide, name }: {
    dataKey: string; yAxisId: string; hide?: boolean; name: string;
  }) => <div data-testid={dataKey} data-axis={yAxisId} data-hidden={String(hide)}>{name}</div>,
  XAxis: () => null,
  Tooltip: () => null,
  ChartTooltip: () => null,
  ChartLegend: () => <div data-testid="legend" />,
  axisTick: {},
  chartGrid: null,
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, message }: { title?: string; message?: string }) => <div>{title}{message}</div>,
  Skeleton: () => <div data-testid="loading" />,
}));

const state: SleepEfficiencyQueryState = {
  vehicleSelected: true,
  isLoading: false,
  isResolved: true,
  error: null,
  refreshError: null,
  onRetry: vi.fn(),
};

function analysis(rate: number | null = 0.5, dose: number | null = 4) {
  return analyzeSleepEfficiency({
    sentry_comparison: [
      { sentry_mode: true, count: 3, avg_drain_rate: rate, avg_battery_lost: dose, avg_duration_hours: 8 },
      { sentry_mode: false, count: 7, avg_drain_rate: 0, avg_battery_lost: 0, avg_duration_hours: 12 },
    ],
  }, Date.parse('2026-10-14T12:00:00Z'), '2026-10-01', '2026-10-14');
}

afterEach(() => {
  cleanup();
  captured.hidden = '';
});

describe('SentryComparisonChart dimensions', () => {
  it('separates rate and dose onto independently unit-labeled axes', () => {
    render(<SentryComparisonChart analysis={analysis()} state={state} />);
    expect(screen.getByTestId('axis-rate')).toHaveAttribute('data-unit', '%/hr');
    expect(screen.getByTestId('axis-rate')).toHaveAttribute('data-orientation', 'left');
    expect(screen.getByTestId('axis-dose')).toHaveAttribute('data-unit', '%');
    expect(screen.getByTestId('axis-dose')).toHaveAttribute('data-orientation', 'right');
    expect(screen.getByTestId('drainRate')).toHaveAttribute('data-axis', 'rate');
    expect(screen.getByTestId('batteryLost')).toHaveAttribute('data-axis', 'dose');
    expect(screen.getByTestId('legend')).toBeInTheDocument();
  });

  it.each([
    [0.5, 4],
    [0, 0],
    [null, null],
  ])('preserves populated, zero and missing measurements (%s, %s) in data alternatives', (rate, dose) => {
    render(<SentryComparisonChart analysis={analysis(rate, dose)} state={state} />);
    expect(captured.data).toEqual([
      { mode: 'Sentry on', count: 3, drainRate: rate, batteryLost: dose, durationHours: 8 },
      { mode: 'Sentry off', count: 7, drainRate: 0, batteryLost: 0, durationHours: 12 },
    ]);
    expect(captured.exportData).toEqual(captured.data);
    expect(captured.columns.map(({ key }) => key)).toEqual([
      'mode', 'count', 'drainRate', 'batteryLost', 'durationHours',
    ]);
    expect(screen.getByTestId('bars')).toBeInTheDocument();
  });

  it('preserves independent series visibility without removing export fields', () => {
    captured.hidden = 'drainRate';
    render(<SentryComparisonChart analysis={analysis()} state={state} />);
    expect(screen.getByTestId('drainRate')).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByTestId('batteryLost')).toHaveAttribute('data-hidden', 'false');
    expect(captured.exportData[0].drainRate).toBe(0.5);
  });

  it('preserves unavailable comparison behavior', () => {
    const unavailable = analyzeSleepEfficiency(
      { sentry_comparison: [] },
      Date.parse('2026-10-14T12:00:00Z'),
      '2026-10-01',
      '2026-10-14',
    );
    render(<SentryComparisonChart analysis={unavailable} state={state} />);
    expect(screen.getByText(/Sentry comparison unavailable/)).toBeInTheDocument();
    expect(screen.queryByTestId('bars')).not.toBeInTheDocument();
    expect(captured.data).toEqual([]);
    expect(captured.exportData).toEqual([]);
  });
});
