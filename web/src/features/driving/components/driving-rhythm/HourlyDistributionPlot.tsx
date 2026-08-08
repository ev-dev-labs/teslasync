import { useTranslation } from 'react-i18next';

import {
  Bar,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ComposedChart,
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
  isHidden: (key: string) => boolean;
}

export function HourlyDistributionPlot({
  rows,
  isHidden,
}: HourlyDistributionPlotProps) {
  const { t } = useTranslation();
  const { unitPrefs, formatDistance } = useUnits();
  const driveName = t('rhythm.hourly.drives', 'Drive starts');
  const distanceName = t('rhythm.hourly.distance', 'Logged distance');

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
          hide={isHidden('drives')}
        />
        <Line
          yAxisId="distance"
          type="monotone"
          dataKey="distance"
          name={`${distanceName} (${unitPrefs.distance})`}
          stroke={CHART_COLORS[1]}
          strokeWidth={2.5}
          dot={false}
          connectNulls
          hide={isHidden('distance')}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
