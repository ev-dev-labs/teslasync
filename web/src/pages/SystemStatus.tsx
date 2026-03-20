import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import {
  Server, Database, Radio, Wifi, WifiOff, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Activity, Clock, Cpu, HardDrive, Layers,
} from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { AnimatedNumber } from '../components/Widgets'
import { getDatabaseInfo, getSystemInfo, type DatabaseInfo, type SystemInfoData } from '../api'
import clsx from 'clsx'

interface ComponentInfo {
  status: string
  consecutive_failures?: number
  last_error?: string
}

interface SystemStatus {
  overall: string
  database: ComponentInfo
  tesla_api: ComponentInfo
  [key: string]: string | ComponentInfo
}

function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'ok': case 'healthy': case 'authenticated': return '#10b981'
    case 'degraded': return '#f59e0b'
    case 'unhealthy': case 'error': return '#ef4444'
    case 'no_token': return '#6b7280'
    default: return '#6b7280'
  }
}

function getStatusIcon(status: string) {
  switch (status.toLowerCase()) {
    case 'ok': case 'healthy': case 'authenticated':
      return <CheckCircle className="h-5 w-5 text-neon-green" />
    case 'degraded':
      return <AlertTriangle className="h-5 w-5 text-neon-amber" />
    case 'unhealthy': case 'error':
      return <XCircle className="h-5 w-5 text-neon-red" />
    default:
      return <AlertTriangle className="h-5 w-5 text-[var(--text-muted)]" />
  }
}

function getStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'ok': case 'healthy': return 'Healthy'
    case 'authenticated': return 'Connected'
    case 'degraded': return 'Degraded'
    case 'unhealthy': case 'error': return 'Unhealthy'
    case 'no_token': return 'Not Connected'
    default: return status
  }
}

function getComponentIcon(name: string) {
  switch (name) {
    case 'database': return <Database className="h-5 w-5" />
    case 'tesla_api': return <Radio className="h-5 w-5" />
    case 'mqtt': return <Wifi className="h-5 w-5" />
    case 'redis': return <HardDrive className="h-5 w-5" />
    case 'poller': return <Activity className="h-5 w-5" />
    default: return <Server className="h-5 w-5" />
  }
}

function getComponentLabel(name: string): string {
  switch (name) {
    case 'database': return 'PostgreSQL + TimescaleDB'
    case 'tesla_api': return 'Tesla Fleet API'
    case 'mqtt': return 'MQTT (Mosquitto)'
    case 'redis': return 'Redis Cache'
    case 'poller': return 'Vehicle Poller'
    default: return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

function ComponentCard({ name, info }: { name: string; info: ComponentInfo }) {
  const statusColor = getStatusColor(info.status)

  return (
    <GlassPanel className="p-5 relative overflow-hidden">
      {/* Status glow */}
      <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-[40px] opacity-10" style={{ backgroundColor: statusColor }} />

      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${statusColor}15` }}>
              <span style={{ color: statusColor }}>{getComponentIcon(name)}</span>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{getComponentLabel(name)}</h3>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-0.5">{name}</p>
            </div>
          </div>
          {getStatusIcon(info.status)}
        </div>

        <div className="flex items-center gap-2 mt-4">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${statusColor}15`, color: statusColor }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: statusColor }} />
            {getStatusLabel(info.status)}
          </span>
        </div>

        {(info.consecutive_failures ?? 0) > 0 && (
          <div className="mt-3 p-2.5 rounded-lg bg-neon-red/5 border border-neon-red/10">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Consecutive Failures</p>
            <p className="text-sm font-bold text-neon-red">{info.consecutive_failures}</p>
          </div>
        )}

        {info.last_error && (
          <div className="mt-3 p-2.5 rounded-lg bg-neon-red/5 border border-neon-red/10">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Last Error</p>
            <p className="text-xs text-neon-red/80 font-mono break-all">{info.last_error}</p>
          </div>
        )}
      </div>
    </GlassPanel>
  )
}

