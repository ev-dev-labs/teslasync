import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  ChartContainer,
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
import { QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import type { CalendarMonth } from '../../lib/driveCalendar';
import { formatCalendarMonth } from './labels';
import type { DriveCalendarSectionState } from './types';

interface MonthlyActivityChartProps extends DriveCalendarSectionState {
  months: CalendarMonth[];
  className?: string;
}

/** Rolling calendar-month distance bars with drive-count trend overlay. */
export function MonthlyActivityChart({
  months,
  className,
  isLoading,
  error,
  onRetry,
}: MonthlyActivityChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { distance: distanceUnit, locale } = unitPrefs;

  const rows = useMemo(
    () =>
      months.map((month) => ({
        month: formatCalendarMonth(month.month, locale, true),
        distance: Math.round(convertDistanceFromSI(month.distanceM, distanceUnit) * 10) / 10,
        drives: month.drives,
        activeDays: month.activeDays,
      })),
    [distanceUnit, locale, months],
  );

  const hasData = months.some((month) => month.drives > 0);
  const chartRows = hasData ? rows : [];
  const distanceName = t(
    'driveCalendar.monthly.distanceSeries',
    'Distance ({{unit}})',
    { unit: distanceUnit },
  );
  const drivesName = t('driveCalendar.monthly.drivesSeries', 'Drives');

  return (
    <ChartContainer
      className={className}
      title={t('driveCalendar.monthly.title', 'Monthly distance & activity')}
      subtitle={t(
        'driveCalendar.monthly.subtitle',
        'Rolling 52-week totals by calendar month',
      )}
      ariaLabel={t(
        'driveCalendar.monthly.aria',
        'Monthly driving distance bars with a drive-count trend for the last 52 weeks',
      )}
      loading={isLoading}
      empty={!error && !hasData}
      height={310}
      exportable={!error}
      exportFilename="drive-calendar-monthly"
      chartKey="drive-calendar-monthly"
      data={chartRows}
      dataColumns={[
        { key: 'month', label: t('driveCalendar.monthly.month', 'Month') },
        {
          key: 'distance',
          label: distanceName,
          format: (value) => fmtNumber(value, 1),
        },
        {
          key: 'drives',
          label: drivesName,
          format: (value) => fmtInt(value),
        },
        {
          key: 'activeDays',
          label: t('driveCalendar.monthly.activeDays', 'Active days'),
          format: (value) => fmtInt(value),
        },
      ]}
    >
      {({ hiddenSeries }) =>
        error ? (
          <div className="flex h-full items-center justify-center">
            <QueryError error={error} onRetry={onRetry} />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 12, right: 4, left: -16, bottom: 0 }}>
              {chartGrid}
              <XAxis
                dataKey="month"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="distance"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => fmtNumber(value, 0)}
              />
              <YAxis
                yAxisId="drives"
                orientation="right"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value, name) =>
                      name === distanceName
                        ? `${fmtNumber(value, 1)} ${distanceUnit}`
                        : fmtInt(value)
                    }
                  />
                }
              />
              <ChartLegend verticalAlign="top" align="right" />
              <Bar
                yAxisId="distance"
                dataKey="distance"
                name={distanceName}
                fill={CHART_COLORS[0]}
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
                hide={hiddenSeries?.isHidden('distance') ?? false}
              />
              <Line
                yAxisId="drives"
                type="monotone"
                dataKey="drives"
                name={drivesName}
                stroke={CHART_COLORS[1]}
                strokeWidth={2.5}
                dot={{ r: 2.5 }}
                hide={hiddenSeries?.isHidden('drives') ?? false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )
      }
    </ChartContainer>
  );
}
