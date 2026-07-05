import type { VehicleState } from '@/api/types'
import { fmtInt } from '@/lib/numberFormat'
export { deriveVehicleStatus as deriveStatus, statusVariant } from '@/api/types'

export interface StateResponse {
  state: VehicleState
  live: boolean
}

export function batteryColor(level: number): string {
  if (level > 60) return '#10b981'
  if (level > 25) return '#f59e0b'
  return '#ef4444'
}

/**
 * Backend tire-pressure SI baseline is Pascals
 * (UnitKindPressure ToSI). All comparisons live in Pa to keep one
 * canonical source of truth shared by `TirePressurePanel` and
 * `TirePressureSection`. Display conversion to kPa (frontend SI floor)
 * and then to the user's pressure preference happens at the renderer.
 */
export const TIRE_PRESSURE_PA = Object.freeze({
  /** Below this is critical-low (≈ 30.0 psi / 2.068 bar). */
  LOW_CRITICAL: 206_800,
  /** Below this is warning-low (≈ 35.0 psi / 2.413 bar). */
  LOW_WARNING: 241_300,
  /** Above this is warning-high (≈ 45.0 psi / 3.103 bar). */
  HIGH_WARNING: 310_300,
  /** Above this is critical-high (≈ 50.0 psi / 3.447 bar). */
  HIGH_CRITICAL: 344_700,
} as const)

/** 1 kPa = 1000 Pa. Frontend `formatPressure` expects kPa input. */
export function paToKpa(pa: number | null | undefined): number | null {
  if (pa == null || !Number.isFinite(pa)) return null
  return pa / 1000
}

/**
 * Directional tire-pressure status derived from the backend SI value (Pa).
 *
 * Unlike the coarse UI {@link tirePressureVariant}, this preserves the LOW vs
 * HIGH direction, so an over-inflated tyre is never mislabelled as "low".
 * Returns 'unknown' for nullish / non-finite input.
 */
export type TirePressureStatus =
  | 'normal'
  | 'low'
  | 'high'
  | 'critical-low'
  | 'critical-high'
  | 'unknown'

/** Classify a backend SI tire pressure (Pa) into a directional status band. */
export function tirePressureStatus(pa: number | null | undefined): TirePressureStatus {
  if (pa == null || !Number.isFinite(pa)) return 'unknown'
  if (pa < TIRE_PRESSURE_PA.LOW_CRITICAL) return 'critical-low'
  if (pa > TIRE_PRESSURE_PA.HIGH_CRITICAL) return 'critical-high'
  if (pa < TIRE_PRESSURE_PA.LOW_WARNING) return 'low'
  if (pa > TIRE_PRESSURE_PA.HIGH_WARNING) return 'high'
  return 'normal'
}

const TIRE_STATUS_VARIANT: Record<
  TirePressureStatus,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  normal: 'success',
  low: 'warning',
  high: 'warning',
  'critical-low': 'danger',
  'critical-high': 'danger',
  unknown: 'neutral',
}

/**
 * Map a backend SI pressure value (Pa) to a tire-pressure UI variant.
 * Returns 'neutral' for unknown values, 'success' inside the safe band,
 * 'warning' inside the soft band, and 'danger' outside the critical band.
 */
export function tirePressureVariant(pa: number | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  return TIRE_STATUS_VARIANT[tirePressureStatus(pa)]
}

export function durationStr(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = fmtInt(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
