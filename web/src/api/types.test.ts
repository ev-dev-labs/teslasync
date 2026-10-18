/**
 * Runtime-contract tests for the API type module.
 *
 * `web/src/api/types.ts` is overwhelmingly a declaration file, but it also
 * exports four pieces of live behaviour that the whole SPA leans on to paint
 * vehicle status chips, dots, and badge variants:
 *
 *   - `VEHICLE_STATUSES`   — the canonical status list (mirrors the FSM).
 *   - `deriveVehicleStatus`— collapses a noisy live-state object into one of
 *                            the seven canonical statuses.
 *   - `statusVariant`      — status → BadgeVariant (semantic colour bucket).
 *   - `statusDotColor`     — status → concrete Tailwind dot class.
 *
 * These tests lock in every branch (priority ordering, case-insensitivity,
 * unknown-value fallbacks, and null-safety against malformed API payloads),
 * and pin the colour/variant maps to their single source of truth in
 * `@/types/fsm` so a drift in either file is caught immediately. A lean
 * type-contract block additionally exercises a representative slice of the
 * exported interfaces so an incompatible shape change fails `tsc`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { deriveDataState, type DataState } from './dataState'
import type { StatMetric } from '@/components/data-display'
import { GasPriceBrief } from '@/features/admin/components/operationalbrief-a-g/GasPriceBrief'
import { YearDriveRecord } from '@/features/analytics/components/year-review-modernization/YearDriveRecord'
import { YearPatternsBrief } from '@/features/analytics/components/operationalbrief-n-z/YearPatternsBrief'
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import type { SearchResponse, YearReview, YearReviewDriveHighlight } from './types'

import {
  VEHICLE_STATUSES,
  deriveVehicleStatus,
  statusVariant,
  statusDotColor,
} from './types'
import type {
  VehicleState,
  VehicleStatus,
  Vehicle,
  SignalEnvelope,
  SignalKind,
  AlertRuleSeverity,
  BadgeVariant,
  FeedbackEntry,
  GasPriceStatus,
  FleetAnalytics,
  MediaSnapshot,
} from './types'
import { VEHICLE_STATES, VEHICLE_STATE_ENTRIES, resolveStyle } from '@/types/fsm'

describe('search completeness contract', () => {
  it('keeps failed sources separate from reached caps and supports unknown legacy coverage', () => {
    const response: SearchResponse = {
      query: 'home',
      hits: [{ type: 'vehicle', id: 1, title: 'Home car', url: '/vehicles/1', score: 1 }],
      completeness: {
        failed_types: ['drive'],
        limit_reached_types: ['vehicle'],
        total_limit_reached: false,
      },
    }
    expect(response.hits).toHaveLength(1)
    expect(response.completeness?.failed_types).toEqual(['drive'])
    expect(response.completeness?.limit_reached_types).toEqual(['vehicle'])
    const legacy: SearchResponse = { hits: [], query: 'home' }
    expect(legacy.completeness).toBeUndefined()
  })
})

describe('fleet partial-result metadata', () => {
  it('accepts producer metadata without conflating partial HTTP success with complete data', () => {
    const metadata: Pick<FleetAnalytics, 'generated_at' | 'source' | 'partial_result'> = {
      generated_at: '2026-10-14T19:21:20Z',
      source: 'derived_fleet_analytics',
      partial_result: { is_partial: true, reasons: ['drive_query_failed', 'future_source_reason'] },
    }
    const data = { ...metadata, total_drives: 0 }
    const state = deriveDataState({ data, isSuccess: true }, {
      provenance: 'historical', partial: data.partial_result?.is_partial,
    })
    expect(state.status).toBe('partial')
    expect(state.data).toBe(data)
    expect(state.data?.total_drives).toBe(0)
    expect(state.fatalError).toBeNull()
    const noReasons: FleetAnalytics['partial_result'] = { is_partial: true, reasons: null }
    expect(noReasons.is_partial).toBe(true)
  })
})

const gasBriefMocks = vi.hoisted(() => ({
  settingsState: undefined as DataState<unknown> | undefined,
  summary: vi.fn<(props: {
    metrics: StatMetric[], loading: boolean, sourceStatus: string, freshness: ReactNode,
  }) => null>(() => null),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | { defaultValue: string; unit?: string }, values?: { unit?: string }) =>
      typeof fallback === 'string'
        ? fallback.replace('{{unit}}', values?.unit ?? '')
        : fallback.defaultValue.replace('{{unit}}', fallback.unit ?? ''),
  }),
}))
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { locale: 'de-DE', precision: 2, distance: 'km' } }),
}))
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { gas_unit: 'gallon', locale: 'de-DE', timezone: 'America/Los_Angeles' },
    settingsState: gasBriefMocks.settingsState,
  }),
}))
vi.mock('@/features/admin/components/operationalbrief-a-g/AdminSummary', () => ({
  AdminSummary: gasBriefMocks.summary,
}))
vi.mock('@/components/feedback', () => ({
  QueryError: () => null,
  StaleRefreshWarning: () => null,
}))
vi.mock('@/components/ui', () => ({
  Text: ({ children }: { children: ReactNode }) => children,
  Caption: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/data-display/stat-reference', () => ({
  StatGroup: ({ metrics }: { metrics: StatMetric[] }) =>
    metrics.map(metric => createElement('span', { key: metric.label }, String(metric.rawValue))),
}))
vi.mock('@/hooks/useOperationalMetrics', () => ({
  useOperationalMetrics: (metrics: StatMetric[]) => metrics,
}))
vi.mock('@/components/data-display', () => ({
  OperationalBrief: ({ metrics }: { metrics: StatMetric[] }) =>
    metrics.map(metric => createElement('span', { key: metric.occurrenceId },
      typeof metric.rawValue === 'number'
        ? metric.display?.formatter?.(metric.rawValue, {
          units: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa', energy: 'kWh', duration: 'min', power: 'kW' },
          currency: { kind: 'symbol', value: '$' },
        }).value ?? String(metric.rawValue) : '—')),
}))

describe('year review calendar presentation', () => {
  const period = { kind: 'unknown', label: '2020' } as const
  const drive: YearReviewDriveHighlight = {
    drive_id: 7, date: '2020-01-01', distance_km: 1234.6, duration_s: 3576,
    start_address: 'McDonald ROAD', end_address: 'iPhone Street', efficiency_wh_km: 155.5,
  }
  beforeEach(() => {
    setGlobalLocale('de-DE')
    setGlobalPrecision(4)
  })
  function record(date: YearReviewDriveHighlight['date']) {
    return renderToStaticMarkup(createElement(YearDriveRecord, { drive: { ...drive, date }, id: 'record', period }))
  }
  function patterns(day: string | null, hour: number | null) {
    const data: YearReview = {
      year: 2020, vehicle: { id: 1, display_name: 'McCustom CAR', model: 'modely' },
      total_drives: 100, total_distance_km: 2000, total_energy_kwh: 1200,
      total_charge_sessions: 50, total_driving_minutes: 3000, total_charging_cost: 50,
      gas_savings: 100, co2_offset_kg: 384, longest_drive: drive, shortest_drive: null,
      most_efficient_drive: null, least_efficient_drive: null, fastest_speed_kmh: 100,
      coldest_drive_temp_c: -5, hottest_drive_temp_c: 38, monthly_stats: [],
      supercharger_pct: 60, dc_fast_pct: 30, ac_other_pct: 10, avg_charge_start_soc: 42,
      comparisons: [],
      most_active_day_of_week: day, most_active_hour: hour, avg_drives_per_week: 2.5,
      avg_distance_per_drive_km: 20, avg_efficiency_wh_km: 155.5,
    }
    return renderToStaticMarkup(createElement(YearPatternsBrief, { data, period }))
  }
  it('localizes a calendar date without shifting it to the saved timezone or recasing addresses', () => {
    const html = record('2020-01-01')
    expect(html).toContain('1. Jan. 2020')
    expect(html).not.toContain('2019')
    expect(html).toContain('McDonald ROAD')
    expect(html).toContain('iPhone Street')
    expect(html).toContain('1.235')
    expect(html).toContain('1h 0m')
    expect(html).toContain('156')
  })
  it.each([undefined, null, '', 'invalid', '2020-02-30', '2020-13-01', '2020-01-01T00:00:00Z'])(
    'shows an unavailable date for %s', date => {
      expect(record(date)).toMatch(/—$/)
    },
  )
  it('uses locale weekday and hour conventions without converting aggregate buckets', () => {
    expect(patterns('Sunday', 0)).toContain('Sonntag')
    expect(patterns('Sunday', 0)).toContain('00:00')
    expect(patterns('Friday', 23)).toContain('Freitag')
    expect(patterns('Friday', 23)).toContain('23:00')
    expect(patterns('Friday', 23)).toContain('2,5</span>')
    expect(patterns('Friday', 23)).not.toContain('2,5000')
    expect(patterns('McCustom DAY', 12)).toContain('McCustom DAY')
    expect(patterns('McCustom DAY', 12)).toContain('12:00')
    expect(patterns(null, null)).toMatch(/—.*—/)
    expect(patterns('', Number.NaN)).toMatch(/—.*—/)
  })
})

describe('gas price snapshot presentation', () => {
  const quote: GasPriceStatus = {
    enabled: true, poll_interval: '7d', last_poll_time: '2026-10-14T00:00:00Z',
    current_price: 1, current_price_kwh_eq: 0.5, current_price_unit: 'liter',
  }
  function summary(source: DataState<GasPriceStatus>) {
    renderToStaticMarkup(createElement(GasPriceBrief, { source }))
    const props = gasBriefMocks.summary.mock.lastCall?.[0]
    if (!props) throw new Error('Gas price summary did not render')
    return props
  }
  beforeEach(() => {
    gasBriefMocks.summary.mockClear()
    gasBriefMocks.settingsState = deriveDataState({ data: { gas_unit: 'gallon' } })
  })
  it('distinguishes active loading from paused without data', () => {
    expect(summary(deriveDataState<GasPriceStatus>({ isFetching: true })).loading).toBe(true)
    const paused = summary(deriveDataState<GasPriceStatus>({ fetchStatus: 'paused' }))
    expect(paused.loading).toBe(false)
    expect(paused.sourceStatus).toBe('unavailable')
    expect(paused.metrics[1].rawValue).toBeUndefined()
    expect(paused.metrics[1].context).not.toContain('gal')
  })
  it('distinguishes an empty snapshot from an observed zero', () => {
    const empty = summary(deriveDataState({ data: {
      ...quote, current_price: 0, current_price_kwh_eq: 0,
      current_price_unit: null, last_poll_time: '0001-01-01T00:00:00Z',
    } }))
    expect(empty.loading).toBe(false)
    expect(empty.metrics[1].rawValue).toBeUndefined()
    const zero = summary(deriveDataState({ data: { ...quote, current_price: 0, current_price_kwh_eq: 0 } }))
    expect(zero.metrics[1].rawValue).toBe(0)
    expect(zero.metrics[2].rawValue).toBe(0)
    expect(zero.metrics[1].context).toBe('per L')
  })
  it('keeps quote and denomination together on failure and recovery', () => {
    const retained = summary(deriveDataState({ data: quote, error: new Error('refresh failed') }))
    expect(retained.sourceStatus).toBe('stale')
    expect(retained.metrics[1].rawValue).toBe(1)
    expect(retained.metrics[1].context).toBe('per L')
    const recovered = summary(deriveDataState<GasPriceStatus>({ data: { ...quote, current_price: 4, current_price_unit: 'gallon' } }))
    expect(recovered.sourceStatus).toBe('ok')
    expect(recovered.metrics[1].rawValue).toBe(4)
    expect(recovered.metrics[1].context).toBe('per gal')
  })
  it('exposes unavailable and retained settings without relabeling the quote', () => {
    gasBriefMocks.settingsState = deriveDataState({ error: new Error('settings unavailable') })
    const unavailable = summary(deriveDataState({ data: quote }))
    expect(renderToStaticMarkup(createElement('span', null, unavailable.freshness))).toContain('Settings: Source unavailable')
    expect(unavailable.metrics[1].context).toBe('per L')
    gasBriefMocks.settingsState = deriveDataState({ data: { gas_unit: 'gallon' }, error: new Error('settings refresh failed') })
    const retained = summary(deriveDataState({ data: quote }))
    expect(renderToStaticMarkup(createElement('span', null, retained.freshness))).toContain('Settings: Retained measurements')
    expect(retained.metrics[1].context).toBe('per L')
  })
})

/**
 * The local `VehicleState` interface requires ~22 fields. Real callers pass a
 * fully-hydrated `/vehicles/{id}/state` payload; tests only care about the
 * three fields the deriver reads, so this factory supplies sane defaults and
 * lets each case override just what it exercises.
 */
