import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettings, toggleAPISuspend, getPollingConfig, updatePollingConfig, getCaptureStats, getVersionInfo, PollingConfig } from '../api'
import { useCallback } from 'react'
import { Shield, Pause, Play, Globe, Link } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, IconBox, Toggle } from '../components/ui'
import { useToast } from '../components/Toast'
import { usePageTitle } from '../hooks/usePageTitle'

export default function FleetAPI() {
  usePageTitle('Fleet API')
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: version } = useQuery({ queryKey: ['version'], queryFn: getVersionInfo, staleTime: 60_000 })

  const { data: pollingConfig } = useQuery({
    queryKey: ['polling-config'],
    queryFn: getPollingConfig,
    staleTime: 5 * 60 * 1000,
  })

  const { data: captureStats } = useQuery({
    queryKey: ['capture-stats'],
    queryFn: getCaptureStats,
    staleTime: 30 * 1000,
  })

  const suspendMut = useMutation({
    mutationFn: (suspended: boolean) => toggleAPISuspend(suspended),
    onSuccess: (_data, suspended) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      if (suspended) {
        toast.info('API suspended', 'All Tesla API calls have been paused')
      } else {
        toast.success('API resumed', 'Tesla API polling has been re-enabled')
      }
    },
    onError: () => {
      toast.error('Failed', 'Could not toggle API suspension')
    },
  })

  const pollingConfigMut = useMutation({
    mutationFn: (pc: PollingConfig) => updatePollingConfig(pc),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['polling-config'] })
      queryClient.invalidateQueries({ queryKey: ['capture-stats'] })
      toast.success('Polling config updated', 'Endpoint toggles have been saved')
    },
    onError: () => {
      toast.error('Failed', 'Could not update polling config')
    },
  })

  const toggleEndpoint = useCallback((key: keyof PollingConfig) => {
    if (!pollingConfig) return
    const updated = { ...pollingConfig, [key]: !pollingConfig[key] }
    pollingConfigMut.mutate(updated)
  }, [pollingConfig, pollingConfigMut])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet API Settings"
        subtitle="Control Tesla Fleet API polling, endpoint toggles, and telemetry capture"
      />

      {/* Tesla API Polling */}
      <FadeIn>
        <GlassPanel className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconBox color={settings?.api_suspended ? 'red' : 'green'}>
                {settings?.api_suspended ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </IconBox>
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">Tesla API Polling</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  {settings?.api_suspended
                    ? 'All Tesla Fleet API calls are suspended'
                    : 'Vehicle data is being polled from Tesla'}
                </p>
              </div>
            </div>

            <Toggle checked={!settings?.api_suspended} onChange={() => suspendMut.mutate(!settings?.api_suspended)} disabled={suspendMut.isPending} />
          </div>

          {settings?.api_suspended && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-neon-red/5 border border-neon-red/20">
              <Pause className="h-4 w-4 text-neon-red shrink-0" />
              <p className="text-xs text-neon-red/80">
                Polling and commands are paused. Token refresh continues so you won't need to re-authenticate. Useful when your vehicle is in service.
              </p>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* API Endpoint Controls */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <IconBox color="cyan">
              <Shield className="h-5 w-5" />
            </IconBox>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">API Endpoint Controls</h2>
              <p className="text-xs text-[var(--text-muted)]">
                Toggle individual Tesla Fleet API endpoints on or off
                {pollingConfig && (() => {
                  const keys = Object.keys(pollingConfig) as (keyof PollingConfig)[]
                  const enabled = keys.filter(k => pollingConfig[k]).length
                  return <span className="ml-1 text-neon-cyan">({enabled}/{keys.length} enabled)</span>
                })()}
              </p>
            </div>
          </div>

          {pollingConfig && (
            <div className="space-y-4">
              {/* Polling Endpoints */}
              <div>
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Polling Endpoints</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {([
                    { key: 'vehicle_discovery' as const, label: 'Vehicle Discovery', desc: 'List vehicles from Tesla' },
                    { key: 'charge_state' as const, label: 'Charge State', desc: 'Battery & charging data' },
                    { key: 'climate_state' as const, label: 'Climate State', desc: 'Climate & temperature data' },
                    { key: 'drive_state' as const, label: 'Drive State', desc: 'Location & speed data' },
                    { key: 'location_data' as const, label: 'Location Data', desc: 'GPS coordinates' },
                    { key: 'vehicle_state' as const, label: 'Vehicle State', desc: 'Locks, doors, odometer' },
                    { key: 'vehicle_config' as const, label: 'Vehicle Config', desc: 'Model, trim, options' },
                  ]).map(ep => (
                    <EndpointToggle key={ep.key} label={ep.label} desc={ep.desc} enabled={!!pollingConfig[ep.key]} onToggle={() => toggleEndpoint(ep.key)} disabled={pollingConfigMut.isPending} />
                  ))}
                </div>
              </div>

              {/* On-Demand Endpoints */}
              <div>
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">On-Demand Endpoints</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {([
                    { key: 'on_demand_vehicle_discovery' as const, label: 'Vehicle Discovery', desc: 'Sync vehicles from Tesla' },
                    { key: 'on_demand_charge_state' as const, label: 'Charge State', desc: 'Battery & charging data' },
                    { key: 'on_demand_climate_state' as const, label: 'Climate State', desc: 'Climate & temperature data' },
                    { key: 'on_demand_drive_state' as const, label: 'Drive State', desc: 'Location & speed data' },
                    { key: 'on_demand_location_data' as const, label: 'Location Data', desc: 'GPS coordinates' },
                    { key: 'on_demand_vehicle_state' as const, label: 'Vehicle State', desc: 'Locks, doors, odometer' },
                    { key: 'on_demand_vehicle_config' as const, label: 'Vehicle Config', desc: 'Model, trim, options' },
                    { key: 'nearby_charging_sites' as const, label: 'Nearby Charging', desc: 'Supercharger locations' },
                    { key: 'release_notes' as const, label: 'Release Notes', desc: 'Firmware release notes' },
                    { key: 'recent_alerts' as const, label: 'Recent Alerts', desc: 'Vehicle alert history' },
                    { key: 'service_data' as const, label: 'Service Data', desc: 'Service history & status' },
                  ]).map(ep => (
                    <EndpointToggle key={ep.key} label={ep.label} desc={ep.desc} enabled={!!pollingConfig[ep.key]} onToggle={() => toggleEndpoint(ep.key)} disabled={pollingConfigMut.isPending} />
                  ))}
                </div>
              </div>

              {/* Commands */}
              <div>
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Commands</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {([
                    { key: 'wake_up' as const, label: 'Wake Up', desc: 'Wake vehicle from sleep' },
                    { key: 'commands' as const, label: 'Vehicle Commands', desc: 'Lock, unlock, climate, etc.' },
                  ]).map(ep => (
                    <EndpointToggle key={ep.key} label={ep.label} desc={ep.desc} enabled={!!pollingConfig[ep.key]} onToggle={() => toggleEndpoint(ep.key)} disabled={pollingConfigMut.isPending} />
                  ))}
                </div>
              </div>

              {/* Telemetry Capture */}
              <div className={captureStats && !captureStats.mongodb_enabled ? 'opacity-50' : ''}>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Telemetry Capture</h3>
                  {captureStats && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${captureStats.mongodb_enabled ? 'bg-neon-green/10 text-neon-green' : 'bg-white/5 text-[var(--text-muted)]'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${captureStats.mongodb_enabled ? 'bg-neon-green' : 'bg-gray-500'}`} />
                      {captureStats.mongodb_enabled ? 'MongoDB Connected' : 'MongoDB Not Configured'}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  <EndpointToggle
                    label="Raw Signal Recording"
                    desc={captureStats && !captureStats.mongodb_enabled
                      ? 'Set MONGODB_ENABLED=true and configure MONGODB_URI to enable'
                      : 'Capture every fleet telemetry signal to MongoDB for debugging'}
                    enabled={!!pollingConfig.telemetry_capture}
                    onToggle={() => toggleEndpoint('telemetry_capture')}
                    disabled={pollingConfigMut.isPending || (captureStats != null && !captureStats.mongodb_enabled)}
                    iconColor={captureStats?.mongodb_enabled ? undefined : 'text-gray-500'}
                  />
                  {pollingConfig.telemetry_capture && captureStats?.mongodb_enabled && (
                    <>
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[var(--text-primary)]">Retention Period</p>
                          <p className="text-[10px] text-[var(--text-muted)]">Auto-delete captured signals after this many days</p>
                        </div>
                        <select
                          value={pollingConfig.telemetry_capture_retention_days || 7}
                          onChange={(e) => {
                            const updated = { ...pollingConfig, telemetry_capture_retention_days: parseInt(e.target.value) }
                            pollingConfigMut.mutate(updated)
                          }}
                          disabled={pollingConfigMut.isPending}
                          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-neon-cyan/50"
                        >
                          <option value={1}>1 day</option>
                          <option value={3}>3 days</option>
                          <option value={7}>7 days</option>
                          <option value={14}>14 days</option>
                          <option value={30}>30 days</option>
                        </select>
                      </div>
                      {captureStats.total_documents > 0 && (
                        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-neon-cyan/5 border border-neon-cyan/10">
                          <p className="text-[10px] text-neon-cyan">
                            {captureStats.total_documents.toLocaleString()} signals captured from {captureStats.distinct_vins.length} vehicle{captureStats.distinct_vins.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Configured Endpoints */}
      {version?.endpoints && Object.keys(version.endpoints).length > 0 && (
        <FadeIn delay={0.1}>
          <GlassPanel className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <IconBox color="purple">
                <Globe className="h-5 w-5" />
              </IconBox>
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">API Endpoints</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  {version ? `v${version.chart_version} · ${version.go_version} · ${version.os}/${version.arch}` : ''}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Link className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">Configured Endpoints</p>
              </div>
              <div className="grid gap-2">
                {version.endpoints.api && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-xs text-[var(--text-muted)] font-medium">API (Internal)</span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">{version.endpoints.api}</span>
                  </div>
                )}
                {version.endpoints.web && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-xs text-[var(--text-muted)] font-medium">Web Frontend</span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">{version.endpoints.web}</span>
                  </div>
                )}
                {version.endpoints.oauth_callback && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-xs text-[var(--text-muted)] font-medium">OAuth Callback</span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">{version.endpoints.oauth_callback}</span>
                  </div>
                )}
                {version.endpoints.tesla_api && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-xs text-[var(--text-muted)] font-medium">Tesla Fleet API</span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">{version.endpoints.tesla_api}</span>
                  </div>
                )}
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}
    </div>
  )
}

function EndpointToggle({ label, desc, enabled, onToggle, disabled }: {
  label: string; desc: string; enabled: boolean; onToggle: () => void; disabled: boolean; iconColor?: string
}) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
      <div className="min-w-0">
        <p className="text-xs font-medium text-[var(--text-primary)] truncate">{label}</p>
        <p className="text-[10px] text-[var(--text-muted)] truncate">{desc}</p>
      </div>
      <div className="shrink-0 ml-2">
        <Toggle checked={enabled} onChange={() => onToggle()} disabled={disabled} />
      </div>
    </div>
  )
}
