// Page-scoped helpers for the Sharing → Trips redesign. Kept out of the
// page/component files so the render code stays declarative and the math is
// unit-testable in isolation.

import type { Trip } from '@/api/types'
import { fmtInt, safeNumber } from '@/lib/numberFormat'

/**
 * Resolve a trip's duration in SI seconds. Prefers the canonical
 * `total_duration_s` aggregate; falls back to the start/end timestamp delta
 * for older rows where the aggregate was not backfilled. Always SI seconds —
 * callers format at the display boundary.
 */
export function tripDurationSeconds(trip: Trip): number {
  if (typeof trip.total_duration_s === 'number' && trip.total_duration_s > 0) {
    return trip.total_duration_s
  }
  if (!trip.end_date) return 0
  const ms = new Date(trip.end_date).getTime() - new Date(trip.start_date).getTime()
  return Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0
}

/**
 * Format an SI-seconds duration into a compact "1h 30m" / "45m" / "30s"
 * label. Display-boundary formatter — accepts SI seconds only, mirrors the
 * reference TimelinePage's duration rendering for a connected feel.
 */
export function formatTripDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `${fmtInt(seconds)}s`
  // Round to whole minutes FIRST, then split into h/m. Deriving the hour from
  // the fractional minute count and rounding the remainder separately let a
  // remainder of e.g. 59.6 min surface as "60m" / "1h 60m" — the remainder
  // rounds up to 60 while the hour digit was floored from the pre-round value.
  // Rounding up front carries that minute into the hour (3599s → "1h",
  // 7176s → "2h") so an impossible ":60" can never render.
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const remMin = totalMinutes - hours * 60
  if (hours === 0) return `${remMin}m`
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`
}

/** Aggregated KPI-band totals derived from the shareable-trips list. */
export interface TripKpis {
  count: number
  totalDistanceM: number
  totalEnergyWh: number
  totalDrives: number
}

/**
 * Aggregate the shareable-trips list into KPI-band totals. Defensive on both
 * axes: a nullish list folds to zeroed totals (the trips hook can hand us
 * `undefined` before the first fetch resolves), and every numeric field runs
 * through `safeNumber` so a partial or corrupt API row — `null`, `undefined`,
 * `NaN`, or `Infinity` — contributes `0` rather than poisoning the running sum.
 */
export function aggregateTripKpis(trips: Trip[] | null | undefined): TripKpis {
  return (trips ?? []).reduce<TripKpis>(
    (acc, trip) => ({
      count: acc.count + 1,
      totalDistanceM: acc.totalDistanceM + safeNumber(trip.total_distance_m),
      totalEnergyWh: acc.totalEnergyWh + safeNumber(trip.total_energy_wh),
      totalDrives: acc.totalDrives + safeNumber(trip.drive_count),
    }),
    { count: 0, totalDistanceM: 0, totalEnergyWh: 0, totalDrives: 0 },
  )
}
