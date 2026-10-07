import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

/** Placement only: the existing section owns its panel, state and semantics. */
export function MediaSlot({ children }: { children: ReactNode }) {
  const placement = useCardPlacement();
  return (
    <div
      data-media-slot
      data-card-size={placement?.size ?? 'full'}
      data-card-resolved-span={placement?.span ?? 1}
      className={cn('min-w-0 [&>div]:h-full', placement?.className ?? 'col-span-1')}
    >
      {children}
    </div>
  );
}
