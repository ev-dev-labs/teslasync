/**
 * Centralized TypeScript enum types and display config.
 * Vehicle state types/helpers re-exported from FSM single source.
 */

/* ── Vehicle States — re-export from FSM single source ── */

export type { VehicleState } from '@/types/fsm'

import { resolveStyle, VEHICLE_STATE_ENTRIES } from '@/types/fsm'
import type { VehicleState } from '@/types/fsm'

/** Badge color name for the shared Badge component, given a vehicle state string */
export function getStateBadgeColor(state: string | undefined | null): 'green' | 'amber' | 'cyan' | 'purple' | 'red' | 'neutral' {
  const s = (state ?? '').toLowerCase() as VehicleState
  const entry = VEHICLE_STATE_ENTRIES[s]
  if (!entry) return 'neutral'
  const variantMap: Record<string, 'green' | 'amber' | 'cyan' | 'purple' | 'red' | 'neutral'> = {
    success: 'green', warning: 'amber', info: 'cyan', neutral: 'neutral', danger: 'red',
  }
  return variantMap[entry.variant] ?? 'neutral'
}

/** CSS text color class for a vehicle state */
export function getStateColor(state: string | undefined | null): string {
  const s = (state ?? '').toLowerCase() as VehicleState
  const entry = VEHICLE_STATE_ENTRIES[s]
  return entry ? resolveStyle(entry).text : 'text-gray-400'
}

/** Display label for a vehicle state */
export function getStateLabel(state: string | undefined | null): string {
  const labels: Record<string, string> = {
    driving: 'Driving', charging: 'Charging', parked: 'Parked',
    asleep: 'Asleep', online: 'Online', offline: 'Offline', updating: 'Updating',
  }
  return labels[(state ?? '').toLowerCase()] ?? 'Unknown'
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

export type ChargePortLatchState = 'Engaged' | 'Disengaged'
