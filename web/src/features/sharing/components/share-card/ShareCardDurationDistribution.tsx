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

const BAR_COLOR = '#a78bfa';

export function ShareCardDurationDistribution({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const labels = useMemo<Record<string, string>>(
    () => ({
      under15min: t('shareCard.durationBands.under15', 'Under {{max}}', {
        max: display.formatDuration(900),
      }),
      '15to30min': t('shareCard.durationBands.15to30', '{{min}}–{{max}}', {
        min: display.formatDuration(900),
        max: display.formatDuration(1_800),
      }),
      '30to60min': t('shareCard.durationBands.30to60', '{{min}}–{{max}}', {
        min: display.formatDuration(1_800),
        max: display.formatDuration(3_600),
      }),
      '60minPlus': t('shareCard.durationBands.60plus', '{{min}} and over', {
        min: display.formatDuration(3_600),
      }),
    }),
    [display, t],
  );
  const rows = useMemo(
    () => analysis.durationDistribution.map((bucket) => ({
      band: bucket.id,
      label: labels[bucket.id] ?? bucket.id,
      driveCount: bucket.count,
      durationS: bucket.sum,
    })),
    [analysis.durationDistribution, labels],
  );
  const exportRows = useMemo(
    () => rows.map((row) => ({
      band: row.band,
      drive_count: row.driveCount,
      duration_s: row.durationS,
    })),
    [rows],
  );
  const hasChartEvidence = state.enabled
    && state.hasData
    && analysis.aggregates.durationS.supportRows > 0;

  return (
    <section
      data-testid="share-card-duration-distribution"
      aria-label={t('shareCard.durationDistribution.sectionAria', 'Measured duration distribution')}
    >
      <ChartContainer
        title={t('shareCard.durationDistribution.title', 'Duration distribution')}
        subtitle={t(
          'shareCard.durationDistribution.subtitle',
          'Fixed canonical-second bands with explicit duration support.',
        )}
        ariaLabel={t(
          'shareCard.durationDistribution.aria',
          'Eligible drive counts grouped into measured duration bands',
        )}
        ariaDescription={t(
          'shareCard.durationDistribution.description',
          'Rows without a valid nonnegative duration are excluded and reported in field coverage.',
        )}
        exportable={hasChartEvidence}
        exportFilename="share-card-duration-distribution"
        exportData={hasChartEvidence ? exportRows : undefined}
        data={hasChartEvidence ? rows : []}
        dataColumns={[
          { key: 'label', label: t('shareCard.durationDistribution.band', 'Duration band') },
          { key: 'driveCount', label: t('shareCard.durationDistribution.count', 'Drive count') },
          {
            key: 'durationS',
            label: t('shareCard.durationDistribution.total', 'Measured duration'),
            format: (value) => display.formatDuration(
              typeof value === 'number' ? value : null,
            ),
          },
        ]}
        height={320}
      >
        <ShareCardSectionBody state={state} skeletonHeight={280}>
          {analysis.aggregates.durationS.supportRows > 0 ? (
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
                  name={t('shareCard.durationDistribution.count', 'Drive count')}
                  fill={BAR_COLOR}
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              message={t(
                'shareCard.durationDistribution.empty',
                'No eligible row has a valid measured duration.',
              )}
            />
          )}
        </ShareCardSectionBody>
      </ChartContainer>
    </section>
  );
}
