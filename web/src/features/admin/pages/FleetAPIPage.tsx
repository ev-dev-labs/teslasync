/**
 * FleetAPIPage — outbound Tesla Fleet API access and polling participation.
 *
 * Opt into automatic polling, independently allow each implemented Fleet API
 * route, and view the runtime's configured endpoints. Laid out as a
 * full-width, mobile-first bento; every data section owns its own
 * loading / error / empty state and reads only from the settings hooks.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, Globe, Link as LinkIcon, Pause, Play, Shield, Search,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, IconBox, Toggle, Badge, PanelTitle, Text, Caption, HelperText, Label, Code, Input, Button, Select } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, InlineCallout } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtInt } from '@/lib/numberFormat';
import {
  useSettings, useToggleAPISuspend, usePollingConfig,
  useUpdatePollingConfig, useVersionInfo,
} from '@/api/hooks/useSettings';
import type { FleetEndpoint } from '@/api/hooks/useSettings';

function EndpointToggle({ endpoint, enabled, auto, pollingEnabled, onEnable, onAuto, pending }: {
  endpoint: FleetEndpoint;
  enabled: boolean;
  auto: boolean;
  pollingEnabled: boolean;
  onEnable: () => void;
  onAuto: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const name = `${endpoint.method} ${endpoint.path}`;
  return (
    <div className={`flex min-w-0 flex-col gap-2 border-b border-[var(--border-default)] px-3 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between ${enabled ? 'bg-[var(--surface-2)]' : ''}`}>
      <div className="grid min-w-0 flex-1 gap-1 md:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)] md:items-center md:gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Badge variant={endpoint.method === 'GET' ? 'info' : 'warning'} size="sm" className="shrink-0">{endpoint.method}</Badge>
          <Text as="span" size="sm" weight="medium" color="primary" className="min-w-0">
            {endpoint.key.replace(/\./g, ' › ').replace(/_/g, ' ')}
          </Text>
        </div>
        <Code className="block min-w-0 break-all text-[var(--text-muted)]">{endpoint.path}</Code>
      </div>
      <div className="grid w-full shrink-0 grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2 sm:w-[20rem] sm:grid-cols-[7.5rem_12rem]">
        <div className="flex items-center justify-end gap-2">
          <Caption className="sm:hidden">{t('fleetApi.controls.enabled', 'Access')}</Caption>
          <Toggle checked={enabled} onChange={onEnable} disabled={pending} size="sm"
            aria-label={`${t('fleetApi.controls.enable', 'Enable')} ${name}`} />
        </div>
        {endpoint.pollable ? (
          <div className="flex items-center justify-end gap-2 border-l border-[var(--border-default)] pl-3">
            <Caption className="sm:hidden">{t('fleetApi.controls.autoPoll', 'Auto-poll')}</Caption>
            <Toggle checked={enabled && auto} onChange={onAuto} disabled={pending || !enabled || !pollingEnabled} size="sm"
              aria-label={`${t('fleetApi.controls.poll', 'Auto-poll')} ${name}`} />
          </div>
        ) : (
          <Caption className="border-l border-[var(--border-default)] pl-3 text-right"
            title={t('fleetApi.controls.onDemandOnly', 'Not scheduled')}
            aria-label={t('fleetApi.controls.onDemandOnly', 'Not scheduled')}>
            <span className="sm:hidden">{t('fleetApi.controls.onDemandOnly', 'Not scheduled')}</span>
            <span className="hidden sm:inline" aria-hidden="true">—</span>
          </Caption>
        )}
      </div>
    </div>
  );
}

export default function FleetAPIPage() {
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
    { key: 'api', label: t('fleetApi.configured.api', 'API (Internal)') },
    { key: 'web', label: t('fleetApi.configured.web', 'Web Frontend') },
    { key: 'oauth_callback', label: t('fleetApi.configured.oauthCallback', 'OAuth Callback') },
    { key: 'tesla_api', label: t('fleetApi.configured.teslaApi', 'Tesla Fleet API') },
  ];

  const totalCount = catalog.length;
  const enabledCount = catalog.filter((ep) => pollingConfig?.fleet_endpoints[ep.key]).length;
  const autoCount = catalog.filter((ep) => ep.pollable && pollingConfig?.fleet_endpoints[ep.key] && pollingConfig.auto_endpoints[ep.key]).length;
  const eligibleCount = catalog.filter((ep) => ep.pollable && pollingConfig?.fleet_endpoints[ep.key]).length;

  const apiSuspended = settings?.api_suspended ?? false;
  const kpiLoading = settingsQuery.isLoading || pollingQuery.isLoading;

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

  return (
    <PageContainer
      title={t('fleetApi.pageTitle', 'Fleet API Settings')}
      subtitle={t('fleetApi.subtitle', 'Choose which Tesla Fleet API routes are available and which can be polled automatically')}
      query={[settingsQuery, pollingQuery, versionQuery]}
      dataSources={dataSources}
    >
      <FadeIn>
        <section
          aria-label={t('fleetApi.kpis.label', 'Fleet API summary')}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {kpiLoading ? (
            Array.from({ length: 2 }).map((_, i) => (
              <GlassPanel key={i} className="p-4">
                <Skeleton width="55%" height={12} />
                <Skeleton width="70%" height={28} className="mt-2" />
              </GlassPanel>
            ))
          ) : (
            <>
              <MetricCard
                label={t('fleetApi.kpis.apiStatus', 'API Status')}
                value={apiStatusKnown && pollingKnown
                  ? (apiSuspended ? t('fleetApi.status.suspended', 'Suspended') : pollingConfig.auto_polling_enabled
                    ? t('fleetApi.status.polling', 'Polling enabled') : t('fleetApi.status.onDemand', 'On demand only'))
                  : EM_DASH}
                icon={apiStatusKnown && apiSuspended ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                color={!apiStatusKnown || !pollingKnown ? 'blue' : apiSuspended ? 'red' : 'green'}
                subtitle={t('fleetApi.kpis.apiStatusHint', 'Automatic Fleet API polling')}
              />
              <MetricCard
                label={t('fleetApi.kpis.endpointsEnabled', 'Endpoints Enabled')}
                value={pollingKnown ? `${fmtInt(enabledCount)} / ${fmtInt(totalCount)}` : EM_DASH}
                icon={<Shield className="h-5 w-5" />}
                color="cyan"
                subtitle={t('fleetApi.kpis.endpointsHint', '{{count}} selected for polling', { count: autoCount })}
              />
            </>
          )}
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <section>
          <GlassPanel className="flex h-full flex-col gap-4 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconBox color={pollingConfig?.auto_polling_enabled ? 'green' : 'blue'}>
                  {pollingConfig?.auto_polling_enabled ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                </IconBox>
                <div className="min-w-0">
                  <PanelTitle>{t('fleetApi.polling.title', 'Tesla API Polling')}</PanelTitle>
                  <HelperText className="mt-0.5">
                    {t('fleetApi.polling.masterDesc', 'Off by default. Turning this off stops scheduled Fleet API reads, not manual requests or token refresh.')}
                  </HelperText>
                </div>
              </div>
              {pollingKnown && (
                <Toggle
                  checked={pollingConfig.auto_polling_enabled}
                  onChange={() => pollingConfigMut.mutate({ ...pollingConfig, auto_polling_enabled: !pollingConfig.auto_polling_enabled })}
                  aria-label={t('fleetApi.polling.toggleAria', 'Toggle Tesla API polling')}
                  disabled={pollingConfigMut.isPending}
                />
              )}
            </div>

            {pollingQuery.isLoading ? (
              <Skeleton height={56} />
            ) : pollingQuery.isError ? (
              <QueryError error={pollingQuery.error} onRetry={() => pollingQuery.refetch()} />
            ) : !pollingConfig ? (
              <Text as="p" size="sm" color="secondary">{t('fleetApi.controls.empty', 'Endpoint settings are unavailable.')}</Text>
            ) : pollingConfig.auto_polling_enabled ? (
              <InlineCallout variant="success" icon={<Play />}>
                {t('fleetApi.polling.activeNote', 'Only enabled routes selected for auto-polling participate. On-demand routes and commands remain independent.')}
              </InlineCallout>
            ) : (
              <InlineCallout variant="info" icon={<Pause />}>
                {t('fleetApi.polling.suspendedNote', 'Automatic Fleet API polling is off. Enabled endpoints still work on demand; token refresh continues.')}
              </InlineCallout>
            )}
            {settingsQuery.isError ? (
              <QueryError error={settingsQuery.error} onRetry={() => settingsQuery.refetch()} />
            ) : apiSuspended ? (
              <div className="flex flex-wrap items-center gap-3">
                <InlineCallout variant="danger" icon={<AlertTriangle />}>
                  {t('fleetApi.polling.emergencyNote', 'API actions were suspended previously; supported live requests and commands are blocked. Token refresh continues.')}
                </InlineCallout>
                <Button variant="secondary" size="sm" disabled={suspendMut.isPending}
                  onClick={() => suspendMut.mutate(false)}>
                  {t('fleetApi.polling.resumeActions', 'Resume API actions')}
                </Button>
              </div>
            ) : null}
          </GlassPanel>

        </section>
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="space-y-5 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <IconBox color="cyan">
              <Shield className="h-5 w-5" />
            </IconBox>
            <div className="min-w-0 flex-1">
              <PanelTitle>{t('fleetApi.controls.title', 'API Endpoint Controls')}</PanelTitle>
              <HelperText className="mt-0.5">
                {t('fleetApi.controls.subtitle', 'Allow manual requests per endpoint, then opt supported reads into background refresh. Routes without a scheduled job stay manual only.')}
              </HelperText>
            </div>
            {pollingKnown && (
              <Badge variant="info" size="sm" className="shrink-0">
                {t('fleetApi.controls.enabledCount', '{{enabled}}/{{total}} enabled', { enabled: enabledCount, total: totalCount })}
              </Badge>
            )}
          </div>

          {pollingKnown && (
            <div className="grid gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-3 sm:grid-cols-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                <Text as="span" size="sm" weight="medium">{t('fleetApi.controls.accessSummary', '{{count}} routes available on demand', { count: enabledCount })}</Text>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <Text as="span" size="sm" weight="medium">{t('fleetApi.controls.autoSummary', '{{count}} selected for auto-poll', { count: autoCount })}</Text>
              </div>
              <div className="flex items-center gap-2">
                <Pause className="h-4 w-4 text-amber-300" aria-hidden="true" />
                <Text as="span" size="sm" weight="medium">{pollingConfig.auto_polling_enabled
                  ? t('fleetApi.controls.scheduleRunning', 'Schedule running')
                  : t('fleetApi.controls.schedulePaused', 'Schedule paused')}</Text>
              </div>
            </div>
          )}
          {pollingKnown && (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-[var(--border-default)] px-4 py-3">
              <Text as="span" size="sm" weight="medium">{t('fleetApi.controls.bulkTitle', 'All routes')}</Text>
              <Label className="flex items-center gap-2">
                {t('fleetApi.controls.bulkAccess', 'Access all')}
                <Toggle checked={enabledCount === totalCount} onChange={toggleAllAccess}
                  disabled={pollingConfigMut.isPending} size="sm"
                  aria-label={t('fleetApi.controls.bulkAccess', 'Access all')} />
              </Label>
              <Label className="flex items-center gap-2">
                {t('fleetApi.controls.bulkAuto', 'Auto-poll eligible routes')}
                <Toggle checked={eligibleCount > 0 && autoCount === eligibleCount} onChange={toggleAllAuto}
                  disabled={pollingConfigMut.isPending || eligibleCount === 0 || !pollingConfig.auto_polling_enabled} size="sm"
                  aria-label={t('fleetApi.controls.bulkAuto', 'Auto-poll eligible routes')} />
              </Label>
              <Caption>{pollingConfig.auto_polling_enabled
                ? t('fleetApi.controls.bulkHint', 'Auto-poll selects only enabled routes with a scheduled job.')
                : t('fleetApi.controls.pausedHint', 'Turn on Tesla API Polling to change auto-poll selections. Existing selections are retained while paused.')}</Caption>
            </div>
          )}
          {pollingKnown && (
            <div className="flex flex-col gap-2">
              <div className="flex w-full items-center gap-2">
                <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <Input value={search} onChange={(e) => { setSearch(e.target.value); if (e.target.value) setSelectedGroup('all'); }}
                    placeholder={t('fleetApi.controls.search', 'Search API routes')}
                    aria-label={t('fleetApi.controls.search', 'Search API routes')} />
                </div>
              </div>
            </div>
          )}
          {pollingQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton width="30%" height={14} />
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={56} />)}
            </div>
          ) : pollingQuery.isError ? (
            <QueryError error={pollingQuery.error} onRetry={() => pollingQuery.refetch()} />
          ) : !pollingKnown ? (
            <EmptyState
              icon={<Shield className="h-8 w-8" />}
              message={t('fleetApi.controls.empty', 'Endpoint catalog unavailable')}
              description={t('fleetApi.controls.outdatedRuntime', 'This API server does not provide the Fleet route catalog. Update and restart the API service to manage routes; no settings can be changed here until it is available.')}
              action={{ label: t('fleetApi.controls.retry', 'Retry loading routes'), onClick: () => { void pollingQuery.refetch(); } }}
            />
          ) : (
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
                <div className="flex items-center gap-2 sm:ml-auto">
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
                className="flex gap-2 overflow-x-auto pb-1">
                <Button size="sm" variant={selectedGroup === 'all' ? 'primary' : 'secondary'}
                  className="shrink-0 gap-2"
                  onClick={() => { setSelectedGroup('all'); setSearch(''); }} aria-pressed={selectedGroup === 'all'}>
                  {t('fleetApi.controls.allRoutes', 'All routes')} <Badge size="sm" variant="info">{totalCount}</Badge>
                </Button>
                {groups.map(([group, count]) => (
                  <Button key={group} size="sm" variant={selectedGroup === group ? 'primary' : 'secondary'}
                    className="shrink-0 gap-2"
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
                      <div className="hidden w-[20rem] grid-cols-[7.5rem_12rem] gap-2 text-right sm:grid">
                        <Caption>{t('fleetApi.controls.enabled', 'Access')}</Caption>
                        <Caption>{t('fleetApi.controls.autoPoll', 'Auto-poll')}</Caption>
                      </div>
                    </div>
                    <div>
                      {endpoints.map((ep) => (
                        <EndpointToggle
                          key={ep.key}
                          endpoint={ep}
                          enabled={!!pollingConfig.fleet_endpoints[ep.key]}
                          auto={!!pollingConfig.auto_endpoints[ep.key]}
                          pollingEnabled={pollingConfig.auto_polling_enabled}
                          pending={pollingConfigMut.isPending}
                          onEnable={() => toggleEndpoint(ep)}
                          onAuto={() => toggleAuto(ep.key)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      <FadeIn delay={0.3}>
        <GlassPanel className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <IconBox color="blue">
              <Globe className="h-5 w-5" />
            </IconBox>
            <div className="min-w-0 flex-1">
              <PanelTitle>{t('fleetApi.configured.title', 'API Endpoints')}</PanelTitle>
              {versionLabel && (
                <Text as="p" size="xs" color="muted" mono className="mt-0.5 truncate">{versionLabel}</Text>
              )}
            </div>
          </div>

          {versionQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={56} />)}
            </div>
          ) : versionQuery.isError ? (
            <QueryError error={versionQuery.error} onRetry={() => versionQuery.refetch()} />
          ) : !hasConfiguredEndpoints ? (
            // no-action: endpoint URLs are deployment-managed and appear after configuration plus restart.
            <EmptyState
              icon={<Activity className="h-8 w-8 opacity-40" />}
              title={t('fleetApi.configured.emptyTitle', 'Endpoint metadata unavailable')}
              message={t(
                'fleetApi.configured.emptyMessage',
                'This runtime did not publish any configured endpoint URLs.',
              )}
              description={t(
                'fleetApi.configured.emptyDescription',
                'Configure the public and Tesla Fleet API URLs in deployment settings; metadata appears after the service restarts.',
              )}
              className="py-8"
            />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <LinkIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                <Label>{t('fleetApi.configured.heading', 'Configured Endpoints')}</Label>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
                {configuredEndpoints.filter((ep) => configuredEndpointMap[ep.key]).map((ep) => (
                  <GlassPanel key={ep.key} className="min-w-0 space-y-1 p-3">
                    <Text as="span" size="xs" weight="medium" color="secondary" className="block truncate">{ep.label}</Text>
                    <Code className="block truncate" title={configuredEndpointMap[ep.key]}>{configuredEndpointMap[ep.key]}</Code>
                  </GlassPanel>
                ))}
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
