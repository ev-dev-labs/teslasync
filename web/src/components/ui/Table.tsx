import { forwardRef, type TableHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type TableProps = TableHTMLAttributes<HTMLTableElement>;

/**
 * Semantic table primitive for structured content that does not need the
 * sorting, pagination, selection, or export behavior provided by DataTable.
 */
export const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, ...props }, ref) => (
    <table
      ref={ref}
      className={cn(
        'w-full border-collapse text-left text-[var(--text-primary)]',
        className,
      )}
      {...props}
    />
  ),
);

Table.displayName = 'Table';
