// Foundation
export type { BadgeVariant, StateStyle, StateEntry, Edge, FSMDefinition, ResolvedStateStyle } from './types'
export { VARIANT_THEME, resolveStyle, DEFAULT_STATE } from './theme'

// Registry (assembled from all FSMs)
export {
  FSM_REGISTRY, FSM_STATES, FSM_EDGES, STATE_COLORS,
  getStateColor, getStateDefinition,
} from './registry'

// UI / API types (debugger page, hooks)
export type { FSMTransition, ActiveSubFSM, FSMStats, FSMTransitionResponse, FSMType } from './ui-types'
export { FSM_TYPE_OPTIONS, HOURS_OPTIONS } from './ui-types'

// Vehicle FSM
export type { VehicleState } from './vehicle'
export {
  VEHICLE_STATES, VEHICLE_STATE_ENTRIES, VEHICLE_EDGES,
  VEHICLE_FSM, VEHICLE_STATE_LABELS, deriveVehicleStatus,
} from './vehicle'

// Drive Session FSM
export type { DriveSessionState } from './drive-session'
export { DRIVE_SESSION_STATES, DRIVE_SESSION_STATE_ENTRIES, DRIVE_SESSION_EDGES, DRIVE_SESSION_FSM } from './drive-session'

// Charge Session FSM
export type { ChargeSessionState } from './charge-session'
export { CHARGE_SESSION_STATES, CHARGE_SESSION_STATE_ENTRIES, CHARGE_SESSION_EDGES, CHARGE_SESSION_FSM } from './charge-session'

// Command FSM
export type { CommandState } from './command'
export { COMMAND_STATES, COMMAND_STATE_ENTRIES, COMMAND_EDGES, COMMAND_FSM } from './command'

// Notification FSM
export type { NotificationState } from './notification'
export { NOTIFICATION_STATES, NOTIFICATION_STATE_ENTRIES, NOTIFICATION_EDGES, NOTIFICATION_FSM } from './notification'

// Alert Cooldown FSM
export type { AlertCooldownState } from './alert-cooldown'
export { ALERT_COOLDOWN_STATES, ALERT_COOLDOWN_STATE_ENTRIES, ALERT_COOLDOWN_EDGES, ALERT_COOLDOWN_FSM } from './alert-cooldown'

// Automation FSM
export type { AutomationState } from './automation'
export { AUTOMATION_STATES, AUTOMATION_STATE_ENTRIES, AUTOMATION_EDGES, AUTOMATION_FSM } from './automation'

// Telemetry Connection FSM
export type { TelemetryConnectionState } from './telemetry-connection'
export { TELEMETRY_CONNECTION_STATES, TELEMETRY_CONNECTION_STATE_ENTRIES, TELEMETRY_CONNECTION_EDGES, TELEMETRY_CONNECTION_FSM } from './telemetry-connection'

// ═══ v2 additions ═══

// Extended types
export type { TransitionTiming, TransitionRow, CoverageCell, CoverageMatrix,
  DisallowedTransition, Scenario, ToastMap, TruthTableCell, TruthTable } from './types'
export { deriveEdges, isValidTransition } from './types'

// Vehicle v2
export type { VehicleTrigger, VehicleGuard, VehicleSignalContext } from './vehicle'
export { VEHICLE_TRIGGERS, VEHICLE_GUARDS, VEHICLE_TRANSITIONS,
  VEHICLE_DISALLOWED, VEHICLE_DISALLOWED_PATTERNS, VEHICLE_COVERAGE,
  VEHICLE_TRUTH_TABLE, VEHICLE_SCENARIOS } from './vehicle'

// Drive Session v2
export type { DriveSessionTrigger, DriveSessionGuard, DriveSignalContext } from './drive-session'
export { DRIVE_SESSION_TRIGGERS, DRIVE_SESSION_GUARDS, DRIVE_SESSION_TRANSITIONS,
  DRIVE_SESSION_DISALLOWED, DRIVE_SESSION_COVERAGE, DRIVE_SESSION_SCENARIOS,
  DRIVE_VALIDATION_RULES } from './drive-session'

// Charge Session v2
export type { ChargeSessionTrigger, ChargeSessionGuard, ChargeSignalContext } from './charge-session'
export { CHARGE_SESSION_TRIGGERS, CHARGE_SESSION_GUARDS, CHARGE_SESSION_TRANSITIONS,
  CHARGE_SESSION_DISALLOWED, CHARGE_SESSION_COVERAGE, CHARGE_SESSION_SCENARIOS } from './charge-session'

// Alert Cooldown v2
export type { AlertCooldownTrigger, AlertCooldownGuard, AlertCooldownConfig } from './alert-cooldown'
export { ALERT_COOLDOWN_TRIGGERS, ALERT_COOLDOWN_GUARDS, ALERT_COOLDOWN_TRANSITIONS,
  ALERT_COOLDOWN_DISALLOWED, ALERT_COOLDOWN_COVERAGE, ALERT_COOLDOWN_SCENARIOS } from './alert-cooldown'

// Notification v2
export type { NotificationTrigger, NotificationGuard } from './notification'
export { NOTIFICATION_TRIGGERS, NOTIFICATION_GUARDS, NOTIFICATION_TRANSITIONS,
  NOTIFICATION_DISALLOWED, NOTIFICATION_COVERAGE, NOTIFICATION_SCENARIOS } from './notification'

// Command v2
export type { CommandTrigger, CommandGuard } from './command'
export { COMMAND_TRIGGERS, COMMAND_GUARDS, COMMAND_TRANSITIONS,
  COMMAND_DISALLOWED, COMMAND_COVERAGE, COMMAND_SCENARIOS, COMMAND_TOASTS } from './command'

// Automation v2
export type { AutomationTrigger } from './automation'
export { AUTOMATION_TRANSITIONS } from './automation'

// Telemetry Connection v2
export type { TelemetryConnectionTrigger } from './telemetry-connection'
export { TELEMETRY_CONNECTION_TRANSITIONS } from './telemetry-connection'

// Cross-FSM
export type { FSMAction } from './cross-fsm'
export { VEHICLE_TRANSITION_ACTIONS, FAILURE_ISOLATION_RULES, OUT_OF_SCOPE_STATES, getTransitionActions } from './cross-fsm'
