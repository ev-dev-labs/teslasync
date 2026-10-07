import { forwardRef, type TableHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { tableTokens } from '@/lib/tokens';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** An enclosing panel already owns the surface; keep only semantic row dividers. */
  variant?: 'standalone' | 'embedded';
}

/**
 * Semantic table primitive for structured content that does not need the
 * sorting, pagination, selection, or export behavior provided by DataTable.
 */
export const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, variant = 'standalone', ...props }, ref) => (
    <div
      data-table-variant={variant}
      className={variant === 'embedded' ? 'min-w-0 max-w-full' : tableTokens.frame}
    >
      <div className={cn(
        tableTokens.scrollContainer,
        'min-w-0 max-w-full overflow-x-auto overscroll-x-contain',
        variant === 'embedded' && 'rounded-none border-0',
      )}>
        <table
          ref={ref}
          className={cn(
            tableTokens.wrapper,
            tableTokens.semantic,
            'text-left',
            variant === 'embedded' && '[&_thead]:bg-transparent [&_tbody_tr:nth-child(even)]:bg-transparent [&_tbody_tr:last-child]:border-b-0',
            className,
          )}
          {...props}
        />
      </div>
    </div>
  ),
);

Table.displayName = 'Table';
