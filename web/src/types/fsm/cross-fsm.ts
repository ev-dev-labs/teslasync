import type { VehicleState } from './vehicle'

export type FSMAction =
  | 'CreateDriveSubFSM' | 'FinalizeDriveSubFSM' | 'ReconcileDriveSubFSM'
  | 'CreateChargeSubFSM' | 'FinalizeChargeSubFSM' | 'ReconcileChargeSubFSM'
  | 'ResumeOrCreateChargeSubFSM' | 'PauseChargeSubFSM' | 'MarkChargeInterrupted'
  | 'PersistState' | 'LogTransition'

/**
 * Cross-FSM wiring — the side-effect actions the Vehicle FSM fires on each
 * `from→to` transition, mirroring the Go backend `manageSubFSMs`
 * (internal/api/vehiclefsm/handler.go). Invariants: every transition that
 * enters or leaves `driving`/`charging` creates or finalizes the matching
 * sub-FSM, and every entry ends with `PersistState` then `LogTransition`.
 */
export const VEHICLE_TRANSITION_ACTIONS: Partial<Record<`${VehicleState}→${VehicleState}`, FSMAction[]>> = {
  'online→driving':   ['CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'parked→driving':   ['CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'asleep→driving':   ['CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'offline→driving':  ['ReconcileDriveSubFSM', 'PersistState', 'LogTransition'],
  'driving→parked':   ['FinalizeDriveSubFSM', 'PersistState', 'LogTransition'],
  'driving→charging': ['FinalizeDriveSubFSM', 'CreateChargeSubFSM', 'PersistState', 'LogTransition'],
  'driving→offline':  ['FinalizeDriveSubFSM', 'PersistState', 'LogTransition'],
  'driving→online':   ['FinalizeDriveSubFSM', 'PersistState', 'LogTransition'],
  'online→charging':  ['CreateChargeSubFSM', 'PersistState', 'LogTransition'],
  'parked→charging':  ['CreateChargeSubFSM', 'PersistState', 'LogTransition'],
  'asleep→charging':  ['ResumeOrCreateChargeSubFSM', 'PersistState', 'LogTransition'],
  'offline→charging': ['ReconcileChargeSubFSM', 'PersistState', 'LogTransition'],
  'charging→parked':  ['FinalizeChargeSubFSM', 'PersistState', 'LogTransition'],
  'charging→driving': ['FinalizeChargeSubFSM', 'CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'charging→online':  ['FinalizeChargeSubFSM', 'MarkChargeInterrupted', 'PersistState', 'LogTransition'],
  'charging→asleep':  ['PauseChargeSubFSM', 'PersistState', 'LogTransition'],
  'charging→offline': ['FinalizeChargeSubFSM', 'PersistState', 'LogTransition'],
}

/**
 * Null-safe lookup of the actions wired for a `from→to` transition. Returns an
 * empty array (never `undefined`) for transitions that have no cross-FSM side
 * effects, so callers can iterate the result directly.
 */
export function getTransitionActions(from: VehicleState, to: VehicleState): FSMAction[] {
  return VEHICLE_TRANSITION_ACTIONS[`${from}→${to}`] ?? []
}

/**
 * Failure-isolation guarantees between the Vehicle FSM and its satellites
 * (sub-FSMs, notification workers, command dispatch). Documented for the FSM
 * debugger; enforced by the Go runtime.
 */
export const FAILURE_ISOLATION_RULES = [
  'Sub-FSM panic must NOT propagate to Vehicle FSM — wrapped in recover()',
  'Notification failure must NOT block Vehicle FSM — separate worker pool',
  'Command failure has no effect on telemetry — different goroutine',
] as const

/**
 * States deliberately NOT modelled by the current Vehicle FSM — each would need
 * a new top-level state before it can be handled.
 */
export const OUT_OF_SCOPE_STATES = [
  { state: 'Fault',              reason: 'Critical BMS/HV/thermal — needs new top-level state' },
  { state: 'Updating',           reason: 'OTA lock-out — needs new top-level state' },
  { state: 'Valet / Service',    reason: 'Restricted telemetry — needs new top-level state' },
  { state: 'Summon / Smart Park', reason: 'Autonomous low-speed — needs new top-level state' },
] as const
