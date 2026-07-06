import { describe, it, expect } from 'vitest'
import {
  CHARGE_SESSION_STATES,
  CHARGE_SESSION_STATE_ENTRIES,
  CHARGE_SESSION_TRIGGERS,
  CHARGE_SESSION_GUARDS,
  CHARGE_SESSION_TRANSITIONS,
  CHARGE_SESSION_EDGES,
  CHARGE_SESSION_DISALLOWED,
  CHARGE_SESSION_COVERAGE,
  CHARGE_SESSION_SCENARIOS,
  CHARGE_SESSION_FSM,
} from '../charge-session'
import type {
  ChargeSessionState,
  ChargeSessionTrigger,
  ChargeSessionGuard,
  ChargeSignalContext,
} from '../charge-session'
import { deriveEdges, isValidTransition } from '../types'
import { VARIANT_THEME, resolveStyle } from '../theme'
import { FSM_REGISTRY, getStateColor, getStateDefinition } from '../registry'

const STATE_SET = new Set<string>(CHARGE_SESSION_STATES)
const TRIGGER_SET = new Set<string>(CHARGE_SESSION_TRIGGERS)
const GUARD_SET = new Set<string>(CHARGE_SESSION_GUARDS)
const edgeKey = (from: string, to: string) => `${from}\u2192${to}`

describe('charge-session — states', () => {
  it('declares exactly the five canonical states in order', () => {
    expect(CHARGE_SESSION_STATES).toEqual(['pending', 'active', 'completing', 'done', 'recovered'])
  })

  it('has no duplicate state names', () => {
    expect(new Set(CHARGE_SESSION_STATES).size).toBe(CHARGE_SESSION_STATES.length)
  })

  it('keeps the state-entry key set identical to the state list', () => {
    expect(Object.keys(CHARGE_SESSION_STATE_ENTRIES).sort()).toEqual([...CHARGE_SESSION_STATES].sort())
  })
})

describe('charge-session — state entries / theming', () => {
  it('gives every state a known badge variant', () => {
    for (const state of CHARGE_SESSION_STATES) {
      const entry = CHARGE_SESSION_STATE_ENTRIES[state]
      expect(Object.keys(VARIANT_THEME)).toContain(entry.variant)
    }
  })

  it('overrides the active state with a cyan tint over the success theme', () => {
    const entry = CHARGE_SESSION_STATE_ENTRIES.active
    expect(entry.variant).toBe('success')
    expect(entry.overrides?.text).toBe('text-cyan-400')
    expect(entry.overrides?.dot).toBe('bg-cyan-400')
  })

  it('overrides the recovered state with a purple tint over the neutral theme', () => {
    const entry = CHARGE_SESSION_STATE_ENTRIES.recovered
    expect(entry.variant).toBe('neutral')
    expect(entry.overrides?.badgeDot).toBe('bg-purple-400')
  })

  it('falls back to the shared variant theme for states without overrides', () => {
    expect(CHARGE_SESSION_STATE_ENTRIES.completing.overrides).toBeUndefined()
    expect(resolveStyle(CHARGE_SESSION_STATE_ENTRIES.completing)).toMatchObject(VARIANT_THEME.info)
  })
})

