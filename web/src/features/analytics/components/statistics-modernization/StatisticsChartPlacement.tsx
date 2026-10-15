import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

/** Keep the original ChartContainer capability owner; only adapt its grid span. */
export function StatisticsChartPlacement({ children }: { children: ReactNode }) {
  const placement = useCardPlacement();
  return (
    <div className={cn('min-w-0', placement?.className ?? 'col-span-1')}>
      {children}
    </div>
  );
}
