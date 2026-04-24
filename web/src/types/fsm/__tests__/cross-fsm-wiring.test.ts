import { describe, it, expect } from 'vitest'
import { VEHICLE_TRANSITION_ACTIONS } from '../cross-fsm'
import { VEHICLE_EDGES, VEHICLE_COVERAGE } from '../vehicle'
import type { VehicleState } from '../vehicle'
import { isValidTransition } from '../types'

describe('Cross-FSM wiring', () => {
  it('every wiring key is a valid edge', () => {
    const edges = new Set(VEHICLE_EDGES.map(([f,t]) => `${f}→${t}`))
    for (const k of Object.keys(VEHICLE_TRANSITION_ACTIONS))
      expect(edges.has(k), `"${k}" not a valid edge`).toBe(true)
  })

  it('→driving wires CreateDrive or ReconcileDrive', () => {
    for (const [k, a] of Object.entries(VEHICLE_TRANSITION_ACTIONS))
      if (k.endsWith('→driving'))
        expect(a.some(x => x.includes('Drive')), `${k} missing drive action`).toBe(true)
  })

  it('→charging wires CreateCharge or equivalent', () => {
    for (const [k, a] of Object.entries(VEHICLE_TRANSITION_ACTIONS))
      if (k.endsWith('→charging'))
        expect(a.some(x => x.includes('Charge')), `${k} missing charge action`).toBe(true)
  })

  it('driving→* wires FinalizeDrive', () => {
    for (const [k, a] of Object.entries(VEHICLE_TRANSITION_ACTIONS))
      if (k.startsWith('driving→'))
        expect(a.includes('FinalizeDriveSubFSM'), `${k} missing finalize`).toBe(true)
  })

  it('every wiring has PersistState + LogTransition', () => {
    for (const [k, a] of Object.entries(VEHICLE_TRANSITION_ACTIONS)) {
      expect(a, `${k} missing PersistState`).toContain('PersistState')
      expect(a, `${k} missing LogTransition`).toContain('LogTransition')
    }
  })
})

describe('isValidTransition', () => {
  it('valid', () => expect(isValidTransition(VEHICLE_COVERAGE, 'online' as VehicleState, 'driving' as VehicleState)).toBe('valid'))
  it('disallowed', () => expect(isValidTransition(VEHICLE_COVERAGE, 'driving' as VehicleState, 'asleep' as VehicleState)).toBe('disallowed'))
  it('self', () => expect(isValidTransition(VEHICLE_COVERAGE, 'online' as VehicleState, 'online' as VehicleState)).toBe('self'))
  it('null', () => expect(isValidTransition(VEHICLE_COVERAGE, 'updating' as VehicleState, 'driving' as VehicleState)).toBeNull())
})
