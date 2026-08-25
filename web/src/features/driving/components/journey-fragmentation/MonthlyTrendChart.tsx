import { Bar, BarChart, ChartContainer, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick, chartGrid, CHART_COLORS } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';

import { JourneyFragmentationSectionProps } from './_types';

export function MonthlyTrendChart({ result, loading = false }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const data = result.monthlyProfile.map((point) => ({ month: point.label, journeys: point.journeyCount }));
  return (
    <ChartContainer
      title={t('journeyFragmentation.monthly.title', 'Monthly observed trend')}
      subtitle={t('journeyFragmentation.monthly.subtitle', 'Journey starts grouped by local calendar month; sparse months remain sparse.')}
      ariaLabel={t('journeyFragmentation.monthly.aria', 'Bar chart of observed journey starts by local calendar month')}
      loading={loading}
      empty={!loading && data.length === 0}
      data={data}
      dataColumns={[
        { key: 'month', label: t('journeyFragmentation.monthly.month', 'Month') },
        { key: 'journeys', label: t('journeyFragmentation.monthly.journeys', 'Journeys') },
      ]}
      height={280}
    >
      {data.length === 0 ? (
        <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ message={t('journeyFragmentation.monthly.empty', 'No local monthly trend is available yet.')} />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            {chartGrid}
            <XAxis dataKey="month" tick={axisTick} />
            <YAxis allowDecimals={false} tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="journeys" name={t('journeyFragmentation.monthly.journeys', 'Journeys')} fill={CHART_COLORS[5]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
