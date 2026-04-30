import { useTranslation } from 'react-i18next'
import { Cog, Activity, Thermometer, Gauge, Settings, Zap } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import { useSettings } from '@/hooks/useSettings'
import { fmtNumber, fmtInt } from '@/lib/numberFormat'
import type { MotorSnapshot } from '@/api/types'

interface MotorSectionProps {
  motorData: MotorSnapshot | null | undefined
}

export function MotorSection({ motorData }: MotorSectionProps) {
  const { t } = useTranslation()
  const { convertTemp, tempUnit } = useSettings()

  const maxMotorTemp =
    motorData
      ? Math.max(motorData.motor_temp_c_front ?? -Infinity, motorData.motor_temp_c_rear ?? -Infinity)
      : null

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
            label={t('vehicles.detail.power', 'Power')}
            value={motorData.power_kw != null ? `${fmtNumber(motorData.power_kw)} kW` : '—'}
            icon={<Zap className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.detail.regen', 'Regen')}
            value={motorData.regen_kw != null ? `${fmtNumber(motorData.regen_kw)} kW` : '—'}
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
                ? `${fmtNumber(convertTemp(maxMotorTemp))}${tempUnit}`
                : '—'
            }
            icon={<Thermometer className="h-4 w-4" />}
            color="green"
          />
        </div>
      ) : (
        <EmptyState message={t('vehicles.detail.noMotorData', 'No motor data available')} />
      )}
    </GlassPanel>
  )
}
