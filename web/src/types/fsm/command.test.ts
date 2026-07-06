// Command-FSM data-integrity tests.
//
// `command.ts` is a pure declarative FSM definition — no components or hooks —
// so "elevating" it means locking in the machine's invariants and keeping its
// parallel data structures (transitions ⇄ edges ⇄ coverage ⇄ disallowed) in
// sync. Every runtime export is exercised:
//   - COMMAND_STATES / COMMAND_STATE_ENTRIES  — the 10-state alphabet + styling.
//   - COMMAND_TRIGGERS / COMMAND_GUARDS        — declared vocabulary, all used.
//   - COMMAND_TRANSITIONS                       — well-formed + deterministic.
//   - COMMAND_EDGES                             — deduped projection of the rows.
//   - COMMAND_DISALLOWED                        — forbidden pairs, reasoned.
//   - COMMAND_COVERAGE                          — full matrix; the six
//       'disallowed' cells mirror COMMAND_DISALLOWED (the bug this suite fixed:
//       they were previously plain `null`, so isValidTransition() could not
//       distinguish "forbidden" from "no edge").
//   - COMMAND_TOASTS                            — user-facing copy per state.
//   - COMMAND_SCENARIOS                         — happy/edge walk-throughs.
//   - COMMAND_FSM                               — the assembled definition.
// The type-level exports (CommandState / CommandTrigger / CommandGuard) are
// exercised through typed fixtures + the membership contracts.

import { describe, it, expect } from 'vitest'
import {
  COMMAND_STATES,
  COMMAND_STATE_ENTRIES,
  COMMAND_TRIGGERS,
  COMMAND_GUARDS,
  COMMAND_TRANSITIONS,
  COMMAND_EDGES,
  COMMAND_DISALLOWED,
  COMMAND_COVERAGE,
  COMMAND_TOASTS,
  COMMAND_SCENARIOS,
  COMMAND_FSM,
} from './command'
import type { CommandState, CommandTrigger, CommandGuard } from './command'
import { deriveEdges, isValidTransition } from './types'
import type { BadgeVariant } from './types'

type Row = (typeof COMMAND_TRANSITIONS)[number]

const STATE_SET = new Set<string>(COMMAND_STATES)
const TRIGGER_SET = new Set<string>(COMMAND_TRIGGERS)
const GUARD_SET = new Set<string>(COMMAND_GUARDS)

const VALID_VARIANTS: readonly BadgeVariant[] = ['success', 'warning', 'danger', 'info', 'neutral']
const OVERRIDE_KEYS: readonly string[] = ['badgeDot', 'bg', 'text', 'dot']

/** Terminal states: no outgoing transition may leave them. */
const TERMINAL: readonly CommandState[] = ['succeeded', 'gave_up']
/** The command lifecycle always begins here; nothing transitions back into it. */
const INITIAL: CommandState = 'queued'

const edgeKey = (from: string, to: string) => `${from}->${to}`
const EDGE_KEYS = new Set(COMMAND_EDGES.map(([f, t]) => edgeKey(f, t)))

/** BFS over the edge list, returning every state reachable from `start`. */
function reachableFrom(start: CommandState): Set<CommandState> {
  const adjacency = new Map<CommandState, CommandState[]>()
  for (const [from, to] of COMMAND_EDGES) {
    const next = adjacency.get(from) ?? []
    next.push(to)
    adjacency.set(from, next)
  }
  const seen = new Set<CommandState>([start])
  const queue: CommandState[] = [start]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    for (const neighbour of adjacency.get(current) ?? []) {
      if (!seen.has(neighbour)) {
        seen.add(neighbour)
        queue.push(neighbour)
      }
    }
  }
  return seen
}

describe('COMMAND_STATES', () => {
  it('enumerates exactly ten unique, non-empty states', () => {
    expect(COMMAND_STATES).toHaveLength(10)
    expect(new Set(COMMAND_STATES).size).toBe(10)
    for (const state of COMMAND_STATES) expect(state.length).toBeGreaterThan(0)
  })

  it('contains both terminal states and the initial state', () => {
    expect(COMMAND_STATES).toContain(INITIAL)
    for (const terminal of TERMINAL) expect(COMMAND_STATES).toContain(terminal)
  })
})

