import { useTranslation } from 'react-i18next'
import { Zap, Activity, BatteryCharging, Battery } from 'lucide-react'

import { GlassPanel, PanelTitle } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import { fmtNumber } from '@/lib/numberFormat'
import { useUnits } from '@/hooks/useUnits'
import type { ChargingTelemetry } from '@/api/types'

interface ChargingTelemetrySectionProps {
  chargingTelemetry: ChargingTelemetry | null | undefined
}

export function ChargingTelemetrySection({ chargingTelemetry }: ChargingTelemetrySectionProps) {
  const { t } = useTranslation()
  const { formatDistance, formatSpeed, formatPower, formatEnergy } = useUnits()

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Zap className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {t('vehicles.detail.chargingTelemetry', 'Charging Telemetry')}
      </PanelTitle>
      {chargingTelemetry ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 3xl:grid-cols-8">
          <MetricCard
            label={t('vehicles.detail.chargerPower', 'Charger Power')}
            value={
              chargingTelemetry.charger_power_w != null
                ? formatPower(chargingTelemetry.charger_power_w)
                : '—'
            }
            icon={<Zap className="h-4 w-4" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.voltage', 'Voltage')}
            value={
              chargingTelemetry.charger_voltage != null
                ? `${fmtNumber(chargingTelemetry.charger_voltage)} V`
                : '—'
            }
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.current', 'Current')}
            value={
              chargingTelemetry.charger_actual_current != null
                ? `${fmtNumber(chargingTelemetry.charger_actual_current)} A`
                : '—'
            }
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.detail.energyAdded', 'Energy Added')}
            value={
              chargingTelemetry.charge_energy_added_wh != null
                ? formatEnergy(chargingTelemetry.charge_energy_added_wh)
                : '—'
            }
            icon={<BatteryCharging className="h-4 w-4" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.chargingState', 'Charging State')}
            value={chargingTelemetry.charging_state ?? '—'}
            icon={<Battery className="h-4 w-4" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.batteryLevel', 'Battery Level')}
            value={
              chargingTelemetry.battery_level != null
                ? `${fmtNumber(chargingTelemetry.battery_level)}%`
                : '—'
            }
            icon={<Battery className="h-4 w-4" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.chargeRate', 'Charge Rate')}
            value={
              chargingTelemetry.range_added_meters_per_hour != null
                ? formatSpeed(chargingTelemetry.range_added_meters_per_hour / 3600)
                : '—'
            }
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.rangeAdded', 'Range Added')}
            value={
              chargingTelemetry.range_added_meters != null
                ? formatDistance(chargingTelemetry.range_added_meters)
                : '—'
            }
            icon={<Zap className="h-4 w-4" aria-hidden="true" />}
            color="purple"
          />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Zap className="h-8 w-8" aria-hidden="true" />}
          message={t('vehicles.detail.noChargingTelemetry', 'No charging telemetry available')}
        />
      )}
    </GlassPanel>
  )
}