describe('charge-session — triggers & guards', () => {
  it('declares the seven expected triggers with no duplicates', () => {
    expect(CHARGE_SESSION_TRIGGERS).toHaveLength(7)
    expect(new Set(CHARGE_SESSION_TRIGGERS).size).toBe(7)
    expect(CHARGE_SESSION_TRIGGERS).toContain('start_snapshot_ready')
    expect(CHARGE_SESSION_TRIGGERS).toContain('charge_still_active')
  })

  it('only uses declared triggers in transitions', () => {
    for (const row of CHARGE_SESSION_TRANSITIONS)
      expect(TRIGGER_SET.has(row.trigger), `undeclared trigger ${row.trigger}`).toBe(true)
  })

  it('uses every declared trigger in at least one transition (no orphans)', () => {
    const used = new Set(CHARGE_SESSION_TRANSITIONS.map((r) => r.trigger))
    for (const trig of CHARGE_SESSION_TRIGGERS)
      expect(used.has(trig), `orphan trigger ${trig}`).toBe(true)
  })

  it('declares exactly the two guards and only uses declared ones', () => {
    expect([...CHARGE_SESSION_GUARDS]).toEqual(['has_charge_start_fields', 'has_charge_end_fields'])
    for (const row of CHARGE_SESSION_TRANSITIONS)
      if (row.guard !== null)
        expect(GUARD_SET.has(row.guard), `undeclared guard ${row.guard}`).toBe(true)
  })

  it('gates at least one transition per declared guard', () => {
    const used = new Set(CHARGE_SESSION_TRANSITIONS.map((r) => r.guard).filter((g): g is string => g !== null))
    for (const g of CHARGE_SESSION_GUARDS)
      expect(used.has(g), `unused guard ${g}`).toBe(true)
  })

  it('exposes state/trigger/guard names as usable string-literal types', () => {
    const s: ChargeSessionState = 'active'
    const t: ChargeSessionTrigger = 'charge_ending'
    const g: ChargeSessionGuard = 'has_charge_end_fields'
    expect(STATE_SET.has(s)).toBe(true)
    expect(TRIGGER_SET.has(t)).toBe(true)
    expect(GUARD_SET.has(g)).toBe(true)
  })
})

describe('charge-session — transitions', () => {
  it('has nine immediate rows between valid states', () => {
    expect(CHARGE_SESSION_TRANSITIONS).toHaveLength(9)
    for (const row of CHARGE_SESSION_TRANSITIONS) {
      expect(STATE_SET.has(row.from), `bad from ${row.from}`).toBe(true)
      expect(STATE_SET.has(row.to), `bad to ${row.to}`).toBe(true)
      expect(row.timing).toBe('immediate')
    }
  })

  it('contains no self-loops', () => {
    for (const row of CHARGE_SESSION_TRANSITIONS)
      expect(row.from === row.to, `self-loop on ${row.from}`).toBe(false)
  })

  it('gates the start transition on charge-start fields', () => {
    const start = CHARGE_SESSION_TRANSITIONS.find((r) => r.from === 'pending' && r.to === 'active')
    expect(start?.trigger).toBe('start_snapshot_ready')
    expect(start?.guard).toBe('has_charge_start_fields')
  })

  it('routes pod_restart from live states into recovered', () => {
    const restarts = CHARGE_SESSION_TRANSITIONS.filter((r) => r.trigger === 'pod_restart')
    expect(restarts.map((r) => r.from).sort()).toEqual(['active', 'pending'])
    for (const r of restarts) expect(r.to).toBe('recovered')
  })

  it('lets a recovered session either resume or finish', () => {
    const fromRecovered = CHARGE_SESSION_TRANSITIONS.filter((r) => r.from === 'recovered')
    expect(fromRecovered.map((r) => r.to).sort()).toEqual(['active', 'completing'])
  })
})

