import { Bar, BarChart, ChartContainer, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis, chartGrid, axisTick, CHART_COLORS } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';

import { JourneyFragmentationSectionProps } from './_types';

export function ChainLengthChart({ result, loading = false }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const data = result.chainLengthDistribution.map((point) => ({
    fragments: String(point.fragments),
    journeys: point.journeyCount,
  }));
  const summary = t(
    'journeyFragmentation.chainLength.summary',
    'Median {{median}} fragments; p90 {{p90}} fragments.',
    {
      median: result.chainFragmentSummary.median == null ? '—' : result.chainFragmentSummary.median.toFixed(1),
      p90: result.chainFragmentSummary.p90 == null ? '—' : result.chainFragmentSummary.p90.toFixed(1),
    },
  );
  return (
    <ChartContainer
      title={t('journeyFragmentation.chainLength.title', 'Chain-length distribution')}
      subtitle={`${t('journeyFragmentation.chainLength.subtitle', 'Observed journeys grouped by included drive count.')} ${summary}`}
      ariaLabel={t('journeyFragmentation.chainLength.aria', 'Bar chart of observed journey count by drive fragments')}
      loading={loading}
      empty={!loading && data.length === 0}
      data={data}
      dataColumns={[
        { key: 'fragments', label: t('journeyFragmentation.chainLength.fragments', 'Drive fragments') },
        { key: 'journeys', label: t('journeyFragmentation.chainLength.journeys', 'Observed journeys') },
      ]}
      height={280}
    >
      {data.length === 0 ? (
        <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ message={t('journeyFragmentation.chart.noData', 'No included journey data is available yet.')} />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            {chartGrid}
            <XAxis dataKey="fragments" tick={axisTick} />
            <YAxis allowDecimals={false} tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="journeys" name={t('journeyFragmentation.chainLength.journeys', 'Observed journeys')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
