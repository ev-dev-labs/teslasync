import { describe, it, expect, beforeEach } from 'vitest'

import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import type { Trip } from '@/api/types'
import { tripDurationSeconds, formatTripDuration, aggregateTripKpis } from './helpers'

// `formatTripDuration` leans on `fmtInt`, which reads the module-scoped locale
// and precision that `useSettings` mutates at runtime. Pin both so assertions
// stay deterministic even if a sibling test file changed the globals first.
beforeEach(() => {
  setGlobalLocale('en-US')
  setGlobalPrecision(2)
})

// A fully-populated Trip row. Specs override only the fields under test. The
// override map is deliberately typed with `unknown` values (not `Partial<Trip>`)
// so a spec can model a corrupt / partial API payload — `null`, `undefined`,
// `NaN` — which is exactly the runtime shape the helpers must survive.
const BASE_TRIP: Trip = {
  id: 1,
  vehicle_id: 7,
  name: 'Coast run',
  start_date: '2026-01-01T10:00:00.000Z',
  end_date: '2026-01-01T11:00:00.000Z',
  started_at: '2026-01-01T10:00:00.000Z',
  ended_at: '2026-01-01T11:00:00.000Z',
  total_distance_m: 1000,
  total_energy_wh: 500,
  total_duration_s: 3600,
  total_cost: 0,
  drive_count: 1,
  charge_count: 0,
  created_at: '2026-01-01T09:00:00.000Z',
}

function makeTrip(overrides: Partial<Record<keyof Trip, unknown>> = {}): Trip {
  return { ...BASE_TRIP, ...overrides } as Trip
}

describe('tripDurationSeconds', () => {
  it('prefers the canonical total_duration_s aggregate when it is positive', () => {
    // Aggregate wins even though the start/end delta is only 600s — proving the
    // canonical column is trusted over the derived fallback.
    const trip = makeTrip({
      total_duration_s: 5400,
      start_date: '2026-01-01T10:00:00.000Z',
      end_date: '2026-01-01T10:10:00.000Z',
    })
    expect(tripDurationSeconds(trip)).toBe(5400)
  })

  it('derives seconds from the start/end delta when the aggregate is absent', () => {
    const trip = makeTrip({
      total_duration_s: undefined,
      start_date: '2026-01-01T10:00:00.000Z',
      end_date: '2026-01-01T10:30:00.000Z',
    })
    expect(tripDurationSeconds(trip)).toBe(1800)
  })

  it('falls back to the delta when the aggregate is zero (un-backfilled row)', () => {
    const trip = makeTrip({
      total_duration_s: 0,
      start_date: '2026-01-01T10:00:00.000Z',
      end_date: '2026-01-01T10:15:00.000Z',
    })
    expect(tripDurationSeconds(trip)).toBe(900)
  })

  it('ignores a negative aggregate and uses the timestamp delta instead', () => {
    const trip = makeTrip({
      total_duration_s: -42,
      start_date: '2026-01-01T10:00:00.000Z',
      end_date: '2026-01-01T10:05:00.000Z',
    })
    expect(tripDurationSeconds(trip)).toBe(300)
  })

  it('ignores a NaN aggregate (not a positive number) and uses the delta', () => {
    const trip = makeTrip({
      total_duration_s: NaN,
      start_date: '2026-01-01T10:00:00.000Z',
      end_date: '2026-01-01T10:01:00.000Z',
    })
    expect(tripDurationSeconds(trip)).toBe(60)
  })

  it('returns 0 when there is no aggregate and no end_date to derive from', () => {
    const trip = makeTrip({ total_duration_s: 0, end_date: null })
    expect(tripDurationSeconds(trip)).toBe(0)
  })

  it('returns 0 when the end precedes the start (negative delta)', () => {
    const trip = makeTrip({
      total_duration_s: 0,
      start_date: '2026-01-01T11:00:00.000Z',
      end_date: '2026-01-01T10:00:00.000Z',
    })
    expect(tripDurationSeconds(trip)).toBe(0)
  })

  it('returns 0 (never NaN) for an unparseable timestamp', () => {
    const trip = makeTrip({
      total_duration_s: 0,
      start_date: 'not-a-date',
      end_date: '2026-01-01T10:00:00.000Z',
    })
    expect(tripDurationSeconds(trip)).toBe(0)
    expect(Number.isNaN(tripDurationSeconds(trip))).toBe(false)
  })
})

