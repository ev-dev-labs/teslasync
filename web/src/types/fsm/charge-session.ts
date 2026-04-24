import { deriveEdges, type TransitionRow, type StateEntry, type Edge, type FSMDefinition } from './types'

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

export const CHARGE_SESSION_FSM: FSMDefinition<ChargeSessionState> = {
  states: CHARGE_SESSION_STATE_ENTRIES,
  edges: CHARGE_SESSION_EDGES,
}
