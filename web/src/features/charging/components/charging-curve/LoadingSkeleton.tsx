import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';

export default function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-64" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <GlassPanel key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}
