import { describe, it, expect } from 'vitest'
import {
  VEHICLE_TRANSITION_ACTIONS,
  FAILURE_ISOLATION_RULES,
  OUT_OF_SCOPE_STATES,
  getTransitionActions,
  type FSMAction,
} from '../cross-fsm'
import { VEHICLE_EDGES, VEHICLE_COVERAGE, VEHICLE_STATES } from '../vehicle'
import type { VehicleState } from '../vehicle'

// The wiring keys use a U+2192 RIGHTWARDS ARROW as the from/to separator.
// Build keys via this constant so the test matches the source byte-for-byte
// regardless of editor encoding.
const ARROW = '\u2192'
const key = (from: VehicleState, to: VehicleState) => `${from}${ARROW}${to}` as const

// The complete FSMAction vocabulary. Typed as FSMAction[] so `tsc --noEmit`
// fails if a member is renamed/removed in the source union.
const ALL_ACTIONS: FSMAction[] = [
  'CreateDriveSubFSM',
  'FinalizeDriveSubFSM',
  'ReconcileDriveSubFSM',
  'CreateChargeSubFSM',
  'FinalizeChargeSubFSM',
  'ReconcileChargeSubFSM',
  'ResumeOrCreateChargeSubFSM',
  'PauseChargeSubFSM',
  'MarkChargeInterrupted',
  'PersistState',
  'LogTransition',
]

const DRIVE_CREATE: FSMAction[] = ['CreateDriveSubFSM', 'ReconcileDriveSubFSM']
const CHARGE_CREATE: FSMAction[] = [
  'CreateChargeSubFSM',
  'ResumeOrCreateChargeSubFSM',
  'ReconcileChargeSubFSM',
]

const entries = Object.entries(VEHICLE_TRANSITION_ACTIONS).map(
  ([k, acts]) => {
    const [from, to] = k.split(ARROW) as [VehicleState, VehicleState]
    return { k, from, to, acts: acts ?? [] }
  },
)

describe('VEHICLE_TRANSITION_ACTIONS — structural integrity', () => {
  const edgeSet = new Set(VEHICLE_EDGES.map(([f, t]) => key(f, t)))

  it('is a non-empty map of transition → action list', () => {
    expect(entries.length).toBeGreaterThan(0)
    for (const { k, acts } of entries) {
      expect(Array.isArray(acts), `${k} should map to an array`).toBe(true)
      expect(acts.length, `${k} should have at least one action`).toBeGreaterThan(0)
    }
  })

  it('every key is a valid derived edge (from/to are real states, no self-loops)', () => {
    for (const { k, from, to } of entries) {
      expect(VEHICLE_STATES).toContain(from)
      expect(VEHICLE_STATES).toContain(to)
      expect(from, `${k} must not be a self-loop`).not.toBe(to)
      expect(edgeSet.has(key(from, to)), `${k} is not a valid edge`).toBe(true)
    }
  })

  it('only uses actions from the FSMAction vocabulary', () => {
    for (const { k, acts } of entries) {
      for (const a of acts) {
        expect(ALL_ACTIONS, `${k} uses unknown action "${a}"`).toContain(a)
      }
    }
  })

  it('every entry ends with PersistState then LogTransition, each exactly once', () => {
    for (const { k, acts } of entries) {
      expect(acts.slice(-2), `${k} must end with persist+log`).toEqual([
        'PersistState',
        'LogTransition',
      ])
      expect(acts.filter((a) => a === 'PersistState').length, `${k} PersistState count`).toBe(1)
      expect(acts.filter((a) => a === 'LogTransition').length, `${k} LogTransition count`).toBe(1)
    }
  })

  it('exercises the entire FSMAction vocabulary across all entries', () => {
    const used = new Set(entries.flatMap((e) => e.acts))
    for (const a of ALL_ACTIONS) {
      expect(used.has(a), `action "${a}" is never wired`).toBe(true)
    }
  })
})