describe('COMMAND_STATE_ENTRIES', () => {
  it('provides exactly one entry per declared state — no missing or stray keys', () => {
    expect(Object.keys(COMMAND_STATE_ENTRIES).sort()).toEqual([...COMMAND_STATES].sort())
  })

  it('assigns every entry a valid semantic badge variant', () => {
    for (const state of COMMAND_STATES) {
      expect(VALID_VARIANTS).toContain(COMMAND_STATE_ENTRIES[state].variant)
    }
  })

  it('restricts style overrides to the four known StateStyle keys', () => {
    for (const state of COMMAND_STATES) {
      const { overrides } = COMMAND_STATE_ENTRIES[state]
      if (!overrides) continue
      for (const key of Object.keys(overrides)) expect(OVERRIDE_KEYS).toContain(key)
    }
  })

  it('overrides the theme for the four attention states with a Tailwind tint', () => {
    for (const state of ['wake_timeout', 'timed_out', 'retrying', 'gave_up'] as const) {
      expect(COMMAND_STATE_ENTRIES[state].overrides?.bg).toMatch(/^bg-/)
    }
  })
})

describe('COMMAND_TRIGGERS', () => {
  it('lists eleven unique triggers', () => {
    expect(COMMAND_TRIGGERS).toHaveLength(11)
    expect(new Set(COMMAND_TRIGGERS).size).toBe(11)
  })

  it('declares every trigger that a transition row actually uses', () => {
    for (const row of COMMAND_TRANSITIONS) expect(TRIGGER_SET.has(row.trigger)).toBe(true)
  })

  it('uses every declared trigger at least once (no dead vocabulary)', () => {
    const used = new Set(COMMAND_TRANSITIONS.map((row) => row.trigger))
    for (const trigger of COMMAND_TRIGGERS) expect(used.has(trigger)).toBe(true)
  })
})

describe('COMMAND_GUARDS', () => {
  it('lists six unique guards', () => {
    expect(COMMAND_GUARDS).toHaveLength(6)
    expect(new Set(COMMAND_GUARDS).size).toBe(6)
  })

  it('declares every guard that a transition row references', () => {
    for (const row of COMMAND_TRANSITIONS) {
      if (row.guard !== null) expect(GUARD_SET.has(row.guard)).toBe(true)
    }
  })

  it('uses every declared guard at least once', () => {
    const used = new Set(
      COMMAND_TRANSITIONS.map((row) => row.guard).filter((g): g is string => g !== null),
    )
    for (const guard of COMMAND_GUARDS) expect(used.has(guard)).toBe(true)
  })

  it('pairs each retry guard with its complementary exhausted guard', () => {
    for (const [left, right] of [
      ['wake_retries_left', 'wake_retries_exhausted'],
      ['retries_left', 'retries_exhausted'],
      ['retryable', 'non_retryable'],
    ] as const) {
      expect(COMMAND_GUARDS).toContain(left)
      expect(COMMAND_GUARDS).toContain(right)
    }
  })
})

