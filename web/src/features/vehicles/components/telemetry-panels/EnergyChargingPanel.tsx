import { useTranslation } from 'react-i18next'
import { BatteryCharging, Zap } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
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
        <BatteryCharging className="h-4 w-4 text-neon-cyan" /> {t('telemetry.energyCharging', 'Energy & Charging')}
      </h3>
      {chargingTelemetry ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="Pack Voltage"
              value={
                chargingTelemetry.pack_voltage != null
                  ? fmtNumber(chargingTelemetry.pack_voltage)
                  : '—'
              }
              subtitle="V"
            />
            <MetricCard
              label="Pack Current"
              value={
                chargingTelemetry.pack_current != null
                  ? fmtNumber(chargingTelemetry.pack_current)
                  : '—'
              }
              subtitle="A"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">Energy Remaining</span>
            <span className="text-sm font-mono text-[var(--text-primary)]">
              {chargingTelemetry.energy_remaining != null
                ? `${fmtWithUnit(chargingTelemetry.energy_remaining, 'kWh')}`
                : '—'}
            </span>
          </div>

          {/* BMS State */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">BMS State</span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                chargingTelemetry.bms_state === 'Standby'
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : chargingTelemetry.bms_state === 'Charge'
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
                    : chargingTelemetry.bms_state === 'Fault'
                      ? 'border-red-500/30 bg-red-500/10 text-red-400'
                      : 'border-gray-500/30 bg-gray-500/10 text-[var(--text-muted)]',
              )}
            >
              {chargingTelemetry.bms_state ?? 'Unknown'}
            </span>
          </div>

          {/* Cell voltage spread */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">Cell Voltage Spread</span>
            <span
              className={cn(
                'text-sm font-mono',
                chargingTelemetry.brick_voltage_max != null &&
                  chargingTelemetry.brick_voltage_min != null &&
                  chargingTelemetry.brick_voltage_max -
                    chargingTelemetry.brick_voltage_min >
                    0.05
                  ? 'text-amber-400'
                  : 'text-[var(--text-primary)]',
              )}
            >
              {chargingTelemetry.brick_voltage_max != null &&
              chargingTelemetry.brick_voltage_min != null
                ? `${fmtWithUnit((chargingTelemetry.brick_voltage_max - chargingTelemetry.brick_voltage_min) * 1000, 'mV')}`
                : '—'}
            </span>
          </div>

          {/* Battery heater */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">Battery Heater</span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border',
                chargingTelemetry.battery_heater_on
                  ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
                  : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
              )}
            >
              <Zap className="h-3 w-3" />{' '}
              {chargingTelemetry.battery_heater_on ? 'Active' : 'Off'}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">
          No charging telemetry available
        </p>
      )}
    </GlassPanel>
  )
}
