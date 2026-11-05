import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { FleetEndpoint } from '@/api/hooks/useSettings';
import { Badge, Caption, Code, CopyButton, DataTable, Text, Toggle, Tooltip, type Column } from '@/components/ui';

type TableProps = ComponentProps<typeof DataTable<FleetEndpoint>>;

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
  grouping?: TableProps['rowGrouping'];
  controls?: TableProps['controls'];
  toolbarActions?: TableProps['toolbarActions'];
}

export function FleetEndpointTable({
  endpoints, candidates, access, auto, pollingEnabled, pending, tableId, onEnable, onAuto, grouping, controls, toolbarActions,
}: FleetEndpointTableProps) {
  const { t } = useTranslation();
  const columns: Column<FleetEndpoint>[] = [
    {
      key: 'method',
      header: t('fleetApi.controls.byMethod', 'HTTP method'),
      filterValue: (endpoint) => endpoint.method,
      render: (endpoint) => <Badge variant={endpoint.method === 'GET' ? 'info' : 'warning'} size="sm">{endpoint.method}</Badge>,
    },
    {
      key: 'operation',
      header: t('fleetApi.controls.sortName', 'Operation'),
      filterValue: (endpoint) => endpoint.key,
      exportValue: (endpoint) => endpoint.key,
      render: (endpoint) => <Text size="sm" weight="medium">{(endpoint.key.split('.').pop() ?? endpoint.key).replace(/_/g, ' ')}</Text>,
    },
    {
      key: 'path',
      header: t('fleetApi.controls.sortPath', 'API path'),
      filterValue: (endpoint) => endpoint.path,
      exportValue: (endpoint) => endpoint.path,
      render: (endpoint) => <div className="flex items-start gap-1">
        <Code className="block max-w-80 break-all text-[var(--text-secondary)]">{endpoint.path}</Code>
        <CopyButton text={endpoint.path} iconOnly className="min-h-11 min-w-11"
          ariaLabel={t('fleetApi.copyPath', 'Copy {{path}}', { path: endpoint.path })} />
      </div>,
    },
    {
      key: 'access',
      header: t('fleetApi.controls.enabled', 'Access'),
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
        <span className="inline-flex" tabIndex={!pollingEnabled || !access[endpoint.key] ? 0 : undefined}>
        <Toggle
          checked={!!access[endpoint.key] && !!auto[endpoint.key]}
          onChange={() => onAuto(endpoint.key)}
          disabled={pending || !access[endpoint.key] || !pollingEnabled}
          size="sm"
          aria-label={`${t('fleetApi.controls.poll', 'Auto-poll')} ${endpoint.method} ${endpoint.path}`}
        />
        </span>
        </Tooltip>
      ) : (
        <Caption title={t('fleetApi.controls.onDemandOnly', 'Not scheduled')} aria-label={t('fleetApi.controls.onDemandOnly', 'Not scheduled')}>—</Caption>
      ),
    },
  ];

  return (
    <DataTable
      tableId={tableId}
      columns={columns}
      data={endpoints}
      filterData={candidates}
      keyExtractor={(endpoint) => endpoint.key}
      enableValueFilters
      rowGrouping={grouping}
      controls={controls}
      toolbarActions={toolbarActions}
      showDensityControl
      emptyMessage={t('fleetApi.controls.noMatches', 'No API routes match that search.')}
    />
  );
}
