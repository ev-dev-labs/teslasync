import { CalendarRange } from 'lucide-react';
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
import { EmptyState, QueryError } from '@/components/feedback';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { OdometerMilestoneResult } from '../../lib/odometerMilestones';
import type { MilestoneSectionState } from './types';
import { useOdometerMilestoneDisplay } from './useOdometerMilestoneDisplay';

interface MonthlyDistanceChartProps {
  summary: OdometerMilestoneResult;
  state: MilestoneSectionState;
  className?: string;
}

export function MonthlyDistanceChart({
  summary,
  state,
  className,
}: MonthlyDistanceChartProps) {
  const { t } = useTranslation();
  const { distanceUnit, formatMonth, toDisplayDistance } =
    useOdometerMilestoneDisplay();
  const rows = useMemo(
    () =>
      summary.monthly.map((month) => ({
        month: formatMonth(month.monthStartMs),
        distance: toDisplayDistance(month.distanceKm),
        drives: month.driveCount,
        endingOdometer: toDisplayDistance(month.endingOdometerKm),
      })),
    [formatMonth, summary.monthly, toDisplayDistance],
  );
  const hasData = rows.length > 0;
  const distanceName = t(
    'milestones.monthly.distanceSeries',
    'Observed distance',
  );
  const drivesName = t('milestones.monthly.drivesSeries', 'Eligible drives');

  return (
    <section
      className={className}
      aria-label={t(
        'milestones.sections.monthly',
        'Monthly distance and pace context',
      )}
      data-testid="milestone-monthly"
    >
      <ChartContainer
        className="h-full"
        title={t(
          'milestones.monthly.title',
          'Monthly distance & drive frequency',
        )}
        subtitle={t(
          'milestones.monthly.subtitle',
          'UTC calendar-month distance bars with eligible drive-count context.',
        )}
        ariaLabel={t(
          'milestones.monthly.aria',
          'Observed monthly distance bars with an eligible drive-count line',
        )}
        loading={state.isLoading}
        height={330}
        chartKey="odometer-milestones-monthly"
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="odometer-monthly-context"
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'month', label: t('milestones.chart.month', 'Month') },
          {
            key: 'distance',
            label: `${distanceName} (${distanceUnit})`,
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'drives',
            label: drivesName,
            format: (value) => fmtInt(value),
          },
          {
            key: 'endingOdometer',
            label: t(
              'milestones.monthly.endingOdometer',
              'Ending odometer ({{unit}})',
              { unit: distanceUnit },
            ),
            format: (value) => fmtNumber(value, 1),
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : !hasData ? (
            <EmptyState /* no-action: monthly context appears from eligible returned drives. */
              className="h-full"
              icon={<CalendarRange className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'milestones.monthly.empty',
                'No eligible drives are available for monthly context.',
              )}
            />
          ) : (
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
                  width={32}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value, name) =>
                        name === distanceName
                          ? `${fmtNumber(value, 1)} ${distanceUnit}`
                          : t(
                              'milestones.monthly.driveValue',
                              '{{count}} drives',
                              {
                                count:
                                  typeof value === 'number' ? value : 0,
                              },
                            )
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
    </section>
  );
}
