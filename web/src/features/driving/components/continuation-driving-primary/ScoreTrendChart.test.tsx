import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChartCardProps } from '@/components/layout';
import type { ChartTooltipProps } from '@/components/charts/ChartTooltip';
import type { Drive } from '@/types/driving';
import { formatDateShort, formatDateTime } from '@/lib/dateFormat';
import { scoreDrive } from '../score-orchestrator/scoreDomain';
import { useDriveScorePage } from '../../hooks/useDriveScorePage';
import { ScoreTrendChart } from './ScoreTrendChart';

const h = vi.hoisted(() => ({
  drives: [] as Drive[],
  frame: vi.fn(),
  chart: vi.fn(),
  axis: vi.fn(),
  tooltip: vi.fn(),
  annotations: vi.fn(),
  legend: vi.fn(),
  series: vi.fn(),
  hiddenSeries: {
    hidden: new Set(['speed']),
    toggle: vi.fn(),
    reset: vi.fn(),
    isHidden: vi.fn((key: string) => key === 'speed'),
  },
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDriveScore: () => ({ data: undefined }),
  useDriveCalendarHistory: () => ({ data: h.drives }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2025-01-01T00:00:00Z',
    endInstantExclusive: '2027-01-01T00:00:00Z',
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useDataState', () => ({
  useDataState: () => ({ hasData: true, fatalError: null }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km' },
    formatDistance: String, formatSpeed: String, formatPower: String,
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt: String, fmtNumber: String }),
}));
vi.mock('@/components/layout', () => ({
  ChartCard: (props: ChartCardProps) => {
    h.frame(props);
    return <>{typeof props.children === 'function'
      ? props.children({ annotations: [], hidden: false, hiddenSeries: h.hiddenSeries })
      : props.children}</>;
  },
}));
vi.mock('@/components/charts', () => {
  const Host = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AREA_DEFAULTS: {},
    ResponsiveContainer: Host,
    LineChart: (props: { children?: ReactNode }) => {
      h.chart(props);
      return <Host>{props.children}</Host>;
    },
    XAxis: (props: object) => { h.axis(props); return null; },
    ChartTooltip: () => null,
    Tooltip: (props: { content: React.ReactElement<ChartTooltipProps> }) => {
      h.tooltip(props.content.props);
      return null;
    },
    ChartLegend: (props: object) => { h.legend(props); return null; },
    Line: (props: object) => { h.series(props); return null; },
    YAxis: () => null, CartesianGrid: () => null, ReferenceLine: () => null,
    renderAnnotationLines: (annotations: unknown, mapper: (timestamp: string) => number) => {
      h.annotations(annotations, mapper);
      return [];
    },
  };
});

function drive(id: number, startTs: string): Drive {
  return {
    id, vehicleId: 7, startTs, endTs: startTs, durationS: 1800, distanceM: 100_000,
    energyUsedWh: 16_000, regenEnergyWh: 2_000, avgSpeedMps: 20, maxSpeedMps: 40,
    avgPowerW: 30_000, outsideTempAvgC: 20, insideTempAvgC: 21,
    startAddress: 'Home', endAddress: 'Office',
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 80, endBatteryPct: 60, score: null,
    endedStatus: 'completed', createdAt: startTs, updatedAt: startTs, live: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.drives = [];
});

describe('drive score timestamp and identity regression', () => {
  it('retains raw instants and drive IDs across same-day drives and years with all populated scores', () => {
    h.drives = [
      drive(3, '2026-04-04T18:00:00Z'),
      drive(1, '2025-04-04T09:00:00Z'),
      drive(2, '2026-04-04T09:00:00Z'),
    ];
    const { result } = renderHook(() => useDriveScorePage());
    expect(result.current.trendChartData).toEqual([h.drives[1], h.drives[2], h.drives[0]]
      .map((item) => {
        const score = scoreDrive(item)!;
        return {
          date: item.startTs, driveId: item.id,
          score: score.total, efficiency: score.efficiency,
          smoothness: score.smoothness, speed: score.speed,
        };
      }));
  });

  it('preserves the chronological latest-20 selection and separate IDs for coincident drives', () => {
    h.drives = Array.from({ length: 22 }, (_, index) =>
      drive(index + 1, new Date(Date.UTC(2026, 0, index < 2 ? 1 : index)).toISOString()));
    const { result, rerender } = renderHook(() => useDriveScorePage());
    expect(result.current.trendChartData.map((point) => point.driveId))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 3));
    h.drives = [drive(100, '2026-04-04T09:00:00Z'), drive(101, '2026-04-04T09:00:00Z')];
    rerender();
    expect(result.current.trendChartData.map((point) => point.driveId)).toEqual([100, 101]);
  });

  it('uses the same numeric time coordinates for points and offset-equivalent annotations, formatting labels only', () => {
    h.drives = [drive(1, '2026-04-04T09:00:00Z'), drive(2, '2026-04-04T18:00:00Z')];
    const { result } = renderHook(() => useDriveScorePage());
    const data = result.current.trendChartData;
    render(<ScoreTrendChart data={data} vehicleId={7} scoreColor="var(--theme-primary)"
      colors={{ efficiency: 'var(--theme-primary)', smoothness: 'var(--theme-primary)', speed: 'var(--theme-primary)' }} />);
    const chart = h.chart.mock.calls[0][0];
    expect(chart.data).toEqual(data.map((point) => ({ ...point, timestamp: Date.parse(point.date) })));
    expect(chart.data[0].timestamp).not.toBe(chart.data[1].timestamp);
    const axis = h.axis.mock.calls[0][0];
    expect(axis).toMatchObject({ dataKey: 'timestamp', type: 'number', scale: 'time', domain: ['dataMin', 'dataMax'] });
    expect(axis.tickFormatter(chart.data[0].timestamp)).toBe(formatDateShort(new Date(data[0].date)));
    expect(h.tooltip.mock.calls[0][0].labelFormatter(chart.data[0].timestamp))
      .toBe(formatDateTime(data[0].date));
    expect(h.annotations.mock.calls[0][1]('2026-04-04T02:00:00-07:00')).toBe(chart.data[0].timestamp);
    expect(h.frame.mock.calls[0][0]).toMatchObject({
      data, toolbar: true, exportable: true, chartKey: 'drive-score-trend',
      annotations: { vehicleId: 7, scope: 'efficiency', chartId: 'drive-score-trend' },
    });
    expect(h.frame.mock.calls[0][0].dataColumns.map((column: { key: string }) => column.key))
      .toEqual(['date', 'score', 'efficiency', 'smoothness', 'speed']);
    expect(h.legend.mock.calls[0][0].state).toBe(h.hiddenSeries);
    expect(h.series.mock.calls.map(([props]) => [props.dataKey, props.hide]))
      .toEqual([['score', false], ['efficiency', false], ['smoothness', false], ['speed', true]]);
  });
});
