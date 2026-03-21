import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getSoftwareUpdates, Vehicle, SoftwareUpdate } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Pagination } from '../components/ui'
import { Download, CheckCircle, Clock, ArrowUpCircle, Smartphone, Calendar, ExternalLink, TrendingUp } from 'lucide-react'
import clsx from 'clsx'

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

function VersionComparison({ current, previous }: { current: SoftwareUpdate | undefined; previous: SoftwareUpdate | undefined }) {
  const daysSinceUpdate = current?.installed_at
    ? Math.floor((Date.now() - new Date(current.installed_at).getTime()) / 86400000)
    : null

  return (
    <GlassPanel className="p-6">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Current Version</h3>
      <div className="flex items-center gap-4 mt-3">
        <div className="text-center">
          <p className="text-2xl font-bold text-neon-cyan">{current?.version || '—'}</p>
          <p className="text-[10px] text-[var(--text-muted)]">Current</p>
        </div>
        {previous && (
          <>
            <div className="text-[var(--text-muted)]">←</div>
            <div className="text-center">
              <p className="text-lg font-medium text-[var(--text-secondary)]">{previous.version}</p>
              <p className="text-[10px] text-[var(--text-muted)]">Previous</p>
            </div>
          </>
        )}
      </div>
      {daysSinceUpdate != null && (
        <p className="text-xs text-[var(--text-muted)] mt-3">Updated {daysSinceUpdate} days ago</p>
      )}
    </GlassPanel>
  )
}

function UpdateFrequencyStats({ updates }: { updates: SoftwareUpdate[] }) {
  const { avgDays, totalInstalled } = useMemo(() => {
    const installed = updates
      .filter(u => u.status === 'installed' && u.installed_at)
      .sort((a, b) => new Date(a.installed_at!).getTime() - new Date(b.installed_at!).getTime())

    if (installed.length < 2) return { avgDays: 0, totalInstalled: installed.length }

    let totalDaysBetween = 0
    for (let i = 1; i < installed.length; i++) {
      const prev = new Date(installed[i - 1].installed_at!).getTime()
      const curr = new Date(installed[i].installed_at!).getTime()
      totalDaysBetween += (curr - prev) / 86400000
    }

    return {
      avgDays: Math.round(totalDaysBetween / (installed.length - 1)),
      totalInstalled: installed.length,
    }
  }, [updates])

  return (
    <GlassPanel className="p-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        <TrendingUp className="h-4 w-4 text-neon-purple" /> Update Frequency
      </h3>
      <div className="flex items-center gap-6 mt-3">
        <div>
          <p className="text-2xl font-bold text-neon-purple">{avgDays}</p>
          <p className="text-[10px] text-[var(--text-muted)]">Avg Days Between Updates</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-neon-green">{totalInstalled}</p>
          <p className="text-[10px] text-[var(--text-muted)]">Total Updates Installed</p>
        </div>
      </div>
    </GlassPanel>
  )
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

  const vehicleMap = new Map<number, Vehicle>()
  vehicles?.forEach(v => vehicleMap.set(v.id, v))

  const latestVersion = updates?.[0]?.version ?? 'Unknown'
  const totalUpdates = updates?.length ?? 0
  const installedCount = updates?.filter(u => u.status === 'installed').length ?? 0

  const installedUpdates = useMemo(() => {
    if (!updates) return []
    return updates
      .filter(u => u.status === 'installed' && u.installed_at)
      .sort((a, b) => new Date(b.installed_at!).getTime() - new Date(a.installed_at!).getTime())
  }, [updates])

  const currentUpdate = installedUpdates[0]
  const previousUpdate = installedUpdates[1]

  const daysOnVersionMap = useMemo(() => {
    const map = new Map<number, number>()
    for (let i = 0; i < installedUpdates.length; i++) {
      const installDate = new Date(installedUpdates[i].installed_at!).getTime()
      const endDate = i === 0 ? Date.now() : new Date(installedUpdates[i - 1].installed_at!).getTime()
      map.set(installedUpdates[i].id, Math.floor((endDate - installDate) / 86400000))
    }
    return map
  }, [installedUpdates])

  return (
    <FadeIn>
      <div className="flex items-center justify-between mb-8">
        <PageHeader title="Software Updates" subtitle="Track firmware versions and update history" icon={<Smartphone className="h-7 w-7 text-neon-cyan" />} />
        {vehicles && vehicles.length > 1 && (
          <select
            value={vehicleId ?? ''}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            className="glass-card px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
            style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          >
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>)}
          </select>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <GlassPanel className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-neon-cyan/10 p-2.5"><Smartphone className="h-5 w-5 text-neon-cyan" /></div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Current Version</p>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{latestVersion}</p>
            </div>
          </div>
        </GlassPanel>
        <GlassPanel className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-neon-green/10 p-2.5"><CheckCircle className="h-5 w-5 text-neon-green" /></div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Updates Installed</p>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{installedCount}</p>
            </div>
          </div>
        </GlassPanel>
        <GlassPanel className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-neon-purple/10 p-2.5"><Download className="h-5 w-5 text-neon-purple" /></div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Total Updates</p>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{totalUpdates}</p>
            </div>
          </div>
        </GlassPanel>
      </div>

      {/* Version Comparison & Update Frequency */}
      {updates && updates.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <VersionComparison current={currentUpdate} previous={previousUpdate} />
          <UpdateFrequencyStats updates={updates} />
        </div>
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
                    <div className="glass-card p-4 hover:border-[var(--glass-border)] transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{u.version}</span>
                            <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium', s.bg, s.color)}>{s.label}</span>
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
                              <span>{new Date(u.installed_at).toLocaleDateString()}</span>
                            </div>
                          )}
                          {u.status === 'installed' && daysOnVersionMap.has(u.id) && (
                            <p className="text-[10px] text-neon-purple">
                              {daysOnVersionMap.get(u.id)} days on this version
                            </p>
                          )}
                          {u.scheduled_at && !u.installed_at && (
                            <div className="flex items-center gap-1 text-xs text-neon-amber">
                              <Clock className="h-3 w-3" />
                              <span>Scheduled: {new Date(u.scheduled_at).toLocaleDateString()}</span>
                            </div>
                          )}
                          <p className="text-[10px] text-gray-600 mt-0.5">{new Date(u.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>
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
