import { useTranslation } from 'react-i18next'
import { Cog, CircleDot } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import { useSettings } from '@/hooks/useSettings'
import { fmtNumber, fmtInt } from '@/lib/numberFormat'
import type { MotorSnapshot } from '@/api/types'

interface PowertrainPanelProps {
  motorData: MotorSnapshot | null | undefined
}

export function PowertrainPanel({ motorData }: PowertrainPanelProps) {
  const { t } = useTranslation()
  const { convertTemp, tempUnit } = useSettings()

  const maxMotorTemp =
    motorData
      ? Math.max(motorData.motor_temp_c_front ?? -Infinity, motorData.motor_temp_c_rear ?? -Infinity)
      : null

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Cog className="h-4 w-4 text-cyan-300" /> {t('common.powertrain', 'Powertrain')}
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
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                motorData.shift_state === 'D'
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : motorData.shift_state === 'R'
                    ? 'border-red-500/30 bg-red-500/10 text-red-400'
                    : motorData.shift_state === 'N'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      : 'border-gray-500/30 bg-gray-500/10 text-[var(--text-muted)]',
              )}
            >
              <CircleDot className="h-3 w-3" />
              {motorData.shift_state ?? t('common.unknown', 'Unknown')}
            </span>
          </div>

          {/* Power */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--text-muted)]">{t('telemetry.power', 'Power')}</span>
              <span className="text-[var(--text-primary)] font-mono">
                {motorData.power_kw != null ? fmtNumber(motorData.power_kw) : '—'} kW
              </span>
            </div>
            <div className="relative h-3 rounded-full bg-white/[0.04] overflow-hidden">
              <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--surface-2)]" />
              {motorData.power_kw != null && (
                <div
                  className={cn(
                    'absolute inset-y-0 rounded-full transition-all duration-300',
                    motorData.power_kw >= 0 ? 'bg-green-500/60' : 'bg-red-500/60',
                  )}
                  style={
                    motorData.power_kw >= 0
                      ? {
                          left: '50%',
                          width: `${Math.min((Math.abs(motorData.power_kw) / 300) * 50, 50)}%`,
                        }
                      : {
                          right: '50%',
                          width: `${Math.min((Math.abs(motorData.power_kw) / 300) * 50, 50)}%`,
                        }
                  }
                />
              )}
            </div>
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5">
              <span>-300</span>
              <span>0</span>
              <span>+300</span>
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
                maxMotorTemp != null && isFinite(maxMotorTemp) && maxMotorTemp > 80
                  ? 'text-red-400'
                  : 'text-[var(--text-primary)]',
              )}
            >
              {maxMotorTemp != null && isFinite(maxMotorTemp)
                ? `${fmtNumber(convertTemp(maxMotorTemp))} ${tempUnit}`
                : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              {t('telemetry.inverterTemp', 'Inverter Temp')}
            </span>
            <span className="text-sm font-mono text-[var(--text-primary)]">
              {motorData.inverter_temp_c != null
                ? `${fmtNumber(convertTemp(motorData.inverter_temp_c))} ${tempUnit}`
                : '—'}
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
        <EmptyState message={t('telemetry.noMotorData', 'No motor data available')} />
      )}
    </GlassPanel>
  )
}
