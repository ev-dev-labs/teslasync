import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

/** Consume shared placement, never introduce a feature width/observer engine. */
export function RegenCardSlot({ children }: { children: ReactNode }) {
  const placement = useCardPlacement();
  return <div className={cn('min-w-0 h-full', placement?.className)}>{children}</div>;
}
