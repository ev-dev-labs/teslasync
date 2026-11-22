import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettings, useToggleAPISuspend, usePollingConfig, useUpdatePollingConfig, useVersionInfo } from '@/api/hooks/useSettings';
import type { FleetEndpoint } from '@/api/hooks/useSettings';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { deriveDataState } from '@/api/dataState';
import { keepFleetPermissions, planFleetPermissions, type FleetPermission } from '../lib/fleetEndpointPolicy';

const emptyCatalog: FleetEndpoint[] = [];
export type FleetGrouping = 'category' | 'method' | 'none';
export type FleetRouteScope = 'all' | 'smart' | 'pollable' | 'blocked' | 'commands';

export function useFleetAPIPage() {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('fleetApi.title', 'Fleet API'));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [groupBy, setGroupBy] = useState<FleetGrouping>('category');
  const [routeScope, setRouteScope] = useState<FleetRouteScope>('all');
  const [guide, setGuide] = useState('');
  const [queryReset, setQueryReset] = useState(0);

  const settingsQuery = useSettings();
  const pollingQuery = usePollingConfig();
  const versionQuery = useVersionInfo();
  const settingsState = deriveDataState(settingsQuery);
  const pollingState = deriveDataState(pollingQuery);
  const versionState = deriveDataState(versionQuery);
  const dataSources = useMemo(
    () => [
      {
        id: 'application-settings',
        label: t('dataSources.labels.applicationSettings', 'Application settings'),
        query: settingsQuery,
      },
      {
        id: 'polling-configuration',
        label: t('dataSources.labels.pollingConfiguration', 'Polling configuration'),
        query: pollingQuery,
      },
      {
        id: 'runtime-version',
        label: t('dataSources.labels.runtimeVersion', 'Runtime version'),
        query: versionQuery,
      },
    ],
    [pollingQuery, settingsQuery, t, versionQuery],
  );

  const suspendMut = useToggleAPISuspend();
  const pollingConfigMut = useUpdatePollingConfig();

  const settings = settingsQuery.data;
  const pollingConfig = pollingQuery.data;
  const version = versionQuery.data;

  const catalog = pollingConfig?.endpoint_catalog ?? emptyCatalog;
  const normalizedSearch = search.trim().toLowerCase();
  const matchingRoutes = useMemo(() => catalog.filter(endpoint => {
    const allowed = pollingConfig?.fleet_endpoints[endpoint.key];
    return (category === 'all' || endpoint.category === category)
      && (routeScope !== 'smart' || (allowed && pollingConfig?.smart_endpoints?.[endpoint.key]))
      && (routeScope !== 'pollable' || endpoint.pollable)
      && (routeScope !== 'blocked' || !allowed)
      && (routeScope !== 'commands' || endpoint.method !== 'GET')
      && (!normalizedSearch || `${endpoint.key} ${endpoint.key.replace(/[._]/g, ' ')} ${endpoint.method} ${endpoint.path} ${endpoint.category}`
        .toLowerCase().includes(normalizedSearch));
  }), [catalog, category, normalizedSearch, pollingConfig, routeScope]);
  const categories = [...new Set(catalog.map(endpoint => endpoint.category))];
  const categoryLabel = (category: string) => t(`fleetApi.categories.${category.toLowerCase().replace(/ /g, '')}`, category);
  const groupLabel = (group: string) => groupBy === 'category'
    ? categoryLabel(group)
    : group;

  const changePermission = (key: string, permission: FleetPermission) => {
    if (!pollingConfig || pollingConfigMut.isPending) return;
    const enabled = permission === 'access' ? pollingConfig.fleet_endpoints[key]
      : permission === 'smart' ? pollingConfig.smart_endpoints?.[key] : pollingConfig.auto_endpoints[key];
    const plan = planFleetPermissions(pollingConfig, [key], {
      ...keepFleetPermissions, [permission]: enabled ? 'disable' : 'enable',
    });
    if (plan.changed.length) pollingConfigMut.mutate(plan.config);
  };

  const resetRouteQuery = () => {
    setCategory('all');
    setRouteScope('all');
    setSearch('');
    setGuide('');
    setQueryReset(value => value + 1);
  };

  const configuredEndpoints = [
    { key: 'api', label: t('fleetApi.configured.api', 'API (internal)') },
    { key: 'web', label: t('fleetApi.configured.web', 'Web frontend') },
    { key: 'oauth_callback', label: t('fleetApi.configured.oauthCallback', 'OAuth callback') },
    { key: 'tesla_api', label: t('fleetApi.configured.teslaApi', 'Tesla Fleet API') },
  ];

  const totalCount = catalog.length;
  const enabledCount = catalog.filter((ep) => pollingConfig?.fleet_endpoints[ep.key]).length;
  const autoCount = catalog.filter((ep) => ep.pollable && pollingConfig?.fleet_endpoints[ep.key] && pollingConfig.auto_endpoints[ep.key]).length;
  const smartCount = catalog.filter(ep => pollingConfig?.fleet_endpoints[ep.key] && pollingConfig.smart_endpoints?.[ep.key]).length;

  const apiSuspended = settings?.api_suspended ?? false;
  const apiStatusKnown = !!settings;
  const pollingKnown = !!pollingConfig && catalog.length > 0;

  const versionLabel = version
    ? `v${version.chart_version} · ${version.go_version} · ${version.os}/${version.arch}`
    : '';
  const configuredEndpointMap = version?.endpoints ?? {};
  const hasConfiguredEndpoints = Object.keys(configuredEndpointMap).length > 0;


  return {
    categories, categoryLabel, category, setCategory,
    fmtInt, t, search, setSearch, groupBy, setGroupBy, routeScope, setRouteScope, guide, setGuide, resetRouteQuery, queryReset,
    settingsQuery, pollingQuery, versionQuery, settingsState, pollingState, versionState, dataSources, suspendMut,
    pollingConfigMut, settings, pollingConfig, version, catalog, matchingRoutes, groupLabel, changePermission,
    configuredEndpoints, totalCount, enabledCount, autoCount, smartCount, apiSuspended, apiStatusKnown, pollingKnown,
    versionLabel, configuredEndpointMap, hasConfiguredEndpoints,
  };
}
