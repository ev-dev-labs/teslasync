import type {
  DriveFsdInsight, FsdAttributionConfidence, FsdCommuteMonthShare,
  FsdInsights, FsdInsightsDay, FsdInsightsPeriod, FsdObservatoryEvent,
  FsdRouteEfficiencyComparison, GroupedFsdInsight,
} from '@/types/fsd'
import { drives, vehicles } from './fixtures'

type Drive = (typeof drives)[number]

interface CounterPair {
  drive_id: number
  start_fsd_m: number
  start_driving_m: number
  end_fsd_m: number
  end_driving_m: number
}

// Fictional, paired SI-meter trip-meter readings, NOT derived from drive distance.
// The decrease at drive 105 is a synthetic reset of both counters.
const counterPairs: CounterPair[] = [
  { drive_id: 110, start_fsd_m: 0, start_driving_m: 0, end_fsd_m: 2500, end_driving_m: 28800 },
  { drive_id: 108, start_fsd_m: 2500, start_driving_m: 28800, end_fsd_m: 2500, end_driving_m: 49200 },
  { drive_id: 107, start_fsd_m: 2500, start_driving_m: 49200, end_fsd_m: 4500, end_driving_m: 65400 },
  { drive_id: 106, start_fsd_m: 4500, start_driving_m: 65400, end_fsd_m: 7500, end_driving_m: 77400 },
  { drive_id: 104, start_fsd_m: 7500, start_driving_m: 77400, end_fsd_m: 12000, end_driving_m: 102000 },
  { drive_id: 103, start_fsd_m: 12000, start_driving_m: 102000, end_fsd_m: 12000, end_driving_m: 122400 },
  { drive_id: 102, start_fsd_m: 12000, start_driving_m: 122400, end_fsd_m: 17000, end_driving_m: 138600 },
  { drive_id: 109, start_fsd_m: 10000, start_driving_m: 50000, end_fsd_m: 16000, end_driving_m: 74600 },
  { drive_id: 105, start_fsd_m: 1000, start_driving_m: 1000, end_fsd_m: 5000, end_driving_m: 29800 },
  { drive_id: 101, start_fsd_m: 5000, start_driving_m: 29800, end_fsd_m: 11000, end_driving_m: 41800 },
]

interface Observation {
  drive: Drive
  at: string
  fsd_m: number
  driving_m: number
  boundary: 'start' | 'end'
}

export interface FsdDemoOptions {
  days?: number
  start?: string
  end?: string
  timezone?: string
  includeEvidence?: boolean
  driveId?: number
  now?: Date
}

const round = (value: number) => Number(value.toFixed(2))
const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const share = (fsd: number | null, driving: number | null): number | null =>
  fsd == null || driving == null || driving <= 0 ? null : round(Math.min(100, fsd / driving * 100))
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const iso = (value: number) => new Date(value).toISOString()

function dayAt(instant: string | number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant))
  const part = (name: string) => parts.find(item => item.type === name)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function midnight(date: string, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const civil = Date.UTC(year, month - 1, day)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  let instant = civil
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = formatter.formatToParts(new Date(instant))
    const part = (name: string) => Number(parts.find(item => item.type === name)?.value)
    const local = Date.UTC(part('year'), part('month') - 1, part('day'),
      part('hour'), part('minute'), part('second'))
    instant = civil - (local - instant)
  }
  return instant
}

function dayKeys(startDate: string, days: number): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  return Array.from({ length: days }, (_, index) => iso(start + index * 86_400_000).slice(0, 10))
}

function period(start: number, end: number, timezone: string): FsdInsightsPeriod {
  const startDate = dayAt(start, timezone)
  const endDate = dayAt(end - 1, timezone)
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) -
    Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1
  return {
    days, timezone, start_date: startDate, end_date: endDate,
    start_at: iso(start), end_at: iso(end),
  }
}

function observations(vehicleId: number): Observation[] {
  return counterPairs.flatMap(pair => {
    const drive = drives.find(row => row.id === pair.drive_id)
    if (!drive || drive.vehicle_id !== vehicleId) return []
    return [
      { drive, at: drive.start_ts, fsd_m: pair.start_fsd_m, driving_m: pair.start_driving_m, boundary: 'start' as const },
      { drive, at: drive.end_ts, fsd_m: pair.end_fsd_m, driving_m: pair.end_driving_m, boundary: 'end' as const },
    ]
  }).sort((a, b) => a.at.localeCompare(b.at))
}

interface WindowData {
  period: FsdInsightsPeriod
  daily: FsdInsightsDay[]
  fsd: number | null
  driving: number | null
  share: number | null
  resetAt: Observation[]
  points: Observation[]
  baseline: Observation | undefined
  shareBasis: boolean
}

