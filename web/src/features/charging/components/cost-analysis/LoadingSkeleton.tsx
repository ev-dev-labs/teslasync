import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

export function LoadingSkeleton() {
  return (
    <FadeIn>
      <div className="space-y-6 p-6">
        {/* Header skeleton */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Skeleton width="220px" height={28} />
            <Skeleton width="340px" height={16} className="mt-2" />
          </div>
          <Skeleton width="200px" height={36} rounded />
        </div>
        {/* Card skeletons */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <GlassPanel key={i} className="p-4">
              <Skeleton height={14} width="60%" />
              <Skeleton height={24} width="80%" className="mt-2" />
              <Skeleton height={12} width="40%" className="mt-1" />
            </GlassPanel>
          ))}
        </div>
        {/* Chart skeletons */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GlassPanel className="p-4">
            <Skeleton height={16} width="40%" />
            <Skeleton height={200} className="mt-4" />
          </GlassPanel>
          <GlassPanel className="p-4">
            <Skeleton height={16} width="40%" />
            <Skeleton height={200} className="mt-4" />
          </GlassPanel>
        </div>
        {/* Table skeleton */}
        <GlassPanel className="p-4">
          <Skeleton height={16} width="30%" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={32} />
            ))}
          </div>
        </GlassPanel>
      </div>
    </FadeIn>
  );
}
