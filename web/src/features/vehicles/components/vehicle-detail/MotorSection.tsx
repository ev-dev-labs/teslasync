import { useTranslation } from 'react-i18next'
import { Cog, Activity, Thermometer, Gauge, Settings, Zap, Battery } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import { useUnits } from '@/hooks/useUnits'
import { fmtNumber, fmtInt } from '@/lib/numberFormat'
import type { MotorSnapshot } from '@/api/types'

interface MotorSectionProps {
  motorData: MotorSnapshot | null | undefined
}

export function MotorSection({ motorData }: MotorSectionProps) {
  const { t } = useTranslation()
  const { formatTemperature } = useUnits()

  const maxMotorTemp =
    motorData
      ? Math.max(motorData.motor_temp_c_front ?? -Infinity, motorData.motor_temp_c_rear ?? -Infinity)
      : null

  // Powertrain bus-derived power proxy: pack voltage * front motor current.
  // Per web/src/api/types.ts MotorSnapshot doc, power_kw / regen_kw have no
  // backing signal in the codec → signal_log path, so we surface the two
  // raw inputs (voltage and current) rather than fabricate a derived value.
  const vbat = motorData?.vbat_rear ?? motorData?.vbat_front ?? null

  return (
    <GlassPanel className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Cog className="h-4 w-4 text-[var(--neon-cyan)]" />
        <span className="text-lg font-bold text-[var(--text-primary)]">
          {t('vehicles.detail.motor', 'Powertrain')}
        </span>
      </div>
      {motorData ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard
            label={t('vehicles.detail.shiftState', 'Shift State')}
            value={motorData.shift_state ?? '—'}
            icon={<Settings className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.packVoltage', 'Pack Voltage')}
            value={vbat != null ? `${fmtNumber(vbat)} V` : '—'}
            icon={<Battery className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.detail.motorCurrentFront', 'Motor Current (F)')}
            value={
              motorData.motor_current_front != null
                ? `${fmtNumber(motorData.motor_current_front)} A`
                : '—'
            }
            icon={<Zap className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.torqueFront', 'Front Torque')}
            value={
              motorData.torque_nm_front != null ? `${fmtNumber(motorData.torque_nm_front)} Nm` : '—'
            }
            icon={<Activity className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.torqueRear', 'Rear Torque')}
            value={
              motorData.torque_nm_rear != null ? `${fmtNumber(motorData.torque_nm_rear)} Nm` : '—'
            }
            icon={<Activity className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.detail.rpmFront', 'Front RPM')}
            value={motorData.motor_rpm_front != null ? `${fmtInt(motorData.motor_rpm_front)}` : '—'}
            icon={<Gauge className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.rpmRear', 'Rear RPM')}
            value={motorData.motor_rpm_rear != null ? `${fmtInt(motorData.motor_rpm_rear)}` : '—'}
            icon={<Gauge className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.detail.motorTemp', 'Motor Temp (peak)')}
            value={
              maxMotorTemp != null && isFinite(maxMotorTemp)
                ? formatTemperature(maxMotorTemp)
                : '—'
            }
            icon={<Thermometer className="h-4 w-4" />}
            color="green"
          />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('vehicles.detail.noMotorData', 'No motor data available')} />
      )}
    </GlassPanel>
  )
}
