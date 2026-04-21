import { useTranslation } from 'react-i18next'
import { Wind, Thermometer, Zap, CircleDot, Snowflake } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { Skeleton } from '@/components/feedback'
import { useSettings } from '@/hooks/useSettings'
import { fmtNumber } from '@/lib/numberFormat'
import type { ClimateSnapshot } from '@/api/types'

interface ClimateSectionProps {
  climateData: ClimateSnapshot | null | undefined
}

export function ClimateSection({ climateData }: ClimateSectionProps) {
  const { t } = useTranslation()
  const { convertTemp, tempUnit } = useSettings()

  return (
    <GlassPanel className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Wind className="h-4 w-4 text-[var(--neon-cyan)]" />
        <span className="text-lg font-bold text-[var(--text-primary)]">
          {t('vehicles.detail.climate', 'Climate')}
        </span>
      </div>
      {climateData ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard
            label={t('common.insideTemp', 'Inside Temp')}
            value={climateData.inside_temp != null ? `${fmtNumber(convertTemp(climateData.inside_temp))}${tempUnit}` : '—'}
            icon={<Thermometer className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('common.outsideTemp', 'Outside Temp')}
            value={climateData.outside_temp != null ? `${fmtNumber(convertTemp(climateData.outside_temp))}${tempUnit}` : '—'}
            icon={<Thermometer className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.hvacPower', 'HVAC Power')}
            value={climateData.hvac_power != null ? `${fmtNumber(climateData.hvac_power)} W` : '—'}
            icon={<Zap className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.detail.fanSpeed', 'Fan Speed')}
            value={climateData.hvac_fan_speed != null ? String(climateData.hvac_fan_speed) : '—'}
            icon={<Wind className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.seatHeaterL', 'Seat Heater Left')}
            value={climateData.seat_heater_left != null ? `${t('common.level', 'Level')} ${climateData.seat_heater_left}` : '—'}
            icon={<CircleDot className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.seatHeaterR', 'Seat Heater Right')}
            value={climateData.seat_heater_right != null ? `${t('common.level', 'Level')} ${climateData.seat_heater_right}` : '—'}
            icon={<CircleDot className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.defrost', 'Defrost')}
            value={climateData.defrost_mode && climateData.defrost_mode !== 'Off' ? climateData.defrost_mode : t('common.off', 'Off')}
            icon={<Snowflake className="h-4 w-4" />}
            color={climateData.defrost_mode && climateData.defrost_mode !== 'Off' ? 'green' : 'cyan'}
          />
          <MetricCard
            label={t('vehicles.detail.acEnabled', 'A/C Enabled')}
            value={climateData.hvac_ac_enabled ? t('common.on', 'On') : t('common.off', 'Off')}
            icon={<Wind className="h-4 w-4" />}
            color={climateData.hvac_ac_enabled ? 'green' : 'cyan'}
          />
        </div>
      ) : (
        <Skeleton lines={3} height={16} />
      )}
    </GlassPanel>
  )
}
