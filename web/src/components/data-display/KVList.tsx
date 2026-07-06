import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface KVItem {
  /** Row label. Pass a pre-translated string. */
  label: string;
  /** Row value — any renderable node. */
  value: ReactNode;
}

export interface KVListProps {
  /** Rows to render. `null` / `undefined` are treated as an empty list. */
  items: KVItem[] | null | undefined;
  /** 1 = stacked rows (default); 2 = two-column grid. */
  columns?: 1 | 2;
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
export function KVList({ items, columns = 1, className, emptyMessage }: KVListProps) {
  const rows = items ?? [];

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
        className,
      )}
    >
      {rows.map((item, index) => (
        <div key={`${item.label}-${index}`} className="flex justify-between py-2">
          <dt className="text-sm text-[var(--text-muted)]">{item.label}</dt>
          <dd className="text-sm font-medium text-[var(--text-primary)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