function vehicleState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 80,
    rated_range: 300,
    ideal_range: 320,
    odometer: 10_000,
    inside_temp: 21,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2024.0.0',
    ...overrides,
  }
}

describe('VEHICLE_STATUSES', () => {
  it('mirrors the FSM VEHICLE_STATES source of truth exactly', () => {
    expect(VEHICLE_STATUSES).toEqual([...VEHICLE_STATES])
    expect(VEHICLE_STATUSES).toHaveLength(VEHICLE_STATES.length)
  })

  it('contains the operational statuses the UI switches on', () => {
    expect(VEHICLE_STATUSES).toContain('charging')
    expect(VEHICLE_STATUSES).toContain('driving')
    expect(VEHICLE_STATUSES).toContain('offline')
  })
})

describe('deriveVehicleStatus', () => {
  it('returns "offline" when no live state is available', () => {
    expect(deriveVehicleStatus(null)).toBe('offline')
    expect(deriveVehicleStatus(undefined)).toBe('offline')
    expect(deriveVehicleStatus()).toBe('offline')
  })

  it('prioritises charging over movement and any reported state string', () => {
    expect(deriveVehicleStatus(vehicleState({ is_charging: true }))).toBe('charging')
    // charging wins even if the car also reports non-zero speed…
    expect(
      deriveVehicleStatus(vehicleState({ is_charging: true, speed: 55 })),
    ).toBe('charging')
    // …and even if the API state string still says something else.
    expect(
      deriveVehicleStatus(vehicleState({ is_charging: true, state: 'asleep' })),
    ).toBe('charging')
  })

  it('reports "driving" for positive speed when not charging', () => {
    expect(deriveVehicleStatus(vehicleState({ speed: 42 }))).toBe('driving')
    // movement outranks a stale/idle state string.
    expect(
      deriveVehicleStatus(vehicleState({ speed: 42, state: 'asleep' })),
    ).toBe('driving')
  })

  it('does not report "driving" for zero or negative speed', () => {
    expect(deriveVehicleStatus(vehicleState({ speed: 0, state: 'parked' }))).toBe('parked')
    // guards against a spurious regen/rollback sample flipping the chip.
    expect(deriveVehicleStatus(vehicleState({ speed: -3, state: 'parked' }))).toBe('parked')
  })

  it.each([...VEHICLE_STATES])('echoes the known state "%s" case-insensitively', (state) => {
    expect(deriveVehicleStatus(vehicleState({ state }))).toBe(state)
    expect(deriveVehicleStatus(vehicleState({ state: state.toUpperCase() }))).toBe(state)
  })

  it('falls back to "online" for an unrecognised state string', () => {
    // Tesla emits transient states ("waking"/"suspended") that are not part
    // of our canonical set — they should register as generically online.
    expect(deriveVehicleStatus(vehicleState({ state: 'waking' }))).toBe('online')
    expect(deriveVehicleStatus(vehicleState({ state: 'suspended' }))).toBe('online')
    expect(deriveVehicleStatus(vehicleState({ state: '' }))).toBe('online')
  })

  it('tolerates malformed live-state payloads without throwing', () => {
    // Simulate an API response where numeric/string fields arrive as null.
    const nulled = { speed: null, state: null, is_charging: null } as unknown as VehicleState
    expect(deriveVehicleStatus(nulled)).toBe('online')
    // A near-empty object must not crash on the `.toLowerCase()`/`> 0` paths.
    expect(deriveVehicleStatus({} as VehicleState)).toBe('online')
  })

  it('resolves the documented priority chain (charging > driving > state > online)', () => {
    const cases: Array<[Partial<VehicleState>, VehicleStatus]> = [
      [{ is_charging: true, speed: 30, state: 'driving' }, 'charging'],
      [{ speed: 30, state: 'asleep' }, 'driving'],
      [{ speed: 0, state: 'asleep' }, 'asleep'],
      [{ speed: 0, state: 'mystery' }, 'online'],
    ]
    for (const [input, expected] of cases) {
      expect(deriveVehicleStatus(vehicleState(input))).toBe(expected)
    }
  })
})

