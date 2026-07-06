import { useTranslation } from 'react-i18next'
import { Gauge } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { useUnits } from '@/hooks/useUnits'
import type { TirePressureSnapshot } from '@/api/types'
import { paToKpa, tirePressureVariant } from '../vehicle-detail/helpers'

interface TirePressurePanelProps {
  tireData: TirePressureSnapshot | null | undefined
}

type TireVariant = ReturnType<typeof tirePressureVariant>

/** Big-number text colour per SI-derived tire-pressure severity band. */
const VARIANT_TEXT: Record<TireVariant, string> = {
  neutral: 'text-[var(--text-muted)]',
  danger: 'text-red-400',
  warning: 'text-amber-400',
  success: 'text-green-400',
}

/** Tile border colour per SI-derived tire-pressure severity band. */
const VARIANT_BORDER: Record<TireVariant, string> = {
  neutral: 'border-gray-600/30',
  danger: 'border-red-500/30',
  warning: 'border-amber-500/30',
  success: 'border-green-500/30',
}

export function TirePressurePanel({ tireData }: TirePressurePanelProps) {
  const { t } = useTranslation()
  const { formatPressure } = useUnits()

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />{' '}
        {t('common.tirePressure', 'Tire Pressure')}
      </h3>
      {tireData ? (
        <TirePressureContent tireData={tireData} formatPressure={formatPressure} />
      ) : (
        <EmptyState
          message={t('telemetry.noTirePressureData', 'No tire pressure data available')}
        />
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
  const { t } = useTranslation()

  const tires = [
    { label: 'FL', position: t('telemetry.tireFrontLeft', 'Front left'), pa: tireData.front_left },
    { label: 'FR', position: t('telemetry.tireFrontRight', 'Front right'), pa: tireData.front_right },
    { label: 'RL', position: t('telemetry.tireRearLeft', 'Rear left'), pa: tireData.rear_left },
    { label: 'RR', position: t('telemetry.tireRearRight', 'Rear right'), pa: tireData.rear_right },
  ]

  const variants = tires.map((tire) => tirePressureVariant(tire.pa))
  const allGood = variants.every((v) => v === 'success')
  const anyBad = variants.some((v) => v === 'danger')

  const status = allGood
    ? {
        glyph: '✓',
        label: t('telemetry.tireAllNormal', 'All Normal'),
        className: 'border-green-500/30 bg-green-500/10 text-green-400',
      }
    : anyBad
      ? {
          glyph: '✗',
          label: t('telemetry.tireAttentionNeeded', 'Attention Needed'),
          className: 'border-red-500/30 bg-red-500/10 text-red-400',
        }
      : {
          glyph: '⚠',
          label: t('telemetry.tireCheckPressure', 'Check Pressure'),
          className: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
        }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {tires.map((tire, i) => {
          const variant = variants[i]
          const display = formatPressure(paToKpa(tire.pa))
          return (
            <div
              key={tire.label}
              role="group"
              aria-label={tire.position}
              className={cn(
                'rounded-xl border bg-white/[0.02] p-4 text-center',
                VARIANT_BORDER[variant],
              )}
            >
              <p className="text-2xs text-[var(--text-muted)] mb-1" aria-hidden="true">
                {tire.label}
              </p>
              <p className={cn('text-xl font-bold font-mono', VARIANT_TEXT[variant])}>
                {display}
              </p>
            </div>
          )
        })}
      </div>
      <div className="text-center">
        <span
          role="status"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border',
            status.className,
          )}
        >
          <span aria-hidden="true">{status.glyph}</span>
          {status.label}
        </span>
      </div>
    </div>
  )
}
