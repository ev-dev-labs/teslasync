import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { StatisticsSource } from '../statistics-modernization/StatisticsSource';
import type { MileageStatistics } from '../statistics-modernization/MileageStatistics';

export function StatisticsMileageBrief({
  query, fromKm, distanceUnit,
}: ComponentProps<typeof MileageStatistics>) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const mileage = query.data;
  const metrics: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'statistics-lifetime-mileage', label: t('statistics.totalMileage', 'Total distance'),
      rawValue: mileage ? (mileage.lifetime_km ?? 0) * 1000 : null,
      context: t('statistics.brief.lifetime', 'Lifetime mileage'),
      display: { formatter: raw => ({ value: fmtInt(fromKm(raw / 1000)), unit: distanceUnit }) } },
    { metricId: 'distance', occurrenceId: 'statistics-daily-mileage', label: t('statistics.dailyAvg', 'Daily average'),
      rawValue: mileage ? ((mileage.last_30d_km ?? 0) / 30) * 1000 : null,
      context: t('statistics.brief.daily', 'Last 30 days divided by 30'),
      display: { formatter: raw => ({ value: fmtNumber(fromKm(raw / 1000)), unit: distanceUnit }) } },
    { metricId: 'count', occurrenceId: 'statistics-lifetime-drives', label: t('statistics.totalDrives', 'Total drives'),
      rawValue: mileage ? mileage.drive_count_lifetime ?? 0 : null,
      context: t('statistics.brief.lifetime', 'Lifetime mileage'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'statistics-yearly-projection', label: t('statistics.yearlyProjection', 'Yearly projection'),
      rawValue: mileage ? (((mileage.last_30d_km ?? 0) / 30) * 365) * 1000 : null,
      context: t('statistics.brief.projection', 'Last-30-day daily average multiplied by 365; projection, not a measured year'),
      display: { formatter: raw => ({ value: fmtInt(fromKm(raw / 1000)), unit: distanceUnit }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <>
    <OperationalBrief compact title={t('statistics.mileage', 'Mileage summary')} testId="statistics-mileage-brief"
      eyebrow={t('statistics.title', 'Statistics')}
      description={t('statistics.brief.mileageDescription', 'Lifetime distance and drive counts alongside a last-30-day average and its yearly projection.')}
      metrics={operationalMetrics} loading={query.isLoading && !mileage}
      statusLabel={mileage ? query.error ? t('statistics.brief.retained', 'Retained statistics') : t('statistics.brief.available', 'Returned statistics')
        : query.isLoading ? t('statistics.brief.loading', 'Loading statistics') : t('statistics.brief.unavailable', 'Statistics unavailable')}
      statusTone={query.error ? 'warning' : 'neutral'}
      scope={t('statistics.brief.mixed', 'Mixed lifetime and last-30-day windows')}
      provenance={t('statistics.mileage', 'Mileage summary')} />
    <StatisticsSource hasData={mileage != null} loading={query.isLoading} error={query.error}
      onRetry={() => { void query.refetch(); }} skeleton={null}
      empty={<EmptyState message={t('statistics.noMileage', 'No mileage data available')}
        description={t('statistics.noMileageDescription', 'Distance totals and projections appear after the first completed drive is recorded.')}
        actionTo={{ label: t('statistics.viewDrives', 'View drives'), to: '/drives' }} className="py-8" />}
    >{null}</StatisticsSource>
  </>;
}
