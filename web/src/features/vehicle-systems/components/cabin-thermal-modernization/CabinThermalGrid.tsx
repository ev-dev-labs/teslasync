import type { ReactNode } from 'react';
import {
  CardGrid,
  type CardGridItem,
} from '@/components/layout';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

/** Placement only: existing sections remain the panel/chart/action owners. */
function CabinThermalSlot({ children }: { children: ReactNode }) {
  const placement = useCardPlacement();
  return (
    <div className={cn('w-full min-w-0 [&>div]:h-full [&_section]:min-w-0', placement?.className)}>
      {children}
    </div>
  );
}

export function CabinThermalGrid({
  items,
  label,
}: {
  items: readonly CardGridItem[];
  label: string;
}) {
  return (
    <CardGrid
      label={label}
      items={items.map(item => ({
        ...item,
        content: <CabinThermalSlot>{item.content}</CabinThermalSlot>,
      }))}
    />
  );
}
