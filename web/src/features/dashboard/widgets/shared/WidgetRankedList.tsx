import { type ReactNode, useMemo } from 'react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

export interface RankedItem {
  id: string | number;
  label: string;
  /** Missing/null is unknown; finite zero and negative readings remain measured. */
  value?: number | null;
  formattedValue: string;
  /** Optional rich presentation; label remains the caller's plain-text fallback. */
  labelContent?: ReactNode;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'neutral' };
  barColor?: string;
}

interface WidgetRankedListProps {
  items: readonly RankedItem[];
  /** Source preserves caller business rank, including placement of unknowns. */
  order?: 'value-desc' | 'source';
  maxItems?: number;
  compact?: boolean;
  showBars?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  /** Wrap labels and formatted values rather than truncate narrow rows. */
  wrapContent?: boolean;
}

const badgeVariantMap = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
} as const;

/**
 * Preserve unknown readings without a magnitude bar. Malformed non-null
 * numbers retain the existing zero normalization for sort/bar safety only;
 * caller-formatted text is never replaced with an invented measured zero.
 */
function safeValue(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? value : 0;
}

export function WidgetRankedList({
  items,
  order = 'value-desc',
  maxItems,
  compact = false,
  showBars = true,
  emptyMessage = 'No data available',
  emptyIcon,
  wrapContent = false,
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
    if (order === 'value-desc') {
      normalized.sort((a, b) => {
        if (a.value === null) return b.value === null ? 0 : 1;
        if (b.value === null) return -1;
        return b.value - a.value;
      });
    }
    return normalized.slice(0, Math.max(0, limit));
  }, [items, limit, order]);

  const maxValue = useMemo(
    () => visible.reduce(
      (max, item) => item.value === null ? max : Math.max(max, item.value),
      0,
    ),
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
            item.value !== null && maxValue > 0
              ? Math.min(100, Math.max(0, (item.value / maxValue) * 100))
              : 0;

          return (
            <li
              key={item.id}
              className="relative min-h-[44px] rounded-lg px-3 py-2 transition-colors hover:bg-[var(--surface-2)]"
            >
              {/* Background bar (decorative — conveys rank magnitude already
                  present in the numeric value, so hidden from assistive tech) */}
              {!hideBars && item.value !== null && (
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
              <div className={cn(
                'relative flex items-center gap-3',
                wrapContent && 'flex-wrap',
              )}>
                {/* Rank number */}
                <span className="w-5 shrink-0 text-right text-xs font-medium text-[var(--text-muted)]">
                  {index + 1}
                </span>

                {/* Label */}
                <span className={cn(
                  'min-w-0 flex-1 text-sm text-[var(--text-primary)]',
                  wrapContent ? 'basis-1/2 whitespace-normal break-words' : 'truncate',
                )}>
                  {item.labelContent ?? item.label ?? '—'}
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
                <span className={cn(
                  'text-sm font-semibold tabular-nums text-[var(--text-primary)]',
                  wrapContent ? 'max-w-full whitespace-normal break-words' : 'shrink-0',
                )}>
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
