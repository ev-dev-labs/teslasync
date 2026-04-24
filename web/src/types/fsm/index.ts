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
