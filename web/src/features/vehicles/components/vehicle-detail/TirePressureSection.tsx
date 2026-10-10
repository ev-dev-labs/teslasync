import { useTranslation } from 'react-i18next'
import { CircleDot } from 'lucide-react'
import { Badge } from '@/components/ui'
import { OperationalBrief, type StatMetric } from '@/components/data-display'
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics'
import { EmptyState } from '@/components/feedback'
import type { TirePressureSnapshot } from '@/api/types'
import { paToKpa, tirePressureStatus, tirePressureVariant } from './helpers'
import { useVehicleDetailSummary, type VehicleDetailSummaryProps } from '../statstrip-vehicle-detail/useVehicleDetailSummary'

interface TirePressureSectionProps extends VehicleDetailSummaryProps {
  tireData: TirePressureSnapshot | null | undefined
}

export function TirePressureSection({ tireData, sourceQuery }: TirePressureSectionProps) {
  const { t } = useTranslation()
  const summary = useVehicleDetailSummary(t('vehicles.detail.tirePressure', 'Tire pressure'), sourceQuery, tireData?.created_at, tireData != null)
  const corners = [
    { id: 'front-left', label: t('vehicles.detail.tireFl', 'Front left'), value: tireData?.front_left },
    { id: 'front-right', label: t('vehicles.detail.tireFr', 'Front right'), value: tireData?.front_right },
    { id: 'rear-left', label: t('vehicles.detail.tireRl', 'Rear left'), value: tireData?.rear_left },
    { id: 'rear-right', label: t('vehicles.detail.tireRr', 'Rear right'), value: tireData?.rear_right },
  ]
  const statusLabel = (value: number | null | undefined): string => {
    switch (tirePressureStatus(value)) {
      case 'normal': return t('common.normal', 'Normal')
      case 'low': return t('common.low', 'Low')
      case 'high': return t('common.high', 'High')
      case 'critical-low':
      case 'critical-high': return t('common.critical', 'Critical')
      default: return t('common.noData', 'No data')
    }
  }

  const rawMetrics: readonly StatMetric[] = corners.map(corner => ({
        metricId: 'pressure', occurrenceId: corner.id, label: corner.label,
        rawValue: paToKpa(corner.value),
        missingReason: paToKpa(corner.value) == null ? t('common.noDataAvailable', 'No data available') : undefined,
        context: <Badge variant={tirePressureVariant(corner.value)} size="sm">{statusLabel(corner.value)}</Badge>,
  }))
  const metrics = useOperationalMetrics(rawMetrics)
  return (
    <>
      <OperationalBrief compact testId="vehicle-tire-pressure-summary" {...summary.brief}
        eyebrow={t('vehicles.detail.systems', 'Vehicle systems')}
        title={t('vehicles.detail.tirePressure', 'Tire pressure')}
        description={t('vehicles.detail.brief.tireDescription', 'Four corner pressures with source-derived low, normal, high or critical status and explicit missing-data reasons.')}
        metrics={metrics} />
      {!tireData && (
        // no-action: the independent source wrapper owns failure retry.
        <EmptyState icon={<CircleDot className="h-8 w-8" aria-hidden="true" />}
          message={t('vehicles.detail.noTireData', 'No tire pressure data available')} />
      )}
    </>
  )
}
