import { useRef, useState } from 'react';
import { Badge, Button, Select, Text } from '@/components/ui';
import { PillFilterBar } from '@/components/forms';
import { FleetEndpointTable } from '../../FleetEndpointTable';
import type { FleetRouteScope, useFleetAPIPage } from '../../../hooks/useFleetAPIPage';
import { fleetGuideRoutes } from '../../../lib/fleetEndpointPolicy';
import { FleetAPIBulkReview, type FleetReviewScope } from './FleetAPIBulkReview';
import { FleetAPIFeatureGuides } from './FleetAPIFeatureGuides';
import { FleetAPIViewOptions } from './FleetAPIViewOptions';

type Controller = ReturnType<typeof useFleetAPIPage>;
type Props = {
  controller: Controller;
  pollingConfig: NonNullable<Controller['pollingConfig']>;
};

export function FleetAPIRouteCatalog({ controller, pollingConfig }: Props) {
  const { t, fmtInt, search, setSearch, groupBy, setGroupBy, pollingConfigMut, catalog,
    matchingRoutes, groupLabel, changePermission, categoryLabel, routeScope, setRouteScope,
    guide, setGuide, resetRouteQuery, queryReset, apiSuspended, apiStatusKnown, categories, category, setCategory } = controller;
  const [selectedKeys, setSelectedKeys] = useState<(string | number)[]>([]);
  const [review, setReview] = useState<FleetReviewScope>();
  const catalogQuery = useRef<HTMLDivElement>(null);
  const scopes: { key: FleetRouteScope; label: string }[] = [
    { key: 'all', label: t('fleetApi.controls.allRoutes', 'All routes') },
    ...(pollingConfig.smart_endpoints != null
      ? [{ key: 'smart' as const, label: t('fleetApi.redesign.smartAllowed', 'Smart allowed') }] : []),
    { key: 'pollable', label: t('fleetApi.redesign.pollable', 'Pollable') },
    { key: 'blocked', label: t('fleetApi.redesign.blocked', 'Blocked') },
    { key: 'commands', label: t('fleetApi.redesign.commandReview', 'Command review') },
  ];
  const groupKey = (route: (typeof catalog)[number]) => groupBy === 'category' ? route.category : route.method;
  const selectionLabel = t('fleetApi.redesign.editSelection', 'Edit selected');
  const entireCatalogLabel = t('fleetApi.redesign.editCatalog', 'Edit all routes');
  const endpoints = guide ? matchingRoutes.filter(route => fleetGuideRoutes[guide]?.includes(route.key)) : matchingRoutes;
  const pending = pollingConfigMut.isPending;
  const setScope = (key: string) => {
    const next = scopes.find(scope => scope.key === key)?.key;
    if (!next || next === routeScope) return;
    if (next === 'commands') {
      resetRouteQuery();
      setGroupBy('none');
    } else if (routeScope === 'commands') setGroupBy('category');
    setRouteScope(next);
  };
  const restore = (context: string) => {
    const [group, scope, savedGuide, savedCategory] = context.split(':');
    if (group === 'category' || group === 'method' || group === 'none') setGroupBy(group);
    setRouteScope(scopes.find(item => item.key === scope)?.key ?? 'all');
    setGuide(savedGuide && Object.prototype.hasOwnProperty.call(fleetGuideRoutes, savedGuide) ? savedGuide : '');
    setCategory(categories.find(item => item === savedCategory) ?? 'all');
  };

  return (
    <div className="min-w-0 space-y-4">
      <Text as="p" variant="bodySm" color="secondary">
        {pollingConfig.smart_endpoints != null
          ? t('fleetApi.redesign.policyHelp', 'Access comes first. Smart Features and Auto-poll are independent. Turning off Access clears both. Allowing a route does not turn on a feature.')
          : t('fleetApi.redesign.legacyHelp', 'Access comes first. Turning off Access clears Auto-poll. This server does not publish Smart Features permissions.')}
      </Text>
      <div className="flex min-w-0 flex-wrap items-center gap-2" ref={catalogQuery} tabIndex={-1}>
        <PillFilterBar semanticMode="filters" ariaLabel={t('fleetApi.redesign.quickViews', 'Quick views')}
          items={scopes} activeKey={routeScope} onChange={setScope} />
        <Select size="sm" className="max-w-full" value={category} onChange={event => setCategory(event.target.value)}
          aria-label={t('fleetApi.controls.categoryFilter', 'Route groups')}
          options={[{ value: 'all', label: t('fleetApi.redesign.allCategories', 'All categories') },
            ...categories.map(value => ({ value, label: categoryLabel(value) }))]} />
        <Button size="sm" variant="secondary" wrapLabel className="ms-auto min-h-11"
          disabled={pending} onClick={() => setReview({ label: entireCatalogLabel, keys: catalog.map(route => route.key) })}>
          {entireCatalogLabel}
        </Button>
      </div>
      {routeScope === 'commands' && <Text as="p" variant="bodySm" color="secondary">
        {t('fleetApi.redesign.commandHelp', 'Shows every write operation, including POST and DELETE.')}
      </Text>}
      {guide && <Button size="sm" variant="secondary" wrapLabel onClick={() => {
        setGuide('');
        setGroupBy('category');
      }}>
        {t('fleetApi.redesign.clearGuide', 'Clear guide filter')}
      </Button>}
      <FleetEndpointTable
        tableId="admin:fleet-endpoints"
        endpoints={endpoints}
        candidates={catalog}
        categoryLabel={categoryLabel}
        access={pollingConfig.fleet_endpoints}
        auto={pollingConfig.auto_endpoints}
        smart={pollingConfig.smart_endpoints}
        pollingEnabled={pollingConfig.auto_polling_enabled && !apiSuspended}
        pollingStatusKnown={apiStatusKnown || !pollingConfig.auto_polling_enabled}
        pending={pending}
        onEnable={endpoint => changePermission(endpoint.key, 'access')}
        onAuto={key => changePermission(key, 'auto')}
        onSmart={key => changePermission(key, 'smart')}
        toolbarActions={<FleetAPIViewOptions controller={controller} />}
        savedViews={{ context: `${groupBy}:${routeScope}:${guide}:${category}`, onRestore: restore }}
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
        bulkActions={rows => <Button size="sm" variant="primary" wrapLabel disabled={pending}
          onClick={() => setReview({ label: selectionLabel, keys: rows.map(route => route.key) })}>
          {selectionLabel}
        </Button>}
        queryReset={queryReset}
        onClear={resetRouteQuery}
        controls={{ search: {
          value: search, onChange: setSearch,
          ariaLabel: t('fleetApi.controls.search', 'Search API routes'),
          placeholder: t('fleetApi.controls.search', 'Search API routes'),
        } }}
        grouping={groupBy === 'none' ? undefined : {
          key: groupKey, label: groupLabel,
          resetKey: `${groupBy}:${routeScope}:${guide}:${category}:${search}`,
          autoExpand: !!search.trim() || routeScope !== 'all' || !!guide || category !== 'all',
          summary: (_, rows) => <Badge size="sm" variant="info">
            {t('fleetApi.controls.groupCount', '{{count}} routes', { count: rows.length })}
          </Badge>,
          mobileSummary: (_, rows) => <Badge size="sm" variant="info"
            aria-label={t('fleetApi.controls.groupCount', '{{count}} routes', { count: rows.length })}>
            {fmtInt(rows.length)}
          </Badge>,
          actions: group => {
            const label = t('fleetApi.redesign.editGroupNamed', 'Edit all {{group}} routes', { group: groupLabel(group) });
            return <Button size="sm" variant="ghost" wrapLabel className="min-h-11" aria-label={label}
              disabled={pending} onClick={() => setReview({
                label, keys: catalog.filter(route => groupKey(route) === group).map(route => route.key),
              })}>{t('fleetApi.redesign.editGroup', 'Edit group')}</Button>;
          },
        }}
      />
      {pollingConfig.smart_endpoints != null && <FleetAPIFeatureGuides catalog={catalog} selected={guide}
        onSelect={key => {
          resetRouteQuery();
          setGroupBy(key ? 'none' : 'category');
          setGuide(key);
          catalogQuery.current?.focus();
        }} />}
      {review && <FleetAPIBulkReview scope={review} config={pollingConfig} pending={pending}
        onClose={() => setReview(undefined)} onApply={pollingConfigMut.mutateAsync} />}
    </div>
  );
}
