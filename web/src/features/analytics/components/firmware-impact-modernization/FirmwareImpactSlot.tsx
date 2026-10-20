import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/cn';

/** A motion/section wrapper is the grid child, so it must consume the public
 * packed span. Do not measure again or introduce a second width policy. */
export function FirmwareImpactSlot({
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
      className={cn('w-full min-w-0', placement?.className)}
    >
      {children}
    </FadeIn>
  );
}
