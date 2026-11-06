import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettings, useToggleAPISuspend, usePollingConfig, useUpdatePollingConfig, useVersionInfo } from '@/api/hooks/useSettings';
import type { FleetEndpoint } from '@/api/hooks/useSettings';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { deriveDataState } from '@/api/dataState';

export function useFleetAPIPage() {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('fleetApi.title', 'Fleet API'));
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [groupBy, setGroupBy] = useState<'category' | 'method'>('category');
  const [sortBy, setSortBy] = useState<'name' | 'path' | 'method' | 'access' | 'auto'>('name');
  const [sortDescending, setSortDescending] = useState(false);

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

  const catalog = pollingConfig?.endpoint_catalog ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const endpointGroups = useMemo(() => {
    const groups = new Map<string, FleetEndpoint[]>();
    for (const endpoint of catalog) {
      if (selectedCategory !== 'all' && endpoint.category !== selectedCategory) continue;
      const group = groupBy === 'category' ? endpoint.category : endpoint.method;
      if (normalizedSearch && !`${endpoint.key} ${endpoint.method} ${endpoint.path} ${endpoint.category}`.toLowerCase().includes(normalizedSearch)) {
        continue;
      }
      const entries = groups.get(group) ?? [];
      entries.push(endpoint);
      groups.set(group, entries);
    }
    const sortValue = (endpoint: FleetEndpoint): string | number => {
      switch (sortBy) {
        case 'path': return endpoint.path;
        case 'method': return endpoint.method;
        case 'access': return Number(!!pollingConfig?.fleet_endpoints[endpoint.key]);
        case 'auto': return Number(!!pollingConfig?.auto_endpoints[endpoint.key]);
        default: return endpoint.key;
      }
    };
    return [...groups.entries()].map(([group, endpoints]): [string, FleetEndpoint[]] => [
      group,
      endpoints.sort((a, b) => {
        const left = sortValue(a);
        const right = sortValue(b);
        const compared = typeof left === 'number' && typeof right === 'number'
          ? left - right : String(left).localeCompare(String(right));
        return (sortDescending ? -compared : compared) || a.key.localeCompare(b.key);
      }),
    ]);
  }, [catalog, groupBy, normalizedSearch, selectedCategory, sortBy, sortDescending, pollingConfig]);
  const categories = [...new Set(catalog.map(endpoint => endpoint.category))];
  const categoryLabel = (category: string) => t(`fleetApi.categories.${category.toLowerCase().replace(/ /g, '')}`, category);
  const groupLabel = (group: string) => groupBy === 'category'
    ? categoryLabel(group)
    : group;

  const toggleEndpoint = (endpoint: FleetEndpoint) => {
    if (!pollingConfig) return;
    const enabled = pollingConfig.fleet_endpoints[endpoint.key];
    pollingConfigMut.mutate({
      ...pollingConfig,
      fleet_endpoints: { ...pollingConfig.fleet_endpoints, [endpoint.key]: !enabled },
      auto_endpoints: enabled && endpoint.pollable
        ? { ...pollingConfig.auto_endpoints, [endpoint.key]: false }
        : pollingConfig.auto_endpoints,
    });
  };

  const toggleAuto = (key: string) => {
    if (!pollingConfig?.auto_polling_enabled || !pollingConfig.fleet_endpoints[key]) return;
    pollingConfigMut.mutate({
      ...pollingConfig,
      auto_endpoints: { ...pollingConfig.auto_endpoints, [key]: !pollingConfig.auto_endpoints[key] },
    });
  };

  const toggleAllAccess = () => {
    if (!pollingConfig || catalog.length === 0) return;
    const enable = !catalog.every((endpoint) => pollingConfig.fleet_endpoints[endpoint.key]);
    pollingConfigMut.mutate({
      ...pollingConfig,
      fleet_endpoints: Object.fromEntries(catalog.map((endpoint) => [endpoint.key, enable])),
      auto_endpoints: enable ? pollingConfig.auto_endpoints
        : Object.fromEntries(catalog.filter((endpoint) => endpoint.pollable).map((endpoint) => [endpoint.key, false])),
    });
  };

  const toggleGroupAccess = (group: string) => {
    if (!pollingConfig || pollingConfigMut.isPending) return;
    const endpoints = catalog.filter(endpoint => (groupBy === 'category' ? endpoint.category : endpoint.method) === group);
    if (!endpoints.length) return;
    const enable = !endpoints.every(endpoint => pollingConfig.fleet_endpoints[endpoint.key]);
    pollingConfigMut.mutate({
      ...pollingConfig,
      fleet_endpoints: { ...pollingConfig.fleet_endpoints, ...Object.fromEntries(endpoints.map(endpoint => [endpoint.key, enable])) },
      auto_endpoints: enable ? pollingConfig.auto_endpoints : {
        ...pollingConfig.auto_endpoints,
        ...Object.fromEntries(endpoints.filter(endpoint => endpoint.pollable).map(endpoint => [endpoint.key, false])),
      },
    });
  };

  const toggleAllAuto = () => {
    if (!pollingConfig?.auto_polling_enabled) return;
    const eligible = catalog.filter((endpoint) => endpoint.pollable && pollingConfig.fleet_endpoints[endpoint.key]);
    if (eligible.length === 0) return;
    const enable = !eligible.every((endpoint) => pollingConfig.auto_endpoints[endpoint.key]);
    pollingConfigMut.mutate({
      ...pollingConfig,
      auto_endpoints: Object.fromEntries(catalog.filter((endpoint) => endpoint.pollable)
        .map((endpoint) => [endpoint.key, enable && !!pollingConfig.fleet_endpoints[endpoint.key]])),
    });
  };

  const toggleGroupAuto = (group: string) => {
    if (!pollingConfig?.auto_polling_enabled || pollingConfigMut.isPending) return;
    const eligible = catalog.filter(endpoint =>
      (groupBy === 'category' ? endpoint.category : endpoint.method) === group
      && endpoint.pollable && pollingConfig.fleet_endpoints[endpoint.key]);
    if (!eligible.length) return;
    const enable = !eligible.every(endpoint => pollingConfig.auto_endpoints[endpoint.key]);
    pollingConfigMut.mutate({
      ...pollingConfig,
      auto_endpoints: {
        ...pollingConfig.auto_endpoints,
        ...Object.fromEntries(eligible.map(endpoint => [endpoint.key, enable])),
      },
    });
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
  const eligibleCount = catalog.filter((ep) => ep.pollable && pollingConfig?.fleet_endpoints[ep.key]).length;

  const apiSuspended = settings?.api_suspended ?? false;
  const apiStatusKnown = !!settings;
  const pollingKnown = !!pollingConfig && catalog.length > 0;

  const versionLabel = version
    ? `v${version.chart_version} · ${version.go_version} · ${version.os}/${version.arch}`
    : '';
  const configuredEndpointMap = version?.endpoints ?? {};
  const hasConfiguredEndpoints = Object.keys(configuredEndpointMap).length > 0;


  return {
    categories, categoryLabel, selectedCategory, setSelectedCategory,
    fmtInt, t, search, setSearch, groupBy, setGroupBy, sortBy, setSortBy, sortDescending, setSortDescending, settingsQuery, pollingQuery, versionQuery, settingsState, pollingState, versionState, dataSources, suspendMut, pollingConfigMut, settings, pollingConfig, version, catalog, endpointGroups, groupLabel, toggleEndpoint, toggleAuto, toggleAllAccess, toggleGroupAccess, toggleAllAuto, toggleGroupAuto, configuredEndpoints, totalCount, enabledCount, autoCount, eligibleCount, apiSuspended, apiStatusKnown, pollingKnown, versionLabel, configuredEndpointMap, hasConfiguredEndpoints
  };
}
