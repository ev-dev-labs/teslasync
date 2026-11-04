import { useLiveSignals } from '@/api/hooks/useSignals'
import { useVehicles } from '@/api/hooks/useVehicles'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import { useTicker } from '@/hooks/useTicker'
import { deriveVehicleLabState } from './vehicleLabState'

export function useVehicleLabState() {
  const { vehicleId } = useSelectedVehicle()
  const vehiclesQuery = useVehicles()
  const query = useLiveSignals(vehicleId ?? 0)
  const tick = useTicker()
  const state = useMemo(() => deriveVehicleLabState(query.data), [query.data, tick])
  return { state, query, vehicleId, vehiclesQuery }
}
import { useMemo } from 'react'
