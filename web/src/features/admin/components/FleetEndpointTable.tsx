import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { FleetEndpoint } from '@/api/hooks/useSettings';
import { Badge, Code, CopyButton, DataTable, Text, type Column } from '@/components/ui';
import type { FleetPermission } from '../lib/fleetEndpointPolicy';
import { FleetEndpointPermissionCell } from './FleetEndpointPermissionCell';

type TableProps = ComponentProps<typeof DataTable<FleetEndpoint>>;

function endpointLabel(endpoint: FleetEndpoint): string {
  return (endpoint.key.split('.').pop() ?? endpoint.key).replace(/_/g, ' ');
}

interface FleetEndpointTableProps {
  endpoints: FleetEndpoint[];
  candidates: FleetEndpoint[];
  access: Record<string, boolean>;
  auto: Record<string, boolean>;
  smart?: Record<string, boolean>;
  pollingEnabled: boolean;
  pollingStatusKnown?: boolean;
  pending: boolean;
  tableId: string;
  onEnable: (endpoint: FleetEndpoint) => void;
  onAuto: (key: string) => void;
  onSmart?: (key: string) => void;
  grouping?: TableProps['rowGrouping'];
  controls?: TableProps['controls'];
  toolbarActions?: TableProps['toolbarActions'];
  savedViews?: TableProps['savedViews'];
  selectedKeys?: TableProps['selectedKeys'];
  onSelectionChange?: TableProps['onSelectionChange'];
  bulkActions?: TableProps['bulkActions'];
  queryReset?: number;
  categoryLabel?: (category: string) => string;
  onClear?: () => void;
}

