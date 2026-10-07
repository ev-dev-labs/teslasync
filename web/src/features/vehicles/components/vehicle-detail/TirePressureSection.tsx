import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleDot } from 'lucide-react'

import { GlassPanel, Badge, PanelTitle, Text } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { useUnits } from '@/hooks/useUnits'
import type { TirePressureSnapshot } from '@/api/types'
import { paToKpa, tirePressureStatus, tirePressureVariant } from './helpers'

interface TirePressureSectionProps {
  tireData: TirePressureSnapshot | null | undefined
}

export function TirePressureSection({ tireData }: TirePressureSectionProps) {
  const { t } = useTranslation()
  const { formatPressure } = useUnits()

  const tirePressures = useMemo(
    () =>
      tireData
        ? [
            { label: t('vehicles.detail.tireFl', 'Front Left'), value: tireData.front_left },
            { label: t('vehicles.detail.tireFr', 'Front Right'), value: tireData.front_right },
            { label: t('vehicles.detail.tireRl', 'Rear Left'), value: tireData.rear_left },
            { label: t('vehicles.detail.tireRr', 'Rear Right'), value: tireData.rear_right },
          ]
        : [],
    [tireData, t],
  )

  // Directional label so an over-inflated tyre reads "High", not "Low".
  const statusLabel = useCallback(
    (value: number | null | undefined): string => {
      switch (tirePressureStatus(value)) {
        case 'normal':
          return t('common.normal', 'Normal')
        case 'low':
          return t('common.low', 'Low')
        case 'high':
          return t('common.high', 'High')
        case 'critical-low':
        case 'critical-high':
          return t('common.critical', 'Critical')
        default:
          return t('common.noData', 'No Data')
      }
    },
    [t],
  )

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <CircleDot className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('vehicles.detail.tirePressure', 'Tire Pressure')}
      </PanelTitle>
      {tireData ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {tirePressures.map((tp) => (
            <GlassPanel key={tp.label} className="p-4 text-center">
              <Text as="p" variant="caption" className="mb-1">{tp.label}</Text>
              <Text as="p" size="2xl" weight="bold" color="primary" className="tabular-nums">
                {formatPressure(paToKpa(tp.value))}
              </Text>
              <Badge
                variant={tirePressureVariant(tp.value)}
                size="sm"
                className="mt-2"
              >
                {statusLabel(tp.value)}
              </Badge>
            </GlassPanel>
          ))}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<CircleDot className="h-8 w-8" />}
          message={t('vehicles.detail.noTireData', 'No tire pressure data available')}
        />
      )}
    </GlassPanel>
  )
}
