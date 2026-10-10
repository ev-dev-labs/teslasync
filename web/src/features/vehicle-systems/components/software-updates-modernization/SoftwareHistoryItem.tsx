import type { ReactNode } from 'react';
import { LayoutCard } from '@/components/layout';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

/** Keep history list semantics while letting the shared grid own the span. */
export function SoftwareHistoryItem({ version, children }: { version: string; children: ReactNode }) {
  const placement = useCardPlacement();
  return (
    <div role="listitem" aria-label={version} className={cn('min-w-0', placement?.className)}>
      <LayoutCard title={version}>{children}</LayoutCard>
    </div>
  );
}
