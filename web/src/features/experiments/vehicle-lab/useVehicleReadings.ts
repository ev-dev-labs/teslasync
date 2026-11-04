import { useTranslation } from 'react-i18next'
import { useUnits } from '@/hooks/useUnits'
import { usePressureFormat } from '@/hooks/usePressureFormat'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { mapVehiclePartStates, type VehicleLabState, type WheelPosition } from './vehicleLabState'
import type { VehiclePart } from './partMapping'

export const VEHICLE_PART_LABELS: Record<VehiclePart, string> = {
  doorFrontLeft: 'Front-left door', doorFrontRight: 'Front-right door',
  doorRearLeft: 'Rear-left door', doorRearRight: 'Rear-right door',
  windowFrontLeft: 'Front-left window', windowFrontRight: 'Front-right window',
  windowRearLeft: 'Rear-left window', windowRearRight: 'Rear-right window',
  wheelFrontLeft: 'Front-left tire', wheelFrontRight: 'Front-right tire',
  wheelRearLeft: 'Rear-left tire', wheelRearRight: 'Rear-right tire',
  frunk: 'Front trunk', trunk: 'Rear trunk', chargePort: 'Charge port',
  headlights: 'Headlights', taillights: 'Taillights',
}

export type VehicleReadingId = VehiclePart | 'charging' | 'locked' | 'sentry' | 'insideTemp' | 'outsideTemp' | 'climate' | 'battery' | 'range' | 'gear' | 'speed'
export interface VehicleReading { id: VehicleReadingId; label: string; value: string }

export function useVehicleReadings(state: VehicleLabState): VehicleReading[] {
  const { t } = useTranslation()
  const units = useUnits()
  const { fmtNumber } = useNumberFormatting()
  const { formatPressureValue } = usePressureFormat()
  const unavailable = t('experiments.vehicleLab.unavailable', 'Unavailable')
  const parts = mapVehiclePartStates(state)
  const labels = {
    open: t('common.open', 'Open'), closed: t('common.closed', 'Closed'),
    partial: t('digitalTwin.partial', 'Partial'),
    available: t('experiments.vehicleLab.available', 'Available'), unknown: unavailable,
  }
  const flag = (value: boolean | null, yes: string, no: string) => value === null ? unavailable : value ? yes : no
  const on = t('experiments.vehicleLab.on', 'On')
  const off = t('experiments.vehicleLab.off', 'Off')
  const readings: VehicleReading[] = (Object.keys(VEHICLE_PART_LABELS) as VehiclePart[]).map(id => {
    const pressure = id.startsWith('wheel') ? state.tirePressurePa[id.slice(5) as WheelPosition] : null
    return {
      id, label: t(`experiments.vehicleLab.parts.${id}`, VEHICLE_PART_LABELS[id]),
      value: pressure === null ? labels[parts[id]] : formatPressureValue(pressure),
    }
  })
  return [...readings,
    { id: 'charging', label: t('experiments.vehicleLab.charging', 'Charging'), value: flag(state.charging, on, off) },
    { id: 'locked', label: t('experiments.vehicleLab.locked', 'Lock'), value: flag(state.locked, t('experiments.vehicleLab.lockedState', 'Locked'), t('experiments.vehicleLab.unlockedState', 'Unlocked')) },
    { id: 'sentry', label: t('experiments.vehicleLab.sentry', 'Sentry'), value: flag(state.sentry, on, off) },
    { id: 'insideTemp', label: t('experiments.vehicleLab.insideTemp', 'Cabin'), value: state.insideTempC === null ? unavailable : units.formatTemperature(state.insideTempC) },
    { id: 'outsideTemp', label: t('experiments.vehicleLab.outsideTemp', 'Outside'), value: state.outsideTempC === null ? unavailable : units.formatTemperature(state.outsideTempC) },
    { id: 'climate', label: t('experiments.vehicleLab.climate', 'Climate'), value: flag(state.climateOn, on, off) },
    { id: 'battery', label: t('experiments.vehicleLab.battery', 'Battery'), value: state.batteryPercent === null ? unavailable : t('experiments.vehicleLab.percent', '{{value}}%', { value: fmtNumber(state.batteryPercent, units.unitPrefs.precision, units.unitPrefs.locale) }) },
    { id: 'range', label: t('experiments.vehicleLab.range', 'Rated range'), value: state.rangeM === null ? unavailable : units.formatDistance(state.rangeM) },
    { id: 'gear', label: t('experiments.vehicleLab.gear', 'Gear'), value: state.gear === null ? unavailable : t(`experiments.vehicleLab.gears.${state.gear}`, { P: 'Park', R: 'Reverse', N: 'Neutral', D: 'Drive' }[state.gear]) },
    { id: 'speed', label: t('experiments.vehicleLab.speed', 'Speed'), value: state.speedMps === null ? unavailable : units.formatSpeed(state.speedMps) },
  ]
}
