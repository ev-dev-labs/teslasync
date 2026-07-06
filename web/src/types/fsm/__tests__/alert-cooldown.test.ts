import { describe, it, expect } from 'vitest'
import {
  ALERT_COOLDOWN_STATES,
  ALERT_COOLDOWN_STATE_ENTRIES,
  ALERT_COOLDOWN_TRIGGERS,
  ALERT_COOLDOWN_GUARDS,
  ALERT_COOLDOWN_TRANSITIONS,
  ALERT_COOLDOWN_EDGES,
  ALERT_COOLDOWN_DISALLOWED,
  ALERT_COOLDOWN_COVERAGE,
  ALERT_COOLDOWN_SCENARIOS,
  ALERT_COOLDOWN_FSM,
} from '../alert-cooldown'
import type { AlertCooldownState, AlertCooldownConfig } from '../alert-cooldown'
import type { CoverageCell } from '../types'
import { deriveEdges, isValidTransition } from '../types'
import { VARIANT_THEME } from '../theme'
import { FSM_REGISTRY } from '../registry'

const key = (from: string, to: string) => `${from}\u2192${to}`
const LEGAL_CELLS: CoverageCell[] = ['valid', 'disallowed', 'self', null]

describe('ALERT_COOLDOWN_STATES', () => {
  it('exposes exactly armed/fired/suppressed in a stable order', () => {
    expect(ALERT_COOLDOWN_STATES).toEqual(['armed', 'fired', 'suppressed'])
  })

  it('contains no duplicate state names', () => {
    expect(new Set(ALERT_COOLDOWN_STATES).size).toBe(ALERT_COOLDOWN_STATES.length)
  })
})

describe('ALERT_COOLDOWN_STATE_ENTRIES', () => {
  it('defines one entry per declared state with the documented variant', () => {
    expect(Object.keys(ALERT_COOLDOWN_STATE_ENTRIES).sort()).toEqual([...ALERT_COOLDOWN_STATES].sort())
    expect(ALERT_COOLDOWN_STATE_ENTRIES.armed.variant).toBe('success')
    expect(ALERT_COOLDOWN_STATE_ENTRIES.fired.variant).toBe('danger')
    expect(ALERT_COOLDOWN_STATE_ENTRIES.suppressed.variant).toBe('warning')
  })

  it('uses only variants known to the shared theme', () => {
    for (const state of ALERT_COOLDOWN_STATES) {
      const variant = ALERT_COOLDOWN_STATE_ENTRIES[state].variant
      expect(VARIANT_THEME[variant], `unknown variant "${variant}" for ${state}`).toBeDefined()
    }
  })
})

describe('ALERT_COOLDOWN trigger and guard vocabulary', () => {
  it('declares the two documented triggers', () => {
    expect(ALERT_COOLDOWN_TRIGGERS).toEqual(['condition_met', 'cooldown_expired'])
  })

  it('declares the two documented guards', () => {
    expect(ALERT_COOLDOWN_GUARDS).toEqual(['within_cooldown', 'max_fires_per_hour'])
  })

  it('only uses triggers that belong to the declared vocabulary', () => {
    const declared = new Set<string>(ALERT_COOLDOWN_TRIGGERS)
    for (const row of ALERT_COOLDOWN_TRANSITIONS)
      expect(declared.has(row.trigger), `undeclared trigger "${row.trigger}"`).toBe(true)
  })

  it('only uses non-null guards that belong to the declared vocabulary', () => {
    const declared = new Set<string>(ALERT_COOLDOWN_GUARDS)
    for (const row of ALERT_COOLDOWN_TRANSITIONS)
      if (row.guard !== null)
        expect(declared.has(row.guard), `undeclared guard "${row.guard}"`).toBe(true)
  })
})

