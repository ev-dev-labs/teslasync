import { type ReactNode } from 'react';
import { Text } from '@/components/ui/Typography';
import { cn } from '@/lib/cn';

export interface KVItem {
  /** Stable row identity, independent of translated labels or ordering. */
  id?: string | number;
  /** Row label. Pass already-translated content. */
  label: ReactNode;
  /** Optional icon or other leading content; callers own its accessible meaning. */
  leading?: ReactNode;
  /** Row value — any renderable node. */
  value: ReactNode;
}

export interface KVListProps {
  /** Rows to render. `null` / `undefined` are treated as an empty list. */
  items: readonly KVItem[] | null | undefined;
  /** 1 = stacked rows (default); 2 = two-column grid. */
  columns?: 1 | 2;
  /** Row presentation. Responsive stacks below 24rem per allocated column. */
  layout?: 'inline' | 'stacked' | 'responsive';
  /** Allow inline labels/values to wrap. Stacked/responsive always wrap. */
  wrap?: boolean;
  className?: string;
  /**
   * Message shown (as an accessible status region) when there are no rows.
   * Pass a pre-translated string. When omitted the component renders an empty
   * list and leaves the empty-state decision to the caller.
   */
  emptyMessage?: string;
}

/**
 * KVList — a definition list of label/value rows.
 *
 * A pure presentational primitive: callers pass already-formatted values and
 * pre-translated labels. Null-safe over `items` so a caller handing it an
 * undefined collection (e.g. a query that resolved without its data) never
 * crashes the surrounding panel.
 */
export function KVList({
  items,
  columns = 1,
  layout = 'inline',
  wrap = false,
  className,
  emptyMessage,
}: KVListProps) {
  const rows = items ?? [];
  const wrapping = wrap || layout !== 'inline';
  const cellClasses = wrapping && 'min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere]';

  if (rows.length === 0 && emptyMessage) {
    return (
      <p role="status" className="py-2 text-sm text-[var(--text-muted)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <dl
      className={cn(
        'divide-y divide-gray-200 dark:divide-gray-700',
        columns === 2 && 'grid grid-cols-2 gap-x-6',
        layout === 'responsive' && '@container/kv-list',
        className,
      )}
    >
      {rows.map((item, index) => (
        <div
          key={item.id != null
            ? `id:${typeof item.id}:${item.id}`
            : typeof item.label === 'string' ? `${item.label}-${index}` : index}
          className={cn(
            'py-2',
            layout === 'inline' && 'flex justify-between',
            layout === 'inline' && wrapping && 'min-w-0 gap-3',
            layout === 'stacked' && 'flex min-w-0 flex-col gap-1',
            layout === 'responsive' && 'grid min-w-0 grid-cols-1 gap-x-3 gap-y-1',
            // The named query measures this list, not a wide viewport or outer widget.
            layout === 'responsive' && (columns === 2
              ? '@[49.5rem]/kv-list:grid-cols-2'
              : '@[24rem]/kv-list:grid-cols-2'),
          )}
        >
          <Text
            as="dt"
            size="sm"
            color="muted"
            className={cn(
              cellClasses,
              layout === 'inline' && wrapping && 'flex-1',
              item.leading != null && 'flex items-start gap-2',
            )}
          >
            {item.leading != null ? (
              <>
                <span className="max-w-full shrink-0">{item.leading}</span>
                <span className={cn(cellClasses)}>{item.label}</span>
              </>
            ) : item.label}
          </Text>
          <Text
            as="dd"
            size="sm"
            weight="medium"
            color="primary"
            className={cn(
              cellClasses,
              layout === 'inline' && wrapping && 'flex-1 text-end',
              layout === 'responsive' && (columns === 2
                ? '@[49.5rem]/kv-list:text-end'
                : '@[24rem]/kv-list:text-end'),
            )}
          >
            {item.value}
          </Text>
        </div>
      ))}
    </dl>
  );
}
