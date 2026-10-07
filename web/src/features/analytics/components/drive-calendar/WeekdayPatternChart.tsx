import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartContainer,
  ChartTooltip,
  CHART_COLORS,
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

import type { CalendarWeekday } from '../../lib/driveCalendar';
import { getWeekdayLabels } from './labels';
import type { DriveCalendarSectionState } from './types';

interface WeekdayPatternChartProps extends DriveCalendarSectionState {
  weekdays: CalendarWeekday[];
  className?: string;
}

/** Sunday-to-Saturday distance profile for the observed calendar window. */
export function WeekdayPatternChart({
  weekdays,
  className,
  isLoading,
  error,
  onRetry,
}: WeekdayPatternChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const labels = getWeekdayLabels(t);
  const distanceUnit = unitPrefs.distance;

  const rows = useMemo(
    () =>
      weekdays.map((weekday) => ({
        weekday: labels[weekday.day] ?? '—',
        distance:
          Math.round(convertDistanceFromSI(weekday.distanceM, distanceUnit) * 10) / 10,
        drives: weekday.drives,
        activeDays: weekday.activeDays,
      })),
    [distanceUnit, labels, weekdays],
  );

  const hasData = weekdays.some((weekday) => weekday.drives > 0);
  const chartRows = hasData ? rows : [];
  const distanceName = t(
    'driveCalendar.weekdayPattern.distanceSeries',
    'Distance ({{unit}})',
    { unit: distanceUnit },
  );

  return (
    <ChartContainer
      className={className}
      title={t('driveCalendar.weekdayPattern.title', 'Day-of-week pattern')}
      subtitle={t(
        'driveCalendar.weekdayPattern.subtitle',
        'Distance by weekday across the observed window',
      )}
      ariaLabel={t(
        'driveCalendar.weekdayPattern.aria',
        'Bar chart comparing total driving distance from Sunday through Saturday',
      )}
      loading={isLoading}
      empty={!error && !hasData}
      height={310}
      exportable={!error}
      exportFilename="drive-calendar-weekdays"
      data={chartRows}
      dataColumns={[
        {
          key: 'weekday',
          label: t('driveCalendar.weekdayPattern.weekday', 'Weekday'),
        },
        {
          key: 'distance',
          label: distanceName,
          format: (value) => fmtNumber(value, 1),
        },
        {
          key: 'drives',
          label: t('driveCalendar.weekdayPattern.drives', 'Drives'),
          format: (value) => fmtInt(value),
        },
        {
          key: 'activeDays',
          label: t('driveCalendar.weekdayPattern.activeDays', 'Active days'),
          format: (value) => fmtInt(value),
        },
      ]}
    >
      {error ? (
        <div className="flex h-full items-center justify-center">
          <QueryError error={error} onRetry={onRetry} />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
            {chartGrid}
            <XAxis
              dataKey="weekday"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => fmtNumber(value, 0)}
            />
            <Tooltip
              content={
                <ChartTooltip
                  valueFormatter={(value) =>
                    `${fmtNumber(value, 1)} ${distanceUnit}`
                  }
                />
              }
            />
            <Bar
              dataKey="distance"
              name={distanceName}
              fill={CHART_COLORS[2]}
              radius={[5, 5, 0, 0]}
              maxBarSize={44}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
