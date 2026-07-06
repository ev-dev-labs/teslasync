import { describe, it, expect } from 'vitest'
import {
  NOTIFICATION_STATES,
  NOTIFICATION_STATE_ENTRIES,
  NOTIFICATION_TRIGGERS,
  NOTIFICATION_GUARDS,
  NOTIFICATION_TRANSITIONS,
  NOTIFICATION_EDGES,
  NOTIFICATION_DISALLOWED,
  NOTIFICATION_COVERAGE,
  NOTIFICATION_SCENARIOS,
  NOTIFICATION_FSM,
  type NotificationState,
  type NotificationTrigger,
  type NotificationGuard,
} from './notification'
import { deriveEdges, isValidTransition, type BadgeVariant } from './types'
import { resolveStyle, VARIANT_THEME } from './theme'

// ── Shared fixtures ────────────────────────────────────────────────────────────
const STATE_SET = new Set<string>(NOTIFICATION_STATES)
const edgeKey = (from: string, to: string) => `${from}\u2192${to}`
const EDGE_KEYS = new Set(NOTIFICATION_EDGES.map(([f, t]) => edgeKey(f, t)))
const VALID_VARIANTS = new Set<BadgeVariant>(
  Object.keys(VARIANT_THEME) as BadgeVariant[],
)
/** Terminal states have no outgoing transition by design. */
const TERMINAL: NotificationState[] = ['delivered', 'dead']
const INITIAL: NotificationState = 'created'

describe('NOTIFICATION_STATES', () => {
  it('declares exactly the seven lifecycle states in canonical order', () => {
    expect(NOTIFICATION_STATES).toEqual([
      'created',
      'sending',
      'delivered',
      'partial',
      'failed',
      'retrying',
      'dead',
    ])
    expect(NOTIFICATION_STATES).toHaveLength(7)
  })

  it('has no duplicate state names', () => {
    expect(STATE_SET.size).toBe(NOTIFICATION_STATES.length)
  })
})

describe('type exports', () => {
  it('exposes usable NotificationState / NotificationTrigger / NotificationGuard unions', () => {
    const state: NotificationState = 'delivered'
    const trigger: NotificationTrigger = 'retry_scheduled'
    const guard: NotificationGuard = 'under_max_retries'
    expect(NOTIFICATION_STATES).toContain(state)
    expect(NOTIFICATION_TRIGGERS).toContain(trigger)
    expect(NOTIFICATION_GUARDS).toContain(guard)
  })
})

describe('NOTIFICATION_STATE_ENTRIES', () => {
  it('has exactly one entry per declared state and no orphan keys', () => {
    expect(Object.keys(NOTIFICATION_STATE_ENTRIES).sort()).toEqual(
      [...NOTIFICATION_STATES].sort(),
    )
  })

  it('assigns a themeable BadgeVariant to every state', () => {
    for (const state of NOTIFICATION_STATES) {
      const entry = NOTIFICATION_STATE_ENTRIES[state]
      expect(VALID_VARIANTS.has(entry.variant), `${state} → ${entry.variant}`).toBe(true)
    }
  })

  it('resolves non-override states straight from the shared variant theme', () => {
    const plain: NotificationState[] = ['created', 'sending', 'delivered', 'partial', 'failed']
    for (const state of plain) {
      const entry = NOTIFICATION_STATE_ENTRIES[state]
      expect(entry.overrides, `${state} should not override the theme`).toBeUndefined()
      const resolved = resolveStyle(entry)
      expect(resolved.text).toBe(VARIANT_THEME[entry.variant].text)
      expect(resolved.bg).toBe(VARIANT_THEME[entry.variant].bg)
      expect(resolved.variant).toBe(entry.variant)
    }
  })

  it('resolves the retrying/dead overrides to their bespoke palette, beating the base variant', () => {
    const retrying = resolveStyle(NOTIFICATION_STATE_ENTRIES.retrying)
    expect(retrying.variant).toBe('neutral')
    expect(retrying.text).toBe('text-purple-400')
    expect(retrying.bg).toBe('bg-purple-500/10')
    // Proves the override wins over the neutral theme's muted text token.
    expect(retrying.text).not.toBe(VARIANT_THEME.neutral.text)

    const dead = resolveStyle(NOTIFICATION_STATE_ENTRIES.dead)
    expect(dead.variant).toBe('danger')
    expect(dead.text).toBe('text-red-500')
    expect(dead.dot).toBe('bg-red-500')
    // danger base is red-400 — the terminal override deepens it to red-500.
    expect(dead.text).not.toBe(VARIANT_THEME.danger.text)
  })
})

