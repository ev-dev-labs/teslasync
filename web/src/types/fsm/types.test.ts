import { describe, it, expect } from 'vitest'
import { deriveEdges, isValidTransition } from './types'
import type {
  BadgeVariant,
  StateStyle,
  StateEntry,
  ResolvedStateStyle,
  Edge,
  FSMDefinition,
  TransitionTiming,
  TransitionRow,
  CoverageCell,
  CoverageMatrix,
  DisallowedTransition,
  Scenario,
  ToastMap,
  TruthTableCell,
  TruthTable,
} from './types'
import { VEHICLE_TRANSITIONS, VEHICLE_EDGES, VEHICLE_COVERAGE } from './vehicle'
import type { VehicleState } from './vehicle'

/** Small helper to keep transition rows terse and typed. */
function row<S extends string, T extends string>(
  from: S,
  to: S,
  trigger: T,
): TransitionRow<S, T> {
  return { from, to, trigger, guard: null, timing: 'immediate' }
}

describe('deriveEdges', () => {
  it('returns an empty array when there are no transitions', () => {
    expect(deriveEdges([])).toEqual([])
  })

  it('derives a single [from, to] edge from a single transition', () => {
    expect(deriveEdges([row('a', 'b', 'go')])).toEqual([['a', 'b']])
  })

  it('preserves the from→to order of each tuple', () => {
    const edges = deriveEdges([row('start', 'end', 'go')])
    expect(edges[0][0]).toBe('start')
    expect(edges[0][1]).toBe('end')
  })

  it('deduplicates identical from→to pairs reached by different triggers', () => {
    const edges = deriveEdges([row('a', 'b', 'x'), row('a', 'b', 'y')])
    expect(edges).toHaveLength(1)
    expect(edges).toEqual([['a', 'b']])
  })

  it('keeps first-seen ordering across a mix of new and repeated edges', () => {
    const edges = deriveEdges([
      row('a', 'b', 't'),
      row('b', 'c', 't'),
      row('a', 'b', 't'),
      row('c', 'a', 't'),
    ])
    expect(edges).toEqual([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ])
  })

  it('keeps distinct edges that share the same source state', () => {
    const edges = deriveEdges([row('a', 'b', 't'), row('a', 'c', 't')])
    expect(edges).toHaveLength(2)
    expect(edges).toEqual([
      ['a', 'b'],
      ['a', 'c'],
    ])
  })

  it('preserves intentional self-loop transitions', () => {
    expect(deriveEdges([row('idle', 'idle', 'tick')])).toEqual([['idle', 'idle']])
  })

  it('does not mutate the input transitions array', () => {
    const input = [row('a', 'b', 't'), row('a', 'b', 't')]
    deriveEdges(input)
    expect(input).toHaveLength(2)
    expect(input[0]).toEqual({ from: 'a', to: 'b', trigger: 't', guard: null, timing: 'immediate' })
  })

  it('tolerates a null or undefined transitions list without throwing', () => {
    expect(deriveEdges(undefined as unknown as TransitionRow<string, string>[])).toEqual([])
    expect(deriveEdges(null as unknown as TransitionRow<string, string>[])).toEqual([])
  })

  it('uses a collision-safe key so separator-bearing state names stay distinct', () => {
    // Under a naive `${from}→${to}` key these two rows collapse to one edge.
    const edges = deriveEdges<string, string>([
      row('a→b', 'c', 't'),
      row('a', 'b→c', 't'),
    ])
    expect(edges).toHaveLength(2)
    expect(edges).toEqual([
      ['a→b', 'c'],
      ['a', 'b→c'],
    ])
  })

  it('reproduces the pre-derived VEHICLE_EDGES from the real vehicle FSM', () => {
    expect(deriveEdges(VEHICLE_TRANSITIONS)).toEqual(VEHICLE_EDGES)
  })
})

describe('isValidTransition', () => {
  const coverage: CoverageMatrix<string> = {
    armed: { armed: 'self', fired: 'valid', suppressed: 'disallowed', idle: null },
    fired: { armed: 'valid', fired: 'self', suppressed: 'valid', idle: null },
  }

  it('returns "valid" for an allowed transition', () => {
    expect(isValidTransition(coverage, 'armed', 'fired')).toBe('valid')
  })

  it('returns "disallowed" for a forbidden transition', () => {
    expect(isValidTransition(coverage, 'armed', 'suppressed')).toBe('disallowed')
  })

  it('returns "self" for the diagonal', () => {
    expect(isValidTransition(coverage, 'armed', 'armed')).toBe('self')
  })

  it('returns null for an explicitly null cell', () => {
    expect(isValidTransition(coverage, 'armed', 'idle')).toBeNull()
  })

  it('returns null when the source state is unknown', () => {
    expect(isValidTransition(coverage, 'nonexistent', 'fired')).toBeNull()
  })

  it('returns null when the target state is unknown', () => {
    expect(isValidTransition(coverage, 'armed', 'nonexistent')).toBeNull()
  })

  it('returns null when the coverage matrix itself is missing', () => {
    expect(
      isValidTransition(undefined as unknown as CoverageMatrix<string>, 'armed', 'fired'),
    ).toBeNull()
  })

  it('agrees with the real VEHICLE_COVERAGE matrix', () => {
    expect(isValidTransition(VEHICLE_COVERAGE, 'online' as VehicleState, 'driving' as VehicleState)).toBe('valid')
    expect(isValidTransition(VEHICLE_COVERAGE, 'online' as VehicleState, 'online' as VehicleState)).toBe('self')
    expect(isValidTransition(VEHICLE_COVERAGE, 'driving' as VehicleState, 'asleep' as VehicleState)).toBe('disallowed')
  })
})

