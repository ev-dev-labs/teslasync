import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartContainer,
  ChartTooltip,
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

const BAR_COLOR = '#22d3ee';

export function ShareCardDistanceDistribution({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const labels = useMemo<Record<string, string>>(
    () => ({
      under5km: t('shareCard.distanceBands.under5', 'Under {{max}}', {
        max: display.formatDistance(5_000),
      }),
      '5to20km': t('shareCard.distanceBands.5to20', '{{min}}–{{max}}', {
        min: display.formatDistance(5_000),
        max: display.formatDistance(20_000),
      }),
      '20to50km': t('shareCard.distanceBands.20to50', '{{min}}–{{max}}', {
        min: display.formatDistance(20_000),
        max: display.formatDistance(50_000),
      }),
      '50kmPlus': t('shareCard.distanceBands.50plus', '{{min}} and over', {
        min: display.formatDistance(50_000),
      }),
    }),
    [display, t],
  );
  const rows = useMemo(
    () => analysis.distanceDistribution.map((bucket) => ({
      band: bucket.id,
      label: labels[bucket.id] ?? bucket.id,
      driveCount: bucket.count,
      distanceM: bucket.sum,
    })),
    [analysis.distanceDistribution, labels],
  );
  const exportRows = useMemo(
    () => rows.map((row) => ({
      band: row.band,
      drive_count: row.driveCount,
      distance_m: row.distanceM,
    })),
    [rows],
  );
  const hasChartEvidence = state.enabled
    && state.hasData
    && analysis.aggregates.distanceM.supportRows > 0;

  return (
    <section
      data-testid="share-card-distance-distribution"
      aria-label={t('shareCard.distanceDistribution.sectionAria', 'Measured distance distribution')}
    >
      <ChartContainer
        title={t('shareCard.distanceDistribution.title', 'Distance distribution')}
        subtitle={t(
          'shareCard.distanceDistribution.subtitle',
          'Fixed canonical-SI bands with thresholds converted to display units.',
        )}
        ariaLabel={t(
          'shareCard.distanceDistribution.aria',
          'Eligible drive counts grouped into measured distance bands',
        )}
        ariaDescription={t(
          'shareCard.distanceDistribution.description',
          'Rows without a valid nonnegative distance are excluded and reported in field coverage.',
        )}
        exportable={hasChartEvidence}
        exportFilename="share-card-distance-distribution"
        exportData={hasChartEvidence ? exportRows : undefined}
        data={hasChartEvidence ? rows : []}
        dataColumns={[
          { key: 'label', label: t('shareCard.distanceDistribution.band', 'Distance band') },
          { key: 'driveCount', label: t('shareCard.distanceDistribution.count', 'Drive count') },
          {
            key: 'distanceM',
            label: t('shareCard.distanceDistribution.total', 'Measured distance'),
            format: (value) => display.formatDistance(
              typeof value === 'number' ? value : null,
            ),
          },
        ]}
        height={320}
      >
        <ShareCardSectionBody state={state} skeletonHeight={280}>
          {analysis.aggregates.distanceM.supportRows > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
              >
                {chartGrid}
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis
                  allowDecimals={false}
                  width={42}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={(
                    <ChartTooltip
                      valueFormatter={(value) =>
                        display.formatNumber(Number(value), 0)}
                    />
                  )}
                />
                <Bar
                  dataKey="driveCount"
                  name={t('shareCard.distanceDistribution.count', 'Drive count')}
                  fill={BAR_COLOR}
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              message={t(
                'shareCard.distanceDistribution.empty',
                'No eligible row has a valid measured distance.',
              )}
            />
          )}
        </ShareCardSectionBody>
      </ChartContainer>
    </section>
  );
}
