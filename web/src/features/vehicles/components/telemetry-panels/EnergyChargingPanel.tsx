import { useTranslation } from 'react-i18next'
import { BatteryCharging, Zap } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import { fmtNumber, fmtWithUnit } from '@/lib/numberFormat'
import type { ChargingTelemetry } from '@/api/types'

interface EnergyChargingPanelProps {
  chargingTelemetry: ChargingTelemetry | null | undefined
}

export function EnergyChargingPanel({ chargingTelemetry }: EnergyChargingPanelProps) {
  const { t } = useTranslation()

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <BatteryCharging className="h-4 w-4 text-cyan-300" />{' '}
        {t('telemetry.energyCharging', 'Energy & Charging')}
      </h3>
      {chargingTelemetry ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label={t('telemetry.chargerVoltage', 'Charger Voltage')}
              value={
                chargingTelemetry.charger_voltage != null
                  ? fmtNumber(chargingTelemetry.charger_voltage)
                  : '—'
              }
              subtitle="V"
            />
            <MetricCard
              label={t('telemetry.chargerCurrent', 'Charger Current')}
              value={
                chargingTelemetry.charger_actual_current != null
                  ? fmtNumber(chargingTelemetry.charger_actual_current)
                  : '—'
              }
              subtitle="A"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('telemetry.chargerPower', 'Charger Power')}
            </span>
            <span className="text-sm font-mono text-[var(--text-primary)]">
              {chargingTelemetry.charger_power_kw != null
                ? `${fmtWithUnit(chargingTelemetry.charger_power_kw, 'kW')}`
                : '—'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('telemetry.energyAdded', 'Energy Added')}
            </span>
            <span className="text-sm font-mono text-[var(--text-primary)]">
              {chargingTelemetry.charge_energy_added_kwh != null
                ? `${fmtWithUnit(chargingTelemetry.charge_energy_added_kwh, 'kWh')}`
                : '—'}
            </span>
          </div>

          {/* Charging State */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('telemetry.chargingState', 'Charging State')}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                chargingTelemetry.charging_state === 'Charging'
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
                  : chargingTelemetry.charging_state === 'Complete'
                    ? 'border-green-500/30 bg-green-500/10 text-green-400'
                    : 'border-gray-500/30 bg-gray-500/10 text-[var(--text-muted)]',
              )}
            >
              {chargingTelemetry.charging_state ?? t('common.unknown', 'Unknown')}
            </span>
          </div>

          {/* Battery level */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('telemetry.batteryLevel', 'Battery Level')}
            </span>
            <span className="text-sm font-mono text-[var(--text-primary)]">
              {chargingTelemetry.battery_level != null
                ? `${fmtNumber(chargingTelemetry.battery_level)}%`
                : '—'}
            </span>
          </div>

          {/* Charge rate */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
              <Zap className="h-3 w-3" /> {t('telemetry.chargeRate', 'Charge Rate')}
            </span>
            <span className="text-sm font-mono text-[var(--text-primary)]">
              {chargingTelemetry.charge_rate_mph != null
                ? `${fmtNumber(chargingTelemetry.charge_rate_mph)} mph`
                : '—'}
            </span>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          message={t('telemetry.noChargingTelemetry', 'No charging telemetry available')}
        />
      )}
    </GlassPanel>
  )
}
