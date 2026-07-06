/**
 * Shared components for Signal Log Viewer and Signal Explorer pages.
 * Provides reusable signal search, datetime range, and data table controls.
 */
import { useState, useRef, useEffect, useMemo, useCallback, useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { request } from '@/api/client'
import { GlassPanel, Badge, type BadgeProps, Button, Input, DataTable, type Column } from './ui'
import { fmtInt } from '../lib/numberFormat'
import { TIME_RANGE_PRESETS, matchTimeRangePreset } from '../lib/constants'
import { cn } from '../lib/cn'
import { Search, X, Play, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'


/* ── Shared Types ── */

export interface SignalLogEntry {
  created_at: string
  signal: string
  value_num?: number | null
  value_str?: string | null
  value_bool?: boolean | null
}

/* ── BE → FE adapter ── */
//
// The `/api/v1/signals/{vid}/{name}/history` endpoint returns the
// Typed shape `{ts, kind, value}` — a single `value` whose
// type is dictated by the row's `value_kind` discriminator. The rest
// of the telemetry UI (chart, stats, table) was built for the older
// `{created_at, value_num/str/bool}` rows. Without this adapter the
// chart axis renders "Invalid Date" and every cell shows "—" with a
// "string" type badge — the symptom that motivated this helper.
import type { SignalHistoryPoint, SignalHistoryResp } from '@/api/types'

export function adaptSignalHistoryPoint(point: SignalHistoryPoint, signal: string): SignalLogEntry {
  const entry: SignalLogEntry = {
    created_at: point.ts,
    signal,
    value_num: null,
    value_str: null,
    value_bool: null,
  }
  switch (typeof point.value) {
    case 'number':
      entry.value_num = Number.isFinite(point.value) ? point.value : null
      break
    case 'boolean':
      entry.value_bool = point.value
      break
    case 'string':
      // The typed BE returns ValueKindTime / ValueKindString as strings;
      // surface both via value_str so the table renders them and the
      // chart's numeric guard correctly skips non-numeric series.
      entry.value_str = point.value
      break
    default:
      // null / undefined → leave all three nulled out
      break
  }
  return entry
}

export function adaptSignalHistoryResp(resp: SignalHistoryResp | null | undefined): SignalLogEntry[] {
  if (!resp || !Array.isArray(resp.data)) return []
  const signal = resp.signal ?? ''
  return resp.data.map((p) => adaptSignalHistoryPoint(p, signal))
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

// Maps a value-type discriminator to a Badge `variant`. The Badge primitive is
// variant-based (info/success/warning/neutral); an earlier revision passed
// these as a `color` prop, which fell through to the DOM as an inert attribute
// and left every type chip rendering the default neutral style. Keeping the
// values in sync with BadgeProps['variant'] restores the intended colour code.
export const TYPE_BADGE_COLOR: Record<string, NonNullable<BadgeProps['variant']>> = {
  num: 'info', str: 'success', bool: 'warning', null: 'neutral',
}

// Body cells in a 100s-of-rows table — readability wins over saturation.
// Use toned-down 300-shades; light-mode CSS overrides invert them on white.
export const TYPE_VALUE_COLOR: Record<string, string> = {
  num: 'text-cyan-300', str: 'text-emerald-300', bool: 'text-amber-300', null: 'text-[var(--text-muted)]',
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
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputId = useId()
  const listboxId = useId()

  const { data: availableSignals, isLoading, isError } = useQuery({
    queryKey: ['signal-available', vehicleId],
    queryFn: () => request<string[]>(`/signals/available?vehicle_id=${vehicleId}`),
    staleTime: 60_000,
  })

  const atMax = !!maxSignals && selected.length >= maxSignals

  const filtered = useMemo(() => {
    const all = availableSignals ?? []
    const q = search.trim().toLowerCase()
    return all.filter(s => !selected.includes(s) && (!q || s.toLowerCase().includes(q)))
  }, [availableSignals, search, selected])

  const visible = useMemo(() => filtered.slice(0, 50), [filtered])

  const addSignal = useCallback((sig: string) => {
    if (!!maxSignals && selected.length >= maxSignals) return
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
      <label htmlFor={inputId} className="metric-label mb-1.5 block">
        {maxSignals
          ? t('signalQuery.signalsMax', 'Signals (max {{count}})', { count: maxSignals })
          : t('signalQuery.signals', 'Signals')}
      </label>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(sig => (
            <span key={sig} className="inline-flex items-center gap-1 rounded-lg bg-neon-cyan/10 border border-neon-cyan/25 px-2 py-0.5 text-xs font-mono text-neon-cyan">
              {sig}
              <button
                type="button"
                onClick={() => removeSignal(sig)}
                className="touch-target-overlay hover:text-[var(--text-primary)] transition-colors"
                aria-label={t('signalQuery.removeSignal', 'Remove {{signal}}', { signal: sig })}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative" ref={ref}>
        <Input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-label={t('signalQuery.searchSignals', 'Search signals')}
          placeholder={selected.length
            ? t('signalQuery.addMoreSignals', 'Add more signals…')
            : t('signalQuery.searchSignalsPlaceholder', 'Search signals…')}
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          icon={<Search className="h-3.5 w-3.5" />}
        />
        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-label={t('signalQuery.searchSignals', 'Search signals')}
            className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-white/[0.08] bg-[var(--bg-primary)] shadow-xl"
          >
            {isLoading ? (
              <p className="px-3 py-1.5 text-xs text-[var(--text-muted)]">
                {t('signalQuery.loadingSignals', 'Loading signals…')}
              </p>
            ) : isError ? (
              <p className="px-3 py-1.5 text-xs text-rose-300">
                {t('signalQuery.signalsError', 'Failed to load signals')}
              </p>
            ) : atMax ? (
              <p className="px-3 py-1.5 text-xs text-[var(--text-muted)]">
                {t('signalQuery.maxReached', 'Maximum of {{count}} signals selected', { count: maxSignals })}
              </p>
            ) : visible.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-[var(--text-muted)]">
                {search
                  ? t('signalQuery.noMatchingSignals', 'No matching signals')
                  : t('signalQuery.noSignals', 'No signals available')}
              </p>
            ) : (
              <>
                {visible.map(sig => (
                  <button
                    key={sig}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => { addSignal(sig); setOpen(false) }}
                    className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-white/[0.05] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {sig}
                  </button>
                ))}
                {filtered.length > 50 && (
                  <p className="px-3 py-1.5 text-2xs text-[var(--text-muted)]">
                    {t('signalQuery.moreRefine', '{{count}} more — refine search', { count: filtered.length - 50 })}
                  </p>
                )}
              </>
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
  const { t } = useTranslation()
  const fromId = useId()
  const toId = useId()
  const activePresetHours = matchTimeRangePreset(fromStr, toStr)
  const inputClass = "w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-mono text-[var(--text-primary)] outline-none focus:border-neon-cyan/40"

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
      <div className="space-y-1.5">
        <label htmlFor={fromId} className="metric-label">{t('signalQuery.from', 'From')}</label>
        <input id={fromId} type="datetime-local" step="1" value={fromStr} onChange={e => onFromChange(e.target.value)} className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={toId} className="metric-label">{t('signalQuery.to', 'To')}</label>
        <input id={toId} type="datetime-local" step="1" value={toStr} onChange={e => onToChange(e.target.value)} className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label className="metric-label">{t('signalQuery.quickRange', 'Quick Range')}</label>
        <div className="flex items-center gap-1">
          {TIME_RANGE_PRESETS.map(tp => {
            const active = activePresetHours === tp.hours
            return (
              <button
                key={tp.label}
                onClick={() => onPreset(tp.hours)}
                aria-pressed={active}
                aria-label={t('signalQuery.preset.aria', '{{label}} time range', { label: tp.label })}
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs transition-colors",
                  active
                    ? "border-neon-cyan/40 bg-neon-cyan/10 text-[var(--text-primary)]"
                    : "border-white/[0.08] bg-white/[0.03] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-neon-cyan/30",
                )}
              >
                {tp.label}
              </button>
            )
          })}
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

export function QueryControls({ perPage, onPerPageChange, onQuery, disabled, loading, label }: QueryControlsProps) {
  const { t } = useTranslation()
  const rowsId = useId()
  const rowsLabel = t('signalQuery.rows', 'Rows')
  const buttonLabel = label ?? t('signalQuery.query', 'Query')
  return (
    <div className="flex items-end gap-2">
      <div className="space-y-1.5">
        <label htmlFor={rowsId} className="metric-label">{rowsLabel}</label>
        <select
          id={rowsId}
          aria-label={rowsLabel}
          value={perPage}
          onChange={e => onPerPageChange(Number(e.target.value))}
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-neon-cyan/40"
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Button variant="primary" size="sm" onClick={onQuery} disabled={disabled} loading={loading}
        icon={loading ? undefined : <Play className="h-3.5 w-3.5" />} className="h-[34px]">
        {buttonLabel}
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
  const { t } = useTranslation()

  if (loading) {
    return <GlassPanel className="p-4"><div className="space-y-2">{Array.from({length: 5}).map((_, i) => <div key={i} className="h-8 rounded bg-white/[0.03] animate-pulse" />)}</div></GlassPanel>
  }

  type IndexedEntry = SignalLogEntry & { _rowNum: number }
  const safeRows = rows ?? []
  const indexedRows: IndexedEntry[] = safeRows.map((entry, i) => ({
    ...entry,
    _rowNum: (page - 1) * perPage + i + 1,
  }))

  const columns: Column<IndexedEntry>[] = [
    {
      key: 'index',
      header: '#',
      render: (row) => row._rowNum,
      className: 'text-[var(--text-muted)] font-mono',
    },
    {
      key: 'created_at',
      header: t('signalQuery.col.timestamp', 'Timestamp'),
      render: (row) => formatTimestampMs(row.created_at),
      className: 'font-mono text-[var(--text-secondary)]',
    },
    {
      key: 'signal',
      header: t('signalQuery.col.signal', 'Signal'),
      render: (row) => row.signal,
      className: 'font-mono text-[var(--text-primary)]',
    },
    {
      key: 'value',
      header: t('signalQuery.col.value', 'Value'),
      render: (row) => {
        const vt = getValueType(row)
        return <span className={TYPE_VALUE_COLOR[vt]}>{formatValue(row)}</span>
      },
      className: 'font-mono',
    },
    {
      key: 'type',
      header: t('signalQuery.col.type', 'Type'),
      render: (row) => {
        const vt = getValueType(row)
        return <Badge variant={TYPE_BADGE_COLOR[vt]}>{vt}</Badge>
      },
    },
  ]

  return (
    <GlassPanel className="overflow-hidden">
      <DataTable
        columns={columns}
        data={indexedRows}
        keyExtractor={(row) => row._rowNum}
        emptyMessage={t('signalQuery.noResults', 'No results')}
        compact
      />

      {/* Server-side pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
          <span className="text-2xs text-[var(--text-muted)]">{t('signalQuery.records', '{{n}} records', { n: fmtInt(total) })}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => onPageChange(1)} disabled={page <= 1} aria-label={t('signalQuery.firstPage', 'First page')} className="touch-target-overlay p-1 rounded hover:bg-white/[0.05] disabled:opacity-30"><ChevronsLeft className="h-3.5 w-3.5" /></button>
            <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label={t('signalQuery.prevPage', 'Previous page')} className="touch-target-overlay p-1 rounded hover:bg-white/[0.05] disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="px-2 text-xs text-[var(--text-secondary)]">{t('signalQuery.pageOf', 'Page {{page}} of {{total}}', { page, total: totalPages })}</span>
            <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label={t('signalQuery.nextPage', 'Next page')} className="touch-target-overlay p-1 rounded hover:bg-white/[0.05] disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
            <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} aria-label={t('signalQuery.lastPage', 'Last page')} className="touch-target-overlay p-1 rounded hover:bg-white/[0.05] disabled:opacity-30"><ChevronsRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
    </GlassPanel>
  )
}
