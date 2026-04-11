import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Activity, Search, X, Clock, Play, Loader2, BarChart3, Table2 } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, Badge, Button, Input, Select, Skeleton, EmptyState, DataTable, type Column } from '../components/ui'
import { ChartTooltip } from '../components/Charts'
import { CHART_COLORS } from '../lib/colors'
import { request } from '../api/client'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatDateTime } from '../lib/dateFormat'
import { fmtNumber } from '../lib/numberFormat'
import clsx from 'clsx'

// ── Types ──

interface SignalHistoryRow {
  timestamp: string
  signal: string
  value_num?: number
  value_str?: string
  value_bool?: boolean
}

interface HistoryResponse {
  data: SignalHistoryRow[]
  total: number
  page: number
  per_page: number
}

interface SignalStat {
  signal: string
  min: number
  max: number
  avg: number
  count: number
}

type NumberedRow = SignalHistoryRow & { _rowNum: number }

// ── Constants ──

const MAX_SIGNALS = 5
const PAGE_SIZES = [25, 50, 100]

const TIME_PRESETS = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

function toLocalDatetimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ── Component ──

export default function SignalExplorer() {
  usePageTitle('Signal Explorer')
  const vehicleId = 1

  // Signal selection
  const [selectedSignals, setSelectedSignals] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  // DateTime range
  const now = new Date()
  const [startDt, setStartDt] = useState(() => toLocalDatetimeStr(new Date(now.getTime() - 24 * 3600_000)))
  const [endDt, setEndDt] = useState(() => toLocalDatetimeStr(now))

  // Explore trigger key — queries only run when this changes
  const [exploreKey, setExploreKey] = useState<number | null>(null)

  // Table pagination
  const [tablePage, setTablePage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // ── Available signals ──
  const { data: availableData } = useQuery<{ signals: string[] }>({
    queryKey: ['explorer-available', vehicleId],
    queryFn: () => request(`/signals/available?vehicle_id=${vehicleId}`),
    refetchInterval: 60_000,
  })

  const allSignals = availableData?.signals ?? []
  const filteredSignals = allSignals.filter(s =>
    s.toLowerCase().includes(searchQuery.toLowerCase()) && !selectedSignals.includes(s),
  )

  // ── Selection helpers ──
  const addSignal = useCallback((sig: string) => {
    setSelectedSignals(prev => prev.length < MAX_SIGNALS && !prev.includes(sig) ? [...prev, sig] : prev)
    setSearchQuery('')
  }, [])

  const removeSignal = useCallback((sig: string) => {
    setSelectedSignals(prev => prev.filter(s => s !== sig))
  }, [])

  // ── Preset helpers ──
  const applyPreset = useCallback((hours: number) => {
    const end = new Date()
    const start = new Date(end.getTime() - hours * 3600_000)
    setStartDt(toLocalDatetimeStr(start))
    setEndDt(toLocalDatetimeStr(end))
  }, [])

  // ── Explore ──
  const canExplore = selectedSignals.length > 0 && startDt && endDt

  const handleExplore = useCallback(() => {
    if (!canExplore) return
    setTablePage(1)
    setExploreKey(Date.now())
  }, [canExplore])

  const signalsCsv = selectedSignals.join(',')
  const fromIso = startDt ? new Date(startDt).toISOString() : ''
  const toIso = endDt ? new Date(endDt).toISOString() : ''

  // ── History query (chart data — up to 1000 pts) ──
  const { data: historyData, isLoading: historyLoading } = useQuery<HistoryResponse>({
    queryKey: ['explorer-history', exploreKey],
    queryFn: () =>
      request(`/signals/history?vehicle_id=${vehicleId}&signals=${signalsCsv}&from=${fromIso}&to=${toIso}&page=1&per_page=1000`),
    enabled: exploreKey !== null,
  })

  // ── Stats query ──
  const { data: statsData, isLoading: statsLoading } = useQuery<SignalStat[]>({
    queryKey: ['explorer-stats', exploreKey],
    queryFn: () =>
      request(`/signals/stats?vehicle_id=${vehicleId}&signals=${signalsCsv}&from=${fromIso}&to=${toIso}`),
    enabled: exploreKey !== null,
  })

  // ── Paginated table query ──
  const { data: tableData, isLoading: tableLoading } = useQuery<HistoryResponse>({
    queryKey: ['explorer-table', exploreKey, tablePage, pageSize],
    queryFn: () =>
      request(`/signals/history?vehicle_id=${vehicleId}&signals=${signalsCsv}&from=${fromIso}&to=${toIso}&page=${tablePage}&per_page=${pageSize}`),
    enabled: exploreKey !== null,
  })

  const isLoading = historyLoading || statsLoading || tableLoading
  const hasData = exploreKey !== null

  // ── Chart data transform ──
  const chartData = useMemo(() => {
    if (!historyData?.data?.length) return []
    // Group rows by timestamp, then merge signal values into one object per timestamp
    const map = new Map<string, Record<string, unknown>>()
    for (const row of historyData.data) {
      let entry = map.get(row.timestamp)
      if (!entry) {
        entry = { timestamp: row.timestamp }
        map.set(row.timestamp, entry)
      }
      entry[row.signal] = row.value_num ?? (row.value_bool === true ? 1 : row.value_bool === false ? 0 : null)
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.timestamp as string).getTime() - new Date(b.timestamp as string).getTime(),
    )
  }, [historyData])

  // Determine whether we need a right Y-axis (if two signals differ in scale by >10×)
  const useRightAxis = useMemo(() => {
    if (!statsData || statsData.length < 2) return false
    const ranges = statsData.map(s => Math.abs(s.max - s.min) || 1)
    return ranges[0] / ranges[1] > 10 || ranges[1] / ranges[0] > 10
  }, [statsData])

  // ── Table data ──
  const tableRows: NumberedRow[] = useMemo(() => {
    return (tableData?.data ?? []).map((row, idx) => ({
      ...row,
      _rowNum: (tablePage - 1) * pageSize + idx + 1,
    }))
  }, [tableData, tablePage, pageSize])

  const totalRecords = tableData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize))

  const formatValue = (entry: SignalHistoryRow): string => {
    if (entry.value_num != null) return fmtNumber(entry.value_num)
    if (entry.value_str != null) return entry.value_str
    if (entry.value_bool != null) return entry.value_bool ? 'true' : 'false'
    return '—'
  }

  const getValueType = (entry: SignalHistoryRow): string => {
    if (entry.value_num != null) return 'number'
    if (entry.value_str != null) return 'string'
    if (entry.value_bool != null) return 'boolean'
    return 'null'
  }

  const typeColor: Record<string, string> = {
    number: 'text-neon-cyan',
    string: 'text-neon-green',
    boolean: 'text-neon-amber',
    null: 'text-[var(--text-muted)]',
  }

  const tableColumns: Column<NumberedRow>[] = [
    { key: 'rowNum', header: '#', render: (row) => <span className="text-[var(--text-muted)] font-mono">{row._rowNum}</span> },
    { key: 'timestamp', header: 'Timestamp', render: (row) => <span className="font-mono text-[var(--text-secondary)]">{formatDateTime(row.timestamp)}</span> },
    { key: 'signal', header: 'Signal', render: (row) => <span className="font-mono text-neon-cyan text-[11px]">{row.signal}</span> },
    { key: 'value', header: 'Value', render: (row) => {
      const t = getValueType(row)
      return <span className={clsx('font-mono font-semibold', typeColor[t])}>{formatValue(row)}</span>
    }},
    { key: 'type', header: 'Type', render: (row) => {
      const t = getValueType(row)
      return <Badge color={t === 'number' ? 'cyan' : t === 'string' ? 'green' : t === 'boolean' ? 'amber' : 'neutral'}>{t}</Badge>
    }},
  ]

  return (
    <FadeIn>
      <PageHeader
        title="Signal Explorer"
        subtitle="Explore signal history from Postgres — multi-signal charts, stats & data"
        icon={<Activity className="h-7 w-7 text-neon-cyan" />}
      />

      {/* ── Controls panel ── */}
      <GlassPanel className="p-4 sm:p-5 mb-6 space-y-4">
        {/* Signal search + chips */}
        <div>
          <label className="metric-label mb-1.5 block text-[10px]">Signals (max {MAX_SIGNALS})</label>

          {/* Selected chips */}
          {selectedSignals.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedSignals.map((sig, i) => (
                <span
                  key={sig}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-mono font-medium ring-1"
                  style={{
                    color: CHART_COLORS[i % CHART_COLORS.length],
                    backgroundColor: `${CHART_COLORS[i % CHART_COLORS.length]}15`,
                    boxShadow: `0 0 6px ${CHART_COLORS[i % CHART_COLORS.length]}20`,
                    borderColor: `${CHART_COLORS[i % CHART_COLORS.length]}30`,
                  }}
                >
                  {sig}
                  <button onClick={() => removeSignal(sig)} className="hover:opacity-70 ml-0.5" aria-label={`Remove ${sig}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Searchable dropdown */}
          <div className="relative max-w-md">
            <Input
              type="text"
              placeholder={selectedSignals.length >= MAX_SIGNALS ? `Max ${MAX_SIGNALS} signals selected` : 'Search signals to add...'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              icon={<Search className="h-3.5 w-3.5" />}
              disabled={selectedSignals.length >= MAX_SIGNALS}
              aria-label="Search signals"
            />
            {searchQuery && filteredSignals.length > 0 && (
              <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] backdrop-blur-xl shadow-xl">
                {filteredSignals.slice(0, 30).map(sig => (
                  <button
                    key={sig}
                    onClick={() => addSignal(sig)}
                    className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {sig}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* DateTime range + presets */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="metric-label mb-1.5 block text-[10px]">From</label>
            <input
              type="datetime-local"
              step="1"
              value={startDt}
              onChange={e => setStartDt(e.target.value)}
              className="glass-input text-xs font-mono !py-1.5"
            />
          </div>
          <div>
            <label className="metric-label mb-1.5 block text-[10px]">To</label>
            <input
              type="datetime-local"
              step="1"
              value={endDt}
              onChange={e => setEndDt(e.target.value)}
              className="glass-input text-xs font-mono !py-1.5"
            />
          </div>

          {/* Quick presets */}
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            {TIME_PRESETS.map(p => (
              <Button key={p.label} variant="ghost" size="sm" onClick={() => applyPreset(p.hours)}
                className="!px-2 !py-1 !rounded !text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent">
                {p.label}
              </Button>
            ))}
          </div>

          {/* Explore button */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleExplore}
            disabled={!canExplore}
            loading={isLoading && hasData}
            icon={isLoading && hasData ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          >
            Explore
          </Button>
        </div>
      </GlassPanel>

      {/* ── Content area ── */}
      {!hasData ? (
        <GlassPanel className="p-4">
          <EmptyState
            icon={<Activity className="h-10 w-10" />}
            title="Select signals and click Explore"
            description="Choose up to 5 signals, set a time range, and click Explore to visualise signal history from Postgres."
          />
        </GlassPanel>
      ) : (
        <div className="space-y-5">
          {/* ── Chart ── */}
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-neon-cyan" />
              <h2 className="section-title">Signal Chart</h2>
              {historyData && (
                <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                  {historyData.data.length.toLocaleString()} points loaded
                </span>
              )}
            </div>

            {historyLoading ? (
              <Skeleton className="h-[350px] w-full" />
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={chartData} margin={{ top: 10, right: useRightAxis ? 20 : 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="timestamp"
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    tickFormatter={(v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  />
                  <YAxis yAxisId="left" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  {useRightAxis && (
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  )}
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
                    iconType="circle"
                  />
                  {selectedSignals.map((sig, i) => (
                    <Line
                      key={sig}
                      type="monotone"
                      dataKey={sig}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      name={sig}
                      yAxisId={useRightAxis && i === 1 ? 'right' : 'left'}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[350px] flex items-center justify-center text-[var(--text-muted)]">
                No data for this time range
              </div>
            )}
          </GlassPanel>

          {/* ── Stats summary ── */}
          <GlassPanel className="p-4 sm:p-5">
            <h2 className="section-title mb-3">Stats Summary</h2>
            {statsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
              </div>
            ) : statsData && statsData.length > 0 ? (
              <div className="overflow-x-auto rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-3 py-2 text-left text-[var(--text-muted)] font-medium">Signal</th>
                      <th className="px-3 py-2 text-right text-[var(--text-muted)] font-medium">Min</th>
                      <th className="px-3 py-2 text-right text-[var(--text-muted)] font-medium">Max</th>
                      <th className="px-3 py-2 text-right text-[var(--text-muted)] font-medium">Avg</th>
                      <th className="px-3 py-2 text-right text-[var(--text-muted)] font-medium">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsData.map((s, i) => (
                      <tr key={s.signal} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <td className="px-3 py-2 font-mono font-semibold" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>
                          {s.signal}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text-secondary)]">{fmtNumber(s.min)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text-secondary)]">{fmtNumber(s.max)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">{fmtNumber(s.avg)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text-muted)]">{s.count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">No stats available</p>
            )}
          </GlassPanel>

          {/* ── Data table ── */}
          <GlassPanel className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Table2 className="h-4 w-4 text-neon-cyan" />
                <h2 className="section-title">Data Table</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-muted)]">Rows:</span>
                <Select
                  value={String(pageSize)}
                  onChange={e => { setPageSize(Number(e.target.value)); setTablePage(1) }}
                  options={PAGE_SIZES.map(s => ({ value: String(s), label: String(s) }))}
                />
                {totalRecords > 0 && (
                  <span className="text-[10px] text-[var(--text-muted)] ml-2">
                    {totalRecords.toLocaleString()} records
                  </span>
                )}
              </div>
            </div>

            {tableLoading ? (
              <div className="p-8 text-center text-[var(--text-muted)]">Loading…</div>
            ) : tableRows.length > 0 ? (
              <>
                <DataTable columns={tableColumns} data={tableRows} keyExtractor={(row) => row._rowNum} compact />
                <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Showing {(tablePage - 1) * pageSize + 1}–{Math.min(tablePage * pageSize, totalRecords)} of {totalRecords.toLocaleString()}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setTablePage(1)} disabled={tablePage <= 1}>First</Button>
                    <Button variant="ghost" size="sm" onClick={() => setTablePage(p => Math.max(1, p - 1))} disabled={tablePage <= 1}>Prev</Button>
                    <span className="px-3 py-1 text-[10px] text-[var(--text-primary)]">{tablePage} / {totalPages}</span>
                    <Button variant="ghost" size="sm" onClick={() => setTablePage(p => Math.min(totalPages, p + 1))} disabled={tablePage >= totalPages}>Next</Button>
                    <Button variant="ghost" size="sm" onClick={() => setTablePage(totalPages)} disabled={tablePage >= totalPages}>Last</Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-[var(--text-muted)]">
                No records for this time range
              </div>
            )}
          </GlassPanel>
        </div>
      )}
    </FadeIn>
  )
}
