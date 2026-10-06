import { useTranslation } from 'react-i18next'
import { Navigation, BatteryCharging, MapPin } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { OperationalBrief, type StatMetric } from '@/components/data-display'
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics'
import { LinearGauge } from '@/components/charts'
import { useUnits } from '@/hooks/useUnits'

import type { VehicleState } from '@/api/types'
import { batteryColor } from './helpers'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useVehicleDetailSummary, type VehicleDetailSummaryProps } from '../statstrip-vehicle-detail/useVehicleDetailSummary'

interface BatteryRangePanelProps extends VehicleDetailSummaryProps {
  state: VehicleState | undefined
}

export function BatteryRangePanel({ state, sourceQuery }: BatteryRangePanelProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation()
  const { formatDistance } = useUnits()
  const summary = useVehicleDetailSummary(t('vehicles.detail.liveStateResource', 'Live vehicle state'), sourceQuery, null, state != null)

  // The shared gauge owns missing geometry; do not invent a measured 0%.
  const batteryLevel = state?.battery_level
  const isCharging = state?.is_charging
  const timeToFull = state?.time_to_full_charge
  const chargeSubtitle =
    isCharging && timeToFull != null && Number.isFinite(timeToFull) && timeToFull > 0
      ? `${t('vehicles.detail.fullIn', 'Full in')} ${fmtNumber(timeToFull)}h`
      : undefined

  const rawMetrics: readonly StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'rated-range', label: t('vehicles.detail.ratedRange', 'Rated range'),
      rawValue: state?.rated_range, context: <Navigation aria-hidden="true" className="h-4 w-4" /> },
    { metricId: 'distance', occurrenceId: 'ideal-range', label: t('vehicles.detail.idealRange', 'Ideal range'),
      rawValue: state?.ideal_range, context: <MapPin aria-hidden="true" className="h-4 w-4" /> },
    { metricId: 'status', label: t('common.charging', 'Charging'),
      rawValue: isCharging == null ? null : isCharging
        ? t('common.charging', 'Charging') : t('common.notCharging', 'Not charging'),
      context: <div className="space-y-1">
        <BatteryCharging aria-hidden="true" className="h-4 w-4" />
        {isCharging && <span>{`${formatDistance(state?.charge_rate)}/h`}</span>}
        {chargeSubtitle && <span className="block">{chargeSubtitle}</span>}
      </div> },
  ]
  const metrics = useOperationalMetrics(rawMetrics)
  return (
    <GlassPanel className="p-6">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <div className="relative">
          <LinearGauge
            value={batteryLevel}
            max={100}
            label={t('common.battery', 'Battery')}
            unit="%"
            color={batteryColor(batteryLevel ?? NaN)}
            size={140}
          />
        </div>
        <OperationalBrief compact testId="vehicle-live-overview-summary"
          className="w-full min-w-0 flex-1" {...summary.brief}
          eyebrow={t('vehicles.detail.overview', 'Live overview')}
          title={t('vehicles.detail.brief.overviewTitle', 'Range and charging')}
          description={t('vehicles.detail.brief.overviewDescription', 'Rated and ideal range with the reported charging state, range-added rate and available time-to-full estimate.')}
          metrics={metrics} />
      </div>
    </GlassPanel>
  )
}