describe('ALERT_COOLDOWN_TRANSITIONS', () => {
  it('declares all five documented rows', () => {
    expect(ALERT_COOLDOWN_TRANSITIONS).toHaveLength(5)
  })

  it('references only valid states for from and to', () => {
    const valid = new Set<string>(ALERT_COOLDOWN_STATES)
    for (const row of ALERT_COOLDOWN_TRANSITIONS) {
      expect(valid.has(row.from), `bad from "${row.from}"`).toBe(true)
      expect(valid.has(row.to), `bad to "${row.to}"`).toBe(true)
    }
  })

  it('marks every transition as immediate', () => {
    for (const row of ALERT_COOLDOWN_TRANSITIONS)
      expect(row.timing).toBe('immediate')
  })

  it('fires unconditionally from armed on condition_met', () => {
    const row = ALERT_COOLDOWN_TRANSITIONS.find(r => r.from === 'armed' && r.trigger === 'condition_met')
    expect(row).toBeDefined()
    expect(row?.to).toBe('fired')
    expect(row?.guard).toBeNull()
  })

  it('suppresses a re-fire that is still within the cooldown window', () => {
    const row = ALERT_COOLDOWN_TRANSITIONS.find(r => r.from === 'fired' && r.trigger === 'condition_met')
    expect(row?.to).toBe('suppressed')
    expect(row?.guard).toBe('within_cooldown')
  })

  it('keeps a repeated in-cooldown condition in the suppressed self-loop', () => {
    const row = ALERT_COOLDOWN_TRANSITIONS.find(r => r.from === 'suppressed' && r.trigger === 'condition_met')
    expect(row?.to).toBe('suppressed')
    expect(row?.guard).toBe('within_cooldown')
  })

  it('re-arms from both fired and suppressed when the cooldown expires', () => {
    const targets = ALERT_COOLDOWN_TRANSITIONS
      .filter(r => r.trigger === 'cooldown_expired')
      .map(r => key(r.from, r.to))
    expect(targets).toContain(key('fired', 'armed'))
    expect(targets).toContain(key('suppressed', 'armed'))
  })
})

