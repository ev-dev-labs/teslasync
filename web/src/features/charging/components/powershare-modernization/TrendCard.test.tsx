import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartCardProps } from '@/components/layout/layout-reference/ChartCard';
import type { TrendPoint } from '../powershare';
import { formatTime } from '@/lib/dateFormat';
import { TrendCard } from './TrendCard';

const captured = vi.hoisted(() => ({
  card: vi.fn(),
  chart: vi.fn(),
  preferences: { locale: 'de-DE', tz: 'Asia/Tokyo' },
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { tz_display_default: 'user' },
    locale: captured.preferences.locale,
  }),
}));
vi.mock('@/lib/timezone', () => ({
  useTimezone: () => captured.preferences.tz,
}));
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => ['var(--chart-1)', 'var(--chart-2)'],
}));
vi.mock('@/components/layout', () => ({
  ChartCard: (props: ChartCardProps) => {
    captured.card(props);
    return <>{props.children}</>;
  },
}));
vi.mock('@/components/charts', () => {
  const Chart = (props: { data: TrendPoint[]; children?: ReactNode }) => {
    captured.chart(props);
    return <>{props.children}</>;
  };
  const Inert = () => null;
  return {
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    AreaChart: Chart,
    LineChart: Chart,
    Area: Inert,
    Line: Inert,
    XAxis: Inert,
    YAxis: Inert,
    Tooltip: Inert,
    ChartTooltip: Inert,
    ChartGradient: Inert,
    chartGrid: null,
    axisTickSm: {},
    AREA_DEFAULTS: {},
  };
});

function lastRealCall(mock: { calls: unknown[][] }): unknown {
  // React dev re-invokes mocked function components with `undefined` props to
  // sample a component-stack frame when logging a DOM-nesting warning (the
  // power branch renders `<defs>` without its real SVG ancestor once the chart
  // is mocked). Those sampler calls carry no props, so select the last call
  // that actually received props.
  const real = mock.calls.filter(args => args[0] !== undefined);
  return real[real.length - 1]![0];
}

function cardProps(): ChartCardProps {
  return lastRealCall(captured.card.mock) as ChartCardProps;
}

function chartPoints(): TrendPoint[] {
  return (lastRealCall(captured.chart.mock) as { data: TrendPoint[] }).data;
}

const base = { isLoading: false, error: null, onRetry: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  captured.preferences.locale = 'de-DE';
  captured.preferences.tz = 'Asia/Tokyo';
});

describe('TrendCard timestamp evidence', () => {
  it.each(['power', 'hours'] as const)(
    'preserves full timestamps, offsets, precision and numeric %s values across days',
    kind => {
      const points: TrendPoint[] = [
        { ts: '2026-10-13T23:59:59.123456-07:00', label: '23:59', value: 0 },
        { ts: '2026-10-14T00:00:00.987654-07:00', label: '00:00', value: 1.2345 },
        { ts: '2026-10-14T23:59:59.123456-07:00', label: '23:59', value: 8.75 },
      ];
      const original = points.map(point => ({ ...point }));
      render(<TrendCard {...base} kind={kind} points={points} />);

      const expected = points.map(({ ts, value }) => ({ label: ts, value }));
      expect(cardProps().data).toEqual(expected);
      expect(cardProps().exportData).toEqual(expected);
      expect(cardProps().dataColumns?.map(column => column.key)).toEqual(['label', 'value']);
      expect(cardProps().exportable).toBe(true);
      expect(cardProps().fullscreen).toBe(true);
      expect(chartPoints()).toEqual(points.map(point => ({
        ...point,
        label: formatTime(point.ts, { locale: 'de-DE', tz: 'Asia/Tokyo' }),
      })));
      expect(chartPoints().map(point => point.ts)).toEqual(points.map(point => point.ts));
      expect(points).toEqual(original);
    },
  );

  it('updates chart labels for saved locale/timezone changes without changing evidence', () => {
    const points = [{ ts: '2026-10-14T00:30:00+09:00', label: '00:30', value: 2.5 }];
    const { rerender } = render(<TrendCard {...base} kind="power" points={points} />);
    const evidence = cardProps().exportData;
    const previousLabel = chartPoints()[0].label;

    captured.preferences.locale = 'en-US';
    captured.preferences.tz = 'America/Los_Angeles';
    rerender(<TrendCard {...base} kind="power" points={points} />);

    expect(chartPoints()[0].label).toBe(formatTime(points[0].ts, {
      locale: 'en-US', tz: 'America/Los_Angeles',
    }));
    expect(chartPoints()[0].label).not.toBe(previousLabel);
    expect(cardProps().exportData).toEqual(evidence);
    expect(cardProps().data).toEqual(evidence);
  });

  it('retains invalid source dates and uses a placeholder for missing dates without faking instants', () => {
    const points = [
      { ts: 'not-a-date', label: 'stale label', value: 3.5 },
      { ts: '', label: 'stale label', value: 0 },
    ];
    render(<TrendCard {...base} kind="hours" points={points} />);

    const expected = [{ label: 'not-a-date', value: 3.5 }, { label: '—', value: 0 }];
    expect(cardProps().data).toEqual(expected);
    expect(cardProps().exportData).toEqual(expected);
    expect(chartPoints().map(point => point.label)).toEqual(['—', '—']);
    expect(cardProps().empty).toBe(false);
  });

  it('preserves loading, error, retry and empty state contracts', () => {
    const onRetry = vi.fn();
    const error = new Error('refresh failed');
    render(<TrendCard kind="power" points={[]} isLoading error={error} onRetry={onRetry} />);
    expect(cardProps()).toMatchObject({
      data: [], exportData: [], loading: true, error, empty: true, onRetry,
    });
    cardProps().onRetry?.();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