describe('VEHICLE_TRANSITION_ACTIONS — cross-FSM semantics (mirror backend manageSubFSMs)', () => {
  it('drive-create actions appear only when entering driving; finalize-drive only when leaving', () => {
    for (const { k, from, to, acts } of entries) {
      const createsDrive = acts.some((a) => DRIVE_CREATE.includes(a))
      const finalizesDrive = acts.includes('FinalizeDriveSubFSM')
      if (createsDrive) expect(to, `${k} creates a drive but does not enter driving`).toBe('driving')
      if (finalizesDrive) expect(from, `${k} finalizes a drive but does not leave driving`).toBe('driving')
    }
  })

  it('charge lifecycle actions match the charging direction', () => {
    for (const { k, from, to, acts } of entries) {
      const createsCharge = acts.some((a) => CHARGE_CREATE.includes(a))
      const endsCharge =
        acts.includes('FinalizeChargeSubFSM') || acts.includes('PauseChargeSubFSM')
      if (createsCharge) expect(to, `${k} creates a charge but does not enter charging`).toBe('charging')
      if (endsCharge) expect(from, `${k} ends a charge but does not leave charging`).toBe('charging')
      // MarkChargeInterrupted only ever fires when leaving charging.
      if (acts.includes('MarkChargeInterrupted')) expect(from).toBe('charging')
    }
  })

  it('every transition entering driving creates or reconciles a drive sub-FSM', () => {
    for (const { k, from, to, acts } of entries) {
      if (to === 'driving' && from !== 'driving') {
        expect(acts.some((a) => DRIVE_CREATE.includes(a)), `${k} missing drive create`).toBe(true)
        expect(acts.includes('FinalizeDriveSubFSM'), `${k} must not finalize the drive it starts`).toBe(false)
      }
    }
  })

  it('every transition leaving driving finalizes the drive sub-FSM', () => {
    for (const { k, from, to, acts } of entries) {
      if (from === 'driving' && to !== 'driving') {
        expect(acts.includes('FinalizeDriveSubFSM'), `${k} missing FinalizeDriveSubFSM`).toBe(true)
      }
    }
  })

  it('every transition entering charging creates/resumes a charge sub-FSM', () => {
    for (const { k, from, to, acts } of entries) {
      if (to === 'charging' && from !== 'charging') {
        expect(acts.some((a) => CHARGE_CREATE.includes(a)), `${k} missing charge create`).toBe(true)
      }
    }
  })

  it('every transition leaving charging finalizes or pauses the charge sub-FSM', () => {
    for (const { k, from, to, acts } of entries) {
      if (from === 'charging' && to !== 'charging') {
        const ended = acts.includes('FinalizeChargeSubFSM') || acts.includes('PauseChargeSubFSM')
        expect(ended, `${k} missing charge finalize/pause`).toBe(true)
      }
    }
  })
})

describe('VEHICLE_TRANSITION_ACTIONS — completeness vs VEHICLE_COVERAGE', () => {
  // Every VALID coverage edge that touches driving or charging must be wired,
  // otherwise a real transition would silently skip its sub-FSM lifecycle.
  const requiredEdges: string[] = []
  for (const from of VEHICLE_STATES) {
    for (const to of VEHICLE_STATES) {
      if (from === to) continue
      const cell = VEHICLE_COVERAGE[from][to]
      const touchesSession =
        from === 'driving' || to === 'driving' || from === 'charging' || to === 'charging'
      if (cell === 'valid' && touchesSession) requiredEdges.push(key(from, to))
    }
  }

  it('has a wiring entry for every valid session-touching edge', () => {
    expect(requiredEdges.length).toBeGreaterThan(0)
    for (const e of requiredEdges) {
      expect(Object.prototype.hasOwnProperty.call(VEHICLE_TRANSITION_ACTIONS, e), `missing wiring for ${e}`).toBe(true)
    }
  })

  it('regression: driving→online is wired and finalizes the drive (soft red-light stop)', () => {
    // driving→online (speed_zero + no_gear, debounced) is a valid edge; the Go
    // backend finalizes the drive on ANY exit from driving, so it must be wired.
    const acts = getTransitionActions('driving', 'online')
    expect(acts).toContain('FinalizeDriveSubFSM')
    expect(acts.slice(-2)).toEqual(['PersistState', 'LogTransition'])
  })
})

