import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { request } from '../api/client'
import { PageHeader, GlassPanel, FadeIn, Badge, Button, Select } from '../components/ui'
import { Database, Search, Filter, Clock, Activity } from 'lucide-react'
import clsx from 'clsx'
import { formatDateTime } from '../lib/dateFormat'
import { fmtNumber } from '../lib/numberFormat'

interface SignalLogEntry {
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
  data: SignalLogEntry[]
}

const PAGE_SIZES = [25, 50, 100, 200]

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
  { label: 'All', hours: 8760 },
]

export default function SignalLogViewer() {
  const vehicleId = 1
  const [selectedSignal, setSelectedSignal] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [timeRange, setTimeRange] = useState(24)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Get available signals
  const { data: availableData } = useQuery<{ signals: string[]; count: number }>({
    queryKey: ['signal-log-available', vehicleId],
    queryFn: () => request(`/signals/${vehicleId}/available`),
    refetchInterval: 60_000,
  })

  // Get stats
  const { data: stats } = useQuery<{ count: number; oldest: string; newest: string }>({
    queryKey: ['signal-log-stats', vehicleId],
    queryFn: () => request(`/signals/${vehicleId}/stats`),
    refetchInterval: 60_000,
  })

  // Query signal history
  const from = new Date(Date.now() - timeRange * 3600 * 1000).toISOString()
  const to = new Date().toISOString()

  const { data: history, isLoading, isFetching } = useQuery<SignalHistoryResponse>({
    queryKey: ['signal-log-viewer', vehicleId, selectedSignal, timeRange, page, pageSize],
    queryFn: () => request(`/signals/${vehicleId}/${selectedSignal}/history?from=${from}&to=${to}&limit=${pageSize}`),
    enabled: !!selectedSignal,
  })

  // Get live state for current values
  const { data: liveData } = useQuery<{ signals: Record<string, unknown> }>({
    queryKey: ['signal-log-live', vehicleId],
    queryFn: () => request(`/signals/${vehicleId}/live`),
    refetchInterval: 5_000,
  })

  const allSignals = availableData?.signals ?? []
  const filteredSignals = allSignals.filter(s =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatValue = (entry: SignalLogEntry): string => {
    if (entry.value_num != null) return fmtNumber(entry.value_num, 4)
    if (entry.value_str != null) return entry.value_str
    if (entry.value_bool != null) return entry.value_bool ? 'true' : 'false'
    return '—'
  }

  const getValueType = (entry: SignalLogEntry): string => {
    if (entry.value_num != null) return 'number'
    if (entry.value_str != null) return 'string'
    if (entry.value_bool != null) return 'boolean'
    return 'null'
  }

  const typeColor: Record<string, string> = {
    number: 'text-neon-cyan',
    string: 'text-neon-green',
    boolean: 'text-neon-amber',
    null: 'text-gray-600',
  }

  const currentLiveRaw = selectedSignal && liveData?.signals
    ? liveData.signals[selectedSignal]
    : null
  const currentLiveValue = currentLiveRaw != null && typeof currentLiveRaw === 'object' && 'value' in (currentLiveRaw as Record<string, unknown>)
    ? (currentLiveRaw as Record<string, unknown>).value
    : currentLiveRaw

  const totalRecords = history?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize))

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6">
        <PageHeader
          title="Signal Log Viewer"
          subtitle="Browse raw telemetry signal recordings from MongoDB"
          icon={<Database className="h-7 w-7 text-neon-cyan" />}
        />
        {stats && (
          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
            <span><Database className="inline h-3 w-3 mr-1" />{(stats.count ?? 0).toLocaleString()} records</span>
            {stats.oldest && <span><Clock className="inline h-3 w-3 mr-1" />Since {formatDateTime(stats.oldest)}</span>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left panel: Signal selector */}
        <div className="lg:col-span-1">
          <GlassPanel className="p-3 max-h-[80vh] overflow-y-auto sticky top-4">
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Filter signals..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-primary)] outline-none focus:border-neon-cyan/50"
              />
            </div>
            <p className="text-[10px] text-[var(--text-muted)] mb-2">{filteredSignals.length} signals available</p>
            <div className="space-y-0.5">
              {filteredSignals.map(sig => {
                const live = liveData?.signals?.[sig]
                const raw = live != null && typeof live === 'object' && 'value' in (live as Record<string, unknown>)
                  ? (live as Record<string, unknown>).value
                  : live
                const liveStr = raw != null
                  ? typeof raw === 'number' ? fmtNumber(raw as number, 2) : String(raw).slice(0, 20)
                  : null
                return (
                  <button
                    key={sig}
                    onClick={() => { setSelectedSignal(sig); setPage(1) }}
                    className={clsx(
                      'w-full text-left px-2 py-1.5 rounded-md text-[11px] font-mono transition-colors',
                      selectedSignal === sig
                        ? 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30'
                        : 'hover:bg-white/[0.03] text-[var(--text-secondary)]'
                    )}
                  >
                    <div className="flex justify-between items-center gap-1">
                      <span className="truncate">{sig}</span>
                      {liveStr && (
                        <span className="text-[9px] text-[var(--text-muted)] truncate max-w-[60px] shrink-0">{liveStr}</span>
                      )}
                    </div>
                  </button>
                )
              })}
              {filteredSignals.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] text-center py-4">No signals match filter</p>
              )}
            </div>
          </GlassPanel>
        </div>

        {/* Right panel: Data table */}
        <div className="lg:col-span-4 space-y-3">
          {/* Controls bar */}
          <GlassPanel className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Time range */}
              <div className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                {TIME_RANGES.map(tr => (
                  <button key={tr.label} onClick={() => { setTimeRange(tr.hours); setPage(1) }}
                    className={clsx('px-2 py-1 rounded text-[10px] font-medium transition-colors',
                      timeRange === tr.hours
                        ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                    )}>
                    {tr.label}
                  </button>
                ))}
              </div>

              {/* Page size */}
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-[10px] text-[var(--text-muted)]">Rows:</span>
                <Select value={String(pageSize)} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
                  options={PAGE_SIZES.map(s => ({ value: String(s), label: String(s) }))} />
              </div>

              {/* Record count */}
              {history && (
                <span className="text-[10px] text-[var(--text-muted)]">
                  {totalRecords.toLocaleString()} records
                </span>
              )}
            </div>
          </GlassPanel>

          {/* Current value banner */}
          {selectedSignal && currentLiveValue != null && (
            <GlassPanel className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-neon-green animate-pulse" />
                <span className="text-xs text-[var(--text-muted)]">Live value:</span>
                <span className="text-sm font-bold font-mono text-neon-cyan">
                  {typeof currentLiveValue === 'number' ? fmtNumber(currentLiveValue, 4)
                    : typeof currentLiveValue === 'boolean' ? (currentLiveValue ? 'true' : 'false')
                    : String(currentLiveValue)}
                </span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">{selectedSignal}</span>
            </GlassPanel>
          )}

          {/* Data table */}
          {selectedSignal ? (
            <GlassPanel className="overflow-hidden">
              {isLoading || isFetching ? (
                <div className="p-8 text-center text-[var(--text-muted)]">Loading...</div>
              ) : history && history.data.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-white/[0.02]">
                          <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">#</th>
                          <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">Timestamp</th>
                          <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">Value</th>
                          <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.data.map((entry, idx) => {
                          const valType = getValueType(entry)
                          return (
                            <tr key={idx} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                              <td className="px-4 py-2 text-[var(--text-muted)] font-mono">{(page - 1) * pageSize + idx + 1}</td>
                              <td className="px-4 py-2 font-mono text-[var(--text-secondary)]">{formatDateTime(entry.timestamp)}</td>
                              <td className={clsx('px-4 py-2 font-mono font-semibold', typeColor[valType])}>{formatValue(entry)}</td>
                              <td className="px-4 py-2">
                                <Badge color={
                                  valType === 'number' ? 'cyan' :
                                  valType === 'string' ? 'green' :
                                  valType === 'boolean' ? 'amber' :
                                  'neutral'
                                }>{valType}</Badge>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
                    <span className="text-[10px] text-[var(--text-muted)]">
                      Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalRecords)} of {totalRecords.toLocaleString()}
                    </span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setPage(1)} disabled={page <= 1}>First</Button>
                      <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</Button>
                      <span className="px-3 py-1 text-[10px] text-[var(--text-primary)]">{page} / {totalPages}</span>
                      <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
                      <Button variant="ghost" size="sm" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>Last</Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-8 text-center text-[var(--text-muted)]">
                  <Database className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>No records for this time range</p>
                </div>
              )}
            </GlassPanel>
          ) : (
            <GlassPanel className="p-12 text-center">
              <Filter className="h-10 w-10 mx-auto mb-3 text-[var(--text-muted)] opacity-30" />
              <p className="text-[var(--text-muted)]">Select a signal from the list to view its recorded values</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">{allSignals.length} signals available</p>
            </GlassPanel>
          )}
        </div>
      </div>
    </FadeIn>
  )
}
