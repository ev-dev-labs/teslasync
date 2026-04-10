import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Radio, Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import { PageHeader, GlassPanel, FadeIn, Skeleton, StatCard, Badge } from '../components/ui'
import { ChartTooltip } from '../components/Charts'
import { request } from '../api/client'
import { formatRelative } from '../lib/dateFormat'
import { fmtInt, fmtNumber } from '../lib/numberFormat'
import clsx from 'clsx'

interface TelemetryStatus {
  connected: boolean
  broker?: string
  uptime_seconds?: number
  vehicles?: VehicleTelemetry[]
  topics?: string[]
}

interface VehicleTelemetry {
  vin: string
  vehicle_id?: number
  state?: string
  signal_count: number
  batch_count: number
  signals_per_sec?: number
  last_received?: string
}

interface ThroughputPoint {
  time: string
  signals: number
}

const STALE_THRESHOLD = 120 // seconds

export default function MQTTInspector() {
  const [throughputHistory, setThroughputHistory] = useState<ThroughputPoint[]>([])
  const prevTotalRef = useRef<number | null>(null)

  const { data: status, isLoading } = useQuery<TelemetryStatus>({
    queryKey: ['telemetry-status'],
    queryFn: () => request('/telemetry'),
    refetchInterval: 5_000,
  })

  const vehicles = status?.vehicles ?? []
  const totalSignals = vehicles.reduce((sum, v) => sum + v.signal_count, 0)
  const totalBatches = vehicles.reduce((sum, v) => sum + v.batch_count, 0)
  const totalRate = vehicles.reduce((sum, v) => sum + (v.signals_per_sec ?? 0), 0)

  // Track throughput over time
  useEffect(() => {
    if (totalSignals === 0 && prevTotalRef.current === null) return
    const delta = prevTotalRef.current !== null ? totalSignals - prevTotalRef.current : 0
    prevTotalRef.current = totalSignals

    if (delta >= 0) {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setThroughputHistory(prev => {
        const updated = [...prev, { time: now, signals: Math.max(delta, 0) }]
        return updated.slice(-60) // keep last 60 data points (5 min at 5s interval)
      })
    }
  }, [totalSignals])

  const staleVehicles = useMemo(() =>
    vehicles.filter(v => {
      if (!v.last_received) return true
      return (Date.now() - new Date(v.last_received).getTime()) / 1000 > STALE_THRESHOLD
    }),
  [vehicles])

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="MQTT Inspector"
        subtitle="MQTT connection status and streaming telemetry"
        icon={<Radio className="h-6 w-6 text-neon-cyan" />}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-muted)]">
              <RefreshCw className="inline h-3 w-3 mr-1" />
              Refreshes every 5s
            </span>
            <Badge color={status?.connected ? 'green' : 'red'} dot>
              {status?.connected ? <><Wifi className="h-3 w-3" /> Connected</> : <><WifiOff className="h-3 w-3" /> Disconnected</>}
            </Badge>
          </div>
        }
      />

      {/* Summary Cards */}
      <FadeIn delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Streaming Vehicles"
            value={isLoading ? '—' : vehicles.length}
            icon={<Radio className="h-4 w-4" />}
            color="cyan"
          />
          <StatCard
            label="Total Signals"
            value={isLoading ? '—' : fmtInt(totalSignals)}
            icon={<Radio className="h-4 w-4" />}
            color="green"
          />
          <StatCard
            label="Total Batches"
            value={isLoading ? '—' : fmtInt(totalBatches)}
            icon={<Radio className="h-4 w-4" />}
            color="purple"
          />
          <StatCard
            label="Signals / sec"
            value={isLoading ? '—' : fmtNumber(totalRate, 1)}
            icon={<Radio className="h-4 w-4" />}
            color={staleVehicles.length > 0 ? 'amber' : 'cyan'}
            subtitle={staleVehicles.length > 0 ? `${staleVehicles.length} stale` : undefined}
          />
        </div>
      </FadeIn>

      {/* Connection Info */}
      {status && (
        <FadeIn delay={0.15}>
          <GlassPanel className="p-5">
            <div className="flex flex-wrap gap-6 text-sm">
              {status.broker && (
                <div>
                  <span className="text-[var(--text-muted)] text-xs">Broker</span>
                  <p className="font-mono text-[var(--text-primary)]">{status.broker}</p>
                </div>
              )}
              {status.uptime_seconds != null && (
                <div>
                  <span className="text-[var(--text-muted)] text-xs">Uptime</span>
                  <p className="font-mono text-[var(--text-primary)]">
                    {status.uptime_seconds > 3600
                      ? `${Math.floor(status.uptime_seconds / 3600)}h ${Math.round((status.uptime_seconds % 3600) / 60)}m`
                      : `${Math.round(status.uptime_seconds / 60)}m`}
                  </p>
                </div>
              )}
              {status.topics && status.topics.length > 0 && (
                <div>
                  <span className="text-[var(--text-muted)] text-xs">Topic Patterns</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {status.topics.map(topic => (
                      <span key={topic} className="px-2 py-0.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-secondary)]">
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Throughput Chart */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Signal Throughput</h2>
          {throughputHistory.length > 2 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={throughputHistory}>
                <defs>
                  <linearGradient id="throughputGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="signals" name="Signals" stroke="#00f0ff" fill="url(#throughputGrad)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">
              Collecting throughput data…
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Vehicle Breakdown */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Vehicle Breakdown
              {vehicles.length > 0 && <span className="ml-2 text-[var(--text-muted)] font-normal">{vehicles.length} vehicles</span>}
            </h2>
            {staleVehicles.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-neon-amber">
                <AlertTriangle className="h-3.5 w-3.5" />
                {staleVehicles.length} stale
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : vehicles.length > 0 ? (
            <div className="overflow-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[var(--surface)] z-10">
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left px-3 py-2.5 text-[var(--text-muted)] font-medium">VIN</th>
                    <th className="text-left px-3 py-2.5 text-[var(--text-muted)] font-medium">State</th>
                    <th className="text-right px-3 py-2.5 text-[var(--text-muted)] font-medium">Signals</th>
                    <th className="text-right px-3 py-2.5 text-[var(--text-muted)] font-medium">Batches</th>
                    <th className="text-right px-3 py-2.5 text-[var(--text-muted)] font-medium">Sig/sec</th>
                    <th className="text-right px-3 py-2.5 text-[var(--text-muted)] font-medium">Last Received</th>
                    <th className="text-center px-3 py-2.5 text-[var(--text-muted)] font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map(v => {
                    const isStale = !v.last_received || (Date.now() - new Date(v.last_received).getTime()) / 1000 > STALE_THRESHOLD
                    return (
                      <tr key={v.vin} className={clsx(
                        'border-b border-[var(--border)] hover:bg-white/[0.02]',
                        isStale && 'bg-neon-amber/[0.03]'
                      )}>
                        <td className="px-3 py-2.5 font-mono text-[var(--text-primary)]">{v.vin}</td>
                        <td className="px-3 py-2.5">
                          {v.state ? (
                            <Badge color={
                              v.state === 'driving' ? 'green' :
                              v.state === 'charging' ? 'amber' :
                              v.state === 'parked' ? 'cyan' :
                              'neutral'
                            }>
                              {v.state}
                            </Badge>
                          ) : (
                            <span className="text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[var(--text-secondary)]">{fmtInt(v.signal_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-[var(--text-secondary)]">{fmtInt(v.batch_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-[var(--text-secondary)]">{v.signals_per_sec != null ? fmtNumber(v.signals_per_sec, 1) : '—'}</td>
                        <td className="px-3 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                          {v.last_received ? formatRelative(v.last_received) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {isStale ? (
                            <Badge color="amber" dot>Stale</Badge>
                          ) : (
                            <Badge color="green" dot>Live</Badge>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center py-12 text-[var(--text-muted)]">No vehicles currently streaming</p>
          )}
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
