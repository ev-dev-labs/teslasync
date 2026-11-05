import { ArrowDown, ArrowUp } from 'lucide-react';
import { Accordion, Badge, Caption, Button, Select, Toggle } from '@/components/ui';
import { FleetEndpointTable } from '../../FleetEndpointTable';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Controller = ReturnType<typeof useFleetAPIPage>;
type Props = {
  controller: Controller;
  pollingConfig: NonNullable<Controller['pollingConfig']>;
};

export function FleetAPIRouteCatalog({ controller, pollingConfig }: Props) {
  const { t, search, setSearch, groupBy, setGroupBy, selectedGroup, setSelectedGroup, sortBy, setSortBy, sortDescending, setSortDescending, pollingConfigMut, catalog, endpointGroups, groups, groupLabel, toggleEndpoint, toggleAuto, toggleGroupAccess, totalCount } = controller;

  return (
<div className="min-w-0 space-y-3">
              <Accordion title={t('fleetApi.viewOptions', 'View options')}>
              <div className="flex flex-wrap items-center gap-2">
                <Caption>{t('fleetApi.controls.groupBy', 'Group by')}</Caption>
                <Button size="sm" variant={groupBy === 'category' ? 'primary' : 'secondary'}
                  className="h-11 min-w-11 md:h-9 md:min-w-0"
                  aria-pressed={groupBy === 'category'}
                  onClick={() => { setGroupBy('category'); setSelectedGroup('all'); }}>
                  {t('fleetApi.controls.byCategory', 'Category')}
                </Button>
                <Button size="sm" variant={groupBy === 'method' ? 'primary' : 'secondary'}
                  className="h-11 min-w-11 md:h-9 md:min-w-0"
                  aria-pressed={groupBy === 'method'}
                  onClick={() => { setGroupBy('method'); setSelectedGroup('all'); }}>
                  {t('fleetApi.controls.byMethod', 'HTTP method')}
                </Button>
                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ms-auto">
                  <Select size="sm" aria-label={t('fleetApi.controls.sortBy', 'Sort routes by')}
                    value={sortBy}
                    onChange={(e) => {
                      const value = e.target.value as typeof sortBy;
                      setSortBy(value);
                      setSortDescending(value === 'access' || value === 'auto');
                    }}
                    options={[
                      { value: 'name', label: t('fleetApi.controls.sortName', 'Operation') },
                      { value: 'path', label: t('fleetApi.controls.sortPath', 'API path') },
                      { value: 'method', label: t('fleetApi.controls.sortMethod', 'HTTP method') },
                      { value: 'access', label: t('fleetApi.controls.sortAccess', 'Access state') },
                      { value: 'auto', label: t('fleetApi.controls.sortAuto', 'Auto-poll state') },
                    ]} />
                  <Button size="sm" variant="secondary" onClick={() => setSortDescending(!sortDescending)}
                    className="h-11 min-w-11 md:h-9 md:min-w-0"
                    aria-label={sortDescending
                      ? t('fleetApi.controls.sortAscending', 'Sort ascending')
                      : t('fleetApi.controls.sortDescending', 'Sort descending')}>
                    {sortDescending ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              </Accordion>
              <nav aria-label={t('fleetApi.controls.categoryFilter', 'Route groups')}
                className="flex flex-wrap gap-2 pb-1">
                <Button size="sm" variant={selectedGroup === 'all' ? 'primary' : 'secondary'}
                  className="min-w-0 gap-2" wrapLabel
                  onClick={() => { setSelectedGroup('all'); setSearch(''); }} aria-pressed={selectedGroup === 'all'}>
                  {t('fleetApi.controls.allRoutes', 'All routes')} <Badge size="sm" variant="info">{totalCount}</Badge>
                </Button>
                {groups.map(([group, count]) => (
                  <Button key={group} size="sm" variant={selectedGroup === group ? 'primary' : 'secondary'}
                    className="min-w-0 gap-2" wrapLabel
                    onClick={() => { setSelectedGroup(group); setSearch(''); }} aria-pressed={selectedGroup === group}>
                    {groupLabel(group)}
                    <Badge size="sm" variant="info">{count}</Badge>
                  </Button>
                ))}
              </nav>
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
                      controls={{ search: {
                        value: search,
                        onChange: value => { setSearch(value); if (value) setSelectedGroup('all'); },
                        ariaLabel: t('fleetApi.controls.search', 'Search API routes'),
                        placeholder: t('fleetApi.controls.search', 'Search API routes'),
                      } }}
                      grouping={{
                        key: endpoint => groupBy === 'category' ? endpoint.category : endpoint.method,
                        label: groupLabel,
                        resetKey: `${groupBy}:${selectedGroup}:${search}`,
                        autoExpand: !!search.trim() || selectedGroup !== 'all',
                        summary: (_, rows) => <Badge size="sm" variant="info">{t('fleetApi.controls.groupCount', '{{count}} routes', { count: rows.length })}</Badge>,
                        actionsColumn: 'access',
                        actions: group => {
                          const members = catalog.filter(endpoint => (groupBy === 'category' ? endpoint.category : endpoint.method) === group);
                          return <Toggle size="sm" checked={members.every(endpoint => !!pollingConfig.fleet_endpoints[endpoint.key])}
                            disabled={pollingConfigMut.isPending} onChange={() => toggleGroupAccess(group)}
                            aria-label={t('fleetApi.allowGroup', 'Allow all {{group}}', { group: groupLabel(group) })} />;
                        },
                      }}
                    />
            </div>
  );
}
