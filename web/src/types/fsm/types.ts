/** Semantic badge variants used across the entire app */
export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/** Visual style derived from a BadgeVariant — no per-state customization needed */
export interface StateStyle {
  badgeDot: string   // Tailwind class for the badge dot color
  bg: string         // Tailwind class for background (panel/card tint)
  text: string       // Tailwind class for text color
  dot: string        // Tailwind class for status dot in diagrams
}

/** A single state in an FSM: just a variant. Theme resolves the rest. */
export interface StateEntry {
  variant: BadgeVariant
  /** Optional override: only use when a state MUST differ from theme defaults.
   *  Example: vehicle.driving is 'success' but uses blue tint, not green. */
  overrides?: Partial<StateStyle>
}

/** Typed edge tuple — generic so each FSM constrains its own state names */
export type Edge<S extends string> = [from: S, to: S]

/** Full FSM definition — generic over its state union */
export interface FSMDefinition<S extends string = string, T extends string = string> {
  states: Record<S, StateEntry>
  edges: Edge<S>[]
  transitions?: TransitionRow<S, T>[]
  disallowed?: DisallowedTransition<S>[]
  coverage?: CoverageMatrix<S>
  scenarios?: Scenario<S>[]
  toasts?: ToastMap<S>
  truthTable?: TruthTable<S, T>
  labels?: Record<S, string>
}

/** Resolved state style = theme defaults merged with optional overrides */
export type ResolvedStateStyle = StateStyle & { variant: BadgeVariant }

export type TransitionTiming = 'immediate' | 'debounced'

export interface TransitionRow<S extends string = string, T extends string = string> {
  from: S
  to: S
  trigger: T
  guard: string | null
  timing: TransitionTiming
}

export type CoverageCell = 'valid' | 'disallowed' | 'self' | null
export type CoverageMatrix<S extends string> = Record<S, Record<S, CoverageCell>>

export interface DisallowedTransition<S extends string> {
  from: S
  to: S
  reason: string
}

export interface Scenario<S extends string> {
  id: string
  description: string
  transitions: S[]
}

export type ToastMap<S extends string> = Partial<Record<S, string | null>>

export type TruthTableCell<S extends string> =
  | { action: 'transition'; to: S; guard?: string }
  | { action: 'no_op' }
  | { action: 'not_applicable' }
  | { action: 'disallowed'; reason: string }

export type TruthTable<S extends string, T extends string> = Record<S, Record<T, TruthTableCell<S>>>

export function deriveEdges<S extends string, T extends string>(
  transitions: TransitionRow<S, T>[],
): Edge<S>[] {
  const seen = new Set<string>()
  const edges: Edge<S>[] = []
  for (const { from, to } of transitions ?? []) {
    // Composite JSON key avoids delimiter collisions when a state name itself
    // contains the separator (e.g. from:'a→b',to:'c' vs from:'a',to:'b→c').
    const key = JSON.stringify([from, to])
    if (!seen.has(key)) {
      seen.add(key)
      edges.push([from, to])
    }
  }
  return edges
}

export function isValidTransition<S extends string>(
  coverage: CoverageMatrix<S>,
  from: S,
  to: S,
): CoverageCell {
  return coverage?.[from]?.[to] ?? null
}
