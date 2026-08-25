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
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceToSI } from '@/lib/unitConversion';

interface HourlyDistributionPlotProps {
  rows: {
    hour: string;
    drives: number;
    distance: number | null;
    share: number;
  }[];
  /** Passed from parent for backwards-compatibility; context-based hide takes precedence. */
  isHidden?: (key: string) => boolean;
}

export function HourlyDistributionPlot({
  rows,
  isHidden: externalIsHidden,
}: HourlyDistributionPlotProps) {
  const { t } = useTranslation();
  const { unitPrefs, formatDistance } = useUnits();
  const driveName = t('rhythm.hourly.drives', 'Drive starts');
  const distanceName = t('rhythm.hourly.distance', 'Logged distance');
  const fullDistanceName = `${distanceName} (${unitPrefs.distance})`;

  const dataColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'hour', label: t('rhythm.hourly.colHour', 'Hour') },
      {
        key: 'drives',
        label: driveName,
        format: (v) => String(v ?? 0),
      },
      {
        key: 'distance',
        label: fullDistanceName,
        format: (v) =>
          formatDistance(
            v != null ? convertDistanceToSI(v as number, unitPrefs.distance) : null,
            { precision: 1 },
          ),
      },
    ],
    [t, driveName, fullDistanceName, formatDistance, unitPrefs.distance],
  );

  return (
    <EmbeddedChart
      chartKey="hourly-distribution"
      title={t('rhythm.hourly.title', 'Hourly Distribution')}
      ariaLabel={t('rhythm.hourly.aria', 'Drive starts and distance logged per hour of the day')}
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
                dataKey="hour"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                interval={2}
              />
              <YAxis
                yAxisId="drives"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={36}
              />
              <YAxis
                yAxisId="distance"
                orientation="right"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(value) => fmtNumber(value, 0)}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value, name) =>
                      name === driveName
                        ? t('rhythm.hourly.driveValue', '{{count}} drives', {
                            count: typeof value === 'number' ? value : 0,
                          })
                        : formatDistance(
                            typeof value === 'number'
                              ? convertDistanceToSI(value, unitPrefs.distance)
                              : null,
                            { precision: 1 },
                          )
                    }
                  />
                }
              />
              <ChartLegend verticalAlign="top" align="right" />
              <Bar
                yAxisId="drives"
                dataKey="drives"
                name={driveName}
                fill={CHART_COLORS[0]}
                fillOpacity={0.72}
                radius={[4, 4, 0, 0]}
                hide={hidden('drives')}
              />
              <Line
                yAxisId="distance"
                type="monotone"
                dataKey="distance"
                name={fullDistanceName}
                stroke={CHART_COLORS[1]}
                strokeWidth={2.5}
                dot={false}
                connectNulls
                hide={hidden('distance')}
              />
            </ComposedChart>
          </ResponsiveContainer>
        );
      }}
    </EmbeddedChart>
  );
}
