import { useTranslation } from 'react-i18next'
import { Wind, Thermometer, CircleDot, Snowflake, Flame } from 'lucide-react'
import { OperationalBrief, type StatMetric } from '@/components/data-display'
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics'
import { EmptyState } from '@/components/feedback'
import type { ClimateSnapshot } from '@/api/types'
import { useVehicleDetailSummary, type VehicleDetailSummaryProps } from '../statstrip-vehicle-detail/useVehicleDetailSummary'

interface ClimateSectionProps extends VehicleDetailSummaryProps {
  climateData: ClimateSnapshot | null | undefined
}

export function ClimateSection({ climateData, sourceQuery }: ClimateSectionProps) {
  const { t } = useTranslation()
  const summary = useVehicleDetailSummary(t('vehicles.detail.climate', 'Climate'), sourceQuery, climateData?.ts, climateData != null)
  const climateOn = climateData?.is_ac_on ?? climateData?.is_climate_on
  const fanSpeed = climateData?.hvac_fan_status ?? climateData?.fan_status ?? climateData?.fan_speed

  const rawMetrics: readonly StatMetric[] = [
        { metricId: 'temperature', occurrenceId: 'cabin', label: t('common.insideTemp', 'Inside temp'),
          rawValue: climateData?.inside_temp ?? climateData?.inside_temp_c,
          context: <Thermometer className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'temperature', occurrenceId: 'outside', label: t('common.outsideTemp', 'Outside temp'),
          rawValue: climateData?.outside_temp ?? climateData?.outside_temp_c,
          context: <Thermometer className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'temperature', occurrenceId: 'driver-setpoint', label: t('vehicles.detail.driverSetpoint', 'Driver setpoint'),
          rawValue: climateData?.driver_temp_setting ?? climateData?.driver_setpoint_c,
          context: <Thermometer className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'number', label: t('vehicles.detail.fanSpeed', 'Fan speed'),
          description: t('vehicles.detail.brief.fanDescription', 'Reported fan value using the existing fan-status then fan-speed fallback order.'),
          rawValue: fanSpeed, display: { precision: Number.isInteger(fanSpeed) ? 0 : undefined },
          context: <Wind className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'number', occurrenceId: 'seat-left', label: t('vehicles.detail.seatHeaterL', 'Seat heater left'),
          description: t('vehicles.detail.brief.seatLeftDescription', 'Reported left-seat heater level; missing is distinct from zero.'),
          rawValue: climateData?.seat_heater_left, display: { precision: 0 },
          context: <><CircleDot className="h-4 w-4" aria-hidden="true" />{t('common.level', 'Level')}</> },
        { metricId: 'number', occurrenceId: 'seat-right', label: t('vehicles.detail.seatHeaterR', 'Seat heater right'),
          description: t('vehicles.detail.brief.seatRightDescription', 'Reported right-seat heater level; missing is distinct from zero.'),
          rawValue: climateData?.seat_heater_right, display: { precision: 0 },
          context: <><CircleDot className="h-4 w-4" aria-hidden="true" />{t('common.level', 'Level')}</> },
        { metricId: 'status', occurrenceId: 'defrost', label: t('vehicles.detail.defrost', 'Defrost'),
          rawValue: climateData?.defrost_mode == null ? null
            : climateData.defrost_mode === 'Off' ? t('common.off', 'Off') : climateData.defrost_mode,
          context: <Snowflake className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'status', occurrenceId: 'climate-on', label: t('vehicles.detail.climateOn', 'Climate on'),
          rawValue: climateOn == null ? null : climateOn ? t('common.on', 'On') : t('common.off', 'Off'),
          context: <Flame className="h-4 w-4" aria-hidden="true" /> },
  ]
  const metrics = useOperationalMetrics(rawMetrics)
  return (
    <>
      <OperationalBrief compact testId="vehicle-climate-summary" {...summary.brief}
        eyebrow={t('vehicles.detail.systems', 'Vehicle systems')}
        title={t('vehicles.detail.climate', 'Climate')}
        description={t('vehicles.detail.brief.climateDescription', 'Cabin and outside temperatures, driver setpoint, fan speed, seat heating, defrost and climate power; missing readings remain unknown.')}
        metrics={metrics} />
      {!climateData && (
        // no-action: the independent source wrapper owns failure retry.
        <EmptyState message={t('vehicles.detail.noClimateData', 'No climate data available')} />
      )}
    </>
  )
}
