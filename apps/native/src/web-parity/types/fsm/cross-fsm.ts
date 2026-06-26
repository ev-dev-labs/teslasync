/**
 * Native parity port of web/src/types/fsm/cross-fsm.ts.
 *
 * Cross-FSM coordination metadata: the sub-FSM actions the Vehicle FSM fires on
 * each state transition, plus the failure-isolation guarantees and out-of-scope
 * state notes. Pure non-visual type/constant code with no DOM, no React, and no
 * browser APIs, so every declaration is ported verbatim and is fully React
 * Native compatible.
 *
 * The web source imports the `VehicleState` union from the sibling `./vehicle`
 * FSM module. Native consolidated that same 7-member union into `api/types.ts`
 * (exported as `VehicleStatus`, the "single source from @/types/fsm"), so we
 * reuse it here through a type-only alias instead of duplicating the union or
 * depending on an unported sibling module.
 */
import type {VehicleStatus as VehicleState} from '../../api/types';

export type FSMAction =
  | 'CreateDriveSubFSM'
  | 'FinalizeDriveSubFSM'
  | 'ReconcileDriveSubFSM'
  | 'CreateChargeSubFSM'
  | 'FinalizeChargeSubFSM'
  | 'ReconcileChargeSubFSM'
  | 'ResumeOrCreateChargeSubFSM'
  | 'PauseChargeSubFSM'
  | 'MarkChargeInterrupted'
  | 'PersistState'
  | 'LogTransition';

export const VEHICLE_TRANSITION_ACTIONS: Partial<
  Record<`${VehicleState}→${VehicleState}`, FSMAction[]>
> = {
  'online→driving': ['CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'parked→driving': ['CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'asleep→driving': ['CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'offline→driving': ['ReconcileDriveSubFSM', 'PersistState', 'LogTransition'],
  'driving→parked': ['FinalizeDriveSubFSM', 'PersistState', 'LogTransition'],
  'driving→charging': [
    'FinalizeDriveSubFSM',
    'CreateChargeSubFSM',
    'PersistState',
    'LogTransition',
  ],
  'driving→offline': ['FinalizeDriveSubFSM', 'PersistState', 'LogTransition'],
  'online→charging': ['CreateChargeSubFSM', 'PersistState', 'LogTransition'],
  'parked→charging': ['CreateChargeSubFSM', 'PersistState', 'LogTransition'],
  'asleep→charging': [
    'ResumeOrCreateChargeSubFSM',
    'PersistState',
    'LogTransition',
  ],
  'offline→charging': ['ReconcileChargeSubFSM', 'PersistState', 'LogTransition'],
  'charging→parked': ['FinalizeChargeSubFSM', 'PersistState', 'LogTransition'],
  'charging→driving': [
    'FinalizeChargeSubFSM',
    'CreateDriveSubFSM',
    'PersistState',
    'LogTransition',
  ],
  'charging→online': [
    'FinalizeChargeSubFSM',
    'MarkChargeInterrupted',
    'PersistState',
    'LogTransition',
  ],
  'charging→asleep': ['PauseChargeSubFSM', 'PersistState', 'LogTransition'],
  'charging→offline': ['FinalizeChargeSubFSM', 'PersistState', 'LogTransition'],
};

export const FAILURE_ISOLATION_RULES = [
  'Sub-FSM panic must NOT propagate to Vehicle FSM — wrapped in recover()',
  'Notification failure must NOT block Vehicle FSM — separate worker pool',
  'Command failure has no effect on telemetry — different goroutine',
] as const;

export const OUT_OF_SCOPE_STATES = [
  {state: 'Fault', reason: 'Critical BMS/HV/thermal — needs new top-level state'},
  {state: 'Updating', reason: 'OTA lock-out — needs new top-level state'},
  {
    state: 'Valet / Service',
    reason: 'Restricted telemetry — needs new top-level state',
  },
  {
    state: 'Summon / Smart Park',
    reason: 'Autonomous low-speed — needs new top-level state',
  },
] as const;
