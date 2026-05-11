import { useTranslation } from 'react-i18next'
import {
  Battery, Navigation, Car, Gauge, Thermometer, Zap, Activity,
} from 'lucide-react'

import { MetricCard } from '@/components/data-display'
import { useUnits } from '@/hooks/useUnits'
import { fmtNumber } from '@/lib/numberFormat'
import type { VehicleState, VehicleStatus } from '@/api/types'

interface QuickStatsGridProps {
  state: VehicleState
  status: VehicleStatus
}

export function QuickStatsGrid({ state, status }: QuickStatsGridProps) {
  const { t } = useTranslation()
  const { formatDistance, formatSpeed, formatTemperature } = useUnits()

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <MetricCard
        label={t('common.battery', 'Battery')}
        value={`${state.battery_level}%`}
        icon={<Battery className="h-4 w-4" />}
        color={state.battery_level > 50 ? 'green' : state.battery_level > 20 ? 'cyan' : 'cyan'}
      />
      <MetricCard
        label={t('common.range', 'Range')}
        value={formatDistance(state.rated_range, { precision: 0 })}
        icon={<Navigation className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('common.odometer', 'Odometer')}
        value={formatDistance(state.odometer, { precision: 0 })}
        icon={<Car className="h-4 w-4" />}
        color="purple"
      />
      <MetricCard
        label={t('common.speed', 'Speed')}
        value={formatSpeed(state.speed, { precision: 0 })}
        icon={<Gauge className="h-4 w-4" />}
        color="cyan"
        subtitle={state.speed > 0 ? t('common.driving', 'Driving') : t('common.parked', 'Parked')}
      />
      <MetricCard
        label={t('common.insideTemp', 'Inside Temp')}
        value={formatTemperature(state.inside_temp)}
        icon={<Thermometer className="h-4 w-4" />}
        color="green"
      />
      <MetricCard
        label={t('common.outsideTemp', 'Outside Temp')}
        value={formatTemperature(state.outside_temp)}
        icon={<Thermometer className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('common.power', 'Power')}
        value={`${fmtNumber(state.power)} kW`}
        icon={<Zap className="h-4 w-4" />}
        color="purple"
      />
      <MetricCard
        label={t('common.state', 'State')}
        value={status}
        icon={<Activity className="h-4 w-4" />}
        color="cyan"
      />
    </div>
  )
}
