import { useEffect, useState } from 'react'
import type { Group } from 'three'
import { createVehicleModel, disposeVehicleModel, type VehicleModelPalette } from './model/createVehicleModel'
import { bindVehicleParts } from './partMapping'

export default function VehicleModelView({ palette }: { palette: VehicleModelPalette }) {
  const [model, setModel] = useState<Group | null>(null)
  useEffect(() => {
    const next = createVehicleModel(palette)
    bindVehicleParts(next)
    setModel(next)
    return () => disposeVehicleModel(next)
  }, [palette])
  return model ? <primitive object={model} dispose={null} /> : null
}
