import type { Object3D } from 'three'
import type { VehiclePart } from './partMapping'
import type { PartState } from './vehicleLabState'

export interface PartPose {
  rotationX: number
  rotationY: number
  dropM: number
}

export function vehiclePartPose(part: VehiclePart, state: PartState): PartPose {
  const amount = state === 'open' ? 1 : state === 'partial' ? .5 : 0
  return {
    rotationX: part === 'frunk' ? -amount * .65 : part === 'trunk' ? amount * .85 : 0,
    rotationY: part.startsWith('door') ? amount * (part.endsWith('Left') ? -1 : 1)
      : part === 'chargePort' ? amount * 1.2 : 0,
    dropM: part.startsWith('window') ? amount * .38 : 0,
  }
}

export function interpolatePartPose(from: PartPose, to: PartPose, progress: number): PartPose {
  const clamped = Math.max(0, Math.min(1, progress))
  const amount = clamped * clamped * (3 - 2 * clamped)
  return {
    rotationX: from.rotationX + (to.rotationX - from.rotationX) * amount,
    rotationY: from.rotationY + (to.rotationY - from.rotationY) * amount,
    dropM: from.dropM + (to.dropM - from.dropM) * amount,
  }
}

export function applyPartPose(node: Object3D, restY: number, pose: PartPose): void {
  node.rotation.x = pose.rotationX
  node.rotation.y = pose.rotationY
  node.position.y = restY - pose.dropM
}
