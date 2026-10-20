import { render } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FsdShareTrend } from './FsdShareTrend';
import { fsdDay, fsdDrivingOnlyInsights, fsdInsights } from './__tests__/fixtures';

const { frame, chart, area, yAxis } = vi.hoisted(() => ({
  frame: vi.fn(),
  chart: vi.fn(),
  area: vi.fn(),
  yAxis: vi.fn(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { locale: 'en-US' } }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => String(value) }),
}));
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    ChartContainer: (props: ComponentProps<typeof actual.ChartContainer>) => {
      frame(props);
      return <>{typeof props.children === 'function' ? null : props.children}</>;
    },
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
    AreaChart: (props: ComponentProps<typeof actual.AreaChart>) => {
      chart(props);
      return <>{props.children}</>;
    },
    Area: (props: ComponentProps<typeof actual.Area>) => {
      area(props);
      return null;
    },
    YAxis: (props: ComponentProps<typeof actual.YAxis>) => {
      yAxis(props);
      return null;
    },
    XAxis: () => null,
    Tooltip: () => null,
    chartGrid: null,
  };
});

const state = { isLoading: false, error: null, onRetry: vi.fn(), noVehicle: false };

beforeEach(() => vi.clearAllMocks());

describe('FsdShareTrend restrained fill', () => {
  it('renders the shared gradient with every stop at most 8% opacity', () => {
    const { container } = render(<FsdShareTrend insights={fsdInsights()} state={state} />);
    const stops = container.querySelectorAll('#fsdShareFill stop');
    expect(stops).toHaveLength(2);
    for (const stop of stops) {
      const opacity = Number(stop.getAttribute('stop-opacity'));
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThanOrEqual(0.08);
    }
    expect(area.mock.lastCall?.[0]).toMatchObject({
      dataKey: 'share',
      fill: 'url(#fsdShareFill)',
      connectNulls: false,
      type: 'monotone',
      strokeWidth: 2.5,
    });
    expect(stops[0].getAttribute('stop-color')).toBe(area.mock.lastCall?.[0].stroke);
    expect(yAxis.mock.lastCall?.[0]).toMatchObject({ domain: [0, 100], width: 44 });
  });

  it('preserves populated percentages, interior null gaps, zeroes and export rows', () => {
    const insights = fsdInsights({
      daily: [
        fsdDay({ date: '2026-03-01', fsd_share_pct: 25 }),
        fsdDay({ date: '2026-03-02' }),
        fsdDay({ date: '2026-03-03', fsd_share_pct: 0 }),
        fsdDay({ date: '2026-03-04', fsd_share_pct: 100 }),
      ],
    });
    render(<FsdShareTrend insights={insights} state={state} />);
    const rows = chart.mock.lastCall?.[0].data;
    expect(rows).toEqual(insights.daily.map((day) => ({
      date: day.date,
      label: expect.any(String),
      share: day.fsd_share_pct,
    })));
    expect(frame.mock.lastCall?.[0]).toMatchObject({
      data: rows,
      exportData: rows,
      exportFilename: 'fsd-usage-share',
      exportable: true,
      empty: false,
    });
    expect(area.mock.lastCall?.[0].connectNulls).toBe(false);
    const columns = frame.mock.lastCall?.[0].dataColumns;
    expect(columns[1].format(0)).toBe('0%');
    expect(columns[1].format(25)).toBe('25%');
    expect(columns[1].format(null)).toBe('—');
  });

  it('does not enable exports or invent shares when only driving counters reported', () => {
    render(<FsdShareTrend insights={fsdDrivingOnlyInsights()} state={state} />);
    expect(frame.mock.lastCall?.[0]).toMatchObject({ empty: true, exportable: false });
    expect(chart.mock.lastCall?.[0].data.map((row: { share: number | null }) => row.share))
      .toEqual([null, null, null]);
  });
});
