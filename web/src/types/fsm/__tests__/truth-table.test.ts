import { describe, it, expect } from 'vitest'
import { VEHICLE_STATES, VEHICLE_TRIGGERS, VEHICLE_TRUTH_TABLE, VEHICLE_TRANSITIONS } from '../vehicle'

describe('Vehicle truth table', () => {
  it('every (state, trigger) cell is defined', () => {
    for (const s of VEHICLE_STATES)
      for (const t of VEHICLE_TRIGGERS)
        expect(VEHICLE_TRUTH_TABLE[s]?.[t], `[${s}][${t}]`).toBeDefined()
  })

  it('total cells = 7 × 13 = 91', () => {
    let n = 0
    for (const s of VEHICLE_STATES)
      for (const t of VEHICLE_TRIGGERS)
        if (VEHICLE_TRUTH_TABLE[s]?.[t]) n++
    expect(n).toBe(91)
  })

  it('transition cells target valid states', () => {
    const valid = new Set<string>(VEHICLE_STATES)
    for (const s of VEHICLE_STATES)
      for (const t of VEHICLE_TRIGGERS) {
        const c = VEHICLE_TRUTH_TABLE[s]?.[t]
        if (c?.action === 'transition')
          expect(valid.has(c.to), `[${s}][${t}]→${c.to}`).toBe(true)
      }
  })

  it('transition cells have matching transition rows', () => {
    for (const s of VEHICLE_STATES)
      for (const t of VEHICLE_TRIGGERS) {
        const c = VEHICLE_TRUTH_TABLE[s]?.[t]
        if (c?.action === 'transition')
          expect(VEHICLE_TRANSITIONS.some(r => r.from === s && r.to === c.to),
            `[${s}][${t}]→${c.to} no row`).toBe(true)
      }
  })

  it('updating = all not_applicable', () => {
    for (const t of VEHICLE_TRIGGERS)
      expect(VEHICLE_TRUTH_TABLE.updating?.[t]?.action).toBe('not_applicable')
  })

  it('disallowed cells have reasons', () => {
    for (const s of VEHICLE_STATES)
      for (const t of VEHICLE_TRIGGERS) {
        const c = VEHICLE_TRUTH_TABLE[s]?.[t]
        if (c?.action === 'disallowed')
          expect(c.reason.length).toBeGreaterThan(0)
      }
  })
})