describe('statusVariant', () => {
  it.each(VEHICLE_STATUSES)('maps "%s" to its source-of-truth variant', (status) => {
    expect(statusVariant(status)).toBe(VEHICLE_STATE_ENTRIES[status].variant)
  })

  it('returns the specific semantic buckets the design system expects', () => {
    expect(statusVariant('charging')).toBe('warning')
    expect(statusVariant('offline')).toBe('danger')
    expect(statusVariant('parked')).toBe('info')
    const online: BadgeVariant = statusVariant('online')
    expect(online).toBe('success')
  })

  it('falls back to "danger" for an unknown status', () => {
    expect(statusVariant('bogus')).toBe('danger')
    expect(statusVariant('')).toBe('danger')
  })
})

describe('statusDotColor', () => {
  it.each(VEHICLE_STATUSES)('returns the resolved badge-dot class for "%s"', (status) => {
    const expected = resolveStyle(VEHICLE_STATE_ENTRIES[status]).badgeDot
    expect(statusDotColor(status)).toBe(expected)
  })

  it('applies per-state overrides rather than the bare variant colour', () => {
    // driving is a "success" variant but overrides its dot to blue.
    expect(statusDotColor('driving')).toBe('bg-blue-500')
    expect(statusDotColor('charging')).toBe('bg-yellow-400')
    // online has no override, so it inherits the success theme dot.
    expect(statusDotColor('online')).toBe('bg-green-400')
    expect(statusDotColor('offline')).toBe('bg-red-400')
  })

  it('returns a neutral gray dot for an unknown status', () => {
    expect(statusDotColor('bogus')).toBe('bg-gray-400')
  })

  it('never emits the unknown-fallback colour for a known status', () => {
    for (const status of VEHICLE_STATUSES) {
      expect(statusDotColor(status)).not.toBe('bg-gray-400')
    }
  })
})

