import { useTranslation } from 'react-i18next'
import { Thermometer, Fan, Snowflake, Zap } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import { useUnits } from '@/hooks/useUnits'
import type { ClimateSnapshot } from '@/api/types'

/**
 * Fan-speed bar geometry. Hoisted to module scope so the array + width
 * lookup aren't re-allocated on every render (this panel sits on the live
 * telemetry hot path) and the width classes stay statically visible to
 * Tailwind's JIT.
 */
const FAN_LEVELS: ReadonlyArray<{ level: number; widthClass: string }> = [
  { level: 1, widthClass: 'w-1.5' },
  { level: 2, widthClass: 'w-2' },
  { level: 3, widthClass: 'w-2.5' },
  { level: 4, widthClass: 'w-3' },
  { level: 5, widthClass: 'w-3.5' },
  { level: 6, widthClass: 'w-4' },
]

/** Discrete fan-speed step count — also the accessible meter's aria-valuemax. */
const FAN_MAX = FAN_LEVELS.length

interface ClimatePanelProps {
  climateData: ClimateSnapshot | null | undefined
}

export function ClimatePanel({ climateData }: ClimatePanelProps) {
  const { t } = useTranslation()
  const { formatTemperature } = useUnits()

  // Derived, null-safe view state. Computed unconditionally (all cheap) so
  // the panel shell + heading render identically whether or not telemetry
  // is present. `fanForMeter` is clamped into [0, FAN_MAX] for a spec-valid
  // aria-valuenow while `aria-valuetext` still surfaces the raw reading.
  const fan = climateData?.fan_status ?? 0
  const fanForMeter = Math.max(0, Math.min(FAN_MAX, fan))
  const defrostActive = Boolean(
    climateData?.defrost_mode && climateData.defrost_mode !== 'Off',
  )
  const climateOn = Boolean(climateData?.is_climate_on)
  const preconditioning = Boolean(climateData?.is_preconditioning)
  const hvacState =
    climateData?.hvac_state && climateData.hvac_state.trim().length > 0
      ? climateData.hvac_state
      : '—'

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Thermometer aria-hidden="true" className="h-4 w-4 text-cyan-300" /> {t('common.climate', 'Climate')}
      </h3>
      {climateData ? (
        <div className="space-y-4">
          {/* Cabin + Outside temps */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label={t('common.insideTemp', 'Cabin')}
              value={formatTemperature(climateData.inside_temp_c)}
            />
            <MetricCard
              label={t('common.outsideTemp', 'Outside')}
              value={formatTemperature(climateData.outside_temp_c)}
            />
          </div>

          {/* Target temps */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">
                {t('telemetry.driverSetpoint', 'Driver Setpoint')}
              </span>
              <span className="text-sm font-mono text-[var(--text-primary)]">
                {formatTemperature(climateData.driver_setpoint_c)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">
                {t('telemetry.passengerSetpoint', 'Passenger Setpoint')}
              </span>
              <span className="text-sm font-mono text-[var(--text-primary)]">
                {formatTemperature(climateData.passenger_setpoint_c)}
              </span>
            </div>
          </div>

          {/* HVAC State */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('telemetry.hvacState', 'HVAC State')}
            </span>
            <span className="text-sm font-mono text-[var(--text-primary)]">
              {hvacState}
            </span>
          </div>

          {/* Fan Speed */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
              <Fan aria-hidden="true" className="h-3 w-3" /> {t('telemetry.fanSpeed', 'Fan Speed')}
            </span>
            <div className="flex items-center gap-1">
              <div
                role="meter"
                aria-label={t('telemetry.fanSpeed', 'Fan Speed')}
                aria-valuemin={0}
                aria-valuemax={FAN_MAX}
                aria-valuenow={fanForMeter}
                aria-valuetext={String(fan)}
                className="flex items-center gap-1"
              >
                {FAN_LEVELS.map(({ level, widthClass }) => (
                  <span
                    key={level}
                    aria-hidden="true"
                    className={cn(
                      'h-3 rounded-sm transition-colors',
                      widthClass,
                      fan >= level ? 'bg-neon-cyan/70' : 'bg-white/[0.06]',
                    )}
                  />
                ))}
              </div>
              <span
                aria-hidden="true"
                className="text-xs font-mono text-[var(--text-primary)] ml-1.5"
              >
                {fan}
              </span>
            </div>
          </div>

          {/* System badges */}
          <div className="flex flex-wrap gap-2 pt-1">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border',
                defrostActive
                  ? 'border-blue-400/30 bg-blue-400/10 text-blue-400'
                  : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
              )}
            >
              <Snowflake aria-hidden="true" className="h-3 w-3" /> {t('telemetry.defrost', 'Defrost')}{' '}
              {defrostActive ? climateData.defrost_mode : t('common.off', 'Off')}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border',
                climateOn
                  ? 'border-green-400/30 bg-green-400/10 text-green-400'
                  : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
              )}
            >
              <Zap aria-hidden="true" className="h-3 w-3" /> {t('telemetry.climate', 'Climate')}{' '}
              {climateOn ? t('common.on', 'On') : t('common.off', 'Off')}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border',
                preconditioning
                  ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
                  : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
              )}
            >
              {t('telemetry.precondition', 'Precondition')}{' '}
              {preconditioning ? t('common.on', 'On') : t('common.off', 'Off')}
            </span>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('telemetry.noClimateData', 'No climate data available')} />
      )}
    </GlassPanel>
  )
}
