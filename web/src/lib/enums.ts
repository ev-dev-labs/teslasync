/**
 * Centralized TypeScript enum types and display config.
 * Single source of truth for all Tesla and application state values.
 */

/* ── Vehicle States ── */

export type VehicleState = 'driving' | 'charging' | 'parked' | 'asleep' | 'online' | 'offline'

export const VEHICLE_STATE_CONFIG: Record<VehicleState, {
  label: string
  color: string
  badgeColor: 'green' | 'amber' | 'cyan' | 'purple' | 'neutral' | 'red'
}> = {
  driving:  { label: 'Driving',  color: 'text-neon-green',         badgeColor: 'green' },
  charging: { label: 'Charging', color: 'text-neon-amber',         badgeColor: 'amber' },
  parked:   { label: 'Parked',   color: 'text-neon-cyan',          badgeColor: 'cyan' },
  asleep:   { label: 'Asleep',   color: 'text-neon-purple',        badgeColor: 'purple' },
  online:   { label: 'Online',   color: 'text-neon-cyan',          badgeColor: 'cyan' },
  offline:  { label: 'Offline',  color: 'text-[var(--text-muted)]', badgeColor: 'neutral' },
}

/* ── Gear States ── */

export type GearState = 'D' | 'R' | 'P' | 'N'

/* ── Charge States ── */

export type DetailedChargeState =
  | 'Charging' | 'Complete' | 'Disconnected' | 'NoPower'
  | 'Starting' | 'Stopped' | 'Error'

export function isChargingState(state: string | undefined | null): boolean {
  if (!state) return false
  return state.includes('Charging') || state.includes('Starting') || state === 'Enable'
}

export function isChargeCompleteState(state: string | undefined | null): boolean {
  if (!state) return false
  return state.includes('Complete')
}

/* ── Window States ── */

export type WindowState = 'Closed' | 'Partial' | 'Open'

/** Badge color name for the shared Badge component, given a vehicle state string */
export function getStateBadgeColor(state: string | undefined | null): 'green' | 'amber' | 'cyan' | 'purple' | 'red' | 'neutral' {
  const s = (state ?? '').toLowerCase() as VehicleState
  return VEHICLE_STATE_CONFIG[s]?.badgeColor ?? 'neutral'
}

/** CSS text color class for a vehicle state */
export function getStateColor(state: string | undefined | null): string {
  const s = (state ?? '').toLowerCase() as VehicleState
  return VEHICLE_STATE_CONFIG[s]?.color ?? 'text-[var(--text-muted)]'
}

/** Display label for a vehicle state */
export function getStateLabel(state: string | undefined | null): string {
  const s = (state ?? '').toLowerCase() as VehicleState
  return VEHICLE_STATE_CONFIG[s]?.label ?? 'Unknown'
}

export type ChargePortLatchState = 'Engaged' | 'Disengaged'
