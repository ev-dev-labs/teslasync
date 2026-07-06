import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FilterBarProps {
  children: ReactNode;
  className?: string;
  /**
   * Optional accessible name for the control cluster. When provided the bar is
   * exposed to assistive technology as a labelled `group`, so screen-reader
   * users can identify (and jump to) the filter controls. Omit it to keep the
   * bar a presentational `<div>` that adds no extra landmark noise.
   */
  ariaLabel?: string;
}

/**
 * Horizontal layout container for list-page filter controls.
 *
 * Wraps a `<SearchInput>` plus any number of `<Select>`, `<Toggle>`, button
 * chips, or other filter widgets. Items wrap to multiple rows on narrow
 * viewports.
 *
 * Pass {@link FilterBarProps.ariaLabel} to give the cluster an accessible name;
 * without it the bar stays presentational so it does not add an unnamed group
 * to the accessibility tree.
 */
export function FilterBar({ children, className, ariaLabel }: FilterBarProps) {
  return (
    <div
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {children}
    </div>
  );
}