describe('NOTIFICATION_TRIGGERS and NOTIFICATION_GUARDS', () => {
  it('declares the expected unique trigger and guard vocabularies', () => {
    expect(NOTIFICATION_TRIGGERS).toHaveLength(7)
    expect(new Set(NOTIFICATION_TRIGGERS).size).toBe(NOTIFICATION_TRIGGERS.length)
    expect(NOTIFICATION_GUARDS).toEqual(['under_max_retries', 'max_retries_reached'])
    expect(new Set(NOTIFICATION_GUARDS).size).toBe(NOTIFICATION_GUARDS.length)
  })

  it('uses every declared trigger in at least one transition (no dead vocabulary)', () => {
    const used = new Set(NOTIFICATION_TRANSITIONS.map((r) => r.trigger))
    for (const trigger of NOTIFICATION_TRIGGERS) {
      expect(used.has(trigger), `trigger "${trigger}" is never used`).toBe(true)
    }
  })

  it('uses every declared guard in at least one transition', () => {
    const used = new Set(
      NOTIFICATION_TRANSITIONS.map((r) => r.guard).filter((g): g is string => g !== null),
    )
    for (const guard of NOTIFICATION_GUARDS) {
      expect(used.has(guard), `guard "${guard}" is never used`).toBe(true)
    }
  })
})

