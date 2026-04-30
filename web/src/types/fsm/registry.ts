import type { FSMDefinition, ResolvedStateStyle, StateStyle, StateEntry } from './types'
import { resolveStyle, DEFAULT_STATE } from './theme'
import { VEHICLE_FSM, VEHICLE_STATES } from './vehicle'
import { DRIVE_SESSION_FSM, DRIVE_SESSION_STATES } from './drive-session'
import { CHARGE_SESSION_FSM, CHARGE_SESSION_STATES } from './charge-session'
import { COMMAND_FSM, COMMAND_STATES } from './command'
import { NOTIFICATION_FSM, NOTIFICATION_STATES } from './notification'
import { ALERT_COOLDOWN_FSM, ALERT_COOLDOWN_STATES } from './alert-cooldown'
import { AUTOMATION_FSM, AUTOMATION_STATES } from './automation'
import { TELEMETRY_CONNECTION_FSM, TELEMETRY_CONNECTION_STATES } from './telemetry-connection'

/**
 * FSM_REGISTRY — assembled from individual typed FSM files.
 * Add a new FSM: create its file, import here, add one entry.
 *
 * Uses `satisfies` to preserve literal key types while conforming
 * to Record<string, FSMDefinition>.
 */
export const FSM_REGISTRY = {
  vehicle:              VEHICLE_FSM,
  drive_session:        DRIVE_SESSION_FSM,
  charge_session:       CHARGE_SESSION_FSM,
  command:              COMMAND_FSM,
  notification:         NOTIFICATION_FSM,
  alert_cooldown:       ALERT_COOLDOWN_FSM,
  automation:           AUTOMATION_FSM,
  telemetry_connection: TELEMETRY_CONNECTION_FSM,
} satisfies Record<string, FSMDefinition>

/** State name arrays per FSM type — uses explicit typed arrays for stable ordering */
export const FSM_STATES: Record<string, readonly string[]> = {
  vehicle:              VEHICLE_STATES,
  drive_session:        DRIVE_SESSION_STATES,
  charge_session:       CHARGE_SESSION_STATES,
  command:              COMMAND_STATES,
  notification:         NOTIFICATION_STATES,
  alert_cooldown:       ALERT_COOLDOWN_STATES,
  automation:           AUTOMATION_STATES,
  telemetry_connection: TELEMETRY_CONNECTION_STATES,
}

/** Transition edges per FSM type (backward-compat) */
export const FSM_EDGES: Record<string, [string, string][]> = Object.fromEntries(
  Object.entries(FSM_REGISTRY).map(([k, v]) => [k, v.edges]),
)

/** Color map per FSM type — resolves theme + overrides (backward-compat) */
export const STATE_COLORS: Record<string, Record<string, StateStyle>> = Object.fromEntries(
  Object.entries(FSM_REGISTRY).map(([fsmType, def]) => [
    fsmType,
    Object.fromEntries(
      Object.entries(def.states).map(([state, entry]) => {
        const resolved = resolveStyle(entry)
        return [state, { badgeDot: resolved.badgeDot, bg: resolved.bg, text: resolved.text, dot: resolved.dot }]
      }),
    ),
  ]),
)

/** Resolve state style for a given FSM type + state name */
export function getStateColor(fsmType: string, state: string): StateStyle {
  const def = FSM_REGISTRY[fsmType as keyof typeof FSM_REGISTRY] ?? FSM_REGISTRY.vehicle
  const states = def.states as Record<string, StateEntry>
  const entry = states[state.toLowerCase()]
  if (!entry) return DEFAULT_STATE
  const resolved = resolveStyle(entry)
  return { badgeDot: resolved.badgeDot, bg: resolved.bg, text: resolved.text, dot: resolved.dot }
}

/** Get the full resolved style (includes badge variant + badgeDot) */
export function getStateDefinition(fsmType: string, state: string): ResolvedStateStyle {
  const def = FSM_REGISTRY[fsmType as keyof typeof FSM_REGISTRY] ?? FSM_REGISTRY.vehicle
  const states = def.states as Record<string, StateEntry>
  const entry = states[state.toLowerCase()]
  return entry ? resolveStyle(entry) : DEFAULT_STATE
}
