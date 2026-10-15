import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

/**
 * Existing analytics renderers already own their surfaces and chart controls.
 * Allocate their group through the shared placement context without wrapping
 * those surfaces in a second card, measuring again, or touching chart children.
 */
export function AnalyticsPlacedContent({ children }: { children: ReactNode }) {
  const placement = useCardPlacement();

  return (
    <div
      data-analytics-content
      data-card-size={placement?.size ?? 'full'}
      data-card-resolved-span={placement?.span ?? 1}
      className={cn('w-full min-w-0', placement?.className ?? 'col-span-1')}
    >
      {children}
    </div>
  );
}
