/**
 * vehicle FSM — direct, whole-module coverage for every export of
 * `src/types/fsm/vehicle.ts`.
 *
 * The sibling registry-level suites (transition-integrity, coverage-matrix,
 * truth-table, …) validate the vehicle FSM *indirectly* through FSM_REGISTRY.
 * This suite pins the same contracts *directly* against the source module — so
 * a regression in vehicle.ts is caught here first, at the unit boundary, and
 * with stronger, trigger-level assertions than the registry sweep can express.
 *
 * It also pins the one behaviour the hardening pass corrected:
 *   DOC-DRIFT: `deriveVehicleStatus`'s JSDoc claimed an "offline fallback", but
 *   the function (and its tested twin in api/types.ts) returns 'online' when a
 *   state object exists yet carries no stronger signal — the API responded, so
 *   the vehicle is at least online. The comment was wrong, not the code; the
 *   fallback branch is now asserted so it can never silently flip.
 *
 * These are pure data + one pure function — no network, DOM, router, or timers —
 * so direct calls are the right tool (matching the repo convention in
 * features/.../vehicle-detail/helpers.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { deriveEdges } from '../types'
import type { BadgeVariant, CoverageCell } from '../types'
import {
  VEHICLE_STATES,
  VEHICLE_STATE_ENTRIES,
  VEHICLE_STATE_LABELS,
  VEHICLE_TRIGGERS,
  VEHICLE_GUARDS,
  VEHICLE_TRANSITIONS,
  VEHICLE_DISALLOWED,
  VEHICLE_DISALLOWED_PATTERNS,
  VEHICLE_COVERAGE,
  VEHICLE_TRUTH_TABLE,
  VEHICLE_SCENARIOS,
  VEHICLE_EDGES,
  VEHICLE_FSM,
  deriveVehicleStatus,
} from '../vehicle'
import type { VehicleSignalContext } from '../vehicle'

const BADGE_VARIANTS = new Set<BadgeVariant>(['success', 'warning', 'danger', 'info', 'neutral'])
const stateSet = new Set<string>(VEHICLE_STATES)
const triggerSet = new Set<string>(VEHICLE_TRIGGERS)
const guardSet = new Set<string>(VEHICLE_GUARDS)

describe('VEHICLE_STATES', () => {
  it('is the exact 7-state operational union, in order', () => {
    expect(VEHICLE_STATES).toEqual([
      'online', 'driving', 'charging', 'parked', 'updating', 'asleep', 'offline',
    ])
  })

  it('contains no duplicates', () => {
    expect(new Set(VEHICLE_STATES).size).toBe(VEHICLE_STATES.length)
  })
})

describe('VEHICLE_STATE_ENTRIES', () => {
  it('has one entry per state and no extras', () => {
    expect(Object.keys(VEHICLE_STATE_ENTRIES).sort()).toEqual([...VEHICLE_STATES].sort())
  })

  it('assigns a valid BadgeVariant to every state', () => {
    for (const s of VEHICLE_STATES)
      expect(BADGE_VARIANTS.has(VEHICLE_STATE_ENTRIES[s].variant), `${s}`).toBe(true)
  })

  it('gives driving the blue badge-dot override that distinguishes it from online', () => {
    // Both are the "success" variant; driving must visually diverge (blue tint).
    expect(VEHICLE_STATE_ENTRIES.online.variant).toBe('success')
    expect(VEHICLE_STATE_ENTRIES.driving.variant).toBe('success')
    expect(VEHICLE_STATE_ENTRIES.driving.overrides?.badgeDot).toBe('bg-blue-500')
  })

  it('routes offline text through the theme muted var (not a hardcoded gray)', () => {
    expect(VEHICLE_STATE_ENTRIES.offline.overrides?.text).toBe('text-[var(--text-muted)]')
  })
})

describe('VEHICLE_STATE_LABELS', () => {
  it('labels every state with a non-empty, capitalised string', () => {
    for (const s of VEHICLE_STATES) {
      const label = VEHICLE_STATE_LABELS[s]
      expect(label.length, `${s}`).toBeGreaterThan(0)
      expect(label[0]).toBe(label[0].toUpperCase())
    }
  })

  it('has no state without a label', () => {
    expect(Object.keys(VEHICLE_STATE_LABELS).sort()).toEqual([...VEHICLE_STATES].sort())
  })
})

describe('VEHICLE_TRIGGERS / VEHICLE_GUARDS', () => {
  it('declares 13 unique triggers', () => {
    expect(VEHICLE_TRIGGERS).toHaveLength(13)
    expect(new Set(VEHICLE_TRIGGERS).size).toBe(13)
  })

  it('declares 9 unique guards', () => {
    expect(VEHICLE_GUARDS).toHaveLength(9)
    expect(new Set(VEHICLE_GUARDS).size).toBe(9)
  })
})

describe('VEHICLE_TRANSITIONS', () => {
  it('is the documented 50-row table', () => {
    expect(VEHICLE_TRANSITIONS).toHaveLength(50)
  })

  it('references only valid states, triggers, guards and timings', () => {
    for (const r of VEHICLE_TRANSITIONS) {
      expect(stateSet.has(r.from), `from ${r.from}`).toBe(true)
      expect(stateSet.has(r.to), `to ${r.to}`).toBe(true)
      expect(triggerSet.has(r.trigger), `trigger ${r.trigger}`).toBe(true)
      expect(r.guard === null || guardSet.has(r.guard), `guard ${r.guard}`).toBe(true)
      expect(['immediate', 'debounced']).toContain(r.timing)
    }
  })

  it('contains no self-loops', () => {
    for (const r of VEHICLE_TRANSITIONS)
      expect(r.from === r.to, `self-loop on ${r.from}`).toBe(false)
  })

  it('never emits a row for a disallowed pair', () => {
    for (const d of VEHICLE_DISALLOWED)
      expect(
        VEHICLE_TRANSITIONS.some((r) => r.from === d.from && r.to === d.to),
        `${d.from}->${d.to}`,
      ).toBe(false)
  })
})

describe('VEHICLE_DISALLOWED / VEHICLE_DISALLOWED_PATTERNS', () => {
  it('forbids exactly the two moving-vehicle transitions, each with a reason', () => {
    expect(VEHICLE_DISALLOWED).toHaveLength(2)
    const pairs = VEHICLE_DISALLOWED.map((d) => `${d.from}->${d.to}`)
    expect(pairs).toContain('driving->asleep')
    expect(pairs).toContain('driving->updating')
    for (const d of VEHICLE_DISALLOWED) expect(d.reason.length).toBeGreaterThan(0)
  })

  it('documents three narrative disallowed patterns as non-empty prose', () => {
    expect(VEHICLE_DISALLOWED_PATTERNS).toHaveLength(3)
    for (const p of VEHICLE_DISALLOWED_PATTERNS) expect(p.length).toBeGreaterThan(0)
  })
})

describe('VEHICLE_COVERAGE', () => {
  it('covers every state pair with a legal cell value', () => {
    const legal = new Set<CoverageCell>(['valid', 'disallowed', 'self', null])
    for (const from of VEHICLE_STATES)
      for (const to of VEHICLE_STATES)
        expect(legal.has(VEHICLE_COVERAGE[from][to]), `[${from}][${to}]`).toBe(true)
  })

  it('marks the diagonal — and only the diagonal — as "self"', () => {
    for (const from of VEHICLE_STATES)
      for (const to of VEHICLE_STATES) {
        const cell = VEHICLE_COVERAGE[from][to]
        if (from === to) expect(cell, `[${from}]`).toBe('self')
        else expect(cell, `[${from}][${to}]`).not.toBe('self')
      }
  })

  it('backs every "valid" cell with a transition row', () => {
    for (const from of VEHICLE_STATES)
      for (const to of VEHICLE_STATES) {
        if (from === to) continue
        if (VEHICLE_COVERAGE[from][to] === 'valid')
          expect(
            VEHICLE_TRANSITIONS.some((r) => r.from === from && r.to === to),
            `${from}->${to} valid but no row`,
          ).toBe(true)
      }
  })

  it('gives every "disallowed" cell a matching VEHICLE_DISALLOWED entry and no row', () => {
    for (const from of VEHICLE_STATES)
      for (const to of VEHICLE_STATES) {
        if (VEHICLE_COVERAGE[from][to] !== 'disallowed') continue
        expect(
          VEHICLE_DISALLOWED.some((d) => d.from === from && d.to === to),
          `${from}->${to} disallowed cell without entry`,
        ).toBe(true)
        expect(
          VEHICLE_TRANSITIONS.some((r) => r.from === from && r.to === to),
          `${from}->${to} disallowed but row exists`,
        ).toBe(false)
      }
  })

  it('maps every transition row to a "valid" coverage cell', () => {
    for (const r of VEHICLE_TRANSITIONS)
      expect(VEHICLE_COVERAGE[r.from][r.to], `${r.from}->${r.to}`).toBe('valid')
  })
})

describe('VEHICLE_TRUTH_TABLE', () => {
  it('defines all 7 × 13 = 91 (state, trigger) cells', () => {
    let n = 0
    for (const s of VEHICLE_STATES)
      for (const t of VEHICLE_TRIGGERS) {
        expect(VEHICLE_TRUTH_TABLE[s][t], `[${s}][${t}]`).toBeDefined()
        n++
      }
    expect(n).toBe(91)
  })

  it('backs every transition cell with a row that shares from, trigger AND target', () => {
    // Stronger than the registry sweep: the trigger must match too, not just from->to.
    for (const s of VEHICLE_STATES)
      for (const t of VEHICLE_TRIGGERS) {
        const cell = VEHICLE_TRUTH_TABLE[s][t]
        if (cell.action !== 'transition') continue
        expect(stateSet.has(cell.to), `[${s}][${t}]->${cell.to}`).toBe(true)
        expect(
          VEHICLE_TRANSITIONS.some(
            (r) => r.from === s && r.trigger === t && r.to === cell.to,
          ),
          `[${s}][${t}]->${cell.to} has no matching row`,
        ).toBe(true)
      }
  })

  it('treats "updating" as terminal — every trigger is not_applicable', () => {
    for (const t of VEHICLE_TRIGGERS)
      expect(VEHICLE_TRUTH_TABLE.updating[t].action, `${t}`).toBe('not_applicable')
  })

  it('gives every disallowed cell a non-empty reason', () => {
    for (const s of VEHICLE_STATES)
      for (const t of VEHICLE_TRIGGERS) {
        const cell = VEHICLE_TRUTH_TABLE[s][t]
        if (cell.action === 'disallowed') expect(cell.reason.length).toBeGreaterThan(0)
      }
  })
})

describe('VEHICLE_SCENARIOS', () => {
  it('carries at least the 35 reference scenarios with unique ids', () => {
    expect(VEHICLE_SCENARIOS.length).toBeGreaterThanOrEqual(35)
    const ids = VEHICLE_SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is fully walkable — every consecutive pair is a real FSM edge', () => {
    const edges = new Set(VEHICLE_EDGES.map(([f, t]) => `${f}->${t}`))
    for (const sc of VEHICLE_SCENARIOS) {
      for (const st of sc.transitions) expect(stateSet.has(st), `${sc.id}: ${st}`).toBe(true)
      for (let i = 0; i < sc.transitions.length - 1; i++) {
        const key = `${sc.transitions[i]}->${sc.transitions[i + 1]}`
        expect(edges.has(key), `${sc.id}: ${key} not an edge`).toBe(true)
      }
    }
  })
})

describe('VEHICLE_EDGES', () => {
  it('equals deriveEdges(VEHICLE_TRANSITIONS) — 29 de-duplicated edges', () => {
    const derived = deriveEdges(VEHICLE_TRANSITIONS)
    expect(VEHICLE_EDGES).toEqual(derived)
    expect(VEHICLE_EDGES).toHaveLength(29)
  })

  it('has unique, non-self edges between valid states', () => {
    const seen = new Set<string>()
    for (const [from, to] of VEHICLE_EDGES) {
      expect(stateSet.has(from) && stateSet.has(to), `${from}->${to}`).toBe(true)
      expect(from).not.toBe(to)
      const key = `${from}->${to}`
      expect(seen.has(key), `duplicate ${key}`).toBe(false)
      seen.add(key)
    }
  })
})

describe('VEHICLE_FSM', () => {
  it('wires each section to its exported source of truth', () => {
    expect(VEHICLE_FSM.states).toBe(VEHICLE_STATE_ENTRIES)
    expect(VEHICLE_FSM.edges).toBe(VEHICLE_EDGES)
    expect(VEHICLE_FSM.transitions).toBe(VEHICLE_TRANSITIONS)
    expect(VEHICLE_FSM.disallowed).toBe(VEHICLE_DISALLOWED)
    expect(VEHICLE_FSM.coverage).toBe(VEHICLE_COVERAGE)
    expect(VEHICLE_FSM.truthTable).toBe(VEHICLE_TRUTH_TABLE)
    expect(VEHICLE_FSM.scenarios).toBe(VEHICLE_SCENARIOS)
    expect(VEHICLE_FSM.labels).toBe(VEHICLE_STATE_LABELS)
  })
})

describe('VehicleSignalContext', () => {
  it('is satisfied by a fully-populated live-signal snapshot', () => {
    const ctx: VehicleSignalContext = {
      currentState: 'driving',
      isCharging: false,
      isPluggedIn: false,
      isGearCapable: true,
      hasSeenGearP: false,
      speed: 42,
      hvacOn: true,
      preconditionOn: false,
      sentryOn: false,
      wasActive: true,
    }
    expect(stateSet.has(ctx.currentState)).toBe(true)
    expect(typeof ctx.speed).toBe('number')
    expect(ctx.isGearCapable).toBe(true)
  })
})

describe('deriveVehicleStatus', () => {
  it('returns "offline" when no state object is present', () => {
    expect(deriveVehicleStatus(null)).toBe('offline')
    expect(deriveVehicleStatus(undefined)).toBe('offline')
  })

  it('prioritises charging over both a non-zero speed and the raw state field', () => {
    expect(
      deriveVehicleStatus({ is_charging: true, speed: 55, state: 'driving' }),
    ).toBe('charging')
  })

  it('derives "driving" from a positive speed when not charging', () => {
    expect(deriveVehicleStatus({ speed: 42 })).toBe('driving')
  })

  it('does not treat zero, negative or NaN speed as driving', () => {
    expect(deriveVehicleStatus({ speed: 0, state: 'online' })).toBe('online')
    expect(deriveVehicleStatus({ speed: -3, state: 'asleep' })).toBe('asleep')
    expect(deriveVehicleStatus({ speed: Number.NaN, state: 'parked' })).toBe('parked')
  })

  it('passes a recognised raw state through, case-insensitively', () => {
    expect(deriveVehicleStatus({ state: 'ASLEEP' })).toBe('asleep')
    expect(deriveVehicleStatus({ state: 'Offline' })).toBe('offline')
    expect(deriveVehicleStatus({ state: 'updating' })).toBe('updating')
  })

  it('defaults a reachable-but-uninformative state to "online" (not offline)', () => {
    // DOC-DRIFT regression: the JSDoc used to say "offline fallback"; the real
    // (and twin-tested) contract is "online" once a state object exists.
    expect(deriveVehicleStatus({})).toBe('online')
    expect(deriveVehicleStatus({ state: '' })).toBe('online')
    expect(deriveVehicleStatus({ state: 'wobble' })).toBe('online')
  })

  it('always returns a member of VEHICLE_STATES', () => {
    const inputs = [
      null,
      undefined,
      {},
      { is_charging: true },
      { speed: 10 },
      { state: 'asleep' },
      { state: 'nonsense' },
    ]
    for (const input of inputs)
      expect(stateSet.has(deriveVehicleStatus(input as Parameters<typeof deriveVehicleStatus>[0])))
        .toBe(true)
  })
})
