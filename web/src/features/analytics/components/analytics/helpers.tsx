import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

export function MetricSkeleton() {
  return (
    <GlassPanel className="p-3">
      <Skeleton width="60%" height={12} />
      <Skeleton width="40%" height={24} className="mt-2" />
    </GlassPanel>
  );
}

/**
 * Skeleton grid standing in for a KPI/metric band while the fleet query loads.
 * Keeps the band's footprint stable so the layout doesn't jump when data lands.
 */
export function MetricBandSkeleton({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6',
        className,
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <MetricSkeleton key={i} />
      ))}
    </div>
  );
}
