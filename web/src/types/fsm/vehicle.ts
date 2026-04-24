import type { StateEntry, Edge, FSMDefinition } from './types'

/**
 * Vehicle operational states — MUST match Go `internal/enums/constants.go`
 * plus frontend-only 'updating' (from Tesla API, not our FSM).
 */
export const VEHICLE_STATES = [
  'online', 'driving', 'charging', 'parked',
  'updating', 'asleep', 'offline',
] as const

export type VehicleState = (typeof VEHICLE_STATES)[number]

/**
 * Each state maps to a BadgeVariant. Theme resolves all Tailwind classes.
 * Use `overrides` ONLY when a state needs a non-standard color
 * (e.g., driving = success variant but with blue tint for visual distinction).
 */
export const VEHICLE_STATE_ENTRIES: Record<VehicleState, StateEntry> = {
  online:   { variant: 'success' },
  driving:  { variant: 'success', overrides: { badgeDot: 'bg-blue-500', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' } },
  charging: { variant: 'warning', overrides: { badgeDot: 'bg-yellow-400', bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' } },
  parked:   { variant: 'info',    overrides: { badgeDot: 'bg-cyan-500', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
  updating: { variant: 'info',    overrides: { badgeDot: 'bg-indigo-500', bg: 'bg-indigo-500/10', text: 'text-indigo-400', dot: 'bg-indigo-400' } },
  asleep:   { variant: 'neutral', overrides: { badgeDot: 'bg-purple-500' } },
  offline:  { variant: 'danger',  overrides: { bg: 'bg-gray-600/10', text: 'text-gray-500', dot: 'bg-gray-500' } },
}

/** Valid transitions for the vehicle FSM — compile-time checked */
export const VEHICLE_EDGES: Edge<VehicleState>[] = [
  ['online', 'driving'],  ['online', 'charging'],  ['online', 'parked'],
  ['driving', 'parked'],  ['driving', 'charging'],  ['driving', 'online'],
  ['charging', 'parked'], ['charging', 'online'],   ['charging', 'driving'],
  ['parked', 'driving'],  ['parked', 'charging'],   ['parked', 'asleep'],  ['parked', 'online'],
  ['asleep', 'online'],   ['asleep', 'offline'],
  ['offline', 'online'],
]

/** Complete vehicle FSM definition */
export const VEHICLE_FSM: FSMDefinition<VehicleState> = {
  states: VEHICLE_STATE_ENTRIES,
  edges: VEHICLE_EDGES,
}

/**
 * Display labels for vehicle states.
 * Use with i18n: t(`vehicle.state.${state}`, VEHICLE_STATE_LABELS[state])
 */
export const VEHICLE_STATE_LABELS: Record<VehicleState, string> = {
  online:   'Online',
  driving:  'Driving',
  charging: 'Charging',
  parked:   'Parked',
  updating: 'Updating',
  asleep:   'Asleep',
  offline:  'Offline',
}

/**
 * Derive vehicle status from live state data.
 * Priority: charging > driving > API state string > offline fallback.
 */
export function deriveVehicleStatus(state?: { is_charging?: boolean; speed?: number | null; state?: string | null } | null): VehicleState {
  if (!state) return 'offline'
  if (state.is_charging) return 'charging'
  if (state.speed && state.speed > 0) return 'driving'
  const s = (state.state ?? '').toLowerCase()
  if (VEHICLE_STATES.includes(s as VehicleState)) return s as VehicleState
  return 'online'
}
