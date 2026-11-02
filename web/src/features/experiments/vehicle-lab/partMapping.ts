import type { Object3D } from 'three'

export const VEHICLE_PART_MAPPING = {
  doorFrontLeft: 'doorFrontLeft',
  doorFrontRight: 'doorFrontRight',
  doorRearLeft: 'doorRearLeft',
  doorRearRight: 'doorRearRight',
  frunk: 'frunk',
  trunk: 'trunk',
  windowFrontLeft: 'windowFrontLeft',
  windowFrontRight: 'windowFrontRight',
  windowRearLeft: 'windowRearLeft',
  windowRearRight: 'windowRearRight',
  wheelFrontLeft: 'wheelFrontLeft',
  wheelFrontRight: 'wheelFrontRight',
  wheelRearLeft: 'wheelRearLeft',
  wheelRearRight: 'wheelRearRight',
  chargePort: 'chargePort',
  headlights: 'headlights',
  taillights: 'taillights',
} as const

export type VehiclePart = keyof typeof VEHICLE_PART_MAPPING
export type VehiclePartMapping = Readonly<Record<VehiclePart, string>>

export function bindVehicleParts(
  model: Object3D,
  mapping: VehiclePartMapping = VEHICLE_PART_MAPPING,
): Map<VehiclePart, Object3D> {
  const parts = new Map<VehiclePart, Object3D>()
  for (const part of Object.keys(mapping) as VehiclePart[]) {
    const node = model.getObjectByName(mapping[part])
    if (!node) continue
    node.userData.logicalPart = part
    parts.set(part, node)
  }
  return parts
}