describe('COMMAND_TRANSITIONS', () => {
  it('holds sixteen rows that all reference valid states', () => {
    expect(COMMAND_TRANSITIONS).toHaveLength(16)
    for (const row of COMMAND_TRANSITIONS) {
      expect(STATE_SET.has(row.from)).toBe(true)
      expect(STATE_SET.has(row.to)).toBe(true)
    }
  })

  it('never self-loops and always uses immediate timing', () => {
    for (const row of COMMAND_TRANSITIONS) {
      expect(row.from).not.toBe(row.to)
      expect(row.timing).toBe('immediate')
    }
  })

  it('is deterministic: a (from,trigger) branch is either single or fully guarded with distinct guards', () => {
    const groups = new Map<string, Row[]>()
    for (const row of COMMAND_TRANSITIONS) {
      const key = `${row.from}|${row.trigger}`
      const rows = groups.get(key) ?? []
      rows.push(row)
      groups.set(key, rows)
    }
    let branchingGroups = 0
    for (const [key, rows] of groups) {
      if (rows.length === 1) continue
      branchingGroups += 1
      const guards = rows.map((r) => r.guard)
      for (const guard of guards) expect(guard, `${key} branch has a null guard`).not.toBeNull()
      expect(new Set(guards).size, `${key} has duplicate guards`).toBe(guards.length)
    }
    // wake_timeout, failed and timed_out each fan out on retry_scheduled.
    expect(branchingGroups).toBe(3)
  })

  it('has no fully-duplicated rows', () => {
    const keys = COMMAND_TRANSITIONS.map((r) => `${r.from}|${r.to}|${r.trigger}|${r.guard}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('COMMAND_EDGES', () => {
  it('equals the deduped deriveEdges() projection of the transition table', () => {
    expect(COMMAND_EDGES).toEqual(deriveEdges(COMMAND_TRANSITIONS))
    expect(COMMAND_EDGES).toHaveLength(16)
  })

  it('is duplicate-free and self-loop-free', () => {
    const keys = COMMAND_EDGES.map(([f, t]) => edgeKey(f, t))
    expect(new Set(keys).size).toBe(keys.length)
    for (const [from, to] of COMMAND_EDGES) expect(from).not.toBe(to)
  })

  it('backs every edge with at least one transition row', () => {
    for (const [from, to] of COMMAND_EDGES) {
      expect(COMMAND_TRANSITIONS.some((r) => r.from === from && r.to === to)).toBe(true)
    }
  })

  it('deriveEdges collapses two rows sharing the same from→to into one edge', () => {
    const derived = deriveEdges([
      { from: 'sending', to: 'failed', trigger: 'command_error', guard: null, timing: 'immediate' },
      { from: 'sending', to: 'failed', trigger: 'timeout_15s', guard: 'retryable', timing: 'immediate' },
    ])
    expect(derived).toEqual([['sending', 'failed']])
  })
})

describe('COMMAND_DISALLOWED', () => {
  it('lists six forbidden pairs, each with valid states and a reason', () => {
    expect(COMMAND_DISALLOWED).toHaveLength(6)
    for (const entry of COMMAND_DISALLOWED) {
      expect(STATE_SET.has(entry.from)).toBe(true)
      expect(STATE_SET.has(entry.to)).toBe(true)
      expect(entry.reason.length).toBeGreaterThan(0)
    }
  })

  it('never has a matching transition row or derived edge', () => {
    for (const entry of COMMAND_DISALLOWED) {
      expect(COMMAND_TRANSITIONS.some((r) => r.from === entry.from && r.to === entry.to)).toBe(false)
      expect(EDGE_KEYS.has(edgeKey(entry.from, entry.to))).toBe(false)
    }
  })

  it('forbids re-entering the wake path from a terminal or in-flight state', () => {
    const pairs = new Set(COMMAND_DISALLOWED.map((d) => edgeKey(d.from, d.to)))
    expect(pairs.has(edgeKey('succeeded', 'waking'))).toBe(true)
    expect(pairs.has(edgeKey('gave_up', 'retrying'))).toBe(true)
    expect(pairs.has(edgeKey('sending', 'waking'))).toBe(true)
  })
})

describe('COMMAND_COVERAGE', () => {
  it('defines every state pair (no undefined cells)', () => {
    for (const from of COMMAND_STATES) {
      for (const to of COMMAND_STATES) expect(COMMAND_COVERAGE[from][to]).toBeDefined()
    }
  })

  it('marks the diagonal as self', () => {
    for (const state of COMMAND_STATES) expect(COMMAND_COVERAGE[state][state]).toBe('self')
  })

  it('backs every valid cell with a transition row and vice-versa', () => {
    let validCells = 0
    for (const from of COMMAND_STATES) {
      for (const to of COMMAND_STATES) {
        if (from === to) continue
        if (COMMAND_COVERAGE[from][to] === 'valid') {
          validCells += 1
          expect(COMMAND_TRANSITIONS.some((r) => r.from === from && r.to === to)).toBe(true)
        }
      }
    }
    for (const row of COMMAND_TRANSITIONS) {
      expect(COMMAND_COVERAGE[row.from][row.to]).toBe(row.from === row.to ? 'self' : 'valid')
    }
    expect(validCells).toBe(COMMAND_EDGES.length)
  })

  it('marks exactly the six COMMAND_DISALLOWED pairs as disallowed', () => {
    const disallowedCells = new Set<string>()
    for (const from of COMMAND_STATES) {
      for (const to of COMMAND_STATES) {
        if (COMMAND_COVERAGE[from][to] === 'disallowed') disallowedCells.add(edgeKey(from, to))
      }
    }
    const declared = new Set(COMMAND_DISALLOWED.map((d) => edgeKey(d.from, d.to)))
    expect(disallowedCells).toEqual(declared)
    expect(disallowedCells.size).toBe(6)
  })

  it('never marks a disallowed cell that also has a transition row', () => {
    for (const from of COMMAND_STATES) {
      for (const to of COMMAND_STATES) {
        if (COMMAND_COVERAGE[from][to] === 'disallowed') {
          expect(COMMAND_TRANSITIONS.some((r) => r.from === from && r.to === to)).toBe(false)
        }
      }
    }
  })
})

describe('isValidTransition (coverage lookups)', () => {
  it('reports valid, self, disallowed and null distinctly', () => {
    expect(isValidTransition(COMMAND_COVERAGE, 'queued', 'sending')).toBe('valid')
    expect(isValidTransition(COMMAND_COVERAGE, 'sending', 'sending')).toBe('self')
    expect(isValidTransition(COMMAND_COVERAGE, 'succeeded', 'retrying')).toBe('disallowed')
    expect(isValidTransition(COMMAND_COVERAGE, 'queued', 'failed')).toBeNull()
  })

  it('distinguishes a forbidden pair from a merely-undefined one', () => {
    // succeeded→waking is explicitly forbidden; queued→timed_out is just absent.
    expect(isValidTransition(COMMAND_COVERAGE, 'succeeded', 'waking')).toBe('disallowed')
    expect(isValidTransition(COMMAND_COVERAGE, 'queued', 'timed_out')).toBeNull()
  })
})

describe('COMMAND_TOASTS', () => {
  it('keys only valid states and gives non-empty copy for every non-null entry', () => {
    for (const [state, message] of Object.entries(COMMAND_TOASTS)) {
      expect(STATE_SET.has(state)).toBe(true)
      if (message !== null) expect(message.length).toBeGreaterThan(0)
    }
  })

  it('surfaces success and failure copy and stays silent on the transient confirm state', () => {
    expect(COMMAND_TOASTS.succeeded).toContain('succeeded')
    expect(COMMAND_TOASTS.gave_up).toBeTruthy()
    expect(COMMAND_TOASTS.wake_confirmed).toBeNull()
  })
})

describe('COMMAND_SCENARIOS', () => {
  it('lists eight scenarios with unique ids and descriptions', () => {
    expect(COMMAND_SCENARIOS).toHaveLength(8)
    const ids = COMMAND_SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const scenario of COMMAND_SCENARIOS) expect(scenario.description.length).toBeGreaterThan(0)
  })

  it('walks only valid states along real edges', () => {
    for (const scenario of COMMAND_SCENARIOS) {
      for (const state of scenario.transitions) expect(STATE_SET.has(state)).toBe(true)
      for (let i = 0; i < scenario.transitions.length - 1; i += 1) {
        const key = edgeKey(scenario.transitions[i], scenario.transitions[i + 1])
        expect(EDGE_KEYS.has(key), `${scenario.id}: ${key} is not a valid edge`).toBe(true)
      }
    }
  })
})

describe('COMMAND_FSM', () => {
  it('assembles the exact same references exported individually', () => {
    expect(COMMAND_FSM.states).toBe(COMMAND_STATE_ENTRIES)
    expect(COMMAND_FSM.edges).toBe(COMMAND_EDGES)
    expect(COMMAND_FSM.transitions).toBe(COMMAND_TRANSITIONS)
    expect(COMMAND_FSM.disallowed).toBe(COMMAND_DISALLOWED)
    expect(COMMAND_FSM.coverage).toBe(COMMAND_COVERAGE)
    expect(COMMAND_FSM.scenarios).toBe(COMMAND_SCENARIOS)
    expect(COMMAND_FSM.toasts).toBe(COMMAND_TOASTS)
  })

  it('omits the optional truth table and labels this FSM does not define', () => {
    expect(COMMAND_FSM.truthTable).toBeUndefined()
    expect(COMMAND_FSM.labels).toBeUndefined()
  })
})

describe('machine liveness', () => {
  it('keeps terminal states terminal (no outgoing transitions)', () => {
    for (const terminal of TERMINAL) {
      expect(COMMAND_TRANSITIONS.some((r) => r.from === terminal)).toBe(false)
    }
  })

  it('never transitions back into the initial queued state', () => {
    expect(COMMAND_TRANSITIONS.some((r) => r.to === INITIAL)).toBe(false)
  })

  it('gives every non-terminal state at least one way out (no dead ends)', () => {
    for (const state of COMMAND_STATES) {
      if (TERMINAL.includes(state)) continue
      expect(COMMAND_TRANSITIONS.some((r) => r.from === state), `${state} is a dead end`).toBe(true)
    }
  })

  it('makes every state reachable from queued', () => {
    const reached = reachableFrom(INITIAL)
    for (const state of COMMAND_STATES) expect(reached.has(state), `${state} unreachable`).toBe(true)
  })
})

describe('type contracts', () => {
  it('accepts well-typed state, trigger and guard fixtures as members', () => {
    const state: CommandState = 'retrying'
    const trigger: CommandTrigger = 'retry_scheduled'
    const guard: CommandGuard = 'retryable'
    expect(COMMAND_STATES).toContain(state)
    expect(COMMAND_TRIGGERS).toContain(trigger)
    expect(COMMAND_GUARDS).toContain(guard)
  })
})
