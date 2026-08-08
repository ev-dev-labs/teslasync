import { Bar, BarChart, ChartContainer, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick, chartGrid, CHART_COLORS } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';

import { JourneyFragmentationSectionProps } from './_types';

export function StartProfileChart({ result, loading = false }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const data = result.startTwoHourProfile.map((point) => ({ period: point.label, journeys: point.journeyCount }));
  return (
    <ChartContainer
      title={t('journeyFragmentation.startProfile.title', 'Local two-hour journey-start profile')}
      subtitle={t('journeyFragmentation.startProfile.subtitle', 'Journey starts grouped in the vehicle timezone {{timeZone}}.', { timeZone: result.timeZone })}
      ariaLabel={t('journeyFragmentation.startProfile.aria', 'Bar chart of observed journey starts by local two-hour period')}
      loading={loading}
      empty={!loading && data.length === 0}
      data={data}
      dataColumns={[
        { key: 'period', label: t('journeyFragmentation.startProfile.period', 'Local period') },
        { key: 'journeys', label: t('journeyFragmentation.startProfile.journeys', 'Journeys') },
      ]}
      height={280}
    >
      {data.length === 0 ? (
        <EmptyState message={t('journeyFragmentation.profile.empty', 'No local journey-start profile is available yet.')} />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            {chartGrid}
            <XAxis dataKey="period" tick={axisTick} />
            <YAxis allowDecimals={false} tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="journeys" name={t('journeyFragmentation.startProfile.journeys', 'Journeys')} fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
