import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TimelineItem } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';

export interface EventFeedItem {
  id: string | number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
  /** Optional navigation target. When set, the entire row becomes a `<Link>`
   *  to this href for drill-through navigation. */
  href?: string;
}

interface WidgetEventFeedProps {
  items: EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

/** Universal placeholder rendered for an unparseable timestamp. */
const TIME_FALLBACK = '—';

/**
 * Parse an ISO timestamp to epoch millis for sorting, mapping any invalid /
 * missing value to -Infinity so malformed rows sink to the bottom of the feed
 * instead of scrambling `Array.prototype.sort` with a `NaN` comparator.
 */
function toEpoch(timestamp: string): number {
  const ms = new Date(timestamp).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

export function WidgetEventFeed({
  items,
  maxItems,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetEventFeedProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime } = useDateFormat();

  const formatRelativeTime = useCallback(
    (isoStr: string): string => {
      const ms = new Date(isoStr).getTime();
      if (Number.isNaN(ms)) return TIME_FALLBACK;
      const diffMin = Math.floor((Date.now() - ms) / 60_000);
      if (diffMin < 1) return t('widget.eventFeed.justNow', 'Just now');
      if (diffMin < 60)
        return t('widget.eventFeed.minutesAgo', '{{minutes}}m ago', { minutes: diffMin });
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24)
        return t('widget.eventFeed.hoursAgo', '{{hours}}h ago', { hours: diffHrs });
      return formatDateTime(isoStr);
    },
    [t, formatDateTime],
  );

  const limit = maxItems ?? (compact ? 3 : 10);

  const sorted = useMemo(
    () =>
      [...(items ?? [])]
        .sort((a, b) => {
          const ea = toEpoch(a.timestamp);
          const eb = toEpoch(b.timestamp);
          if (ea === eb) return 0;
          return ea > eb ? -1 : 1;
        })
        .slice(0, limit),
    [items, limit],
  );

  if (sorted.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={emptyIcon}
        message={emptyMessage ?? t('widget.noEvents', 'No events yet')}
        className="py-4"
      />
    );
  }

  return (
    <div
      role="list"
      aria-label={t('widget.eventFeed.label', 'Event feed')}
      className="space-y-0 overflow-y-auto h-full"
    >
      {sorted.map((item, i) => (
        <div role="listitem" key={item.id}>
          <TimelineItem
            icon={item.icon}
            title={item.title}
            subtitle={item.subtitle}
            time={formatRelativeTime(item.timestamp)}
            color={item.color}
            isLast={i === sorted.length - 1}
            href={item.href}
          />
        </div>
      ))}
    </div>
  );
}