describe('ALERT_COOLDOWN_EDGES', () => {
  it('is exactly the deduplicated derivation of the transition table', () => {
    expect(ALERT_COOLDOWN_EDGES).toEqual(deriveEdges(ALERT_COOLDOWN_TRANSITIONS))
  })

  it('contains no duplicate directed edges', () => {
    const keys = ALERT_COOLDOWN_EDGES.map(([f, t]) => key(f, t))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('exposes the five unique directed edges of the FSM', () => {
    const keys = ALERT_COOLDOWN_EDGES.map(([f, t]) => key(f, t)).sort()
    expect(keys).toEqual(
      [
        key('armed', 'fired'),
        key('fired', 'armed'),
        key('fired', 'suppressed'),
        key('suppressed', 'armed'),
        key('suppressed', 'suppressed'),
      ].sort(),
    )
  })

  it('backs every edge with at least one transition row', () => {
    for (const [f, t] of ALERT_COOLDOWN_EDGES)
      expect(
        ALERT_COOLDOWN_TRANSITIONS.some(r => r.from === f && r.to === t),
        `orphan edge ${key(f, t)}`,
      ).toBe(true)
  })
})

describe('ALERT_COOLDOWN_DISALLOWED', () => {
  it('lists the two forbidden shortcuts', () => {
    const pairs = ALERT_COOLDOWN_DISALLOWED.map(d => key(d.from, d.to))
    expect(pairs).toContain(key('armed', 'suppressed'))
    expect(pairs).toContain(key('suppressed', 'fired'))
  })

  it('references only valid states and always explains why', () => {
    const valid = new Set<string>(ALERT_COOLDOWN_STATES)
    for (const d of ALERT_COOLDOWN_DISALLOWED) {
      expect(valid.has(d.from) && valid.has(d.to), `bad pair ${key(d.from, d.to)}`).toBe(true)
      expect(d.reason.length).toBeGreaterThan(0)
    }
  })

  it('never overlaps with a real transition row or derived edge', () => {
    for (const d of ALERT_COOLDOWN_DISALLOWED) {
      expect(
        ALERT_COOLDOWN_TRANSITIONS.some(r => r.from === d.from && r.to === d.to),
        `${key(d.from, d.to)} has a row`,
      ).toBe(false)
      expect(
        ALERT_COOLDOWN_EDGES.some(([f, t]) => f === d.from && t === d.to),
        `${key(d.from, d.to)} has an edge`,
      ).toBe(false)
    }
  })
})

describe('ALERT_COOLDOWN_COVERAGE', () => {
  it('populates every from x to cell with a legal coverage value', () => {
    for (const from of ALERT_COOLDOWN_STATES)
      for (const to of ALERT_COOLDOWN_STATES)
        expect(LEGAL_CELLS, `illegal cell at ${key(from, to)}`).toContain(ALERT_COOLDOWN_COVERAGE[from][to])
  })

  it('marks the diagonal as self', () => {
    for (const s of ALERT_COOLDOWN_STATES)
      expect(ALERT_COOLDOWN_COVERAGE[s][s]).toBe('self')
  })

  it('pairs every "valid" cell with a real transition row', () => {
    for (const from of ALERT_COOLDOWN_STATES)
      for (const to of ALERT_COOLDOWN_STATES) {
        if (from === to) continue
        if (ALERT_COOLDOWN_COVERAGE[from][to] === 'valid')
          expect(
            ALERT_COOLDOWN_TRANSITIONS.some(r => r.from === from && r.to === to),
            `valid ${key(from, to)} without a row`,
          ).toBe(true)
      }
  })

  it('lists every "disallowed" cell in the disallowed table with no backing row', () => {
    const disallowed = new Set(ALERT_COOLDOWN_DISALLOWED.map(d => key(d.from, d.to)))
    for (const from of ALERT_COOLDOWN_STATES)
      for (const to of ALERT_COOLDOWN_STATES)
        if (ALERT_COOLDOWN_COVERAGE[from][to] === 'disallowed') {
          expect(disallowed.has(key(from, to)), `${key(from, to)} missing from disallowed table`).toBe(true)
          expect(ALERT_COOLDOWN_TRANSITIONS.some(r => r.from === from && r.to === to)).toBe(false)
        }
  })

  it('classifies every transition row as valid, or self on the diagonal', () => {
    for (const r of ALERT_COOLDOWN_TRANSITIONS)
      expect(ALERT_COOLDOWN_COVERAGE[r.from][r.to]).toBe(r.from === r.to ? 'self' : 'valid')
  })
})

describe('isValidTransition against the cooldown coverage', () => {
  it('resolves representative valid, disallowed and self cells', () => {
    expect(isValidTransition(ALERT_COOLDOWN_COVERAGE, 'armed', 'fired')).toBe('valid')
    expect(isValidTransition(ALERT_COOLDOWN_COVERAGE, 'armed', 'suppressed')).toBe('disallowed')
    expect(isValidTransition(ALERT_COOLDOWN_COVERAGE, 'suppressed', 'suppressed')).toBe('self')
  })

  it('returns null for a state pair outside the matrix', () => {
    expect(isValidTransition(ALERT_COOLDOWN_COVERAGE, 'armed', 'nonexistent' as AlertCooldownState)).toBeNull()
  })
})

describe('ALERT_COOLDOWN_SCENARIOS', () => {
  it('documents the five reference walkthroughs with unique ids', () => {
    expect(ALERT_COOLDOWN_SCENARIOS).toHaveLength(5)
    const ids = ALERT_COOLDOWN_SCENARIOS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only steps through valid states', () => {
    const valid = new Set<string>(ALERT_COOLDOWN_STATES)
    for (const s of ALERT_COOLDOWN_SCENARIOS)
      for (const step of s.transitions)
        expect(valid.has(step), `${s.id}: invalid step "${step}"`).toBe(true)
  })

  it('walks only along declared edges', () => {
    const edges = new Set(ALERT_COOLDOWN_EDGES.map(([f, t]) => key(f, t)))
    for (const s of ALERT_COOLDOWN_SCENARIOS)
      for (let i = 0; i < s.transitions.length - 1; i++) {
        const step = key(s.transitions[i], s.transitions[i + 1])
        expect(edges.has(step), `${s.id}: ${step} is not a declared edge`).toBe(true)
      }
  })

  it('starts the first-fire scenario at armed then fired', () => {
    const first = ALERT_COOLDOWN_SCENARIOS.find(s => s.id === 'A1')
    expect(first?.transitions).toEqual(['armed', 'fired'])
  })
})

describe('ALERT_COOLDOWN_FSM aggregate', () => {
  it('wires the exact same constant instances', () => {
    expect(ALERT_COOLDOWN_FSM.states).toBe(ALERT_COOLDOWN_STATE_ENTRIES)
    expect(ALERT_COOLDOWN_FSM.edges).toBe(ALERT_COOLDOWN_EDGES)
    expect(ALERT_COOLDOWN_FSM.transitions).toBe(ALERT_COOLDOWN_TRANSITIONS)
    expect(ALERT_COOLDOWN_FSM.disallowed).toBe(ALERT_COOLDOWN_DISALLOWED)
    expect(ALERT_COOLDOWN_FSM.coverage).toBe(ALERT_COOLDOWN_COVERAGE)
    expect(ALERT_COOLDOWN_FSM.scenarios).toBe(ALERT_COOLDOWN_SCENARIOS)
  })

  it('is registered under the alert_cooldown key', () => {
    expect(FSM_REGISTRY.alert_cooldown).toBe(ALERT_COOLDOWN_FSM)
  })
})

describe('AlertCooldownConfig', () => {
  it('accepts a fully-specified cooldown policy', () => {
    const config: AlertCooldownConfig = {
      cooldownDuration: 300,
      maxFiresPerHour: 6,
      suppressInStates: ['asleep', 'offline'],
    }
    expect(config.cooldownDuration).toBe(300)
    expect(config.maxFiresPerHour).toBe(6)
    expect(config.suppressInStates).toContain('asleep')
    expect(config.suppressInStates).toHaveLength(2)
  })
})
