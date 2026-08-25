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
import { Badge } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { UtilizationSummary } from '../../lib/utilization';
import type { UtilizationSectionState } from './types';
import { useUtilizationDisplay } from './useUtilizationDisplay';

interface UtilizationTrendProps {
  summary: UtilizationSummary;
  state: UtilizationSectionState;
}

export function UtilizationTrend({
  summary,
  state,
}: UtilizationTrendProps) {
  const { t } = useTranslation();
  const {
    distanceUnit,
    formatDayShort,
    toDisplayDistance,
  } = useUtilizationDisplay();
  const guard = summary.sampleGuards.monthlyTrend;
  const distanceName = t(
    'utilization.trend.distanceSeries',
    'Observed distance',
  );
  const activeDaysName = t(
    'utilization.trend.activeDaysSeries',
    'Active days',
  );
  const rows = useMemo(
    () =>
      summary.months.map((month) => ({
        month: formatDayShort(`${month.month}-01`),
        monthKey: month.month,
        distance:
          Math.round(toDisplayDistance(month.distanceM) * 10) / 10,
        activeDays: month.activeDays,
        observedDays: Math.round(month.observedDays * 10) / 10,
        drives: month.driveCount,
        drivingHours:
          Math.round((month.drivingS / 3_600) * 10) / 10,
      })),
    [formatDayShort, summary.months, toDisplayDistance],
  );

  return (
    <section
      aria-label={t(
        'utilization.sections.trend',
        'Monthly utilization trend',
      )}
      data-testid="utilization-trend"
    >
      <ChartContainer
        title={t(
          'utilization.trend.title',
          'Monthly utilization trend',
        )}
        subtitle={t(
          'utilization.trend.subtitle',
          'UTC month distance with active-day context; partial boundary months remain observed snapshots.',
        )}
        ariaLabel={t(
          'utilization.trend.aria',
          'Monthly observed distance bars with an active-day line',
        )}
        action={
          <Badge variant={guard.sufficient ? 'success' : 'warning'} dot>
            {guard.sufficient
              ? t(
                  'utilization.sample.supported',
                  '{{count}} observations',
                  { count: guard.sampleSize },
                )
              : t(
                  'utilization.sample.limited',
                  'Limited sample: {{count}} of {{minimum}}',
                  {
                    count: guard.sampleSize,
                    minimum: guard.minimum,
                  },
                )}
          </Badge>
        }
        loading={state.isLoading}
        empty={false}
        height={360}
        chartKey="utilization-monthly-trend"
        exportable={
          !state.error && !state.isLoading && rows.length > 0
        }
        exportFilename="utilization-monthly-trend"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          {
            key: 'month',
            label: t('utilization.columns.month', 'Month'),
          },
          {
            key: 'distance',
            label: t(
              'utilization.columns.distanceWithUnit',
              'Distance ({{unit}})',
              { unit: distanceUnit },
            ),
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'activeDays',
            label: t(
              'utilization.columns.activeDays',
              'Active days',
            ),
            format: (value) => fmtInt(value),
          },
          {
            key: 'observedDays',
            label: t(
              'utilization.columns.observedDays',
              'Observed days',
            ),
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'drives',
            label: t('utilization.columns.drives', 'Drives'),
            format: (value) => fmtInt(value),
          },
          {
            key: 'drivingHours',
            label: t(
              'utilization.columns.drivingHours',
              'Driving hours',
            ),
            format: (value) => fmtNumber(value, 1),
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError
                error={state.error}
                onRetry={state.onRetry}
              />
            </div>
          ) : summary.accounting.eligibleRows === 0 ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              className="h-full"
              icon={
                <CalendarRange
                  className="h-8 w-8"
                  aria-hidden="true"
                />
              }
              message={t(
                'utilization.trend.empty',
                'No eligible drives are available for a monthly trend.',
              )}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 12, right: 4, left: -8, bottom: 0 }}
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
                  yAxisId="days"
                  orientation="right"
                  allowDecimals={false}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value, name) =>
                        name === distanceName
                          ? t(
                              'utilization.value.distance',
                              '{{value}} {{unit}}',
                              {
                                value: fmtNumber(value, 1),
                                unit: distanceUnit,
                              },
                            )
                          : t(
                              'utilization.value.days',
                              '{{count}} days',
                              {
                                count:
                                  typeof value === 'number'
                                    ? value
                                    : 0,
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
                  maxBarSize={42}
                  hide={
                    hiddenSeries?.isHidden('distance') ?? false
                  }
                />
                <Line
                  yAxisId="days"
                  type="monotone"
                  dataKey="activeDays"
                  name={activeDaysName}
                  stroke={CHART_COLORS[1]}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  hide={
                    hiddenSeries?.isHidden('activeDays') ?? false
                  }
                />
              </ComposedChart>
            </ResponsiveContainer>
          )
        }
      </ChartContainer>
    </section>
  );
}
