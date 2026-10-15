import { useTranslation } from 'react-i18next';
import { StatGroup, type StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { MileageStats } from '@/types/analytics';

interface MileageSummaryProps {
  stats: MileageStats | undefined;
  loading: boolean;
  retained: boolean;
}

/** The mileage API's km-shaped DTO is preserved. Only this render boundary
 * adapts its quantities to the shared formatter's canonical meter input.
 * Per-occurrence precision and number locale match the former KPI cards. */
export function MileageSummary({ stats, loading, retained }: MileageSummaryProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { precision, locale } = useNumberFormatting();
  const dailyAvgKm = (stats?.last_30d_km ?? 0) / 30;
  const missingReason = t('mileage.summary.unavailable', 'Mileage summary has not been supplied.');
  const asMeters = (km: number | undefined) => km != null ? km * 1000 : undefined;
  const display = (digits: number) => ({
    precision: digits,
    units: { distance: unitPrefs.distance, locale },
  });
  const metrics: StatMetric[] = [
    {
      metricId: 'distance', occurrenceId: 'mileage-total-distance',
      label: t('mileage.totalDistance', 'Total distance'),
      rawValue: asMeters(stats?.lifetime_km), display: display(0), missingReason,
      description: t('mileage.summary.recordedDistance', 'Distance from the lifetime rollup of recorded drives, not the vehicle odometer. Recording completeness is unknown.'),
    },
    {
      metricId: 'count', occurrenceId: 'mileage-total-drives',
      label: t('mileage.totalDrives', 'Total drives'),
      rawValue: stats?.drive_count_lifetime, display: display(0), missingReason,
      description: t('mileage.summary.recordedDrives', 'Drive count from the lifetime rollup of recorded drives. Recording completeness is unknown.'),
    },
    {
      metricId: 'distance', occurrenceId: 'mileage-daily-average',
      label: t('mileage.dailyAvg30d', 'Daily avg (30d)'),
      rawValue: stats?.last_30d_km != null ? dailyAvgKm * 1000 : undefined, display: display(precision), missingReason,
      description: t('mileage.summary.dailyMethod', 'Recorded distance in the last 30 days divided by 30, including days without drives.'),
    },
    {
      metricId: 'distance', occurrenceId: 'mileage-annual-projection',
      label: t('mileage.annualProjection', 'Annual projection'),
      rawValue: stats?.last_30d_km != null ? (dailyAvgKm * 365) * 1000 : undefined, display: display(0), missingReason,
      description: t('mileage.summary.projectionMethod', 'The last-30-day daily average multiplied by 365. This is a projection, not measured annual distance.'),
    },
    {
      metricId: 'distance', occurrenceId: 'mileage-last-seven-days',
      label: t('mileage.last7Days', 'Last 7 days'),
      rawValue: asMeters(stats?.last_7d_km), display: display(precision), missingReason,
      description: t('mileage.summary.sevenDayMethod', 'Recorded drive distance in the server’s fixed trailing 7-day window.'),
    },
    {
      metricId: 'distance', occurrenceId: 'mileage-last-year',
      label: t('mileage.last365Days', 'Last 365 days'),
      rawValue: asMeters(stats?.last_365d_km), display: display(0), missingReason,
      description: t('mileage.summary.yearMethod', 'Recorded drive distance in the server’s fixed trailing 365-day window.'),
    },
  ];

  return (
    <div className="min-w-0">
      {loading && !stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} height={92} className="rounded-xl" />
          ))}
        </div>
      ) : stats ? (
        <StatGroup
          id="mileage-summary"
          metrics={metrics}
          retained={retained}
          period={{
            kind: 'unknown',
            label: t('mileage.summary.periods', 'Recorded lifetime · trailing 30-day average · annual projection · trailing 7 / 365 days'),
            reason: t('mileage.summary.completeness', 'These are separate server-defined periods, not a shared analysis range. Recording completeness is not reported.'),
          }}
        />
      ) : (
        <EmptyState
          message={missingReason}
          actionTo={{ label: t('statistics.viewDrives', 'View drives'), to: '/drives' }}
        />
      )}
    </div>
  );
}
