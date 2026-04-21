import { useTranslation } from 'react-i18next'
import { Zap, Activity, BatteryCharging, Battery, Clock } from 'lucide-react'

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
            label={t('vehicles.detail.dcPower', 'DC Power')}
            value={chargingTelemetry.dc_charging_power != null ? `${fmtNumber(chargingTelemetry.dc_charging_power)} kW` : '—'}
            icon={<Zap className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.voltage', 'Voltage')}
            value={chargingTelemetry.charger_voltage != null ? `${fmtNumber(chargingTelemetry.charger_voltage)} V` : '—'}
            icon={<Activity className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.current', 'Current')}
            value={chargingTelemetry.charge_amps != null ? `${fmtNumber(chargingTelemetry.charge_amps)} A` : '—'}
            icon={<Activity className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.detail.energyAdded', 'Energy Added')}
            value={chargingTelemetry.dc_charging_energy_in != null ? `${fmtNumber(chargingTelemetry.dc_charging_energy_in)} kWh` : '—'}
            icon={<BatteryCharging className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.chargeState', 'Charge State')}
            value={chargingTelemetry.charge_state ?? '—'}
            icon={<Battery className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.soc', 'SOC')}
            value={chargingTelemetry.soc != null ? `${fmtNumber(chargingTelemetry.soc)}%` : '—'}
            icon={<Battery className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.timeToFull', 'Time to Full')}
            value={chargingTelemetry.time_to_full_charge != null ? `${fmtNumber(chargingTelemetry.time_to_full_charge, 1)}h` : '—'}
            icon={<Clock className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.packVoltage', 'Pack Voltage')}
            value={chargingTelemetry.pack_voltage != null ? `${fmtNumber(chargingTelemetry.pack_voltage)} V` : '—'}
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
