import { useEffect, useState } from 'react'
import type { Group } from 'three'
import { createVehicleModel, disposeVehicleModel, type VehicleModelPalette } from './model/createVehicleModel'
import { bindVehicleParts } from './partMapping'
import { mapVehiclePartStates, type VehicleLabState } from './vehicleLabState'
import { useThree } from '@react-three/fiber'

export default function VehicleModelView({ palette, state }: { palette: VehicleModelPalette; state: VehicleLabState }) {
  const [model, setModel] = useState<Group | null>(null)
  const invalidate = useThree(context => context.invalidate)
  useEffect(() => {
    const next = createVehicleModel(palette)
    bindVehicleParts(next)
    setModel(next)
    return () => disposeVehicleModel(next)
  }, [palette])
  useEffect(() => {
    if (!model) return
    const states = mapVehiclePartStates(state)
    for (const [part, node] of bindVehicleParts(model)) node.userData.state = states[part]
    invalidate()
  }, [model, state, invalidate])
  return model ? <primitive object={model} dispose={null} /> : null
}
