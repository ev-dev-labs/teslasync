import { deriveEdges, type TransitionRow, type StateEntry, type Edge, type FSMDefinition, type DisallowedTransition, type CoverageMatrix, type Scenario } from './types'

export const CHARGE_SESSION_STATES = [
  'pending', 'active', 'completing', 'done', 'recovered',
] as const

export type ChargeSessionState = (typeof CHARGE_SESSION_STATES)[number]

export const CHARGE_SESSION_STATE_ENTRIES: Record<ChargeSessionState, StateEntry> = {
  pending:    { variant: 'warning' },
  active:     { variant: 'success', overrides: { badgeDot: 'bg-cyan-400', bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' } },
  completing: { variant: 'info' },
  done:       { variant: 'success' },
  recovered:  { variant: 'neutral', overrides: { badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
}

export const CHARGE_SESSION_TRIGGERS = [
  'start_snapshot_ready', 'pod_restart', 'charge_ending',
  'gear_driving', 'end_snapshot_ready', 'end_snapshot_timeout',
  'charge_still_active',
] as const
export type ChargeSessionTrigger = (typeof CHARGE_SESSION_TRIGGERS)[number]

export const CHARGE_SESSION_GUARDS = [
  'has_charge_start_fields', 'has_charge_end_fields',
] as const
export type ChargeSessionGuard = (typeof CHARGE_SESSION_GUARDS)[number]

export interface ChargeSignalContext {
  startBattery: number
  startRange: number
  startLatitude: number
  startLongitude: number
  endBattery: number
  endRange: number
  energyAdded: number
  chargerType: 'AC' | 'DC'
  maxVoltage: number
  maxCurrent: number
  maxPower: number
}

export const CHARGE_SESSION_TRANSITIONS: TransitionRow<ChargeSessionState, ChargeSessionTrigger>[] = [
  { from: 'pending',    to: 'active',     trigger: 'start_snapshot_ready', guard: 'has_charge_start_fields', timing: 'immediate' },
  { from: 'pending',    to: 'recovered',  trigger: 'pod_restart',          guard: null,                      timing: 'immediate' },
  { from: 'active',     to: 'completing', trigger: 'charge_ending',        guard: null,                      timing: 'immediate' },
  { from: 'active',     to: 'completing', trigger: 'gear_driving',         guard: null,                      timing: 'immediate' },
  { from: 'active',     to: 'recovered',  trigger: 'pod_restart',          guard: null,                      timing: 'immediate' },
  { from: 'completing', to: 'done',       trigger: 'end_snapshot_ready',   guard: 'has_charge_end_fields',   timing: 'immediate' },
  { from: 'completing', to: 'done',       trigger: 'end_snapshot_timeout', guard: null,                      timing: 'immediate' },
  { from: 'recovered',  to: 'active',     trigger: 'charge_still_active',  guard: null,                      timing: 'immediate' },
  { from: 'recovered',  to: 'completing', trigger: 'charge_ending',        guard: null,                      timing: 'immediate' },
]

export const CHARGE_SESSION_EDGES: Edge<ChargeSessionState>[] = deriveEdges(CHARGE_SESSION_TRANSITIONS)

export const CHARGE_SESSION_DISALLOWED: DisallowedTransition<ChargeSessionState>[] = [
  { from: 'active', to: 'pending', reason: 'Snapshots only flow forward' },
  { from: 'done',   to: 'pending', reason: 'Terminal' },
  { from: 'done',   to: 'active',  reason: 'Terminal' },
  { from: 'pending', to: 'done',   reason: 'Must accumulate via Active first' },
]

// The four CHARGE_SESSION_DISALLOWED pairs are marked 'disallowed' (not null) so
// isValidTransition() surfaces the forbidden-with-reason edges instead of an
// ambiguous "no info" null — mirroring the vehicle FSM's coverage contract.
export const CHARGE_SESSION_COVERAGE: CoverageMatrix<ChargeSessionState> = {
  pending:    { pending: 'self',       active: 'valid',      completing: null,    done: 'disallowed', recovered: 'valid' },
  active:     { pending: 'disallowed', active: 'self',       completing: 'valid', done: null,         recovered: 'valid' },
  completing: { pending: null,         active: null,         completing: 'self',  done: 'valid',      recovered: null },
  done:       { pending: 'disallowed', active: 'disallowed', completing: null,    done: 'self',       recovered: null },
  recovered:  { pending: null,         active: 'valid',      completing: 'valid', done: null,         recovered: 'self' },
}

export const CHARGE_SESSION_SCENARIOS: Scenario<ChargeSessionState>[] = [
  { id: 'C1',  description: 'Normal AC home charge to 80%',                    transitions: ['pending', 'active', 'completing', 'done'] },
  { id: 'C2',  description: 'DC Supercharger, ramp & taper',                   transitions: ['pending', 'active', 'completing', 'done'] },
  { id: 'C3',  description: 'Pod restart mid-charge, still active',            transitions: ['active', 'recovered', 'active'] },
  { id: 'C4',  description: 'Pod restart, charge already completed',           transitions: ['active', 'recovered', 'completing', 'done'] },
  { id: 'C5',  description: 'Unplug & immediately drive off',                  transitions: ['active', 'completing', 'done'] },
  { id: 'C6',  description: 'Charge interrupted by fault',                     transitions: ['active', 'completing', 'done'] },
  { id: 'C7',  description: 'End battery never arrives within 30s',            transitions: ['completing', 'done'] },
  { id: 'C8',  description: 'Cell-balance dwell (Vehicle Asleep)',             transitions: ['active'] },
  { id: 'C9',  description: 'Plug-in but never starts (handshake fail)',       transitions: ['pending'] },
  { id: 'C10', description: 'Two back-to-back plug-ins',                       transitions: ['pending', 'active', 'completing', 'done'] },
]

export const CHARGE_SESSION_FSM: FSMDefinition<ChargeSessionState, ChargeSessionTrigger> = {
  states: CHARGE_SESSION_STATE_ENTRIES,
  edges: CHARGE_SESSION_EDGES,
  transitions: CHARGE_SESSION_TRANSITIONS,
  disallowed: CHARGE_SESSION_DISALLOWED,
  coverage: CHARGE_SESSION_COVERAGE,
  scenarios: CHARGE_SESSION_SCENARIOS,
}
