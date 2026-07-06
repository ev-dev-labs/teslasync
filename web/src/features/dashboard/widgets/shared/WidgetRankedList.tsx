import { type ReactNode, useMemo } from 'react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

export interface RankedItem {
  id: string | number;
  label: string;
  value: number;
  formattedValue: string;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'neutral' };
  barColor?: string;
}

interface WidgetRankedListProps {
  items: RankedItem[];
  maxItems?: number;
  compact?: boolean;
  showBars?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

const badgeVariantMap = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
} as const;

/**
 * Coerce a possibly non-finite runtime value (NaN / ±Infinity, or a
 * mistyped null from the untyped API layer) to a safe, sortable number so a
 * single bad reading can't poison the sort order or produce a `NaN%` bar.
 */
function safeValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function WidgetRankedList({
  items,
  maxItems,
  compact = false,
  showBars = true,
  emptyMessage = 'No data available',
  emptyIcon,
}: WidgetRankedListProps) {
  const limit = maxItems ?? (compact ? 3 : 5);
  const hideBars = compact || !showBars;

  const visible = useMemo(() => {
    // `items ?? []` guards the spread below: the prop is typed non-null, but
    // callers routinely pass raw hook data that can be undefined mid-fetch.
    const normalized = (items ?? []).map((item) => ({
      ...item,
      value: safeValue(item.value),
    }));
    normalized.sort((a, b) => b.value - a.value);
    return normalized.slice(0, Math.max(0, limit));
  }, [items, limit]);

  const maxValue = useMemo(
    () => visible.reduce((max, item) => Math.max(max, item.value), 0),
    [visible],
  );

  if (visible.length === 0) {
    return <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={emptyIcon} message={emptyMessage} className="py-8" />;
  }

  return (
    <div className="overflow-y-auto">
      <ul className="flex flex-col gap-1">
        {visible.map((item, index) => {
          // Clamp to [0,100]: a negative reading mixed with positive ones
          // would otherwise yield a negative CSS width.
          const barPct =
            maxValue > 0 ? Math.min(100, Math.max(0, (item.value / maxValue) * 100)) : 0;

          return (
            <li
              key={item.id}
              className="relative min-h-[44px] rounded-lg px-3 py-2 transition-colors hover:bg-[var(--surface-2)]"
            >
              {/* Background bar (decorative — conveys rank magnitude already
                  present in the numeric value, so hidden from assistive tech) */}
              {!hideBars && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-lg opacity-15',
                    item.barColor ?? 'bg-blue-400',
                  )}
                  style={{ width: `${barPct}%` }}
                />
              )}

              {/* Row content */}
              <div className="relative flex items-center gap-3">
                {/* Rank number */}
                <span className="w-5 shrink-0 text-right text-xs font-medium text-[var(--text-muted)]">
                  {index + 1}
                </span>

                {/* Label */}
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">
                  {item.label ?? '—'}
                </span>

                {/* Badge */}
                {item.badge && (
                  <Badge
                    variant={badgeVariantMap[item.badge.variant]}
                    size="sm"
                  >
                    {item.badge.text}
                  </Badge>
                )}

                {/* Value */}
                <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                  {item.formattedValue ?? '—'}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
