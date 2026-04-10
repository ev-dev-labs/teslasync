import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getSoftwareUpdates, getVehicleState, Vehicle } from '../api'
import { useVehicleLive } from '../hooks/useVehicleLive'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Pagination, MetricCard, Badge, Select } from '../components/ui'
import { Download, CheckCircle, Clock, ArrowUpCircle, Smartphone, Calendar, ExternalLink, Activity } from 'lucide-react'
import clsx from 'clsx'
import { formatDate } from '../lib/dateFormat'

const statusConfig: Record<string, { color: string; bg: string; icon: typeof CheckCircle; label: string }> = {
  installed: { color: 'text-neon-green', bg: 'bg-neon-green/10', icon: CheckCircle, label: 'Installed' },
  installing: { color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', icon: Download, label: 'Installing' },
  downloading: { color: 'text-neon-blue', bg: 'bg-neon-blue/10', icon: Download, label: 'Downloading' },
  available: { color: 'text-neon-amber', bg: 'bg-neon-amber/10', icon: ArrowUpCircle, label: 'Available' },
  scheduled: { color: 'text-neon-purple', bg: 'bg-neon-purple/10', icon: Clock, label: 'Scheduled' },
}

function getStatus(status: string) {
  return statusConfig[status] ?? statusConfig.available
}

export default function SoftwareUpdates() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const { data: updates, isLoading } = useQuery({
    queryKey: ['software-updates', vehicleId, page, pageSize],
    queryFn: () => getSoftwareUpdates(vehicleId ?? undefined, pageSize, (page - 1) * pageSize),
    enabled: vehicleId !== null,
  })

  // Get current version from vehicle state (SignalStore / Fleet API)
  const { data: vehicleState } = useQuery({
    queryKey: ['vehicle-state-sw', vehicleId],
    queryFn: () => getVehicleState(vehicleId!),
    enabled: vehicleId !== null,
  })

  // SSE live state for real-time software update progress
  const { state: live, connected: sseConnected } = useVehicleLive(vehicleId ?? undefined)
  const hasActiveUpdate = live.swUpdateDownloadPct > 0 || live.swUpdateInstallPct > 0 || !!live.swUpdateVersion

  const vehicleMap = new Map<number, Vehicle>()
  vehicles?.forEach(v => vehicleMap.set(v.id, v))

  const latestVersion = updates?.[0]?.version ?? live.version ?? live.swUpdateVersion ?? vehicleState?.state?.software_version ?? 'Unknown'
  const totalUpdates = updates?.length ?? 0
  const installedCount = updates?.filter(u => u.status === 'installed').length ?? 0

  return (
    <FadeIn>
      <div className="flex items-center justify-between mb-8">
        <PageHeader title="Software Updates" subtitle="Track firmware versions and update history" icon={<Smartphone className="h-7 w-7 text-neon-cyan" />} />
        {vehicles && vehicles.length > 1 && (
          <Select
            value={vehicleId ?? ''}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
          />
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <MetricCard
          icon={<Smartphone className="h-5 w-5" />}
          label="Current Version"
          value={latestVersion}
          color="cyan"
        />
        <MetricCard
          icon={<CheckCircle className="h-5 w-5" />}
          label="Updates Installed"
          value={installedCount}
          color="green"
        />
        <MetricCard
          icon={<Download className="h-5 w-5" />}
          label="Total Updates"
          value={totalUpdates}
          color="purple"
        />
      </div>

      {/* Live Update Progress (shown when an update is in progress) */}
      {hasActiveUpdate && (
        <GlassPanel className="p-5 mb-8 border border-neon-cyan/20">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-neon-cyan animate-pulse" />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Update In Progress</h3>
            </div>
            {sseConnected && (
              <span className="flex items-center gap-1.5 text-[10px] text-neon-green">
                <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
                Live
              </span>
            )}
          </div>

          <div className="space-y-4">
            {live.swUpdateVersion && (
              <div className="flex items-center gap-2">
                <ArrowUpCircle className="h-4 w-4 text-neon-cyan" />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Target Version:</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{live.swUpdateVersion}</span>
              </div>
            )}

            {/* Download Progress */}
            {live.swUpdateDownloadPct > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <Download className="h-3 w-3 inline mr-1" />Download
                  </span>
                  <span className="text-xs font-bold text-neon-blue">{live.swUpdateDownloadPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neon-blue to-neon-cyan transition-all duration-500"
                    style={{ width: `${Math.min(live.swUpdateDownloadPct, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Install Progress */}
            {live.swUpdateInstallPct > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <ArrowUpCircle className="h-3 w-3 inline mr-1" />Installation
                  </span>
                  <span className="text-xs font-bold text-neon-green">{live.swUpdateInstallPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neon-green to-neon-cyan transition-all duration-500"
                    style={{ width: `${Math.min(live.swUpdateInstallPct, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Expected duration & scheduled start */}
            <div className="flex flex-wrap gap-4">
              {live.swUpdateExpectedMin > 0 && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Est. {live.swUpdateExpectedMin} min remaining
                  </span>
                </div>
              )}
              {live.swUpdateScheduledStart && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Scheduled: {live.swUpdateScheduledStart}
                  </span>
                </div>
              )}
            </div>
          </div>
        </GlassPanel>
      )}

      {/* Timeline */}
      <GlassPanel className="p-6">
        <h3 className="text-sm font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>Update Timeline</h3>
        {isLoading ? (
          <div className="space-y-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
        ) : !updates?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
            <Smartphone className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">No software update history available</p>
          </div>
        ) : (
          <>
          <div className="relative">
            <div className="absolute left-6 top-0 bottom-0 w-px bg-white/10" />
            <div className="space-y-4">
              {updates.map((u, _i) => {
                const s = getStatus(u.status)
                const Icon = s.icon
                const vName = vehicleMap.get(u.vehicle_id)?.display_name ?? `Vehicle ${u.vehicle_id}`
                return (
                  <div key={u.id} className="relative pl-14">
                    <div className={clsx('absolute left-3.5 top-3 h-5 w-5 rounded-full flex items-center justify-center ring-4', s.bg, 'ring-[var(--bg)]')}>
                      <Icon className={clsx('h-3 w-3', s.color)} />
                    </div>
                    <GlassPanel className="p-4 hover:border-[var(--glass-border)] transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{u.version}</span>
                            <Badge color={s.color === 'text-neon-green' ? 'green' : s.color === 'text-neon-cyan' ? 'cyan' : s.color === 'text-neon-amber' ? 'amber' : s.color === 'text-neon-purple' ? 'purple' : 'cyan'}>{s.label}</Badge>
                            <a
                              href={`https://www.notateslaapp.com/software-updates/version/${encodeURIComponent(u.version)}/release-notes`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--text-muted)] hover:text-neon-cyan transition-colors"
                              title="View release notes"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                          <p className="text-xs text-[var(--text-muted)]">{vName}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {u.installed_at && (
                            <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                              <Calendar className="h-3 w-3" />
                              <span>{formatDate(u.installed_at)}</span>
                            </div>
                          )}
                          {u.scheduled_at && !u.installed_at && (
                            <div className="flex items-center gap-1 text-xs text-neon-amber">
                              <Clock className="h-3 w-3" />
                              <span>Scheduled: {formatDate(u.scheduled_at)}</span>
                            </div>
                          )}
                          <p className="text-[10px] text-gray-600 mt-0.5">{formatDate(u.created_at)}</p>
                        </div>
                      </div>
                    </GlassPanel>
                  </div>
                )
              })}
            </div>
          </div>
          <Pagination page={page} pageSize={pageSize} total={updates.length < pageSize ? (page - 1) * pageSize + updates.length : page * pageSize + 1} onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(1) }} />
          </>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
