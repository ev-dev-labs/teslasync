import { useEffect, useRef, useState } from 'react'
import type { Group, Object3D } from 'three'
import { createVehicleModel, disposeVehicleModel, type VehicleModelPalette } from './model/createVehicleModel'
import { bindVehicleParts, findVehiclePart, type VehiclePart } from './partMapping'
import { mapVehiclePartStates, type VehicleLabState } from './vehicleLabState'
import { useFrame, useThree } from '@react-three/fiber'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { applyPartPose, interpolatePartPose, vehiclePartPose, type PartPose } from './partMotion'

interface PartMotion {
  node: Object3D
  restY: number
  from: PartPose
  to: PartPose
}

export default function VehicleModelView({ palette, state, onSelect }: { palette: VehicleModelPalette; state: VehicleLabState; onSelect?: (part: VehiclePart) => void }) {
  const [model, setModel] = useState<Group | null>(null)
  const invalidate = useThree(context => context.invalidate)
  const { reduce } = useMotionPreference(400)
  const restHeights = useRef(new Map<VehiclePart, number>())
  const animation = useRef<{ elapsed: number; parts: PartMotion[] } | null>(null)
  useEffect(() => {
    const next = createVehicleModel(palette)
    restHeights.current = new Map([...bindVehicleParts(next)].map(([part, node]) => [part, node.position.y]))
    setModel(next)
    return () => { animation.current = null; disposeVehicleModel(next) }
  }, [palette])
  useEffect(() => {
    if (!model) return
    const states = mapVehiclePartStates(state)
    const motions: PartMotion[] = []
    for (const [part, node] of bindVehicleParts(model)) {
      node.userData.state = states[part]
      const restY = restHeights.current.get(part) ?? node.position.y
      const from = { rotationX: node.rotation.x, rotationY: node.rotation.y, dropM: restY - node.position.y }
      const to = vehiclePartPose(part, states[part])
      if (reduce) applyPartPose(node, restY, to)
      else if (from.rotationX !== to.rotationX || from.rotationY !== to.rotationY || from.dropM !== to.dropM) motions.push({ node, restY, from, to })
    }
    animation.current = motions.length ? { elapsed: 0, parts: motions } : null
    invalidate()
  }, [model, state, invalidate, reduce])
  useFrame((_context, delta) => {
    const motion = animation.current
    if (!motion) return
    motion.elapsed += delta
    const progress = motion.elapsed / .4
    for (const { node, restY, from, to } of motion.parts) applyPartPose(node, restY, interpolatePartPose(from, to, progress))
    if (progress >= 1) animation.current = null
    else invalidate()
  })
  return model ? <primitive object={model} dispose={null} onClick={(event: import('@react-three/fiber').ThreeEvent<MouseEvent>) => {
    const part = findVehiclePart(event.object)
    if (part) { event.stopPropagation(); onSelect?.(part) }
  }} /> : null
}
