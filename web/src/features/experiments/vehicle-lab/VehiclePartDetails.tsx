import { useTranslation } from 'react-i18next'
import { Drawer, Text } from '@/components/ui'
import type { VehicleLabState } from './vehicleLabState'
import { useVehicleReadings, type VehicleReadingId } from './useVehicleReadings'

export default function VehiclePartDetails({ selected, state, onClose }: {
  selected: VehicleReadingId | null
  state: VehicleLabState
  onClose: () => void
}) {
  const { t } = useTranslation()
  const reading = useVehicleReadings(state).find(row => row.id === selected)
  return (
    <Drawer open={reading !== undefined} onClose={onClose} title={reading?.label}>
      <div className="space-y-4 p-4">
        <Text as="p" variant="metricValue" role="status">{reading?.value}</Text>
        <Text as="p">{t('experiments.vehicleLab.detailHonesty', 'Read-only telemetry. Missing or expired signals are unavailable; the vehicle geometry is illustrative, not a control.')}</Text>
      </div>
    </Drawer>
  )
}
