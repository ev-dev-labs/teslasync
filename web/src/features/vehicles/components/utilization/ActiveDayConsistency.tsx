import { CalendarCheck2 } from 'lucide-react';
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

const MAX_VISIBLE_WEEKS = 26;

interface ActiveDayConsistencyProps {
  summary: UtilizationSummary;
  state: UtilizationSectionState;
}

export function ActiveDayConsistency({
  summary,
  state,
}: ActiveDayConsistencyProps) {
  const { t } = useTranslation();
  const { formatDayShort } = useUtilizationDisplay();
  const guard = summary.sampleGuards.activeDayConsistency;
  const activeDaysName = t(
    'utilization.consistency.activeDaysSeries',
    'Active days',
  );
  const activeRateName = t(
    'utilization.consistency.activeRateSeries',
    'Observed-day rate',
  );
  const rows = useMemo(
    () =>
      summary.consistency.weeks
        .slice(-MAX_VISIBLE_WEEKS)
        .map((week) => ({
          week: formatDayShort(week.weekStart),
          weekStart: week.weekStart,
          activeDays: week.activeDays,
          activeRate: Math.round(week.activeDayShare * 1_000) / 10,
          observedDays: Math.round(week.observedDays * 10) / 10,
          phase: week.isPartial
            ? t(
                'utilization.consistency.partial',
                'Partial coverage',
              )
            : t(
                'utilization.consistency.full',
                'Full 7-day coverage',
              ),
        })),
    [formatDayShort, summary.consistency.weeks, t],
  );

  return (
    <section
      aria-label={t(
        'utilization.sections.consistency',
        'Active-day consistency',
      )}
      data-testid="utilization-consistency"
    >
      <ChartContainer
        title={t(
          'utilization.consistency.title',
          'Active-day consistency',
        )}
        subtitle={t(
          'utilization.consistency.subtitle',
          'Latest 26 UTC weeks at most; partial first or final weeks remain explicitly marked.',
        )}
        ariaLabel={t(
          'utilization.consistency.aria',
          'Weekly active-day counts and share of observed days with eligible drives',
        )}
        action={
          <div className="flex flex-wrap items-center gap-2">
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
            <Badge variant="info">
              {t(
                'utilization.consistency.longestStreak',
                'Longest active streak: {{count}} days',
                {
                  count:
                    summary.consistency.longestActiveStreakDays,
                },
              )}
            </Badge>
          </div>
        }
        loading={state.isLoading}
        empty={false}
        height={360}
        chartKey="utilization-active-day-consistency"
        exportable={
          !state.error && !state.isLoading && rows.length > 0
        }
        exportFilename="utilization-active-day-consistency"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          {
            key: 'week',
            label: t(
              'utilization.columns.weekStarting',
              'Week starting',
            ),
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
            key: 'activeRate',
            label: t(
              'utilization.columns.activeRate',
              'Active-day rate (%)',
            ),
            format: (value) => `${fmtNumber(value, 1)}%`,
          },
          {
            key: 'phase',
            label: t(
              'utilization.columns.coverage',
              'Coverage',
            ),
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
            <EmptyState
              className="h-full"
              icon={
                <CalendarCheck2
                  className="h-8 w-8"
                  aria-hidden="true"
                />
              }
              message={t(
                'utilization.consistency.empty',
                'No observed drive days are available for a consistency profile.',
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
                  dataKey="week"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={18}
                />
                <YAxis
                  yAxisId="days"
                  domain={[0, 7]}
                  allowDecimals={false}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <YAxis
                  yAxisId="rate"
                  orientation="right"
                  domain={[0, 100]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${fmtNumber(value, 0)}%`}
                  width={44}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value, name) =>
                        name === activeDaysName
                          ? t(
                              'utilization.value.days',
                              '{{count}} days',
                              {
                                count:
                                  typeof value === 'number'
                                    ? value
                                    : 0,
                              },
                            )
                          : `${fmtNumber(value, 1)}%`
                      }
                    />
                  }
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  yAxisId="days"
                  dataKey="activeDays"
                  name={activeDaysName}
                  fill={CHART_COLORS[1]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                  hide={
                    hiddenSeries?.isHidden('activeDays') ?? false
                  }
                />
                <Line
                  yAxisId="rate"
                  type="monotone"
                  dataKey="activeRate"
                  name={activeRateName}
                  stroke={CHART_COLORS[2]}
                  strokeWidth={2.5}
                  dot={{ r: 2.5 }}
                  hide={
                    hiddenSeries?.isHidden('activeRate') ?? false
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
