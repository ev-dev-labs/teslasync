import { useTranslation } from 'react-i18next'
import {
  Battery, Navigation, Car, Gauge, Thermometer, Zap, Activity,
} from 'lucide-react'

import { MetricCard } from '@/components/data-display'
import { useUnits } from '@/hooks/useUnits'
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat'
import type { NeonColor } from '@/lib/tokens'
import type { VehicleState, VehicleStatus } from '@/api/types'

interface QuickStatsGridProps {
  state: VehicleState
  status: VehicleStatus
}

/**
 * Battery state-of-charge → card accent. A healthy pack (>50%) reads green,
 * a mid charge (>20%) stays neutral cyan, and a low charge (<=20%) turns red
 * so a near-empty battery is visually distinct from a comfortable one — the
 * original inline ternary collapsed both lower tiers to cyan. Unknown /
 * non-finite levels fall back to neutral cyan.
 */
export function batteryColor(level: number | null | undefined): NeonColor {
  if (!isFiniteNumber(level)) return 'cyan'
  if (level > 50) return 'green'
  if (level > 20) return 'cyan'
  return 'red'
}

/** SoC percentage for display; missing / non-finite levels render an em-dash. */
export function formatBatteryLevel(level: number | null | undefined): string {
  return isFiniteNumber(level) ? `${level}%` : '—'
}

export function QuickStatsGrid({ state, status }: QuickStatsGridProps) {
  const { t } = useTranslation()
  const { formatDistance, formatSpeed, formatTemperature } = useUnits()

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 3xl:grid-cols-8">
      <MetricCard
        label={t('common.battery', 'Battery')}
        value={formatBatteryLevel(state.battery_level)}
        icon={<Battery className="h-4 w-4" aria-hidden="true" />}
        color={batteryColor(state.battery_level)}
      />
      <MetricCard
        label={t('common.range', 'Range')}
        value={formatDistance(state.rated_range, { precision: 0 })}
        icon={<Navigation className="h-4 w-4" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('common.odometer', 'Odometer')}
        value={formatDistance(state.odometer, { precision: 0 })}
        icon={<Car className="h-4 w-4" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('common.speed', 'Speed')}
        value={formatSpeed(state.speed, { precision: 0 })}
        icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
        color="cyan"
        subtitle={state.speed > 0 ? t('common.driving', 'Driving') : t('common.parked', 'Parked')}
      />
      <MetricCard
        label={t('common.insideTemp', 'Inside Temp')}
        value={formatTemperature(state.inside_temp)}
        icon={<Thermometer className="h-4 w-4" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('common.outsideTemp', 'Outside Temp')}
        value={formatTemperature(state.outside_temp)}
        icon={<Thermometer className="h-4 w-4" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('common.power', 'Power')}
        value={isFiniteNumber(state.power) ? `${fmtNumber(state.power)} kW` : '—'}
        icon={<Zap className="h-4 w-4" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('common.state', 'State')}
        value={status || '—'}
        icon={<Activity className="h-4 w-4" aria-hidden="true" />}
        color="cyan"
      />
    </div>
  )
}
