import { useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Mail, MailOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DateTime, SeverityBadge } from '@/components/data-display';
import { Badge, Button, DataTable, Select, useTableExpansion, type Column, type ContextMenuItem, type PaginationProps } from '@/components/ui';
import type { AlertRule, NotificationLog, Vehicle } from '@/api/types';
import type { NotificationFilters } from '@/api/hooks/useNotifications';
import { notificationEventTypeLabel } from '@/lib/notificationEventType';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { NotificationInboxDetails } from './NotificationInboxDetails';
import { NotificationInboxSummary } from './NotificationInboxSummary';
import { NotificationInboxDelivery } from './NotificationInboxDelivery';
import { NotificationFilterBar } from './NotificationFilterBar';
import type { TableControls } from '@/components/forms';

interface NotificationInboxTableProps {
  rows: NotificationLog[];
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
  onActivate: (log: NotificationLog) => void;
  onContextMenu: (log: NotificationLog) => ContextMenuItem[];
  ruleMap: Record<number, AlertRule>;
  vehicleMap: Record<number, Vehicle>;
  archived: boolean;
  toolbarActions?: ReactNode;
  toolbarHeading?: ReactNode;
  controls?: TableControls;
  paginationControls?: PaginationProps;
  filters: NotificationFilters;
  onFiltersChange: (next: NotificationFilters) => void;
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
  toolbarActions,
  toolbarHeading,
  controls,
  paginationControls,
  filters,
  onFiltersChange,
}: NotificationInboxTableProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const { formatDateTime } = useDateFormat('user');
  const severityLabels: Record<string, string> = {
    "info": t("notifications.inbox.filter.severity.info", "Info"),
    "warn": t("notifications.inbox.filter.severity.warn", "Warn"),
    "critical": t("notifications.inbox.filter.severity.critical", "Critical"),
  };

  const isMobile = useMediaQuery('(max-width: 1279px)');
  const { expandedKeys, setExpandedKeys, clear } = useTableExpansion<number>();
  const rowIds = rows.map(row => row.id).join(',');
  const vehicles = useMemo(() => Object.values(vehicleMap), [vehicleMap]);
  const rules = useMemo(() => Object.values(ruleMap), [ruleMap]);
  const readState = filters.read === undefined ? 'all' : filters.read ? 'read' : 'unread';
  useEffect(() => { clear(); }, [archived, rowIds, clear]);
  const sourceFor = (log: NotificationLog) => {
    const rule = log.alert_id != null ? ruleMap[log.alert_id] : undefined;
    const vehicle = log.vehicle_id != null ? vehicleMap[log.vehicle_id] : undefined;
    return { rule, vehicle };
  };
  const columns = useMemo<Column<NotificationLog>[]>(() => [
    {
      key: 'received',
      header: t('notifications.inbox.columns.received', 'Received'),
      defaultWidth: 190,
      minWidth: 160,
      render: log => log.created_at && Number.isFinite(Date.parse(log.created_at)) ? <DateTime value={log.created_at} in="user" className="whitespace-nowrap tabular-nums" /> : null,
    },
    {
      key: 'title',
      header: t('notifications.inbox.columns.title', 'Notification'),
      visibleOnMobile: true,
      required: true,
      defaultWidth: 300,
      minWidth: 210,
      filterActive: Boolean(filters.q || (isMobile && (filters.severity?.length || filters.vehicle_id?.length || filters.rule_id?.length || filters.source || filters.read !== undefined))),
      onFilterClear: () => onFiltersChange({
        ...filters,
        q: undefined,
        ...(isMobile ? { severity: undefined, vehicle_id: undefined, rule_id: undefined, source: undefined, read: undefined } : {}),
      }),
      filter: <NotificationFilterBar section={isMobile ? 'all' : 'search'} includeReadState={isMobile}
        filters={filters} onChange={onFiltersChange} vehicles={vehicles} rules={rules} />,
      render: log => <NotificationInboxSummary log={log} onActivate={onActivate} />,
    },
    {
      key: 'message',
      header: t('notifications.inbox.columns.message', 'Message'),
      defaultWidth: 250,
      minWidth: 180,
      render: log => (
        <Button
          type="button"
          variant="ghost"
          className="!h-auto !min-h-11 md:!min-h-9 w-full !justify-start !px-0 !py-1 text-left"
          onClick={() => onActivate(log)}
          aria-label={t('notifications.inbox.row.readMessage', 'Read full message: {{title}}', { title: log.title || '—' })}
        >
          <span className="whitespace-pre-wrap break-words text-[var(--text-secondary)]">{log.message}</span>
        </Button>
      ),
    },
    {
      key: 'type',
      header: t('notifications.inbox.columns.type', 'Type'),
      defaultVisible: false,
      defaultWidth: 200,
      render: log => notificationEventTypeLabel(log.event_type, t),
    },
    {
      key: 'vehicle',
      header: t('notifications.inbox.filter.vehicle', 'Vehicle'),
      defaultWidth: 160,
      minWidth: 140,
      filterActive: Boolean(filters.vehicle_id?.length || filters.rule_id?.length || filters.source),
      onFilterClear: () => onFiltersChange({ ...filters, vehicle_id: undefined, rule_id: undefined, source: undefined }),
      filter: <NotificationFilterBar section="source" filters={filters} onChange={onFiltersChange} vehicles={vehicles} rules={rules} />,
      render: log => log.vehicle_id != null ? vehicleMap[log.vehicle_id]?.display_name || `#${log.vehicle_id}` : null,
    },
    {
      key: 'rule',
      header: t('notifications.inbox.filter.rule', 'Rule'),
      defaultVisible: false,
      defaultWidth: 220,
      render: log => log.alert_id != null ? <Link to={`/notifications/rules?rule=${log.alert_id}`} className="underline underline-offset-2">{ruleMap[log.alert_id]?.name || t('notifications.inbox.source.ruleId', 'Rule #{{id}}', { id: log.alert_id })}</Link> : null,
    },
    {
      key: 'channel',
      header: t('notifications.inbox.columns.channel', 'Channel'),
      defaultVisible: false,
      defaultWidth: 160,
      render: log => log.channel_id != null && log.channel_id > 0 ? t('notifications.inbox.channelNumber', 'Channel #{{id}}', { id: log.channel_id }) : null,
    },
    {
      key: 'severity',
      header: t('notifications.inbox.columns.severity', 'Severity'),
      defaultWidth: 130,
      minWidth: 110,
      filterActive: Boolean(filters.severity?.length),
      onFilterClear: () => onFiltersChange({ ...filters, severity: undefined }),
      filter: <NotificationFilterBar section="severity" filters={filters} onChange={onFiltersChange} vehicles={vehicles} rules={rules} />,
      render: log => ['info', 'warn', 'warning', 'critical'].includes(log.severity ?? '')
        ? <SeverityBadge severity={log.severity} size="sm">{severityLabels[log.severity === 'warning' ? 'warn' : log.severity!]}</SeverityBadge>
        : <Badge variant="neutral" size="sm">{log.severity || '—'}</Badge>,
    },
    {
      key: 'status',
      defaultVisible: false,
      header: t('notifications.inbox.columns.status', 'Status'),
      visibleOnMobile: true,
      defaultWidth: 160,
      minWidth: 130,
      render: log => <Badge size="sm" variant={log.status === 'failed' ? 'danger' : log.status === 'sent' ? 'success' : 'neutral'}>
        <NotificationInboxDelivery status={log.status} />
      </Badge>,
    },
    {
      key: 'delivery',
      header: t('notifications.inbox.columns.delivery', 'Delivery'),
      defaultVisible: false,
      defaultWidth: 190,
      render: log => log.sent_at ? <DateTime value={log.sent_at} in="user" /> : log.latency_ms != null ? t('notifications.inbox.detail.milliseconds', '{{value}} ms', { value: fmtInt(log.latency_ms) }) : null,
    },
    {
      key: 'read',
      header: t('notifications.inbox.columns.readState', 'Read state'),
      defaultWidth: 130,
      minWidth: 110,
      filterActive: readState !== 'all',
      onFilterClear: () => onFiltersChange({ ...filters, read: undefined }),
      filter: <Select size="sm" value={readState} onChange={event => {
        const value = event.target.value;
        if (value === 'all' || value === 'read' || value === 'unread') onFiltersChange({ ...filters, read: value === 'all' ? undefined : value === 'read' });
      }} aria-label={t('notifications.inbox.filter.readState', 'Filter by read state')} options={[
        { value: 'all', label: t('notifications.inbox.filter.allReadStates', 'All read states') },
        { value: 'read', label: t('notifications.inbox.columns.read', 'Read') },
        { value: 'unread', label: t('notifications.inbox.columns.unread', 'Unread') },
      ]} />,
      render: log => <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        {log.read_at ? <MailOpen className="h-3.5 w-3.5" aria-hidden="true" /> : <Mail className="h-3.5 w-3.5" aria-hidden="true" />}
        {log.read_at ? t('notifications.inbox.columns.read', 'Read') : t('notifications.inbox.columns.unread', 'Unread')}
      </span>,
    },
    {
      key: 'inspect',
      header: t('notifications.inbox.columns.inspect', 'Inspect'),
      defaultWidth: 100,
      minWidth: 90,
      render: log => <Button size="sm" variant="ghost" className="max-md:!h-auto max-md:!min-h-11" onClick={() => onActivate(log)} icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
        aria-label={t('notifications.inbox.row.inspect', 'Inspect notification: {{title}}', { title: log.title || '—' })}>
        {t('notifications.inbox.columns.inspect', 'Inspect')}
      </Button>,
    },
  ], [onActivate, ruleMap, vehicleMap, t, readState, filters, onFiltersChange, vehicles, rules, isMobile, fmtInt]);

  return (
    <div className="min-w-0 w-full max-w-full @container">
    <DataTable
      tableId={archived ? 'notifications:archive' : 'notifications:inbox'}
      caption={archived ? t('notifications.tab.archived', 'Archived') : t('notifications.inbox.title', 'Inbox')}
      columns={columns}
      toolbarActions={toolbarActions}
      toolbarHeading={toolbarHeading}
      controls={controls}
      showDensityControl
      paginationControls={paginationControls}
      data={rows}
      keyExtractor={log => log.id}
      rowLabel={log => log.title || t('notifications.inbox.columns.title', 'Notification')}
      selectable="multi"
      selectedKeys={selectedIds}
      onSelectionChange={keys => onSelectionChange(keys.filter((key): key is number => typeof key === 'number'))}
      showSelectionSummary={false}
      rowContextMenu={onContextMenu}
      mobilePresentation={{
        roles: { title: 'title', message: 'primary', received: 'meta', vehicle: 'meta', severity: 'badge', read: 'meta', inspect: 'hidden' },
        canShowField: (key, log) => {
          if (key === 'inspect') return false;
          if (key === 'vehicle') return log.vehicle_id != null;
          if (key === 'rule') return log.alert_id != null;
          if (key === 'channel') return log.channel_id != null && log.channel_id > 0;
          if (key === 'delivery') return Boolean(log.sent_at) || log.latency_ms != null;
          if (key === 'type') return Boolean(log.event_type);
          if (key === 'severity') return Boolean(log.severity);
          if (key === 'message') return Boolean(log.message);
          return true;
        },
        displayValue: (log, key) => {
          if (key === 'title') return log.title;
          if (key === 'message') return log.message;
          if (key === 'received') return formatDateTime(log.created_at);
          if (key === 'vehicle') return log.vehicle_id != null ? vehicleMap[log.vehicle_id]?.display_name || `#${log.vehicle_id}` : null;
          if (key === 'severity') return severityLabels[log.severity === 'warning' ? 'warn' : log.severity ?? ''] ?? log.severity;
          if (key === 'read') return log.read_at ? t('notifications.inbox.columns.read', 'Read') : t('notifications.inbox.columns.unread', 'Unread');
          return null;
        },
        onOpenRow: onActivate,
      }}
      className="min-w-0 w-full max-w-full max-xl:[&_th[data-column-key]]:!w-auto max-xl:[&_th[data-column-key]]:!min-w-0"
      density="compact"
      columnVisibility
      columnReorder
      resizable
      enableValueFilters={false}
      emptyMessage=""
      expandable
      expandedKeys={expandedKeys}
      onExpandedChange={keys => setExpandedKeys(keys.filter((key): key is number => typeof key === 'number'))}
      renderExpanded={log => {
        const { rule, vehicle } = sourceFor(log);
        return <NotificationInboxDetails log={log} rule={rule} vehicle={vehicle} actions={onContextMenu(log)} />;
      }}
    />
    </div>
  );
}
