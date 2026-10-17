import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { DataSourceNotice, EmptyState, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
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
  const source = useDataState({ ...query, data: mileage ?? undefined }, { provenance: 'historical' });
  const loading = query.isLoading && !source.isRefreshBlocked;
  const label = t('statistics.mileage', 'Mileage summary');
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
    <StaleRefreshWarning state={source} label={label} />
    <OperationalBrief compact title={label} testId="statistics-mileage-brief"
      eyebrow={t('statistics.title', 'Statistics')}
      description={t('statistics.brief.mileageDescription', 'Lifetime distance and drive counts alongside a last-30-day average and its yearly projection.')}
      metrics={operationalMetrics} loading={loading && !source.hasData}
      statusLabel={source.isRefreshBlocked ? t('dataSources.status.paused', 'Refresh paused')
        : source.isRefreshing ? t('dataSources.status.refreshing', 'Refreshing')
        : source.hasData ? source.refreshError ? t('statistics.brief.retained', 'Retained statistics') : t('statistics.brief.available', 'Returned statistics')
        : loading ? t('statistics.brief.loading', 'Loading statistics') : t('statistics.brief.unavailable', 'Statistics unavailable')}
      statusTone={source.refreshError || source.isRefreshBlocked ? 'warning' : 'neutral'}
      scope={t('statistics.brief.mixed', 'Mixed lifetime and last-30-day windows')}
      provenance={t('statistics.mileage', 'Mileage summary')} />
    <StatisticsSource hasData={source.hasData} loading={loading} error={source.fatalError}
      onRetry={() => { void query.refetch(); }} skeleton={null}
      empty={source.isRefreshBlocked
        ? <DataSourceNotice sources={[{ id: 'statistics-mileage', label, query: { ...query, data: mileage ?? undefined } }]} />
        : <EmptyState message={t('statistics.noMileage', 'No mileage data available')}
        description={t('statistics.noMileageDescription', 'Distance totals and projections appear after the first completed drive is recorded.')}
        actionTo={{ label: t('statistics.viewDrives', 'View drives'), to: '/drives' }} className="py-8" />}
    >{null}</StatisticsSource>
  </>;
}
