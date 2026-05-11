import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DatePresetChips, type DatePresetSelection } from './DatePresetChips'
import { DEFAULT_PRESET_IDS, matchPresetId } from '@/lib/datePresets'

interface DateRangeFilterProps {
  startDate: string
  endDate: string
  onStartDateChange: (date: string) => void
  onEndDateChange: (date: string) => void
  /**
   * Optional atomic-update callback. When provided, preset chip clicks
   * call this instead of `onStartDateChange` + `onEndDateChange`. Use
   * with `useUrlBatch()` to avoid the same-tick URL setter race.
   *
   * ```ts
   *   const setBatch = useUrlBatch();
   *   <DateRangeFilter
   *     startDate={start}
   *     endDate={end}
   *     onStartDateChange={(v) => setBatch({ from: v })}
   *     onEndDateChange={(v) => setBatch({ to: v })}
   *     onRangeChange={(r) => setBatch({ from: r.start, to: r.end })}
   *     onApply={() => setPage(1)}
   *   />
   * ```
   */
  onRangeChange?: (range: { start: string; end: string }) => void
  onApply?: () => void
  /** When false, hides the preset chip row. Defaults to true. */
  presets?: boolean
  /** Subset of preset ids to render in the chip row. Defaults to DEFAULT_PRESET_IDS. */
  presetIds?: readonly string[]
}

/**
 * Date range picker with quick-select preset chips.
 *
 * Default chip set comes from DEFAULT_PRESET_IDS in @/lib/datePresets
 * (Today / 7d / 30d / MTD / YTD / All). Override via `presetIds` to surface
 * a different selection (e.g. ['7d','30d','90d','1y']).
 */
/**
 * @deprecated Prefer the new `<RangePicker>` from `@/components/forms/RangePicker`.
 * It collapses the always-visible date inputs + chips + Apply button into a
 * single trigger that opens a popover with preset list + 2-month calendar.
 *
 * `DateRangeFilter` will be removed once all consumers migrate. Keep using it
 * if you specifically need the inline (non-popover) layout.
 */
export function DateRangeFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onRangeChange,
  onApply,
  presets = true,
  presetIds = DEFAULT_PRESET_IDS,
}: DateRangeFilterProps) {
  const { t } = useTranslation()

  const activeId = useMemo(
    () => matchPresetId(startDate, endDate),
    [startDate, endDate],
  )

  const handlePreset = (selection: DatePresetSelection) => {
    if (onRangeChange) {
      onRangeChange({ start: selection.start, end: selection.end })
    } else {
      onStartDateChange(selection.start)
      onEndDateChange(selection.end)
    }
    onApply?.()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 sm:px-3 py-1.5 ring-1 ring-white/[0.08] w-full sm:w-auto">
        <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0 hidden sm:block" />
        <input
          type="date"
          aria-label={t('date.range.start', 'Start date')}
          value={startDate}
          onChange={e => onStartDateChange(e.target.value)}
          className="bg-transparent text-xs text-[var(--text-primary)] outline-none [color-scheme:dark] min-w-0 flex-1 sm:flex-none"
        />
        <span className="text-gray-600 text-xs">→</span>
        <input
          type="date"
          aria-label={t('date.range.end', 'End date')}
          value={endDate}
          onChange={e => onEndDateChange(e.target.value)}
          className="bg-transparent text-xs text-[var(--text-primary)] outline-none [color-scheme:dark] min-w-0 flex-1 sm:flex-none"
        />
      </div>
      {onApply && (
        <Button type="button" size="sm" variant="primary" onClick={onApply}>
          {t('date.range.apply', 'Apply')}
        </Button>
      )}
      {presets && (
        <DatePresetChips
          presetIds={presetIds}
          activeId={activeId}
          onSelect={handlePreset}
        />
      )}
    </div>
  )
}
