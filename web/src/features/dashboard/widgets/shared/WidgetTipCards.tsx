import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Text } from '@/components/ui';
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
  const { t } = useTranslation();
  const limit = maxTips ?? (compact ? 1 : 3);
  const impactLabels = {
    high: t('dashboard.tipCards.impact.high', 'high'),
    medium: t('dashboard.tipCards.impact.medium', 'medium'),
    low: t('dashboard.tipCards.impact.low', 'low'),
  };

  // Null-safety: callers build `tips` from possibly-undefined API data
  // (e.g. `data?.recommendations`). Coalesce before `.slice`/`.length` so a
  // missing source degrades to the empty state instead of throwing.
  const visible = useMemo(() => (tips ?? []).slice(0, limit), [tips, limit]);

  if (visible.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={emptyIcon}
        message={emptyMessage ?? t('dashboard.tipCards.noRecommendations', 'No recommendations')}
        className="py-4"
      />
    );
  }

  return (
    <div role="list" className="h-full min-w-0 space-y-2 overflow-y-auto">
      {visible.map((tip) => (
        <div
          key={tip.id}
          role="listitem"
          className="flex min-h-[44px] min-w-0 items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
        >
          {tip.icon && (
            // Decorative leading glyph — the title conveys the meaning, so hide
            // the icon from assistive tech to avoid a redundant announcement.
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--text-secondary)]">
              {tip.icon}
            </span>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <Text size="sm" weight="medium" color="primary" className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {tip.title}
              </Text>
              {tip.impact && (
                <Badge
                  variant={impactBadgeMap[tip.impact]}
                  size="sm"
                  className="max-w-full shrink-0 whitespace-normal [overflow-wrap:anywhere]"
                >
                  {tip.impactLabel ?? impactLabels[tip.impact]}
                </Badge>
              )}
            </div>
            <Text
              as="p"
              size="xs"
              color="secondary"
              className={cn(
                'mt-0.5 leading-relaxed [overflow-wrap:anywhere]',
                compact && 'line-clamp-2',
              )}
            >
              {tip.description}
            </Text>
          </div>
        </div>
      ))}
    </div>
  );
}