describe('FSM type contracts', () => {
  it('exposes the five semantic badge variants', () => {
    const variants: BadgeVariant[] = ['success', 'warning', 'danger', 'info', 'neutral']
    expect(variants).toHaveLength(5)
    expect(new Set(variants).size).toBe(variants.length)
  })

  it('merges a StateStyle + StateEntry override into a ResolvedStateStyle', () => {
    const style: StateStyle = {
      badgeDot: 'bg-green-400',
      bg: 'bg-green-500/10',
      text: 'text-green-400',
      dot: 'bg-green-400',
    }
    const entry: StateEntry = { variant: 'success', overrides: { text: 'text-emerald-300' } }
    const resolved: ResolvedStateStyle = { variant: entry.variant, ...style, ...entry.overrides }
    expect(resolved.variant).toBe('success')
    expect(resolved.text).toBe('text-emerald-300')
    expect(resolved.bg).toBe('bg-green-500/10')
  })

  it('types Edge tuples, TransitionTiming and TransitionRow', () => {
    const edge: Edge<'a' | 'b'> = ['a', 'b']
    const timing: TransitionTiming = 'debounced'
    const transition: TransitionRow<'a' | 'b', 'go'> = {
      from: 'a',
      to: 'b',
      trigger: 'go',
      guard: 'guardExpr',
      timing,
    }
    expect(edge).toEqual(['a', 'b'])
    expect(transition.timing).toBe('debounced')
    expect(transition.guard).toBe('guardExpr')
  })

  it('enumerates the legal CoverageCell values and drives isValidTransition', () => {
    const legalCells: CoverageCell[] = ['valid', 'disallowed', 'self', null]
    expect(legalCells).toContain(null)
    const matrix: CoverageMatrix<'a' | 'b'> = {
      a: { a: 'self', b: 'valid' },
      b: { a: 'disallowed', b: 'self' },
    }
    expect(isValidTransition(matrix, 'a', 'b')).toBe('valid')
    expect(isValidTransition(matrix, 'b', 'a')).toBe('disallowed')
  })

  it('models each TruthTableCell action shape as a discriminated union', () => {
    const cells: TruthTableCell<'a' | 'b'>[] = [
      { action: 'transition', to: 'b', guard: 'g' },
      { action: 'no_op' },
      { action: 'not_applicable' },
      { action: 'disallowed', reason: 'blocked' },
    ]
    expect(cells.map((c) => c.action)).toEqual(['transition', 'no_op', 'not_applicable', 'disallowed'])
    const head = cells[0]
    if (head.action === 'transition') {
      expect(head.to).toBe('b')
      expect(head.guard).toBe('g')
    }
    const tail = cells[3]
    if (tail.action === 'disallowed') {
      expect(tail.reason).toBe('blocked')
    }
  })

  it('composes a TruthTable keyed by state then trigger', () => {
    const table: TruthTable<'a' | 'b', 'go'> = {
      a: { go: { action: 'transition', to: 'b' } },
      b: { go: { action: 'no_op' } },
    }
    expect(table.a.go.action).toBe('transition')
    expect(table.b.go.action).toBe('no_op')
  })

  it('models DisallowedTransition, Scenario and ToastMap payloads', () => {
    const disallowed: DisallowedTransition<'a' | 'b'> = { from: 'a', to: 'b', reason: 'nope' }
    const scenario: Scenario<'a' | 'b'> = { id: 's1', description: 'A → B', transitions: ['a', 'b'] }
    const toasts: ToastMap<'a' | 'b'> = { a: 'Started', b: null }
    expect(disallowed.reason.length).toBeGreaterThan(0)
    expect(scenario.transitions).toHaveLength(2)
    expect(toasts.a).toBe('Started')
    expect(toasts.b).toBeNull()
  })

  it('assembles an FSMDefinition whose edges match deriveEdges of its transitions', () => {
    const miniFsm: FSMDefinition<'a' | 'b', 'go'> = {
      states: { a: { variant: 'neutral' }, b: { variant: 'success' } },
      edges: [['a', 'b']],
      transitions: [row<'a' | 'b', 'go'>('a', 'b', 'go')],
      labels: { a: 'Alpha', b: 'Beta' },
    }
    expect(deriveEdges(miniFsm.transitions!)).toEqual(miniFsm.edges)
    expect(miniFsm.states.a.variant).toBe('neutral')
    expect(miniFsm.labels?.b).toBe('Beta')
  })
})
