import { useTranslation } from 'react-i18next'
import { Cog, CircleDot } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { useSettings } from '@/hooks/useSettings'
import { cleanNil } from '@/lib/cleanNil'
import { fmtNumber, fmtInt, fmtPercent } from '@/lib/numberFormat'
import type { MotorSnapshot } from '@/api/types'

interface PowertrainPanelProps {
  motorData: MotorSnapshot | null | undefined
}

export function PowertrainPanel({ motorData }: PowertrainPanelProps) {
  const { t } = useTranslation()
  const { convertTemp, tempUnit } = useSettings()

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Cog className="h-4 w-4 text-neon-cyan" /> {t('common.powertrain', 'Powertrain')}
      </h3>
      {motorData ? (
        <div className="space-y-4">
          {/* Motor state badge */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">Motor State</span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                motorData.di_state === 'Enabled'
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : motorData.di_state === 'Standby'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                    : 'border-gray-500/30 bg-gray-500/10 text-[var(--text-muted)]',
              )}
            >
              <CircleDot className="h-3 w-3" />
              {cleanNil(motorData.di_state) ?? 'Unknown'}
            </span>
          </div>

          {/* Torque gauge */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--text-muted)]">Torque</span>
              <span className="text-[var(--text-primary)] font-mono">
                {motorData.di_torque != null ? fmtInt(motorData.di_torque) : '—'} Nm
              </span>
            </div>
            <div className="relative h-3 rounded-full bg-white/[0.04] overflow-hidden">
              <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
              {motorData.di_torque != null && (
                <div
                  className={cn(
                    'absolute inset-y-0 rounded-full transition-all duration-300',
                    motorData.di_torque >= 0 ? 'bg-green-500/60' : 'bg-red-500/60',
                  )}
                  style={
                    motorData.di_torque >= 0
                      ? {
                          left: '50%',
                          width: `${Math.min((Math.abs(motorData.di_torque) / 500) * 50, 50)}%`,
                        }
                      : {
                          right: '50%',
                          width: `${Math.min((Math.abs(motorData.di_torque) / 500) * 50, 50)}%`,
                        }
                  }
                />
              )}
            </div>
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5">
              <span>-500</span>
              <span>0</span>
              <span>+500</span>
            </div>
          </div>

          {/* Axle Speed */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">Axle Speed</span>
            <span className="text-sm font-mono text-[var(--text-primary)]">
              {motorData.di_axle_speed != null ? fmtInt(motorData.di_axle_speed) : '—'} RPM
            </span>
          </div>

          {/* Stator Temperature */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">Stator Temp</span>
            <span
              className={cn(
                'text-sm font-mono',
                motorData.di_stator_temp != null && motorData.di_stator_temp > 80
                  ? 'text-red-400'
                  : 'text-[var(--text-primary)]',
              )}
            >
              {motorData.di_stator_temp != null
                ? `${fmtNumber(convertTemp(motorData.di_stator_temp))} ${tempUnit}`
                : '—'}
            </span>
          </div>

          {/* Throttle position bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--text-muted)]">Throttle Position</span>
              <span className="text-[var(--text-primary)] font-mono">
                {motorData.pedal_position != null
                  ? `${fmtPercent(motorData.pedal_position)}`
                  : '—'}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
              <div
                className="h-full rounded-full bg-neon-cyan/60 transition-all duration-300"
                style={{ width: `${motorData.pedal_position ?? 0}%` }}
              />
            </div>
          </div>

          {/* Brake indicator */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">Brake</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-semibold',
                motorData.brake_pedal ? 'text-red-400' : 'text-[var(--text-muted)]',
              )}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  motorData.brake_pedal ? 'bg-red-400' : 'bg-gray-600',
                )}
              />
              {motorData.brake_pedal ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* G-Forces */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="Lateral G"
              value={
                motorData.lateral_accel != null
                  ? `${motorData.lateral_accel > 0 ? '+' : ''}${fmtNumber(motorData.lateral_accel)}g`
                  : '—'
              }
            />
            <MetricCard
              label="Longitudinal G"
              value={
                motorData.longitudinal_accel != null
                  ? `${motorData.longitudinal_accel > 0 ? '+' : ''}${fmtNumber(motorData.longitudinal_accel)}g`
                  : '—'
              }
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">
          No motor data available
        </p>
      )}
    </GlassPanel>
  )
}
