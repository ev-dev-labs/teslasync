import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/cn';

interface TrueCostLayoutSlotProps {
  children: ReactNode;
  delay: number;
}

/** Existing specialist panels own their surfaces, headings and source states.
 * The single shared CardGrid owns measurement and placement; this adapter
 * only carries its span through the motion boundary, without a nested card. */
export function TrueCostLayoutSlot({ children, delay }: TrueCostLayoutSlotProps) {
  const placement = useCardPlacement();
  return (
    <div
      data-tco-layout-slot
      data-card-size={placement?.size}
      data-card-resolved-span={placement?.span}
      className={cn('min-w-0', placement?.className)}
    >
      <FadeIn delay={delay} className="min-w-0">
        {children}
      </FadeIn>
    </div>
  );
}
