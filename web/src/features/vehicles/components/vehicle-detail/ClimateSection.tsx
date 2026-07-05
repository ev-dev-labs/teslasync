import { useTranslation } from 'react-i18next'
import { Wind, Thermometer, CircleDot, Snowflake, Flame } from 'lucide-react'

import { GlassPanel, PanelTitle } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import { useUnits } from '@/hooks/useUnits'
import type { ClimateSnapshot } from '@/api/types'

interface ClimateSectionProps {
  climateData: ClimateSnapshot | null | undefined
}

export function ClimateSection({ climateData }: ClimateSectionProps) {
  const { t } = useTranslation()
  const { formatTemperature } = useUnits()

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Wind className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('vehicles.detail.climate', 'Climate')}
      </PanelTitle>
      {climateData ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard
            label={t('common.insideTemp', 'Inside Temp')}
            value={formatTemperature(climateData.inside_temp ?? climateData.inside_temp_c)}
            icon={<Thermometer className="h-4 w-4" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('common.outsideTemp', 'Outside Temp')}
            value={formatTemperature(climateData.outside_temp ?? climateData.outside_temp_c)}
            icon={<Thermometer className="h-4 w-4" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.driverSetpoint', 'Driver Setpoint')}
            value={formatTemperature(climateData.driver_temp_setting ?? climateData.driver_setpoint_c)}
            icon={<Thermometer className="h-4 w-4" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.detail.fanSpeed', 'Fan Speed')}
            value={
              climateData.hvac_fan_status != null
                ? String(climateData.hvac_fan_status)
                : climateData.fan_status != null
                  ? String(climateData.fan_status)
                  : '—'
            }
            icon={<Wind className="h-4 w-4" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.seatHeaterL', 'Seat Heater Left')}
            value={
              climateData.seat_heater_left != null
                ? `${t('common.level', 'Level')} ${climateData.seat_heater_left}`
                : '—'
            }
            icon={<CircleDot className="h-4 w-4" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.seatHeaterR', 'Seat Heater Right')}
            value={
              climateData.seat_heater_right != null
                ? `${t('common.level', 'Level')} ${climateData.seat_heater_right}`
                : '—'
            }
            icon={<CircleDot className="h-4 w-4" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('vehicles.detail.defrost', 'Defrost')}
            value={
              climateData.defrost_mode && climateData.defrost_mode !== 'Off'
                ? climateData.defrost_mode
                : t('common.off', 'Off')
            }
            icon={<Snowflake className="h-4 w-4" aria-hidden="true" />}
            color={climateData.defrost_mode && climateData.defrost_mode !== 'Off' ? 'green' : 'cyan'}
          />
          <MetricCard
            label={t('vehicles.detail.climateOn', 'Climate On')}
            value={
              (climateData.is_ac_on ?? climateData.is_climate_on)
                ? t('common.on', 'On')
                : t('common.off', 'Off')
            }
            icon={<Flame className="h-4 w-4" aria-hidden="true" />}
            color={(climateData.is_ac_on ?? climateData.is_climate_on) ? 'green' : 'cyan'}
          />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('vehicles.detail.noClimateData', 'No climate data available')} />
      )}
    </GlassPanel>
  )
}
