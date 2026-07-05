import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

interface LoadingSkeletonProps {
  /** KPI summary tiles rendered in the top metric band. Defaults to 6. */
  kpiCount?: number;
  /** Secondary stat tiles rendered in the bottom band. Defaults to 4. */
  statCount?: number;
  className?: string;
}

/**
 * Layout-shaped loading placeholder for the Charging Curve analysis page.
 *
 * Mirrors the page bento — header + controls → KPI band → hero curve →
 * secondary charts → stat band — so the loading UI claims the same vertical
 * space as the real content and keeps Cumulative Layout Shift near zero.
 *
 * Announced as `role="status" aria-busy="true"` with a labelled accessible
 * name so assistive tech identifies the loading region, matching the shared
 * `*Skeleton` primitives (PageSkeleton / PageLoadSkeleton).
 */
export default function LoadingSkeleton({
  kpiCount = 6,
  statCount = 4,
  className,
}: LoadingSkeletonProps = {}) {
  const { t } = useTranslation();

  // Clamp so an untyped caller passing a negative can never trigger the
  // `Array.from({ length: -1 })` RangeError that would crash the fallback.
  const kpiTiles = Math.max(0, kpiCount);
  const statTiles = Math.max(0, statCount);

  return (
    <div
      className={cn('space-y-6', className)}
      role="status"
      aria-busy="true"
      aria-label={t('charging.curve.loading', 'Loading charging curve analysis')}
      data-testid="charging-curve-skeleton"
    >
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-64" />
      </div>

      <div
        className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6"
        data-testid="charging-curve-skeleton-kpis"
      >
        {Array.from({ length: kpiTiles }).map((_, i) => (
          <GlassPanel key={i} className="p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-7 w-20" />
          </GlassPanel>
        ))}
      </div>

      <GlassPanel className="p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-64 w-full" />
      </GlassPanel>

      <GlassPanel className="p-6">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="mt-4 h-52 w-full" />
      </GlassPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GlassPanel className="p-6">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-4 h-48 w-full" />
        </GlassPanel>
        <GlassPanel className="p-6">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-4 h-48 w-full" />
        </GlassPanel>
      </div>

      <div
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        data-testid="charging-curve-skeleton-stats"
      >
        {Array.from({ length: statTiles }).map((_, i) => (
          <GlassPanel key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}
