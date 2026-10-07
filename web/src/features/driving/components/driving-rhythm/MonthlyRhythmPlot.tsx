import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ComposedChart,
  EmbeddedChart,
  type ChartDataColumn,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { fmtNumber } from '@/lib/numberFormat';

interface MonthlyRhythmPlotProps {
  rows: {
    month: string;
    drives: number;
    predictability: number | null;
    activeDays: number;
    activeSlots: number;
    distance: string;
  }[];
  /** Passed from parent for backwards-compatibility; context-based hide takes precedence. */
  isHidden?: (key: string) => boolean;
}

export function MonthlyRhythmPlot({
  rows,
  isHidden: externalIsHidden,
}: MonthlyRhythmPlotProps) {
  const { t } = useTranslation();
  const drivesName = t('rhythm.monthly.drives', 'Valid drives');
  const scoreName = t(
    'rhythm.monthly.predictability',
    'Predictability score',
  );

  const dataColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'month', label: t('rhythm.monthly.colMonth', 'Month') },
      {
        key: 'drives',
        label: drivesName,
        format: (v) => String(v ?? 0),
      },
      {
        key: 'predictability',
        label: scoreName,
        format: (v) => (v != null ? fmtNumber(v as number, 0) : '—'),
      },
    ],
    [t, drivesName, scoreName],
  );

  return (
    <EmbeddedChart
      chartKey="monthly-rhythm"
      title={t('rhythm.monthly.title', 'Monthly Rhythm')}
      ariaLabel={t('rhythm.monthly.aria', 'Valid drive count and predictability score by month')}
      data={rows}
      dataColumns={dataColumns}
    >
      {({ hiddenSeries }) => {
        const hidden = (key: string) =>
          (hiddenSeries?.isHidden(key) ?? false) ||
          (externalIsHidden?.(key) ?? false);
        return (
          <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 12, right: 4, left: -12, bottom: 0 }}
              >
                {chartGrid}
                <XAxis
                  dataKey="month"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="drives"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={40}
                />
                <YAxis
                  yAxisId="score"
                  orientation="right"
                  domain={[0, 100]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value, name) =>
                        name === drivesName
                          ? t('rhythm.monthly.driveValue', '{{count}} drives', {
                              count: typeof value === 'number' ? value : 0,
                            })
                          : t(
                              'rhythm.monthly.scoreValue',
                              '{{score}} of 100',
                              { score: fmtNumber(value, 0) },
                            )
                      }
                    />
                  }
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  yAxisId="drives"
                  dataKey="drives"
                  name={drivesName}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.5}
                  radius={[4, 4, 0, 0]}
                  hide={hidden('drives')}
                />
                <Line
                  yAxisId="score"
                  type="monotone"
                  dataKey="predictability"
                  name={scoreName}
                  stroke={CHART_COLORS[1]}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  hide={hidden('predictability')}
                />
              </ComposedChart>
          </ResponsiveContainer>
        );
      }}
    </EmbeddedChart>
  );
}