describe('formatTripDuration', () => {
  it('renders the em-dash placeholder for non-positive input', () => {
    expect(formatTripDuration(0)).toBe('—')
    expect(formatTripDuration(-10)).toBe('—')
  })

  it('renders the em-dash placeholder for non-finite input (divide-by-zero guard)', () => {
    expect(formatTripDuration(NaN)).toBe('—')
    expect(formatTripDuration(Infinity)).toBe('—')
    expect(formatTripDuration(-Infinity)).toBe('—')
  })

  it('formats sub-minute durations in whole seconds', () => {
    expect(formatTripDuration(5)).toBe('5s')
    expect(formatTripDuration(30)).toBe('30s')
    expect(formatTripDuration(59)).toBe('59s')
  })

  it('formats sub-hour durations in whole minutes', () => {
    expect(formatTripDuration(60)).toBe('1m')
    expect(formatTripDuration(150)).toBe('3m') // 2.5 min rounds up
    expect(formatTripDuration(1800)).toBe('30m')
  })

  it('formats an exact hour without a trailing "0m"', () => {
    expect(formatTripDuration(3600)).toBe('1h')
    expect(formatTripDuration(7200)).toBe('2h')
  })

  it('formats hours and minutes together', () => {
    expect(formatTripDuration(5400)).toBe('1h 30m')
    expect(formatTripDuration(9000)).toBe('2h 30m')
  })

  it('carries a rounded-up remainder into the hour instead of emitting ":60" (bug guard)', () => {
    // 3599s = 59.98 min: the remainder used to round to "60m"; the carry now
    // promotes it to a clean "1h".
    expect(formatTripDuration(3599)).toBe('1h')
    // 3576s = 59.6 min → "1h", never "60m".
    expect(formatTripDuration(3576)).toBe('1h')
    // 7176s = 1h 59.6m → carries to "2h", never "1h 60m".
    expect(formatTripDuration(7176)).toBe('2h')
    // 86399s ≈ 24h − 1s → "24h", never "23h 60m".
    expect(formatTripDuration(86399)).toBe('24h')
  })

  it('never emits an impossible 60-minute remainder across a whole hour of inputs', () => {
    for (let s = 3500; s <= 3700; s += 1) {
      expect(formatTripDuration(s)).not.toContain('60m')
    }
  })
})

describe('aggregateTripKpis', () => {
  it('returns zeroed totals for an empty list', () => {
    expect(aggregateTripKpis([])).toEqual({
      count: 0,
      totalDistanceM: 0,
      totalEnergyWh: 0,
      totalDrives: 0,
    })
  })

  it('sums distance, energy and drives across trips and counts the rows', () => {
    const trips = [
      makeTrip({ total_distance_m: 1000, total_energy_wh: 500, drive_count: 2 }),
      makeTrip({ id: 2, total_distance_m: 2500, total_energy_wh: 900, drive_count: 3 }),
    ]
    expect(aggregateTripKpis(trips)).toEqual({
      count: 2,
      totalDistanceM: 3500,
      totalEnergyWh: 1400,
      totalDrives: 5,
    })
  })

  it('treats nullish numeric fields as zero (partial API row)', () => {
    const trips = [
      makeTrip({ total_distance_m: undefined, total_energy_wh: null, drive_count: undefined }),
      makeTrip({ id: 2, total_distance_m: 1200, total_energy_wh: 300, drive_count: 4 }),
    ]
    const kpis = aggregateTripKpis(trips)
    expect(kpis.count).toBe(2)
    expect(kpis.totalDistanceM).toBe(1200)
    expect(kpis.totalEnergyWh).toBe(300)
    expect(kpis.totalDrives).toBe(4)
  })

  it('coerces NaN / Infinity fields to zero so totals never become NaN (bug guard)', () => {
    const trips = [
      makeTrip({ total_distance_m: NaN, total_energy_wh: Infinity, drive_count: -Infinity }),
      makeTrip({ id: 2, total_distance_m: 800, total_energy_wh: 250, drive_count: 1 }),
    ]
    const kpis = aggregateTripKpis(trips)
    expect(Number.isNaN(kpis.totalDistanceM)).toBe(false)
    expect(Number.isFinite(kpis.totalEnergyWh)).toBe(true)
    expect(kpis).toEqual({
      count: 2,
      totalDistanceM: 800,
      totalEnergyWh: 250,
      totalDrives: 1,
    })
  })

  it('is defensive against a nullish list (hook data before first fetch)', () => {
    const zero = { count: 0, totalDistanceM: 0, totalEnergyWh: 0, totalDrives: 0 }
    expect(aggregateTripKpis(undefined)).toEqual(zero)
    expect(aggregateTripKpis(null)).toEqual(zero)
  })
})
