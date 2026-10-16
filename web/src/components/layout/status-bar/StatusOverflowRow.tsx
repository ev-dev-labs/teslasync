import type { ReactNode } from 'react';
import { Text } from '@/components/ui/Typography';
import { cn } from '@/lib/cn';

/**
 * Row styling for status-bar items relocated into the More menu on narrow
 * screens. Rows keep the item's label and current value side by side and
 * meet the 44px touch-target minimum below `xl`.
 */
export const statusOverflowRowClass = cn(
  'flex min-h-11 w-full items-center gap-2 rounded-shape-sm px-2 py-2 text-start xl:min-h-9',
  'hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
);

export interface StatusOverflowRowContentProps {
  icon: ReactNode;
  label: string;
  value?: ReactNode;
  /** Status dot color class; omitted for items that carry no status. */
  dotClassName?: string;
  valueClassName?: string;
}

export function StatusOverflowRowContent({
  icon,
  label,
  value,
  dotClassName,
  valueClassName,
}: StatusOverflowRowContentProps) {
  return (
    <>
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClassName)}
        aria-hidden
      />
      <span className="inline-flex shrink-0" aria-hidden>
        {icon}
      </span>
      <Text as="span" size="sm" color="secondary" className="min-w-0 flex-1 break-words">
        {label}
      </Text>
      {value != null && (
        <Text
          as="span"
          size="sm"
          weight="medium"
          className={cn('shrink-0 text-end tabular-nums', valueClassName)}
        >
          {value}
        </Text>
      )}
    </>
  );
}