describe('NOTIFICATION_TRANSITIONS', () => {
  it('references only valid from/to states', () => {
    for (const r of NOTIFICATION_TRANSITIONS) {
      expect(STATE_SET.has(r.from), `bad from "${r.from}"`).toBe(true)
      expect(STATE_SET.has(r.to), `bad to "${r.to}"`).toBe(true)
    }
  })

  it('references only declared triggers and (a declared guard | null)', () => {
    const triggers = new Set<string>(NOTIFICATION_TRIGGERS)
    const guards = new Set<string>(NOTIFICATION_GUARDS)
    for (const r of NOTIFICATION_TRANSITIONS) {
      expect(triggers.has(r.trigger), `unknown trigger "${r.trigger}"`).toBe(true)
      if (r.guard !== null) {
        expect(guards.has(r.guard), `unknown guard "${r.guard}"`).toBe(true)
      }
      expect(r.timing).toBe('immediate')
    }
  })

  it('contains no self-loops', () => {
    for (const r of NOTIFICATION_TRANSITIONS) {
      expect(r.from === r.to, `self-loop on ${r.from}`).toBe(false)
    }
  })

  it('has no duplicate (from,to,trigger,guard) rows', () => {
    const keys = NOTIFICATION_TRANSITIONS.map(
      (r) => `${r.from}|${r.to}|${r.trigger}|${r.guard ?? ''}`,
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is deterministic: each (from,trigger) is a single unguarded row or a full guard partition', () => {
    const groups = new Map<string, (string | null)[]>()
    for (const r of NOTIFICATION_TRANSITIONS) {
      const key = `${r.from}::${r.trigger}`
      groups.set(key, [...(groups.get(key) ?? []), r.guard])
    }
    for (const [key, guards] of groups) {
      if (guards.length === 1) {
        continue // a lone row may be guarded or not — always deterministic
      }
      // Fan-out on the same trigger MUST be fully guarded and mutually exclusive,
      // otherwise runtime dispatch is ambiguous.
      expect(guards.every((g) => g !== null), `${key} has an unguarded branch`).toBe(true)
      expect(new Set(guards).size, `${key} repeats a guard`).toBe(guards.length)
    }
  })
})

describe('NOTIFICATION_EDGES', () => {
  it('equals deriveEdges(NOTIFICATION_TRANSITIONS)', () => {
    expect(NOTIFICATION_EDGES).toEqual(deriveEdges(NOTIFICATION_TRANSITIONS))
  })

  it('exposes nine unique directed edges with no duplicates', () => {
    expect(NOTIFICATION_EDGES).toHaveLength(9)
    expect(EDGE_KEYS.size).toBe(NOTIFICATION_EDGES.length)
  })

  it('collapses to exactly the set of distinct from\u2192to transition pairs', () => {
    const pairFromTransitions = new Set(
      NOTIFICATION_TRANSITIONS.map((r) => edgeKey(r.from, r.to)),
    )
    expect(EDGE_KEYS).toEqual(pairFromTransitions)
  })

  it('deriveEdges deduplicates two rows sharing the same from\u2192to', () => {
    const derived = deriveEdges([
      { from: 'partial', to: 'sending', trigger: 'retry', guard: 'under_max_retries', timing: 'immediate' },
      { from: 'partial', to: 'sending', trigger: 'retry', guard: 'max_retries_reached', timing: 'immediate' },
    ])
    expect(derived).toHaveLength(1)
    expect(derived[0]).toEqual(['partial', 'sending'])
  })
})

describe('NOTIFICATION_DISALLOWED', () => {
  it('lists five forbidden transitions over valid states with non-empty reasons', () => {
    expect(NOTIFICATION_DISALLOWED).toHaveLength(5)
    for (const d of NOTIFICATION_DISALLOWED) {
      expect(STATE_SET.has(d.from), `bad from "${d.from}"`).toBe(true)
      expect(STATE_SET.has(d.to), `bad to "${d.to}"`).toBe(true)
      expect(d.reason.trim().length, `${d.from}\u2192${d.to} missing reason`).toBeGreaterThan(0)
    }
  })

  it('never overlaps a declared transition or a derived edge', () => {
    for (const d of NOTIFICATION_DISALLOWED) {
      const hasRow = NOTIFICATION_TRANSITIONS.some((r) => r.from === d.from && r.to === d.to)
      expect(hasRow, `${d.from}\u2192${d.to} is disallowed but has a transition row`).toBe(false)
      expect(EDGE_KEYS.has(edgeKey(d.from, d.to)), `${d.from}\u2192${d.to} disallowed but edge exists`).toBe(false)
    }
  })

  it('is never marked "valid" in the coverage matrix', () => {
    for (const d of NOTIFICATION_DISALLOWED) {
      expect(NOTIFICATION_COVERAGE[d.from][d.to], `${d.from}\u2192${d.to}`).not.toBe('valid')
    }
  })

  it('forbids re-entry from terminal states delivered/dead', () => {
    const froms = NOTIFICATION_DISALLOWED.map((d) => d.from)
    expect(froms).toContain('delivered')
    expect(froms).toContain('dead')
  })
})

describe('NOTIFICATION_COVERAGE', () => {
  it('marks the diagonal as "self" for every state', () => {
    for (const state of NOTIFICATION_STATES) {
      expect(NOTIFICATION_COVERAGE[state][state], `[${state}][${state}]`).toBe('self')
    }
  })

  it('defines a cell for every one of the 49 ordered state pairs', () => {
    let cells = 0
    for (const from of NOTIFICATION_STATES) {
      for (const to of NOTIFICATION_STATES) {
        expect(NOTIFICATION_COVERAGE[from]?.[to], `[${from}][${to}] undefined`).not.toBeUndefined()
        cells++
      }
    }
    expect(cells).toBe(49)
  })

  it('is bidirectionally consistent with the transition table', () => {
    // Every "valid" cell has a matching row...
    for (const from of NOTIFICATION_STATES) {
      for (const to of NOTIFICATION_STATES) {
        if (from === to) continue
        const cell = NOTIFICATION_COVERAGE[from][to]
        const hasRow = NOTIFICATION_TRANSITIONS.some((r) => r.from === from && r.to === to)
        if (cell === 'valid') {
          expect(hasRow, `${from}\u2192${to} valid but no row`).toBe(true)
        } else {
          expect(hasRow, `${from}\u2192${to} has a row but cell is ${String(cell)}`).toBe(false)
        }
      }
    }
    // ...and every row maps back to a "valid" cell.
    for (const r of NOTIFICATION_TRANSITIONS) {
      expect(NOTIFICATION_COVERAGE[r.from][r.to], `${r.from}\u2192${r.to}`).toBe('valid')
    }
  })

  it('documents forbidden/never-happens pairs as null, not the "disallowed" cell value', () => {
    for (const from of NOTIFICATION_STATES) {
      for (const to of NOTIFICATION_STATES) {
        expect(NOTIFICATION_COVERAGE[from][to], `[${from}][${to}]`).not.toBe('disallowed')
      }
    }
  })

  it('agrees with the isValidTransition helper', () => {
    expect(isValidTransition(NOTIFICATION_COVERAGE, 'created', 'sending')).toBe('valid')
    expect(isValidTransition(NOTIFICATION_COVERAGE, 'sending', 'sending')).toBe('self')
    expect(isValidTransition(NOTIFICATION_COVERAGE, 'delivered', 'sending')).toBeNull()
    expect(isValidTransition(NOTIFICATION_COVERAGE, 'dead', 'retrying')).toBeNull()
  })
})

describe('NOTIFICATION_SCENARIOS', () => {
  it('has unique ids and non-empty descriptions', () => {
    const ids = NOTIFICATION_SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of NOTIFICATION_SCENARIOS) {
      expect(s.description.trim().length, `${s.id} missing description`).toBeGreaterThan(0)
      expect(s.transitions.length, `${s.id} has no path`).toBeGreaterThan(0)
    }
  })

  it('references only valid states', () => {
    for (const s of NOTIFICATION_SCENARIOS) {
      for (const st of s.transitions) {
        expect(STATE_SET.has(st), `${s.id}: "${st}" invalid`).toBe(true)
      }
    }
  })

  it('walks only along derived edges for every consecutive step', () => {
    for (const s of NOTIFICATION_SCENARIOS) {
      for (let i = 0; i < s.transitions.length - 1; i++) {
        const k = edgeKey(s.transitions[i], s.transitions[i + 1])
        expect(EDGE_KEYS.has(k), `${s.id}: ${k} is not a valid edge`).toBe(true)
      }
    }
  })

  it('covers the happy path, the partial-retry recovery, and both exhaustion paths', () => {
    const byId = Object.fromEntries(NOTIFICATION_SCENARIOS.map((s) => [s.id, s]))
    expect(byId.N1.transitions.at(-1)).toBe('delivered')
    expect(byId.N2.transitions).toEqual(['created', 'sending', 'partial', 'sending', 'delivered'])
    expect(byId.N4.transitions.at(-1)).toBe('dead')
    expect(byId.N5.transitions).toEqual(['partial', 'dead'])
  })
})

