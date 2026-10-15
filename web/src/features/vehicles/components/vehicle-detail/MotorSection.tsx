import { useTranslation } from 'react-i18next'
import { Activity, Thermometer, Gauge, Settings, Zap, Battery } from 'lucide-react'
import { OperationalBrief, type StatMetric } from '@/components/data-display'
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics'
import { EmptyState } from '@/components/feedback'
import type { MotorSnapshot } from '@/api/types'
import { useVehicleDetailSummary, type VehicleDetailSummaryProps } from '../statstrip-vehicle-detail/useVehicleDetailSummary'
import { voltageFormatter, currentFormatter, torqueFormatter, rpmFormatter } from '../statstrip-vehicle-detail/powertrainFormatters'

interface MotorSectionProps extends VehicleDetailSummaryProps {
  motorData: MotorSnapshot | null | undefined
}

export function MotorSection({ motorData, sourceQuery }: MotorSectionProps) {
  const { t } = useTranslation()
  const summary = useVehicleDetailSummary(t('vehicles.detail.motor', 'Powertrain'), sourceQuery, motorData?.ts, motorData != null)
  const temperatures = [motorData?.motor_temp_c_front, motorData?.motor_temp_c_rear]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const maxMotorTemp = temperatures.length ? Math.max(...temperatures) : null
  const vbat = motorData?.vbat_rear ?? motorData?.vbat_front

  const rawMetrics: readonly StatMetric[] = [
        { metricId: 'status', label: t('vehicles.detail.shiftState', 'Shift state'),
          rawValue: motorData?.shift_state, context: <Settings className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'number', label: t('vehicles.detail.packVoltage', 'Pack voltage'),
          description: t('vehicles.detail.brief.voltageDescription', 'Rear pack voltage, falling back to the front reading when absent; displayed in volts.'),
          rawValue: vbat, display: { formatter: voltageFormatter }, context: <Battery className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'number', label: t('vehicles.detail.motorCurrentFront', 'Motor current (F)'),
          description: t('vehicles.detail.brief.currentDescription', 'Front motor current displayed in amperes.'),
          rawValue: motorData?.motor_current_front, display: { formatter: currentFormatter }, context: <Zap className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'number', occurrenceId: 'front-torque', label: t('vehicles.detail.torqueFront', 'Front torque'),
          description: t('vehicles.detail.brief.frontTorqueDescription', 'Front axle torque displayed in newton-metres.'),
          rawValue: motorData?.torque_nm_front, display: { formatter: torqueFormatter }, context: <Activity className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'number', occurrenceId: 'rear-torque', label: t('vehicles.detail.torqueRear', 'Rear torque'),
          description: t('vehicles.detail.brief.rearTorqueDescription', 'Rear axle torque displayed in newton-metres.'),
          rawValue: motorData?.torque_nm_rear, display: { formatter: torqueFormatter }, context: <Activity className="h-4 w-4" aria-hidden="true" /> },
        // /motor/latest projects DiAxleSpeedF/R unchanged (UnitKindNone).
        // Preserve the existing direct integer RPM display; do not infer rad/s.
        { metricId: 'number', occurrenceId: 'front-rpm', label: t('vehicles.detail.rpmFront', 'Front RPM'),
          description: t('vehicles.detail.brief.frontRpmDescription', 'Direct front axle-speed reading in RPM; no inferred angular-speed conversion.'),
          rawValue: motorData?.motor_rpm_front, display: { formatter: rpmFormatter },
          context: <Gauge className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'number', occurrenceId: 'rear-rpm', label: t('vehicles.detail.rpmRear', 'Rear RPM'),
          description: t('vehicles.detail.brief.rearRpmDescription', 'Direct rear axle-speed reading in RPM; no inferred angular-speed conversion.'),
          rawValue: motorData?.motor_rpm_rear, display: { formatter: rpmFormatter },
          context: <Gauge className="h-4 w-4" aria-hidden="true" /> },
        { metricId: 'temperature', label: t('vehicles.detail.motorTemp', 'Motor temp (peak)'),
          rawValue: maxMotorTemp, context: <Thermometer className="h-4 w-4" aria-hidden="true" /> },
  ]
  const metrics = useOperationalMetrics(rawMetrics)
  return (
    <>
      <OperationalBrief compact testId="vehicle-powertrain-summary" {...summary.brief}
        eyebrow={t('vehicles.detail.systems', 'Vehicle systems')}
        title={t('vehicles.detail.motor', 'Powertrain')}
        description={t('vehicles.detail.brief.motorDescription', 'Shift state, pack voltage, front motor current, axle torque and RPM, and peak known motor temperature.')}
        metrics={metrics} />
      {!motorData && (
        // no-action: the independent source wrapper owns failure retry.
        <EmptyState message={t('vehicles.detail.noMotorData', 'No motor data available')} />
      )}
    </>
  )
}
