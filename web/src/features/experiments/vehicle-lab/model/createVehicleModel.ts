import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from 'three'
import { DATA_VISUAL_COLORS } from '@/lib/colors'

export interface VehicleModelPalette {
  body: string
  trim: string
  glass: string
  tyre: string
  headlight: string
  taillight: string
}

const DEFAULT_PALETTE: VehicleModelPalette = {
  body: DATA_VISUAL_COLORS.blue,
  trim: DATA_VISUAL_COLORS.canvasMuted,
  glass: DATA_VISUAL_COLORS.canvasMidnight,
  tyre: DATA_VISUAL_COLORS.canvasInk,
  headlight: DATA_VISUAL_COLORS.canvasWhite,
  taillight: DATA_VISUAL_COLORS.danger,
}

type Position = readonly [number, number, number]

/** Original illustrative geometry in meters: +Y up, +Z forward, +X vehicle-left. */
export function createVehicleModel(palette: VehicleModelPalette = DEFAULT_PALETTE): Group {
  const root = new Group()
  root.name = 'original-studio-suv'
  root.userData.illustrative = true
  const paint = new MeshStandardMaterial({ color: palette.body, roughness: .38, metalness: .28, flatShading: true })
  const trim = new MeshStandardMaterial({ color: palette.trim, roughness: .6, metalness: .25 })
  const tyre = new MeshStandardMaterial({ color: palette.tyre, roughness: .92 })
  const glass = new MeshStandardMaterial({ color: palette.glass, transparent: true, opacity: .72, roughness: .15 })
  const headlight = new MeshStandardMaterial({ color: palette.headlight, emissive: palette.headlight, emissiveIntensity: 0 })
  const taillight = new MeshStandardMaterial({ color: palette.taillight, emissive: palette.taillight, emissiveIntensity: 0 })

  function part(name: string, position: Position, parent: Group = root): Group {
    const group = new Group()
    group.name = name
    group.position.set(...position)
    group.userData.state = 'unknown'
    parent.add(group)
    return group
  }

  function mesh(parent: Group, geometry: BufferGeometry, material: MeshStandardMaterial, position: Position): Mesh {
    const object = new Mesh(geometry, material)
    object.position.set(...position)
    object.castShadow = !material.transparent
    object.receiveShadow = !material.transparent
    parent.add(object)
    return object
  }

  function box(parent: Group, size: Position, material: MeshStandardMaterial, position: Position): Mesh {
    return mesh(parent, new BoxGeometry(...size), material, position)
  }

  const body = part('body', [0, 0, 0])
  box(body, [1.82, .55, 4.46], paint, [0, .79, 0])
  box(body, [1.93, .14, 4.12], tyre, [0, .53, 0])
  for (const z of [-2.25, 2.25]) box(body, [1.88, .22, .2], tyre, [0, .57, z])

  const cabin = part('cabin', [0, 0, 0])
  box(cabin, [1.68, .65, 2.62], paint, [0, 1.43, -.15])
  box(cabin, [1.73, .09, 2.72], trim, [0, 1.80, -.15])
  const windshield = box(cabin, [1.53, .52, .04], glass, [0, 1.47, 1.19])
  windshield.rotation.x = -.18
  box(cabin, [1.48, .48, .04], glass, [0, 1.48, -1.49]).rotation.x = .12

  const doors = [
    ['FrontLeft', .95, 1.19],
    ['FrontRight', -.95, 1.19],
    ['RearLeft', .95, -.05],
    ['RearRight', -.95, -.05],
  ] as const
  for (const [suffix, x, z] of doors) {
    const door = part(`door${suffix}`, [x, .98, z])
    box(door, [.09, .65, 1.11], paint, [0, 0, -.555])
    box(door, [.025, .04, .16], trim, [Math.sign(x) * .06, .17, -.85])
    // A window is a child of its door hinge, so both retain the same swing.
    const window = part(`window${suffix}`, [0, .56, -.555], door)
    box(window, [.04, .46, 1.04], glass, [0, 0, 0])
    box(door, [.075, .52, .055], trim, [0, .56, -.03])
  }

  const frunk = part('frunk', [0, 1.09, 1.14])
  box(frunk, [1.74, .08, 1.16], paint, [0, 0, .58])
  const trunk = part('trunk', [0, 1.72, -2.17])
  box(trunk, [1.68, 1.10, .09], paint, [0, -.55, 0])

  for (const [suffix, x, z] of [
    ['FrontLeft', 1.01, 1.50],
    ['FrontRight', -1.01, 1.50],
    ['RearLeft', 1.01, -1.50],
    ['RearRight', -1.01, -1.50],
  ] as const) {
    const wheel = part(`wheel${suffix}`, [x, .43, z])
    mesh(wheel, new CylinderGeometry(.43, .43, .28, 16), tyre, [0, 0, 0]).rotation.z = Math.PI / 2
    mesh(wheel, new CylinderGeometry(.28, .28, .30, 12), trim, [0, 0, 0]).rotation.z = Math.PI / 2
    const face = Math.sign(x) * .16
    box(wheel, [.02, .44, .07], tyre, [face, 0, 0])
    box(wheel, [.02, .07, .44], tyre, [face, 0, 0])
  }

  const chargePort = part('chargePort', [1.01, 1.15, -1.81])
  box(chargePort, [.055, .19, .23], trim, [0, 0, .115])
  const headlights = part('headlights', [0, .91, 2.28])
  const taillights = part('taillights', [0, .93, -2.29])
  for (const x of [-.56, .56]) box(headlights, [.54, .13, .04], headlight, [x, 0, 0])
  for (const x of [-.76, .76]) box(taillights, [.20, .38, .04], taillight, [x, 0, 0])
  root.updateMatrixWorld(true)
  return root
}

export function disposeVehicleModel(root: Group): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  root.traverse(object => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  root.clear()
}