function windowData(
  all: Observation[], start: number, end: number, timezone: string,
): WindowData {
  const span = period(start, end, timezone)
  const points = all.filter(point => Date.parse(point.at) >= start && Date.parse(point.at) < end)
  const baseline = all.filter(point => Date.parse(point.at) < start).pop()
  const daily: FsdInsightsDay[] = dayKeys(span.start_date, span.days).map(date => ({
    date, fsd_distance_m: null, driving_distance_m: null, fsd_share_pct: null,
    fsd_observation_count: 0, driving_observation_count: 0, reset_count: 0,
    has_counter_observation: false,
  }))
  const byDay = new Map(daily.map(day => [day.date, day]))
  const resetAt: Observation[] = []
  let previous = baseline
  let fsdTotal: number | null = null
  let drivingTotal: number | null = null
  for (const point of points) {
    const day = byDay.get(dayAt(point.at, timezone))
    if (!day) continue
    day.fsd_observation_count++
    day.driving_observation_count++
    day.has_counter_observation = true
    if (previous) {
      const fsdDelta = point.fsd_m - previous.fsd_m
      const drivingDelta = point.driving_m - previous.driving_m
      if (fsdDelta < 0 || drivingDelta < 0) {
        if (fsdDelta < 0) day.reset_count++
        if (drivingDelta < 0) day.reset_count++
        resetAt.push(point)
      }
      const fsdMeters = Math.max(0, fsdDelta)
      const drivingMeters = Math.max(0, drivingDelta)
      day.fsd_distance_m = (day.fsd_distance_m ?? 0) + fsdMeters
      day.driving_distance_m = (day.driving_distance_m ?? 0) + drivingMeters
      fsdTotal = (fsdTotal ?? 0) + fsdMeters
      drivingTotal = (drivingTotal ?? 0) + drivingMeters
    }
    previous = point
  }
  const shareBasis = fsdTotal != null && drivingTotal != null && resetAt.length === 0
    && (baseline != null || points.length >= 2)
  for (const day of daily) {
    day.fsd_share_pct = shareBasis ? share(day.fsd_distance_m, day.driving_distance_m) : null
  }
  return {
    period: span, daily, fsd: fsdTotal, driving: drivingTotal,
    share: shareBasis ? share(fsdTotal, drivingTotal) : null,
    resetAt, points, baseline, shareBasis,
  }
}

const routeKey = 'sample-north-campus-sample-city-center'
const routeLabel = 'Sample North Campus to Sample City Center'
const honesty = 'Fictional, resettable counter changes only. Drive attribution and intervals are approximate; they do not identify engagement segments, interventions, disengagements, or safety performance.'

function grouped(key: string, label: string, drivesInGroup: DriveFsdInsight[]): GroupedFsdInsight {
  const fsd = sum(drivesInGroup.map(row => row.fsd_distance_m ?? 0))
  const distance = sum(drivesInGroup.map(row => row.distance_m ?? 0))
  return {
    key, label, drive_count: drivesInGroup.length, driving_distance_m: distance,
    fsd_distance_m: fsd, fsd_share_pct: share(fsd, distance),
  }
}

function timeBucket(startedAt: string, timezone: string): { key: string; label: string } {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', hourCycle: 'h23',
  }).format(new Date(startedAt)))
  if (hour < 6) return { key: 'night', label: 'Night' }
  if (hour < 12) return { key: 'morning', label: 'Morning' }
  if (hour < 18) return { key: 'afternoon', label: 'Afternoon' }
  return { key: 'evening', label: 'Evening' }
}

function monthShare(month: string, rows: DriveFsdInsight[]): FsdCommuteMonthShare {
  const measured = rows.filter(row => row.fsd_distance_m != null)
  const fsd = measured.length ? sum(measured.map(row => row.fsd_distance_m!)) : null
  const distance = sum(rows.map(row => row.distance_m ?? 0))
  return {
    month, drive_count: rows.length, fsd_distance_m: fsd,
    driving_distance_m: distance,
    fsd_share_pct: measured.length === rows.length ? share(fsd, distance) : null,
    confidence: measured.length ? 'estimated' : 'unknown',
    unknown_days: new Set(rows.filter(row => row.fsd_distance_m == null)
      .map(row => row.started_at.slice(0, 10))).size,
  }
}