export default function SystemStatus() {
  const [refreshing, setRefreshing] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date>(new Date())
  const [, setTick] = useState(0)

  const { data: status, isLoading, refetch, dataUpdatedAt } = useQuery<SystemStatus>({
    queryKey: ['system-status'],
    queryFn: async () => {
      const res = await fetch('/api/v1/system/status')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return body as SystemStatus
      }
      return res.json()
    },
    refetchInterval: 15_000,
  })

  // Also fetch healthz and readyz for additional details
  const { data: healthz } = useQuery({
    queryKey: ['healthz'],
    queryFn: async () => {
      const res = await fetch('/healthz')
      return { ok: res.ok, status: res.status }
    },
    refetchInterval: 15_000,
  })

  const { data: readyz } = useQuery({
    queryKey: ['readyz'],
    queryFn: async () => {
      const res = await fetch('/readyz')
      const body = await res.json().catch(() => ({}))
      return { ok: res.ok, status: res.status, body }
    },
    refetchInterval: 15_000,
  })

  const { data: dbInfo } = useQuery<DatabaseInfo>({
    queryKey: ['database-info'],
    queryFn: getDatabaseInfo,
    refetchInterval: 30_000,
  })

  const { data: sysInfo } = useQuery<SystemInfoData>({
    queryKey: ['system-info'],
    queryFn: getSystemInfo,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (dataUpdatedAt) setLastChecked(new Date(dataUpdatedAt))
  }, [dataUpdatedAt])

  // Tick every 10s to update "ago" text
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 10_000)
    return () => clearInterval(t)
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setTimeout(() => setRefreshing(false), 600)
  }

  // Extract component info from status
  const components: [string, ComponentInfo][] = []
  if (status) {
    for (const [key, value] of Object.entries(status)) {
      if (key === 'overall') continue
      if (typeof value === 'object' && value !== null && 'status' in value) {
        components.push([key, value as ComponentInfo])
      }
    }
  }

  const overallStatus = status?.overall ?? 'unknown'
  const overallColor = getStatusColor(overallStatus)
  const healthyCount = components.filter(([, c]) => ['ok', 'healthy', 'authenticated'].includes(c.status.toLowerCase())).length
  const totalCount = components.length

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Status"
        subtitle="Real-time health monitoring for all TeslaSync services"
        actions={
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-[var(--text-muted)]">
              Checked {formatTimeAgo(lastChecked)}
            </span>
            <button onClick={handleRefresh} className="glass-button text-xs flex items-center gap-1.5">
              <RefreshCw className={clsx('h-3.5 w-3.5 transition-transform', refreshing && 'animate-spin')} />
              Refresh
            </button>
          </div>
        }
      />

      {/* Overall Status Hero */}
      <FadeIn>
        <GlassPanel className="p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent" style={{ background: `linear-gradient(135deg, ${overallColor}05, transparent, ${overallColor}02)` }} />
          <div className="relative flex flex-col sm:flex-row items-center gap-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-full flex items-center justify-center" style={{ backgroundColor: `${overallColor}10`, border: `2px solid ${overallColor}40` }}>
                <Server className="h-10 w-10" style={{ color: overallColor }} />
              </div>
              <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: overallColor }}>
                {overallStatus === 'healthy' ? (
                  <CheckCircle className="h-4 w-4 text-[var(--text-primary)]" />
                ) : overallStatus === 'degraded' ? (
                  <AlertTriangle className="h-4 w-4 text-[var(--text-primary)]" />
                ) : (
                  <XCircle className="h-4 w-4 text-[var(--text-primary)]" />
                )}
              </span>
            </div>
            <div className="text-center sm:text-left flex-1">
              <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-1">
                {overallStatus === 'healthy' ? 'All Systems Operational' : overallStatus === 'degraded' ? 'Partial System Degradation' : 'System Issues Detected'}
              </h2>
              <p className="text-sm text-[var(--text-secondary)]">
                {healthyCount} of {totalCount} services healthy
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-neon-green"><AnimatedNumber value={healthyCount} /></p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Healthy</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-neon-amber"><AnimatedNumber value={totalCount - healthyCount} /></p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Issues</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--text-primary)]"><AnimatedNumber value={totalCount} /></p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Total</p>
              </div>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Endpoint Status Strip */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <GlassPanel className="p-4 flex items-center gap-3">
            <div className={clsx('w-3 h-3 rounded-full', healthz?.ok ? 'bg-neon-green animate-pulse' : 'bg-neon-red')} />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">/healthz</p>
              <p className="text-[10px] text-[var(--text-muted)]">Liveness probe</p>
            </div>
            <span className={clsx('text-xs font-mono px-2 py-1 rounded', healthz?.ok ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red')}>
              {healthz?.status ?? '—'}
            </span>
          </GlassPanel>
          <GlassPanel className="p-4 flex items-center gap-3">
            <div className={clsx('w-3 h-3 rounded-full', readyz?.ok ? 'bg-neon-green animate-pulse' : 'bg-neon-red')} />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">/readyz</p>
              <p className="text-[10px] text-[var(--text-muted)]">Readiness probe</p>
            </div>
            <span className={clsx('text-xs font-mono px-2 py-1 rounded', readyz?.ok ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red')}>
              {readyz?.status ?? '—'}
            </span>
          </GlassPanel>
        </div>
      </FadeIn>

      {/* Service Components Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : (
        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {components.map(([name, info]) => (
            <StaggerItem key={name}>
              <ComponentCard name={name} info={info} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}

      {/* Database & Runtime Info */}
      <FadeIn delay={0.12}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {dbInfo && (
            <>
              <GlassPanel className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-neon-cyan/10">
                  <Database className="h-5 w-5 text-neon-cyan" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Database Size</p>
                  <p className="text-sm font-bold text-[var(--text-primary)]">{dbInfo.database_size}</p>
                </div>
              </GlassPanel>
              <GlassPanel className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-neon-purple/10">
                  <Layers className="h-5 w-5 text-neon-purple" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Tables</p>
                  <p className="text-sm font-bold text-[var(--text-primary)]"><AnimatedNumber value={dbInfo.table_count} /></p>
                </div>
              </GlassPanel>
            </>
          )}
          {sysInfo && (
            <>
              <GlassPanel className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-neon-green/10">
                  <Activity className="h-5 w-5 text-neon-green" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Goroutines</p>
                  <p className="text-sm font-bold text-[var(--text-primary)]"><AnimatedNumber value={sysInfo.goroutines} /></p>
                </div>
              </GlassPanel>
              <GlassPanel className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-neon-amber/10">
                  <Clock className="h-5 w-5 text-neon-amber" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Uptime</p>
                  <p className="text-sm font-bold text-[var(--text-primary)]">{sysInfo.uptime_seconds < 3600 ? `${Math.floor(sysInfo.uptime_seconds / 60)}m` : `${Math.floor(sysInfo.uptime_seconds / 3600)}h ${Math.floor((sysInfo.uptime_seconds % 3600) / 60)}m`}</p>
                </div>
              </GlassPanel>
            </>
          )}
        </div>
      </FadeIn>

      {/* System Info */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <Cpu className="h-4 w-4 text-neon-cyan" /> System Information
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'API Endpoint', value: window.location.origin, icon: Server },
              { label: 'Auto Refresh', value: '15 seconds', icon: RefreshCw },
              { label: 'Last Check', value: lastChecked.toLocaleTimeString(), icon: Clock },
              { label: 'Connection', value: navigator.onLine ? 'Online' : 'Offline', icon: navigator.onLine ? Wifi : WifiOff },
              ...(sysInfo ? [
                { label: 'Go Version', value: sysInfo.go_version, icon: Cpu },
                { label: 'Platform', value: `${sysInfo.os}/${sysInfo.arch}`, icon: HardDrive },
                { label: 'App Version', value: `v${sysInfo.version}`, icon: Server },
              ] : []),
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <item.icon className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{item.label}</p>
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
