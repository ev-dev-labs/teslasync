import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TimelineItem } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDateLabels } from '@/hooks/useDateLabels';

export interface EventFeedItem {
  id: string | number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
  /** Navigation target; rich slots stay outside the title link. */
  href?: string;
  badges?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  wrap?: boolean;
  /** Already formatted by the source's existing formatter; sorting still uses timestamp. */
  timeLabel?: string;
}

interface WidgetEventFeedProps {
  items: readonly EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  /** Source order is opt-in; the default remains most-recent-first. */
  order?: 'newest-first' | 'source';
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
  order = 'newest-first',
}: WidgetEventFeedProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime, formatTime } = useDateFormat();
  const { formatRelativeDays } = useDateLabels();

  const formatFeedTime = useCallback(
    (isoStr: string): string => {
      const ms = new Date(isoStr).getTime();
      if (Number.isNaN(ms)) return TIME_FALLBACK;
      const diffMin = Math.floor((Date.now() - ms) / 60_000);
      // feed-time: sub-hour events stay relative ("Just now", "5m ago") so
      // fresh activity reads as fresh; anything older gets a stable
      // tz-aware day label ("Today 7:30 AM", "Yesterday 11:02 PM", then the
      // absolute date). Hourly "Nh ago" labels are deliberately gone: the
      // feed does not poll, so they would go stale within the hour.
      if (diffMin < 1) return t('widget.eventFeed.justNow', 'Just now');
      if (diffMin < 60)
        return t('widget.eventFeed.minutesAgo', '{{minutes}}m ago', { minutes: diffMin });
      // 'Today' / 'Yesterday' are the exact day words produced by the shared
      // formatRelativeDays helper for the same input (same lib, same release).
      const day = formatRelativeDays(isoStr);
      if (day === 'Today' || day === 'Yesterday') return `${day} ${formatTime(isoStr)}`;
      return formatDateTime(isoStr);
    },
    [t, formatDateTime, formatTime, formatRelativeDays],
  );

  const limit = maxItems ?? (compact ? 3 : 10);

  const sorted = useMemo(
    () => {
      const rows = [...(items ?? [])];
      if (order === 'newest-first') {
        rows.sort((a, b) => {
          const ea = toEpoch(a.timestamp);
          const eb = toEpoch(b.timestamp);
          if (ea === eb) return 0;
          return ea > eb ? -1 : 1;
        });
      }
      return rows.slice(0, limit);
    },
    [items, limit, order],
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

  // Rows intentionally bleed ±4px (-mx-1) for their hover background;
  // overflow-x-clip keeps the feed from scrolling horizontally.
  return (
    <div
      role="list"
      aria-label={t('widget.eventFeed.label', 'Event feed')}
      className="space-y-0 overflow-x-clip overflow-y-auto h-full"
    >
      {sorted.map((item, i) => (
        <div role="listitem" key={item.id}>
          <TimelineItem
            icon={item.icon}
            title={item.title}
            subtitle={item.subtitle}
            time={item.timeLabel ?? formatFeedTime(item.timestamp)}
            color={item.color}
            isLast={i === sorted.length - 1}
            href={item.href}
            badges={item.badges}
            metadata={item.metadata}
            actions={item.actions}
            wrap={item.wrap}
          />
        </div>
      ))}
    </div>
  );
}
