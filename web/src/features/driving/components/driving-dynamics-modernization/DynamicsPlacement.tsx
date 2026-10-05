import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

/** Preserve a specialist surface's interaction owner without nesting a card.
 * Shared CardGrid alone measures and packs the allocated container width. */
export function DynamicsPlacement({ children }: { children: ReactNode }) {
  const placement = useCardPlacement();
  return (
    <div
      data-dynamics-placement
      data-card-resolved-span={placement?.span ?? 1}
      className={cn('h-full w-full min-w-0', placement?.className ?? 'col-span-1')}
    >
      {children}
    </div>
  );
}
