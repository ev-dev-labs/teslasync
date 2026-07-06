import { type ReactNode } from 'react';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

export interface StatusCell {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'inactive' | 'unknown';
  value?: string;
  icon?: ReactNode;
}

interface WidgetStatusGridProps {
  cells: StatusCell[];
  cols?: 2 | 3 | 4;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

const statusStyles: Record<StatusCell['status'], { bg: string; dot: string }> = {
  ok: {
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    dot: 'bg-emerald-500',
  },
  warning: {
    bg: 'bg-amber-500/10 border-amber-500/20',
    dot: 'bg-amber-500',
  },
  error: {
    bg: 'bg-red-500/10 border-red-500/20',
    dot: 'bg-red-500',
  },
  inactive: {
    bg: 'bg-white/[0.03] border-white/[0.06]',
    dot: 'bg-[var(--surface-2)]',
  },
  unknown: {
    bg: 'bg-white/[0.03] border-white/[0.06]',
    dot: 'bg-[var(--surface-2)]',
  },
};

// Container-query class table — collapses based on widget rendered width.
// See WidgetStatGrid for the same approach.
const containerColsClass: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3',
  4: 'grid-cols-2 @sm:grid-cols-4',
};

export function WidgetStatusGrid({
  cells,
  cols = 2,
  compact = false,
  emptyMessage = 'No status data available',
  emptyIcon,
}: WidgetStatusGridProps) {
  // Callers derive `cells` from `data?.field`-shaped sources, so a runtime
  // `undefined` can reach this list even though the prop type says StatusCell[].
  // Normalise to an array before touching .length / .map so a missing source
  // renders the empty state instead of throwing.
  const items = cells ?? [];

  if (items.length === 0) {
    return <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyMessage} icon={emptyIcon} />;
  }

  const resolvedCols = compact ? 2 : cols;

  return (
    <div className={cn('grid gap-2', containerColsClass[resolvedCols] ?? containerColsClass[2])}>
      {items.map((cell) => {
        // Fail closed like StatusBadge: a status outside the known union (e.g. a
        // raw backend string cast to StatusCell['status']) must not dereference
        // undefined — fall back to the neutral "unknown" styling.
        const style = statusStyles[cell.status] ?? statusStyles.unknown;
        return (
          <div
            key={cell.id}
            className={cn(
              'relative flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2',
              style.bg,
              compact && 'px-2 py-1.5',
            )}
          >
            {/* Decorative status cue — colour reinforces the label/value text,
                which already carries the meaning for assistive tech. */}
            <span
              aria-hidden="true"
              className={cn('absolute right-2 top-2 size-2 rounded-full', style.dot)}
            />

            {cell.icon && (
              <span aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]">
                {cell.icon}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-[var(--text-secondary)]">{cell.label}</p>
              {!compact && cell.value && (
                <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                  {cell.value}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
