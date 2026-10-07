import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

export interface DetailPlacementProps {
  children: ReactNode;
  sourceId: string;
}

/** Existing specialist panels keep their own shells; only CardGrid owns geometry. */
export function DetailPlacement({ children, sourceId }: DetailPlacementProps) {
  const placement = useCardPlacement();
  return (
    <div
      data-detail-source={sourceId}
      className={cn('min-w-0 empty:hidden', placement?.className ?? 'col-span-1')}
    >
      {children}
    </div>
  );
}
