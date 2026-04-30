import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TimelineItem } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';

export interface EventFeedItem {
  id: string | number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
}

interface WidgetEventFeedProps {
  items: EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WidgetEventFeed({
  items,
  maxItems,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetEventFeedProps) {
  const { t } = useTranslation('dashboard');

  const limit = maxItems ?? (compact ? 3 : 10);

  const sorted = useMemo(
    () =>
      [...items]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit),
    [items, limit],
  );

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage ?? t('widget.noEvents', 'No events yet')}
        className="py-4"
      />
    );
  }

  return (
    <div className="space-y-0 overflow-y-auto h-full">
      {sorted.map((item, i) => (
        <TimelineItem
          key={item.id}
          icon={item.icon}
          title={item.title}
          subtitle={item.subtitle}
          time={formatRelativeTime(item.timestamp)}
          color={item.color}
          isLast={i === sorted.length - 1}
        />
      ))}
    </div>
  );
}
