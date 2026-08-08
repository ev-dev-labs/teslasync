import { useMemo } from 'react';
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
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

const DISTANCE_COLOR = '#22d3ee';
const ENERGY_COLOR = '#f59e0b';
const COUNT_COLOR = '#a78bfa';

export function ShareCardMonthlyTrend({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const distanceSeries = t('shareCard.monthly.distanceSeries', 'Distance');
  const energySeries = t('shareCard.monthly.energySeries', 'Energy');
  const countSeries = t('shareCard.monthly.countSeries', 'Drive count');
  const rows = useMemo(
    () => analysis.monthly.map((bucket) => ({
      month: bucket.month,
      label: display.formatMonth(bucket.month),
      driveCount: bucket.driveCount,
      distance: bucket.distanceM != null
        ? display.distanceValue(bucket.distanceM)
        : null,
      distanceM: bucket.distanceM,
      energy: bucket.energyWh != null
        ? display.energyValue(bucket.energyWh)
        : null,
      energyWh: bucket.energyWh,
    })),
    [analysis.monthly, display],
  );
  const exportRows = useMemo(
    () => rows.map((row) => ({
      month: row.month,
      drive_count: row.driveCount,
      distance_m: row.distanceM,
      energy_wh: row.energyWh,
    })),
    [rows],
  );
  const hasChartEvidence = state.enabled
    && state.hasData
    && analysis.eligibleRows > 0;

  return (
    <section
      data-testid="share-card-monthly-trend"
      aria-label={t('shareCard.monthly.sectionAria', 'Selected-window monthly trend section')}
    >
      <ChartContainer
        title={t('shareCard.monthly.title', 'Monthly distance, energy, and count trend')}
        subtitle={t(
          analysis.historyCapReached
            ? 'shareCard.monthly.cappedSubtitle'
            : 'shareCard.monthly.subtitle',
          analysis.historyCapReached
            ? 'Only months represented by returned evidence are shown; truncated months are unknown, never zero.'
            : 'Vehicle-timezone months across the selected calendar window; zero-count months remain visible.',
        )}
        ariaLabel={t(
          'shareCard.monthly.aria',
          'Monthly selected-window drive count, measured distance, and measured energy',
        )}
        ariaDescription={t(
          'shareCard.monthly.description',
          'Distance and energy points are null when no eligible row measured that field.',
        )}
        exportable={hasChartEvidence}
        exportFilename="share-card-monthly-evidence"
        exportData={hasChartEvidence ? exportRows : undefined}
        data={hasChartEvidence ? rows : []}
        dataColumns={[
          { key: 'label', label: t('shareCard.monthly.month', 'Month') },
          { key: 'driveCount', label: countSeries },
          {
            key: 'distanceM',
            label: distanceSeries,
            format: (value) => display.formatDistance(
              typeof value === 'number' ? value : null,
            ),
          },
          {
            key: 'energyWh',
            label: energySeries,
            format: (value) => display.formatEnergy(
              typeof value === 'number' ? value : null,
            ),
          },
        ]}
        chartKey="share-card-monthly"
        height={360}
      >
        {({ hiddenSeries }) => (
          <ShareCardSectionBody state={state} skeletonHeight={320}>
            {analysis.eligibleRows > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={rows}
                  margin={{ top: 12, right: 16, bottom: 4, left: 4 }}
                >
                  {chartGrid}
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="distance"
                    width={52}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => display.formatNumber(value, 0)}
                  />
                  <YAxis
                    yAxisId="energy"
                    orientation="right"
                    width={52}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => display.formatNumber(value, 0)}
                  />
                  <YAxis yAxisId="count" hide />
                  <Tooltip
                    content={(
                      <ChartTooltip
                        valueFormatter={(value, name) =>
                          name === countSeries
                            ? display.formatNumber(Number(value), 0)
                            : name === energySeries
                              ? t('shareCard.units.energyDisplay', '{{value}} {{unit}}', {
                                value: display.formatNumber(Number(value), 1),
                                unit: display.energyUnit,
                              })
                              : t('shareCard.units.distanceDisplay', '{{value}} {{unit}}', {
                                value: display.formatNumber(Number(value), 1),
                                unit: display.distanceUnit,
                              })}
                      />
                    )}
                  />
                  <ChartLegend />
                  <Bar
                    yAxisId="distance"
                    dataKey="distance"
                    name={distanceSeries}
                    fill={DISTANCE_COLOR}
                    radius={[5, 5, 0, 0]}
                    hide={hiddenSeries?.isHidden('distance')}
                  />
                  <Line
                    yAxisId="energy"
                    dataKey="energy"
                    name={energySeries}
                    stroke={ENERGY_COLOR}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                    hide={hiddenSeries?.isHidden('energy')}
                  />
                  <Line
                    yAxisId="count"
                    dataKey="driveCount"
                    name={countSeries}
                    stroke={COUNT_COLOR}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    hide={hiddenSeries?.isHidden('driveCount')}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                message={t(
                  'shareCard.monthly.empty',
                  'No eligible drives support a selected-window monthly trend.',
                )}
              />
            )}
          </ShareCardSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
