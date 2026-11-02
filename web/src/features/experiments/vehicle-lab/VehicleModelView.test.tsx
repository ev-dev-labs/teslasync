import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Group } from 'three'
import { DATA_VISUAL_COLORS } from '@/lib/colors'
import VehicleModelView from './VehicleModelView'
import { deriveVehicleLabState } from './vehicleLabState'

const h = vi.hoisted(() => ({
  reduce: false,
  frame: null as ((context: unknown, delta: number) => void) | null,
  model: null as Group | null,
  invalidate: vi.fn(),
}))
vi.mock('@react-three/fiber', () => ({
  useThree: () => h.invalidate,
  useFrame: (frame: (context: unknown, delta: number) => void) => { h.frame = frame },
}))
vi.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => ({ reduce: h.reduce }) }))
vi.mock('./model/createVehicleModel', async importOriginal => {
  const actual = await importOriginal<typeof import('./model/createVehicleModel')>()
  return {
    ...actual,
    createVehicleModel: (...args: Parameters<typeof actual.createVehicleModel>) => {
      h.model = actual.createVehicleModel(...args)
      return h.model
    },
  }
})

const palette = {
  body: DATA_VISUAL_COLORS.blue, trim: DATA_VISUAL_COLORS.canvasMuted,
  glass: DATA_VISUAL_COLORS.canvasMidnight, tyre: DATA_VISUAL_COLORS.canvasInk,
  headlight: DATA_VISUAL_COLORS.canvasWhite, taillight: DATA_VISUAL_COLORS.danger,
}

beforeEach(() => {
  h.reduce = false
  h.invalidate.mockClear()
})

it('moves to an observed opening in 400ms and stops requesting frames once settled', () => {
  const state = deriveVehicleLabState(null)
  state.doors.FrontLeft = 'open'
  renderHook(() => VehicleModelView({ palette, state }))
  const door = h.model!.getObjectByName('doorFrontLeft')!
  expect(door.rotation.y).toBe(0)
  act(() => h.frame!(null, .2))
  expect(door.rotation.y).toBeCloseTo(-.5)
  act(() => h.frame!(null, .2))
  expect(door.rotation.y).toBeCloseTo(-1)
  const settledCalls = h.invalidate.mock.calls.length
  act(() => h.frame!(null, .2))
  expect(h.invalidate).toHaveBeenCalledTimes(settledCalls)
})

it('reverses an interrupted opening from the current pose without snapping', () => {
  const closed = deriveVehicleLabState(null)
  closed.doors.FrontLeft = 'closed'
  const opened = { ...closed, doors: { ...closed.doors, FrontLeft: 'open' as const } }
  const { rerender } = renderHook(({ state }) => VehicleModelView({ palette, state }), { initialProps: { state: opened } })
  const door = h.model!.getObjectByName('doorFrontLeft')!
  act(() => h.frame!(null, .2))
  expect(door.rotation.y).toBeCloseTo(-.5)
  rerender({ state: closed })
  expect(door.rotation.y).toBeCloseTo(-.5)
  act(() => h.frame!(null, .4))
  expect(door.rotation.y).toBe(0)
})

it('jumps to the end pose with reduced motion and retains unknown instead of reporting closed', () => {
  h.reduce = true
  const state = deriveVehicleLabState(null)
  state.doors.RearRight = 'open'
  state.windows.FrontLeft = 'partial'
  renderHook(() => VehicleModelView({ palette, state }))
  expect(h.model!.getObjectByName('doorRearRight')!.rotation.y).toBe(1)
  expect(h.model!.getObjectByName('windowFrontLeft')!.position.y).toBeCloseTo(.37)
  expect(h.model!.getObjectByName('doorFrontLeft')!.userData.state).toBe('unknown')
  const calls = h.invalidate.mock.calls.length
  act(() => h.frame!(null, .4))
  expect(h.invalidate).toHaveBeenCalledTimes(calls)
})

it('selects a logical part when its child mesh receives a scene click', () => {
  const onSelect = vi.fn()
  const { result } = renderHook(() => VehicleModelView({ palette, state: deriveVehicleLabState(null), onSelect }))
  const object = h.model!.getObjectByName('frunk')!.children[0]
  const stopPropagation = vi.fn()
  act(() => result.current!.props.onClick({ object, stopPropagation }))
  expect(onSelect).toHaveBeenCalledWith('frunk')
  expect(stopPropagation).toHaveBeenCalledOnce()
})
