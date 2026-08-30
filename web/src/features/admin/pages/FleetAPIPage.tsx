/**
 * FleetApiPage — Tesla Fleet API polling configuration and endpoint management.
 *
 * Suspend/resume polling, toggle individual endpoints, manage telemetry
 * capture, and view the runtime's configured endpoints. Laid out as a
 * full-width, mobile-first bento; every data section owns its own
 * loading / error / empty state and reads only from the settings hooks.
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, AlertTriangle, Database, Globe, Link as LinkIcon, Pause, Play, Shield,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, IconBox, Toggle, Select, Badge, PanelTitle, Text, Caption, HelperText, Label, Code } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, InlineCallout } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtInt } from '@/lib/numberFormat';
import {
  useSettings, useToggleAPISuspend, usePollingConfig,
  useUpdatePollingConfig, useCaptureStats, useVersionInfo,
} from '@/api/hooks/useSettings';

// ─── EndpointToggle — single on/off row (≥44px touch target) ─────────────────

function EndpointToggle({ label, desc, enabled, onToggle }: {
  label: string; desc: string; enabled: boolean; onToggle: () => void;
}) {
  return (
    <GlassPanel className="flex min-h-11 items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <Text as="span" size="sm" weight="medium" color="primary" className="block truncate">{label}</Text>
        <Caption className="block truncate">{desc}</Caption>
      </div>
      <Toggle checked={enabled} onChange={() => onToggle()} size="sm" className="shrink-0" aria-label={label} />
    </GlassPanel>
  );
}

// Reflows a group's switches into more columns as the viewport widens so the
// panel never leaves dead horizontal space on large monitors.
const TOGGLE_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-6';

// Every toggleable polling-config key, including telemetry capture, used for
// the enabled/total tally. Kept module-level (label-independent) so the tally
// never depends on the translated render arrays.
const ALL_ENDPOINT_KEYS = [
  'vehicle_discovery', 'charge_state', 'climate_state', 'drive_state',
  'location_data', 'vehicle_state', 'vehicle_config',
  'on_demand_vehicle_discovery', 'on_demand_charge_state', 'on_demand_climate_state',
  'on_demand_drive_state', 'on_demand_location_data', 'on_demand_vehicle_state',
  'on_demand_vehicle_config', 'nearby_charging_sites', 'release_notes',
  'recent_alerts', 'service_data', 'wake_up', 'commands', 'telemetry_capture',
];

// ─── Page component ──────────────────────────────────────────────────────────

export default function FleetAPIPage() {
  const { t } = useTranslation();
  usePageTitle(t('fleetApi.title', 'Fleet API'));

  const settingsQuery = useSettings();
  const pollingQuery = usePollingConfig();
  const captureQuery = useCaptureStats();
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
        id: 'capture-statistics',
        label: t('dataSources.labels.captureStatistics', 'Capture statistics'),
        query: captureQuery,
      },
      {
        id: 'runtime-version',
        label: t('dataSources.labels.runtimeVersion', 'Runtime version'),
        query: versionQuery,
      },
    ],
    [captureQuery, pollingQuery, settingsQuery, t, versionQuery],
  );

  const suspendMut = useToggleAPISuspend();
  const pollingConfigMut = useUpdatePollingConfig();

  const settings = settingsQuery.data;
  const pollingConfig = pollingQuery.data;
  const captureStats = captureQuery.data;
  const version = versionQuery.data;

  const toggleEndpoint = useCallback((key: string) => {
    if (!pollingConfig) return;
    pollingConfigMut.mutate({ ...pollingConfig, [key]: !pollingConfig[key] });
  }, [pollingConfig, pollingConfigMut]);

  const setRetention = useCallback((days: number) => {
    if (!pollingConfig) return;
    pollingConfigMut.mutate({ ...pollingConfig, telemetry_capture_retention_days: days });
  }, [pollingConfig, pollingConfigMut]);

  const pollingEndpoints = [
    { key: 'vehicle_discovery', label: t('fleetApi.endpoints.vehicleDiscovery', 'Vehicle Discovery'), desc: t('fleetApi.endpoints.pollingVehicleDiscoveryDesc', 'List vehicles from Tesla') },
    { key: 'charge_state', label: t('fleetApi.endpoints.chargeState', 'Charge State'), desc: t('fleetApi.endpoints.chargeStateDesc', 'Battery & charging data') },
    { key: 'climate_state', label: t('fleetApi.endpoints.climateState', 'Climate State'), desc: t('fleetApi.endpoints.climateStateDesc', 'Climate & temperature data') },
    { key: 'drive_state', label: t('fleetApi.endpoints.driveState', 'Drive State'), desc: t('fleetApi.endpoints.driveStateDesc', 'Location & speed data') },
    { key: 'location_data', label: t('fleetApi.endpoints.locationData', 'Location Data'), desc: t('fleetApi.endpoints.locationDataDesc', 'GPS coordinates') },
    { key: 'vehicle_state', label: t('fleetApi.endpoints.vehicleState', 'Vehicle State'), desc: t('fleetApi.endpoints.vehicleStateDesc', 'Locks, doors, odometer') },
    { key: 'vehicle_config', label: t('fleetApi.endpoints.vehicleConfig', 'Vehicle Config'), desc: t('fleetApi.endpoints.vehicleConfigDesc', 'Model, trim, options') },
  ];

  const onDemandEndpoints = [
    { key: 'on_demand_vehicle_discovery', label: t('fleetApi.endpoints.vehicleDiscovery', 'Vehicle Discovery'), desc: t('fleetApi.endpoints.onDemandVehicleDiscoveryDesc', 'Sync vehicles from Tesla') },
    { key: 'on_demand_charge_state', label: t('fleetApi.endpoints.chargeState', 'Charge State'), desc: t('fleetApi.endpoints.chargeStateDesc', 'Battery & charging data') },
    { key: 'on_demand_climate_state', label: t('fleetApi.endpoints.climateState', 'Climate State'), desc: t('fleetApi.endpoints.climateStateDesc', 'Climate & temperature data') },
    { key: 'on_demand_drive_state', label: t('fleetApi.endpoints.driveState', 'Drive State'), desc: t('fleetApi.endpoints.driveStateDesc', 'Location & speed data') },
    { key: 'on_demand_location_data', label: t('fleetApi.endpoints.locationData', 'Location Data'), desc: t('fleetApi.endpoints.locationDataDesc', 'GPS coordinates') },
    { key: 'on_demand_vehicle_state', label: t('fleetApi.endpoints.vehicleState', 'Vehicle State'), desc: t('fleetApi.endpoints.vehicleStateDesc', 'Locks, doors, odometer') },
    { key: 'on_demand_vehicle_config', label: t('fleetApi.endpoints.vehicleConfig', 'Vehicle Config'), desc: t('fleetApi.endpoints.vehicleConfigDesc', 'Model, trim, options') },
    { key: 'nearby_charging_sites', label: t('fleetApi.endpoints.nearbyCharging', 'Nearby Charging'), desc: t('fleetApi.endpoints.nearbyChargingDesc', 'Supercharger locations') },
    { key: 'release_notes', label: t('fleetApi.endpoints.releaseNotes', 'Release Notes'), desc: t('fleetApi.endpoints.releaseNotesDesc', 'Firmware release notes') },
    { key: 'recent_alerts', label: t('fleetApi.endpoints.recentAlerts', 'Recent Alerts'), desc: t('fleetApi.endpoints.recentAlertsDesc', 'Vehicle alert history') },
    { key: 'service_data', label: t('fleetApi.endpoints.serviceData', 'Service Data'), desc: t('fleetApi.endpoints.serviceDataDesc', 'Service history & status') },
  ];

  const commandEndpoints = [
    { key: 'wake_up', label: t('fleetApi.endpoints.wakeUp', 'Wake Up'), desc: t('fleetApi.endpoints.wakeUpDesc', 'Wake vehicle from sleep') },
    { key: 'commands', label: t('fleetApi.endpoints.commands', 'Vehicle Commands'), desc: t('fleetApi.endpoints.commandsDesc', 'Lock, unlock, climate, etc.') },
  ];

  const endpointGroups = [
    { id: 'polling', title: t('fleetApi.groups.polling', 'Polling Endpoints'), endpoints: pollingEndpoints },
    { id: 'onDemand', title: t('fleetApi.groups.onDemand', 'On-Demand Endpoints'), endpoints: onDemandEndpoints },
    { id: 'commands', title: t('fleetApi.groups.commands', 'Commands'), endpoints: commandEndpoints },
  ];

  const configuredEndpoints = [
    { key: 'api', label: t('fleetApi.configured.api', 'API (Internal)') },
    { key: 'web', label: t('fleetApi.configured.web', 'Web Frontend') },
    { key: 'oauth_callback', label: t('fleetApi.configured.oauthCallback', 'OAuth Callback') },
    { key: 'tesla_api', label: t('fleetApi.configured.teslaApi', 'Tesla Fleet API') },
  ];

  const allEndpointKeys = ALL_ENDPOINT_KEYS;

  const totalCount = allEndpointKeys.length;
  const enabledCount = pollingConfig
    ? allEndpointKeys.filter((k) => pollingConfig[k]).length
    : 0;

  const apiSuspended = settings?.api_suspended ?? false;
  const captureEnabled = !!pollingConfig?.telemetry_capture;
  const retentionDays = pollingConfig?.telemetry_capture_retention_days ?? 7;
  const mongoStatusKnown = !!captureStats;
  const mongoEnabled = !!captureStats?.mongodb_enabled;
  const totalDocuments = captureStats?.total_documents ?? 0;
  const distinctVinsCount = captureStats?.distinct_vins?.length ?? 0;
  const kpiLoading = settingsQuery.isLoading || pollingQuery.isLoading;

  // A source that has errored (or simply hasn't resolved yet, once the KPI
  // band is past its own skeleton) must not fabricate a healthy-looking
  // value. We surface an em-dash instead of "Active" / "0" / "On" so the
  // KPI never lies about state it doesn't actually know.
  const EM_DASH = '—';
  const apiStatusKnown = !!settings;
  const pollingKnown = !!pollingConfig;

  const versionLabel = version
    ? `v${version.chart_version} · ${version.go_version} · ${version.os}/${version.arch}`
    : '';
  const configuredEndpointMap = version?.endpoints ?? {};
  const hasConfiguredEndpoints = Object.keys(configuredEndpointMap).length > 0;

  const retentionOptions = [
    { value: '1', label: t('fleetApi.retention.1', '1 day') },
    { value: '3', label: t('fleetApi.retention.3', '3 days') },
    { value: '7', label: t('fleetApi.retention.7', '7 days') },
    { value: '14', label: t('fleetApi.retention.14', '14 days') },
    { value: '30', label: t('fleetApi.retention.30', '30 days') },
  ];

  return (
    <PageContainer
      title={t('fleetApi.pageTitle', 'Fleet API Settings')}
      subtitle={t('fleetApi.subtitle', 'Control Tesla Fleet API polling, endpoint toggles, and telemetry capture')}
      query={[settingsQuery, pollingQuery, captureQuery, versionQuery]}
      dataSources={dataSources}
    >
      {/* 1 — KPI band ─────────────────────────────────────────────── */}
      <FadeIn>
        <section
          aria-label={t('fleetApi.kpis.label', 'Fleet API summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {kpiLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <GlassPanel key={i} className="p-4">
                <Skeleton width="55%" height={12} />
                <Skeleton width="70%" height={28} className="mt-2" />
              </GlassPanel>
            ))
          ) : (
            <>
              <MetricCard
                label={t('fleetApi.kpis.apiStatus', 'API Status')}
                value={apiStatusKnown
                  ? (apiSuspended ? t('fleetApi.status.suspended', 'Suspended') : t('fleetApi.status.active', 'Active'))
                  : EM_DASH}
                icon={apiStatusKnown && apiSuspended ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                color={!apiStatusKnown ? 'blue' : apiSuspended ? 'red' : 'green'}
                subtitle={t('fleetApi.kpis.apiStatusHint', 'Tesla Fleet polling')}
              />
              <MetricCard
                label={t('fleetApi.kpis.endpointsEnabled', 'Endpoints Enabled')}
                value={pollingKnown ? `${fmtInt(enabledCount)} / ${fmtInt(totalCount)}` : EM_DASH}
                icon={<Shield className="h-5 w-5" />}
                color="cyan"
                subtitle={t('fleetApi.kpis.endpointsHint', 'Active toggles')}
              />
              <MetricCard
                label={t('fleetApi.kpis.telemetryCapture', 'Telemetry Capture')}
                value={pollingKnown ? (captureEnabled ? t('common.on', 'On') : t('common.off', 'Off')) : EM_DASH}
                icon={<Database className="h-5 w-5" />}
                color={pollingKnown && captureEnabled ? 'purple' : 'blue'}
                subtitle={mongoStatusKnown
                  ? (mongoEnabled
                    ? t('fleetApi.kpis.mongoConnected', 'MongoDB connected')
                    : t('fleetApi.kpis.mongoOff', 'MongoDB not configured'))
                  : t('fleetApi.kpis.mongoUnknown', 'Storage status unknown')}
              />
              <MetricCard
                label={t('fleetApi.kpis.signalsCaptured', 'Signals Captured')}
                value={mongoStatusKnown ? fmtInt(totalDocuments) : EM_DASH}
                icon={<Activity className="h-5 w-5" />}
                color="amber"
                subtitle={t('fleetApi.kpis.signalsHint', 'Stored documents')}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Control bento: master switch (hero) + telemetry capture ─ */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3">
          {/* Master Tesla API power switch */}
          <GlassPanel className="flex h-full flex-col gap-4 p-4 sm:p-5 xl:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconBox color={apiSuspended ? 'red' : 'green'}>
                  {apiSuspended ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </IconBox>
                <div className="min-w-0">
                  <PanelTitle>{t('fleetApi.polling.title', 'Tesla API Polling')}</PanelTitle>
                  <HelperText className="mt-0.5">
                    {apiSuspended
                      ? t('fleetApi.polling.suspendedDesc', 'All Tesla Fleet API calls are suspended')
                      : t('fleetApi.polling.activeDesc', 'Vehicle data is being polled from Tesla')}
                  </HelperText>
                </div>
              </div>
              {!settingsQuery.isLoading && !settingsQuery.isError && (
                <Toggle
                  checked={!apiSuspended}
                  onChange={() => suspendMut.mutate(!apiSuspended)}
                  aria-label={t('fleetApi.polling.toggleAria', 'Toggle Tesla API polling')}
                  className={suspendMut.isPending ? 'pointer-events-none opacity-60' : ''}
                />
              )}
            </div>

            {settingsQuery.isLoading ? (
              <Skeleton height={56} />
            ) : settingsQuery.isError ? (
              <QueryError error={settingsQuery.error} onRetry={() => settingsQuery.refetch()} />
            ) : apiSuspended ? (
              <InlineCallout variant="danger" icon={<AlertTriangle />}>
                {t('fleetApi.polling.suspendedNote', "Polling and commands are paused. Token refresh continues so you won't need to re-authenticate. Useful when your vehicle is in service.")}
              </InlineCallout>
            ) : (
              <InlineCallout variant="success" icon={<Play />}>
                {t('fleetApi.polling.activeNote', 'Tesla Fleet API polling is active. Toggle off to pause data collection and commands without losing your session.')}
              </InlineCallout>
            )}
          </GlassPanel>

          {/* Telemetry capture */}
          <GlassPanel className="flex h-full flex-col gap-4 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconBox color="purple">
                  <Database className="h-5 w-5" />
                </IconBox>
                <div className="min-w-0">
                  <PanelTitle>{t('fleetApi.telemetry.title', 'Telemetry Capture')}</PanelTitle>
                  <HelperText className="mt-0.5">
                    {t('fleetApi.telemetry.subtitle', 'Record raw fleet signals to MongoDB')}
                  </HelperText>
                </div>
              </div>
              {mongoStatusKnown && (
                <Badge variant={mongoEnabled ? 'success' : 'neutral'} size="sm" className="shrink-0">
                  {mongoEnabled
                    ? t('fleetApi.telemetry.mongoConnected', 'MongoDB Connected')
                    : t('fleetApi.telemetry.mongoNotConfigured', 'MongoDB Not Configured')}
                </Badge>
              )}
            </div>

            {pollingQuery.isLoading ? (
              <Skeleton height={120} />
            ) : pollingQuery.isError ? (
              <QueryError error={pollingQuery.error} onRetry={() => pollingQuery.refetch()} />
            ) : (
              <div className={`space-y-3 ${mongoStatusKnown && !mongoEnabled ? 'opacity-60' : ''}`}>
                <EndpointToggle
                  label={t('fleetApi.telemetry.rawSignal', 'Raw Signal Recording')}
                  desc={mongoStatusKnown && !mongoEnabled
                    ? t('fleetApi.telemetry.rawSignalHint', 'Set MONGODB_ENABLED=true and configure MONGODB_URI to enable')
                    : t('fleetApi.telemetry.rawSignalDesc', 'Capture every fleet telemetry signal to MongoDB for debugging')}
                  enabled={captureEnabled}
                  onToggle={() => toggleEndpoint('telemetry_capture')}
                />
                {captureEnabled && mongoEnabled && (
                  <>
                    <GlassPanel className="flex min-h-11 items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <Text as="span" size="sm" weight="medium" color="primary" className="block">
                          {t('fleetApi.telemetry.retention', 'Retention Period')}
                        </Text>
                        <Caption className="block">
                          {t('fleetApi.telemetry.retentionHint', 'Auto-delete captured signals after this many days')}
                        </Caption>
                      </div>
                      <Select
                        aria-label={t('fleetApi.telemetry.retention', 'Retention Period')}
                        value={String(retentionDays)}
                        onChange={(e) => setRetention(parseInt(e.target.value, 10))}
                        disabled={pollingConfigMut.isPending}
                        options={retentionOptions}
                        size="sm"
                        className="w-28 shrink-0"
                      />
                    </GlassPanel>
                    {totalDocuments > 0 && (
                      <InlineCallout variant="info" icon={<Database />}>
                        {t('fleetApi.telemetry.capturedSummary', '{{signals}} signals captured from {{vehicles}} vehicle(s)', {
                          signals: fmtInt(totalDocuments),
                          vehicles: fmtInt(distinctVinsCount),
                        })}
                      </InlineCallout>
                    )}
                  </>
                )}
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Endpoint controls: full-width toggle band ───────────────── */}
      <FadeIn delay={0.2}>
        <GlassPanel className="space-y-5 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <IconBox color="cyan">
              <Shield className="h-5 w-5" />
            </IconBox>
            <div className="min-w-0 flex-1">
              <PanelTitle>{t('fleetApi.controls.title', 'API Endpoint Controls')}</PanelTitle>
              <HelperText className="mt-0.5">
                {t('fleetApi.controls.subtitle', 'Toggle individual Tesla Fleet API endpoints on or off')}
              </HelperText>
            </div>
            {pollingConfig && (
              <Badge variant="info" size="sm" className="shrink-0">
                {t('fleetApi.controls.enabledCount', '{{enabled}}/{{total}} enabled', { enabled: enabledCount, total: totalCount })}
              </Badge>
            )}
          </div>

          {pollingQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton width="30%" height={14} />
              <div className={TOGGLE_GRID}>
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={56} />)}
              </div>
            </div>
          ) : pollingQuery.isError ? (
            <QueryError error={pollingQuery.error} onRetry={() => pollingQuery.refetch()} />
          ) : !pollingConfig ? (
            <EmptyState /* no-action: transient empty state — polling config unavailable until the backend responds */
              icon={<Shield className="h-8 w-8" />}
              message={t('fleetApi.controls.empty', 'No endpoint configuration available')}
            />
          ) : (
            <div className="space-y-6">
              {endpointGroups.map((group) => (
                <div key={group.id} className="space-y-3">
                  <Text as="h4" variant="label">{group.title}</Text>
                  <div className={TOGGLE_GRID}>
                    {group.endpoints.map((ep) => (
                      <EndpointToggle
                        key={ep.key}
                        label={ep.label}
                        desc={ep.desc}
                        enabled={!!pollingConfig[ep.key]}
                        onToggle={() => toggleEndpoint(ep.key)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* 4 — Configured endpoints: full-width detail band ────────────── */}
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
