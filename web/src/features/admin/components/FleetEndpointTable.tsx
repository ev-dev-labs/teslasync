import { useTranslation } from 'react-i18next';
import type { FleetEndpoint } from '@/api/hooks/useSettings';
import { Badge, Caption, Code, DataTable, Text, Toggle, type Column } from '@/components/ui';

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
}

export function FleetEndpointTable({
  endpoints, candidates, access, auto, pollingEnabled, pending, tableId, onEnable, onAuto,
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
      render: (endpoint) => <Text size="sm" weight="medium">{endpoint.key.replace(/\./g, ' › ').replace(/_/g, ' ')}</Text>,
    },
    {
      key: 'path',
      header: t('fleetApi.controls.sortPath', 'API path'),
      filterValue: (endpoint) => endpoint.path,
      render: (endpoint) => <Code className="block break-all">{endpoint.path}</Code>,
    },
    {
      key: 'access',
      header: t('fleetApi.controls.enabled', 'Access'),
      groupStart: true,
      align: 'center',
      filterValue: (endpoint) => access[endpoint.key] ?? null,
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
      filterValueLabel: (value) => value == null ? '—' : value ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled'),
      render: (endpoint) => endpoint.pollable ? (
        <Toggle
          checked={!!access[endpoint.key] && !!auto[endpoint.key]}
          onChange={() => onAuto(endpoint.key)}
          disabled={pending || !access[endpoint.key] || !pollingEnabled}
          size="sm"
          aria-label={`${t('fleetApi.controls.poll', 'Auto-poll')} ${endpoint.method} ${endpoint.path}`}
        />
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
      emptyMessage={t('fleetApi.controls.noMatches', 'No API routes match that search.')}
    />
  );
}
