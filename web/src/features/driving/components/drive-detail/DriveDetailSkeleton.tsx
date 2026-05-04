import {
  Skeleton,
  PageHeaderSkeleton,
  StatGridSkeleton,
  ChartBlockSkeleton,
} from '@/components/feedback';

/**
 * Mirrors the DriveDetailPage layout while telemetry loads:
 * page header → hero gauges → 8 stat cards → overview chart →
 * 2 side-by-side charts (SoC + elevation). Phase-45 / Prompt 18 migrated
 * the inline boxes to the shared *Skeleton building blocks.
 */
export function DriveDetailSkeleton() {
  return (
    <div className="space-y-6 p-4" data-testid="drive-detail-skeleton">
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
