import { useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, AlertTriangle, Mail, MailOpen } from 'lucide-react';
import { DateTime, SeverityBadge } from '@/components/data-display';
import { Badge, Button, DataTable, Select, useTableExpansion, type Column, type ContextMenuItem, type PaginationProps } from '@/components/ui';
import type { AlertRule, NotificationLog, Vehicle } from '@/api/types';
import type { NotificationFilters } from '@/api/hooks/useNotifications';
import { notificationEventTypeFallback } from '@/lib/notificationEventType';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { NotificationInboxDetails } from './NotificationInboxDetails';
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
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { expandedKeys, setExpandedKeys, clear } = useTableExpansion<number>();
  const rowIds = rows.map(row => row.id).join(',');
  const vehicles = useMemo(() => Object.values(vehicleMap), [vehicleMap]);
  const rules = useMemo(() => Object.values(ruleMap), [ruleMap]);
  const readState = filters.read === undefined ? 'all' : filters.read ? 'read' : 'unread';
  useEffect(() => { clear(); }, [archived, rowIds, clear]);
  const sourceFor = (log: NotificationLog) => {
    const rule = log.alert_id != null ? ruleMap[log.alert_id] : undefined;
    const vehicle = rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined;
    return { rule, vehicle };
  };
  const columns = useMemo<Column<NotificationLog>[]>(() => [
    {
      key: 'received',
      header: t('notifications.inbox.columns.received', 'Received'),
      defaultWidth: 190,
      minWidth: 160,
      render: log => (
        <div className="space-y-1">
          {log.created_at && Number.isFinite(Date.parse(log.created_at)) ? <DateTime value={log.created_at} in="user" className="whitespace-nowrap tabular-nums" /> : '—'}
          {log.scheduled_at && <span className="block text-xs text-[var(--text-muted)]">{t('notifications.inbox.detail.scheduled', 'Scheduled')}</span>}
        </div>
      ),
    },
    {
      key: 'title',
      header: t('notifications.inbox.columns.title', 'Notification'),
      visibleOnMobile: true,
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
      render: log => (
        <div className="min-w-0 space-y-1 max-md:max-w-56">
          <Button
          type="button"
          variant="ghost"
          className="!h-auto !min-h-9 w-full !justify-start !px-0 !py-1 text-left"
          onClick={() => onActivate(log)}
          aria-label={t('notifications.inbox.row.open', 'Open notification: {{title}}', { title: log.title || '—' })}
        >
          <span className={cn('line-clamp-2 break-words', log.read_at ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]')}>
            {log.title || '—'}
          </span>
          </Button>
          <span className="block truncate text-xs text-[var(--text-muted)]" title={log.event_type}>
            {log.event_type ? t(`notifications.report.values.${log.event_type}`, notificationEventTypeFallback(log.event_type)) : '—'}
          </span>
          <span className="block text-xs text-[var(--text-muted)] md:hidden">
            {log.created_at && Number.isFinite(Date.parse(log.created_at)) ? <DateTime value={log.created_at} in="user" /> : '—'}
          </span>
          <span className="block text-xs text-[var(--text-secondary)] md:hidden">
            <NotificationInboxDelivery status={log.status} />
            <span aria-hidden="true"> · </span>
            {log.read_at ? t('notifications.inbox.columns.read', 'Read') : t('notifications.inbox.columns.unread', 'Unread')}
          </span>
        </div>
      ),
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
          className="!h-auto !min-h-9 w-full !justify-start !px-0 !py-1 text-left"
          onClick={() => onActivate(log)}
          aria-label={t('notifications.inbox.row.readMessage', 'Read full message: {{title}}', { title: log.title || '—' })}
        >
          <span className="line-clamp-2 break-words text-[var(--text-secondary)]" title={log.message}>{log.message || '—'}</span>
        </Button>
      ),
    },
    {
      key: 'type',
      header: t('notifications.inbox.columns.type', 'Type'),
      defaultVisible: false,
      defaultWidth: 200,
      render: log => <span title={log.event_type}>{log.event_type ? t(`notifications.report.values.${log.event_type}`, notificationEventTypeFallback(log.event_type)) : '—'}</span>,
    },
    {
      key: 'source',
      header: t('notifications.inbox.columns.source', 'Source'),
      defaultWidth: 200,
      minWidth: 140,
      filterActive: Boolean(filters.vehicle_id?.length || filters.rule_id?.length || filters.source),
      onFilterClear: () => onFiltersChange({ ...filters, vehicle_id: undefined, rule_id: undefined, source: undefined }),
      filter: <NotificationFilterBar section="source" filters={filters} onChange={onFiltersChange} vehicles={vehicles} rules={rules} />,
      render: log => {
        const rule = log.alert_id != null ? ruleMap[log.alert_id] : undefined;
        const vehicle = rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined;
        const label = rule?.name
          ?? (log.alert_id != null
            ? t('notifications.inbox.source.ruleId', 'Rule #{{id}}', { id: log.alert_id })
            : log.event_type
              ? t(`notifications.report.values.${log.event_type.split('.')[0]}`, notificationEventTypeFallback(log.event_type.split('.')[0]))
              : log.channel_id != null && log.channel_id > 0
                ? t('notifications.inbox.source.legacyDelivery', 'Legacy channel delivery')
                : t('notifications.inbox.source.unknown', 'Unknown source'));
        return (
          <div className="min-w-0 space-y-1">
            <span className="block truncate font-medium text-[var(--text-primary)]" title={label}>{label}</span>
            <span className="block truncate text-xs text-[var(--text-muted)]" title={log.channel_id != null && log.channel_id > 0 && !log.event_type ? t('notifications.inbox.source.legacyHint', 'Original source was not recorded for this older channel delivery.') : undefined}>
              {vehicle?.display_name || (rule?.vehicle_id != null ? `#${rule.vehicle_id}` : '—')}
            </span>
          </div>
        );
      },
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
        ? <SeverityBadge severity={log.severity} size="sm">{t(`notifications.inbox.filter.severity.${log.severity === 'warning' ? 'warn' : log.severity}`, log.severity === 'critical' ? 'Critical' : log.severity === 'info' ? 'Info' : 'Warn')}</SeverityBadge>
        : <Badge variant="neutral" size="sm">{log.severity || '—'}</Badge>,
    },
    {
      key: 'status',
      header: t('notifications.inbox.columns.status', 'Status'),
      visibleOnMobile: true,
      defaultWidth: 160,
      minWidth: 130,
      render: log => (
        <div className="space-y-1">
          <Badge size="sm" variant={log.status === 'failed' ? 'danger' : log.status === 'sent' ? 'success' : 'neutral'}>
            <NotificationInboxDelivery status={log.status} />
          </Badge>
          {log.error && <span className="flex items-center gap-1 text-xs text-red-700 dark:text-red-300" title={log.error}>
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            {t('notifications.inbox.detail.error', 'Delivery error')}
          </span>}
          <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] md:hidden">
            {log.read_at ? <MailOpen className="h-3 w-3" aria-hidden="true" /> : <Mail className="h-3 w-3" aria-hidden="true" />}
            {log.read_at ? t('notifications.inbox.columns.read', 'Read') : t('notifications.inbox.columns.unread', 'Unread')}
          </span>
        </div>
      ),
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
      render: log => <Button size="sm" variant="ghost" onClick={() => onActivate(log)} icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
        aria-label={t('notifications.inbox.row.inspect', 'Inspect notification: {{title}}', { title: log.title || '—' })}>
        {t('notifications.inbox.columns.inspect', 'Inspect')}
      </Button>,
    },
  ], [onActivate, ruleMap, vehicleMap, t, readState, filters, onFiltersChange, vehicles, rules, isMobile]);

  return (
    <div className="min-w-0 w-full max-w-full">
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
      mobileColumns={['title']}
      className="min-w-0 w-full max-w-full max-md:[&_th]:!w-auto max-md:[&_th]:!min-w-0"
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
