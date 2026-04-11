import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { request } from '../api/client'
import { PageHeader, GlassPanel, FadeIn, Badge, Button, Input, Skeleton, EmptyState } from '../components/ui'
import { Database, Search, X, Play, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import clsx from 'clsx'
import { usePageTitle } from '../hooks/usePageTitle'

/* ── types ── */

interface SignalLogEntry {
  timestamp: string
  signal: string
  value_num?: number | null
  value_str?: string | null
  value_bool?: boolean | null
}

interface Pagination {
  page: number
  per_page: number
  total: number
  total_pages: number
}

interface HistoryResponse {
  data: SignalLogEntry[]
  pagination: Pagination
}

interface AvailableSignalsResponse {
  signals: string[]
  count: number
}

/* ── constants ── */

const PAGE_SIZES = [25, 50, 100]

const TIME_PRESETS = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

/* ── helpers ── */

/** Formats a Date to a `datetime-local` input value with seconds precision (local TZ). */
function toLocalDatetimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Formats an ISO timestamp with milliseconds for display. */
function formatTimestampMs(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const pad3 = (n: number) => String(n).padStart(3, '0')
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`
}

function getValueType(entry: SignalLogEntry): 'num' | 'str' | 'bool' | 'null' {
  if (entry.value_num != null) return 'num'
  if (entry.value_str != null) return 'str'
  if (entry.value_bool != null) return 'bool'
  return 'null'
}

function formatValue(entry: SignalLogEntry): string {
  if (entry.value_num != null) return String(entry.value_num)
  if (entry.value_str != null) return entry.value_str
  if (entry.value_bool != null) return entry.value_bool ? 'true' : 'false'
  return '—'
}

const TYPE_BADGE_COLOR: Record<string, 'cyan' | 'green' | 'amber' | 'neutral'> = {
  num: 'cyan',
  str: 'green',
  bool: 'amber',
  null: 'neutral',
}

const TYPE_VALUE_COLOR: Record<string, string> = {
  num: 'text-neon-cyan',
  str: 'text-neon-green',
  bool: 'text-neon-amber',
  null: 'text-[var(--text-muted)]',
}

/* ── component ── */

export default function SignalLogViewer() {
  usePageTitle('Signal Log')
  const { vehicleId: paramVehicleId } = useParams<{ vehicleId: string }>()
  const vehicleId = paramVehicleId ? Number(paramVehicleId) : 1

  // Signal selection
  const [selectedSignals, setSelectedSignals] = useState<string[]>([])
  const [signalSearch, setSignalSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Date range (local-TZ strings for the datetime-local inputs)
  const now = useMemo(() => new Date(), [])
  const [fromStr, setFromStr] = useState(() => toLocalDatetimeStr(new Date(now.getTime() - 1 * 3600_000)))
  const [toStr, setToStr] = useState(() => toLocalDatetimeStr(now))

  // Pagination
  const [perPage, setPerPage] = useState(50)
  const [page, setPage] = useState(1)

  // Query trigger — only fetch when user clicks "Query"
  const [queryParams, setQueryParams] = useState<{
    signals: string[]
    from: string
    to: string
    page: number
    perPage: number
  } | null>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Available signals
  const { data: availableData } = useQuery<AvailableSignalsResponse>({
    queryKey: ['signal-available', vehicleId],
    queryFn: () => request(`/signals/available?vehicle_id=${vehicleId}`),
    staleTime: 120_000,
  })

  const allSignals = availableData?.signals ?? []

  const filteredDropdown = useMemo(() => {
    if (!signalSearch) return allSignals.filter(s => !selectedSignals.includes(s))
    const q = signalSearch.toLowerCase()
    return allSignals.filter(s => s.toLowerCase().includes(q) && !selectedSignals.includes(s))
  }, [allSignals, signalSearch, selectedSignals])

  const addSignal = useCallback((sig: string) => {
    setSelectedSignals(prev => prev.includes(sig) ? prev : [...prev, sig])
    setSignalSearch('')
  }, [])

  const removeSignal = useCallback((sig: string) => {
    setSelectedSignals(prev => prev.filter(s => s !== sig))
  }, [])

  // Preset buttons set the datetime inputs
  function applyPreset(hours: number) {
    const end = new Date()
    const start = new Date(end.getTime() - hours * 3600_000)
    setFromStr(toLocalDatetimeStr(start))
    setToStr(toLocalDatetimeStr(end))
  }

  // Build query on button click
  function handleQuery() {
    if (selectedSignals.length === 0) return
    const fromUTC = new Date(fromStr).toISOString()
    const toUTC = new Date(toStr).toISOString()
    setPage(1)
    setQueryParams({ signals: selectedSignals, from: fromUTC, to: toUTC, page: 1, perPage })
  }

  // Keep queryParams page/perPage in sync when paginating after initial query
  function goToPage(p: number) {
    setPage(p)
    if (queryParams) setQueryParams({ ...queryParams, page: p, perPage })
  }

  // Fetch history
  const { data: historyResp, isLoading, isFetching } = useQuery<HistoryResponse>({
    queryKey: ['signal-history', queryParams],
    queryFn: () => {
      const qp = queryParams!
      const params = new URLSearchParams({
        vehicle_id: String(vehicleId),
        signals: qp.signals.join(','),
        from: qp.from,
        to: qp.to,
        page: String(qp.page),
        per_page: String(qp.perPage),
      })
      return request(`/signals/history?${params}`)
    },
    enabled: !!queryParams,
  })

  const rows = historyResp?.data ?? []
  const pagination = historyResp?.pagination
  const totalPages = pagination?.total_pages ?? 1
  const totalRecords = pagination?.total ?? 0
  const hasQueried = queryParams !== null

  return (
    <FadeIn>
      <PageHeader
        title="Signal Log Viewer"
        subtitle="Query signal history from Postgres"
        icon={<Database className="h-7 w-7 text-neon-cyan" />}
      />

      {/* ── Controls ── */}
      <GlassPanel className="p-4 mb-4 space-y-4">
        {/* Row 1: Signal multi-select */}
        <div>
          <label className="metric-label mb-1.5 block">Signals</label>

          {/* Selected chips */}
          {selectedSignals.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedSignals.map(sig => (
                <span
                  key={sig}
                  className="inline-flex items-center gap-1 rounded-lg bg-neon-cyan/10 border border-neon-cyan/25 px-2 py-0.5 text-xs font-mono text-neon-cyan"
                >
                  {sig}
                  <button
                    type="button"
                    onClick={() => removeSignal(sig)}
                    className="hover:text-white transition-colors"
                    aria-label={`Remove ${sig}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Searchable dropdown */}
          <div className="relative" ref={dropdownRef}>
            <Input
              type="text"
              placeholder={selectedSignals.length ? 'Add more signals…' : 'Search signals…'}
              value={signalSearch}
              onChange={e => { setSignalSearch(e.target.value); setDropdownOpen(true) }}
              onFocus={() => setDropdownOpen(true)}
              icon={<Search className="h-3.5 w-3.5" />}
              aria-label="Search signals"
            />
            {dropdownOpen && (
              <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-1)] backdrop-blur-xl shadow-2xl">
                {filteredDropdown.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">
                    {allSignals.length === 0 ? 'Loading signals…' : 'No matching signals'}
                  </p>
                ) : (
                  filteredDropdown.map(sig => (
                    <button
                      key={sig}
                      type="button"
                      onClick={() => { addSignal(sig); setDropdownOpen(true) }}
                      className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)] transition-colors"
                    >
                      {sig}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Row 2: DateTime range + presets + rows per page + query button */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          {/* From */}
          <div className="space-y-1.5">
            <label className="metric-label">From</label>
            <input
              type="datetime-local"
              step="1"
              value={fromStr}
              onChange={e => setFromStr(e.target.value)}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-mono text-[var(--text-primary)] outline-none focus:border-neon-cyan/40"
            />
          </div>

          {/* To */}
          <div className="space-y-1.5">
            <label className="metric-label">To</label>
            <input
              type="datetime-local"
              step="1"
              value={toStr}
              onChange={e => setToStr(e.target.value)}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-mono text-[var(--text-primary)] outline-none focus:border-neon-cyan/40"
            />
          </div>

          {/* Quick presets + Rows per page */}
          <div className="space-y-1.5">
            <label className="metric-label">Quick Range</label>
            <div className="flex items-center gap-1">
              {TIME_PRESETS.map(tp => (
                <button
                  key={tp.label}
                  onClick={() => applyPreset(tp.hours)}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-neon-cyan/30 transition-colors"
                >
                  {tp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Rows per page + Query button */}
          <div className="flex items-end gap-2">
            <div className="space-y-1.5 flex-1">
              <label className="metric-label">Rows</label>
              <select
                value={perPage}
                onChange={e => setPerPage(Number(e.target.value))}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-neon-cyan/40"
              >
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleQuery}
              disabled={selectedSignals.length === 0 || isFetching}
              loading={isFetching}
              icon={isFetching ? undefined : <Play className="h-3.5 w-3.5" />}
              className="h-[34px]"
            >
              Query
            </Button>
          </div>
        </div>
      </GlassPanel>

      {/* ── Results ── */}
      {!hasQueried ? (
        <EmptyState
          icon={<Database className="h-10 w-10" />}
          title="Select signals and click Query"
          description="Choose one or more signals, set a date range, then hit Query to browse signal history."
        />
      ) : isLoading ? (
        <GlassPanel className="p-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </GlassPanel>
      ) : rows.length === 0 ? (
        <GlassPanel className="p-12 text-center">
          <Database className="h-8 w-8 mx-auto mb-2 opacity-30 text-[var(--text-muted)]" />
          <p className="text-[var(--text-muted)]">No records found for the selected signals and time range</p>
        </GlassPanel>
      ) : (
        <GlassPanel className="overflow-hidden">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] bg-white/[0.02]">
                  <th className="px-3 py-2 font-semibold text-[var(--text-muted)] w-12">#</th>
                  <th className="px-3 py-2 font-semibold text-[var(--text-muted)]">Timestamp</th>
                  <th className="px-3 py-2 font-semibold text-[var(--text-muted)]">Signal</th>
                  <th className="px-3 py-2 font-semibold text-[var(--text-muted)]">Value</th>
                  <th className="px-3 py-2 font-semibold text-[var(--text-muted)] w-20">Type</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry, idx) => {
                  const rowNum = ((pagination?.page ?? 1) - 1) * (pagination?.per_page ?? perPage) + idx + 1
                  const vt = getValueType(entry)
                  return (
                    <tr key={idx} className="border-b border-[var(--border)] hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2 font-mono text-[var(--text-muted)]">{rowNum}</td>
                      <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{formatTimestampMs(entry.timestamp)}</td>
                      <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{entry.signal}</td>
                      <td className={clsx('px-3 py-2 font-mono font-semibold', TYPE_VALUE_COLOR[vt])}>{formatValue(entry)}</td>
                      <td className="px-3 py-2"><Badge color={TYPE_BADGE_COLOR[vt]}>{vt}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
            <span className="text-[10px] text-[var(--text-muted)]">
              Showing {((pagination?.page ?? 1) - 1) * (pagination?.per_page ?? perPage) + 1}–{Math.min((pagination?.page ?? 1) * (pagination?.per_page ?? perPage), totalRecords)} of {totalRecords.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => goToPage(1)} disabled={page <= 1} icon={<ChevronsLeft className="h-3.5 w-3.5" />}>First</Button>
              <Button variant="ghost" size="sm" onClick={() => goToPage(page - 1)} disabled={page <= 1} icon={<ChevronLeft className="h-3.5 w-3.5" />}>Prev</Button>
              <span className="px-3 py-1 text-[10px] text-[var(--text-primary)]">Page {page} of {totalPages}</span>
              <Button variant="ghost" size="sm" onClick={() => goToPage(page + 1)} disabled={page >= totalPages} icon={<ChevronRight className="h-3.5 w-3.5" />}>Next</Button>
              <Button variant="ghost" size="sm" onClick={() => goToPage(totalPages)} disabled={page >= totalPages} icon={<ChevronsRight className="h-3.5 w-3.5" />}>Last</Button>
            </div>
          </div>
        </GlassPanel>
      )}
    </FadeIn>
  )
}
