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
  const [groupBy, setGroupBy] = useState<'category' | 'method'>('category');
  const [selectedGroup, setSelectedGroup] = useState('Vehicle data');
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
      const group = groupBy === 'category' ? endpoint.category : endpoint.method;
      if (selectedGroup !== 'all' && !normalizedSearch && group !== selectedGroup) {
        continue;
      }
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
  }, [catalog, groupBy, normalizedSearch, selectedGroup, sortBy, sortDescending, pollingConfig]);
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const endpoint of catalog) {
      const group = groupBy === 'category' ? endpoint.category : endpoint.method;
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [catalog, groupBy]);
  const groupLabel = (group: string) => groupBy === 'category'
    ? t(`fleetApi.categories.${group.toLowerCase().replace(/ /g, '')}`, group)
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
  const kpiLoading = !settingsState.hasData && !pollingState.hasData && (settingsQuery.isLoading || pollingQuery.isLoading);

  // A source that has errored (or simply hasn't resolved yet, once the KPI
  // band is past its own skeleton) must not fabricate a healthy-looking
  // value. We surface an em-dash instead of "Active" / "0" / "On" so the
  // KPI never lies about state it doesn't actually know.
  const EM_DASH = '—';
  const apiStatusKnown = !!settings;
  const pollingKnown = !!pollingConfig && catalog.length > 0;

  const versionLabel = version
    ? `v${version.chart_version} · ${version.go_version} · ${version.os}/${version.arch}`
    : '';
  const configuredEndpointMap = version?.endpoints ?? {};
  const hasConfiguredEndpoints = Object.keys(configuredEndpointMap).length > 0;


  return {
    fmtInt, t, search, setSearch, groupBy, setGroupBy, selectedGroup, setSelectedGroup, sortBy, setSortBy, sortDescending, setSortDescending, settingsQuery, pollingQuery, versionQuery, settingsState, pollingState, versionState, dataSources, suspendMut, pollingConfigMut, settings, pollingConfig, version, catalog, endpointGroups, groups, groupLabel, toggleEndpoint, toggleAuto, toggleAllAccess, toggleAllAuto, configuredEndpoints, totalCount, enabledCount, autoCount, eligibleCount, apiSuspended, kpiLoading, EM_DASH, apiStatusKnown, pollingKnown, versionLabel, configuredEndpointMap, hasConfiguredEndpoints
  };
}
