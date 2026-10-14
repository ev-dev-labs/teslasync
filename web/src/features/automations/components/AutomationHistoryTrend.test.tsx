import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AutomationHistoryListResponse, AutomationHistoryTrendPoint } from '@/api/types';
import type { ChartContainerProps } from '@/components/charts/ChartContainer';
import { formatDate } from '@/lib/dateFormat';
import { AutomationHistoryTrend } from './AutomationHistoryTrend';

const saved = vi.hoisted(() => ({
  locale: 'de-DE',
  settings: { tz_display_default: 'user', timezone_user: 'America/Los_Angeles' },
}));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => saved }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { timezone: 'Asia/Tokyo' } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

let chartProps: ChartContainerProps;
let axisFormat: (value: unknown) => string;
let tooltipFormat: (value: unknown) => string;
vi.mock('@/components/charts', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ChartContainer: (props: ChartContainerProps) => {
      chartProps = props;
      return <><p>{props.subtitle}</p>{typeof props.children === 'function' ? props.children({ annotations: [], hidden: false, hiddenSeries: null }) : props.children}</>;
    },
    ResponsiveContainer: passthrough,
    BarChart: passthrough,
    XAxis: ({ tickFormatter }: { tickFormatter: typeof axisFormat }) => {
      axisFormat = tickFormatter;
      return null;
    },
    Tooltip: ({ content }: { content: ReactNode }) => <>{content}</>,
    ChartTooltip: ({ labelFormatter }: { labelFormatter: typeof tooltipFormat }) => {
      tooltipFormat = labelFormatter;
      return null;
    },
    Bar: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    ChartLegend: () => null,
  };
});

function show(trend: AutomationHistoryTrendPoint[]) {
  const data: AutomationHistoryListResponse = {
    items: [], total: 0, limit: 50, offset: 0, trend,
    summary: { total_executions: 0, succeeded: 0, failed: 0, partial: 0, success_rate: 0, avg_duration_ms: 0 },
  };
  function Subject() {
    const query = useQuery({ queryKey: ['trend'], queryFn: async () => data, initialData: data, enabled: false });
    return <AutomationHistoryTrend query={query} />;
  }
  return render(<QueryClientProvider client={new QueryClient()}><Subject /></QueryClientProvider>);
}

describe('AutomationHistoryTrend UTC daily buckets', () => {
  beforeEach(() => {
    cleanup();
    saved.locale = 'de-DE';
    saved.settings.timezone_user = 'America/Los_Angeles';
  });

  it('discloses daily UTC resolution and localizes every label without shifting day boundaries', () => {
    show([
      { day: '2026-01-01', status: 'success', count: 2 },
      { day: '2025-12-31', status: 'failed', count: 3 },
      { day: '2026-01-01', status: 'partial', count: 4 },
    ]);
    expect(screen.getByText('Daily (UTC)')).toBeTruthy();
    expect(chartProps.data).toEqual([
      { period: '2025-12-31', success: 0, failed: 3, other: 0 },
      { period: '2026-01-01', success: 2, failed: 0, other: 4 },
    ]);
    for (const day of ['2025-12-31', '2026-01-01']) {
      const expected = formatDate(`${day}T00:00:00Z`, { locale: 'de-DE', tz: 'UTC' });
      expect(axisFormat(day)).toBe(expected);
      expect(tooltipFormat(day)).toBe(expected);
      expect(chartProps.dataColumns?.[0].format?.(day)).toBe(expected);
      expect(axisFormat(day)).not.toBe(formatDate(`${day}T00:00:00Z`, { locale: 'de-DE', tz: saved.settings.timezone_user }));
    }
  });

  it('honors another saved locale and eastern timezone while preserving UTC calendar dates', () => {
    saved.locale = 'ja-JP';
    saved.settings.timezone_user = 'Pacific/Kiritimati';
    show([{ day: '2026-03-08', status: 'success', count: 1 }]);
    expect(axisFormat('2026-03-08')).toBe(formatDate('2026-03-08T00:00:00Z', { locale: 'ja-JP', tz: 'UTC' }));
  });

  it.each([731, 3651])('never re-buckets %i status rows into months or years', (length) => {
    show(Array.from({ length }, (_, i) => ({
      day: i % 2 ? '2026-01-01' : '2026-01-02', status: 'success', count: 1,
    })));
    expect(chartProps.data).toHaveLength(2);
    expect(chartProps.data?.map(point => point.period)).toEqual(['2026-01-01', '2026-01-02']);
    expect(chartProps.data?.reduce((total, point) => total + Number(point.success), 0)).toBe(length);
  });

  it('retains malformed bucket counts and renders invalid or missing dates as unknown', () => {
    show([{ day: 'not-a-date', status: 'failed', count: 5 }]);
    expect(chartProps.data).toEqual([{ period: 'not-a-date', success: 0, failed: 5, other: 0 }]);
    for (const value of [null, undefined, '', 'not-a-date', '2026-02-30', '2026-13-01']) {
      expect(axisFormat(value)).toBe('—');
      expect(tooltipFormat(value)).toBe('—');
      expect(chartProps.dataColumns?.[0].format?.(value)).toBe('—');
    }
  });

  it('keeps the empty chart state when no buckets are returned', () => {
    show([]);
    expect(chartProps.empty).toBe(true);
    expect(chartProps.data).toEqual([]);
  });
});
