import type { ReactNode } from 'react';

import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

/**
 * Placement only: the specialist keeps its own panel and real ChartContainer.
 * In particular, no EmbeddedChart is substituted for an exportable chart.
 */
export function PackCapacityPlacement({ children }: { children: ReactNode }) {
  const placement = useCardPlacement();

  return (
    <div
      data-pack-capacity-placement
      data-card-size={placement?.size ?? 'full'}
      data-card-resolved-span={placement?.span ?? 1}
      className={cn('w-full min-w-0 [&>section]:h-full', placement?.className)}
    >
      {children}
    </div>
  );
}
