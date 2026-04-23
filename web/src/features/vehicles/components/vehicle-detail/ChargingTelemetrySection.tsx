import { useTranslation } from 'react-i18next'
import { Zap, Activity, BatteryCharging, Battery } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import { fmtNumber } from '@/lib/numberFormat'
import type { ChargingTelemetry } from '@/api/types'

interface ChargingTelemetrySectionProps {
  chargingTelemetry: ChargingTelemetry | null | undefined
}

export function ChargingTelemetrySection({ chargingTelemetry }: ChargingTelemetrySectionProps) {
  const { t } = useTranslation()

  return (
    <GlassPanel className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="h-4 w-4 text-[var(--neon-green)]" />
        <span className="text-lg font-bold text-[var(--text-primary)]">
          {t('vehicles.detail.chargingTelemetry', 'Charging Telemetry')}
        </span>
      </div>
      {chargingTelemetry ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard
            label={t('vehicles.detail.chargerPower', 'Charger Power')}
            value={
              chargingTelemetry.charger_power_kw != null
                ? `${fmtNumber(chargingTelemetry.charger_power_kw)} kW`
                : '—'
            }
            icon={<Zap className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.voltage', 'Voltage')}
            value={
              chargingTelemetry.charger_voltage != null
                ? `${fmtNumber(chargingTelemetry.charger_voltage)} V`
                : '—'
            }
            icon={<Activity className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.current', 'Current')}
            value={
              chargingTelemetry.charger_actual_current != null
                ? `${fmtNumber(chargingTelemetry.charger_actual_current)} A`
                : '—'
            }
            icon={<Activity className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.detail.energyAdded', 'Energy Added')}
            value={
              chargingTelemetry.charge_energy_added_kwh != null
                ? `${fmtNumber(chargingTelemetry.charge_energy_added_kwh)} kWh`
                : '—'
            }
            icon={<BatteryCharging className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.chargingState', 'Charging State')}
            value={chargingTelemetry.charging_state ?? '—'}
            icon={<Battery className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.batteryLevel', 'Battery Level')}
            value={
              chargingTelemetry.battery_level != null
                ? `${fmtNumber(chargingTelemetry.battery_level)}%`
                : '—'
            }
            icon={<Battery className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.chargeRate', 'Charge Rate')}
            value={
              chargingTelemetry.charge_rate_mph != null
                ? `${fmtNumber(chargingTelemetry.charge_rate_mph)} mph`
                : '—'
            }
            icon={<Activity className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.milesAdded', 'Miles Added')}
            value={
              chargingTelemetry.charge_miles_added != null
                ? `${fmtNumber(chargingTelemetry.charge_miles_added)} mi`
                : '—'
            }
            icon={<Zap className="h-4 w-4" />}
            color="purple"
          />
        </div>
      ) : (
        <EmptyState
          icon={<Zap className="h-8 w-8" />}
          message={t('vehicles.detail.noChargingTelemetry', 'No charging telemetry available')}
        />
      )}
    </GlassPanel>
  )
}
