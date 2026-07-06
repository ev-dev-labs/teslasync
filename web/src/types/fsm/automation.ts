import { deriveEdges, type TransitionRow, type StateEntry, type FSMDefinition, type Edge } from './types'

/**
 * Automation FSM — one automation rule's execution lifecycle.
 *
 * Flow: `idle → evaluating → (executing | skipped) →
 * (succeeded | partial | failed)`, with `failed → retrying → (executing |
 * gave_up)` recovery, a `cooldown` rate-limit after a run, and a `disabled`
 * state reached from `gave_up`. Every state can walk back to `idle`, so the
 * graph is live (no trap states) and fully reachable from `idle`.
 *
 * Triggers are intentionally single-valued (`manual`): the runtime engine —
 * not this static table — decides when each edge fires (mirrors the
 * telemetry-connection FSM). Structural invariants are locked by the
 * co-located `__tests__/automation.test.ts` and the shared FSM suites.
 */
export const AUTOMATION_STATES = [
  'idle', 'evaluating', 'executing', 'succeeded', 'partial',
  'failed', 'retrying', 'gave_up', 'skipped', 'cooldown', 'disabled',
] as const

export type AutomationState = (typeof AUTOMATION_STATES)[number]

export const AUTOMATION_STATE_ENTRIES: Record<AutomationState, StateEntry> = {
  idle:       { variant: 'neutral', overrides: { text: 'text-[var(--text-secondary)]' } },
  evaluating: { variant: 'info',    overrides: { badgeDot: 'bg-cyan-400', bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' } },
  executing:  { variant: 'warning' },
  succeeded:  { variant: 'success' },
  partial:    { variant: 'warning' },
  failed:     { variant: 'danger' },
  retrying:   { variant: 'warning' },
  gave_up:    { variant: 'danger',  overrides: { badgeDot: 'bg-red-500', bg: 'bg-red-600/10', text: 'text-red-500', dot: 'bg-red-500' } },
  skipped:    { variant: 'neutral', overrides: { badgeDot: 'bg-gray-500', bg: 'bg-gray-600/10', text: 'text-[var(--text-muted)]', dot: 'bg-gray-500' } },
  cooldown:   { variant: 'neutral', overrides: { badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
  disabled:   { variant: 'danger',  overrides: { badgeDot: 'bg-red-400/50', bg: 'bg-red-500/5', text: 'text-red-400/50', dot: 'bg-red-400/50' } },
}

export const AUTOMATION_TRIGGERS = ['manual'] as const
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number]

export const AUTOMATION_TRANSITIONS: TransitionRow<AutomationState, AutomationTrigger>[] = [
  { from: 'idle',       to: 'evaluating', trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'evaluating', to: 'executing',  trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'evaluating', to: 'skipped',    trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'executing',  to: 'succeeded',  trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'executing',  to: 'partial',    trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'executing',  to: 'failed',     trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'failed',     to: 'retrying',   trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'retrying',   to: 'executing',  trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'retrying',   to: 'gave_up',    trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'succeeded',  to: 'cooldown',   trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'succeeded',  to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'partial',    to: 'cooldown',   trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'partial',    to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'gave_up',    to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'gave_up',    to: 'disabled',   trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'skipped',    to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'cooldown',   to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'disabled',   to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
]

export const AUTOMATION_EDGES: Edge<AutomationState>[] = deriveEdges(AUTOMATION_TRANSITIONS)

export const AUTOMATION_FSM: FSMDefinition<AutomationState, AutomationTrigger> = {
  states: AUTOMATION_STATE_ENTRIES,
  edges: AUTOMATION_EDGES,
  transitions: AUTOMATION_TRANSITIONS,
}
