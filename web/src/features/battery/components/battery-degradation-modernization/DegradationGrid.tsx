import { Children, type ReactNode } from 'react';
import { CardGrid, useCardPlacement, type CardSize } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

function Placement({ children }: { children: ReactNode }) {
  const placement = useCardPlacement();
  return (
    <div className={cn('flex min-w-0 flex-col [&>*]:h-full', placement?.className)}>
      {children}
    </div>
  );
}

/** Shared container-width packing without changing source order or chart chrome. */
export function DegradationGrid({
  children, label, sizes,
}: { children: ReactNode; label: string; sizes: readonly CardSize[] }) {
  return (
    <section aria-label={label}>
      <CardGrid
        label={label}
        items={Children.toArray(children).map((child, index) => ({
          id: `battery-degradation-slot-${index}`,
          size: sizes[index] ?? 'full',
          content: <Placement>{child}</Placement>,
        }))}
      />
    </section>
  );
}
