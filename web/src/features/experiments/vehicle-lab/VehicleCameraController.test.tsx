import { beforeEach, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PerspectiveCamera, Vector3 } from 'three'
import VehicleCameraController from './VehicleCameraController'

const state = vi.hoisted(() => ({
  camera: null as PerspectiveCamera | null,
  invalidate: vi.fn(),
}))
vi.mock('@react-three/fiber', () => ({ useThree: () => state }))
vi.mock('@react-three/drei/core/OrbitControls', async () => {
  const { forwardRef } = await import('react')
  return { OrbitControls: forwardRef(() => null) }
})

beforeEach(() => {
  state.camera = new PerspectiveCamera()
  state.invalidate.mockClear()
})

it('moves to opposite ends and looks back toward the vehicle when front changes to rear', () => {
  const { rerender } = render(<VehicleCameraController preset="front" />)
  expect(state.camera!.position.z).toBeGreaterThan(0)
  expect(state.camera!.getWorldDirection(new Vector3()).z).toBeLessThan(0)
  rerender(<VehicleCameraController preset="rear" />)
  expect(state.camera!.position.z).toBeLessThan(0)
  expect(state.camera!.getWorldDirection(new Vector3()).z).toBeGreaterThan(0)
  expect(state.invalidate).toHaveBeenCalledTimes(2)
})

it('looks down from the top and lowers the eye to inspect tires', () => {
  const { rerender } = render(<VehicleCameraController preset="top" />)
  expect(state.camera!.getWorldDirection(new Vector3()).y).toBeLessThan(-.99)
  rerender(<VehicleCameraController preset="tires" />)
  expect(state.camera!.position.y).toBeLessThan(1)
  expect(state.camera!.getWorldDirection(new Vector3()).y).toBeLessThan(0)
  expect(state.invalidate).toHaveBeenCalledTimes(2)
})
