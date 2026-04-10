import { useState, useRef, useEffect, useCallback } from 'react'
import { Activity, Pause, Play, Trash2, ArrowDown, ArrowDownUp } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StatCard, Badge, Button } from '../components/ui'
import { useRealtimeEvents } from '../hooks/useRealtimeEvents'
import { formatTime } from '../lib/dateFormat'
import clsx from 'clsx'

interface SignalEntry {
  id: number
  timestamp: string
  name: string
  value: string
  type: 'number' | 'string' | 'boolean'
}

const MAX_BUFFER = 500

const typeColor: Record<string, string> = {
  number: 'text-neon-cyan',
  string: 'text-neon-green',
  boolean: 'text-neon-amber',
}

function detectType(value: unknown): 'number' | 'string' | 'boolean' {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return 'string'
}

export default function LiveSignalMonitor() {
  const [entries, setEntries] = useState<SignalEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const idRef = useRef(0)
  const tableRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)
  const rateRef = useRef<number[]>([])
  const [rate, setRate] = useState(0)

  pausedRef.current = paused

  const handleVehicleUpdate = useCallback((data: unknown) => {
    if (pausedRef.current) return
    const payload = data as Record<string, unknown>
    const signals = (payload?.signals ?? payload) as Record<string, unknown> | undefined
    if (!signals || typeof signals !== 'object') return

    const now = new Date().toISOString()
    const newEntries: SignalEntry[] = []

    for (const [name, value] of Object.entries(signals)) {
      if (name === 'timestamp' || name === 'vehicle_id') continue
      idRef.current += 1
      newEntries.push({
        id: idRef.current,
        timestamp: now,
        name,
        value: String(value),
        type: detectType(value),
      })
    }

    rateRef.current.push(newEntries.length)

    setEntries(prev => {
      const updated = [...newEntries, ...prev]
      return updated.slice(0, MAX_BUFFER)
    })
  }, [])

  // Calculate signals/sec every second
  useEffect(() => {
    const interval = setInterval(() => {
      setRate(rateRef.current.reduce((a, b) => a + b, 0))
      rateRef.current = []
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const { connected } = useRealtimeEvents({
    onVehicleUpdate: handleVehicleUpdate,
  })

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && tableRef.current) {
      tableRef.current.scrollTop = 0
    }
  }, [entries, autoScroll])

  const filteredEntries = filter
    ? entries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()))
    : entries

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Live Signal Monitor"
        subtitle="Real-time scrolling view of incoming vehicle signals"
        icon={<Activity className="h-6 w-6 text-neon-cyan" />}
        actions={
          <div className="flex items-center gap-2">
            <Badge color={connected ? 'green' : 'red'} dot>
              {connected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
        }
      />

      <FadeIn delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Signals / sec" value={rate} icon={<Activity className="h-4 w-4" />} color="cyan" />
          <StatCard label="Buffer Size" value={entries.length} icon={<ArrowDownUp className="h-4 w-4" />} color="purple" subtitle={`/ ${MAX_BUFFER} max`} />
          <StatCard label="Unique Signals" value={new Set(entries.map(e => e.name)).size} icon={<Activity className="h-4 w-4" />} color="green" />
          <StatCard label="Filtered" value={filteredEntries.length} icon={<Activity className="h-4 w-4" />} color="amber" />
        </div>
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="p-4">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
            <input
              type="text"
              placeholder="Filter by signal name..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="w-full sm:w-64 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] outline-none focus:border-neon-cyan/50"
            />
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setPaused(p => !p)}
                variant="secondary"
                size="sm"
                icon={paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              >
                {paused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                onClick={() => setAutoScroll(a => !a)}
                variant="secondary"
                size="sm"
                icon={<ArrowDown className="h-3.5 w-3.5" />}
                className={autoScroll ? 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/20' : ''}
              >
                Auto-scroll
              </Button>
              <Button
                onClick={() => { setEntries([]); idRef.current = 0 }}
                variant="danger"
                size="sm"
                icon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Table */}
          <div ref={tableRef} className="overflow-auto max-h-[65vh] rounded-lg border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--surface)] z-10">
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left px-3 py-2.5 text-[var(--text-muted)] font-medium">Time</th>
                  <th className="text-left px-3 py-2.5 text-[var(--text-muted)] font-medium">Signal</th>
                  <th className="text-left px-3 py-2.5 text-[var(--text-muted)] font-medium">Value</th>
                  <th className="text-left px-3 py-2.5 text-[var(--text-muted)] font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-[var(--text-muted)]">
                      {entries.length === 0 ? 'Waiting for signals…' : 'No signals match filter'}
                    </td>
                  </tr>
                ) : (
                  filteredEntries.map(entry => (
                    <tr key={entry.id} className="border-b border-[var(--border)] hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2 font-mono text-[var(--text-muted)] whitespace-nowrap">
                        {formatTime(entry.timestamp)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--text-primary)] whitespace-nowrap">
                        {entry.name}
                      </td>
                      <td className={clsx('px-3 py-2 font-mono whitespace-nowrap', typeColor[entry.type])}>
                        {entry.value}
                      </td>
                      <td className="px-3 py-2">
                        <Badge color={entry.type === 'number' ? 'cyan' : entry.type === 'boolean' ? 'amber' : 'green'} size="sm">
                          {entry.type}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
