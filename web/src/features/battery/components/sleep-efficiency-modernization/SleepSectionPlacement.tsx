import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/cn';

/** Placement only: the immutable specialist retains its own panel and chart actions. */
export function SleepSectionPlacement({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  const placement = useCardPlacement();
  return (
    <div className={cn('min-w-0', placement?.className ?? 'col-span-1')}>
      <FadeIn delay={delay}>{children}</FadeIn>
    </div>
  );
}
