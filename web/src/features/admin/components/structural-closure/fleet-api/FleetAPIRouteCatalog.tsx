import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { Badge, PanelTitle, Caption, Button, Select } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FleetEndpointTable } from '../../FleetEndpointTable';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Controller = ReturnType<typeof useFleetAPIPage>;
type Props = {
  controller: Controller;
  pollingConfig: NonNullable<Controller['pollingConfig']>;
};

export function FleetAPIRouteCatalog({ controller, pollingConfig }: Props) {
  const { t, setSearch, groupBy, setGroupBy, selectedGroup, setSelectedGroup, sortBy, setSortBy, sortDescending, setSortDescending, pollingConfigMut, catalog, endpointGroups, groups, groupLabel, toggleEndpoint, toggleAuto, totalCount } = controller;

  return (
<div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Caption>{t('fleetApi.controls.groupBy', 'Group by')}</Caption>
                <Button size="sm" variant={groupBy === 'category' ? 'primary' : 'secondary'}
                  aria-pressed={groupBy === 'category'}
                  onClick={() => { setGroupBy('category'); setSelectedGroup('all'); }}>
                  {t('fleetApi.controls.byCategory', 'Category')}
                </Button>
                <Button size="sm" variant={groupBy === 'method' ? 'primary' : 'secondary'}
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
                    aria-label={sortDescending
                      ? t('fleetApi.controls.sortAscending', 'Sort ascending')
                      : t('fleetApi.controls.sortDescending', 'Sort descending')}>
                    {sortDescending ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
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
              <div className="min-w-0 space-y-3">
                {endpointGroups.length === 0 ? (
                  <EmptyState
                    icon={<Search className="h-8 w-8" />}
                    message={t('fleetApi.controls.noMatches', 'No API routes match that search.')}
                    action={{ label: t('fleetApi.controls.clearSearch', 'Clear search'), onClick: () => setSearch('') }}
                  />
                ) : endpointGroups.map(([group, endpoints]) => (
                  <section key={group} aria-label={group} className="overflow-hidden rounded-xl border border-[var(--border-default)]">
                    <div className="flex items-center justify-between gap-2 bg-[var(--surface-2)] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <PanelTitle>{groupLabel(group)}</PanelTitle>
                        <Badge size="sm" variant="info">{t('fleetApi.controls.groupCount', '{{count}} routes', { count: endpoints.length })}</Badge>
                      </div>
                    </div>
                    <FleetEndpointTable
                      tableId={`admin:fleet-endpoints:${groupBy}:${group}`}
                      endpoints={endpoints}
                      candidates={catalog.filter((endpoint) => (groupBy === 'category' ? endpoint.category : endpoint.method) === group)}
                      access={pollingConfig.fleet_endpoints}
                      auto={pollingConfig.auto_endpoints}
                      pollingEnabled={pollingConfig.auto_polling_enabled}
                      pending={pollingConfigMut.isPending}
                      onEnable={toggleEndpoint}
                      onAuto={toggleAuto}
                    />
                  </section>
                ))}
              </div>
            </div>
  );
}
