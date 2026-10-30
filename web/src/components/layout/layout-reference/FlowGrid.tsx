import { Children, type ReactNode } from 'react';
import { useContainerWidth } from './useContainerWidth';
import { cn } from '@/lib/cn';
import './card-layout.css';

/** Keep an ordered node/connector sequence vertical until every cell is readable. */
export function FlowGrid({ children }: { children: ReactNode }) {
  const { ref, width } = useContainerWidth();
  const cells = Children.toArray(children);
  const horizontal = cells.length > 0 && width >= cells.length * 200 + (cells.length - 1) * 12;
  return (
    <div ref={ref} data-flow-grid data-flow-axis={horizontal ? 'row' : 'column'}
      className={cn('grid min-w-0 items-center gap-3 [&>*]:min-w-0',
        horizontal ? 'grid-flow-col auto-cols-fr' : 'grid-cols-1')}>
      {children}
    </div>
  );
}
