import { Bar, BarChart, ChartContainer, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick, chartGrid, CHART_COLORS } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';

import { JourneyFragmentationSectionProps } from './_types';

export function WeekdayProfileChart({ result, loading = false }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const weekdayLabels = [
    t('journeyFragmentation.weekday.sunday', 'Sunday'),
    t('journeyFragmentation.weekday.monday', 'Monday'),
    t('journeyFragmentation.weekday.tuesday', 'Tuesday'),
    t('journeyFragmentation.weekday.wednesday', 'Wednesday'),
    t('journeyFragmentation.weekday.thursday', 'Thursday'),
    t('journeyFragmentation.weekday.friday', 'Friday'),
    t('journeyFragmentation.weekday.saturday', 'Saturday'),
  ];
  const data = result.weekdayProfile.map((point) => ({
    weekday: weekdayLabels[Number(point.key)] ?? point.key,
    journeys: point.journeyCount,
  }));
  return (
    <ChartContainer
      title={t('journeyFragmentation.weekday.title', 'Weekday journey-start profile')}
      subtitle={t('journeyFragmentation.weekday.subtitle', 'Local weekday counts use the normalized vehicle timezone.')}
      ariaLabel={t('journeyFragmentation.weekday.aria', 'Bar chart of observed journey starts by local weekday')}
      loading={loading}
      empty={!loading && data.length === 0}
      data={data}
      dataColumns={[
        { key: 'weekday', label: t('journeyFragmentation.weekday.day', 'Weekday') },
        { key: 'journeys', label: t('journeyFragmentation.weekday.journeys', 'Journeys') },
      ]}
      height={280}
    >
      {data.length === 0 ? (
        <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ message={t('journeyFragmentation.profile.empty', 'No local journey-start profile is available yet.')} />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            {chartGrid}
            <XAxis dataKey="weekday" tick={axisTick} />
            <YAxis allowDecimals={false} tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="journeys" name={t('journeyFragmentation.weekday.journeys', 'Journeys')} fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