describe('exported type contracts', () => {
  it('accepts canonical null media latest readings without manufacturing metadata or units', () => {
    const latest = {
      now_playing_title: null,
      now_playing_artist: null,
      now_playing_album: null,
      now_playing_station: null,
      now_playing_duration: null,
      now_playing_elapsed: null,
      playback_status: null,
      playback_source: null,
      audio_volume: null,
      audio_volume_max: null,
      audio_volume_increment: null,
    } satisfies MediaSnapshot

    expect(Object.values(latest)).toEqual(Array(11).fill(null))
    expect(Object.keys(latest)).toHaveLength(11)
    for (const key of ['id', 'vehicle_id', 'ts', 'created_at', 'duration_unit', 'volume_unit']) {
      expect(latest).not.toHaveProperty(key)
    }
  })

  it('accepts sparse media history with only producer-supplied row metadata', () => {
    const history = [{
      id: 1,
      ts: '2026-10-14T20:00:00Z',
      created_at: '2026-10-14T20:00:00Z',
      now_playing_title: 'Track A',
      now_playing_artist: null,
    }] satisfies MediaSnapshot[]

    expect(history[0].ts).toBe(history[0].created_at)
    expect(history[0].now_playing_artist).toBeNull()
    expect(history[0]).not.toHaveProperty('vehicle_id')
    expect(history[0]).not.toHaveProperty('audio_volume')
    const omitted: MediaSnapshot = {}
    expect(omitted.now_playing_title).toBeUndefined()
  })

  it('preserves populated media readings, explicit zero values and existing snapshot metadata', () => {
    const latest = {
      now_playing_title: 'Track A',
      now_playing_artist: 'Artist X',
      now_playing_album: 'Album Z',
      now_playing_station: '',
      now_playing_duration: 240,
      now_playing_elapsed: 0,
      playback_status: 'playing',
      playback_source: 'Spotify',
      audio_volume: 0,
      audio_volume_max: 10,
      audio_volume_increment: 0.5,
    } satisfies MediaSnapshot
    const history = {
      ...latest, id: 1, vehicle_id: 42, created_at: '2026-10-14T20:00:00Z',
    } satisfies MediaSnapshot

    expect(history).toMatchObject(latest)
    expect(history.vehicle_id).toBe(42)
    expect(history.now_playing_elapsed).toBe(0)
    expect(history.audio_volume).toBe(0)
    expect(history.now_playing_station).toBe('')
    expect(history.now_playing_duration).toBe(240)
    expect(history.audio_volume_increment).toBe(0.5)
  })

  it('represents daily efficiency as unavailable without replacing it with charging energy', () => {
    const daily: FleetAnalytics['drive_analytics']['daily_trend'] = [
      { date: '2026-10-12', drives: 2, distance: 10 },
      { date: '2026-10-13', drives: 2, distance: 10, efficiency: null },
      { date: '2026-10-14', drives: 2, distance: 10, efficiency: 150 },
    ]
    expect(daily.map(row => row.efficiency)).toEqual([undefined, null, 150])
  })
  it('represents SOC-only fleet observations with unknown health and cycles', () => {
    const observation: FleetAnalytics['battery_trend'][number] = {
      date: '2026-10-14', vehicle_id: 1, source: 'daily_soc',
      soc_pct: 87, health_score: null, capacity_wh: null,
      degradation_pct: null, range_km: null, cycle_count: null,
      coverage_start: '2026-10-14T00:00:00Z',
      coverage_end: '2026-10-15T00:00:00Z',
    }
    expect(observation.health_score).toBeNull()
    expect(observation.cycle_count).toBeNull()
    expect(observation.soc_pct).toBe(87)
  })
  it('accepts feedback with all backend omitempty properties absent', () => {
    const feedback: FeedbackEntry = {
      id: 1,
      created_at: '2026-10-14T00:00:00Z',
      category: 'bug',
      title: 'Queue report',
      body: 'Report details',
      status: 'new',
    }

    expect(Object.keys(feedback)).toEqual([
      'id', 'created_at', 'category', 'title', 'body', 'status',
    ])
    expect(feedback.github_issue_url ?? '').toBe('')
    expect(feedback.submitter_subject || feedback.submitter_ip || '—').toBe('—')
    expect(feedback.user_email || null).toBeNull()
    expect(feedback.recent_errors).toBeUndefined()
    expect(feedback.console_tail).toBeUndefined()
    expect(feedback.triaged_at).toBeUndefined()
  })

  it('preserves populated snake_case feedback metadata and nullable triage time', () => {
    const feedback = {
      id: 2,
      created_at: '2026-10-14T00:00:00Z',
      category: 'feature',
      title: 'Queue improvement',
      body: 'Feature details',
      status: 'triaged',
      page_route: '/admin/feedback',
      user_agent: 'Test browser',
      app_version: 'test-version',
      user_email: 'reporter@example.test',
      recent_errors: [{ message: 'Test error' }],
      console_tail: 'Test console entry',
      github_issue_url: 'https://github.com/ev-dev-labs/teslasync/issues/1',
      submitter_subject: 'test-reporter',
      submitter_ip: '192.0.2.1',
      triaged_at: '2026-10-14T01:00:00Z',
      triaged_by: 'test-admin',
    } satisfies FeedbackEntry

    expect(feedback.github_issue_url).toContain('/issues/1')
    expect(feedback.recent_errors).toEqual([{ message: 'Test error' }])
    expect(feedback.triaged_by).toBe('test-admin')
    const untriaged: FeedbackEntry = { ...feedback, status: 'new', triaged_at: null }
    expect(untriaged.triaged_at).toBeNull()
  })

  it('accepts a representative Vehicle row', () => {
    const vehicle = {
      id: 1,
      vehicle_id: 1234567890,
      vin: '5YJ3E1EA7KF000000',
      display_name: 'Test Model 3',
      model: 'model3',
      trim_badging: 'p74d',
      exterior_color: 'MidnightSilver',
      wheel_type: 'Stiletto20',
      state: 'online',
      healthy: true,
      timezone: 'America/Los_Angeles',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    } satisfies Vehicle
    expect(vehicle.vin).toBe('5YJ3E1EA7KF000000')
    expect(vehicle.healthy).toBe(true)
  })

  it('carries a typed scalar in SignalEnvelope keyed by kind', () => {
    const floatSignal = { kind: 'float', value: 3.14, ts: '2024-01-01T00:00:00Z' } satisfies SignalEnvelope
    expect(floatSignal.value).toBe(3.14)

    // A null value models an empty typed column and must remain assignable.
    const emptySignal = { kind: 'unknown', value: null, ts: '2024-01-01T00:00:00Z' } satisfies SignalEnvelope
    expect(emptySignal.value).toBeNull()
  })

  it('enumerates the documented union members', () => {
    const kinds: SignalKind[] = ['string', 'bool', 'int', 'float', 'time', 'unknown']
    expect(kinds).toHaveLength(6)

    const severities: AlertRuleSeverity[] = ['info', 'warn', 'critical']
    expect(severities).toContain('critical')
  })
})
