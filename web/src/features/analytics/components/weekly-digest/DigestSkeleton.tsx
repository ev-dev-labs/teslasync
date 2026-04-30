import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

export function DigestSkeleton() {
  return (
    <FadeIn className="space-y-6">
      <GlassPanel className="p-6">
        <Skeleton lines={2} />
      </GlassPanel>
      <GlassPanel className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={80} />
        ))}
      </GlassPanel>
      <GlassPanel className="p-6">
        <Skeleton height={260} />
      </GlassPanel>
    </FadeIn>
  );
}
