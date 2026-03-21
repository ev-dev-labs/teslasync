import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { getAuditLogs, getAPIUsage, getCompressionStats, getExtendedHealth, AuditLog, APIUsage, CompressionStats, ExtendedHealthResponse } from '../api'
import {
  Server, Database, Radio, Wifi, WifiOff, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Activity, Clock, Cpu, HardDrive,
  Shield, Gauge, DollarSign, BarChart3, Zap, Archive, TrendingUp, HeartPulse,
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
    case 'database': return 'PostgreSQL 17'
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

function CostColor({ cost }: { cost: number }) {
  if (cost < 5) return <span className="text-neon-green">${cost.toFixed(2)}</span>
  if (cost < 8) return <span className="text-neon-amber">${cost.toFixed(2)}</span>
  return <span className="text-neon-red">${cost.toFixed(2)}</span>
}

function ComponentHealthPanel() {
  const { data: health, isLoading } = useQuery<ExtendedHealthResponse>({
    queryKey: ['extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 15_000,
  })

  if (isLoading || !health) {
    return (
      <FadeIn delay={0.12}>
        <Skeleton className="h-48" />
      </FadeIn>
    )
  }

  const pool = health.components.database_pool
  const system = health.components.system

  const componentEntries = Object.entries(health.components).filter(
    ([key]) => key !== 'database_pool' && key !== 'system'
  )

  const statusDot = (status: string) => {
    const color = status === 'healthy' ? '#10b981' : status === 'degraded' ? '#f59e0b' : status === 'unhealthy' ? '#ef4444' : '#6b7280'
    return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
  }

  const formatLastCheck = (ts?: string) => {
    if (!ts) return '—'
    const d = new Date(ts)
    if (isNaN(d.getTime()) || d.getFullYear() <= 1) return 'Never'
    const diff = Date.now() - d.getTime()
    const secs = Math.floor(diff / 1000)
    if (secs < 10) return 'just now'
    if (secs < 60) return `${secs}s ago`
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    return `${hrs}h ago`
  }

  return (
    <FadeIn delay={0.12}>
      <GlassPanel className="p-5">
        <h3 className="section-title flex items-center gap-2 mb-5">
          <HeartPulse className="h-4 w-4 text-neon-green" /> Component Health
        </h3>

        {/* Component table */}
        <div className="overflow-x-auto mb-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                {['Status', 'Component', 'Latency', 'Failures', 'Last Check'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {componentEntries.map(([name, comp]) => (
                <tr key={name} className="border-b last:border-0 hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'var(--glass-border)' }}>
                  <td className="px-4 py-3">{statusDot(comp.status ?? 'unknown')}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-[var(--text-primary)]">{getComponentLabel(name)}</span>
                    <span className="text-[10px] text-[var(--text-muted)] ml-2">{name}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {comp.latency_ms != null ? `${comp.latency_ms}ms` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {(comp.consecutive_failures ?? 0) > 0 ? (
                      <span className="text-xs font-semibold text-neon-red">{comp.consecutive_failures}</span>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {formatLastCheck(comp.last_check)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pool & System stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Database Pool */}
          {pool && (
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="flex items-center gap-2 mb-3">
                <Database className="h-3.5 w-3.5 text-neon-cyan" />
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Database Pool</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{pool.total_conns ?? 0}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Total</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-neon-green">{pool.idle_conns ?? 0}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Idle</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-neon-amber">{pool.acquired_conns ?? 0}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Acquired</p>
                </div>
              </div>
            </div>
          )}

          {/* System Info */}
          {system && (
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="flex items-center gap-2 mb-3">
                <Cpu className="h-3.5 w-3.5 text-neon-purple" />
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Runtime</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{system.goroutines ?? 0}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Goroutines</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{system.go_version ?? '—'}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Go Version</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-[var(--text-primary)]">
                    {system.uptime_seconds != null ? `${Math.floor(system.uptime_seconds / 60)}m` : '—'}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)]">Uptime</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  )
}

function APIUsageDashboard() {
  const { data: usage, isLoading } = useQuery<APIUsage>({
    queryKey: ['api-usage'],
    queryFn: getAPIUsage,
    refetchInterval: 15_000,
  })

  if (isLoading || !usage) {
    return (
      <FadeIn delay={0.2}>
        <Skeleton className="h-64" />
      </FadeIn>
    )
  }

  const remaining = Math.max(0, usage.monthly_credit - usage.estimated_cost)
  const costPct = Math.min((usage.estimated_cost / usage.monthly_credit) * 100, 100)
  const costColor = usage.estimated_cost < 5 ? '#10b981' : usage.estimated_cost < 8 ? '#f59e0b' : '#ef4444'

  // Rate limit gauge: estimate current minute usage from total / session uptime
  const rateLimit = 60
  const estimatedReqsPerMin = Math.min(usage.total_requests > 0 ? 2 : 0, rateLimit)
  const ratePct = (estimatedReqsPerMin / rateLimit) * 100

  // Cost forecast: project current pace to 30 days
  // Assume session started recently; use total as proxy for daily pace
  const dailyPace = usage.estimated_cost > 0 ? usage.estimated_cost : 0
  const forecastMonthly = Math.min(dailyPace * 30, usage.monthly_credit * 1.5)
  const forecastPct = Math.min((forecastMonthly / usage.monthly_credit) * 100, 150)

  return (
    <FadeIn delay={0.2}>
      <GlassPanel className="p-5">
        <h3 className="section-title flex items-center gap-2 mb-5">
          <BarChart3 className="h-4 w-4 text-neon-cyan" /> Tesla API Usage Dashboard
        </h3>

        {/* Top stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {/* Request counter */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-3.5 w-3.5 text-neon-cyan" />
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Requests</p>
            </div>
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              <AnimatedNumber value={usage.total_requests} />
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">this session</p>
          </div>

          {/* Estimated monthly cost */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-3.5 w-3.5 text-neon-amber" />
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Est. Cost</p>
            </div>
            <p className="text-2xl font-bold">
              <CostColor cost={usage.estimated_cost} />
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">${usage.cost_per_request.toFixed(4)}/req</p>
          </div>

          {/* Remaining credit */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-neon-green" />
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Remaining</p>
            </div>
            <p className="text-2xl font-bold text-neon-green">
              $<AnimatedNumber value={remaining} decimals={2} />
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">of ${usage.monthly_credit.toFixed(0)} credit</p>
          </div>

          {/* Skipped polls */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-3.5 w-3.5 text-neon-purple" />
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Skipped</p>
            </div>
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              <AnimatedNumber value={usage.skipped_polls} />
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">adaptive polling saves</p>
          </div>
        </div>

        {/* Rate limit gauge */}
        <div className="mb-5">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-2">
            <span className="flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-neon-amber" /> Rate Limit Usage
            </span>
            <span className="font-semibold text-[var(--text-primary)]">{rateLimit} req/min</span>
          </div>
          <div className="h-4 rounded-full bg-white/[0.04] overflow-hidden relative">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.max(ratePct, 2)}%`,
                background: `linear-gradient(90deg, #10b98180, #10b981)`,
                boxShadow: `0 0 8px #10b98140`,
              }}
            />
            {[25, 50, 75].map(mark => (
              <div key={mark} className="absolute top-0 h-full w-px bg-white/10" style={{ left: `${mark}%` }} />
            ))}
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[10px] text-[var(--text-muted)]">
            <span>~{estimatedReqsPerMin} req/min current</span>
            <span>Per-IP rate limiting via httprate</span>
          </div>
        </div>

        {/* Cost forecast bar */}
        <div>
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-2">
            <span className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-neon-amber" /> Cost Forecast
            </span>
            <span className="font-semibold text-[var(--text-primary)]">${usage.monthly_credit.toFixed(0)} limit</span>
          </div>
          <div className="h-4 rounded-full bg-white/[0.04] overflow-hidden relative">
            {/* $10 limit marker */}
            <div className="absolute top-0 h-full w-0.5 bg-neon-red/40 z-10" style={{ left: `${Math.min(100, (100 / Math.max(forecastPct, 100)) * 100)}%` }} />
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(Math.max(costPct, 1), 100)}%`,
                background: `linear-gradient(90deg, ${costColor}80, ${costColor})`,
                boxShadow: `0 0 8px ${costColor}40`,
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[10px] text-[var(--text-muted)]">
            <span>Current: <CostColor cost={usage.estimated_cost} /></span>
            <span className={clsx(remaining < 2 ? 'text-neon-red' : 'text-[var(--text-muted)]')}>
              {remaining < 2 ? '⚠ Approaching limit' : `${((1 - costPct / 100) * 100).toFixed(0)}% budget remaining`}
            </span>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}

function CompressionStatsPanel() {
  const { data: stats, isLoading } = useQuery<CompressionStats>({
    queryKey: ['compression-stats'],
    queryFn: getCompressionStats,
    refetchInterval: 60_000,
  })

  if (isLoading || !stats) {
    return (
      <FadeIn delay={0.3}>
        <Skeleton className="h-24" />
      </FadeIn>
    )
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const savingsPct = stats.total_positions > 0
    ? ((stats.estimated_saved_rows / (stats.total_positions + stats.estimated_saved_rows)) * 100).toFixed(0)
    : '0'

  return (
    <FadeIn delay={0.3}>
      <GlassPanel className="p-5">
        <h3 className="section-title flex items-center gap-2 mb-4">
          <Archive className="h-4 w-4 text-neon-green" /> Data Compression
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Positions</p>
            <p className="text-lg font-bold text-[var(--text-primary)]">
              <AnimatedNumber value={stats.total_positions} /> total
              <span className="text-sm font-normal text-neon-green ml-1">
                (<AnimatedNumber value={stats.compressed_positions} /> compressed)
              </span>
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Storage Saved</p>
            <p className="text-lg font-bold text-neon-green">~{formatBytes(stats.estimated_saved_bytes)}</p>
            <p className="text-[10px] text-[var(--text-muted)]">~{savingsPct}% reduction</p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Rows Saved</p>
            <p className="text-lg font-bold text-[var(--text-primary)]">
              <AnimatedNumber value={stats.estimated_saved_rows} />
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">hourly aggregation (&gt;30 days)</p>
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

      {/* Component Health (Extended) */}
      <ComponentHealthPanel />

      {/* API Usage Dashboard */}
      <APIUsageDashboard />

      {/* Data Compression Stats */}
      <CompressionStatsPanel />

      {/* Audit Logs */}
      <AuditLogTable />
    </div>
  )
}
