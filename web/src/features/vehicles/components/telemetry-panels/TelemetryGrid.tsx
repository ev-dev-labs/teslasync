import { useTranslation } from 'react-i18next'
import {
  Battery, Gauge, Thermometer, Navigation, BatteryCharging, Eye,
} from 'lucide-react'
import { StaggerContainer, StaggerItem } from '@/components/motion'
import { useSettings } from '@/hooks/useSettings'
import { fmtNumber, fmtInt } from '@/lib/numberFormat'
import { InfoTile } from './InfoTile'
import type { VehicleState } from '@/api/types'

interface TelemetryGridProps {
  state: VehicleState
}

export function TelemetryGrid({ state }: TelemetryGridProps) {
  const { t } = useTranslation()
  const { convertDistance, convertSpeed, convertTemp, distanceUnit, speedUnit, tempUnit } =
    useSettings()

  return (
    <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <StaggerItem>
        <InfoTile
          icon={Battery}
          label={t('common.battery', 'Battery')}
          value={`${fmtInt(state.battery_level)}%`}
          color={
            state.battery_level > 50
              ? 'text-neon-green'
              : state.battery_level > 20
                ? 'text-neon-amber'
                : 'text-neon-red'
          }
          sub={`${fmtNumber(convertDistance(state.rated_range))} ${distanceUnit} range`}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Gauge}
          label={t('common.speed', 'Speed')}
          value={`${fmtNumber(convertSpeed(state.speed))} ${speedUnit}`}
          sub={state.speed > 0 ? 'Driving' : 'Parked'}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Thermometer}
          label={t('common.inside', 'Inside')}
          value={`${fmtNumber(convertTemp(state.inside_temp))}${tempUnit}`}
          sub={`Outside: ${fmtNumber(convertTemp(state.outside_temp))}${tempUnit}`}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Navigation}
          label={t('common.odometer', 'Odometer')}
          value={`${fmtInt(convertDistance(state.odometer))} ${distanceUnit}`}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={BatteryCharging}
          label={t('common.charger', 'Charger')}
          value={state.is_charging ? `${fmtInt(state.charger_power)} kW` : 'Not charging'}
          color={state.is_charging ? 'text-neon-green' : 'text-[var(--text-muted)]'}
          sub={
            state.is_charging && state.time_to_full_charge != null
              ? `Full in ${fmtNumber(state.time_to_full_charge)}h`
              : undefined
          }
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Eye}
          label={t('common.sentry', 'Sentry')}
          value={state.sentry_mode ? 'Active' : 'Off'}
          color={state.sentry_mode ? 'text-neon-red' : 'text-[var(--text-muted)]'}
        />
      </StaggerItem>
    </StaggerContainer>
  )
}
