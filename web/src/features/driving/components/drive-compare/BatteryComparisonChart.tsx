import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryMedium } from 'lucide-react';

import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';

import {
  mergeProfileSeries,
  type NormalizedDriveProfile,
} from '../../lib/driveCompare';
import { CompareSectionBody, type CompareSectionState } from './CompareSectionBody';

interface BatteryComparisonChartProps {
  profileA: NormalizedDriveProfile | null;
  profileB: NormalizedDriveProfile | null;
  state: CompareSectionState;
}

export function BatteryComparisonChart({ profileA, profileB, state }: BatteryComparisonChartProps) {
  const { t } = useTranslation();
  const socA = profileA?.soc ?? [];
  const socB = profileB?.soc ?? [];
  const hasData = socA.length >= 2 && socB.length >= 2;
  const rows = useMemo(
    () => mergeProfileSeries(socA, socB).map((point) => ({
      progress: point.progress,
      a: point.a,
      b: point.b,
    })),
    [socA, socB],
  );
  const seriesA = useMemo(() => socA.map((point) => ({ progress: point.progress, a: point.value })), [socA]);
  const seriesB = useMemo(() => socB.map((point) => ({ progress: point.progress, b: point.value })), [socB]);
  const driveAName = t('driveCompare.chart.driveASoc', 'Drive A SOC');
  const driveBName = t('driveCompare.chart.driveBSoc', 'Drive B SOC');

  return (
    <ChartContainer
      title={t('driveCompare.chart.batteryTitle', 'Battery through trip progress')}
      subtitle={t('driveCompare.chart.batterySubtitle', 'State of charge from start to finish')}
      ariaLabel={t(
        'driveCompare.chart.batteryAria',
        'Drive A and Drive B battery state of charge over normalized trip progress',
      )}
      height={310}
      chartKey="drive-compare-battery"
      exportable={!state.error && !state.isLoading && !state.emptyMessage && hasData}
      exportFilename="drive-compare-battery"
      data={hasData ? rows : []}
      dataColumns={[
        { key: 'progress', label: t('driveCompare.chart.progress', 'Trip progress') },
        {
          key: 'a',
          label: driveAName,
          format: (value) => typeof value === 'number' ? `${fmtNumber(value, 0)}%` : '—',
        },
        {
          key: 'b',
          label: driveBName,
          format: (value) => typeof value === 'number' ? `${fmtNumber(value, 0)}%` : '—',
        },
      ]}
      className="h-full"
    >
      {({ hiddenSeries }) => (
        <CompareSectionBody
          state={state}
          icon={<BatteryMedium className="h-8 w-8" aria-hidden="true" />}
          className="h-full min-h-0"
        >
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
                {chartGrid}
                <XAxis
                  type="number"
                  dataKey="progress"
                  allowDuplicatedCategory={false}
                  domain={[0, 100]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${fmtNumber(value, 0)}%`}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  unit=" %"
                  width={48}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      labelFormatter={(value) => t(
                        'driveCompare.chart.progressValue',
                        '{{value}}% complete',
                        { value: fmtNumber(value, 0) },
                      )}
                      valueFormatter={(value) => `${fmtNumber(value, 0)}%`}
                    />
                  }
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Line
                  type="monotone"
                  dataKey="a"
                  name={driveAName}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2.5}
                  dot={false}
                  data={seriesA}
                  connectNulls={false}
                  hide={hiddenSeries?.isHidden('a') ?? false}
                />
                <Line
                  type="monotone"
                  dataKey="b"
                  name={driveBName}
                  stroke={CHART_COLORS[3]}
                  strokeWidth={2.5}
                  dot={false}
                  data={seriesB}
                  connectNulls={false}
                  hide={hiddenSeries?.isHidden('b') ?? false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState /* no-action: historical telemetry cannot be regenerated; changing either selector may recover. */
              icon={<BatteryMedium className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'driveCompare.chart.noBattery',
                'Both drives need at least two battery samples for a progress comparison.',
              )}
              className="h-full"
            />
          )}
        </CompareSectionBody>
      )}
    </ChartContainer>
  );
}
