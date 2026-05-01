import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FilterBarProps {
  children: ReactNode;
  className?: string;
}

/**
 * Horizontal layout container for list-page filter controls.
 *
 * Wraps a `<SearchInput>` plus any number of `<Select>`, `<Toggle>`, button
 * chips, or other filter widgets. Items wrap to multiple rows on narrow
 * viewports.
 */
export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
    </div>
  );
}
