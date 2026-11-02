import { useTranslation } from 'react-i18next'
import { Caption, Text } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'
import { fmtNumber } from '@/lib/numberFormat'
import type { VehicleLabState } from './vehicleLabState'

export default function VehicleReadings({ state }: { state: VehicleLabState }) {
  const { t } = useTranslation()
  const units = useUnits()
  const unavailable = t('experiments.vehicleLab.unavailable', 'Unavailable')
  const readings = [
    [t('experiments.vehicleLab.insideTemp', 'Cabin'), state.insideTempC === null ? unavailable : units.formatTemperature(state.insideTempC)],
    [t('experiments.vehicleLab.outsideTemp', 'Outside'), state.outsideTempC === null ? unavailable : units.formatTemperature(state.outsideTempC)],
    [t('experiments.vehicleLab.battery', 'Battery'), state.batteryPercent === null ? unavailable : t('experiments.vehicleLab.percent', '{{value}}%', { value: fmtNumber(state.batteryPercent, units.unitPrefs.precision, units.unitPrefs.locale) })],
    [t('experiments.vehicleLab.range', 'Rated range'), state.rangeM === null ? unavailable : units.formatDistance(state.rangeM)],
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-shape-md bg-[var(--surface-2)] p-3 sm:grid-cols-4">
      {readings.map(([label, value]) => <div key={label} className="min-w-0">
        <Caption as="dt">{label}</Caption>
        <Text as="dd" variant="body" className="mt-1 break-words">{value}</Text>
      </div>)}
    </dl>
  )
}