describe('getTransitionActions', () => {
  it('returns the wired actions for a known transition', () => {
    expect(getTransitionActions('online', 'driving')).toEqual([
      'CreateDriveSubFSM',
      'PersistState',
      'LogTransition',
    ])
  })

  it('returns the multi-action list for a driving→charging handover', () => {
    expect(getTransitionActions('driving', 'charging')).toEqual([
      'FinalizeDriveSubFSM',
      'CreateChargeSubFSM',
      'PersistState',
      'LogTransition',
    ])
  })

  it('returns an empty array (never undefined) for an unwired but valid edge', () => {
    // online→parked is a valid transition with no sub-FSM side effects.
    const acts = getTransitionActions('online', 'parked')
    expect(acts).toEqual([])
    expect(acts).not.toBeUndefined()
  })

  it('returns an empty array for a nonsensical transition and is safe to iterate', () => {
    const acts = getTransitionActions('updating', 'updating')
    expect(acts).toEqual([])
    // Null-safety contract: callers can map/length without guarding.
    expect(acts.map((a) => a).length).toBe(0)
  })

  it('agrees with the underlying map for every declared key', () => {
    for (const { from, to, acts } of entries) {
      expect(getTransitionActions(from, to)).toEqual(acts)
    }
  })
})

describe('FAILURE_ISOLATION_RULES', () => {
  it('lists the three isolation guarantees as non-empty strings', () => {
    expect(FAILURE_ISOLATION_RULES).toHaveLength(3)
    for (const rule of FAILURE_ISOLATION_RULES) {
      expect(typeof rule).toBe('string')
      expect(rule.trim().length).toBeGreaterThan(0)
    }
  })

  it('every rule expresses isolation (NOT / no effect)', () => {
    for (const rule of FAILURE_ISOLATION_RULES) {
      expect(rule, `"${rule}" should express isolation`).toMatch(/\bnot\b|no effect/i)
    }
  })

  it('covers sub-FSM panic, notification, and command isolation', () => {
    const joined = FAILURE_ISOLATION_RULES.join('\n')
    expect(joined).toContain('Sub-FSM panic')
    expect(joined).toContain('recover()')
    expect(joined).toContain('Notification failure')
    expect(joined).toContain('Command failure')
  })
})

describe('OUT_OF_SCOPE_STATES', () => {
  it('lists well-formed {state, reason} records', () => {
    expect(OUT_OF_SCOPE_STATES.length).toBeGreaterThan(0)
    for (const entry of OUT_OF_SCOPE_STATES) {
      expect(entry.state.trim().length, 'state must be non-empty').toBeGreaterThan(0)
      expect(entry.reason.trim().length, 'reason must be non-empty').toBeGreaterThan(0)
    }
  })

  it('includes the known unmodelled states with unique names', () => {
    const states = OUT_OF_SCOPE_STATES.map((s) => s.state)
    expect(states).toContain('Fault')
    expect(states).toContain('Updating')
    expect(new Set(states).size, 'states must be unique').toBe(states.length)
  })

  it('every reason explains that a new top-level state is required', () => {
    for (const entry of OUT_OF_SCOPE_STATES) {
      expect(entry.reason, `${entry.state} reason`).toContain('new top-level state')
    }
  })

  it('does not overlap with the states the Vehicle FSM already models', () => {
    const modelled = new Set<string>(VEHICLE_STATES.map((s) => s.toLowerCase()))
    for (const entry of OUT_OF_SCOPE_STATES) {
      // 'Updating' is a display-only Tesla state, not an FSM-managed one, so it
      // is intentionally excluded from this overlap guard.
      if (entry.state === 'Updating') continue
      expect(modelled.has(entry.state.toLowerCase()), `${entry.state} should be out of scope`).toBe(false)
    }
  })
})
