import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { severityTokens, typography } from '@/lib/tokens';
import { dashboardTokens } from '../../lib/dashboardTokens';
import { cn } from '@/lib/cn';

export interface StatusCell {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'inactive' | 'unknown';
  value?: string;
  icon?: ReactNode;
  /** Caller-localized domain status, e.g. "Charging" instead of generic "Healthy". */
  statusLabel?: string;
}

export interface WidgetStatusGridProps {
  cells: StatusCell[];
  cols?: 2 | 3 | 4;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

const statusStyles: Record<StatusCell['status'], { dot: string }> = {
  ok: {
    dot: severityTokens.success.dot,
  },
  warning: {
    dot: severityTokens.warn.dot,
  },
  error: {
    dot: severityTokens.critical.dot,
  },
  inactive: {
    dot: 'bg-[var(--text-muted)]',
  },
  unknown: {
    dot: 'bg-[var(--text-muted)]',
  },
};

const statusCopy = {
  ok: ['widget.status.ok', 'Healthy'],
  warning: ['widget.status.warning', 'Warning'],
  error: ['widget.status.error', 'Error'],
  inactive: ['widget.status.inactive', 'Inactive'],
  unknown: ['widget.status.unknown', 'Unknown'],
} as const;

export function WidgetStatusGrid({
  cells,
  cols = 2,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetStatusGridProps) {
  const { t } = useTranslation('dashboard');
  // Callers derive `cells` from `data?.field`-shaped sources, so a runtime
  // `undefined` can reach this list even though the prop type says StatusCell[].
  // Normalise to an array before touching .length / .map so a missing source
  // renders the empty state instead of throwing.
  const items = cells ?? [];

  if (items.length === 0) {
    return <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyMessage ?? t('widget.statusGrid.noData', 'No status data available')} icon={emptyIcon} />;
  }

  const resolvedCols = compact ? 2 : cols;

  return (
    <div
      className={cn(
        'grid min-w-0',
        dashboardTokens.density.gridGap,
        dashboardTokens.columns[resolvedCols] ?? dashboardTokens.columns[2],
      )}
    >
      {items.map((cell) => {
        // Fail closed like StatusBadge: a status outside the known union (e.g. a
        // raw backend string cast to StatusCell['status']) must not dereference
        // undefined — fall back to the neutral "unknown" styling.
        const style = statusStyles[cell.status] ?? statusStyles.unknown;
        const copy = statusCopy[cell.status] ?? statusCopy.unknown;
        const statusLabel = cell.statusLabel ?? t(copy[0], copy[1]);
        return (
          <div
            key={cell.id}
            className={cn(
              // After `.sgi`: bordered 10px box, 8px dot/body gap, no ambient motion.
              // `relative` is a positioning hook only (no absolute descendants):
              // consumer status tests climb `.closest('.relative')` to the cell.
              'relative flex min-w-0 items-center gap-2 border border-[var(--border-subtle)]',
              dashboardTokens.radius.inner,
              dashboardTokens.density.itemPadding,
              compact && 'py-1.5',
            )}
          >
            {/* Status meaning remains visible as text independently of this dot. */}
            <span
              aria-hidden="true"
              className={cn('size-2 shrink-0 rounded-full', style.dot)}
            />

            {cell.icon && (
              <span aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]">
                {cell.icon}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <p className={typography.role.caption}>{cell.label}</p>
              {cell.value && (
                <p
                  className={cn(
                    typography.size.sm,
                    typography.weight.semibold,
                    typography.color.primary,
                    'truncate tabular-nums',
                  )}
                  title={cell.value}
                >
                  {cell.value}
                </p>
              )}
              <span
                className={cn(typography.role.caption, 'block truncate')}
                title={statusLabel}
              >
                {statusLabel}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
