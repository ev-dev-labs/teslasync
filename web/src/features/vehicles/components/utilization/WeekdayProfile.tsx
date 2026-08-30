import { CalendarDays } from 'lucide-react';
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

interface WeekdayProfileProps {
  summary: UtilizationSummary;
  state: UtilizationSectionState;
}

export function WeekdayProfile({
  summary,
  state,
}: WeekdayProfileProps) {
  const { t } = useTranslation();
  const { distanceUnit, toDisplayDistance } =
    useUtilizationDisplay();
  const guard = summary.sampleGuards.weekdayProfile;
  const activeRateName = t(
    'utilization.weekday.activeRateSeries',
    'Active-day rate',
  );
  const distanceName = t(
    'utilization.weekday.distanceSeries',
    'Distance per active day',
  );
  const weekdayLabels = useMemo(
    () => [
      t('utilization.weekday.sun', 'Sun'),
      t('utilization.weekday.mon', 'Mon'),
      t('utilization.weekday.tue', 'Tue'),
      t('utilization.weekday.wed', 'Wed'),
      t('utilization.weekday.thu', 'Thu'),
      t('utilization.weekday.fri', 'Fri'),
      t('utilization.weekday.sat', 'Sat'),
    ],
    [t],
  );
  const rows = useMemo(
    () =>
      summary.weekdays.map((weekday) => ({
        weekday: weekdayLabels[weekday.weekday] ?? '—',
        activeRate:
          weekday.activeDayShare != null
            ? Math.round(weekday.activeDayShare * 1_000) / 10
            : 0,
        averageDistance:
          weekday.averageDistancePerActiveDayM != null
            ? Math.round(
                toDisplayDistance(
                  weekday.averageDistancePerActiveDayM,
                ) * 10,
              ) / 10
            : 0,
        drives: weekday.driveCount,
        observedDays: weekday.observedDays,
      })),
    [summary.weekdays, toDisplayDistance, weekdayLabels],
  );

  return (
    <section
      aria-label={t(
        'utilization.sections.weekday',
        'Weekday utilization profile',
      )}
      data-testid="utilization-weekday"
    >
      <ChartContainer
        title={t(
          'utilization.weekday.title',
          'Weekday profile',
        )}
        subtitle={t(
          'utilization.weekday.subtitle',
          'UTC weekday active-day rate and average distance on days with eligible drives.',
        )}
        ariaLabel={t(
          'utilization.weekday.aria',
          'Active-day rate bars and average active-day distance by UTC weekday',
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
        height={350}
        chartKey="utilization-weekday-profile"
        exportable={
          !state.error &&
          !state.isLoading &&
          summary.accounting.eligibleRows > 0
        }
        exportFilename="utilization-weekday-profile"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          {
            key: 'weekday',
            label: t('utilization.columns.weekday', 'Weekday'),
          },
          {
            key: 'activeRate',
            label: t(
              'utilization.columns.activeRate',
              'Active-day rate (%)',
            ),
            format: (value) => `${fmtNumber(value, 1)}%`,
          },
          {
            key: 'averageDistance',
            label: t(
              'utilization.columns.distanceWithUnit',
              'Distance ({{unit}})',
              { unit: distanceUnit },
            ),
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'drives',
            label: t('utilization.columns.drives', 'Drives'),
            format: (value) => fmtInt(value),
          },
          {
            key: 'observedDays',
            label: t(
              'utilization.columns.observedDays',
              'Observed days',
            ),
            format: (value) => fmtInt(value),
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
                <CalendarDays
                  className="h-8 w-8"
                  aria-hidden="true"
                />
              }
              message={t(
                'utilization.weekday.empty',
                'No eligible drives are available for a weekday profile.',
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
                  dataKey="weekday"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis
                  yAxisId="rate"
                  domain={[0, 100]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${fmtNumber(value, 0)}%`}
                  width={44}
                />
                <YAxis
                  yAxisId="distance"
                  orientation="right"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => fmtNumber(value, 0)}
                  width={40}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value, name) =>
                        name === activeRateName
                          ? `${fmtNumber(value, 1)}%`
                          : t(
                              'utilization.value.distance',
                              '{{value}} {{unit}}',
                              {
                                value: fmtNumber(value, 1),
                                unit: distanceUnit,
                              },
                            )
                      }
                    />
                  }
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  yAxisId="rate"
                  dataKey="activeRate"
                  name={activeRateName}
                  fill={CHART_COLORS[2]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                  hide={
                    hiddenSeries?.isHidden('activeRate') ?? false
                  }
                />
                <Line
                  yAxisId="distance"
                  type="monotone"
                  dataKey="averageDistance"
                  name={distanceName}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  hide={
                    hiddenSeries?.isHidden(
                      'averageDistance',
                    ) ?? false
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
