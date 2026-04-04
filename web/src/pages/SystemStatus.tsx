import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { getAuditLogs, getAPIUsage, getCompressionStats, getExtendedHealth, getVersionInfo, getTelemetryStatus, getWorkersHealth, getNotificationStats, getNotificationLogs, getExportJobs, AuditLog, APIUsage, CompressionStats, ExtendedHealthResponse, TelemetryStatus, WorkersHealth, NotificationStats, NotificationLog, ExportJobSummary } from '../api'
import { getApiBase } from '../lib/resilience'
import {
  Server, Database, Radio, Wifi, WifiOff, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Activity, Clock, Cpu, HardDrive,
  Shield, Gauge, DollarSign, BarChart3, Zap, Archive, TrendingUp, HeartPulse,
  Satellite, Link, Globe, Rss, ChevronDown, Bell, Package, Download, Send,
} from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { AnimatedNumber } from '../components/Widgets'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import { formatDateTime, formatTime } from '../lib/dateFormat'

interface ComponentInfo {
  status: string
  consecutive_failures?: number
  last_error?: string
  details?: {
    enabled?: boolean
    host?: string
    port?: number
    endpoint?: string
    protocol?: string
    supported_signals?: string[]
  }
}

interface SystemStatus {
  overall: string
  database: ComponentInfo
  tesla_api: ComponentInfo
  [key: string]: string | ComponentInfo
}

function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'ok': case 'healthy': case 'authenticated': case 'connected': case 'enabled': return '#10b981'
    case 'degraded': case 'disconnected': return '#f59e0b'
    case 'unhealthy': case 'error': return '#ef4444'
    case 'no_token': case 'disabled': return '#6b7280'
    default: return '#6b7280'
  }
}

function getStatusIcon(status: string) {
  switch (status.toLowerCase()) {
    case 'ok': case 'healthy': case 'authenticated': case 'connected': case 'enabled':
      return <CheckCircle className="h-5 w-5 text-neon-green" />
    case 'degraded': case 'disconnected':
      return <AlertTriangle className="h-5 w-5 text-neon-amber" />
    case 'unhealthy': case 'error':
      return <XCircle className="h-5 w-5 text-neon-red" />
    case 'disabled':
      return <XCircle className="h-5 w-5 text-[var(--text-muted)]" />
    default:
      return <AlertTriangle className="h-5 w-5 text-[var(--text-muted)]" />
  }
}

function getStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'ok': case 'healthy': return 'Healthy'
    case 'authenticated': case 'connected': return 'Connected'
    case 'enabled': return 'Enabled'
    case 'disabled': return 'Disabled'
    case 'degraded': case 'disconnected': return 'Degraded'
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
    case 'fleet_telemetry': return <Satellite className="h-5 w-5" />
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
    case 'fleet_telemetry': return 'Fleet Telemetry'
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
  const [showSignalsModal, setShowSignalsModal] = useState(false)

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

        {/* Fleet Telemetry details */}
        {name === 'fleet_telemetry' && info.details && (
          <div className="mt-3 space-y-2">
            {info.details.enabled && (
              <>
                {info.details.endpoint && (
                  <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Endpoint</p>
                    <p className="text-xs font-mono text-[var(--text-primary)]">{info.details.endpoint}</p>
                  </div>
                )}
                {info.details.protocol && (
                  <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Protocol</p>
                    <p className="text-xs text-[var(--text-primary)]">{info.details.protocol}</p>
                  </div>
                )}
                {info.details.host && (
                  <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Host</p>
                    <p className="text-xs font-mono text-[var(--text-primary)]">{info.details.host}:{info.details.port}</p>
                  </div>
                )}
                {info.details.supported_signals && (
                  <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Signals ({info.details.supported_signals.length})</p>
                      <button onClick={() => setShowSignalsModal(true)} className="text-[10px] text-neon-cyan hover:underline">View All</button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {info.details.supported_signals.slice(0, 12).map(s => (
                        <span key={s} className="px-1.5 py-0.5 text-[10px] rounded bg-neon-cyan/10 text-neon-cyan">{s}</span>
                      ))}
                      {info.details.supported_signals.length > 12 && (
                        <button onClick={() => setShowSignalsModal(true)} className="px-1.5 py-0.5 text-[10px] rounded bg-white/5 text-[var(--text-muted)] hover:text-neon-cyan transition-colors">
                          +{info.details.supported_signals.length - 12} more
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            {!info.details.enabled && (
              <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <p className="text-xs text-[var(--text-muted)]">
                  Set <code className="text-neon-cyan text-[10px]">FLEET_TELEMETRY_ENABLED=true</code> to enable streaming telemetry from vehicles.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Signals Modal */}
      {showSignalsModal && info.details?.supported_signals && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowSignalsModal(false)}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative w-full max-w-2xl max-h-[85vh] rounded-2xl border border-white/10 p-6 overflow-y-auto"
            style={{ background: 'var(--surface-1, #0a0b1a)' }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between mb-4 pb-3 border-b border-white/10" style={{ background: 'var(--surface-1, #0a0b1a)' }}>
              <h3 className="text-lg font-bold text-[var(--text-primary)]">Subscribed Signals ({info.details.supported_signals.length})</h3>
              <button onClick={() => setShowSignalsModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-lg">✕</button>
            </div>
            {SIGNAL_GROUPS.map(group => {
              const matched = group.signals.filter((s: string) => info.details!.supported_signals!.includes(s))
              if (matched.length === 0) return null
              return (
                <div key={group.label} className="mb-3">
                  <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: group.color }}>{group.label} ({matched.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {matched.map((s: string) => (
                      <span key={s} className="px-2 py-0.5 text-[10px] rounded-full" style={{ backgroundColor: `${group.color}15`, color: group.color }}>{s}</span>
                    ))}
                  </div>
                </div>
              )
            })}
          </motion.div>
        </div>
      )}
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
    refetchInterval: 30_000,
  })

  if (isLoading || !health) {
    return (
      <FadeIn delay={0.12}>
        <Skeleton className="h-48" />
      </FadeIn>
    )
  }

  const pool = health.components.database_pool as unknown as { total_conns: number; idle_conns: number; acquired_conns: number }
  const system = health.components.system as unknown as { goroutines: number; go_version: string; uptime_seconds: number }

  const componentEntries = (Object.entries(health.components) as [string, { status: string; latency_ms?: number; consecutive_failures?: number; last_check?: string }][]).filter(
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
    refetchInterval: 30_000,
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

function RateLimitsPanel() {
  const limits = [
    { route: 'General API', limit: '100 req/min', description: 'Per-IP rate limit for all endpoints' },
    { route: 'Tesla Vehicle Data', limit: '60 req/min', description: 'Tesla Fleet API device data limit' },
    { route: 'Tesla Wakes', limit: '3 req/min', description: 'Vehicle wake command limit' },
    { route: 'Tesla Commands', limit: '30 req/min', description: 'Vehicle command limit' },
    { route: 'Webhook Inbound', limit: '30 req/min', description: 'External webhook reception rate' },
  ]

  return (
    <FadeIn delay={0.12}>
      <GlassPanel className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neon-amber/10 text-neon-amber ring-1 ring-neon-amber/20">
            <Gauge className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Rate Limits</h3>
            <p className="text-[11px] text-[var(--text-muted)]">Request throttling configured per route</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left py-2 px-3 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Route</th>
                <th className="text-left py-2 px-3 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Limit</th>
                <th className="text-left py-2 px-3 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {limits.map(l => (
                <tr key={l.route} className="border-b border-white/[0.03] last:border-0">
                  <td className="py-2.5 px-3 text-[var(--text-primary)] font-medium">{l.route}</td>
                  <td className="py-2.5 px-3"><span className="font-mono text-neon-cyan">{l.limit}</span></td>
                  <td className="py-2.5 px-3 text-[var(--text-muted)]">{l.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                    <td className="py-2 text-[var(--text-muted)] whitespace-nowrap">{formatDateTime(l.created_at)}</td>
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

// Signal grouping for the expandable signal details view
const SIGNAL_GROUPS: { label: string; color: string; signals: string[] }[] = [
  { label: 'Location', color: '#3b82f6', signals: ['Location', 'GpsHeading', 'GpsState', 'VehicleSpeed', 'Odometer', 'Gear'] },
  { label: 'Battery', color: '#10b981', signals: ['BatteryLevel', 'Soc', 'PackVoltage', 'PackCurrent', 'PackPower', 'EstBatteryRange', 'IdealBatteryRange', 'EnergyRemaining', 'BrickVoltageMax', 'BrickVoltageMin', 'ModuleTempMax', 'ModuleTempMin', 'IsolationResistance'] },
  { label: 'Charging', color: '#f59e0b', signals: ['ChargeState', 'DetailedChargeState', 'ChargeAmps', 'ChargerVoltage', 'ChargerPhases', 'ChargeLimitSoc', 'ChargeCurrentRequest', 'ChargeRateMilePerHour', 'DCChargingPower', 'ACChargingPower', 'DCChargingEnergyIn', 'ACChargingEnergyIn', 'FastChargerPresent', 'FastChargerType', 'ChargingCableType', 'TimeToFullCharge', 'BatteryHeaterOn'] },
  { label: 'Climate', color: '#8b5cf6', signals: ['InsideTemp', 'OutsideTemp', 'HvacPower', 'HvacFanSpeed', 'HvacLeftTemperatureRequest', 'HvacRightTemperatureRequest', 'CabinOverheatProtectionMode', 'DefrostMode', 'PreconditioningEnabled'] },
  { label: 'Vehicle', color: '#ec4899', signals: ['Locked', 'DoorState', 'FdWindow', 'FpWindow', 'RdWindow', 'RpWindow', 'SentryMode', 'HomelinkNearby', 'GuestModeEnabled', 'SpeedLimitMode', 'CurrentLimitMph', 'Version', 'VehicleName'] },
  { label: 'TPMS', color: '#14b8a6', signals: ['TpmsPressureFl', 'TpmsPressureFr', 'TpmsPressureRl', 'TpmsPressureRr'] },
  { label: 'Drive', color: '#f97316', signals: ['DiStateR', 'DiAxleSpeedR', 'DiTorquemotor', 'DiStatorTempR', 'PedalPosition', 'BrakePedal', 'LateralAcceleration', 'LongitudinalAcceleration'] },
]

function formatSignalValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function SignalGrid({ signals }: { signals: Record<string, unknown> }) {
  const keys = Object.keys(signals)
  if (keys.length === 0) return <p className="text-xs text-[var(--text-muted)] py-2">No signals in last batch</p>

  // Group signals; any unmatched go into "Other"
  const grouped: { label: string; color: string; items: [string, unknown][] }[] = []
  const used = new Set<string>()

  for (const group of SIGNAL_GROUPS) {
    const items = group.signals
      .filter(s => s in signals)
      .map(s => { used.add(s); return [s, signals[s]] as [string, unknown] })
    if (items.length > 0) grouped.push({ ...group, items })
  }

  const other = keys.filter(k => !used.has(k)).map(k => [k, signals[k]] as [string, unknown])
  if (other.length > 0) grouped.push({ label: 'Other', color: '#6b7280', items: other })

  return (
    <div className="space-y-3">
      {grouped.map(group => (
        <div key={group.label}>
          <p className="text-[10px] uppercase tracking-wider font-medium mb-1.5 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: group.color }} />
            <span style={{ color: group.color }}>{group.label}</span>
            <span className="text-[var(--text-muted)]">({group.items.length})</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5">
            {group.items.map(([name, value]) => (
              <div key={name} className="px-2 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] min-w-0">
                <p className="text-[9px] text-[var(--text-muted)] truncate">{name}</p>
                <p className="text-xs font-mono text-[var(--text-primary)] truncate" title={String(value)}>
                  {formatSignalValue(value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function TelemetryLivePanel() {
  const { data: telemetry, isLoading } = useQuery<TelemetryStatus>({
    queryKey: ['telemetry-status'],
    queryFn: getTelemetryStatus,
    refetchInterval: 2_000, // 2s refresh — matches real-time telemetry speed
  })

  const prevSignalCounts = useRef<Record<string, number>>({})
  const [recentActivity, setRecentActivity] = useState<Record<string, boolean>>({})
  const [expandedVin, setExpandedVin] = useState<string | null>(null)

  // Detect signal count changes to flash activity indicators
  useEffect(() => {
    if (!telemetry?.streaming_vehicles) return
    const newActivity: Record<string, boolean> = {}
    for (const [vin, v] of Object.entries(telemetry.streaming_vehicles)) {
      const prev = prevSignalCounts.current[vin] ?? 0
      newActivity[vin] = v.signal_count > prev
      prevSignalCounts.current[vin] = v.signal_count
    }
    setRecentActivity(newActivity)
    const t = setTimeout(() => setRecentActivity({}), 2000)
    return () => clearTimeout(t)
  }, [telemetry])

  if (isLoading) {
    return (
      <FadeIn delay={0.13}>
        <Skeleton className="h-48" />
      </FadeIn>
    )
  }

  if (!telemetry?.enabled) return null

  const vehicles = Object.values(telemetry.streaming_vehicles ?? {})
  const totalSignals = vehicles.reduce((sum, v) => sum + v.signal_count, 0)
  const activeVehicles = vehicles.filter(v => v.is_streaming).length
  const anyActive = activeVehicles > 0
  const avgLatency = activeVehicles > 0
    ? Math.round(vehicles.filter(v => v.is_streaming).reduce((s, v) => s + v.latency_ms, 0) / activeVehicles)
    : 0
  const totalSignalsPerSec = vehicles.filter(v => v.is_streaming).reduce((s, v) => s + (v.signals_per_second || 0), 0)

  return (
    <FadeIn delay={0.13}>
      <GlassPanel className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title flex items-center gap-2">
            <Rss className="h-4 w-4 text-neon-cyan" /> Fleet Telemetry Live
          </h3>
          <div className="flex items-center gap-2">
            {anyActive && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-neon-green/10 text-neon-green">
                <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
                Primary Data Source
              </span>
            )}
            <span className="text-[10px] text-[var(--text-muted)]">
              Real-time · 2s refresh
            </span>
          </div>
        </div>

        {/* Speed comparison banner */}
        {anyActive && telemetry.speed_comparison && (
          <div className="mb-4 p-3 rounded-xl bg-neon-cyan/[0.04] border border-neon-cyan/10">
            <div className="flex items-center gap-2 text-[10px] text-neon-cyan font-medium mb-1">
              <Zap className="h-3 w-3" /> {telemetry.speed_comparison.speedup}
            </div>
            <div className="grid grid-cols-2 gap-4 text-[10px]">
              <div>
                <span className="text-[var(--text-muted)]">Fleet Telemetry: </span>
                <span className="text-neon-green font-mono">{telemetry.speed_comparison.fleet_telemetry_latency}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Fleet API Polling: </span>
                <span className="text-[var(--text-secondary)] font-mono">{telemetry.speed_comparison.fleet_api_polling}</span>
              </div>
            </div>
          </div>
        )}

        {/* Overview stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {[
            { label: 'Data Source', value: anyActive ? 'Fleet Telemetry' : 'Fleet API', color: anyActive ? '#10b981' : '#f59e0b' },
            { label: 'Streaming Vehicles', value: `${activeVehicles} / ${vehicles.length}`, color: activeVehicles > 0 ? '#10b981' : '#6b7280' },
            { label: 'Signals/sec', value: totalSignalsPerSec > 0 ? totalSignalsPerSec.toFixed(1) : '0', color: '#00f0ff' },
            { label: 'Latency', value: anyActive ? `${avgLatency}ms` : 'N/A', color: avgLatency < 1000 ? '#10b981' : avgLatency < 5000 ? '#f59e0b' : '#ef4444' },
            { label: 'Total Signals', value: totalSignals.toLocaleString(), color: '#8b5cf6' },
          ].map(item => (
            <div key={item.label} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">{item.label}</p>
              <p className="text-lg font-bold" style={{ color: item.color }}>{item.value}</p>
            </div>
          ))}
        </div>

        {/* Per-vehicle streaming table */}
        {vehicles.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                  <th className="text-left px-4 py-2.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">VIN</th>
                  <th className="text-left px-4 py-2.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Source</th>
                  <th className="text-right px-4 py-2.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Signals/s</th>
                  <th className="text-right px-4 py-2.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Latency</th>
                  <th className="text-right px-4 py-2.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Total</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {vehicles
                  .sort((a, b) => new Date(b.last_received).getTime() - new Date(a.last_received).getTime())
                  .map(v => {
                    const lastReceived = new Date(v.last_received)
                    const isStale = Date.now() - lastReceived.getTime() > 120_000
                    const justReceived = recentActivity[v.vin]
                    const isExpanded = expandedVin === v.vin
                    const signalCount = v.last_signals ? Object.keys(v.last_signals).length : 0

                    return (
                      <tr key={v.vin} className="border-b border-white/[0.03]">
                        <td colSpan={7} className="p-0">
                          <button
                            onClick={() => setExpandedVin(isExpanded ? null : v.vin)}
                            className={clsx(
                              'w-full grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center text-left transition-colors duration-500 hover:bg-white/[0.02]',
                              justReceived && 'bg-neon-green/[0.04]',
                            )}
                          >
                            <span className="px-4 py-3">
                              <span className={clsx(
                                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium',
                                v.is_streaming && !isStale ? 'bg-neon-green/10 text-neon-green' :
                                v.is_streaming && isStale ? 'bg-neon-amber/10 text-neon-amber' :
                                'bg-white/5 text-[var(--text-muted)]',
                              )}>
                                <span className={clsx(
                                  'w-1.5 h-1.5 rounded-full',
                                  v.is_streaming && !isStale ? 'bg-neon-green animate-pulse' :
                                  v.is_streaming && isStale ? 'bg-neon-amber' :
                                  'bg-[var(--text-muted)]',
                                )} />
                                {v.is_streaming && !isStale ? 'Streaming' : v.is_streaming && isStale ? 'Stale' : 'Idle'}
                              </span>
                            </span>
                            <span className="px-4 py-3 font-mono text-xs text-[var(--text-primary)]">{v.vin}</span>
                            <span className="px-4 py-3 text-xs">
                              <span className={clsx(
                                'px-1.5 py-0.5 rounded text-[10px] font-medium',
                                v.data_source === 'fleet_telemetry' ? 'bg-neon-cyan/10 text-neon-cyan' : 'bg-neon-amber/10 text-neon-amber',
                              )}>
                                {v.data_source === 'fleet_telemetry' ? '⚡ Telemetry' : '🔄 API Poll'}
                              </span>
                            </span>
                            <span className="px-4 py-3 text-right font-mono text-xs text-neon-cyan">
                              {v.signals_per_second > 0 ? v.signals_per_second.toFixed(1) : '—'}
                            </span>
                            <span className={clsx(
                              'px-4 py-3 text-right font-mono text-xs',
                              v.latency_ms < 1000 ? 'text-neon-green' : v.latency_ms < 5000 ? 'text-neon-amber' : 'text-red-400',
                            )}>
                              {v.is_streaming ? `${Math.round(v.latency_ms)}ms` : formatTimeAgo(lastReceived)}
                            </span>
                            <span className={clsx(
                              'px-4 py-3 text-right font-mono text-xs transition-colors duration-300',
                              justReceived ? 'text-neon-green' : 'text-[var(--text-secondary)]',
                            )}>
                              <AnimatedNumber value={v.signal_count} />
                            </span>
                            <span className="px-3 py-3">
                              <ChevronDown className={clsx(
                                'h-3.5 w-3.5 text-[var(--text-muted)] transition-transform duration-200',
                                isExpanded && 'rotate-180',
                              )} />
                            </span>
                          </button>
                          {/* Expandable signal details */}
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-1 border-t border-white/[0.04]">
                              <div className="flex items-center gap-4 text-[10px] text-[var(--text-muted)] mb-2">
                                <span>Batch: {signalCount} signal{signalCount !== 1 ? 's' : ''}</span>
                                {v.batch_count > 0 && <span>Batches: {v.batch_count.toLocaleString()}</span>}
                                {v.uptime_seconds > 0 && <span>Uptime: {v.uptime_seconds >= 3600 ? `${(v.uptime_seconds / 3600).toFixed(1)}h` : v.uptime_seconds >= 60 ? `${Math.round(v.uptime_seconds / 60)}m` : `${Math.round(v.uptime_seconds)}s`}</span>}
                              </div>
                              {v.last_signals ? (
                                <SignalGrid signals={v.last_signals as Record<string, unknown>} />
                              ) : (
                                <p className="text-xs text-[var(--text-muted)]">No signal data available yet</p>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-[var(--text-muted)]">
            <Satellite className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No vehicles streaming yet</p>
            <p className="text-[10px] mt-1">Vehicles will appear here once fleet telemetry data is received via MQTT</p>
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  )
}

// ── Worker Health Panel ──────────────────────────────────────────────────────
function WorkerHealthPanel() {
  const { data: workers } = useQuery<WorkersHealth>({
    queryKey: ['workers-health'],
    queryFn: getWorkersHealth,
    refetchInterval: 15_000,
  })

  if (!workers) return null

  const statusColor = (s: string) =>
    s === 'healthy' ? 'text-neon-green' : s === 'unhealthy' ? 'text-neon-amber' : 'text-red-400'
  const statusBg = (s: string) =>
    s === 'healthy' ? 'bg-neon-green/10 border-neon-green/20' : s === 'unhealthy' ? 'bg-neon-amber/10 border-neon-amber/20' : 'bg-red-400/10 border-red-400/20'
  const StatusIcon = ({ status }: { status: string }) =>
    status === 'healthy' ? <CheckCircle className="h-4 w-4 text-neon-green" /> :
    status === 'unhealthy' ? <AlertTriangle className="h-4 w-4 text-neon-amber" /> :
    <XCircle className="h-4 w-4 text-red-400" />

  return (
    <FadeIn delay={0.12}>
      <GlassPanel className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title flex items-center gap-2">
            <Activity className="h-4 w-4 text-neon-purple" /> Background Workers
          </h3>
          <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border',
            workers.healthy_count === workers.total ? 'bg-neon-green/10 border-neon-green/20 text-neon-green' : 'bg-red-400/10 border-red-400/20 text-red-400'
          )}>
            {workers.healthy_count}/{workers.total} Healthy
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {workers.workers.map(w => (
            <div key={w.name} className={clsx('flex items-center gap-3 p-3 rounded-xl border', statusBg(w.status))}>
              <StatusIcon status={w.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{w.name}</p>
                <p className="text-[10px] text-[var(--text-muted)] font-mono truncate">{w.host}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={clsx('text-xs font-semibold uppercase', statusColor(w.status))}>{w.status}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{w.latency_ms}ms</p>
              </div>
            </div>
          ))}
        </div>
        {workers.workers.some(w => w.error) && (
          <div className="mt-3 space-y-1">
            {workers.workers.filter(w => w.error).map(w => (
              <p key={w.name} className="text-[10px] text-red-400/80 font-mono truncate">
                ⚠ {w.name}: {w.error}
              </p>
            ))}
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  )
}

// ── Notification Delivery Panel ──────────────────────────────────────────────
function NotificationDeliveryPanel() {
  const { data: stats } = useQuery<NotificationStats>({
    queryKey: ['notification-stats'],
    queryFn: getNotificationStats,
    refetchInterval: 15_000,
  })
  const { data: logs } = useQuery<NotificationLog[]>({
    queryKey: ['notification-logs'],
    queryFn: () => getNotificationLogs(10, 0),
    refetchInterval: 15_000,
  })

  if (!stats) return null

  const successRate = stats.total_sent > 0 ? ((stats.sent / stats.total_sent) * 100).toFixed(1) : '—'

  return (
    <FadeIn delay={0.14}>
      <GlassPanel className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title flex items-center gap-2">
            <Bell className="h-4 w-4 text-neon-amber" /> Notification Delivery
          </h3>
          <span className="text-[10px] text-[var(--text-muted)]">
            {stats.enabled_channels}/{stats.total_channels} channels active
          </span>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total Sent', value: stats.total_sent, color: 'text-neon-cyan' },
            { label: 'Delivered', value: stats.sent, color: 'text-neon-green' },
            { label: 'Failed', value: stats.failed, color: 'text-red-400' },
            { label: 'Success Rate', value: successRate + '%', color: Number(successRate) >= 95 ? 'text-neon-green' : Number(successRate) >= 80 ? 'text-neon-amber' : 'text-red-400' },
          ].map(s => (
            <div key={s.label} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] text-center">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">{s.label}</p>
              <p className={clsx('text-lg font-bold tabular-nums', s.color)}>
                {typeof s.value === 'number' ? <AnimatedNumber value={s.value} /> : s.value}
              </p>
            </div>
          ))}
        </div>

        {/* Recent log */}
        {logs && logs.length > 0 && (
          <div>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">Recent Deliveries</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {logs.map(log => (
                <div key={log.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.03] text-xs">
                  {log.status === 'sent' ? <Send className="h-3 w-3 text-neon-green shrink-0" /> :
                   log.status === 'failed' ? <XCircle className="h-3 w-3 text-red-400 shrink-0" /> :
                   <Clock className="h-3 w-3 text-neon-amber shrink-0" />}
                  <span className="text-[var(--text-secondary)] truncate flex-1">{log.title}</span>
                  <span className={clsx('text-[10px] font-medium shrink-0',
                    log.status === 'sent' ? 'text-neon-green' : log.status === 'failed' ? 'text-red-400' : 'text-neon-amber'
                  )}>{log.status}</span>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                    {formatTime(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(!logs || logs.length === 0) && (
          <p className="text-xs text-[var(--text-muted)] text-center py-3">No notification deliveries yet</p>
        )}
      </GlassPanel>
    </FadeIn>
  )
}

// ── Export Job Queue Panel ────────────────────────────────────────────────────
function ExportJobQueuePanel() {
  const { data: jobs } = useQuery<ExportJobSummary[]>({
    queryKey: ['export-jobs'],
    queryFn: () => getExportJobs(15, 0),
    refetchInterval: 10_000,
  })

  if (!jobs) return null

  const counts = {
    queued: jobs.filter(j => j.status === 'queued').length,
    processing: jobs.filter(j => j.status === 'processing').length,
    ready: jobs.filter(j => j.status === 'ready').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  }

  const statusColor = (s: string) =>
    s === 'ready' ? 'text-neon-green' : s === 'processing' ? 'text-neon-cyan' : s === 'queued' ? 'text-neon-amber' : 'text-red-400'
  const statusBg = (s: string) =>
    s === 'ready' ? 'bg-neon-green/10' : s === 'processing' ? 'bg-neon-cyan/10' : s === 'queued' ? 'bg-neon-amber/10' : 'bg-red-400/10'

  const formatSize = (bytes: number) => {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / 1048576).toFixed(1)}MB`
  }

  return (
    <FadeIn delay={0.16}>
      <GlassPanel className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title flex items-center gap-2">
            <Package className="h-4 w-4 text-neon-cyan" /> Export Job Queue
          </h3>
          <span className="text-[10px] text-[var(--text-muted)]">{jobs.length} total jobs</span>
        </div>

        {/* Counts strip */}
        <div className="flex gap-3 mb-4">
          {[
            { label: 'Queued', count: counts.queued, color: 'text-neon-amber' },
            { label: 'Processing', count: counts.processing, color: 'text-neon-cyan' },
            { label: 'Ready', count: counts.ready, color: 'text-neon-green' },
            { label: 'Failed', count: counts.failed, color: 'text-red-400' },
          ].map(c => (
            <div key={c.label} className="flex items-center gap-1.5">
              <span className={clsx('text-sm font-bold tabular-nums', c.color)}>{c.count}</span>
              <span className="text-[10px] text-[var(--text-muted)]">{c.label}</span>
            </div>
          ))}
        </div>

        {/* Jobs list */}
        {jobs.length > 0 ? (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {jobs.map(job => (
              <div key={job.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/[0.02] border border-white/[0.03] text-xs">
                <Download className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
                <span className="text-[var(--text-secondary)] truncate flex-1">
                  {job.type} <span className="text-[var(--text-muted)]">({job.format})</span>
                </span>
                {job.record_count > 0 && (
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">{job.record_count.toLocaleString()} rows</span>
                )}
                {job.file_size > 0 && (
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">{formatSize(job.file_size)}</span>
                )}
                <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0', statusColor(job.status), statusBg(job.status))}>
                  {job.status}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                  {formatTime(job.created_at)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)] text-center py-3">No export jobs yet</p>
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
      const res = await fetch(`${getApiBase()}/api/v1/system/status`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return body as SystemStatus
      }
      return res.json()
    },
    refetchInterval: 30_000,
  })

  // Also fetch healthz and readyz for additional details
  const { data: healthz } = useQuery({
    queryKey: ['healthz'],
    queryFn: async () => {
      try {
        const res = await fetch(`${getApiBase()}/healthz`)
        return { ok: res.ok, status: res.status }
      } catch {
        return { ok: false, status: 0 }
      }
    },
    refetchInterval: 30_000,
  })

  const { data: readyz } = useQuery({
    queryKey: ['readyz'],
    queryFn: async () => {
      try {
        const res = await fetch(`${getApiBase()}/readyz`)
        const body = await res.json().catch(() => ({}))
        return { ok: res.ok, status: res.status, body }
      } catch {
        return { ok: false, status: 0, body: {} }
      }
    },
    refetchInterval: 30_000,
  })

  const { data: version } = useQuery({
    queryKey: ['version'],
    queryFn: getVersionInfo,
    staleTime: 60_000,
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
  const healthyCount = components.filter(([, c]) => ['ok', 'healthy', 'authenticated', 'connected', 'enabled', 'no_token'].includes(c.status.toLowerCase())).length
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
            <div className={clsx('w-3 h-3 rounded-full', healthz === undefined ? 'bg-yellow-500 animate-pulse' : healthz?.ok ? 'bg-neon-green animate-pulse' : 'bg-neon-red')} />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">/healthz</p>
              <p className="text-[10px] text-[var(--text-muted)]">Liveness probe</p>
            </div>
            <span className={clsx('text-xs font-mono px-2 py-1 rounded', healthz === undefined ? 'bg-yellow-500/10 text-yellow-400' : healthz?.ok ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red')}>
              {healthz === undefined ? '...' : healthz?.ok ? '200' : healthz?.status ?? '—'}
            </span>
          </GlassPanel>
          <GlassPanel className="p-4 flex items-center gap-3">
            <div className={clsx('w-3 h-3 rounded-full', readyz === undefined ? 'bg-yellow-500 animate-pulse' : readyz?.ok ? 'bg-neon-green animate-pulse' : 'bg-neon-red')} />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">/readyz</p>
              <p className="text-[10px] text-[var(--text-muted)]">Readiness probe</p>
            </div>
            <span className={clsx('text-xs font-mono px-2 py-1 rounded', readyz === undefined ? 'bg-yellow-500/10 text-yellow-400' : readyz?.ok ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red')}>
              {readyz === undefined ? '...' : readyz?.ok ? '200' : readyz?.status ?? '—'}
            </span>
          </GlassPanel>
        </div>
      </FadeIn>

      {/* Backend Info & Endpoints */}
      {version && (
        <FadeIn delay={0.08}>
          <GlassPanel className="p-5">
            <h3 className="section-title flex items-center gap-2 mb-4">
              <Server className="h-4 w-4 text-neon-cyan" /> Backend Status
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Version', value: `v${version.chart_version}`, icon: Shield },
                { label: 'Runtime', value: `${version.go_version} · ${version.os}/${version.arch}`, icon: Cpu },
                { label: 'Uptime', value: version.uptime_seconds < 3600 ? `${Math.floor(version.uptime_seconds / 60)}m` : `${Math.floor(version.uptime_seconds / 3600)}h ${Math.floor((version.uptime_seconds % 3600) / 60)}m`, icon: Clock },
                { label: 'Goroutines', value: String(version.goroutines), icon: Activity },
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

            {version.endpoints && Object.keys(version.endpoints).length > 0 && (
              <div>
                <p className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-2.5">
                  <Link className="h-3 w-3" /> Configured Endpoints
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {version.endpoints.api && (
                    <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                      <Server className="h-3.5 w-3.5 text-neon-amber shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] text-[var(--text-muted)]">API (Internal)</p>
                        <p className="text-xs font-mono text-[var(--text-secondary)] truncate">{version.endpoints.api}</p>
                      </div>
                    </div>
                  )}
                  {version.endpoints.web && (
                    <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                      <Globe className="h-3.5 w-3.5 text-neon-cyan shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] text-[var(--text-muted)]">Web Frontend</p>
                        <p className="text-xs font-mono text-[var(--text-secondary)] truncate">{version.endpoints.web}</p>
                      </div>
                    </div>
                  )}
                  {version.endpoints.oauth_callback && (
                    <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                      <Shield className="h-3.5 w-3.5 text-neon-green shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] text-[var(--text-muted)]">OAuth Callback</p>
                        <p className="text-xs font-mono text-[var(--text-secondary)] truncate">{version.endpoints.oauth_callback}</p>
                      </div>
                    </div>
                  )}
                  {version.endpoints.tesla_api && (
                    <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                      <Radio className="h-3.5 w-3.5 text-neon-purple shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] text-[var(--text-muted)]">Tesla Fleet API</p>
                        <p className="text-xs font-mono text-[var(--text-secondary)] truncate">{version.endpoints.tesla_api}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </GlassPanel>
        </FadeIn>
      )}

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

      {/* Fleet Telemetry Live Feed */}
      <TelemetryLivePanel />

      {/* Background Workers */}
      <WorkerHealthPanel />

      {/* Notification & Export Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NotificationDeliveryPanel />
        <ExportJobQueuePanel />
      </div>

      {/* System Info */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <Cpu className="h-4 w-4 text-neon-cyan" /> System Information
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'API Endpoint', value: version?.endpoints?.api ?? window.location.origin, icon: Server },
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

      {/* Rate Limits */}
      <RateLimitsPanel />

      {/* Audit Logs */}
      <AuditLogTable />
    </div>
  )
}
