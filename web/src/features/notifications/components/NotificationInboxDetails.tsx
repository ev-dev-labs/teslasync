import { useTranslation } from 'react-i18next';
import { DateTime } from '@/components/data-display';
import { Button, PanelTitle, Text, type ContextMenuItem } from '@/components/ui';
import type { AlertRule, NotificationLog, Vehicle } from '@/api/types';
import { fmtNumber } from '@/lib/numberFormat';
import { NotificationInboxDelivery } from './NotificationInboxDelivery';

interface NotificationInboxDetailsProps {
  log: NotificationLog;
  rule?: AlertRule;
  vehicle?: Vehicle;
  actions?: ContextMenuItem[];
}

/** Shared by inline inspection and the non-rule dialog; nothing is inferred from missing metadata. */
export function NotificationInboxDetails({ log, rule, vehicle, actions = [] }: NotificationInboxDetailsProps) {
  const { t } = useTranslation();
  const timestamp = (value: string | null | undefined) =>
    value && Number.isFinite(Date.parse(value)) ? <DateTime value={value} in="user" /> : '—';
  const items = [
    { label: t('notifications.inbox.columns.received', 'Received'), value: timestamp(log.created_at) },
    { label: t('notifications.inbox.detail.sent', 'Sent'), value: timestamp(log.sent_at) },
    { label: t('notifications.inbox.detail.scheduled', 'Scheduled'), value: timestamp(log.scheduled_at) },
    { label: t('notifications.inbox.columns.read', 'Read'), value: timestamp(log.read_at) },
    { label: t('notifications.tab.archived', 'Archived'), value: timestamp(log.archived_at) },
    { label: t('notifications.inbox.detail.latency', 'Delivery latency'), value: log.latency_ms != null ? t('notifications.inbox.detail.milliseconds', '{{value}} ms', { value: fmtNumber(log.latency_ms) }) : '—' },
    { label: t('notifications.inbox.columns.type', 'Type'), value: log.event_type || (log.channel_id != null && log.channel_id > 0 ? t('notifications.inbox.legacyDelivery', 'Legacy channel delivery (original source not recorded)') : '—') },
    { label: t('notifications.inbox.filter.rule', 'Rule'), value: rule?.name ?? (log.alert_id != null ? t('notifications.inbox.source.ruleId', 'Rule #{{id}}', { id: log.alert_id }) : '—') },
    { label: t('notifications.inbox.filter.vehicle', 'Vehicle'), value: vehicle?.display_name || (rule?.vehicle_id != null ? `#${rule.vehicle_id}` : '—') },
    { label: t('notifications.inbox.detail.channel', 'Channel ID'), value: log.channel_id != null && log.channel_id > 0 ? log.channel_id : '—' },
    { label: t('notifications.inbox.columns.severity', 'Severity'), value: log.severity || '—' },
    { label: t('notifications.inbox.columns.status', 'Status'), value: <NotificationInboxDelivery status={log.status} /> },
  ];

  return (
    <section aria-label={t('notifications.inbox.detail.title', 'Notification details')} className="space-y-4 p-2 sm:p-3">
      <div>
        <PanelTitle>{t('notifications.inbox.columns.message', 'Message')}</PanelTitle>
        <Text variant="body" className="mt-2 whitespace-pre-wrap break-words">{log.message || '—'}</Text>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
            <dd className="mt-1 break-words text-sm text-[var(--text-secondary)]">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <PanelTitle>{t('notifications.inbox.detail.error', 'Delivery error')}</PanelTitle>
        <Text variant="bodySm" className="mt-1 whitespace-pre-wrap break-words">{log.error || '—'}</Text>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('notifications.inbox.detail.actions', 'Notification actions')}>
        {actions.map(action => (
          <Button key={action.id} size="sm" variant={action.destructive ? 'danger' : 'outline'} icon={action.icon} disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
