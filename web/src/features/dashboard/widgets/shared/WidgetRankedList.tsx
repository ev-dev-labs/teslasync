import { type ReactNode, useMemo } from 'react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { dashboardTokens } from '../../lib/dashboardTokens';

/**
 * One row of the shared ranked-list primitive.
 *
 * Speaks the `rows` language from the widget-redesign spec: a muted rank
 * numeral, a title with an optional muted sublabel on the left, a
 * right-aligned value with an optional muted hint underneath, an optional
 * leading status dot, and an optional status pill. Rows are separated by
 * dividers with no background magnitude bars (spec rule 5: no meaningless
 * meters; the After cards show plain divider rows). The rank numeral keeps
 * caller-ranked identity visible (see the route-efficiency After preview).
 */
export interface RankedItem {
  id: string | number;
  label: string;
  /** Missing/null is unknown; finite zero and negative readings remain measured. */
  value?: number | null;
  formattedValue: string;
  /** Muted secondary line under the label (e.g. "Oct 12 · 24 min"). Caller passes translated text. */
  sublabel?: string;
  /** Muted secondary line under the value. Right-aligned beside the label column. */
  hint?: string;
  /**
   * Leading status dot. Color means status only: the dot is decorative
   * (aria-hidden) and the adjacent label/value/badge text always names the
   * state, so meaning never travels by color alone.
   */
  status?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  /** Optional rich presentation; label remains the caller's plain-text fallback. */
  labelContent?: ReactNode;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'info' | 'neutral' };
  /**
   * @deprecated Background magnitude bars were removed in the Phase 1
   * redesign (spec divider rows carry no bars). Retained for source
   * compatibility with widgets awaiting their Phase 3 redesign; ignored.
   */
  barColor?: string;
}

interface WidgetRankedListProps {
  items: readonly RankedItem[];
  /** Source preserves caller business rank, including placement of unknowns. */
  order?: 'value-desc' | 'source';
  maxItems?: number;
  compact?: boolean;
  /**
   * @deprecated Background magnitude bars were removed in the Phase 1
   * redesign. Retained for source compatibility; ignored.
   */
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
  info: 'info',
  neutral: 'neutral',
} as const;

/** Status-dot fill per state; mirrors the shared freshness/semantic tiers. */
const statusDotClass = {
  success: 'bg-[var(--semantic-success)]',
  warning: 'bg-[var(--semantic-warning)]',
  error: 'bg-[var(--semantic-danger)]',
  info: 'bg-[var(--semantic-info)]',
  neutral: 'bg-[var(--text-secondary)]',
} as const;

/**
 * Preserve unknown readings for sort safety. Malformed non-null numbers
 * retain the existing zero normalization; caller-formatted text is never
 * replaced with an invented measured zero.
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
  emptyMessage = 'No data available',
  emptyIcon,
  wrapContent = false,
}: WidgetRankedListProps) {
  const limit = maxItems ?? (compact ? 3 : 5);

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

  if (visible.length === 0) {
    return <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={emptyIcon} message={emptyMessage} className="py-4" />;
  }

  return (
    <div className="overflow-y-auto">
      <ul className="flex flex-col">
        {visible.map((item, index) => (
          <li
            key={item.id}
            className={cn(
              'flex min-w-0 items-center border-b border-[var(--border-subtle)] last:border-b-0',
              dashboardTokens.density.row,
              dashboardTokens.density.rowGap,
              dashboardTokens.density.rowPadding,
            )}
          >
            {/* Rank number */}
            <span className="widget-rank-number flex size-6 shrink-0 items-center justify-center text-xs font-medium tabular-nums">
              {index + 1}
            </span>

            {/* Leading status dot (decorative — the adjacent text names the state). */}
            {item.status && (
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 shrink-0 rounded-full', statusDotClass[item.status])}
              />
            )}

            {/* Label column */}
            <div className="min-w-0 flex-1">
              <div className={cn(
                'text-sm font-medium text-[var(--text-primary)]',
                wrapContent ? 'whitespace-normal break-words' : 'truncate',
              )}>
                {item.labelContent ?? item.label ?? '—'}
              </div>
              {item.sublabel && (
                <div className={cn(
                  'text-xs text-[var(--text-muted)]',
                  wrapContent ? 'whitespace-normal break-words' : 'truncate',
                )}>
                  {item.sublabel}
                </div>
              )}
            </div>

            {/* Value column */}
            <div className="flex shrink-0 items-center gap-2">
              <div className="text-end">
                <div className={cn(
                  'text-sm font-semibold tabular-nums text-[var(--text-primary)]',
                  wrapContent && 'whitespace-normal break-words',
                )}>
                  {item.formattedValue ?? '—'}
                </div>
                {item.hint && (
                  <div className="whitespace-normal text-xs text-[var(--text-muted)]">
                    {item.hint}
                  </div>
                )}
              </div>

              {/* Status pill */}
              {item.badge && (
                <Badge
                  variant={badgeVariantMap[item.badge.variant]}
                  size="sm"
                >
                  {item.badge.text}
                </Badge>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
