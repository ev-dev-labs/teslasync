import { expect, it } from 'vitest'
import { createVehicleModel, disposeVehicleModel } from './model/createVehicleModel'
import { bindVehicleParts, findVehiclePart, VEHICLE_PART_MAPPING } from './partMapping'

it('binds every original moving group to its logical identity for scene interaction', () => {
  const model = createVehicleModel()
  const parts = bindVehicleParts(model)
  expect(parts.size).toBe(17)
  for (const [part, node] of parts) {
    expect(node.name).toBe(VEHICLE_PART_MAPPING[part])
    expect(node.userData.logicalPart).toBe(part)
  }
  disposeVehicleModel(model)
})

it('skips an unavailable model node while retaining all other part bindings', () => {
  const model = createVehicleModel()
  model.getObjectByName('frunk')!.name = 'unmapped-lid'
  const parts = bindVehicleParts(model)
  expect(parts.has('frunk')).toBe(false)
  expect(parts.size).toBe(16)
  expect(parts.get('trunk')?.userData.logicalPart).toBe('trunk')
  disposeVehicleModel(model)
})

it('resolves a replacement node name through mapping without changing its logical identity', () => {
  const model = createVehicleModel()
  model.getObjectByName('doorFrontLeft')!.name = 'replacement-driver-hinge'
  const parts = bindVehicleParts(model, { ...VEHICLE_PART_MAPPING, doorFrontLeft: 'replacement-driver-hinge' })
  expect(parts.get('doorFrontLeft')?.name).toBe('replacement-driver-hinge')
  expect(parts.get('doorFrontLeft')?.userData.logicalPart).toBe('doorFrontLeft')
  expect(parts.size).toBe(17)
  disposeVehicleModel(model)
})

it('resolves a clicked mesh to its nearest logical part, including a door-attached window', () => {
  const model = createVehicleModel()
  const parts = bindVehicleParts(model)
  expect(findVehiclePart(parts.get('windowFrontLeft')!.children[0])).toBe('windowFrontLeft')
  expect(findVehiclePart(parts.get('doorRearRight')!.children[0])).toBe('doorRearRight')
  expect(findVehiclePart(model.getObjectByName('body')!.children[0])).toBeNull()
  expect(findVehiclePart(null)).toBeNull()
  disposeVehicleModel(model)
})
