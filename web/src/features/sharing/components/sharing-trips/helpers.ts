// Page-scoped helpers for the Sharing → Trips redesign. Kept out of the
// page/component files so the render code stays declarative and the math is
// unit-testable in isolation.

import type { Trip } from '@/api/types'
import { fmtInt } from '@/lib/numberFormat'

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
  const minutes = seconds / 60
  const hours = Math.floor(minutes / 60)
  const remMin = minutes - hours * 60
  if (hours === 0) return `${fmtInt(remMin)}m`
  return remMin >= 0.5 ? `${hours}h ${fmtInt(remMin)}m` : `${hours}h`
}

/** Aggregated KPI-band totals derived from the shareable-trips list. */
export interface TripKpis {
  count: number
  totalDistanceM: number
  totalEnergyWh: number
  totalDrives: number
}

/**
 * Aggregate the shareable-trips list into KPI-band totals. Null-safe: every
 * optional numeric field folds through `?? 0` so a partial API row never
 * produces `NaN`.
 */
export function aggregateTripKpis(trips: Trip[]): TripKpis {
  return trips.reduce<TripKpis>(
    (acc, trip) => ({
      count: acc.count + 1,
      totalDistanceM: acc.totalDistanceM + (trip.total_distance_m ?? 0),
      totalEnergyWh: acc.totalEnergyWh + (trip.total_energy_wh ?? 0),
      totalDrives: acc.totalDrives + (trip.drive_count ?? 0),
    }),
    { count: 0, totalDistanceM: 0, totalEnergyWh: 0, totalDrives: 0 },
  )
}
