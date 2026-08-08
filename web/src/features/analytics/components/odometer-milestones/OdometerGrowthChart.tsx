import { TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Area,
  AreaChart,
  ChartContainer,
  ChartGradient,
  ChartTooltip,
  CHART_COLORS,
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

interface OdometerGrowthChartProps {
  summary: OdometerMilestoneResult;
  state: MilestoneSectionState;
  className?: string;
}

export function OdometerGrowthChart({
  summary,
  state,
  className,
}: OdometerGrowthChartProps) {
  const { t } = useTranslation();
  const {
    distanceUnit,
    formatDateMs,
    toDisplayDistance,
  } = useOdometerMilestoneDisplay();
  const rows = useMemo(
    () =>
      summary.cumulativeSeries.map((point) => ({
        date: formatDateMs(point.timestampMs),
        odometer: toDisplayDistance(point.odometerKm),
        observedDistance: toDisplayDistance(point.cumulativeDistanceKm),
        drives: point.driveCount,
      })),
    [formatDateMs, summary.cumulativeSeries, toDisplayDistance],
  );
  const hasData = rows.length > 0;
  const odometerName = t(
    'milestones.growth.odometerSeries',
    'Calibrated odometer',
  );

  return (
    <section
      className={className}
      aria-label={t(
        'milestones.sections.growth',
        'Observed odometer growth history',
      )}
      data-testid="milestone-growth"
    >
      <ChartContainer
        className="h-full"
        title={t('milestones.growth.title', 'Observed odometer growth')}
        subtitle={t(
          'milestones.growth.subtitle',
          'Cumulative eligible drive distance added to the window-start calibration; visual points may be downsampled.',
        )}
        ariaLabel={t(
          'milestones.growth.aria',
          'Calibrated odometer growth across the returned eligible drive history',
        )}
        loading={state.isLoading}
        height={330}
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="odometer-growth"
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'date', label: t('milestones.chart.date', 'Date') },
          {
            key: 'odometer',
            label: `${odometerName} (${distanceUnit})`,
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'observedDistance',
            label: t(
              'milestones.growth.observedDistance',
              'Observed distance ({{unit}})',
              { unit: distanceUnit },
            ),
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'drives',
            label: t('milestones.chart.driveCount', 'Drive count'),
            format: (value) => fmtInt(value),
          },
        ]}
      >
        {state.error ? (
          <div className="flex h-full items-center justify-center">
            <QueryError error={state.error} onRetry={state.onRetry} />
          </div>
        ) : !hasData ? (
          <EmptyState /* no-action: history populates after eligible drives are recorded. */
            className="h-full"
            icon={<TrendingUp className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'milestones.growth.empty',
              'No eligible drive distance is available for an odometer growth series.',
            )}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={rows}
              margin={{ top: 12, right: 8, left: -8, bottom: 0 }}
            >
              <defs>
                <ChartGradient
                  id="odometer-growth-fill"
                  color={CHART_COLORS[0]}
                />
              </defs>
              {chartGrid}
              <XAxis
                dataKey="date"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => fmtNumber(value, 0)}
                width={54}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value, name) =>
                      name === odometerName
                        ? `${fmtNumber(value, 1)} ${distanceUnit}`
                        : fmtNumber(value, 1)
                    }
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="odometer"
                name={odometerName}
                stroke={CHART_COLORS[0]}
                fill="url(#odometer-growth-fill)"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
    </section>
  );
}
