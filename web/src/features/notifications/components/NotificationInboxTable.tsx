import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DateTime, SeverityBadge } from '@/components/data-display';
import { Button, DataTable, type Column, type ContextMenuItem } from '@/components/ui';
import type { AlertRule, NotificationLog, Vehicle } from '@/api/types';
import { notificationEventTypeFallback } from '@/lib/notificationEventType';

interface NotificationInboxTableProps {
  rows: NotificationLog[];
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
  onActivate: (log: NotificationLog) => void;
  onContextMenu: (log: NotificationLog) => ContextMenuItem[];
  ruleMap: Record<number, AlertRule>;
  vehicleMap: Record<number, Vehicle>;
  archived: boolean;
}

export function NotificationInboxTable({
  rows,
  selectedIds,
  onSelectionChange,
  onActivate,
  onContextMenu,
  ruleMap,
  vehicleMap,
  archived,
}: NotificationInboxTableProps) {
  const { t } = useTranslation();
  const columns = useMemo<Column<NotificationLog>[]>(() => [
    {
      key: 'received',
      header: t('notifications.inbox.columns.received', 'Received'),
      render: log => <DateTime value={log.created_at} in="user" className="whitespace-nowrap" />,
    },
    {
      key: 'title',
      header: t('notifications.inbox.columns.title', 'Notification'),
      visibleOnMobile: true,
      render: log => (
        <Button
          type="button"
          variant="ghost"
          className="!h-auto max-w-72 !justify-start !p-0 text-left"
          onClick={() => onActivate(log)}
          aria-label={t('notifications.inbox.row.open', 'Open notification: {{title}}', { title: log.title || '—' })}
        >
          <span className={log.read_at ? 'truncate text-[var(--text-secondary)]' : 'truncate font-medium text-[var(--text-primary)]'}>
            {log.title || '—'}
          </span>
        </Button>
      ),
    },
    {
      key: 'message',
      header: t('notifications.inbox.columns.message', 'Message'),
      render: log => (
        <Button
          type="button"
          variant="ghost"
          className="!h-auto max-w-72 !justify-start !p-0 text-left"
          onClick={() => onActivate(log)}
          aria-label={t('notifications.inbox.row.readMessage', 'Read full message: {{title}}', { title: log.title || '—' })}
        >
          <span className="block truncate" title={log.message}>{log.message || '—'}</span>
        </Button>
      ),
    },
    {
      key: 'type',
      header: t('notifications.inbox.columns.type', 'Type'),
      render: log => <span title={log.event_type}>{log.event_type ? t(`notifications.report.values.${log.event_type}`, notificationEventTypeFallback(log.event_type)) : '—'}</span>,
    },
    {
      key: 'source',
      header: t('notifications.inbox.columns.source', 'Source'),
      render: log => {
        const rule = log.alert_id != null ? ruleMap[log.alert_id] : undefined;
        const vehicle = rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined;
        const label = rule?.name
          ?? (log.alert_id != null
            ? t('notifications.inbox.source.ruleId', 'Rule #{{id}}', { id: log.alert_id })
            : log.event_type
              ? t(`notifications.report.values.${log.event_type.split('.')[0]}`, notificationEventTypeFallback(log.event_type.split('.')[0]))
              : log.channel_id
                ? t('notifications.inbox.source.legacyDelivery', 'Legacy channel delivery')
                : t('notifications.inbox.source.unknown', 'Unknown source'));
        return <span title={vehicle?.display_name || (log.channel_id && !log.event_type ? t('notifications.inbox.source.legacyHint', 'Original source was not recorded for this older channel delivery.') : undefined)}>{label}</span>;
      },
    },
    {
      key: 'severity',
      header: t('notifications.inbox.columns.severity', 'Severity'),
      render: log => <SeverityBadge severity={log.severity ?? 'info'} size="sm">{log.severity ?? 'info'}</SeverityBadge>,
    },
    {
      key: 'status',
      header: t('notifications.inbox.columns.status', 'Status'),
      visibleOnMobile: true,
      render: log => <span>{log.read_at ? t('notifications.inbox.columns.read', 'Read') : t('notifications.inbox.columns.unread', 'Unread')} · {t(`notifications.inbox.delivery.${log.status}`, log.status.replace(/_/g, ' '))}</span>,
    },
  ], [onActivate, ruleMap, vehicleMap, t]);

  return (
    <DataTable
      tableId={archived ? 'notifications:archive' : 'notifications:inbox'}
      caption={archived ? t('notifications.tab.archived', 'Archived') : t('notifications.inbox.title', 'Inbox')}
      columns={columns}
      data={rows}
      keyExtractor={log => log.id}
      rowLabel={log => log.title || t('notifications.inbox.columns.title', 'Notification')}
      selectable="multi"
      selectedKeys={selectedIds}
      onSelectionChange={keys => onSelectionChange(keys.map(Number))}
      rowContextMenu={onContextMenu}
      mobileColumns={['title', 'status']}
      density="compact"
      columnVisibility
    />
  );
}
