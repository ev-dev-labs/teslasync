import { Calendar } from 'lucide-react'

interface DateRangeFilterProps {
  startDate: string
  endDate: string
  onStartDateChange: (date: string) => void
  onEndDateChange: (date: string) => void
  onApply?: () => void
  presets?: boolean
}

/** Date range picker with quick-select presets (7d, 30d, 90d, 1y, All). */
export function DateRangeFilter({ startDate, endDate, onStartDateChange, onEndDateChange, onApply, presets = true }: DateRangeFilterProps) {
  const applyPreset = (days: number | null) => {
    const end = new Date()
    const endStr = end.toISOString().split('T')[0]
    onEndDateChange(endStr)
    if (days === null) {
      onStartDateChange('2015-01-01')
    } else {
      const start = new Date()
      start.setDate(start.getDate() - days)
      onStartDateChange(start.toISOString().split('T')[0])
    }
    onApply?.()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 sm:px-3 py-1.5 ring-1 ring-white/[0.08] w-full sm:w-auto">
        <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0 hidden sm:block" />
        <input
          type="date"
          value={startDate}
          onChange={e => onStartDateChange(e.target.value)}
          className="bg-transparent text-xs text-[var(--text-primary)] outline-none [color-scheme:dark] min-w-0 flex-1 sm:flex-none"
        />
        <span className="text-gray-600 text-xs">→</span>
        <input
          type="date"
          value={endDate}
          onChange={e => onEndDateChange(e.target.value)}
          className="bg-transparent text-xs text-[var(--text-primary)] outline-none [color-scheme:dark] min-w-0 flex-1 sm:flex-none"
        />
      </div>
      {onApply && (
        <button onClick={onApply} className="neon-button px-3 py-1.5 text-xs font-medium">Apply</button>
      )}
      {presets && (
        <div className="flex items-center gap-1">
          {[
            { label: '7d', days: 7 },
            { label: '30d', days: 30 },
            { label: '90d', days: 90 },
            { label: '1y', days: 365 },
            { label: 'All', days: null },
          ].map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.days)}
              className="rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
