import { useTranslation } from 'react-i18next'
import { Navigation, BatteryCharging, MapPin } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { RadialGauge } from '@/components/charts'
import { useUnits } from '@/hooks/useUnits'
import { fmtNumber } from '@/lib/numberFormat'
import type { VehicleState } from '@/api/types'
import { batteryColor } from './helpers'

interface BatteryRangePanelProps {
  state: VehicleState
}

export function BatteryRangePanel({ state }: BatteryRangePanelProps) {
  const { t } = useTranslation()
  const { formatDistance } = useUnits()

  return (
    <GlassPanel className="p-6">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <div className="relative">
          <RadialGauge
            value={state.battery_level}
            max={100}
            label={t('common.battery', 'Battery')}
            unit="%"
            color={batteryColor(state.battery_level)}
            size={140}
          />
        </div>
        <div className="flex-1 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricCard
            label={t('vehicles.detail.ratedRange', 'Rated Range')}
            value={formatDistance(state.rated_range, { precision: 0 })}
            icon={<Navigation className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.idealRange', 'Ideal Range')}
            value={formatDistance(state.ideal_range, { precision: 0 })}
            icon={<MapPin className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('common.charging', 'Charging')}
            value={
              state.is_charging
                ? `${formatDistance(state.charge_rate)}/h`
                : t('common.notCharging', 'Not Charging')
            }
            icon={<BatteryCharging className="h-4 w-4" />}
            color={state.is_charging ? 'green' : 'cyan'}
            subtitle={
              state.is_charging && state.time_to_full_charge > 0
                ? `${t('vehicles.detail.fullIn', 'Full in')} ${fmtNumber(state.time_to_full_charge, 1)}h`
                : undefined
            }
          />
        </div>
      </div>
    </GlassPanel>
  )
}
