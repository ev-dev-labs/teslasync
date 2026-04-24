// Foundation
export type { BadgeVariant, StateStyle, StateEntry, Edge, FSMDefinition, ResolvedStateStyle } from './types'
export { VARIANT_THEME, resolveStyle, DEFAULT_STATE } from './theme'

// Vehicle FSM
export type { VehicleState } from './vehicle'
export {
  VEHICLE_STATES, VEHICLE_STATE_ENTRIES, VEHICLE_EDGES,
  VEHICLE_FSM, VEHICLE_STATE_LABELS, deriveVehicleStatus,
} from './vehicle'
