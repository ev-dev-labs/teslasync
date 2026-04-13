/**
 * FleetApiPage — Tesla Fleet API polling configuration and endpoint management.
 *
 * Suspend/resume polling, toggle individual endpoints, manage telemetry capture,
 * and view configured API endpoints.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { IconBox } from '@/components/ui/IconBox';
import { Toggle } from '@/components/ui/Toggle';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { FadeIn } from '@/components/motion/FadeIn';
import { useToast } from '@/components/feedback/Toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtInt } from '@/lib/numberFormat';
import {
  useSettings, useToggleAPISuspend, usePollingConfig,
  useUpdatePollingConfig, useCaptureStats, useVersionInfo,
} from '@/api/hooks/useSettings';
import { Shield, Pause, Play, Globe, Link, Activity } from 'lucide-react';

// ─── EndpointToggle sub-component ────────────────────────────────────────────

function EndpointToggle({ label, desc, enabled, onToggle }: {
  label: string; desc: string; enabled: boolean; onToggle: () => void;
}) {
  return (
    <GlassPanel className="flex items-center justify-between p-2.5">
      <div className="min-w-0">
        <span className="text-xs font-medium text-[var(--text-primary)] truncate block">{label}</span>
        <span className="text-[10px] text-[var(--text-muted)] truncate block">{desc}</span>
      </div>
      <div className="shrink-0 ml-2">
        <Toggle checked={enabled} onChange={() => onToggle()} size="sm" />
      </div>
    </GlassPanel>
  );
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function FleetAPIPage() {
  const { t } = useTranslation();
  usePageTitle(t('Fleet API'));
  const toast = useToast();

  // Queries
  const { data: settings } = useSettings();
  const { data: pollingConfig } = usePollingConfig();
  const { data: captureStats } = useCaptureStats();
  const { data: version } = useVersionInfo();

  // Mutations
  const suspendMut = useToggleAPISuspend();
  const pollingConfigMut = useUpdatePollingConfig();

  const toggleEndpoint = useCallback((key: string) => {
    if (!pollingConfig) return;
    const updated = { ...pollingConfig, [key]: !pollingConfig[key] };
    pollingConfigMut.mutate(updated, {
      onSuccess: () => toast.success(t('Polling config updated')),
      onError: () => toast.error(t('Failed to update polling config')),
    });
  }, [pollingConfig, pollingConfigMut, toast, t]);

  const pollingEndpoints = [
    { key: 'vehicle_discovery', label: t('Vehicle Discovery'), desc: t('List vehicles from Tesla') },
    { key: 'charge_state', label: t('Charge State'), desc: t('Battery & charging data') },
    { key: 'climate_state', label: t('Climate State'), desc: t('Climate & temperature data') },
    { key: 'drive_state', label: t('Drive State'), desc: t('Location & speed data') },
    { key: 'location_data', label: t('Location Data'), desc: t('GPS coordinates') },
    { key: 'vehicle_state', label: t('Vehicle State'), desc: t('Locks, doors, odometer') },
    { key: 'vehicle_config', label: t('Vehicle Config'), desc: t('Model, trim, options') },
  ];

  const onDemandEndpoints = [
    { key: 'on_demand_vehicle_discovery', label: t('Vehicle Discovery'), desc: t('Sync vehicles from Tesla') },
    { key: 'on_demand_charge_state', label: t('Charge State'), desc: t('Battery & charging data') },
    { key: 'on_demand_climate_state', label: t('Climate State'), desc: t('Climate & temperature data') },
    { key: 'on_demand_drive_state', label: t('Drive State'), desc: t('Location & speed data') },
    { key: 'on_demand_location_data', label: t('Location Data'), desc: t('GPS coordinates') },
    { key: 'on_demand_vehicle_state', label: t('Vehicle State'), desc: t('Locks, doors, odometer') },
    { key: 'on_demand_vehicle_config', label: t('Vehicle Config'), desc: t('Model, trim, options') },
    { key: 'nearby_charging_sites', label: t('Nearby Charging'), desc: t('Supercharger locations') },
    { key: 'release_notes', label: t('Release Notes'), desc: t('Firmware release notes') },
    { key: 'recent_alerts', label: t('Recent Alerts'), desc: t('Vehicle alert history') },
    { key: 'service_data', label: t('Service Data'), desc: t('Service history & status') },
  ];

  const commandEndpoints = [
    { key: 'wake_up', label: t('Wake Up'), desc: t('Wake vehicle from sleep') },
    { key: 'commands', label: t('Vehicle Commands'), desc: t('Lock, unlock, climate, etc.') },
  ];

  const enabledCount = pollingConfig
    ? Object.keys(pollingConfig).filter(k => k !== 'telemetry_capture_retention_days' && pollingConfig[k]).length
    : 0;
  const totalCount = pollingConfig
    ? Object.keys(pollingConfig).filter(k => k !== 'telemetry_capture_retention_days').length
    : 0;

  return (
    <PageContainer
      title={t('Fleet API Settings')}
      subtitle={t('Control Tesla Fleet API polling, endpoint toggles, and telemetry capture')}
    >
      {/* ── Tesla API Polling ────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconBox color={settings?.api_suspended ? 'red' : 'green'}>
                {settings?.api_suspended ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </IconBox>
              <div>
                <span className="text-base font-semibold text-[var(--text-primary)] block">
                  {t('Tesla API Polling')}
                </span>
                <span className="text-xs text-[var(--text-muted)] block">
                  {settings?.api_suspended
                    ? t('All Tesla Fleet API calls are suspended')
                    : t('Vehicle data is being polled from Tesla')}
                </span>
              </div>
            </div>
            <Toggle
              checked={!settings?.api_suspended}
              onChange={() => suspendMut.mutate(!settings?.api_suspended, {
                onSuccess: (_, suspended) => {
                  if (suspended) toast.info(t('API suspended'), t('All Tesla API calls have been paused'));
                  else toast.success(t('API resumed'), t('Tesla API polling has been re-enabled'));
                },
                onError: () => toast.error(t('Failed'), t('Could not toggle API suspension')),
              })}
            />
          </div>

          {settings?.api_suspended && (
            <GlassPanel className="flex items-center gap-2 p-3 bg-neon-red/5 border-neon-red/20">
              <Pause className="h-4 w-4 text-neon-red shrink-0" />
              <span className="text-xs text-neon-red/80">
                {t('Polling and commands are paused. Token refresh continues so you won\'t need to re-authenticate. Useful when your vehicle is in service.')}
              </span>
            </GlassPanel>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── API Endpoint Controls ────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <IconBox color="cyan">
              <Shield className="h-5 w-5" />
            </IconBox>
            <div>
              <span className="text-base font-semibold text-[var(--text-primary)] block">
                {t('API Endpoint Controls')}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {t('Toggle individual Tesla Fleet API endpoints on or off')}
                {pollingConfig && (
                  <span className="ml-1 text-neon-cyan">({enabledCount}/{totalCount} {t('enabled')})</span>
                )}
              </span>
            </div>
          </div>

          {pollingConfig && (
            <div className="space-y-4">
              {/* Polling Endpoints */}
              <div>
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 block">
                  {t('Polling Endpoints')}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {pollingEndpoints.map(ep => (
                    <EndpointToggle key={ep.key} label={ep.label} desc={ep.desc} enabled={!!pollingConfig[ep.key]} onToggle={() => toggleEndpoint(ep.key)} />
                  ))}
                </div>
              </div>

              {/* On-Demand Endpoints */}
              <div>
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 block">
                  {t('On-Demand Endpoints')}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {onDemandEndpoints.map(ep => (
                    <EndpointToggle key={ep.key} label={ep.label} desc={ep.desc} enabled={!!pollingConfig[ep.key]} onToggle={() => toggleEndpoint(ep.key)} />
                  ))}
                </div>
              </div>

              {/* Commands */}
              <div>
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 block">
                  {t('Commands')}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {commandEndpoints.map(ep => (
                    <EndpointToggle key={ep.key} label={ep.label} desc={ep.desc} enabled={!!pollingConfig[ep.key]} onToggle={() => toggleEndpoint(ep.key)} />
                  ))}
                </div>
              </div>

              {/* Telemetry Capture */}
              <div className={captureStats && !captureStats.mongodb_enabled ? 'opacity-50' : ''}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                    {t('Telemetry Capture')}
                  </span>
                  {captureStats && (
                    <Badge variant={captureStats.mongodb_enabled ? 'success' : 'neutral'} size="sm">
                      {captureStats.mongodb_enabled ? t('MongoDB Connected') : t('MongoDB Not Configured')}
                    </Badge>
                  )}
                </div>
                <div className="space-y-2">
                  <EndpointToggle
                    label={t('Raw Signal Recording')}
                    desc={captureStats && !captureStats.mongodb_enabled
                      ? t('Set MONGODB_ENABLED=true and configure MONGODB_URI to enable')
                      : t('Capture every fleet telemetry signal to MongoDB for debugging')}
                    enabled={!!pollingConfig.telemetry_capture}
                    onToggle={() => toggleEndpoint('telemetry_capture')}
                  />
                  {pollingConfig.telemetry_capture && captureStats?.mongodb_enabled && (
                    <>
                      <GlassPanel className="flex items-center justify-between p-2.5">
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-[var(--text-primary)] block">{t('Retention Period')}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">{t('Auto-delete captured signals after this many days')}</span>
                        </div>
                        <Select
                          value={String(pollingConfig.telemetry_capture_retention_days || 7)}
                          onChange={(e) => {
                            pollingConfigMut.mutate({ ...pollingConfig, telemetry_capture_retention_days: parseInt(e.target.value) });
                          }}
                          disabled={pollingConfigMut.isPending}
                          options={[
                            { value: '1', label: t('1 day') },
                            { value: '3', label: t('3 days') },
                            { value: '7', label: t('7 days') },
                            { value: '14', label: t('14 days') },
                            { value: '30', label: t('30 days') },
                          ]}
                          className="w-28"
                        />
                      </GlassPanel>
                      {captureStats.total_documents > 0 && (
                        <GlassPanel className="p-2.5 bg-neon-cyan/5 border-neon-cyan/10">
                          <span className="text-[10px] text-neon-cyan">
                            {fmtInt(captureStats.total_documents)} {t('signals captured from')} {captureStats.distinct_vins.length} {t('vehicle')}{captureStats.distinct_vins.length !== 1 ? 's' : ''}
                          </span>
                        </GlassPanel>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Configured Endpoints ─────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <IconBox color="purple">
              <Globe className="h-5 w-5" />
            </IconBox>
            <div>
              <span className="text-base font-semibold text-[var(--text-primary)] block">
                {t('API Endpoints')}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {version ? `v${version.chart_version} · ${version.go_version} · ${version.os}/${version.arch}` : ''}
              </span>
            </div>
          </div>

          {version?.endpoints && Object.keys(version.endpoints).length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Link className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">
                  {t('Configured Endpoints')}
                </span>
              </div>
              <div className="grid gap-2">
                {[
                  { key: 'api', label: t('API (Internal)') },
                  { key: 'web', label: t('Web Frontend') },
                  { key: 'oauth_callback', label: t('OAuth Callback') },
                  { key: 'tesla_api', label: t('Tesla Fleet API') },
                ].map(ep => version.endpoints[ep.key] && (
                  <GlassPanel key={ep.key} className="flex items-center justify-between p-2.5">
                    <span className="text-xs text-[var(--text-muted)] font-medium">{ep.label}</span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">{version.endpoints[ep.key]}</span>
                  </GlassPanel>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('common.noData', 'No data available')}</p>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
