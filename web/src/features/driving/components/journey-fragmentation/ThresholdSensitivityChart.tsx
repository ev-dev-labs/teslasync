import { Bar, BarChart, ChartContainer, ChartLegend, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick, chartGrid, CHART_COLORS } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

import { JourneyFragmentationSectionProps } from './_types';
import { PendingEvidence } from './PendingEvidence';

export function ThresholdSensitivityChart({ result, state, loading = false }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const data = result.sensitivity.map((point) => ({
    threshold: t('journeyFragmentation.gapMinutes', '{{count}} min', {
      count: point.thresholdMin,
      replace: { count: fmtInt(point.thresholdMin) },
    }),
    journeys: point.journeyCount,
    linkedPairs: point.linkedPairs,
  }));
  return (
    <ChartContainer
      title={t('journeyFragmentation.sensitivity.title', 'Threshold sensitivity')}
      subtitle={t('journeyFragmentation.sensitivity.subtitle', 'The same continuity rules recomputed at fixed 30, 60, 120, and 240 minute thresholds.')}
      ariaLabel={t('journeyFragmentation.sensitivity.aria', 'Bar chart comparing observed journeys and linked pairs across fixed parking thresholds')}
      ariaDescription={t('journeyFragmentation.sensitivity.description', 'This comparison changes only the maximum parking gap; it does not expand the returned history window.')}
      loading={loading}
      empty={(!state || state.hasData) && !loading && result.includedDrives === 0}
      data={state && !state.hasData ? undefined : data}
      dataColumns={[
        { key: 'threshold', label: t('journeyFragmentation.sensitivity.threshold', 'Threshold') },
        { key: 'journeys', label: t('journeyFragmentation.sensitivity.journeys', 'Journeys') },
        { key: 'linkedPairs', label: t('journeyFragmentation.sensitivity.pairs', 'Linked pairs') },
      ]}
      chartKey="journey-fragmentation-threshold-sensitivity"
      height={280}
    >
      {({ hiddenSeries }) => (
        state && !state.hasData ? <PendingEvidence state={state} loading={loading} /> : result.includedDrives === 0 ? (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ message={t('journeyFragmentation.chart.noData', 'No included journey data is available yet.')} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              {chartGrid}
              <XAxis dataKey="threshold" tick={axisTick} />
              <YAxis allowDecimals={false} tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              <Bar dataKey="journeys" name={t('journeyFragmentation.sensitivity.journeys', 'Journeys')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('journeys')} />
              <Bar dataKey="linkedPairs" name={t('journeyFragmentation.sensitivity.pairs', 'Linked pairs')} fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('linkedPairs')} />
            </BarChart>
          </ResponsiveContainer>
        )
      )}
    </ChartContainer>
  );
}
