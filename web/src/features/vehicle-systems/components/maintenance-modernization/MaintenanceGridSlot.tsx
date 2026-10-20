import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/cn';

/** Consume the one CardGrid provider; do not observe or repack per panel.
 * FadeIn is the direct grid child so its span, not an inner card, owns width. */
export function MaintenanceGridSlot({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  const placement = useCardPlacement();
  return (
    <FadeIn
      delay={delay}
      className={cn('h-full min-w-0', placement?.className ?? 'col-span-1')}
    >
      {children}
    </FadeIn>
  );
}
