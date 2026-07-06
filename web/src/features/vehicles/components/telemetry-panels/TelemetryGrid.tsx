import { useTranslation } from 'react-i18next'
import {
  Battery, Gauge, Thermometer, Navigation, BatteryCharging, Eye,
} from 'lucide-react'
import { StaggerContainer, StaggerItem } from '@/components/motion'
import { useUnits } from '@/hooks/useUnits'
import { fmtInt, fmtNumber } from '@/lib/numberFormat'
import { InfoTile } from './InfoTile'
import type { VehicleState } from '@/api/types'

interface TelemetryGridProps {
  state: VehicleState
}

export function TelemetryGrid({ state }: TelemetryGridProps) {
  const { t } = useTranslation()
  const { formatDistance, formatSpeed, formatTemperature } = useUnits()

  return (
    <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <StaggerItem>
        <InfoTile
          icon={Battery}
          label={t('common.battery', 'Battery')}
          value={`${fmtInt(state.battery_level)}%`}
          color={
            state.battery_level > 50
              ? 'text-emerald-300'
              : state.battery_level > 20
                ? 'text-amber-300'
                : 'text-rose-300'
          }
          sub={`${formatDistance(state.rated_range)} ${t('common.range', 'range')}`}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Gauge}
          label={t('common.speed', 'Speed')}
          value={formatSpeed(state.speed)}
          sub={state.speed > 0 ? t('common.driving', 'Driving') : t('common.parked', 'Parked')}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Thermometer}
          label={t('common.inside', 'Inside')}
          value={formatTemperature(state.inside_temp)}
          sub={`${t('common.outside', 'Outside')}: ${formatTemperature(state.outside_temp)}`}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Navigation}
          label={t('common.odometer', 'Odometer')}
          value={formatDistance(state.odometer, { precision: 0 })}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={BatteryCharging}
          label={t('common.charger', 'Charger')}
          value={
            state.is_charging
              ? `${fmtInt(state.charger_power)} kW`
              : t('common.notCharging', 'Not Charging')
          }
          color={state.is_charging ? 'text-emerald-300' : 'text-[var(--text-muted)]'}
          sub={
            state.is_charging && state.time_to_full_charge != null && state.time_to_full_charge > 0
              ? t('telemetry.fullInHours', 'Full in {{hours}}h', {
                  hours: fmtNumber(state.time_to_full_charge, 1),
                })
              : undefined
          }
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Eye}
          label={t('common.sentry', 'Sentry')}
          value={state.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off')}
          color={state.sentry_mode ? 'text-rose-300' : 'text-[var(--text-muted)]'}
        />
      </StaggerItem>
    </StaggerContainer>
  )
}
