import { describe, expect, it, vi } from 'vitest'
import { Group, Mesh, Vector3 } from 'three'
import { createVehicleModel, disposeVehicleModel } from './createVehicleModel'

describe('original vehicle model', () => {
  it('provides every separately named movable part without a downloaded asset or WebGL context', () => {
    const model = createVehicleModel()
    for (const suffix of ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight']) {
      for (const prefix of ['door', 'window', 'wheel']) {
        expect(model.getObjectByName(`${prefix}${suffix}`)).toBeInstanceOf(Group)
      }
    }
    for (const name of ['frunk', 'trunk', 'chargePort', 'headlights', 'taillights']) {
      expect(model.getObjectByName(name)).toBeInstanceOf(Group)
    }
    expect(model.getObjectByName('doorFrontLeft')!.userData.state).toBe('unknown')
    disposeVehicleModel(model)
  })

  it('keeps each window attached to its door as the hinge turns', () => {
    const model = createVehicleModel()
    for (const suffix of ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight']) {
      const door = model.getObjectByName(`door${suffix}`)!
      const window = model.getObjectByName(`window${suffix}`)!
      expect(window.parent).toBe(door)
      const before = window.getWorldPosition(new Vector3())
      door.rotation.y = Math.PI / 3
      model.updateMatrixWorld(true)
      expect(window.getWorldPosition(new Vector3()).distanceTo(before)).toBeGreaterThan(.1)
    }
    disposeVehicleModel(model)
  })

  it('disposes shared GPU resources once and detaches every model child', () => {
    const model = createVehicleModel()
    const geometries = new Set<Mesh['geometry']>()
    const materials = new Set<Mesh['material']>()
    model.traverse(object => {
      if (object instanceof Mesh) {
        geometries.add(object.geometry)
        materials.add(object.material)
      }
    })
    const geometryDisposals = [...geometries].map(geometry => vi.spyOn(geometry, 'dispose'))
    const materialDisposals = [...materials].flatMap(material =>
      (Array.isArray(material) ? material : [material]).map(value => vi.spyOn(value, 'dispose')),
    )
    disposeVehicleModel(model)
    expect(geometryDisposals.every(spy => spy.mock.calls.length === 1)).toBe(true)
    expect(materialDisposals.every(spy => spy.mock.calls.length === 1)).toBe(true)
    expect(model.children).toHaveLength(0)
  })
})
