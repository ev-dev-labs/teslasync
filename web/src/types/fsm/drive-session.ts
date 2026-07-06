import { deriveEdges, type TransitionRow, type StateEntry, type Edge, type FSMDefinition, type DisallowedTransition, type CoverageMatrix, type Scenario } from './types'

export const DRIVE_SESSION_STATES = [
  'pending', 'active', 'ending', 'completed', 'recovered',
] as const

export type DriveSessionState = (typeof DRIVE_SESSION_STATES)[number]

export const DRIVE_SESSION_STATE_ENTRIES: Record<DriveSessionState, StateEntry> = {
  pending:   { variant: 'warning' },
  active:    { variant: 'success' },
  ending:    { variant: 'warning', overrides: { badgeDot: 'bg-orange-400', bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' } },
  completed: { variant: 'info',    overrides: { badgeDot: 'bg-indigo-400', bg: 'bg-indigo-500/10', text: 'text-indigo-400', dot: 'bg-indigo-400' } },
  recovered: { variant: 'neutral', overrides: { badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
}

export const DRIVE_SESSION_TRIGGERS = [
  'start_snapshot_ready', 'start_snapshot_timeout', 'pod_restart', 'drive_ending',
  'end_snapshot_ready', 'end_snapshot_timeout', 'signals_flowing',
] as const
export type DriveSessionTrigger = (typeof DRIVE_SESSION_TRIGGERS)[number]

export const DRIVE_SESSION_GUARDS = [
  'has_required_start_fields', 'has_required_end_fields',
] as const
export type DriveSessionGuard = (typeof DRIVE_SESSION_GUARDS)[number]

export interface DriveSignalContext {
  startOdometer: number
  startBattery: number
  startLatitude: number
  startLongitude: number
  endOdometer: number
  endBattery: number
  endLatitude: number
  endLongitude: number
}

export const DRIVE_SESSION_TRANSITIONS: TransitionRow<DriveSessionState, DriveSessionTrigger>[] = [
  { from: 'pending',   to: 'active',    trigger: 'start_snapshot_ready',  guard: 'has_required_start_fields', timing: 'immediate' },
  // Backend drive.TriggerStartTimeout: after StartSnapshotTimeout (30s) the sub-FSM
  // proceeds to Active with partial start data — the start-side mirror of
  // end_snapshot_timeout. No guard: this is the fallback when start fields never arrive.
  { from: 'pending',   to: 'active',    trigger: 'start_snapshot_timeout', guard: null,                       timing: 'immediate' },
  { from: 'pending',   to: 'recovered', trigger: 'pod_restart',           guard: null,                        timing: 'immediate' },
  { from: 'active',    to: 'ending',    trigger: 'drive_ending',          guard: null,                        timing: 'immediate' },
  { from: 'active',    to: 'recovered', trigger: 'pod_restart',           guard: null,                        timing: 'immediate' },
  { from: 'ending',    to: 'completed', trigger: 'end_snapshot_ready',    guard: 'has_required_end_fields',   timing: 'immediate' },
  { from: 'ending',    to: 'completed', trigger: 'end_snapshot_timeout',  guard: null,                        timing: 'immediate' },
  { from: 'recovered', to: 'active',    trigger: 'signals_flowing',       guard: null,                        timing: 'immediate' },
  { from: 'recovered', to: 'ending',    trigger: 'drive_ending',          guard: null,                        timing: 'immediate' },
]

export const DRIVE_SESSION_EDGES: Edge<DriveSessionState>[] = deriveEdges(DRIVE_SESSION_TRANSITIONS)

export const DRIVE_SESSION_DISALLOWED: DisallowedTransition<DriveSessionState>[] = [
  { from: 'active',    to: 'pending',   reason: 'Snapshots only flow forward' },
  { from: 'completed', to: 'pending',   reason: 'Terminal — new drive starts fresh sub-FSM' },
  { from: 'completed', to: 'active',    reason: 'Terminal' },
  { from: 'completed', to: 'ending',    reason: 'Terminal' },
  { from: 'completed', to: 'recovered', reason: 'Terminal' },
  { from: 'pending',   to: 'completed', reason: 'Must accumulate via Active first' },
]

export const DRIVE_VALIDATION_RULES = {
  distanceMin: 0, distanceMaxMi: 500, durationMinSec: 30,
  netEnergyMin: 0, efficiencyRangeWhPerMi: [100, 600] as const,
  endBatteryMaxDelta: 2,
} as const

export const DRIVE_SESSION_COVERAGE: CoverageMatrix<DriveSessionState> = {
  pending:   { pending: 'self', active: 'valid',  ending: null,    completed: null,    recovered: 'valid' },
  active:    { pending: null,   active: 'self',   ending: 'valid', completed: null,    recovered: 'valid' },
  ending:    { pending: null,   active: null,     ending: 'self',  completed: 'valid', recovered: null },
  completed: { pending: null,   active: null,     ending: null,    completed: 'self',  recovered: null },
  recovered: { pending: null,   active: 'valid',  ending: 'valid', completed: null,    recovered: 'self' },
}

export const DRIVE_SESSION_SCENARIOS: Scenario<DriveSessionState>[] = [
  { id: 'D1',  description: 'Normal drive with all signals',                     transitions: ['pending', 'active', 'ending', 'completed'] },
  { id: 'D2',  description: 'Pod restart mid-drive, signals still flowing',       transitions: ['active', 'recovered', 'active'] },
  { id: 'D3',  description: 'Pod restart while car already parked',              transitions: ['active', 'recovered', 'ending', 'completed'] },
  { id: 'D4',  description: 'End odometer never arrives within 60s',              transitions: ['ending', 'completed'] },
  { id: 'D5',  description: 'Signal lost before snapshot ready',                  transitions: ['pending', 'recovered'] },
  { id: 'D6',  description: 'Charge starts mid-drive (Supercharger)',             transitions: ['active', 'ending', 'completed'] },
  { id: 'D7',  description: 'Micro-drive (< 30s)',                                transitions: ['pending', 'active', 'ending', 'completed'] },
  { id: 'D8',  description: 'End battery > start (heavy regen)',                  transitions: ['pending', 'active', 'ending', 'completed'] },
  { id: 'D9',  description: 'Two back-to-back drives',                            transitions: ['pending', 'active', 'ending', 'completed'] },
  { id: 'D10', description: 'No start GPS (parking garage)',                      transitions: ['pending'] },
]

export const DRIVE_SESSION_FSM: FSMDefinition<DriveSessionState, DriveSessionTrigger> = {
  states: DRIVE_SESSION_STATE_ENTRIES,
  edges: DRIVE_SESSION_EDGES,
  transitions: DRIVE_SESSION_TRANSITIONS,
  disallowed: DRIVE_SESSION_DISALLOWED,
  coverage: DRIVE_SESSION_COVERAGE,
  scenarios: DRIVE_SESSION_SCENARIOS,
}
