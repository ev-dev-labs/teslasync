import { Caption, Text } from '@/components/ui'
import type { VehicleLabState } from './vehicleLabState'
import { useVehicleReadings } from './useVehicleReadings'

export default function VehicleReadings({ state }: { state: VehicleLabState }) {
  const readings = useVehicleReadings(state).filter(row => ['insideTemp', 'outsideTemp', 'battery', 'range'].includes(row.id))
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-shape-md bg-[var(--surface-2)] p-3 sm:grid-cols-4">
      {readings.map(({ id, label, value }) => <div key={id} className="min-w-0">
        <Caption as="dt">{label}</Caption>
        <Text as="dd" variant="body" className="mt-1 break-words">{value}</Text>
      </div>)}
    </dl>
  )
}