export function FleetEndpointTable({
  endpoints, candidates, access, auto, smart, pollingEnabled, pollingStatusKnown = true, pending, tableId,
  onEnable, onAuto, onSmart, grouping, controls, toolbarActions, savedViews, selectedKeys, onSelectionChange,
  bulkActions, queryReset, categoryLabel, onClear,
}: FleetEndpointTableProps) {
  const { t } = useTranslation();
  const methodLabel = t('fleetApi.controls.method', 'Method');
  const pathLabel = t('fleetApi.controls.sortPath', 'API path');
  const categoryHeader = t('fleetApi.controls.byCategory', 'Category');
  const identityLabel = t('fleetApi.controls.endpoint', 'Endpoint');
  const labels = {
    access: t('fleetApi.controls.enabled', 'Access'),
    smart: t('fleetApi.controls.smart', 'Smart Features'),
    auto: t('fleetApi.controls.autoPoll', 'Auto-poll'),
  };
  const states = {
    allowed: t('fleetApi.polling.allowedState', 'Allowed'),
    blocked: t('fleetApi.redesign.blocked', 'Blocked'),
    unavailable: t('fleetApi.redesign.noAccess', 'No access'),
    unknown: t('fleetApi.redesign.unknown', 'Unknown'),
    off: t('fleetApi.polling.off', 'Off'),
    onDemand: t('fleetApi.redesign.onDemand', 'On demand only'),
    scheduled: t('fleetApi.redesign.scheduled', 'Scheduled'),
    paused: t('fleetApi.redesign.selectedPaused', 'Selected · paused'),
    selected: t('fleetApi.redesign.selected', 'Selected'),
  };
  const value = (endpoint: FleetEndpoint, kind: FleetPermission): boolean | null => {
    const allowed = access[endpoint.key];
    if (typeof allowed !== 'boolean') return null;
    if (kind === 'access') return allowed;
    if (kind === 'smart') return smart ? allowed && Boolean(smart[endpoint.key]) : null;
    const automatic = auto[endpoint.key];
    return endpoint.pollable && typeof automatic === 'boolean' ? allowed && automatic : null;
  };
  const state = (endpoint: FleetEndpoint, kind: FleetPermission): keyof typeof states => {
    const allowed = access[endpoint.key];
    if (kind === 'auto' && !endpoint.pollable) return 'onDemand';
    if (typeof allowed !== 'boolean') return 'unknown';
    if (kind === 'access') return allowed ? 'allowed' : 'blocked';
    if (!allowed) return 'unavailable';
    const enabled = value(endpoint, kind);
    if (enabled == null) return 'unknown';
    if (!enabled) return 'off';
    if (kind === 'smart') return 'allowed';
    return !pollingStatusKnown ? 'selected' : pollingEnabled ? 'scheduled' : 'paused';
  };
  const permissionColumn = (kind: FleetPermission): Column<FleetEndpoint> => ({
    key: kind, header: labels[kind], fixedWidth: kind === 'smart' ? 172 : 160,
    groupStart: kind === 'access',
    filterValue: endpoint => state(endpoint, kind),
    filterValueLabel: (_, endpoint) => states[state(endpoint, kind)],
    sortValue: endpoint => value(endpoint, kind) == null ? null : value(endpoint, kind) ? 0 : 1,
    exportValue: endpoint => value(endpoint, kind),
    render: endpoint => {
      const status = state(endpoint, kind);
      const disabled = pending || (kind !== 'access' && !access[endpoint.key]);
      const help = kind === 'smart' ? !access[endpoint.key]
        ? t('fleetApi.controls.allowBeforeSmart', 'Allow this endpoint before enabling it for Smart Features.')
        : t('fleetApi.controls.smartHint', 'Permit Smart Features to call this endpoint when their own setup and consent allow it.')
        : kind === 'auto' ? !access[endpoint.key]
          ? t('fleetApi.allowBeforePolling', 'Allow this endpoint before selecting auto-poll.')
          : pollingStatusKnown && !pollingEnabled
            ? t('fleetApi.redesign.editWhilePaused', 'Scheduling is paused. You can still change this selection.')
            : t('fleetApi.controls.bulkHint', 'Auto-poll selects only enabled routes with a scheduled job.')
          : undefined;
      const name = kind === 'smart'
        ? t('fleetApi.controls.smartFor', 'Smart Features: {{method}} {{path}}', { method: endpoint.method, path: endpoint.path })
        : `${kind === 'access' ? t('fleetApi.controls.enable', 'Enable') : labels.auto} ${endpoint.method} ${endpoint.path}`;
      const onChange = kind === 'access' ? () => onEnable(endpoint)
        : kind === 'auto' ? endpoint.pollable ? () => onAuto(endpoint.key) : undefined
          : onSmart ? () => onSmart(endpoint.key) : undefined;
      return <FleetEndpointPermissionCell label={labels[kind]} state={states[status]} name={name}
        checked={value(endpoint, kind) === true} disabled={disabled} help={help} onChange={onChange} />;
    },
  });
  const permissions = [permissionColumn('access'), ...(smart ? [permissionColumn('smart')] : []), permissionColumn('auto')];
  const columns: Column<FleetEndpoint>[] = [
    {
      key: 'operation', header: identityLabel, required: true, pinned: true, fixedWidth: 245,
      filterValue: endpoint => endpoint.key, sortValue: endpointLabel,
      exportFields: [{ key: 'operation', header: t('fleetApi.controls.sortName', 'Operation'), value: endpoint => endpoint.key }],
      render: endpoint => <div className="group flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1">
          <Text as="p" size="sm" weight="semibold" className="break-words">{endpointLabel(endpoint)}</Text>
          <Code className="block break-all text-[var(--text-secondary)]">{endpoint.path}</Code>
        </div>
        <CopyButton text={endpoint.path} iconOnly
          className="min-h-11 min-w-11 shrink-0 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          ariaLabel={t('fleetApi.copyPath', 'Copy {{path}}', { path: endpoint.path })} />
      </div>,
    },
    {
      key: 'method', header: methodLabel, fixedWidth: 116, filterValue: endpoint => endpoint.method,
      sortValue: endpoint => endpoint.method,
      exportFields: [{ key: 'method', header: t('fleetApi.controls.byMethod', 'HTTP method'), value: endpoint => endpoint.method }],
      render: endpoint => <Badge variant={endpoint.method === 'GET' ? 'info' : 'warning'} size="sm">{endpoint.method}</Badge>,
    },
    {
      key: 'path', header: pathLabel, defaultVisible: false, fixedWidth: 238,
      filterValue: endpoint => endpoint.path, sortValue: endpoint => endpoint.path, exportValue: endpoint => endpoint.path,
      render: endpoint => <Code className="break-all">{endpoint.path}</Code>,
    },
    {
      key: 'category', header: categoryHeader, defaultVisible: false, fixedWidth: 160,
      filterValue: endpoint => endpoint.category, sortValue: endpoint => categoryLabel?.(endpoint.category) ?? endpoint.category,
      filterValueLabel: (_, endpoint) => categoryLabel?.(endpoint.category) ?? endpoint.category,
      exportValue: endpoint => endpoint.category,
      render: endpoint => <Text size="sm">{categoryLabel?.(endpoint.category) ?? endpoint.category}</Text>,
    },
    ...permissions,
  ];

  return (
    <DataTable
      tableId={tableId}
      name={t('fleetApi.controls.title', 'Endpoint access')}
      columns={columns}
      data={endpoints}
      filterData={candidates}
      keyExtractor={endpoint => endpoint.key}
      rowLabel={endpointLabel}
      defaultSort={savedViews ? { key: 'operation', direction: 'asc' } : undefined}
      enableValueFilters
      queryResetKey={queryReset}
      resizable={false}
      exportable
      includeFullExport
      exportColumns="all"
      showExportDescription={false}
      rowGrouping={grouping}
      controls={controls}
      toolbarActions={toolbarActions}
      savedViews={savedViews}
      selectable={onSelectionChange ? 'multi' : 'none'}
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
      pruneSelectionOnFilter
      showMatchingCount
      pagination={savedViews ? { defaultPageSize: 50, pageSizeOptions: [10, 25, 50, 100] } : undefined}
      bulkActions={bulkActions}
      comparison={[
        { key: 'method', label: methodLabel, value: endpoint => endpoint.method },
        { key: 'path', label: pathLabel, value: endpoint => <Code className="break-all">{endpoint.path}</Code> },
        { key: 'category', label: categoryHeader, value: endpoint => categoryLabel?.(endpoint.category) ?? endpoint.category },
        ...permissions.map(column => ({
          key: column.key, label: column.header,
          value: (endpoint: FleetEndpoint) => states[state(endpoint, column.key as FleetPermission)],
        })),
      ]}
      showDensityControl
      mobilePresentation={{
        roles: { operation: 'title', method: 'badge', category: 'meta' },
        showRowCount: false,
        columnToolsInPicker: true,
        compactRows: true,
        displayValue: (endpoint, key) => key === 'operation' ? endpointLabel(endpoint)
          : key === 'method' ? endpoint.method
            : key === 'category' ? categoryLabel?.(endpoint.category) ?? endpoint.category : null,
        inlineActions: (endpoint, visible) => <>
          <Code className="w-full break-all text-[var(--text-secondary)]">{endpoint.path}</Code>
          <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-2">
            {permissions.filter(column => visible.has(column.key)).map(column => <div key={column.key} className="min-w-0">
              <Text as="p" variant="caption">{column.header}</Text>
              {column.render(endpoint)}
            </div>)}
          </div>
        </>,
        onClear,
      }}
      emptyMessage={t('fleetApi.controls.noMatches', 'No API routes match that search.')}
    />
  );
}
