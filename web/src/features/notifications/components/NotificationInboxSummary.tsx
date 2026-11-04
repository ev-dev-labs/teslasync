import { useTranslation } from 'react-i18next';
import { DateTime, SeverityBadge } from '@/components/data-display';
import { Badge, Button, Text } from '@/components/ui';
import type { NotificationLog } from '@/api/types';
import { cn } from '@/lib/cn';
import { NotificationInboxDelivery } from './NotificationInboxDelivery';

interface Props {
  log: NotificationLog;
  eventLabel: string;
  onActivate: (log: NotificationLog) => void;
}

export function NotificationInboxSummary({ log, eventLabel, onActivate }: Props) {
  const { t } = useTranslation();
  const severity = log.severity === 'warning' ? 'warn' : log.severity;
  const severityLabels: Record<string, string> = {
    info: t('notifications.inbox.filter.severity.info', 'Info'),
    warn: t('notifications.inbox.filter.severity.warn', 'Warn'),
    critical: t('notifications.inbox.filter.severity.critical', 'Critical'),
  };
  return (
    <div className="min-w-0 space-y-2">
      <Button type="button" variant="ghost"
        className="!h-auto !min-h-11 xl:!min-h-9 w-full !justify-start !px-0 !py-1 text-left"
        onClick={() => onActivate(log)}
        aria-label={t('notifications.inbox.row.open', 'Open notification: {{title}}', { title: log.title || '—' })}>
        <Text as="span" variant="bodySm" className={cn('line-clamp-2 break-words',
          log.read_at ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]')}>
          {log.title || '—'}
        </Text>
      </Button>
      <div className="space-y-2 xl:hidden">
        <div className="flex flex-wrap items-center gap-2">
          {severity && severityLabels[severity]
            ? <SeverityBadge severity={severity} size="sm">{severityLabels[severity]}</SeverityBadge>
            : <Badge variant="neutral" size="sm">{severity || '—'}</Badge>}
          <Text as="span" variant="caption">
            {log.created_at && Number.isFinite(Date.parse(log.created_at)) ? <DateTime value={log.created_at} in="user" /> : '—'}
          </Text>
        </div>
        <Text as="p" variant="bodySm" className="line-clamp-2 break-words">{log.message || '—'}</Text>
        <Text as="p" variant="caption">
          <NotificationInboxDelivery status={log.status} />
          <span aria-hidden="true"> · </span>
          {log.read_at ? t('notifications.inbox.columns.read', 'Read') : t('notifications.inbox.columns.unread', 'Unread')}
        </Text>
      </div>
      <Text as="span" variant="caption" className="hidden truncate xl:block" title={log.event_type}>{eventLabel}</Text>
    </div>
  );
}
