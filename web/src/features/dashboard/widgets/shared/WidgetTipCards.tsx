import { useMemo, type ReactNode } from 'react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

export interface TipItem {
  id: string | number;
  icon?: ReactNode;
  title: string;
  description: string;
  impact?: 'high' | 'medium' | 'low';
  impactLabel?: string;
}

interface WidgetTipCardsProps {
  tips: TipItem[];
  maxTips?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

const impactBadgeMap = {
  high: 'success',
  medium: 'warning',
  low: 'neutral',
} as const;

export function WidgetTipCards({
  tips,
  maxTips,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetTipCardsProps) {
  const limit = maxTips ?? (compact ? 1 : 3);

  // Null-safety: callers build `tips` from possibly-undefined API data
  // (e.g. `data?.recommendations`). Coalesce before `.slice`/`.length` so a
  // missing source degrades to the empty state instead of throwing.
  const visible = useMemo(() => (tips ?? []).slice(0, limit), [tips, limit]);

  if (visible.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={emptyIcon}
        message={emptyMessage ?? 'No recommendations'}
        className="py-4"
      />
    );
  }

  return (
    <div role="list" className="space-y-2 overflow-y-auto h-full">
      {visible.map((tip) => (
        <div
          key={tip.id}
          role="listitem"
          className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 min-h-[44px] flex items-start gap-3"
        >
          {tip.icon && (
            // Decorative leading glyph — the title conveys the meaning, so hide
            // the icon from assistive tech to avoid a redundant announcement.
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--text-secondary)]">
              {tip.icon}
            </span>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {tip.title}
              </span>
              {tip.impact && (
                <Badge
                  variant={impactBadgeMap[tip.impact]}
                  size="sm"
                  className="shrink-0"
                >
                  {tip.impactLabel ?? tip.impact}
                </Badge>
              )}
            </div>
            <p
              className={cn(
                'mt-0.5 text-xs text-[var(--text-secondary)] leading-relaxed',
                compact && 'line-clamp-2',
              )}
            >
              {tip.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
