import { Layers3 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  Cell,
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
import { EmptyState, QueryError } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';

import type { ConsistencySummary } from '../../lib/efficiencyTarget';
import type { EfficiencyTargetSectionState } from './types';

interface TargetConsistencyChartProps {
  consistency: ConsistencySummary;
  state: EfficiencyTargetSectionState;
  className?: string;
}

export function TargetConsistencyChart({
  consistency,
  state,
  className,
}: TargetConsistencyChartProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      [
        {
          band: t('effTarget.status.onTarget', 'On target'),
          weeks: consistency.onTarget,
          color: CHART_COLORS[1],
        },
        {
          band: t('effTarget.status.nearMiss', 'Near miss'),
          weeks: consistency.nearMiss,
          color: CHART_COLORS[4],
        },
        {
          band: t('effTarget.status.offTrack', 'Off track'),
          weeks: consistency.offTrack,
          color: CHART_COLORS[3],
        },
      ].map((row) => ({
        ...row,
        share:
          consistency.gradedWeeks > 0
            ? Math.round((row.weeks / consistency.gradedWeeks) * 1000) / 10
            : 0,
      })),
    [consistency, t],
  );

  return (
    <section
      className={className}
      aria-label={t(
        'effTarget.sections.consistency',
        'Completed-week target consistency bands',
      )}
      data-testid="efficiency-target-consistency"
    >
      <ChartContainer
        className="h-full"
        title={t('effTarget.consistency.title', 'Target consistency')}
        subtitle={t(
          'effTarget.consistency.subtitle',
          'Completed weeks: on target ≤ goal, near miss ≤ 10% over, off track > 10% over.',
        )}
        ariaLabel={t(
          'effTarget.consistency.aria',
          'Completed week counts across on-target, near-miss, and off-track bands',
        )}
        loading={state.isLoading}
        empty={false}
        height={300}
        exportable={
          !state.error &&
          !state.isLoading &&
          consistency.gradedWeeks > 0
        }
        exportFilename="efficiency-target-consistency"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'band', label: t('effTarget.col.band', 'Band') },
          { key: 'weeks', label: t('effTarget.col.weeks', 'Completed weeks') },
          {
            key: 'share',
            label: t('effTarget.col.share', 'Share (%)'),
            format: (value) => `${fmtNumber(value, 1)}%`,
          },
        ]}
      >
        {state.error ? (
          <div className="flex h-full items-center justify-center">
            <QueryError error={state.error} onRetry={state.onRetry} />
          </div>
        ) : consistency.gradedWeeks === 0 ? (
          <EmptyState
            className="h-full"
            icon={<Layers3 className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'effTarget.consistency.empty',
              'No completed eligible weeks are available for consistency bands.',
            )}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 12, right: 4, left: -8, bottom: 0 }}
            >
              {chartGrid}
              <XAxis
                dataKey="band"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis
                allowDecimals={false}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value) =>
                      t('effTarget.consistency.weekValue', '{{count}} weeks', {
                        count: typeof value === 'number' ? value : 0,
                      })
                    }
                  />
                }
              />
              <Bar
                dataKey="weeks"
                name={t(
                  'effTarget.consistency.completedSeries',
                  'Completed weeks',
                )}
                radius={[4, 4, 0, 0]}
                maxBarSize={56}
              >
                {rows.map((row) => (
                  <Cell key={row.band} fill={row.color} fillOpacity={0.82} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
    </section>
  );
}
