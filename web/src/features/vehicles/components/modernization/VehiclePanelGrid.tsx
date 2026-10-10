import type { ReactNode } from 'react';
import { CardGrid, type CardGridItem } from '@/components/layout';
import { VehiclePanelCell } from './VehiclePanelCell';

export interface VehiclePanelGridItem {
  id: string;
  size: CardGridItem['size'];
  content: ReactNode;
}

/** Compatibility mount for existing domain panels that already own their
 * surface. The shared grid/policy owns layout; do not wrap them in another
 * Card, clone their content, or change their table/query contracts. */
export function VehiclePanelGrid({ items, label }: {
  items: readonly VehiclePanelGridItem[];
  label: string;
}) {
  const safeItems = items ?? [];
  const cells = safeItems.map(item => ({
    id: item.id,
    size: item.size,
    content: (
      <VehiclePanelCell id={item.id} size={item.size}>
        {item.content}
      </VehiclePanelCell>
    ),
  }));
  return <div className="min-w-0"><CardGrid label={label} items={cells} /></div>;
}
