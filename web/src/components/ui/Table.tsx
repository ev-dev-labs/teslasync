import { forwardRef, type TableHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { tableTokens } from '@/lib/tokens';

export type TableProps = TableHTMLAttributes<HTMLTableElement>;

/**
 * Semantic table primitive for structured content that does not need the
 * sorting, pagination, selection, or export behavior provided by DataTable.
 */
export const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, ...props }, ref) => (
    <div className={tableTokens.frame}>
      <div className={cn(tableTokens.scrollContainer, 'min-w-0 max-w-full overflow-x-auto overscroll-x-contain')}>
        <table
          ref={ref}
          className={cn(
            tableTokens.wrapper,
            tableTokens.semantic,
            'text-left',
            className,
          )}
          {...props}
        />
      </div>
    </div>
  ),
);

Table.displayName = 'Table';
