import type { StateEntry, Edge, FSMDefinition, TransitionRow, DisallowedTransition, CoverageMatrix, Scenario } from './types'
import { deriveEdges } from './types'

export const ALERT_COOLDOWN_STATES = ['armed', 'fired', 'suppressed'] as const
export type AlertCooldownState = (typeof ALERT_COOLDOWN_STATES)[number]

export const ALERT_COOLDOWN_STATE_ENTRIES: Record<AlertCooldownState, StateEntry> = {
  armed:      { variant: 'success' },
  fired:      { variant: 'danger' },
  suppressed: { variant: 'warning' },
}

export const ALERT_COOLDOWN_TRIGGERS = ['condition_met', 'cooldown_expired'] as const
export type AlertCooldownTrigger = (typeof ALERT_COOLDOWN_TRIGGERS)[number]

export const ALERT_COOLDOWN_GUARDS = ['within_cooldown', 'max_fires_per_hour'] as const
export type AlertCooldownGuard = (typeof ALERT_COOLDOWN_GUARDS)[number]

export interface AlertCooldownConfig {
  cooldownDuration: number
  maxFiresPerHour: number
  suppressInStates: string[]
}

export const ALERT_COOLDOWN_TRANSITIONS: TransitionRow<AlertCooldownState, AlertCooldownTrigger>[] = [
  { from: 'armed',      to: 'fired',      trigger: 'condition_met',    guard: null,              timing: 'immediate' },
  { from: 'fired',      to: 'suppressed', trigger: 'condition_met',    guard: 'within_cooldown', timing: 'immediate' },
  { from: 'fired',      to: 'armed',      trigger: 'cooldown_expired', guard: null,              timing: 'immediate' },
  { from: 'suppressed', to: 'suppressed', trigger: 'condition_met',    guard: 'within_cooldown', timing: 'immediate' },
  { from: 'suppressed', to: 'armed',      trigger: 'cooldown_expired', guard: null,              timing: 'immediate' },
]

export const ALERT_COOLDOWN_EDGES: Edge<AlertCooldownState>[] = deriveEdges(ALERT_COOLDOWN_TRANSITIONS)

export const ALERT_COOLDOWN_DISALLOWED: DisallowedTransition<AlertCooldownState>[] = [
  { from: 'armed',      to: 'suppressed', reason: 'Must fire first' },
  { from: 'suppressed', to: 'fired',      reason: 'Must go through Armed (cooldown expired)' },
]

export const ALERT_COOLDOWN_COVERAGE: CoverageMatrix<AlertCooldownState> = {
  armed:      { armed: 'self', fired: 'valid',      suppressed: 'disallowed' },
  fired:      { armed: 'valid', fired: 'self',      suppressed: 'valid' },
  suppressed: { armed: 'valid', fired: 'disallowed', suppressed: 'self' },
}

export const ALERT_COOLDOWN_SCENARIOS: Scenario<AlertCooldownState>[] = [
  { id: 'A1', description: 'First fire',                      transitions: ['armed', 'fired'] },
  { id: 'A2', description: 'Same condition within cooldown',   transitions: ['fired', 'suppressed'] },
  { id: 'A3', description: 'Repeated suppressions',            transitions: ['suppressed', 'suppressed'] },
  { id: 'A4', description: 'Cooldown expires while suppressed', transitions: ['suppressed', 'armed'] },
  { id: 'A5', description: 'Cooldown expires cleanly',         transitions: ['fired', 'armed'] },
]

export const ALERT_COOLDOWN_FSM: FSMDefinition<AlertCooldownState, AlertCooldownTrigger> = {
  states: ALERT_COOLDOWN_STATE_ENTRIES, edges: ALERT_COOLDOWN_EDGES,
  transitions: ALERT_COOLDOWN_TRANSITIONS, disallowed: ALERT_COOLDOWN_DISALLOWED,
  coverage: ALERT_COOLDOWN_COVERAGE, scenarios: ALERT_COOLDOWN_SCENARIOS,
}
