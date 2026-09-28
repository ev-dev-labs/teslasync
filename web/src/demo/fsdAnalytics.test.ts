import { describe, expect, it } from 'vitest'
import type { FsdInsights } from '@/types/fsd'
import { drives } from './fixtures'
import { fsdAnalytics } from './fsdAnalytics'

const now = new Date(Date.parse(drives[0].end_ts) + 60_000)
const options = { now }
const drive = (id: number) => drives.find(row => row.id === id)!

describe('fictional FSD counter insights', () => {
  it('returns a complete typed response with measured counter deltas and dense unknown days', () => {
    const insights: FsdInsights = fsdAnalytics(7, options)
    expect(insights.period.days).toBe(30)
    expect(insights.daily).toHaveLength(30)
    expect(insights.daily[0].date).toBe(insights.period.start_date)
    expect(insights.daily[insights.daily.length - 1]?.date).toBe(insights.period.end_date)
    expect(insights.totals).toMatchObject({
      fsd_distance_m: 17_000, driving_distance_m: 138_600,
      measured_days: 7, active_days: 5, days_in_period: 30,
    })
    expect(insights.totals.fsd_share_pct).toBeCloseTo(17_000 / 138_600 * 100, 1)
    expect(insights.quality).toMatchObject({
      fsd_sample_count: 14, driving_sample_count: 14,
      fsd_distance_derivable: true, share_basis_available: true,
      fsd_measured_days: 7, counter_observation_days: 7,
      days_without_counter_observation: 23,
    })
    const silent = insights.daily.filter(day => !day.has_counter_observation)
    expect(silent).toHaveLength(23)
    expect(silent.every(day => day.fsd_distance_m === null && day.driving_distance_m === null
      && day.fsd_share_pct === null && day.fsd_observation_count === 0)).toBe(true)
    expect(insights.daily.find(day => day.date === drive(103).start_ts.slice(0, 10)))
      .toMatchObject({ fsd_distance_m: 0, driving_distance_m: drive(103).distance_m })
    expect(insights.drive_analytics.repeated_routes[0]?.fsd_distance_m).toBe(17_000)
    expect(insights.drive_analytics.firmware).toEqual([])
    expect(insights.drive_analytics.firmware_spotlight.routes).toEqual([])
    expect(insights.drive_analytics.correlation_disclaimer).toMatch(/not identify engagement segments/)
  })

  it('uses synchronized paired observations, shows resets, and never counts a reset drop as travel', () => {
    const insights = fsdAnalytics(8, { ...options, includeEvidence: true })
    expect(insights.totals.fsd_distance_m).toBe(16_000)
    expect(insights.totals.driving_distance_m).toBe(65_400)
    expect(insights.totals.fsd_share_pct).toBeNull()
    expect(insights.quality).toMatchObject({
      fsd_reset_count: 1, driving_reset_count: 1, share_basis_available: false,
    })
    expect(insights.drive_analytics.reset_events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'SelfDrivingMilesSinceReset', at: drive(105).start_ts,
        previous_value_m: 16_000, current_value_m: 1_000,
      }),
      expect.objectContaining({
        field: 'MilesSinceReset', at: drive(105).start_ts,
        previous_value_m: 74_600, current_value_m: 1_000,
      }),
    ]))
    const resetDrive = insights.drive_analytics.contributing_drives.find(row => row.drive_id === 105)!
    expect(resetDrive).toMatchObject({
      fsd_distance_m: 4_000, fsd_share_pct: 13.89,
      confidence: 'estimated', reset_affected: true,
    })
    expect(resetDrive.evidence).toEqual([{
      start_at: drive(105).start_ts, end_at: drive(105).end_ts,
      fsd_distance_m: 4_000, confidence: 'estimated', approximate: true,
    }])
    expect(insights.drive_analytics.attribution).toMatchObject({
      attributed_distance_m: 12_000, estimated_distance_m: 4_000,
      unattributed_distance_m: 0,
    })
    expect(insights.drive_analytics.observatory.timeline.find(row => row.kind === 'reset'))
      .toMatchObject({ fsd_distance_m: null, reset_break: true, approximate: false })
  })

  it('limits period, vehicle, drive evidence, and comparison to their actual windows', () => {
    const recent = fsdAnalytics(7, { ...options, days: 3, includeEvidence: true })
    expect(recent.period.days).toBe(3)
    expect(recent.totals.fsd_distance_m).toBe(5_000)
    expect(recent.totals.driving_distance_m).toBe(36_600)
    expect(recent.drive_analytics.contributing_drives.map(row => row.drive_id))
      .toEqual([102, 103])
    expect(recent.drive_analytics.comparison.previous_fsd_distance_m).toBe(4_500)
    expect(recent.drive_analytics.comparison.fsd_distance_change_m).toBe(500)
    expect(recent.drive_analytics.contributing_drives[0].evidence[0])
      .toMatchObject({ approximate: true, fsd_distance_m: 5_000 })
    expect(recent.drive_analytics.contributing_drives[1])
      .toMatchObject({ fsd_distance_m: 0, evidence: [] })

    const other = fsdAnalytics(8, { ...options, days: 3 })
    expect(other.totals).toMatchObject({ fsd_distance_m: 6_000, driving_distance_m: 12_000 })
    expect(other.drive_analytics.contributing_drives.map(row => row.drive_id)).toEqual([101])
    expect(other.drive_analytics.contributing_drives.every(row =>
      row.evidence.length === 0)).toBe(true)
    const focused = fsdAnalytics(7, { ...options, driveId: 103 })
    expect(focused.drive_analytics.contributing_drives.map(row => row.drive_id)).toEqual([103])
    expect(focused.totals.fsd_distance_m).toBe(0)
    expect(focused.totals.driving_distance_m).toBe(drive(103).distance_m)
  })

  it('keeps silent and anchor-only custom periods null rather than inventing zero', () => {
    const silent = fsdAnalytics(7, {
      start: '2020-01-01T00:00:00Z', end: '2020-01-04T00:00:00Z',
    })
    expect(silent.daily).toHaveLength(3)
    expect(silent.daily.every(day => day.fsd_distance_m === null)).toBe(true)
    expect(silent.totals).toMatchObject({
      fsd_distance_m: null, driving_distance_m: null,
      fsd_share_pct: null, measured_days: 0,
    })
    expect(silent.quality).toMatchObject({
      fsd_reported_in_period: false, fsd_distance_derivable: false,
      counter_observation_days: 0,
    })
    expect(silent.drive_analytics.attribution).toMatchObject({
      attributed_distance_m: null, estimated_distance_m: null,
      unattributed_distance_m: null,
    })
    const anchor = fsdAnalytics(7, {
      start: drive(102).start_ts,
      end: new Date(Date.parse(drive(102).start_ts) + 1000).toISOString(),
    })
    expect(anchor.quality.fsd_reported_in_period).toBe(true)
    expect(anchor.totals.fsd_distance_m).toBe(0)
    expect(anchor.totals.driving_distance_m).toBe(0)
    expect(anchor.totals.fsd_share_pct).toBeNull()

    const bounded = fsdAnalytics(7, {
      start: drive(103).start_ts, end: drive(102).start_ts,
    })
    expect(bounded.drive_analytics.contributing_drives.map(row => row.drive_id)).toEqual([103])
    expect(bounded.totals).toMatchObject({
      fsd_distance_m: 0, driving_distance_m: drive(103).distance_m,
    })
    expect(bounded.daily).toHaveLength(2)
    expect(bounded.daily[1]).toMatchObject({
      fsd_distance_m: null, driving_distance_m: null,
      has_counter_observation: false,
    })
  })

  it('groups calendar days in the requested timezone and validates bounds and IDs', () => {
    const timezone = 'America/Los_Angeles'
    const result = fsdAnalytics(7, { ...options, days: 7, timezone })
    expect(result.period.timezone).toBe(timezone)
    expect(result.daily).toHaveLength(7)
    expect(result.daily[0].date).toBe(result.period.start_date)
    expect(result.daily[result.daily.length - 1]?.date).toBe(result.period.end_date)
    expect(result.period.start_at).toMatch(/Z$/)
    expect(result.totals.fsd_distance_m).toBe(14_500)
    const springForward = fsdAnalytics(7, {
      days: 3, timezone, now: new Date('2026-03-10T01:00:00Z'),
    })
    expect(springForward.period).toMatchObject({
      days: 3, start_date: '2026-03-07', end_date: '2026-03-09',
      start_at: '2026-03-07T08:00:00.000Z',
    })
    expect(springForward.daily).toHaveLength(3)
    expect(springForward.totals.fsd_distance_m).toBeNull()
    expect(() => fsdAnalytics(99, options)).toThrow(/Unknown synthetic vehicle/)
    expect(() => fsdAnalytics(7, { ...options, driveId: 101 })).toThrow(/Unknown synthetic drive/)
    expect(() => fsdAnalytics(7, { ...options, days: 0 })).toThrow(/Invalid FSD period/)
    expect(() => fsdAnalytics(7, { ...options, days: 367 })).toThrow(/Invalid FSD period/)
    expect(() => fsdAnalytics(7, { ...options, start: '2020-01-01T00:00:00Z' }))
      .toThrow(/Invalid FSD period/)
    expect(() => fsdAnalytics(7, { start: 'bad', end: '2020-01-02T00:00:00Z' }))
      .toThrow(/Invalid FSD period/)
    expect(() => fsdAnalytics(7, { start: '2020-01-01', end: '2020-01-02' }))
      .toThrow(/Invalid FSD period/)
    expect(() => fsdAnalytics(7, { start: drive(102).end_ts, end: drive(102).start_ts }))
      .toThrow(/Invalid FSD period/)
    expect(() => fsdAnalytics(7, { ...options, timezone: 'Mars/Olympus' }))
      .toThrow(/Invalid FSD timezone/)
  })
})
