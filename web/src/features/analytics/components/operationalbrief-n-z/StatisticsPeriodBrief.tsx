import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useFormatting } from '@/hooks/useFormatting';
import { StatisticsSource } from '../statistics-modernization/StatisticsSource';
import type { PeriodStatistics } from '../statistics-modernization/PeriodStatistics';

export function StatisticsPeriodBrief({
  stats, loading, error, onRetry, fromKm, whPerKmToDisplay, distanceUnit, efficiencyUnit,
}: ComponentProps<typeof PeriodStatistics>) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { formatCurrency } = useFormatting();
  const avgDriveDistance = stats && stats.total_drives > 0
    ? (stats.total_distance ?? 0) / stats.total_drives : 0;
  const totals: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'statistics-total-distance', label: t('statistics.totalDistance', 'Total distance'),
      rawValue: stats ? (stats.total_distance ?? 0) * 1000 : null,
      display: { formatter: raw => ({ value: fmtInt(fromKm(raw / 1000)), unit: distanceUnit }) } },
    { metricId: 'count', occurrenceId: 'statistics-total-drives', label: t('statistics.totalDrives', 'Total drives'),
      rawValue: stats ? stats.total_drives ?? 0 : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'statistics-total-energy', label: t('statistics.totalEnergy', 'Total energy'),
      rawValue: stats ? (stats.energy_used ?? 0) * 1000 : null,
      display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kWh' }) } },
    { metricId: 'currency', occurrenceId: 'statistics-total-cost', label: t('statistics.totalCost', 'Total cost'),
      rawValue: stats ? stats.total_cost ?? 0 : null,
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) } },
    { metricId: 'mass', occurrenceId: 'statistics-co2', label: t('statistics.co2Saved', 'CO₂ saved'),
      rawValue: stats ? stats.co2_saved ?? 0 : null,
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kg' }) } },
  ];
  const averages: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'statistics-average-distance', label: t('statistics.avgDriveDistance', 'Avg drive distance'),
      rawValue: stats ? avgDriveDistance * 1000 : null,
      display: { formatter: raw => ({ value: fmtNumber(fromKm(raw / 1000)), unit: distanceUnit }) } },
    { metricId: 'efficiency', occurrenceId: 'statistics-average-efficiency', label: t('statistics.avgEfficiency', 'Avg efficiency'),
      rawValue: stats ? (stats.avg_efficiency ?? 0) / 1000 : null,
      display: { formatter: raw => ({ value: fmtNumber(whPerKmToDisplay(raw * 1000)), unit: efficiencyUnit }) } },
    { metricId: 'rate', occurrenceId: 'statistics-cost-per-km', label: t('statistics.costPerKm', 'Cost per km'),
      rawValue: stats && (stats.total_distance ?? 0) > 0 ? (stats.total_cost ?? 0) / stats.total_distance : null,
      context: t('statistics.brief.costDenominator', 'Recorded cost divided by source kilometres; not display-distance units.'),
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) } },
  ];
  const totalMetrics = useOperationalMetrics(totals);
  const averageMetrics = useOperationalMetrics(averages);
  const metadata = {
    compact: true,
    eyebrow: t('statistics.title', 'Statistics'),
    description: t('statistics.brief.periodDescription', 'Totals and averages from the period-statistics response; its observation bounds are not returned.'),
    statusLabel: stats ? error ? t('statistics.brief.retained', 'Retained statistics') : t('statistics.brief.available', 'Returned statistics')
      : loading ? t('statistics.brief.loading', 'Loading statistics') : t('statistics.brief.unavailable', 'Statistics unavailable'),
    statusTone: error ? 'warning' as const : 'neutral' as const,
    loading: loading && !stats,
    scope: t('statistics.brief.periodScope', 'Period-statistics source window; bounds unknown'),
    provenance: t('statistics.brief.periodSource', 'Period statistics'),
  };
  return <div className="space-y-3 sm:space-y-4">
    <OperationalBrief {...metadata} title={t('statistics.title', 'Statistics')} metrics={totalMetrics} testId="statistics-totals-brief" />
    <OperationalBrief {...metadata} title={t('statistics.averages', 'Averages')} metrics={averageMetrics} testId="statistics-averages-brief" />
    <StatisticsSource hasData={stats != null} loading={loading} error={error} onRetry={onRetry}
      skeleton={null}
      empty={<EmptyState title={t('statistics.noData', 'No statistics yet')}
        message={t('statistics.noDataMsg', 'This vehicle has no completed driving or charging history in the selected period.')}
        description={t('statistics.noDataDescription', 'Complete a drive or charging session, then return after TeslaSync has processed the activity.')}
        actionTo={{ label: t('statistics.viewDrives', 'View drives'), to: '/drives' }} />}
    >{null}</StatisticsSource>
  </div>;
}
