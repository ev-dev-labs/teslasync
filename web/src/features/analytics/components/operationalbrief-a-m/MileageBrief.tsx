import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { MileageStats } from '@/types/analytics';

export function MileageBrief({ stats, loading, retained, fatalError = false }: {
  stats: MileageStats | undefined; loading: boolean; retained: boolean; fatalError?: boolean;
}) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { precision, locale } = useNumberFormatting();
  const dailyAvgKm = (stats?.last_30d_km ?? 0) / 30;
  const missingReason = t('mileage.summary.unavailable', 'Mileage summary has not been supplied.');
  const asMeters = (km: number | undefined) => km != null ? km * 1000 : undefined;
  const display = (digits: number) => ({ precision: digits, units: { distance: unitPrefs.distance, locale } });
  const metrics: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'mileage-total-distance', label: t('mileage.totalDistance', 'Total distance'),
      rawValue: asMeters(stats?.lifetime_km), display: display(0), missingReason,
      description: t('mileage.summary.recordedDistance', 'Distance from the lifetime rollup of recorded drives, not the vehicle odometer. Recording completeness is unknown.') },
    { metricId: 'count', occurrenceId: 'mileage-total-drives', label: t('mileage.totalDrives', 'Total drives'),
      rawValue: stats?.drive_count_lifetime, display: display(0), missingReason,
      description: t('mileage.summary.recordedDrives', 'Drive count from the lifetime rollup of recorded drives. Recording completeness is unknown.') },
    { metricId: 'distance', occurrenceId: 'mileage-daily-average', label: t('mileage.dailyAvg30d', 'Daily avg (30d)'),
      rawValue: stats?.last_30d_km != null ? dailyAvgKm * 1000 : undefined, display: display(precision), missingReason,
      description: t('mileage.summary.dailyMethod', 'Recorded distance in the last 30 days divided by 30, including days without drives.') },
    { metricId: 'distance', occurrenceId: 'mileage-annual-projection', label: t('mileage.annualProjection', 'Annual projection'),
      rawValue: stats?.last_30d_km != null ? dailyAvgKm * 365 * 1000 : undefined, display: display(0), missingReason,
      description: t('mileage.summary.projectionMethod', 'The last-30-day daily average multiplied by 365. This is a projection, not measured annual distance.') },
    { metricId: 'distance', occurrenceId: 'mileage-last-seven-days', label: t('mileage.last7Days', 'Last 7 days'),
      rawValue: asMeters(stats?.last_7d_km), display: display(precision), missingReason,
      description: t('mileage.summary.sevenDayMethod', 'Recorded drive distance in the server’s fixed trailing 7-day window.') },
    { metricId: 'distance', occurrenceId: 'mileage-last-year', label: t('mileage.last365Days', 'Last 365 days'),
      rawValue: asMeters(stats?.last_365d_km), display: display(0), missingReason,
      description: t('mileage.summary.yearMethod', 'Recorded drive distance in the server’s fixed trailing 365-day window.') },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const completeness = t('mileage.summary.completeness', 'These are separate server-defined periods, not a shared analysis range. Recording completeness is not reported.');
  return <div id="mileage-summary">
    <OperationalBrief compact metrics={operationalMetrics} loading={loading && !stats}
      eyebrow={t('mileage.title', 'Mileage')}
      title={t('mileage.brief.title', 'Recorded mileage summary')}
      description={completeness}
      statusLabel={loading && !stats ? t('analytics.brief.loading', 'Loading evidence')
        : !stats ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : retained ? t('analytics.brief.retained', 'Retained evidence') : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={!stats || retained ? 'warning' : 'neutral'}
      scope={<span>{t('mileage.summary.periods', 'Recorded lifetime · trailing 30-day average · annual projection · trailing 7 / 365 days')}</span>}
      provenance={completeness}
    />
    {!loading && !stats && !fatalError && <EmptyState message={missingReason}
      actionTo={{ label: t('statistics.viewDrives', 'View drives'), to: '/drives' }} />}
  </div>;
}
