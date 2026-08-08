import { Bar, BarChart, ChartContainer, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick, chartGrid, CHART_COLORS } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';

import { JourneyFragmentationSectionProps } from './_types';

export function StopoverGapChart({ result, loading = false }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const data = result.gapHistogram.map((point) => ({
    gap: point.upperBoundMin == null
      ? `${point.lowerBoundMin}+`
      : `${point.lowerBoundMin}–${point.upperBoundMin}`,
    pairs: point.gapCount,
  }));
  const summary = t(
    'journeyFragmentation.gap.summary',
    'Median {{median}} min; p90 {{p90}} min across {{count}} linked gaps.',
    {
      median: result.linkedGapSummary.median == null ? '—' : result.linkedGapSummary.median.toFixed(1),
      p90: result.linkedGapSummary.p90 == null ? '—' : result.linkedGapSummary.p90.toFixed(1),
      count: result.linkedGapSummary.count,
    },
  );
  return (
    <ChartContainer
      title={t('journeyFragmentation.gap.title', 'Stopover-gap distribution')}
      subtitle={`${t('journeyFragmentation.gap.subtitle', 'Linked pair gaps in minutes; the selected threshold is applied to continuity.')} ${summary}`}
      ariaLabel={t('journeyFragmentation.gap.aria', 'Bar chart of linked stopover gaps by minute band')}
      loading={loading}
      empty={!loading && result.linkedGapSummary.count === 0}
      data={data}
      dataColumns={[
        { key: 'gap', label: t('journeyFragmentation.gap.band', 'Gap band') },
        { key: 'pairs', label: t('journeyFragmentation.gap.pairs', 'Linked pairs') },
      ]}
      height={280}
    >
      {result.linkedGapSummary.count === 0 ? (
        <EmptyState message={t('journeyFragmentation.gap.empty', 'No linked stopover pairs are available for this threshold.')} />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            {chartGrid}
            <XAxis dataKey="gap" tick={axisTick} />
            <YAxis allowDecimals={false} tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="pairs" name={t('journeyFragmentation.gap.pairs', 'Linked pairs')} fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
