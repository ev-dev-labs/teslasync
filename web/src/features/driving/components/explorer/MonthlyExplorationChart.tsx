import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CHART_COLORS,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { cn } from '@/lib/cn';

import type { ExplorerSummary } from '../../lib/explorer';
import type { ExplorerSectionState } from './types';

interface MonthlyExplorationChartProps {
  summary: ExplorerSummary;
  state: ExplorerSectionState;
  className?: string;
}

export function MonthlyExplorationChart({
  summary,
  state,
  className,
}: MonthlyExplorationChartProps) {
  const { t } = useTranslation();
  const rows = summary.monthlyExploration;
  const hasRows = rows.length > 0;

  return (
    <section
      className={className}
      aria-label={t(
        'explorer.section.monthly',
        'Monthly exploration and discovery trend',
      )}
      data-testid="explorer-monthly"
    >
      <ChartContainer
        className={cn('h-full')}
        title={t('explorer.discoveries', 'New Places per Month')}
        subtitle={t(
          'explorer.monthly.subtitle',
          'First arrivals, return arrivals, and cumulative observed destinations',
        )}
        ariaLabel={t(
          'explorer.monthly.aria',
          'Monthly new destinations, repeat destination arrivals, and cumulative destinations',
        )}
        loading={state.isLoading}
        empty={false}
        height={340}
        chartKey="explorer-monthly-discovery"
        exportable={!state.error && !state.isLoading && hasRows}
        exportFilename="explorer-monthly-discovery"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'month', label: t('explorer.col.month', 'Month') },
          {
            key: 'newPlaces',
            label: t('explorer.col.newPlaces', 'New places'),
          },
          {
            key: 'repeatArrivals',
            label: t(
              'explorer.monthly.repeatArrivals',
              'Repeat arrivals',
            ),
          },
          {
            key: 'cumulativePlaces',
            label: t(
              'explorer.monthly.cumulativePlaces',
              'Cumulative places',
            ),
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : !hasRows ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              className="h-full"
              icon={<Sparkles className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'explorer.monthly.empty',
                'No non-base destination arrivals are available for a monthly trend.',
              )}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 12, right: 8, left: -8, bottom: 0 }}
              >
                {chartGrid}
                <XAxis
                  dataKey="month"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                <Bar
                  dataKey="newPlaces"
                  name={t('explorer.newPlaces', 'New places')}
                  stackId="arrivals"
                  fill={CHART_COLORS[1]}
                  radius={[0, 0, 3, 3]}
                  hide={hiddenSeries?.isHidden('newPlaces')}
                />
                <Bar
                  dataKey="repeatArrivals"
                  name={t(
                    'explorer.monthly.repeatSeries',
                    'Repeat arrivals',
                  )}
                  stackId="arrivals"
                  fill={CHART_COLORS[0]}
                  radius={[3, 3, 0, 0]}
                  hide={hiddenSeries?.isHidden('repeatArrivals')}
                />
                <Line
                  type="monotone"
                  dataKey="cumulativePlaces"
                  name={t(
                    'explorer.monthly.cumulativeSeries',
                    'Cumulative places',
                  )}
                  stroke={CHART_COLORS[4]}
                  strokeWidth={2}
                  dot={false}
                  hide={hiddenSeries?.isHidden('cumulativePlaces')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )
        }
      </ChartContainer>
    </section>
  );
}