export function fsdAnalytics(vehicleId: number, options: FsdDemoOptions = {}): FsdInsights {
  const vehicle = vehicles.find(row => row.id === vehicleId)
  if (!vehicle) throw new RangeError('Unknown synthetic vehicle')
  const timezone = options.timezone ?? vehicle.timezone ?? 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new RangeError('Invalid FSD timezone')
  }
  const all = observations(vehicleId)
  const now = options.now?.getTime() ?? Date.now()
  if (!Number.isFinite(now)) throw new RangeError('Invalid FSD clock')
  const focus = options.driveId == null ? undefined
    : drives.find(row => row.vehicle_id === vehicleId && row.id === options.driveId)
  if (options.driveId != null && !focus) throw new RangeError('Unknown synthetic drive')
  if ((options.start == null) !== (options.end == null)
    || (options.days != null && (!Number.isInteger(options.days) || options.days < 1 || options.days > 366))
    || (focus && (options.start != null || options.days != null))
    || (options.start != null && options.days != null)
    || (options.start != null && (!rfc3339.test(options.start) || !rfc3339.test(options.end!)))) {
    throw new RangeError('Invalid FSD period')
  }
  const end = focus ? Date.parse(focus.end_ts) + 1 : options.end == null ? now : Date.parse(options.end)
  const days = options.days ?? 30
  const firstDay = Number.isFinite(end) ? dayAt(end - 1, timezone) : ''
  const dateBefore = firstDay
    ? iso(Date.parse(`${firstDay}T00:00:00Z`) - (days - 1) * 86_400_000).slice(0, 10)
    : ''
  const windowStart = focus ? Date.parse(focus.start_ts)
    : options.start != null ? Date.parse(options.start) : dateBefore ? midnight(dateBefore, timezone) : NaN
  if (!Number.isFinite(windowStart) || !Number.isFinite(end) || windowStart >= end) {
    throw new RangeError('Invalid FSD period')
  }
  const current = windowData(all, windowStart, end, timezone)
  if (current.period.days > 366) throw new RangeError('FSD period exceeds 366 days')
  const previous = windowData(all, windowStart - (end - windowStart), windowStart, timezone)
  const measured = current.daily.filter(day => day.fsd_distance_m != null)
  const active = measured.filter(day => day.fsd_distance_m! > 0)
  const best = [...active].sort((a, b) => b.fsd_distance_m! - a.fsd_distance_m!)[0]
  const rows = drives.filter(row => row.vehicle_id === vehicleId
    && Date.parse(row.start_ts) >= windowStart && Date.parse(row.end_ts) < end
    && (focus == null || focus.id === row.id))
  const byDrive = new Map<number, [Observation, Observation]>()
  for (const pair of counterPairs) {
    const bookends = all.filter(point => point.drive.id === pair.drive_id)
    if (bookends.length === 2) byDrive.set(pair.drive_id, [bookends[0], bookends[1]])
  }
  const contributing = rows.map((row): DriveFsdInsight => {
    const pair = byDrive.get(row.id)
    const startPoint = pair?.[0]
    const endPoint = pair?.[1]
    const resetAffected = current.resetAt.some(point => point.drive.id === row.id)
    const delta = startPoint && endPoint
      ? endPoint.fsd_m - startPoint.fsd_m : null
    const distance = startPoint && endPoint
      ? endPoint.driving_m - startPoint.driving_m : null
    const known = delta != null && delta >= 0 && distance != null && distance >= 0
    const confidence: FsdAttributionConfidence = known
      ? resetAffected ? 'estimated' : 'high' : 'unknown'
    return {
      drive_id: row.id, started_at: row.start_ts, ended_at: row.end_ts,
      start_place: row.start_address, end_place: row.end_address,
      distance_m: row.distance_m, energy_used_wh: row.energy_used_wh,
      fsd_distance_m: known ? delta : null,
      fsd_share_pct: known ? share(delta, distance) : null,
      confidence, reset_affected: resetAffected, firmware_version: null,
      evidence: known && delta > 0 && startPoint && endPoint && options.includeEvidence ? [{
        start_at: startPoint.at, end_at: endPoint.at, fsd_distance_m: delta,
        confidence, approximate: true,
      }] : [],
      evidence_truncated: false,
    }
  }).sort((a, b) => b.started_at.localeCompare(a.started_at))
  const known = contributing.filter(row => row.fsd_distance_m != null)
  const unknown = contributing.filter(row => row.fsd_distance_m == null)
  const attributed = sum(known.map(row => row.fsd_distance_m!))
  const highDistance = sum(known.filter(row => row.confidence === 'high')
    .map(row => row.fsd_distance_m!))
  const estimatedDistance = attributed - highDistance
  const unattributed = current.fsd == null ? null : Math.max(0, current.fsd - attributed)
  const resetEvents = current.resetAt.flatMap(point => {
    const previousPoint = all.filter(row => row.at < point.at).pop()
    if (!previousPoint) return []
    return (['SelfDrivingMilesSinceReset', 'MilesSinceReset'] as const).flatMap(field => {
      const fsd = field === 'SelfDrivingMilesSinceReset'
      const before = fsd ? previousPoint.fsd_m : previousPoint.driving_m
      const after = fsd ? point.fsd_m : point.driving_m
      return after < before ? [{
        field, at: point.at, previous_value_m: before, current_value_m: after,
        affected_drive_ids: [point.drive.id], firmware_version: null,
      }] : []
    })
  })
  const timeline: FsdObservatoryEvent[] = [
    ...contributing.map(row => ({
      kind: 'drive' as const, at: row.started_at, end_at: row.ended_at,
      drive_id: row.drive_id, route_key: routeKey, route_label: routeLabel,
      firmware_version: null, fsd_distance_m: row.fsd_distance_m,
      driving_distance_m: row.distance_m, confidence: row.confidence,
      reset_break: row.reset_affected, approximate: true, field: null,
    })),
    ...resetEvents.map(event => ({
      kind: 'reset' as const, at: event.at, end_at: null, drive_id: null,
      route_key: null, route_label: null, firmware_version: null,
      fsd_distance_m: null, driving_distance_m: null, confidence: null,
      reset_break: true, approximate: false, field: event.field,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  const previousShare = previous.share
  const currentMonth = dayAt(end - 1, timezone).slice(0, 7)
  const lastMonth = iso(Date.parse(`${currentMonth}-01T00:00:00Z`) - 86_400_000).slice(0, 7)
  const commuteRows = contributing.filter(row => timeBucket(row.started_at, timezone).key === 'morning')
  const thisMonth = monthShare(currentMonth, commuteRows.filter(row =>
    dayAt(row.started_at, timezone).startsWith(currentMonth)))
  const priorMonth = monthShare(lastMonth, commuteRows.filter(row =>
    dayAt(row.started_at, timezone).startsWith(lastMonth)))
  const highConfidence = known.filter(row => row.confidence === 'high')
  const byTime = new Map<string, DriveFsdInsight[]>()
  for (const row of highConfidence) {
    const bucket = timeBucket(row.started_at, timezone)
    byTime.set(bucket.key, [...(byTime.get(bucket.key) ?? []), row])
  }
  const heavy = highConfidence.filter(row => (row.fsd_share_pct ?? 0) >= 50)
  const low = highConfidence.filter(row => (row.fsd_share_pct ?? 100) <= 10)
  const efficiency = (items: DriveFsdInsight[]) =>
    sum(items.map(row => row.energy_used_wh ?? 0)) /
    (sum(items.map(row => row.distance_m ?? 0)) / 1000)
  const routeEfficiency: FsdRouteEfficiencyComparison[] = heavy.length >= 2 && low.length >= 2
    ? [{
      route_key: routeKey, route_label: routeLabel,
      fsd_heavy_drive_count: heavy.length, low_fsd_drive_count: low.length,
      fsd_heavy_efficiency_wh_per_km: round(efficiency(heavy)),
      low_fsd_efficiency_wh_per_km: round(efficiency(low)),
      difference_pct: round((efficiency(heavy) / efficiency(low) - 1) * 100),
    }] : []
  const observationDays = current.daily.filter(day => day.has_counter_observation).length
  const firstObservation = current.points[0]?.at ?? null
  const lastObservation = current.points[current.points.length - 1]?.at ?? null
  return {
    vehicle_id: vehicleId,
    period: current.period,
    totals: {
      fsd_distance_m: current.fsd, driving_distance_m: current.driving,
      fsd_share_pct: current.share, active_days: active.length,
      measured_days: measured.length, days_in_period: current.period.days,
      avg_measured_day_fsd_distance_m: current.fsd == null || !measured.length
        ? null : round(current.fsd / measured.length),
      avg_active_day_fsd_distance_m: current.fsd == null || !active.length
        ? null : round(current.fsd / active.length),
      best_day: best ? {
        date: best.date, fsd_distance_m: best.fsd_distance_m!,
        driving_distance_m: best.driving_distance_m, fsd_share_pct: best.fsd_share_pct,
      } : null,
    },
    quality: {
      fsd_sample_count: current.points.length, driving_sample_count: current.points.length,
      fsd_invalid_sample_count: 0, driving_invalid_sample_count: 0,
      fsd_duplicate_sample_count: 0, driving_duplicate_sample_count: 0,
      fsd_reset_count: resetEvents.filter(row => row.field === 'SelfDrivingMilesSinceReset').length,
      driving_reset_count: resetEvents.filter(row => row.field === 'MilesSinceReset').length,
      fsd_baseline_available: current.baseline != null,
      driving_baseline_available: current.baseline != null,
      fsd_reported_in_period: current.points.length > 0,
      driving_reported_in_period: current.points.length > 0,
      fsd_distance_derivable: current.fsd != null,
      driving_denominator_available: current.driving != null,
      share_basis_available: current.shareBasis,
      fsd_measured_days: measured.length,
      historical_data_guarded: true, required_normalization_version: 1,
      fsd_untrusted_sample_count: 0, driving_untrusted_sample_count: 0,
      counter_observation_days: observationDays,
      days_without_counter_observation: current.period.days - observationDays,
      counter_observation_day_pct: round(observationDays / current.period.days * 100),
      first_observation_at: firstObservation, last_observation_at: lastObservation,
      fsd_first_observation_at: firstObservation, fsd_last_observation_at: lastObservation,
      share_clamped: false,
    },
    daily: current.daily,
    drive_analytics: {
      comparison: {
        previous_period: previous.period,
        previous_fsd_distance_m: previous.fsd,
        previous_driving_distance_m: previous.driving,
        previous_fsd_share_pct: previousShare,
        fsd_distance_change_m: current.fsd == null || previous.fsd == null
          ? null : current.fsd - previous.fsd,
        fsd_distance_change_pct: current.fsd == null || previous.fsd == null || previous.fsd === 0
          ? null : round((current.fsd / previous.fsd - 1) * 100),
        fsd_share_change_pct_points: current.share == null || previousShare == null
          ? null : round(current.share - previousShare),
      },
      attribution: {
        attributed_distance_m: current.fsd == null ? null : highDistance,
        estimated_distance_m: current.fsd == null ? null : estimatedDistance,
        ambiguous_distance_m: current.fsd == null ? null : 0,
        unattributed_distance_m: unattributed,
        unknown_drive_distance_m: sum(unknown.map(row => row.distance_m ?? 0)),
      },
      contributing_drives: contributing, reset_events: resetEvents,
      repeated_routes: highConfidence.length ? [grouped(routeKey, routeLabel, highConfidence)] : [],
      time_of_day: [...byTime].map(([key, rowsInBucket]) =>
        grouped(key, timeBucket(rowsInBucket[0].started_at, timezone).label, rowsInBucket)),
      firmware: [], firmware_spotlight: {
        from_version: '', to_version: '', changed_at: null, routes: [],
      },
      route_efficiency: routeEfficiency,
      observatory: {
        honesty, truncated: false,
        totals: {
          stitched_fsd_distance_m: current.fsd == null ? null : attributed,
          high_fsd_distance_m: current.fsd == null ? null : highDistance,
          estimated_fsd_distance_m: current.fsd == null ? null : estimatedDistance,
          ambiguous_fsd_distance_m: current.fsd == null ? null : 0,
          unknown_drive_distance_m: sum(unknown.map(row => row.distance_m ?? 0)),
          reset_break_count: resetEvents.length,
          drive_count: contributing.length, measured_drive_count: known.length,
          unknown_drive_count: unknown.length,
        },
        timeline, commute_stories: contributing.length >= 2 ? [{
          route_key: routeKey, route_label: routeLabel, drive_count: contributing.length,
          chapters: [{
            firmware_version: null,
            first_at: contributing[contributing.length - 1].started_at,
            last_at: contributing[0].started_at,
            drive_count: contributing.length,
            high_count: known.filter(row => row.confidence === 'high').length,
            estimated_count: known.filter(row => row.confidence === 'estimated').length,
            ambiguous_count: 0,
            unknown_count: unknown.length, reset_breaks: resetEvents.length,
            fsd_distance_m: known.length ? attributed : null,
            driving_distance_m: sum(contributing.map(row => row.distance_m ?? 0)),
            fsd_share_pct: known.length && !unknown.length
              ? share(attributed, sum(contributing.map(row => row.distance_m ?? 0))) : null,
          }],
        }] : [],
      },
      commute_identities: commuteRows.length ? [{
        route_key: routeKey, route_label: routeLabel,
        window_key: 'morning', window_label: 'Morning',
        this_month: thisMonth, last_month: priorMonth,
        share_change_pct_points: thisMonth.fsd_share_pct == null || priorMonth.fsd_share_pct == null
          ? null : round(thisMonth.fsd_share_pct - priorMonth.fsd_share_pct),
        honesty,
      }] : [],
      correlation_disclaimer: honesty,
    },
  }
}
