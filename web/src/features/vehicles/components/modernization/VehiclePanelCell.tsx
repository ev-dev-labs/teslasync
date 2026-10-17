import type { ReactNode } from 'react';
import { useCardPlacement, type CardSize } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

/** Must mount inside CardGrid's provider. Standalone stays a single cell. */
export function VehiclePanelCell({ id, size, children }: {
  id: string;
  size: CardSize;
  children: ReactNode;
}) {
  const placement = useCardPlacement();
  return (
    <div
      data-card data-card-size={placement?.size ?? size}
      data-vehicle-panel={id}
      data-card-resolved-span={placement?.span ?? 1}
      className={cn(
        'flex h-full min-w-0 flex-col [&>[data-print-card]]:h-full',
        placement?.className ?? 'col-span-1',
      )}
    >
      {children}
    </div>
  );
}
