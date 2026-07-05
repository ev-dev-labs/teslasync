import { useTranslation } from 'react-i18next';
import {
  Skeleton,
  PageHeaderSkeleton,
  StatGridSkeleton,
  ChartBlockSkeleton,
} from '@/components/feedback';

/**
 * Mirrors the DriveDetailPage layout while telemetry loads:
 * page header → hero gauges → 8 stat cards → overview chart →
 * 2 side-by-side charts (SoC + elevation), using the shared *Skeleton
 * building blocks.
 *
 * The whole placeholder is exposed to assistive tech as a single
 * `role="status" aria-busy` region with a descriptive, translated label
 * so screen readers announce "Loading drive detail" for the page as a
 * whole instead of relying on the generic per-block labels of the
 * individual skeleton primitives.
 */
export function DriveDetailSkeleton() {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-6 p-4"
      role="status"
      aria-busy="true"
      aria-label={t('driveDetail.loading', 'Loading drive detail')}
      data-testid="drive-detail-skeleton"
    >
      <PageHeaderSkeleton />
      <Skeleton className="h-36 rounded-xl" />
      <StatGridSkeleton cards={8} className="sm:grid-cols-4 lg:grid-cols-8" />
      <ChartBlockSkeleton height={320} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartBlockSkeleton height={280} />
        <ChartBlockSkeleton height={280} />
      </div>
    </div>
  );
}
