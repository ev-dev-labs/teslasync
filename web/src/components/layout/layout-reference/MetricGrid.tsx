import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface MetricGridProps {
  children: ReactNode;
  /** Accessible group label (optional). */
  label?: string;
  className?: string;
}

/**
 * Dense metric-tile grid. Auto-fit with a 12.5rem (200px) floor: tiles wrap
 * to fewer columns instead of squeezing below readability, and the row
 * always fills the available width. Fixed `xl:grid-cols-6`-style tiers
 * produced 146px tiles — use this for MetricCard/RecordCard/StatCard rows.
 */
export function MetricGrid({ children, label, className }: MetricGridProps) {
  return (
    <div
      data-metric-grid
      role={label ? 'group' : undefined}
      aria-label={label}
      className={cn(
        'grid min-w-0 items-stretch gap-3 [&>*]:min-w-0 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12.5rem),1fr))]',
        className,
      )}
    >
      {children}
    </div>
  );
}