describe('NOTIFICATION_FSM assembly', () => {
  it('wires the canonical references for every field', () => {
    expect(NOTIFICATION_FSM.states).toBe(NOTIFICATION_STATE_ENTRIES)
    expect(NOTIFICATION_FSM.edges).toBe(NOTIFICATION_EDGES)
    expect(NOTIFICATION_FSM.transitions).toBe(NOTIFICATION_TRANSITIONS)
    expect(NOTIFICATION_FSM.disallowed).toBe(NOTIFICATION_DISALLOWED)
    expect(NOTIFICATION_FSM.coverage).toBe(NOTIFICATION_COVERAGE)
    expect(NOTIFICATION_FSM.scenarios).toBe(NOTIFICATION_SCENARIOS)
  })

  it('makes every state reachable from the created entry state', () => {
    const adjacency = new Map<string, string[]>()
    for (const [from, to] of NOTIFICATION_EDGES) {
      adjacency.set(from, [...(adjacency.get(from) ?? []), to])
    }
    const visited = new Set<string>([INITIAL])
    const queue: string[] = [INITIAL]
    while (queue.length > 0) {
      const current = queue.shift() as string
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next)
          queue.push(next)
        }
      }
    }
    expect([...visited].sort()).toEqual([...NOTIFICATION_STATES].sort())
  })

  it('treats delivered and dead as terminal and every other state as live', () => {
    const froms = new Set(NOTIFICATION_TRANSITIONS.map((r) => r.from))
    for (const terminal of TERMINAL) {
      expect(froms.has(terminal), `${terminal} should be terminal`).toBe(false)
    }
    for (const state of NOTIFICATION_STATES) {
      if ((TERMINAL as string[]).includes(state)) continue
      expect(froms.has(state), `${state} should have an outgoing transition`).toBe(true)
    }
  })
})
