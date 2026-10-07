import type { ReactNode } from 'react';
import { Grid } from '../Grid';
import { cn } from '@/lib/cn';
import { CardPlacementContext } from './CardPlacementContext';
import { containerPolicy, packCardRows, type CardSize } from './layoutPolicy';
import { useContainerWidth } from './useContainerWidth';

export interface CardGridItem {
  id: string;
  size: CardSize;
  content: ReactNode;
}

export interface CardGridProps {
  items: readonly CardGridItem[];
  label: string;
}

const columns = { default: 1 } as const;
const gridClasses = {
  1: 'grid-cols-1',
  6: 'grid-cols-6',
  12: 'grid-cols-12',
} as const;

export function CardGrid({ items, label }: CardGridProps) {
  const { ref, width } = useContainerWidth();
  const policy = containerPolicy(width);
  const safeItems = items ?? [];
  const spans = packCardRows(safeItems.map(item => item.size), width);
  return (
    <div ref={ref} data-card-grid data-container-band={policy.band} role="group" aria-label={label} className="min-w-0">
      {/* Grid owns the actual grid node. Geometry consumers must inspect this
          direct child, not interpret the measurement boundary as a grid. */}
      <Grid cols={columns} gap={policy.gutter} className={cn(gridClasses[policy.columns], 'items-stretch')}>
        {safeItems.map((item, index) => (
          <CardPlacementContext.Provider key={item.id} value={{ size: item.size, span: spans[index], width }}>
            {item.content}
          </CardPlacementContext.Provider>
        ))}
      </Grid>
    </div>
  );
}
