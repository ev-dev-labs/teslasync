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

/** Project a fully-resolved style down to the 4-class {@link StateStyle} shape
 *  (drops the `variant` discriminant). Single home for the projection so the
 *  STATE_COLORS map and {@link getStateColor} can never drift apart. */
function toStateStyle({ badgeDot, bg, text, dot }: ResolvedStateStyle): StateStyle {
  return { badgeDot, bg, text, dot }
}

/**
 * Guarded lookup shared by {@link getStateColor} and {@link getStateDefinition}.
 * Resolves an FSM type + state name to its full themed style, tolerating:
 *   - an unknown `fsmType` (falls back to the vehicle FSM — backward-compat), and
 *   - a nullish / non-string / unknown `state`, returning the neutral default
 *     instead of throwing on `state.toLowerCase()`.
 * Matching is case-insensitive; callers own any trimming (see StateBadge).
 */
function resolveStateEntry(fsmType: string, state: string | null | undefined): ResolvedStateStyle {
  if (typeof state !== 'string') return DEFAULT_STATE
  const def = FSM_REGISTRY[fsmType as keyof typeof FSM_REGISTRY] ?? FSM_REGISTRY.vehicle
  const states = def.states as Record<string, StateEntry>
  const entry = states[state.toLowerCase()]
  return entry ? resolveStyle(entry) : DEFAULT_STATE
}

/** Color map per FSM type — resolves theme + overrides (backward-compat) */
export const STATE_COLORS: Record<string, Record<string, StateStyle>> = Object.fromEntries(
  Object.entries(FSM_REGISTRY).map(([fsmType, def]) => [
    fsmType,
    Object.fromEntries(
      Object.entries(def.states).map(([state, entry]) => [state, toStateStyle(resolveStyle(entry))]),
    ),
  ]),
)

/** Resolve state style for a given FSM type + state name. Null-safe: a nullish
 *  or unknown state resolves to the neutral default rather than throwing. */
export function getStateColor(fsmType: string, state: string | null | undefined): StateStyle {
  return toStateStyle(resolveStateEntry(fsmType, state))
}

/** Get the full resolved style (includes badge variant + badgeDot). Null-safe:
 *  a nullish or unknown state resolves to the neutral default. */
export function getStateDefinition(fsmType: string, state: string | null | undefined): ResolvedStateStyle {
  return resolveStateEntry(fsmType, state)
}
