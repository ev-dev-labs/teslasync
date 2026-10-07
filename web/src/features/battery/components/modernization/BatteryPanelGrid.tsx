import { Children, type ReactNode } from 'react';
import {
  CardGrid, type CardGridItem,
} from '@/components/layout';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

export interface BatteryPanelGridProps {
  label: string;
  ids: readonly string[];
  sizes?: readonly CardGridItem['size'][];
  children: ReactNode;
}

/** Placement is consumed below CardGrid's provider. Existing specialist panels
 * retain their surfaces, error boundaries, chart/export IDs and child content.
 * CardGrid alone measures the allocated width and packs the row. */
function PlacedBatteryPanel({ id, children }: { id: string; children: ReactNode }) {
  const placement = useCardPlacement();
  return (
    <div
      data-battery-panel={id}
      data-card-size={placement?.size}
      data-card-resolved-span={placement?.span}
      className={cn('min-w-0 [&>div]:h-full', placement?.className)}
    >
      {children}
    </div>
  );
}

export function BatteryPanelGrid({ label, ids, sizes, children }: BatteryPanelGridProps) {
  const panels = Children.toArray(children);
  const items: CardGridItem[] = panels.map((content, index) => ({
    id: ids[index],
    size: sizes?.[index] ?? 'half',
    content: <PlacedBatteryPanel id={ids[index]}>{content}</PlacedBatteryPanel>,
  }));
  return (
    <section aria-label={label} className="min-w-0 w-full">
      <CardGrid label={label} items={items} />
    </section>
  );
}
