/**
 * Shared components for Signal Log Viewer and Signal Explorer pages.
 * Provides reusable signal search, datetime range, and data table controls.
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { request } from '../api/client'
import { GlassPanel, Badge, Button, Input, DataTable, type Column } from './ui'
import { fmtInt } from '../lib/numberFormat'
import { TIME_RANGE_PRESETS } from '../lib/constants'
import { Search, X, Play, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'


/* ── Shared Types ── */

export interface SignalLogEntry {
  created_at: string
  signal: string
  value_num?: number | null
  value_str?: string | null
  value_bool?: boolean | null
}

export interface SignalHistoryPagination {
  page: number
  per_page: number
  total: number
  total_pages: number
}

export interface SignalHistoryResponse {
  data: SignalLogEntry[]
  pagination: SignalHistoryPagination
}

/* ── Shared Helpers ── */

export function toLocalDatetimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function formatTimestampMs(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const pad3 = (n: number) => String(n).padStart(3, '0')
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`
}

export function getValueType(entry: SignalLogEntry): 'num' | 'str' | 'bool' | 'null' {
  if (entry.value_num != null) return 'num'
  if (entry.value_str != null) return 'str'
  if (entry.value_bool != null) return 'bool'
  return 'null'
}

export function formatValue(entry: SignalLogEntry): string {
  if (entry.value_num != null) return String(entry.value_num)
  if (entry.value_str != null) return entry.value_str
  if (entry.value_bool != null) return entry.value_bool ? 'true' : 'false'
  return '—'
}

export const TYPE_BADGE_COLOR: Record<string, 'cyan' | 'green' | 'amber' | 'neutral'> = {
  num: 'cyan', str: 'green', bool: 'amber', null: 'neutral',
}

export const TYPE_VALUE_COLOR: Record<string, string> = {
  num: 'text-neon-cyan', str: 'text-neon-green', bool: 'text-neon-amber', null: 'text-white/40',
}

export const PAGE_SIZES = [25, 50, 100]

/* ── Signal Multi-Select ── */

interface SignalMultiSelectProps {
  vehicleId: number
  selected: string[]
  onChange: (signals: string[]) => void
  maxSignals?: number
}

export function SignalMultiSelect({ vehicleId, selected, onChange, maxSignals }: SignalMultiSelectProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data: availableSignals } = useQuery({
    queryKey: ['signal-available', vehicleId],
    queryFn: () => request<string[]>(`/signals/available?vehicle_id=${vehicleId}`),
    staleTime: 60_000,
  })

  const filtered = useMemo(() => {
    const all = availableSignals ?? []
    if (!search) return all.filter(s => !selected.includes(s))
    const q = search.toLowerCase()
    return all.filter(s => !selected.includes(s) && s.toLowerCase().includes(q))
  }, [availableSignals, search, selected])

  const addSignal = useCallback((sig: string) => {
    if (maxSignals && selected.length >= maxSignals) return
    onChange([...selected, sig])
    setSearch('')
  }, [selected, onChange, maxSignals])

  const removeSignal = useCallback((sig: string) => {
    onChange(selected.filter(s => s !== sig))
  }, [selected, onChange])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div>
      <label className="metric-label mb-1.5 block">
        Signals{maxSignals ? ` (max ${maxSignals})` : ''}
      </label>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(sig => (
            <span key={sig} className="inline-flex items-center gap-1 rounded-lg bg-neon-cyan/10 border border-neon-cyan/25 px-2 py-0.5 text-xs font-mono text-neon-cyan">
              {sig}
              <button type="button" onClick={() => removeSignal(sig)} className="hover:text-white transition-colors" aria-label={`Remove ${sig}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative" ref={ref}>
        <Input
          type="text"
          placeholder={selected.length ? 'Add more signals…' : 'Search signals…'}
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          icon={<Search className="h-3.5 w-3.5" />}
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-white/[0.08] bg-[var(--bg-primary)] shadow-xl">
            {filtered.slice(0, 50).map(sig => (
              <button
                key={sig}
                type="button"
                onClick={() => { addSignal(sig); setOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-white/[0.05] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                {sig}
              </button>
            ))}
            {filtered.length > 50 && (
              <p className="px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                {filtered.length - 50} more — refine search
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── DateTime Range Controls ── */

interface DateTimeRangeProps {
  fromStr: string
  toStr: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  onPreset: (hours: number) => void
}

export function DateTimeRangeControls({ fromStr, toStr, onFromChange, onToChange, onPreset }: DateTimeRangeProps) {
  const inputClass = "w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-mono text-[var(--text-primary)] outline-none focus:border-neon-cyan/40"

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
      <div className="space-y-1.5">
        <label className="metric-label">From</label>
        <input type="datetime-local" step="1" value={fromStr} onChange={e => onFromChange(e.target.value)} className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label className="metric-label">To</label>
        <input type="datetime-local" step="1" value={toStr} onChange={e => onToChange(e.target.value)} className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label className="metric-label">Quick Range</label>
        <div className="flex items-center gap-1">
          {TIME_RANGE_PRESETS.map(tp => (
            <button
              key={tp.label}
              onClick={() => onPreset(tp.hours)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-neon-cyan/30 transition-colors"
            >
              {tp.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Query Controls (Rows + Button) ── */

interface QueryControlsProps {
  perPage: number
  onPerPageChange: (v: number) => void
  onQuery: () => void
  disabled?: boolean
  loading?: boolean
  label?: string
}

export function QueryControls({ perPage, onPerPageChange, onQuery, disabled, loading, label = 'Query' }: QueryControlsProps) {
  return (
    <div className="flex items-end gap-2">
      <div className="space-y-1.5">
        <label className="metric-label">Rows</label>
        <select
          value={perPage}
          onChange={e => onPerPageChange(Number(e.target.value))}
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-neon-cyan/40"
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Button variant="primary" size="sm" onClick={onQuery} disabled={disabled} loading={loading}
        icon={loading ? undefined : <Play className="h-3.5 w-3.5" />} className="h-[34px]">
        {label}
      </Button>
    </div>
  )
}

/* ── Signal Data Table ── */

interface SignalDataTableProps {
  rows: SignalLogEntry[]
  page: number
  totalPages: number
  total: number
  perPage: number
  onPageChange: (p: number) => void
  loading?: boolean
}

export function SignalDataTable({ rows, page, totalPages, total, perPage, onPageChange, loading }: SignalDataTableProps) {
  if (loading) {
    return <GlassPanel className="p-4"><div className="space-y-2">{Array.from({length: 5}).map((_, i) => <div key={i} className="h-8 rounded bg-white/[0.03] animate-pulse" />)}</div></GlassPanel>
  }

  type IndexedEntry = SignalLogEntry & { _rowNum: number }
  const indexedRows: IndexedEntry[] = rows.map((entry, i) => ({
    ...entry,
    _rowNum: (page - 1) * perPage + i + 1,
  }))

  const columns: Column<IndexedEntry>[] = [
    {
      key: 'index',
      header: '#',
      render: (row) => row._rowNum,
      className: 'text-white/40 font-mono',
    },
    {
      key: 'created_at',
      header: 'Timestamp',
      render: (row) => formatTimestampMs(row.created_at),
      className: 'font-mono text-white/60',
    },
    {
      key: 'signal',
      header: 'Signal',
      render: (row) => row.signal,
      className: 'font-mono text-white/90',
    },
    {
      key: 'value',
      header: 'Value',
      render: (row) => {
        const vt = getValueType(row)
        return <span className={TYPE_VALUE_COLOR[vt]}>{formatValue(row)}</span>
      },
      className: 'font-mono',
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => {
        const vt = getValueType(row)
        return <Badge color={TYPE_BADGE_COLOR[vt]}>{vt}</Badge>
      },
    },
  ]

  return (
    <GlassPanel className="overflow-hidden">
      <DataTable
        columns={columns}
        data={indexedRows}
        keyExtractor={(row) => row._rowNum}
        emptyMessage="No results"
        compact
      />

      {/* Server-side pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
          <span className="text-[10px] text-white/40">{fmtInt(total)} records</span>
          <div className="flex items-center gap-1">
            <button onClick={() => onPageChange(1)} disabled={page <= 1} className="p-1 rounded hover:bg-white/[0.05] disabled:opacity-30"><ChevronsLeft className="h-3.5 w-3.5" /></button>
            <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="p-1 rounded hover:bg-white/[0.05] disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="px-2 text-xs text-white/60">Page {page} of {totalPages}</span>
            <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="p-1 rounded hover:bg-white/[0.05] disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
            <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} className="p-1 rounded hover:bg-white/[0.05] disabled:opacity-30"><ChevronsRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
    </GlassPanel>
  )
}
