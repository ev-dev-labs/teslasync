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
    const sorted = [...items].sort((a, b) => b.value - a.value);
    return sorted.slice(0, limit);
  }, [items, limit]);

  const maxValue = useMemo(
    () => visible.reduce((max, item) => Math.max(max, item.value), 0),
    [visible],
  );

  if (visible.length === 0) {
    return <EmptyState icon={emptyIcon} message={emptyMessage} className="py-8" />;
  }

  return (
    <div className="overflow-y-auto">
      <ul className="flex flex-col gap-1">
        {visible.map((item, index) => {
          const barPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;

          return (
            <li
              key={item.id}
              className="relative min-h-[44px] rounded-lg px-3 py-2 transition-colors hover:bg-[var(--surface-2)]"
            >
              {/* Background bar */}
              {!hideBars && (
                <div
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
                  {item.label}
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
                  {item.formattedValue}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
