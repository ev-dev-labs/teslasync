import { useTranslation } from 'react-i18next'
import { Gauge } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'
import type { TirePressureSnapshot } from '@/api/types'
import { TIRE_PRESSURE_PA, paToKpa } from '../vehicle-detail/helpers'

interface TirePressurePanelProps {
  tireData: TirePressureSnapshot | null | undefined
}

export function TirePressurePanel({ tireData }: TirePressurePanelProps) {
  const { t } = useTranslation()
  const { formatPressure } = useUnits()

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Gauge className="h-4 w-4 text-cyan-300" />{' '}
        {t('common.tirePressure', 'Tire Pressure')}
      </h3>
      {tireData ? (
        <TirePressureContent tireData={tireData} formatPressure={formatPressure} />
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
  formatPressure,
}: {
  tireData: TirePressureSnapshot
  formatPressure: (kpa: number | null | undefined) => string
}) {
  const tires = [
    { label: 'FL', pa: tireData.front_left },
    { label: 'FR', pa: tireData.front_right },
    { label: 'RL', pa: tireData.rear_left },
    { label: 'RR', pa: tireData.rear_right },
  ]

  const getColor = (pa: number | null) => {
    if (pa == null) return 'text-[var(--text-muted)]'
    if (pa < TIRE_PRESSURE_PA.LOW_CRITICAL || pa > TIRE_PRESSURE_PA.HIGH_CRITICAL) return 'text-red-400'
    if (pa < TIRE_PRESSURE_PA.LOW_WARNING || pa > TIRE_PRESSURE_PA.HIGH_WARNING) return 'text-amber-400'
    return 'text-green-400'
  }

  const getBorder = (pa: number | null) => {
    if (pa == null) return 'border-gray-600/30'
    if (pa < TIRE_PRESSURE_PA.LOW_CRITICAL || pa > TIRE_PRESSURE_PA.HIGH_CRITICAL) return 'border-red-500/30'
    if (pa < TIRE_PRESSURE_PA.LOW_WARNING || pa > TIRE_PRESSURE_PA.HIGH_WARNING) return 'border-amber-500/30'
    return 'border-green-500/30'
  }

  const allGood = tires.every(
    (t) => t.pa != null && t.pa >= TIRE_PRESSURE_PA.LOW_WARNING && t.pa <= TIRE_PRESSURE_PA.HIGH_WARNING,
  )
  const anyBad = tires.some(
    (t) => t.pa != null && (t.pa < TIRE_PRESSURE_PA.LOW_CRITICAL || t.pa > TIRE_PRESSURE_PA.HIGH_CRITICAL),
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {tires.map((t) => (
          <div
            key={t.label}
            className={cn(
              'rounded-xl border bg-white/[0.02] p-4 text-center',
              getBorder(t.pa),
            )}
          >
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t.label}</p>
            <p className={cn('text-xl font-bold font-mono', getColor(t.pa))}>
              {formatPressure(paToKpa(t.pa))}
            </p>
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
