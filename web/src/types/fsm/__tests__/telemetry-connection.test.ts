import { describe, it, expect } from 'vitest'
import {
  TELEMETRY_CONNECTION_STATES,
  TELEMETRY_CONNECTION_STATE_ENTRIES,
  TELEMETRY_CONNECTION_TRIGGERS,
  TELEMETRY_CONNECTION_TRANSITIONS,
  TELEMETRY_CONNECTION_EDGES,
  TELEMETRY_CONNECTION_FSM,
  type TelemetryConnectionState,
} from '../telemetry-connection'
import { deriveEdges, type BadgeVariant } from '../types'
import { resolveStyle, VARIANT_THEME, DEFAULT_STATE } from '../theme'
import { FSM_REGISTRY, getStateColor, getStateDefinition } from '../registry'

/**
 * Behavioural + structural contract for the Telemetry-Connection FSM.
 *
 * This module is pure data (state table, transition table, derived edges,
 * assembled FSM) with no React surface, so the suite pins the *invariants* a
 * consumer of the FSM relies on: exhaustive state/variant coverage, a fully
 * enumerated transition topology, edge-derivation correctness, graph liveness
 * (reachability + recovery), and integration with the shared FSM registry
 * (theme resolution via getStateColor / getStateDefinition).
 */

const VALID_VARIANTS: readonly BadgeVariant[] = ['success', 'warning', 'danger', 'info', 'neutral']
const FSM_KEY = 'telemetry_connection'

/** Semantic mapping the UI depends on — locked so an accidental re-colour fails loudly. */
const EXPECTED_VARIANTS: Record<TelemetryConnectionState, BadgeVariant> = {
  unknown: 'neutral',
  connecting: 'warning',
  streaming: 'success',
  stale: 'warning',
  disconnected: 'danger',
  polling_only: 'info',
}

/** The complete, intended transition topology. */
const EXPECTED_TRANSITIONS: [TelemetryConnectionState, TelemetryConnectionState][] = [
  ['unknown', 'connecting'],
  ['unknown', 'polling_only'],
  ['connecting', 'streaming'],
  ['connecting', 'stale'],
  ['connecting', 'disconnected'],
  ['streaming', 'stale'],
  ['streaming', 'disconnected'],
  ['stale', 'streaming'],
  ['stale', 'disconnected'],
  ['disconnected', 'streaming'],
  ['polling_only', 'streaming'],
]

const hasTransition = (from: TelemetryConnectionState, to: TelemetryConnectionState): boolean =>
  TELEMETRY_CONNECTION_TRANSITIONS.some((row) => row.from === from && row.to === to)

function buildAdjacency(): Map<TelemetryConnectionState, TelemetryConnectionState[]> {
  const adjacency = new Map<TelemetryConnectionState, TelemetryConnectionState[]>()
  for (const [from, to] of TELEMETRY_CONNECTION_EDGES) {
    const list = adjacency.get(from) ?? []
    list.push(to)
    adjacency.set(from, list)
  }
  return adjacency
}

