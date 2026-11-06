import { Badge } from '@/components/ui';
import { FleetEndpointTable } from '../../FleetEndpointTable';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';
import { FleetAPIGroupActions } from './FleetAPIGroupActions';
import { FleetAPIRouteActions } from './FleetAPIRouteActions';
import { FleetAPIViewOptions } from './FleetAPIViewOptions';

type Controller = ReturnType<typeof useFleetAPIPage>;
type Props = {
  controller: Controller;
  pollingConfig: NonNullable<Controller['pollingConfig']>;
};

export function FleetAPIRouteCatalog({ controller, pollingConfig }: Props) {
  const { t, fmtInt, search, setSearch, groupBy, pollingConfigMut, catalog,
    endpointGroups, groupLabel, toggleEndpoint, toggleAuto } = controller;

  return (
    <FleetEndpointTable
      tableId="admin:fleet-endpoints"
      endpoints={endpointGroups.flatMap(([, endpoints]) => endpoints)}
      candidates={catalog}
      access={pollingConfig.fleet_endpoints}
      auto={pollingConfig.auto_endpoints}
      pollingEnabled={pollingConfig.auto_polling_enabled}
      pending={pollingConfigMut.isPending}
      onEnable={toggleEndpoint}
      onAuto={toggleAuto}
      headerAccess={<FleetAPIRouteActions controller={controller} kind="access" />}
      headerAuto={<FleetAPIRouteActions controller={controller} kind="auto" />}
      toolbarActions={<FleetAPIViewOptions controller={controller} />}
      controls={{ search: {
        value: search,
        onChange: setSearch,
        ariaLabel: t('fleetApi.controls.search', 'Search API routes'),
        placeholder: t('fleetApi.controls.search', 'Search API routes'),
      } }}
      grouping={{
        key: endpoint => groupBy === 'category' ? endpoint.category : endpoint.method,
        label: groupLabel,
        resetKey: `${groupBy}:${search}`,
        autoExpand: !!search.trim(),
        summary: (_, rows) => <Badge size="sm" variant="info">
          {t('fleetApi.controls.groupCount', '{{count}} routes', { count: rows.length })}
        </Badge>,
        mobileSummary: (_, rows) => <Badge size="sm" variant="info"
          aria-label={t('fleetApi.controls.groupCount', '{{count}} routes', { count: rows.length })}>
          {fmtInt(rows.length)}
        </Badge>,
        actionColumns: {
          access: group => <FleetAPIGroupActions controller={controller} group={group} kind="access" />,
          auto: group => <FleetAPIGroupActions controller={controller} group={group} kind="auto" />,
        },
      }}
    />
  );
}
