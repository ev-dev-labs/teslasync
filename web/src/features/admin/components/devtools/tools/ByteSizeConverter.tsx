import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { HardDrive } from 'lucide-react'
import { Input, Select } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { cn } from '@/lib/cn'
import { fmtNumber } from '@/lib/numberFormat'
import { ToolCard } from '../ToolCard'
import { BYTE_UNITS } from '../constants'

// BYTE_UNITS is a module constant, so the option list never changes — build it
// once instead of allocating a fresh array (a new prop reference) every render.
const UNIT_OPTIONS = BYTE_UNITS.map((u) => ({ value: u, label: u }))

/**
 * ByteSizeConverterTool — converts a numeric value in a chosen binary unit
 * (B/KB/MB/GB/TB) into every other unit at once.
 *
 * The input is validated to a finite, non-negative number: NaN, ±Infinity, and
 * negative values collapse to the empty state rather than rendering misleading
 * output (an "Infinity" entry previously formatted to a bogus "0" across every
 * unit; a negative entry produced nonsensical negative sizes). Whenever there
 * is nothing valid to show, an EmptyState is rendered in place of the results
 * grid so the panel is never blank.
 */
export function ByteSizeConverterTool() {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('B')

  const conversions = useMemo(() => {
    const num = parseFloat(value)
    // Guard against NaN, ±Infinity, and negatives — a byte size is a finite,
    // non-negative quantity. `isNaN` alone let Infinity/negatives through.
    if (!Number.isFinite(num) || num < 0) return null
    const unitIdx = BYTE_UNITS.indexOf(unit as (typeof BYTE_UNITS)[number])
    if (unitIdx < 0) return null
    const bytes = num * Math.pow(1024, unitIdx)
    return BYTE_UNITS.map((u, i) => ({
      unit: u,
      value: fmtNumber(bytes / Math.pow(1024, i), i === 0 ? 0 : 4),
    }))
  }, [value, unit])

  const emptyMessage =
    value.trim() === ''
      ? t('Byte Size Empty', 'Enter a value to convert it across every unit.')
      : t('Byte Size Invalid', 'Enter a valid, non-negative number.')

  return (
    <ToolCard
      icon={HardDrive}
      color="cyan"
      title={t('Byte Size', 'Byte Size')}
      description={t('Byte Size Desc', 'Convert a value between B, KB, MB, GB, and TB.')}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t('Value')}
            placeholder="1024"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            icon={<HardDrive className="h-4 w-4" aria-hidden="true" />}
          />
          <Select label={t('Unit')} options={UNIT_OPTIONS} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        {conversions ? (
          <ul className="grid grid-cols-5 gap-2" aria-label={t('Byte Size Results', 'Converted byte sizes')}>
            {conversions.map((c) => {
              const isActive = c.unit === unit
              return (
                <li
                  key={c.unit}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'rounded px-2 py-1.5 text-center',
                    isActive ? 'bg-neon-cyan/10 ring-1 ring-neon-cyan/30' : 'bg-[var(--surface-overlay)]',
                  )}
                >
                  <p className="text-xs text-[var(--text-secondary)]">{c.unit}</p>
                  <p className="text-sm font-mono text-[var(--text-primary)]">{c.value}</p>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState message={emptyMessage} className="py-8" />
        )}
      </div>
    </ToolCard>
  )
}
