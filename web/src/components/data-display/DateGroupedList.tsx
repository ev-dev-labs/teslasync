import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface DateGroupedListGroup<T> {
  /** Sortable key, typically `YYYY-MM-DD`. Used as React key. */
  dateKey: string;
  /** Visible date label, pre-formatted by the caller (e.g. "May 9, 2026"). */
  dateLabel: string;
  /**
   * Optional secondary label — relative time text such as "3 days ago".
   * Rendered muted, after the primary label.
   */
  relativeLabel?: string;
  /**
   * Optional summary text rendered right-aligned in the divider row
   * (e.g. "2 drives · 6.2 mi"). Free-form ReactNode for flexibility.
   */
  summary?: ReactNode;
  /** Items belonging to this group. */
  items: T[];
}

export interface DateGroupedListProps<T> {
  groups: readonly DateGroupedListGroup<T>[];
  /**
   * Render function for each item. Called once per item per group;
   * receives the item and its zero-based index within the group.
   */
  renderItem: (item: T, indexInGroup: number) => ReactNode;
  /**
   * Stable React key extractor. Falls back to `index` when omitted, but
   * an explicit key avoids re-render thrash when groups update.
   */
  itemKey?: (item: T, indexInGroup: number) => string | number;
  /** Spacing between successive items inside a group. Default `space-y-3`. */
  itemSpacing?: string;
  /** Spacing between successive groups. Default `space-y-6`. */
  groupSpacing?: string;
  /** Additional class names on the outer container. */
  className?: string;
  /** Test hook. */
  testId?: string;
}

/**
 * `DateGroupedList` — generic list with horizontal-rule date dividers
 * and an optional per-group summary on the right-hand side. Used by
 * any feed-style page where items naturally cluster by day:
 *
 *   ── May 9, 2026 · 3 days ago ───────────── 2 drives · 6.2 mi ─
 *     [item]
 *     [item]
 *
 *   ── Apr 24, 2026 · 18 days ago ─────────── 2 drives · 39.9 mi ─
 *     [item]
 *     [item]
 *
 * Domain-specific aggregation (the "2 drives · 6.2 mi" string) lives
 * on the caller so this component stays free of unit/format logic.
 */
export function DateGroupedList<T>({
  groups,
  renderItem,
  itemKey,
  itemSpacing = 'space-y-3',
  groupSpacing = 'space-y-6',
  className,
  testId,
}: DateGroupedListProps<T>) {
  return (
    <div className={cn(groupSpacing, className)} data-testid={testId}>
      {groups.map((group) => (
        <section
          key={group.dateKey}
          aria-labelledby={`date-group-${group.dateKey}`}
          data-date-key={group.dateKey}
        >
          <header
            className="mb-3 flex items-center gap-3"
            id={`date-group-${group.dateKey}`}
          >
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">
                {group.dateLabel}
              </span>
              {group.relativeLabel && (
                <span className="text-[var(--text-muted)]">
                  · {group.relativeLabel}
                </span>
              )}
            </div>
            <div
              className="flex-1 h-px bg-[var(--glass-border)] opacity-50"
              aria-hidden
            />
            {group.summary && (
              <span className="text-xs text-[var(--text-muted)] tabular-nums">
                {group.summary}
              </span>
            )}
          </header>
          <div className={itemSpacing}>
            {group.items.map((item, idx) => (
              <div key={itemKey ? itemKey(item, idx) : idx}>
                {renderItem(item, idx)}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
