import type { ReactNode } from 'react';
import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';

export function MetricSkeleton() {
  return (
    <GlassPanel className="p-3">
      <Skeleton width="60%" height={12} />
      <Skeleton width="40%" height={24} className="mt-2" />
    </GlassPanel>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <span className="text-sm font-semibold text-[var(--text-primary)]">
      {children}
    </span>
  );
}
