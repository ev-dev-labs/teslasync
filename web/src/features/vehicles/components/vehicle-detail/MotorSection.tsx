import { useTranslation } from 'react-i18next'
import { Cog, Activity, Thermometer, Gauge, Settings } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { Skeleton } from '@/components/feedback'
import { useSettings } from '@/hooks/useSettings'
import { fmtNumber, fmtInt } from '@/lib/numberFormat'
import type { MotorSnapshot } from '@/api/types'

interface MotorSectionProps {
  motorData: MotorSnapshot | null | undefined
}

export function MotorSection({ motorData }: MotorSectionProps) {
  const { t } = useTranslation()
  const { convertTemp, tempUnit } = useSettings()

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
            label={t('vehicles.detail.motorState', 'Motor State')}
            value={motorData.di_state ?? '—'}
            icon={<Cog className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.torque', 'Torque')}
            value={motorData.di_torque != null ? `${fmtNumber(motorData.di_torque)} Nm` : '—'}
            icon={<Activity className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.detail.statorTemp', 'Stator Temp')}
            value={motorData.di_stator_temp != null ? `${fmtNumber(convertTemp(motorData.di_stator_temp))}${tempUnit}` : '—'}
            icon={<Thermometer className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.axleSpeed', 'Axle Speed')}
            value={motorData.di_axle_speed != null ? `${fmtInt(motorData.di_axle_speed)} RPM` : '—'}
            icon={<Gauge className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.pedalPos', 'Pedal Position')}
            value={motorData.pedal_position != null ? `${fmtNumber(motorData.pedal_position)}%` : '—'}
            icon={<Activity className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.gear', 'Gear')}
            value={motorData.gear ?? '—'}
            icon={<Settings className="h-4 w-4" />}
            color="purple"
          />
        </div>
      ) : (
        <Skeleton lines={3} height={16} />
      )}
    </GlassPanel>
  )
}
