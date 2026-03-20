import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { getAuditLogs, AuditLog } from '../api'
import {
  Server, Database, Radio, Wifi, WifiOff, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Activity, Clock, Cpu, HardDrive,
  Shield, Gauge,
} from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { AnimatedNumber } from '../components/Widgets'
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

function RateLimitGauge() {
  const maxReqs = 100
  const windowMin = 1
  const usagePct = 0 // Display-only: we don't track live usage client-side
  const barColor = usagePct > 80 ? '#ef4444' : usagePct > 50 ? '#f59e0b' : '#10b981'

  return (
    <FadeIn delay={0.2}>
      <GlassPanel className="p-5">
        <h3 className="section-title flex items-center gap-2 mb-4">
          <Gauge className="h-4 w-4 text-neon-amber" /> API Rate Limit
        </h3>
        <div className="flex items-center gap-6">
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-2">
              <span>0 req/min</span>
              <span className="font-semibold text-[var(--text-primary)]">{maxReqs} req/min</span>
            </div>
            <div className="h-4 rounded-full bg-white/[0.04] overflow-hidden relative">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.max(usagePct, 2)}%`, background: `linear-gradient(90deg, ${barColor}80, ${barColor})`, boxShadow: `0 0 8px ${barColor}40` }}
              />
              {[25, 50, 75].map(mark => (
                <div key={mark} className="absolute top-0 h-full w-px bg-white/10" style={{ left: `${mark}%` }} />
              ))}
            </div>
            <div className="flex items-center justify-between mt-2 text-[10px] text-[var(--text-muted)]">
              <span>Window: {windowMin} minute</span>
              <span>Per-IP rate limiting via httprate</span>
            </div>
          </div>
          <div className="text-center shrink-0">
            <p className="text-3xl font-bold text-[var(--text-primary)]">{maxReqs}</p>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Max / min</p>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}

function AuditLogTable() {
  const { data: logs, isLoading } = useQuery({ queryKey: ['audit-logs'], queryFn: () => getAuditLogs(30), refetchInterval: 30_000 })

  const actionColor: Record<string, string> = {
    create: '#10b981',
    update: '#f59e0b',
    delete: '#ef4444',
    command: '#a855f7',
  }

  return (
    <FadeIn delay={0.25}>
      <GlassPanel className="p-5">
        <h3 className="section-title flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-neon-purple" /> Audit Log
        </h3>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : logs && logs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider border-b border-white/[0.06]">
                  <th className="py-2 text-left">Time</th>
                  <th className="py-2 text-left">Action</th>
                  <th className="py-2 text-left">Resource</th>
                  <th className="py-2 text-left">Details</th>
                  <th className="py-2 text-left">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l: AuditLog) => (
                  <tr key={l.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="py-2 text-[var(--text-muted)] whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ backgroundColor: `${actionColor[l.action] ?? '#6b7280'}15`, color: actionColor[l.action] ?? '#6b7280' }}>
                        {l.action}
                      </span>
                    </td>
                    <td className="py-2 text-[var(--text-secondary)]">{l.resource}</td>
                    <td className="py-2 text-[var(--text-muted)] max-w-xs truncate">{l.details}</td>
                    <td className="py-2 text-[var(--text-muted)] font-mono">{l.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">No audit log entries yet</p>
        )}
      </GlassPanel>
    </FadeIn>
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

      {/* API Rate Limit Display */}
      <RateLimitGauge />

      {/* Audit Logs */}
      <AuditLogTable />
    </div>
  )
}
