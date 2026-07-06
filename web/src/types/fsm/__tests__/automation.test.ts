import { describe, it, expect } from 'vitest'
import {
  AUTOMATION_STATES,
  AUTOMATION_STATE_ENTRIES,
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRANSITIONS,
  AUTOMATION_EDGES,
  AUTOMATION_FSM,
  type AutomationState,
} from '../automation'
import { deriveEdges } from '../types'
import { resolveStyle, VARIANT_THEME, DEFAULT_STATE } from '../theme'
import { FSM_REGISTRY, FSM_STATES, getStateColor, getStateDefinition } from '../registry'

const STATE_SET = new Set<string>(AUTOMATION_STATES)
const VALID_VARIANTS = new Set(Object.keys(VARIANT_THEME))
const STYLE_KEYS = ['badgeDot', 'bg', 'dot', 'text'] as const

/** Directed BFS over AUTOMATION_EDGES. `reverse` walks incoming edges. */
function walk(start: AutomationState, reverse = false): Set<string> {
  const adj = new Map<string, string[]>()
  for (const [from, to] of AUTOMATION_EDGES) {
    const [a, b] = reverse ? [to, from] : [from, to]
    const list = adj.get(a) ?? []
    list.push(b)
    adj.set(a, list)
  }
  const seen = new Set<string>([start])
  const queue: string[] = [start]
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const next of adj.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

describe('AUTOMATION_STATES', () => {
  it('is a non-empty, duplicate-free list of the eleven canonical states', () => {
    expect(AUTOMATION_STATES.length).toBe(11)
    expect(new Set(AUTOMATION_STATES).size).toBe(AUTOMATION_STATES.length)
    expect([...AUTOMATION_STATES]).toEqual([
      'idle', 'evaluating', 'executing', 'succeeded', 'partial',
      'failed', 'retrying', 'gave_up', 'skipped', 'cooldown', 'disabled',
    ])
  })

  it('anchors the lifecycle on the idle rest state', () => {
    expect(STATE_SET.has('idle')).toBe(true)
    expect(AUTOMATION_STATES[0]).toBe('idle')
  })
})

describe('AUTOMATION_TRIGGERS', () => {
  it('exposes a single manual trigger', () => {
    expect([...AUTOMATION_TRIGGERS]).toEqual(['manual'])
    expect(AUTOMATION_TRIGGERS.length).toBe(1)
  })

  it('is the closed set every transition draws from', () => {
    const triggers = new Set<string>(AUTOMATION_TRIGGERS)
    for (const row of AUTOMATION_TRANSITIONS) {
      expect(triggers.has(row.trigger)).toBe(true)
    }
  })
})

describe('AUTOMATION_STATE_ENTRIES', () => {
  it('maps exactly one entry per declared state — no missing, no extras', () => {
    const keys = Object.keys(AUTOMATION_STATE_ENTRIES).sort()
    expect(keys).toEqual([...AUTOMATION_STATES].sort())
  })

  it.each([...AUTOMATION_STATES])('%s — variant is a real themed BadgeVariant', (state) => {
    const entry = AUTOMATION_STATE_ENTRIES[state as AutomationState]
    expect(entry).toBeDefined()
    expect(VALID_VARIANTS.has(entry.variant)).toBe(true)
  })

  it.each([...AUTOMATION_STATES])('%s — resolves to a complete four-part style', (state) => {
    const resolved = resolveStyle(AUTOMATION_STATE_ENTRIES[state as AutomationState])
    for (const key of STYLE_KEYS) {
      expect(typeof resolved[key]).toBe('string')
      expect(resolved[key].length).toBeGreaterThan(0)
    }
  })

  it('overrides fully replace the themed style (evaluating → cyan, not info blue)', () => {
    const resolved = resolveStyle(AUTOMATION_STATE_ENTRIES.evaluating)
    expect(resolved.variant).toBe('info')
    expect(resolved.text).toBe('text-cyan-400')
    expect(resolved.text).not.toBe(VARIANT_THEME.info.text)
    expect(resolved.badgeDot).toBe('bg-cyan-400')
  })

  it('partial overrides merge with the variant base (idle keeps neutral dot, swaps text)', () => {
    const resolved = resolveStyle(AUTOMATION_STATE_ENTRIES.idle)
    expect(resolved.variant).toBe('neutral')
    expect(resolved.text).toBe('text-[var(--text-secondary)]')
    expect(resolved.badgeDot).toBe(VARIANT_THEME.neutral.badgeDot)
    expect(resolved.dot).toBe(VARIANT_THEME.neutral.dot)
  })

  it('un-overridden states fall through to the pure variant theme (executing = warning)', () => {
    expect(AUTOMATION_STATE_ENTRIES.executing.overrides).toBeUndefined()
    expect(resolveStyle(AUTOMATION_STATE_ENTRIES.executing)).toEqual({
      variant: 'warning',
      ...VARIANT_THEME.warning,
    })
  })

  it('gave_up escalates danger to a deeper red via override', () => {
    const resolved = resolveStyle(AUTOMATION_STATE_ENTRIES.gave_up)
    expect(resolved.variant).toBe('danger')
    expect(resolved.text).toBe('text-red-500')
  })
})

describe('AUTOMATION_TRANSITIONS', () => {
  it('every row references declared states, is immediate, guard-free, and manual', () => {
    expect(AUTOMATION_TRANSITIONS.length).toBe(18)
    for (const row of AUTOMATION_TRANSITIONS) {
      expect(STATE_SET.has(row.from)).toBe(true)
      expect(STATE_SET.has(row.to)).toBe(true)
      expect(row.timing).toBe('immediate')
      expect(row.guard).toBeNull()
      expect(row.trigger).toBe('manual')
    }
  })

  it('contains no self-loops and no duplicate (from,to,trigger) rows', () => {
    const seen = new Set<string>()
    for (const row of AUTOMATION_TRANSITIONS) {
      expect(row.from).not.toBe(row.to)
      const key = `${row.from}→${row.to}:${row.trigger}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })
})

describe('AUTOMATION_EDGES', () => {
  it('is exactly the deduplicated edge projection of the transition table', () => {
    expect(AUTOMATION_EDGES).toEqual(deriveEdges(AUTOMATION_TRANSITIONS))
    const uniquePairs = new Set(AUTOMATION_TRANSITIONS.map((r) => `${r.from}→${r.to}`))
    expect(AUTOMATION_EDGES.length).toBe(uniquePairs.size)
    expect(AUTOMATION_EDGES.length).toBe(18)
  })

  it('holds only valid endpoints and no duplicate edges', () => {
    const seen = new Set<string>()
    for (const [from, to] of AUTOMATION_EDGES) {
      expect(STATE_SET.has(from)).toBe(true)
      expect(STATE_SET.has(to)).toBe(true)
      const key = `${from}→${to}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })
})

describe('AUTOMATION_FSM graph invariants', () => {
  it('wires the exported states, edges, and transitions by reference', () => {
    expect(AUTOMATION_FSM.states).toBe(AUTOMATION_STATE_ENTRIES)
    expect(AUTOMATION_FSM.edges).toBe(AUTOMATION_EDGES)
    expect(AUTOMATION_FSM.transitions).toBe(AUTOMATION_TRANSITIONS)
  })

  it('is a "light" FSM without coverage/scenario/disallowed metadata', () => {
    expect(AUTOMATION_FSM.coverage).toBeUndefined()
    expect(AUTOMATION_FSM.scenarios).toBeUndefined()
    expect(AUTOMATION_FSM.disallowed).toBeUndefined()
  })

  it('reaches every state from idle (fully connected)', () => {
    const reached = walk('idle')
    expect(reached.size).toBe(AUTOMATION_STATES.length)
    for (const state of AUTOMATION_STATES) {
      expect(reached.has(state)).toBe(true)
    }
  })

  it('lets every state walk back to idle (live — no trap states)', () => {
    const canReachIdle = walk('idle', true)
    for (const state of AUTOMATION_STATES) {
      expect(canReachIdle.has(state)).toBe(true)
    }
  })

  it('has no dead-end or orphan states (every state has in + out edges)', () => {
    const withOutgoing = new Set(AUTOMATION_EDGES.map(([from]) => from))
    const withIncoming = new Set(AUTOMATION_EDGES.map(([, to]) => to))
    for (const state of AUTOMATION_STATES) {
      expect(withOutgoing.has(state)).toBe(true)
      expect(withIncoming.has(state)).toBe(true)
    }
  })
})

describe('registry + theme integration', () => {
  it('registers the automation FSM and its state list by reference', () => {
    expect(FSM_REGISTRY.automation).toBe(AUTOMATION_FSM)
    expect(FSM_STATES.automation).toBe(AUTOMATION_STATES)
  })

  it('getStateColor projects an overridden state to its four style classes', () => {
    expect(getStateColor('automation', 'evaluating')).toEqual({
      badgeDot: 'bg-cyan-400',
      bg: 'bg-cyan-500/10',
      text: 'text-cyan-400',
      dot: 'bg-cyan-400',
    })
    expect(Object.keys(getStateColor('automation', 'executing')).sort()).toEqual([...STYLE_KEYS])
  })

  it('getStateColor lower-cases the lookup so display casing still resolves', () => {
    expect(getStateColor('automation', 'EVALUATING')).toEqual(getStateColor('automation', 'evaluating'))
  })

  it('getStateColor falls back to the neutral default for unknown states', () => {
    const unknown = getStateColor('automation', 'does_not_exist')
    expect(unknown.text).toBe(DEFAULT_STATE.text)
    expect(unknown.text).toBe(VARIANT_THEME.neutral.text)
  })

  it('getStateDefinition preserves the semantic variant alongside overrides', () => {
    const def = getStateDefinition('automation', 'gave_up')
    expect(def.variant).toBe('danger')
    expect(def.text).toBe('text-red-500')
  })
})
