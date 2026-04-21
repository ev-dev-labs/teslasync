import { useTranslation } from 'react-i18next'
import { CircleDot } from 'lucide-react'

import { GlassPanel, Badge } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { useSettings } from '@/hooks/useSettings'
import { fmtNumber } from '@/lib/numberFormat'
import type { TirePressureSnapshot } from '@/api/types'
import { tirePressureVariant } from './helpers'

interface TirePressureSectionProps {
  tireData: TirePressureSnapshot | null | undefined
}

export function TirePressureSection({ tireData }: TirePressureSectionProps) {
  const { t } = useTranslation()
  const { convertPressure, pressureUnit } = useSettings()

  const tirePressures = tireData
    ? [
        { label: t('vehicles.detail.tireFl', 'Front Left'), value: tireData.front_left },
        { label: t('vehicles.detail.tireFr', 'Front Right'), value: tireData.front_right },
        { label: t('vehicles.detail.tireRl', 'Rear Left'), value: tireData.rear_left },
        { label: t('vehicles.detail.tireRr', 'Rear Right'), value: tireData.rear_right },
      ]
    : []

  return (
    <GlassPanel className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <CircleDot className="h-4 w-4 text-[var(--neon-cyan)]" />
        <span className="text-lg font-bold text-[var(--text-primary)]">
          {t('vehicles.detail.tirePressure', 'Tire Pressure')}
        </span>
      </div>
      {tireData ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {tirePressures.map((tp) => (
            <GlassPanel key={tp.label} className="p-4 text-center">
              <p className="text-xs text-[var(--text-muted)] mb-1">{tp.label}</p>
              <p className="text-2xl font-bold text-[var(--text-primary)]">
                {tp.value != null ? fmtNumber(convertPressure(tp.value)) : '—'}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{pressureUnit}</p>
              <Badge
                variant={tirePressureVariant(tp.value)}
                size="sm"
                className="mt-2"
              >
                {tp.value != null
                  ? tp.value >= 2.5 && tp.value <= 3.5
                    ? t('common.normal', 'Normal')
                    : tp.value >= 2.0
                      ? t('common.low', 'Low')
                      : t('common.critical', 'Critical')
                  : t('common.noData', 'No Data')}
              </Badge>
            </GlassPanel>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<CircleDot className="h-8 w-8" />}
          message={t('vehicles.detail.noTireData', 'No tire pressure data available')}
        />
      )}
    </GlassPanel>
  )
}
