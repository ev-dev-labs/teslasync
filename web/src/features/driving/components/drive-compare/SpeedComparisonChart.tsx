import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

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
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertSpeedFromSI } from '@/lib/unitConversion';

import {
  mergeProfileSeries,
  type NormalizedDriveProfile,
} from '../../lib/driveCompare';
import { CompareSectionBody, type CompareSectionState } from './CompareSectionBody';

interface SpeedComparisonChartProps {
  profileA: NormalizedDriveProfile | null;
  profileB: NormalizedDriveProfile | null;
  state: CompareSectionState;
}

export function SpeedComparisonChart({ profileA, profileB, state }: SpeedComparisonChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const speedA = profileA?.speed ?? [];
  const speedB = profileB?.speed ?? [];
  const hasData = speedA.length >= 2 && speedB.length >= 2;
  const rows = useMemo(
    () => mergeProfileSeries(speedA, speedB).map((point) => ({
      progress: point.progress,
      a: point.a != null ? convertSpeedFromSI(point.a, unitPrefs.speed) : null,
      b: point.b != null ? convertSpeedFromSI(point.b, unitPrefs.speed) : null,
    })),
    [speedA, speedB, unitPrefs.speed],
  );
  const seriesA = useMemo(() => speedA.map((point) => ({
    progress: point.progress,
    a: convertSpeedFromSI(point.value, unitPrefs.speed),
  })), [speedA, unitPrefs.speed]);
  const seriesB = useMemo(() => speedB.map((point) => ({
    progress: point.progress,
    b: convertSpeedFromSI(point.value, unitPrefs.speed),
  })), [speedB, unitPrefs.speed]);
  const driveAName = t('driveCompare.chart.driveASpeed', 'Drive A speed');
  const driveBName = t('driveCompare.chart.driveBSpeed', 'Drive B speed');

  return (
    <ChartContainer
      title={t('driveCompare.chart.speedTitle', 'Speed through trip progress')}
      subtitle={t('driveCompare.chart.speedSubtitle', 'Each drive is normalized from start to finish')}
      ariaLabel={t(
        'driveCompare.chart.speedAria',
        'Drive A and Drive B speed compared over normalized trip progress',
      )}
      height={310}
      chartKey="drive-compare-speed"
      exportable={!state.error && !state.isLoading && !state.emptyMessage && hasData}
      exportFilename="drive-compare-speed"
      data={hasData ? rows : []}
      dataColumns={[
        { key: 'progress', label: t('driveCompare.chart.progress', 'Trip progress') },
        {
          key: 'a',
          label: driveAName,
          format: (value) => typeof value === 'number' ? `${fmtNumber(value, 0)} ${unitPrefs.speed}` : '—',
        },
        {
          key: 'b',
          label: driveBName,
          format: (value) => typeof value === 'number' ? `${fmtNumber(value, 0)} ${unitPrefs.speed}` : '—',
        },
      ]}
      className="h-full"
    >
      {({ hiddenSeries }) => (
        <CompareSectionBody
          state={state}
          icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
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
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  unit={` ${unitPrefs.speed}`}
                  width={58}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      labelFormatter={(value) => t(
                        'driveCompare.chart.progressValue',
                        '{{value}}% complete',
                        { value: fmtNumber(value, 0) },
                      )}
                      valueFormatter={(value) => `${fmtNumber(value, 0)} ${unitPrefs.speed}`}
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
              icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'driveCompare.chart.noSpeed',
                'Both drives need at least two speed samples for a progress comparison.',
              )}
              className="h-full"
            />
          )}
        </CompareSectionBody>
      )}
    </ChartContainer>
  );
}
