import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import { Activity, Search, Clock, Database } from 'lucide-react'
import { Badge, Button, Input } from '../components/ui'
import { request } from '../api/client'
import { ChartTooltip } from '../components/Charts'
import { fmtNumber } from '../lib/numberFormat'
import { usePageTitle } from '../hooks/usePageTitle'

interface SignalPoint {
  timestamp: string
  value_num?: number
  value_str?: string
  value_bool?: boolean
}

interface SignalHistoryResponse {
  vehicle_id: number
  signal: string
  from: string
  to: string
  count: number
  data: SignalPoint[]
}

interface SignalStatsResponse {
  vehicle_id: number
  count: number
  oldest: string | null
  newest: string | null
}

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

export default function SignalExplorer() {
  usePageTitle('Signal Explorer')
  const [selectedSignal, setSelectedSignal] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [timeRange, setTimeRange] = useState(24)
  const vehicleId = 1 // TODO: multi-vehicle support

  const { data: availableSignals, error: signalsError } = useQuery<{ signals: string[] }>({
    queryKey: ['signal-available', vehicleId],
    queryFn: () => request(`/signals/${vehicleId}/available`),
    refetchInterval: 60_000,
  })

  const { data: stats, error: statsError } = useQuery<SignalStatsResponse>({
    queryKey: ['signal-stats', vehicleId],
    queryFn: () => request(`/signals/${vehicleId}/stats`),
    refetchInterval: 60_000,
  })

  const { data: liveState, error: liveError } = useQuery<{ signals: Record<string, unknown> }>({
    queryKey: ['signal-live', vehicleId],
    queryFn: () => request(`/signals/${vehicleId}/live`),
    refetchInterval: 5_000,
  })

  const from = new Date(Date.now() - timeRange * 3600 * 1000).toISOString()
  const to = new Date().toISOString()

  const { data: history, isLoading: historyLoading, error: historyError } = useQuery<SignalHistoryResponse>({
    queryKey: ['signal-history', vehicleId, selectedSignal, timeRange],
    queryFn: () => request(`/signals/${vehicleId}/${selectedSignal}/history?from=${from}&to=${to}&limit=2000`),
    enabled: !!selectedSignal,
    refetchInterval: 30_000,
  })

  const anyError = signalsError || statsError || liveError || historyError

  const filteredSignals = (availableSignals?.signals || []).filter(s =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const chartData = (history?.data || []).map(p => ({
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    value: p.value_num ?? (p.value_bool ? 1 : 0),
    raw: p.timestamp,
  }))

  const currentValue = selectedSignal && liveState?.signals
    ? liveState.signals[selectedSignal]
    : null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6 text-neon-cyan" />
        <h1 className="text-2xl font-bold">Signal Explorer</h1>
        {stats && (
          <Badge color="neutral">
            <Database className="inline h-3 w-3 mr-1" />
            {(stats.count || 0).toLocaleString()} records
          </Badge>
        )}
      </div>

      {anyError && (
        <div className="p-4 rounded-lg border border-neon-red/30 bg-neon-red/5 text-neon-red text-sm">
          Failed to load data: {(anyError as Error).message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Signal List */}
        <div className="lg:col-span-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 max-h-[80vh] overflow-y-auto">
          <div className="mb-3">
            <Input
              type="text"
              placeholder="Search signals..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              icon={<Search className="h-4 w-4" />}
              aria-label="Search signals"
            />
          </div>
          <div className="text-xs text-[var(--text-muted)] mb-2">{filteredSignals.length} signals</div>
          <div className="space-y-0.5">
            {filteredSignals.map(sig => {
              const live = liveState?.signals?.[sig]
              const raw = live != null && typeof live === 'object' && 'value' in (live as Record<string, unknown>)
                ? (live as Record<string, unknown>).value
                : live
              const liveStr = raw != null
                ? typeof raw === 'number' ? fmtNumber(raw as number) : String(raw).slice(0, 20)
                : null
              return (
                <button
                  key={sig}
                  onClick={() => setSelectedSignal(sig)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors ${
                    selectedSignal === sig
                      ? 'bg-[var(--neon-cyan)] bg-opacity-10 text-[var(--neon-cyan)] border border-[var(--neon-cyan)] border-opacity-30'
                      : 'hover:bg-[var(--bg)] text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="truncate">{sig}</span>
                    {liveStr && (
                      <span className="ml-1 text-[var(--text-muted)] text-[10px] truncate max-w-[80px]">{liveStr}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Chart + Details */}
        <div className="lg:col-span-3 space-y-4">
          {/* Current Value Card */}
          {selectedSignal && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold font-mono text-[var(--neon-cyan)]">{selectedSignal}</h2>
                  <div className="text-[var(--text-muted)] text-xs mt-1">
                    <Clock className="inline h-3 w-3 mr-1" />
                    Live value from SignalStore
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold">
                    {currentValue != null ? (() => {
                      // Live endpoint returns {value, timestamp} objects
                      const val = typeof currentValue === 'object' && currentValue !== null && 'value' in (currentValue as Record<string, unknown>)
                        ? (currentValue as Record<string, unknown>).value
                        : currentValue
                      if (typeof val === 'number') return fmtNumber(val)
                      if (typeof val === 'boolean') return val ? '✅ true' : '❌ false'
                      if (val == null) return '—'
                      if (typeof val === 'object') return JSON.stringify(val)
                      return String(val)
                    })() : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Time Range Selector */}
          <div className="flex gap-2">
            {TIME_RANGES.map(tr => (
              <Button
                key={tr.label}
                onClick={() => setTimeRange(tr.hours)}
                variant={timeRange === tr.hours ? 'primary' : 'secondary'}
                size="sm"
              >
                {tr.label}
              </Button>
            ))}
            {history && (
              <span className="ml-auto text-xs text-[var(--text-muted)] self-center">
                {history.count.toLocaleString()} data points
              </span>
            )}
          </div>

          {/* Chart */}
          {selectedSignal ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              {historyLoading ? (
                <div className="h-64 flex items-center justify-center text-[var(--text-muted)]">Loading...</div>
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="value" stroke="#00f0ff" strokeWidth={1.5} dot={false} name={selectedSignal} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-[var(--text-muted)]">
                  No data for this time range
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-12 flex flex-col items-center justify-center text-[var(--text-muted)]">
              <Activity className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-lg">Select a signal to explore</p>
              <p className="text-sm mt-1">Choose from {filteredSignals.length} available signals</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


