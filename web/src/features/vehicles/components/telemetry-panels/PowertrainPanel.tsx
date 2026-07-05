import { useTranslation } from 'react-i18next'
import { Cog, CircleDot } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import { useUnits } from '@/hooks/useUnits'
import { fmtNumber, fmtInt } from '@/lib/numberFormat'
import type { MotorSnapshot } from '@/api/types'

/**
 * Symmetric ± window (kW) the power bar + accessible meter visualise. The
 * fill grows as a half-width [0, 50%] band either side of centre, and the
 * meter clamps its reported value into [-POWER_SCALE_KW, POWER_SCALE_KW]
 * while `aria-valuetext` preserves the true reading.
 */
const POWER_SCALE_KW = 300

/**
 * Motor temperature (°C) at/above which the peak reading switches to the
 * warning colour. Compared against the raw SI value so the threshold is
 * independent of the user's display-unit preference.
 */
const MOTOR_TEMP_WARN_C = 80

interface PowertrainPanelProps {
  motorData: MotorSnapshot | null | undefined
}

export function PowertrainPanel({ motorData }: PowertrainPanelProps) {
  const { t } = useTranslation()
  const { formatTemperature } = useUnits()

  // Peak motor temperature across both axles, kept in raw °C so the warning
  // threshold stays unit-preference independent. Resolves to -Infinity when
  // neither axle has reported, which the finite guards below fold into the
  // em-dash / neutral-colour path.
  const maxMotorTemp = motorData
    ? Math.max(motorData.motor_temp_c_front ?? -Infinity, motorData.motor_temp_c_rear ?? -Infinity)
    : null
  const motorTempHot =
    maxMotorTemp != null && Number.isFinite(maxMotorTemp) && maxMotorTemp > MOTOR_TEMP_WARN_C
  const motorTempDisplay =
    maxMotorTemp != null && Number.isFinite(maxMotorTemp) ? formatTemperature(maxMotorTemp) : '—'

  // Power-bar geometry. `powerPct` is the [0, 50%] half-width fill; the meter
  // reports the raw reading clamped into the visible ±POWER_SCALE_KW window.
  // Cheap scalar math, so it runs unconditionally — the empty branch ignores it.
  const powerKw = motorData?.power_kw ?? null
  const hasPower = powerKw != null
  const powerPct = powerKw != null ? Math.min((Math.abs(powerKw) / POWER_SCALE_KW) * 50, 50) : 0
  const powerClamped =
    powerKw != null ? Math.max(-POWER_SCALE_KW, Math.min(POWER_SCALE_KW, powerKw)) : 0

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Cog aria-hidden="true" className="h-4 w-4 text-cyan-300" /> {t('common.powertrain', 'Powertrain')}
      </h3>
      {motorData ? (
        <div className="space-y-4">
          {/* Shift state badge */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('telemetry.shiftState', 'Shift State')}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border',
                motorData.shift_state === 'D'
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : motorData.shift_state === 'R'
                    ? 'border-red-500/30 bg-red-500/10 text-red-400'
                    : motorData.shift_state === 'N'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      : 'border-gray-500/30 bg-gray-500/10 text-[var(--text-muted)]',
              )}
            >
              <CircleDot aria-hidden="true" className="h-3 w-3" />
              {motorData.shift_state ?? t('common.unknown', 'Unknown')}
            </span>
          </div>

          {/* Power */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--text-muted)]">{t('telemetry.power', 'Power')}</span>
              <span className="text-[var(--text-primary)] font-mono">
                {hasPower ? fmtNumber(powerKw) : '—'} kW
              </span>
            </div>
            <div
              role={hasPower ? 'meter' : undefined}
              aria-label={hasPower ? t('telemetry.power', 'Power') : undefined}
              aria-valuemin={hasPower ? -POWER_SCALE_KW : undefined}
              aria-valuemax={hasPower ? POWER_SCALE_KW : undefined}
              aria-valuenow={hasPower ? powerClamped : undefined}
              aria-valuetext={hasPower ? `${fmtNumber(powerKw)} kW` : undefined}
              className="relative h-3 rounded-full bg-white/[0.04] overflow-hidden"
            >
              <div
                aria-hidden="true"
                className="absolute inset-y-0 left-1/2 w-px bg-[var(--surface-2)]"
              />
              {hasPower && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-y-0 rounded-full transition-all duration-normal',
                    powerClamped >= 0 ? 'bg-green-500/60' : 'bg-red-500/60',
                  )}
                  style={
                    powerClamped >= 0
                      ? { left: '50%', width: `${powerPct}%` }
                      : { right: '50%', width: `${powerPct}%` }
                  }
                />
              )}
            </div>
            <div
              aria-hidden="true"
              className="flex justify-between text-2xs text-[var(--text-muted)] mt-0.5"
            >
              <span>-{POWER_SCALE_KW}</span>
              <span>0</span>
              <span>+{POWER_SCALE_KW}</span>
            </div>
          </div>

          {/* Motor RPM */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label={t('telemetry.rpmFront', 'Front RPM')}
              value={motorData.motor_rpm_front != null ? fmtInt(motorData.motor_rpm_front) : '—'}
              subtitle="RPM"
            />
            <MetricCard
              label={t('telemetry.rpmRear', 'Rear RPM')}
              value={motorData.motor_rpm_rear != null ? fmtInt(motorData.motor_rpm_rear) : '—'}
              subtitle="RPM"
            />
          </div>

          {/* Torque split */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label={t('telemetry.torqueFront', 'Front Torque')}
              value={motorData.torque_nm_front != null ? fmtNumber(motorData.torque_nm_front) : '—'}
              subtitle="Nm"
            />
            <MetricCard
              label={t('telemetry.torqueRear', 'Rear Torque')}
              value={motorData.torque_nm_rear != null ? fmtNumber(motorData.torque_nm_rear) : '—'}
              subtitle="Nm"
            />
          </div>

          {/* Temperatures */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('telemetry.motorTemp', 'Motor Temp (peak)')}
            </span>
            <span
              className={cn(
                'text-sm font-mono',
                motorTempHot ? 'text-red-400' : 'text-[var(--text-primary)]',
              )}
            >
              {motorTempDisplay}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('telemetry.inverterTemp', 'Inverter Temp')}
            </span>
            <span className="text-sm font-mono text-[var(--text-primary)]">
              {formatTemperature(motorData.inverter_temp_c)}
            </span>
          </div>

          {/* Regen */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('telemetry.regen', 'Regen')}
            </span>
            <span className="text-sm font-mono text-green-400">
              {motorData.regen_kw != null ? `${fmtNumber(motorData.regen_kw)} kW` : '—'}
            </span>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('telemetry.noMotorData', 'No motor data available')} />
      )}
    </GlassPanel>
  )
}
