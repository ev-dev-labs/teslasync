import type { VehicleState } from '@/api/types'
import { fmtInt } from '@/lib/numberFormat'
export { deriveVehicleStatus as deriveStatus, statusVariant } from '@/api/types'

export interface StateResponse {
  state: VehicleState
  live: boolean
}

/**
 * Map a battery state-of-charge percentage to a gauge stroke colour:
 * green above 60 %, amber across 25–60 %, red at/below 25 %. An unknown
 * level (NaN / ±Infinity / a field missing from a partial telemetry
 * payload) resolves to the muted grey the rest of the app uses for
 * "no data" instead of falling through to a misleading critical-red gauge.
 */
export function batteryColor(level: number): string {
  if (!Number.isFinite(level)) return '#6b7280'
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

/**
 * Render a minute count as a compact "Hh Mm" / "Mm" duration. Fractional
 * minutes are rounded to the nearest whole minute *before* the hour/minute
 * split so a value like 59.6 carries into "1h 0m" rather than the invalid
 * "60m" (and 1439.6 → "24h 0m", never "23h 60m"). Non-finite or negative
 * input — which a partial telemetry payload can yield — collapses to "0m".
 */
export function durationStr(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m'
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = fmtInt(total % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