describe('charge-session — edges', () => {
  it('derives seven unique edges matching the exported edges', () => {
    expect(CHARGE_SESSION_EDGES).toHaveLength(7)
    expect(deriveEdges(CHARGE_SESSION_TRANSITIONS)).toEqual(CHARGE_SESSION_EDGES)
  })

  it('collapses duplicate from->to transition pairs into a single edge', () => {
    const rowKeys = CHARGE_SESSION_TRANSITIONS.map((r) => edgeKey(r.from, r.to))
    expect(rowKeys.filter((k) => k === edgeKey('active', 'completing'))).toHaveLength(2)
    expect(CHARGE_SESSION_EDGES.filter(([f, t]) => edgeKey(f, t) === edgeKey('active', 'completing'))).toHaveLength(1)
  })

  it('contains no duplicate edges', () => {
    const keys = CHARGE_SESSION_EDGES.map(([f, t]) => edgeKey(f, t))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('backs every edge with at least one transition row', () => {
    for (const [from, to] of CHARGE_SESSION_EDGES)
      expect(CHARGE_SESSION_TRANSITIONS.some((r) => r.from === from && r.to === to), edgeKey(from, to)).toBe(true)
  })
})

describe('charge-session — disallowed <-> coverage consistency', () => {
  it('lists four disallowed pairs, each with a reason and valid states', () => {
    expect(CHARGE_SESSION_DISALLOWED).toHaveLength(4)
    for (const d of CHARGE_SESSION_DISALLOWED) {
      expect(STATE_SET.has(d.from) && STATE_SET.has(d.to), edgeKey(d.from, d.to)).toBe(true)
      expect(d.reason.length).toBeGreaterThan(0)
    }
  })

  it('never provides a transition row or edge for a disallowed pair', () => {
    for (const d of CHARGE_SESSION_DISALLOWED) {
      expect(CHARGE_SESSION_TRANSITIONS.some((r) => r.from === d.from && r.to === d.to)).toBe(false)
      expect(CHARGE_SESSION_EDGES.some(([f, t]) => f === d.from && t === d.to)).toBe(false)
    }
  })

  it('marks every disallowed pair as "disallowed" in the coverage matrix', () => {
    for (const d of CHARGE_SESSION_DISALLOWED)
      expect(CHARGE_SESSION_COVERAGE[d.from][d.to], edgeKey(d.from, d.to)).toBe('disallowed')
  })
})

describe('charge-session — coverage matrix', () => {
  it('defines all twenty-five cells with a self diagonal', () => {
    let cells = 0
    for (const from of CHARGE_SESSION_STATES)
      for (const to of CHARGE_SESSION_STATES) {
        expect(CHARGE_SESSION_COVERAGE[from][to], edgeKey(from, to)).not.toBeUndefined()
        cells++
      }
    expect(cells).toBe(25)
    for (const s of CHARGE_SESSION_STATES) expect(CHARGE_SESSION_COVERAGE[s][s]).toBe('self')
  })

  it('keeps valid cells and transition rows in lockstep', () => {
    for (const from of CHARGE_SESSION_STATES)
      for (const to of CHARGE_SESSION_STATES) {
        if (from === to) continue
        const hasRow = CHARGE_SESSION_TRANSITIONS.some((r) => r.from === from && r.to === to)
        if (CHARGE_SESSION_COVERAGE[from][to] === 'valid')
          expect(hasRow, `valid ${edgeKey(from, to)} without a row`).toBe(true)
        if (hasRow)
          expect(CHARGE_SESSION_COVERAGE[from][to], `row ${edgeKey(from, to)} not marked valid`).toBe('valid')
      }
  })

  it('returns valid / self / disallowed / null through isValidTransition', () => {
    expect(isValidTransition(CHARGE_SESSION_COVERAGE, 'pending', 'active')).toBe('valid')
    expect(isValidTransition(CHARGE_SESSION_COVERAGE, 'active', 'active')).toBe('self')
    expect(isValidTransition(CHARGE_SESSION_COVERAGE, 'active', 'pending')).toBe('disallowed')
    expect(isValidTransition(CHARGE_SESSION_COVERAGE, 'completing', 'recovered')).toBeNull()
  })

  it('treats done as terminal (no outgoing valid transitions)', () => {
    const outgoingValid = Object.entries(CHARGE_SESSION_COVERAGE.done).filter(
      ([to, cell]) => to !== 'done' && cell === 'valid',
    )
    expect(outgoingValid).toHaveLength(0)
    expect(CHARGE_SESSION_TRANSITIONS.some((r) => r.from === 'done')).toBe(false)
  })
})

describe('charge-session — scenarios', () => {
  it('provides ten scenarios with unique ids and valid states', () => {
    expect(CHARGE_SESSION_SCENARIOS).toHaveLength(10)
    const ids = CHARGE_SESSION_SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of CHARGE_SESSION_SCENARIOS)
      for (const st of s.transitions)
        expect(STATE_SET.has(st), `${s.id}: invalid state ${st}`).toBe(true)
  })

  it('walks only valid edges in every multi-step scenario', () => {
    const edges = new Set(CHARGE_SESSION_EDGES.map(([f, t]) => edgeKey(f, t)))
    for (const s of CHARGE_SESSION_SCENARIOS)
      for (let i = 0; i < s.transitions.length - 1; i++) {
        const k = edgeKey(s.transitions[i], s.transitions[i + 1])
        expect(edges.has(k), `${s.id}: ${k} is not a valid edge`).toBe(true)
      }
  })

  it('covers both the happy-path and pod-restart recovery journeys', () => {
    const c1 = CHARGE_SESSION_SCENARIOS.find((s) => s.id === 'C1')
    const c3 = CHARGE_SESSION_SCENARIOS.find((s) => s.id === 'C3')
    expect(c1?.transitions).toEqual(['pending', 'active', 'completing', 'done'])
    expect(c3?.transitions).toEqual(['active', 'recovered', 'active'])
  })

  it('allows single-state scenarios (handshake fail / cell-balance dwell)', () => {
    expect(CHARGE_SESSION_SCENARIOS.filter((s) => s.transitions.length === 1).length).toBeGreaterThanOrEqual(1)
  })
})

describe('charge-session — FSM assembly & registry integration', () => {
  it('wires every sub-structure into the FSM definition by reference', () => {
    expect(CHARGE_SESSION_FSM.states).toBe(CHARGE_SESSION_STATE_ENTRIES)
    expect(CHARGE_SESSION_FSM.edges).toBe(CHARGE_SESSION_EDGES)
    expect(CHARGE_SESSION_FSM.transitions).toBe(CHARGE_SESSION_TRANSITIONS)
    expect(CHARGE_SESSION_FSM.disallowed).toBe(CHARGE_SESSION_DISALLOWED)
    expect(CHARGE_SESSION_FSM.coverage).toBe(CHARGE_SESSION_COVERAGE)
    expect(CHARGE_SESSION_FSM.scenarios).toBe(CHARGE_SESSION_SCENARIOS)
  })

  it('registers itself under charge_session in the FSM registry', () => {
    expect(FSM_REGISTRY.charge_session).toBe(CHARGE_SESSION_FSM)
  })

  it('resolves state colors through the registry helpers (case-insensitive)', () => {
    expect(getStateColor('charge_session', 'active').text).toBe('text-cyan-400')
    expect(getStateColor('charge_session', 'ACTIVE').text).toBe('text-cyan-400')
    expect(getStateDefinition('charge_session', 'recovered').variant).toBe('neutral')
  })

  it('falls back to the default neutral style for an unknown state', () => {
    expect(getStateColor('charge_session', 'nonexistent').dot).toBe(VARIANT_THEME.neutral.dot)
  })
})

describe('charge-session — ChargeSignalContext shape', () => {
  it('accepts a fully-populated SI context object', () => {
    const ctx: ChargeSignalContext = {
      startBattery: 42,
      startRange: 180,
      startLatitude: 37.42,
      startLongitude: -122.08,
      endBattery: 80,
      endRange: 320,
      energyAdded: 18_500,
      chargerType: 'DC',
      maxVoltage: 400,
      maxCurrent: 250,
      maxPower: 100_000,
    }
    expect(ctx.chargerType).toBe('DC')
    expect(ctx.endBattery - ctx.startBattery).toBe(38)
  })

  it('permits both AC and DC charger types', () => {
    const ac: ChargeSignalContext['chargerType'] = 'AC'
    const dc: ChargeSignalContext['chargerType'] = 'DC'
    expect([ac, dc]).toEqual(['AC', 'DC'])
  })
})
