import { expect, it } from 'vitest'
import { createVehicleModel, disposeVehicleModel } from './model/createVehicleModel'
import { bindVehicleParts } from './partMapping'
import { applyPartPose, interpolatePartPose, vehiclePartPose } from './partMotion'

it('opens opposing door hinges away from the cabin and raises both trunk lids', () => {
  expect(vehiclePartPose('doorFrontLeft', 'open').rotationY).toBeLessThan(0)
  expect(vehiclePartPose('doorRearRight', 'open').rotationY).toBeGreaterThan(0)
  expect(vehiclePartPose('frunk', 'open').rotationX).toBeLessThan(0)
  expect(vehiclePartPose('trunk', 'open').rotationX).toBeGreaterThan(0)
  expect(vehiclePartPose('chargePort', 'open').rotationY).toBeGreaterThan(0)
})

it('interpolates without overshoot and permits an immediate reduced-motion end pose', () => {
  const closed = vehiclePartPose('doorFrontLeft', 'closed')
  const open = vehiclePartPose('doorFrontLeft', 'open')
  expect(interpolatePartPose(closed, open, .5).rotationY).toBeCloseTo(open.rotationY / 2)
  expect(interpolatePartPose(closed, open, 1)).toEqual(open)
  expect(interpolatePartPose(closed, open, 10)).toEqual(open)
  expect(interpolatePartPose(closed, open, -1)).toEqual(closed)
})

it('lowers a partially open window halfway without losing its door parent, then restores it', () => {
  const model = createVehicleModel()
  const node = bindVehicleParts(model).get('windowFrontLeft')!
  const restY = node.position.y
  const parent = node.parent
  const partial = vehiclePartPose('windowFrontLeft', 'partial')
  expect(partial.dropM).toBe(vehiclePartPose('windowFrontLeft', 'open').dropM / 2)
  applyPartPose(node, restY, partial)
  expect(node.position.y).toBeLessThan(restY)
  expect(node.parent).toBe(parent)
  applyPartPose(node, restY, vehiclePartPose('windowFrontLeft', 'unknown'))
  expect(node.position.y).toBe(restY)
  disposeVehicleModel(model)
})
