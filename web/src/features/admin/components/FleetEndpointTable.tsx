import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { FleetEndpoint } from '@/api/hooks/useSettings';
import { Badge, Code, CopyButton, DataTable, Text, Toggle, Tooltip, type Column } from '@/components/ui';

type TableProps = ComponentProps<typeof DataTable<FleetEndpoint>>;

function endpointLabel(endpoint: FleetEndpoint): string {
  return (endpoint.key.split('.').pop() ?? endpoint.key).replace(/_/g, ' ');
}

interface FleetEndpointTableProps {
  endpoints: FleetEndpoint[];
  candidates: FleetEndpoint[];
  access: Record<string, boolean>;
  auto: Record<string, boolean>;
  pollingEnabled: boolean;
  pending: boolean;
  tableId: string;
  onEnable: (endpoint: FleetEndpoint) => void;
  onAuto: (key: string) => void;
  headerAccess?: ReactNode;
  headerAuto?: ReactNode;
  grouping?: TableProps['rowGrouping'];
  controls?: TableProps['controls'];
  toolbarActions?: TableProps['toolbarActions'];
}

export function FleetEndpointTable({
  endpoints, candidates, access, auto, pollingEnabled, pending, tableId, onEnable, onAuto,
  headerAccess, headerAuto, grouping, controls, toolbarActions,
}: FleetEndpointTableProps) {
  const { t } = useTranslation();
  const columns: Column<FleetEndpoint>[] = [
    {
      key: 'method',
      header: t('fleetApi.controls.method', 'Method'),
      fixedWidth: 112,
      filterValue: (endpoint) => endpoint.method,
      exportFields: [{ key: 'method', header: t('fleetApi.controls.byMethod', 'HTTP method'), value: endpoint => endpoint.method }],
      render: (endpoint) => <Badge variant={endpoint.method === 'GET' ? 'info' : 'warning'} size="sm">{endpoint.method}</Badge>,
    },
    {
      key: 'operation',
      header: t('fleetApi.controls.endpoint', 'Endpoint'),
      required: true,
      filterValue: (endpoint) => endpoint.key,
      additionalValueFilters: [{ key: 'path', header: t('fleetApi.controls.sortPath', 'API path'), filterValue: endpoint => endpoint.path }],
      exportFields: [
        { key: 'operation', header: t('fleetApi.controls.sortName', 'Operation'), value: endpoint => endpoint.key },
        { key: 'path', header: t('fleetApi.controls.sortPath', 'API path'), value: endpoint => endpoint.path },
      ],
      render: (endpoint) => <div className="group flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <Text as="p" size="sm" weight="medium">{endpointLabel(endpoint)}</Text>
          <Code className="block break-all text-[var(--text-secondary)]">{endpoint.path}</Code>
        </div>
        <CopyButton text={endpoint.path} iconOnly
          className="min-h-11 min-w-11 shrink-0 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          ariaLabel={t('fleetApi.copyPath', 'Copy {{path}}', { path: endpoint.path })} />
      </div>,
    },
    {
      key: 'access',
      header: t('fleetApi.controls.enabled', 'Access'),
      fixedWidth: 128,
      headerAction: headerAccess,
      groupStart: true,
      align: 'center',
      filterValue: (endpoint) => access[endpoint.key] ?? null,
      exportValue: (endpoint) => typeof access[endpoint.key] === 'boolean' ? access[endpoint.key] : null,
      filterValueLabel: (value) => value == null ? '—' : value ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled'),
      render: (endpoint) => (
        <Toggle
          checked={!!access[endpoint.key]}
          onChange={() => onEnable(endpoint)}
          disabled={pending}
          size="sm"
          aria-label={`${t('fleetApi.controls.enable', 'Enable')} ${endpoint.method} ${endpoint.path}`}
        />
      ),
    },
    {
      key: 'auto',
      header: t('fleetApi.controls.autoPoll', 'Auto-poll'),
      fixedWidth: 128,
      headerAction: headerAuto,
      align: 'center',
      filterValue: (endpoint) => endpoint.pollable && access[endpoint.key] != null && auto[endpoint.key] != null
        ? access[endpoint.key] && auto[endpoint.key]
        : null,
      exportValue: (endpoint) => endpoint.pollable
        && typeof access[endpoint.key] === 'boolean' && typeof auto[endpoint.key] === 'boolean'
        ? access[endpoint.key] && auto[endpoint.key]
        : null,
      filterValueLabel: (value) => value == null ? '—' : value ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled'),
      render: (endpoint) => endpoint.pollable ? (
        <Tooltip multiline content={!pollingEnabled
          ? t('fleetApi.controls.pausedHint', 'Turn on Tesla API Polling to change auto-poll selections. Existing selections are retained while paused.')
          : !access[endpoint.key] ? t('fleetApi.allowBeforePolling', 'Allow this endpoint before selecting auto-poll.')
            : t('fleetApi.controls.bulkHint', 'Auto-poll selects only enabled routes with a scheduled job.')}>
        <Toggle
          checked={!!access[endpoint.key] && !!auto[endpoint.key]}
          onChange={() => onAuto(endpoint.key)}
          disabled={pending || !access[endpoint.key] || !pollingEnabled}
          focusableWhenDisabled
          size="sm"
          aria-label={`${t('fleetApi.controls.poll', 'Auto-poll')} ${endpoint.method} ${endpoint.path}`}
        />
        </Tooltip>
      ) : null,
    },
  ];

  return (
    <DataTable
      tableId={tableId}
      name={t('fleetApi.controls.title', 'Endpoint access')}
      columns={columns}
      data={endpoints}
      filterData={candidates}
      keyExtractor={(endpoint) => endpoint.key}
      rowLabel={endpointLabel}
      enableValueFilters
      density="compact"
      resizable={false}
      exportable
      showExportDescription={false}
      rowGrouping={grouping}
      controls={controls}
      toolbarActions={toolbarActions}
      showDensityControl
      mobilePresentation={{
        roles: { operation: 'title', method: 'badge' },
        controlsInToolbar: true,
        showRowCount: false,
        compactRows: true,
        displayValue: (endpoint, key) => key === 'operation'
          ? endpointLabel(endpoint)
          : key === 'method' ? endpoint.method : null,
        canShowField: key => key !== 'access' && key !== 'auto',
      }}
      emptyMessage={t('fleetApi.controls.noMatches', 'No API routes match that search.')}
    />
  );
}
