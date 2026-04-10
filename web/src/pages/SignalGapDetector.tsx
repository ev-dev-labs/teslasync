import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpDown, Filter, RefreshCw } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, Skeleton, StatCard, Badge, DataTable, type Column } from '../components/ui'
import { request } from '../api/client'
import { formatDateTime, formatRelative } from '../lib/dateFormat'
import clsx from 'clsx'

interface LiveSignalState {
  signals: Record<string, { value: unknown; timestamp: string }>
}

interface SignalRow {
  name: string
  value: string
  timestamp: string | null
  staleness: number // seconds since last update
  category: 'active' | 'stale' | 'never'
}

type SortMode = 'staleness' | 'alpha' | 'category'
type FilterMode = 'all' | 'stale' | 'active'

function getStalenessColor(seconds: number, hasTimestamp: boolean) {
  if (!hasTimestamp) return { dot: 'bg-gray-500', text: 'text-gray-400', label: 'Never received', bg: 'bg-gray-500/10' }
  if (seconds < 30) return { dot: 'bg-neon-green', text: 'text-neon-green', label: 'Active', bg: 'bg-neon-green/10' }
  if (seconds < 300) return { dot: 'bg-neon-amber', text: 'text-neon-amber', label: 'Aging', bg: 'bg-neon-amber/10' }
  return { dot: 'bg-neon-red', text: 'text-neon-red', label: 'Stale', bg: 'bg-neon-red/10' }
}

function formatStaleness(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}h ${m}m ago`
}

const gapColumns: Column<SignalRow>[] = [
  { key: 'status', header: 'Status', render: (signal) => {
    const style = getStalenessColor(signal.staleness, !!signal.timestamp)
    return (
      <Badge color={!signal.timestamp ? 'neutral' : signal.staleness < 30 ? 'green' : signal.staleness < 300 ? 'amber' : 'red'} dot>
        {style.label}
      </Badge>
    )
  }},
  { key: 'signal', header: 'Signal', render: (signal) => <span className="font-mono text-[var(--text-primary)]">{signal.name}</span> },
  { key: 'value', header: 'Last Value', render: (signal) => <span className="font-mono text-[var(--text-secondary)] max-w-[200px] truncate block">{signal.value}</span> },
  { key: 'lastUpdated', header: 'Last Updated', render: (signal) => <span className="text-[var(--text-secondary)] whitespace-nowrap">{signal.timestamp ? formatDateTime(signal.timestamp) : '—'}</span> },
  { key: 'timeSince', header: 'Time Since', className: 'text-right', render: (signal) => {
    const style = getStalenessColor(signal.staleness, !!signal.timestamp)
    return <span className={clsx('font-mono whitespace-nowrap', style.text)}>{signal.timestamp ? formatStaleness(signal.staleness) : '—'}</span>
  }},
]

export default function SignalGapDetector() {
  const vehicleId = 1
  const [sortMode, setSortMode] = useState<SortMode>('staleness')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [search, setSearch] = useState('')

  const { data: liveData, isLoading, dataUpdatedAt } = useQuery<LiveSignalState>({
    queryKey: ['signal-live-gaps', vehicleId],
    queryFn: () => request(`/signals/${vehicleId}/live`),
    refetchInterval: 5_000,
  })

  const now = Date.now()

  const signals: SignalRow[] = useMemo(() => {
    if (!liveData?.signals) return []
    return Object.entries(liveData.signals).map(([name, entry]) => {
      const raw = entry && typeof entry === 'object' ? entry : { value: entry, timestamp: null }
      const ts = raw.timestamp ?? null
      const staleness = ts ? (now - new Date(ts).getTime()) / 1000 : Infinity
      const category: SignalRow['category'] = !ts ? 'never' : staleness > 300 ? 'stale' : 'active'
      return {
        name,
        value: raw.value != null ? String(raw.value) : '—',
        timestamp: ts,
        staleness,
        category,
      }
    })
  }, [liveData, now])

  const filtered = useMemo(() => {
    let list = signals
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s => s.name.toLowerCase().includes(q))
    }
    if (filterMode === 'stale') list = list.filter(s => s.category === 'stale' || s.category === 'never')
    if (filterMode === 'active') list = list.filter(s => s.category === 'active')

    list.sort((a, b) => {
      if (sortMode === 'staleness') return b.staleness - a.staleness
      if (sortMode === 'alpha') return a.name.localeCompare(b.name)
      // by category: never > stale > active
      const order = { never: 0, stale: 1, active: 2 }
      return order[a.category] - order[b.category]
    })
    return list
  }, [signals, search, filterMode, sortMode])

  const activeCount = signals.filter(s => s.category === 'active').length
  const staleCount = signals.filter(s => s.category === 'stale').length
  const neverCount = signals.filter(s => s.category === 'never').length

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Signal Gap Detector"
        subtitle="Identify signals that have stopped arriving or have gaps"
        icon={<AlertTriangle className="h-6 w-6 text-neon-amber" />}
        actions={
          <span className="text-xs text-[var(--text-muted)]">
            <RefreshCw className="inline h-3 w-3 mr-1" />
            Refreshes every 5s
          </span>
        }
      />

      {/* Summary Cards */}
      <FadeIn delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Total Signals" value={signals.length} icon={<ArrowUpDown className="h-4 w-4" />} color="cyan" />
          <StatCard label="Active (<30s)" value={activeCount} icon={<RefreshCw className="h-4 w-4" />} color="green" />
          <StatCard label="Stale (>5min)" value={staleCount} icon={<AlertTriangle className="h-4 w-4" />} color="amber" />
          <StatCard label="Never Received" value={neverCount} icon={<AlertTriangle className="h-4 w-4" />} color="purple" />
        </div>
      </FadeIn>

      {/* Controls */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <input
              type="text"
              placeholder="Filter by signal name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-64 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] outline-none focus:border-neon-cyan/50"
            />

            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              {(['all', 'stale', 'active'] as FilterMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setFilterMode(mode)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                    filterMode === mode
                      ? 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/20'
                      : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {mode === 'all' ? 'All' : mode === 'stale' ? 'Stale Only' : 'Active Only'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 sm:ml-auto">
              <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              {(['staleness', 'alpha', 'category'] as SortMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                    sortMode === mode
                      ? 'bg-neon-purple/10 text-neon-purple border-neon-purple/20'
                      : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {mode === 'staleness' ? 'Most Stale' : mode === 'alpha' ? 'A-Z' : 'Category'}
                </button>
              ))}
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Signal Table */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : filtered.length > 0 ? (
            <DataTable
              columns={gapColumns}
              data={filtered}
              keyExtractor={(signal) => signal.name}
              compact
              className="max-h-[65vh] overflow-auto border border-[var(--border)]"
              emptyMessage="No signals match current filters"
            />
          ) : (
            <p className="text-center py-12 text-[var(--text-muted)]">
              {signals.length === 0 ? 'No signal data available' : 'No signals match current filters'}
            </p>
          )}

          {dataUpdatedAt > 0 && (
            <p className="mt-3 text-[10px] text-[var(--text-muted)] text-right">
              Last refreshed: {formatRelative(new Date(dataUpdatedAt))}
            </p>
          )}
        </GlassPanel>
      </FadeIn>
    </div>
  )
}

