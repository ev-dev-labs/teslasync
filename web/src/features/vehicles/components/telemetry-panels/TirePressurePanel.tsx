import { useTranslation } from 'react-i18next'
import { Gauge } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { useSettings } from '@/hooks/useSettings'
import { fmtNumber } from '@/lib/numberFormat'
import type { TirePressureSnapshot } from '@/api/types'

interface TirePressurePanelProps {
  tireData: TirePressureSnapshot | null | undefined
}

export function TirePressurePanel({ tireData }: TirePressurePanelProps) {
  const { t } = useTranslation()
  const { convertPressure, pressureUnit } = useSettings()

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Gauge className="h-4 w-4 text-neon-cyan" />{' '}
        {t('common.tirePressure', 'Tire Pressure')}
      </h3>
      {tireData ? (
        <TirePressureContent
          tireData={tireData}
          convertPressure={convertPressure}
          pressureUnit={pressureUnit}
        />
      ) : (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">
          No tire pressure data available
        </p>
      )}
    </GlassPanel>
  )
}

function TirePressureContent({
  tireData,
  convertPressure,
  pressureUnit,
}: {
  tireData: TirePressureSnapshot
  convertPressure: (bar: number) => number
  pressureUnit: string
}) {
  const toDisplay = (bar: number | null) => (bar != null ? convertPressure(bar) : null)
  const tires = [
    { label: 'FL', pressure: toDisplay(tireData.front_left) },
    { label: 'FR', pressure: toDisplay(tireData.front_right) },
    { label: 'RL', pressure: toDisplay(tireData.rear_left) },
    { label: 'RR', pressure: toDisplay(tireData.rear_right) },
  ]

  const getColor = (val: number | null) => {
    if (val == null) return 'text-[var(--text-muted)]'
    const lowCrit = convertPressure(2.068)
    const lowWarn = convertPressure(2.413)
    const highWarn = convertPressure(3.103)
    const highCrit = convertPressure(3.447)
    if (val < lowCrit || val > highCrit) return 'text-red-400'
    if (val < lowWarn || val > highWarn) return 'text-amber-400'
    return 'text-green-400'
  }

  const getBorder = (val: number | null) => {
    if (val == null) return 'border-gray-600/30'
    const lowCrit = convertPressure(2.068)
    const lowWarn = convertPressure(2.413)
    const highWarn = convertPressure(3.103)
    const highCrit = convertPressure(3.447)
    if (val < lowCrit || val > highCrit) return 'border-red-500/30'
    if (val < lowWarn || val > highWarn) return 'border-amber-500/30'
    return 'border-green-500/30'
  }

  const lowWarn = convertPressure(2.413)
  const highWarn = convertPressure(3.103)
  const allGood = tires.every(
    (t) => t.pressure != null && t.pressure >= lowWarn && t.pressure <= highWarn,
  )
  const lowCrit = convertPressure(2.068)
  const highCrit = convertPressure(3.447)
  const anyBad = tires.some(
    (t) => t.pressure != null && (t.pressure < lowCrit || t.pressure > highCrit),
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {tires.map((t) => (
          <div
            key={t.label}
            className={cn(
              'rounded-xl border bg-white/[0.02] p-4 text-center',
              getBorder(t.pressure),
            )}
          >
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t.label}</p>
            <p className={cn('text-xl font-bold font-mono', getColor(t.pressure))}>
              {t.pressure != null ? fmtNumber(t.pressure) : '—'}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">{pressureUnit}</p>
          </div>
        ))}
      </div>
      <div className="text-center">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
            allGood
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : anyBad
                ? 'border-red-500/30 bg-red-500/10 text-red-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-400',
          )}
        >
          {allGood ? '✓ All Normal' : anyBad ? '✗ Attention Needed' : '⚠ Check Pressure'}
        </span>
      </div>
    </div>
  )
}