/** BFS over the derived edge set — returns every state reachable from `start`. */
function reachableFrom(start: TelemetryConnectionState): Set<TelemetryConnectionState> {
  const adjacency = buildAdjacency()
  const seen = new Set<TelemetryConnectionState>([start])
  const queue: TelemetryConnectionState[] = [start]
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const next of adjacency.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

describe('TELEMETRY_CONNECTION_STATES', () => {
  it('lists exactly the six known connection states, in order', () => {
    expect([...TELEMETRY_CONNECTION_STATES]).toEqual([
      'unknown',
      'connecting',
      'streaming',
      'stale',
      'disconnected',
      'polling_only',
    ])
  })

  it('contains no duplicate state names', () => {
    expect(new Set(TELEMETRY_CONNECTION_STATES).size).toBe(TELEMETRY_CONNECTION_STATES.length)
  })

  it('starts from the "unknown" bootstrap state', () => {
    expect(TELEMETRY_CONNECTION_STATES[0]).toBe('unknown')
  })
})

describe('TELEMETRY_CONNECTION_STATE_ENTRIES', () => {
  it('defines an entry for every declared state and no extras', () => {
    expect(Object.keys(TELEMETRY_CONNECTION_STATE_ENTRIES).sort()).toEqual(
      [...TELEMETRY_CONNECTION_STATES].sort(),
    )
    for (const state of TELEMETRY_CONNECTION_STATES) {
      expect(TELEMETRY_CONNECTION_STATE_ENTRIES[state]).toBeDefined()
    }
  })

  it('assigns only valid badge variants', () => {
    for (const state of TELEMETRY_CONNECTION_STATES) {
      expect(VALID_VARIANTS).toContain(TELEMETRY_CONNECTION_STATE_ENTRIES[state].variant)
    }
  })

  it('maps connection health to the expected semantic variant', () => {
    for (const state of TELEMETRY_CONNECTION_STATES) {
      expect(TELEMETRY_CONNECTION_STATE_ENTRIES[state].variant).toBe(EXPECTED_VARIANTS[state])
    }
  })

  it('resolves every entry to a complete Tailwind style set', () => {
    for (const state of TELEMETRY_CONNECTION_STATES) {
      const style = resolveStyle(TELEMETRY_CONNECTION_STATE_ENTRIES[state])
      expect(style.badgeDot.length).toBeGreaterThan(0)
      expect(style.bg.length).toBeGreaterThan(0)
      expect(style.text.length).toBeGreaterThan(0)
      expect(style.dot.length).toBeGreaterThan(0)
    }
  })

  it('resolves the healthy "streaming" state to the shared success theme', () => {
    expect(resolveStyle(TELEMETRY_CONNECTION_STATE_ENTRIES.streaming)).toMatchObject(
      VARIANT_THEME.success,
    )
  })

  it('declares no per-state style overrides (variant theme is sufficient)', () => {
    for (const state of TELEMETRY_CONNECTION_STATES) {
      expect(TELEMETRY_CONNECTION_STATE_ENTRIES[state].overrides).toBeUndefined()
    }
  })
})

describe('TELEMETRY_CONNECTION_TRIGGERS', () => {
  it('exposes exactly the single "manual" trigger', () => {
    expect([...TELEMETRY_CONNECTION_TRIGGERS]).toEqual(['manual'])
  })

  it('is the only trigger referenced by any transition row', () => {
    for (const row of TELEMETRY_CONNECTION_TRANSITIONS) {
      expect(TELEMETRY_CONNECTION_TRIGGERS).toContain(row.trigger)
    }
  })
})

describe('TELEMETRY_CONNECTION_TRANSITIONS', () => {
  it('references only declared states for from/to', () => {
    const valid = new Set<string>(TELEMETRY_CONNECTION_STATES)
    for (const row of TELEMETRY_CONNECTION_TRANSITIONS) {
      expect(valid.has(row.from), `bad from "${row.from}"`).toBe(true)
      expect(valid.has(row.to), `bad to "${row.to}"`).toBe(true)
    }
  })

  it('never declares a self-loop', () => {
    for (const row of TELEMETRY_CONNECTION_TRANSITIONS) {
      expect(row.from === row.to, `self-loop on "${row.from}"`).toBe(false)
    }
  })

  it('uses only immediate timing and null guards (this FSM is unguarded)', () => {
    for (const row of TELEMETRY_CONNECTION_TRANSITIONS) {
      expect(row.timing).toBe('immediate')
      expect(row.guard).toBeNull()
    }
  })

  it('contains no duplicate from→to pairs', () => {
    const keys = TELEMETRY_CONNECTION_TRANSITIONS.map((row) => `${row.from}→${row.to}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('wires the full documented transition topology and nothing more', () => {
    for (const [from, to] of EXPECTED_TRANSITIONS) {
      expect(hasTransition(from, to), `missing ${from}→${to}`).toBe(true)
    }
    expect(TELEMETRY_CONNECTION_TRANSITIONS).toHaveLength(EXPECTED_TRANSITIONS.length)
  })

  it('gives every state an outgoing transition (no dead-end states)', () => {
    const withOutgoing = new Set(TELEMETRY_CONNECTION_TRANSITIONS.map((row) => row.from))
    for (const state of TELEMETRY_CONNECTION_STATES) {
      expect(withOutgoing.has(state), `"${state}" has no outgoing transition`).toBe(true)
    }
  })
})

describe('TELEMETRY_CONNECTION_EDGES', () => {
  it('equals the edges derived from the transition table', () => {
    expect(TELEMETRY_CONNECTION_EDGES).toEqual(deriveEdges(TELEMETRY_CONNECTION_TRANSITIONS))
  })

  it('deduplicates to one edge per from→to pair', () => {
    const keys = TELEMETRY_CONNECTION_EDGES.map(([from, to]) => `${from}→${to}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(TELEMETRY_CONNECTION_EDGES).toHaveLength(EXPECTED_TRANSITIONS.length)
  })

  it('backs every edge with a real transition row', () => {
    for (const [from, to] of TELEMETRY_CONNECTION_EDGES) {
      expect(hasTransition(from, to), `orphan edge ${from}→${to}`).toBe(true)
    }
  })
})

describe('telemetry connection graph liveness', () => {
  it('reaches every state from the "unknown" bootstrap state', () => {
    const reachable = reachableFrom('unknown')
    expect(reachable.size).toBe(TELEMETRY_CONNECTION_STATES.length)
    for (const state of TELEMETRY_CONNECTION_STATES) {
      expect(reachable.has(state), `"${state}" unreachable from unknown`).toBe(true)
    }
  })

  it('lets every state recover back to "streaming"', () => {
    for (const state of TELEMETRY_CONNECTION_STATES) {
      expect(reachableFrom(state).has('streaming'), `"${state}" cannot reach streaming`).toBe(true)
    }
  })

  it('never transitions back into the initial "unknown" state', () => {
    const incoming = TELEMETRY_CONNECTION_TRANSITIONS.filter((row) => row.to === 'unknown')
    expect(incoming).toHaveLength(0)
  })
})

describe('TELEMETRY_CONNECTION_FSM', () => {
  it('wires the state, edge, and transition tables together', () => {
    expect(TELEMETRY_CONNECTION_FSM.states).toBe(TELEMETRY_CONNECTION_STATE_ENTRIES)
    expect(TELEMETRY_CONNECTION_FSM.edges).toBe(TELEMETRY_CONNECTION_EDGES)
    expect(TELEMETRY_CONNECTION_FSM.transitions).toBe(TELEMETRY_CONNECTION_TRANSITIONS)
  })

  it('is registered under "telemetry_connection" in the shared FSM registry', () => {
    expect(FSM_REGISTRY[FSM_KEY]).toBe(TELEMETRY_CONNECTION_FSM)
  })
})

describe('registry theme integration', () => {
  it('resolves colours for healthy and failed states from the shared theme', () => {
    expect(getStateColor(FSM_KEY, 'streaming')).toEqual(VARIANT_THEME.success)
    expect(getStateColor(FSM_KEY, 'disconnected')).toEqual(VARIANT_THEME.danger)
  })

  it('is case-insensitive when resolving a state colour', () => {
    expect(getStateColor(FSM_KEY, 'STREAMING')).toEqual(getStateColor(FSM_KEY, 'streaming'))
  })

  it('falls back to the default (neutral) style for an unknown state name', () => {
    const { badgeDot, bg, text, dot } = DEFAULT_STATE
    // toMatchObject: assert the four themed style classes resolve to the
    // neutral default without over-asserting the exact key set (getStateColor's
    // fallback branch returns the shared DEFAULT_STATE reference verbatim).
    expect(getStateColor(FSM_KEY, 'not_a_real_state')).toMatchObject({ badgeDot, bg, text, dot })
    expect(getStateColor(FSM_KEY, 'not_a_real_state').text).toBe(DEFAULT_STATE.text)
  })

  it('exposes the semantic badge variant through getStateDefinition', () => {
    expect(getStateDefinition(FSM_KEY, 'disconnected').variant).toBe('danger')
    expect(getStateDefinition(FSM_KEY, 'polling_only').variant).toBe('info')
    expect(getStateDefinition(FSM_KEY, 'streaming').variant).toBe('success')
  })
})
