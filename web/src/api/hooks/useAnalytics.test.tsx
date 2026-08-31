/**
 * useAnalytics hook-suite tests.
 *
 * Covers every runtime export of the module — the `analyticsKeys` query-key
 * factory plus all fourteen TanStack Query hooks — asserting:
 *   - the exact request path each hook builds (snake_case params, no
 *     `/api/v1` prefix, `vehicle_id` URL-encoded);
 *   - AbortSignal threading so a route change cancels the in-flight fetch;
 *   - `enabled` gating (vehicle-scoped hooks stay idle until an id arrives,
 *     while the fleet-wide hooks fire unconditionally);
 *   - `select` envelope-unwrapping + `safeArray` null-safety on the mileage,
 *     timeline and state-summary hooks;
 *   - success-payload passthrough and the `isError` failure channel.
 *
 * The HTTP boundary is mocked at `../client` (the module the hooks import
 * `request` from) so no real network is opened. The module's own type-only
 * exports are exercised through fully-typed fixtures so a drift in any
 * interface fails `tsc --noEmit`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return { ...actual, request: vi.fn() };
});

import { request } from '../client';
import {
  analyticsKeys,
  useAnalyticsSummary,
  useFleetAnalytics,
  useMileageStats,
  useMonthlyMileage,
  useDailyMileage,
  useCostBreakdown,
  useTimeline,
  useStateSummary,
  useWeeklyDigest,
  useLifetimeStats,
  useYearReview,
  useBatteryCells,
  useRangeProjection,
  useTemperatureImpact,
  useFsdInsights,
  useFsdInsightsRange,
  type LifetimeStats,
  type LifetimeAchievement,
  type PersonalRecord,
  type CellStatus,
  type CellReading,
  type CellHistoryPoint,
  type BatteryCellData,
  type RangeFactor,
  type RangeCurvePoint,
  type EfficiencyBucket,
  type RangeScenario,
  type RangeProjection,
  type TemperatureImpactPoint,
  type TemperatureImpactEfficiencyBucket,
  type TemperatureImpactMonthlyTrend,
  type TemperatureImpactResponse,
} from './useAnalytics';
import type { FsdInsights } from '@/types/fsd';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** The (url, options) tuple of the Nth `request()` invocation. */
function callAt(n = 0): [string, { signal?: unknown }] {
  return mockedRequest.mock.calls[n] as [string, { signal?: unknown }];
}

/** Let a disabled query settle so "did NOT fire" is a real observation. */
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// analyticsKeys — pure query-key factory
// ---------------------------------------------------------------------------

describe('analyticsKeys', () => {
  it('namespaces every key under the "analytics" root', () => {
    expect(analyticsKeys.summary(30)).toEqual(['analytics', 'summary', 30]);
    expect(analyticsKeys.mileage('7')).toEqual(['analytics', 'mileage', '7']);
    expect(analyticsKeys.monthlyMileage('7')).toEqual([
      'analytics',
      'monthly-mileage',
      '7',
    ]);
    expect(analyticsKeys.dailyMileage('7', 90)).toEqual([
      'analytics',
      'daily-mileage',
      '7',
      90,
    ]);
    expect(analyticsKeys.cost('7')).toEqual(['analytics', 'cost', '7']);
    expect(analyticsKeys.timeline('7')).toEqual(['analytics', 'timeline', '7']);
    expect(analyticsKeys.stateSummary('7')).toEqual([
      'analytics',
      'state-summary',
      '7',
    ]);
    expect(analyticsKeys.weeklyDigest('7')).toEqual([
      'analytics',
      'weekly-digest',
      '7',
    ]);
    expect(analyticsKeys.batteryCells('7')).toEqual([
      'analytics',
      'battery-cells',
      '7',
    ]);
    expect(analyticsKeys.temperatureImpact('7')).toEqual([
      'analytics',
      'temperature-impact',
      '7',
    ]);
  });

  it('threads the fleet window (days/start/end) into a stable tuple', () => {
    expect(analyticsKeys.fleet(30, undefined, undefined)).toEqual([
      'analytics',
      'fleet',
      30,
      undefined,
      undefined,
    ]);
    expect(analyticsKeys.fleet(undefined, '2024-01-01', '2024-02-01')).toEqual([
      'analytics',
      'fleet',
      undefined,
      '2024-01-01',
      '2024-02-01',
    ]);
  });

  it('keeps lifetime keyed even when the vehicle id is omitted', () => {
    expect(analyticsKeys.lifetime('7')).toEqual(['analytics', 'lifetime', '7']);
    expect(analyticsKeys.lifetime()).toEqual([
      'analytics',
      'lifetime',
      undefined,
    ]);
  });
});

// ---------------------------------------------------------------------------
// useAnalyticsSummary
// ---------------------------------------------------------------------------

describe('useAnalyticsSummary', () => {
  it('defaults to a trailing 30-day window and threads the signal', async () => {
    mockedRequest.mockResolvedValueOnce({ totalVehicles: 2 });
    const { result } = renderHook(() => useAnalyticsSummary(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = callAt();
    expect(url).toBe('/analytics/fleet?days=30');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toEqual({ totalVehicles: 2 });
  });

  it('honours an explicit day count', async () => {
    mockedRequest.mockResolvedValueOnce({ totalVehicles: 0 });
    renderHook(() => useAnalyticsSummary(7), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callAt()[0]).toBe('/analytics/fleet?days=7');
  });

  it('surfaces a request rejection through the error channel', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useAnalyticsSummary(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// useFleetAnalytics — three calling shapes + legacy positional args
// ---------------------------------------------------------------------------

describe('useFleetAnalytics', () => {
  it('requests unbounded history when called with no arguments', async () => {
    mockedRequest.mockResolvedValueOnce({ period_days: 0 });
    const { result } = renderHook(() => useFleetAnalytics(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/analytics/fleet');
    expect(callAt()[1]).toHaveProperty('signal');
  });

  it('maps the numeric shorthand to a trailing ?days window', async () => {
    mockedRequest.mockResolvedValueOnce({ period_days: 30 });
    renderHook(() => useFleetAnalytics(30), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callAt()[0]).toBe('/analytics/fleet?days=30');
  });

  it('treats the object {days} form identically to the numeric form', async () => {
    mockedRequest.mockResolvedValueOnce({ period_days: 30 });
    renderHook(() => useFleetAnalytics({ days: 30 }), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callAt()[0]).toBe('/analytics/fleet?days=30');
  });

  it('emits URL-encoded start/end bounds from a RangePicker object', async () => {
    mockedRequest.mockResolvedValueOnce({ period_days: 31 });
    renderHook(
      () =>
        useFleetAnalytics({
          start: '2024-01-01T00:00:00Z',
          end: '2024-02-01T00:00:00Z',
        }),
      { wrapper },
    );
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    const url = callAt()[0];
    expect(url.startsWith('/analytics/fleet?')).toBe(true);
    // URLSearchParams percent-encodes the ISO colons.
    expect(url).toContain('start=2024-01-01T00%3A00%3A00Z');
    expect(url).toContain('end=2024-02-01T00%3A00%3A00Z');
  });

  it('lets an explicit start win over a legacy positional days arg', async () => {
    mockedRequest.mockResolvedValueOnce({ period_days: 0 });
    renderHook(() => useFleetAnalytics(30, '2024-01-01'), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    // Backend precedence: start/end beat days, so `days=30` is dropped.
    expect(callAt()[0]).toBe('/analytics/fleet?start=2024-01-01');
  });
});

// ---------------------------------------------------------------------------
// useMileageStats
// ---------------------------------------------------------------------------

describe('useMileageStats', () => {
  it('GETs /mileage/stats with a snake_case vehicle_id param', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicle_id: 7, lifetime_km: 1000 });
    const { result } = renderHook(() => useMileageStats('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/mileage/stats?vehicle_id=7');
    expect(callAt()[1]).toHaveProperty('signal');
    expect(result.current.data?.lifetime_km).toBe(1000);
  });

  it('stays idle until a vehicle id is supplied', async () => {
    const { result } = renderHook(() => useMileageStats(''), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('URL-encodes an id containing reserved characters', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicle_id: 0, lifetime_km: 0 });
    renderHook(() => useMileageStats('a b&c'), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callAt()[0]).toBe('/mileage/stats?vehicle_id=a%20b%26c');
  });
});

// ---------------------------------------------------------------------------
// useMonthlyMileage — unwraps { months } via safeArray
// ---------------------------------------------------------------------------

describe('useMonthlyMileage', () => {
  it('unwraps the {months} envelope into a plain bucket array', async () => {
    mockedRequest.mockResolvedValueOnce({
      vehicle_id: 7,
      months: [
        {
          year_month: '2024-01',
          drive_count: 12,
          total_km: 340,
          total_wh_consumed: 51000,
          avg_efficiency_wh_per_km: 150,
        },
      ],
    });
    const { result } = renderHook(() => useMonthlyMileage('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/mileage/monthly?vehicle_id=7');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].year_month).toBe('2024-01');
  });

  it('coerces a null / envelope-less payload to an empty array', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useMonthlyMileage('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('is disabled without a vehicle id', async () => {
    renderHook(() => useMonthlyMileage(''), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useDailyMileage — default + custom window, unwraps { days }
// ---------------------------------------------------------------------------

describe('useDailyMileage', () => {
  it('defaults to a 90-day window and unwraps the {days} envelope', async () => {
    mockedRequest.mockResolvedValueOnce({
      vehicle_id: 7,
      days: [
        { date: '2024-01-01', drive_count: 2, total_km: 40, end_odometer_km: 12000 },
      ],
    });
    const { result } = renderHook(() => useDailyMileage('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/mileage/daily?vehicle_id=7&days=90');
    expect(result.current.data?.[0].total_km).toBe(40);
  });

  it('threads a custom day count into the query string', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicle_id: 7, days: [] });
    const { result } = renderHook(() => useDailyMileage('7', 30), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/mileage/daily?vehicle_id=7&days=30');
    expect(result.current.data).toEqual([]);
  });

  it('is disabled without a vehicle id', async () => {
    renderHook(() => useDailyMileage(''), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useCostBreakdown
// ---------------------------------------------------------------------------

describe('useCostBreakdown', () => {
  it('GETs the TCO endpoint and surfaces the breakdown', async () => {
    mockedRequest.mockResolvedValueOnce({ total_savings: 4200 });
    const { result } = renderHook(() => useCostBreakdown('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/analytics/tco?vehicle_id=7');
    expect(result.current.data?.total_savings).toBe(4200);
  });

  it('is disabled without a vehicle id', async () => {
    renderHook(() => useCostBreakdown(''), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useTimeline (deprecated) — unwraps { transitions } via safeArray
// ---------------------------------------------------------------------------

describe('useTimeline', () => {
  it('unwraps the {transitions} envelope into a plain event array', async () => {
    mockedRequest.mockResolvedValueOnce({
      transitions: [
        { id: 't1', state: 'driving', startDate: '2024-01-01', durationMin: 30 },
      ],
    });
    const { result } = renderHook(() => useTimeline('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/vehicle-states/timeline?vehicle_id=7');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].state).toBe('driving');
  });

  it('defaults a missing transitions field to an empty array', async () => {
    mockedRequest.mockResolvedValueOnce({});
    const { result } = renderHook(() => useTimeline('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('routes a removed-endpoint 404 to the error channel', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('not found'));
    const { result } = renderHook(() => useTimeline('7'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// useStateSummary (deprecated) — safeArray select
// ---------------------------------------------------------------------------

describe('useStateSummary', () => {
  it('passes an array payload straight through', async () => {
    mockedRequest.mockResolvedValueOnce([
      { state: 'asleep', totalMin: 600, count: 3 },
    ]);
    const { result } = renderHook(() => useStateSummary('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/vehicle-states/summary?vehicle_id=7');
    expect(result.current.data?.[0].state).toBe('asleep');
  });

  it('coerces a non-array payload to an empty array', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useStateSummary('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// useWeeklyDigest
// ---------------------------------------------------------------------------

describe('useWeeklyDigest', () => {
  it('GETs the per-vehicle weekly-digest route', async () => {
    mockedRequest.mockResolvedValueOnce({ drives: 9, distanceKm: 240 });
    const { result } = renderHook(() => useWeeklyDigest('9'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/vehicles/9/weekly-digest');
    expect(result.current.data?.drives).toBe(9);
  });

  it('is disabled without a vehicle id', async () => {
    renderHook(() => useWeeklyDigest(''), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useLifetimeStats — fires with OR without a vehicle id
// ---------------------------------------------------------------------------

describe('useLifetimeStats', () => {
  const record: PersonalRecord = { value: 512, date: '2024-03-03' };
  const achievement: LifetimeAchievement = {
    id: 'road-warrior',
    name: 'Road Warrior',
    description: 'Drive 10,000 km',
    icon: 'trophy',
    unlocked: true,
    unlocked_at: '2024-04-01T00:00:00Z',
    progress: 100,
    target: 10000,
    current: 10000,
  };
  const fixture: LifetimeStats = {
    total_drives: 128,
    total_distance_km: 10000,
    total_driving_hours: 210,
    longest_drive_km: 512,
    highest_speed_kmh: 189,
    avg_efficiency_wh_km: 155,
    total_charge_sessions: 64,
    total_energy_kwh: 1800,
    total_charging_hours: 120,
    total_charging_cost: 220,
    gas_equivalent_cost: 900,
    total_savings: 680,
    co2_offset_kg: 1500,
    trees_equivalent: 68,
    earth_circumferences: 0.25,
    moon_trips: 0.02,
    days_on_road: 9,
    homes_equivalent_days: 30,
    first_drive_date: '2023-01-01',
    ownership_days: 500,
    most_active_day_of_week: 'Fri',
    most_active_hour: 17,
    longest_drive_record: record,
    highest_speed_record: { value: 189, date: null },
    max_charge_record: { value: 80, date: '2024-02-02' },
    achievements: [achievement],
  };

  it('appends the vehicle_id param when scoped to a vehicle', async () => {
    mockedRequest.mockResolvedValueOnce(fixture);
    const { result } = renderHook(() => useLifetimeStats('3'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/analytics/lifetime?vehicle_id=3');
    expect(result.current.data?.achievements[0].id).toBe('road-warrior');
    expect(result.current.data?.longest_drive_record.value).toBe(512);
  });

  it('fires fleet-wide (no vehicle_id) when the id is omitted', async () => {
    mockedRequest.mockResolvedValueOnce(fixture);
    const { result } = renderHook(() => useLifetimeStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/analytics/lifetime');
  });
});

// ---------------------------------------------------------------------------
// useYearReview — enabled only with a vehicle id
// ---------------------------------------------------------------------------

describe('useYearReview', () => {
  it('threads the year and encoded vehicle_id into the query', async () => {
    mockedRequest.mockResolvedValueOnce({ year: 2024, total_drives: 100 });
    const { result } = renderHook(() => useYearReview(2024, '5'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/analytics/year-review?year=2024&vehicle_id=5');
    expect(result.current.data?.year).toBe(2024);
  });

  it('is disabled until a vehicle id is chosen', async () => {
    renderHook(() => useYearReview(2024), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useBatteryCells
// ---------------------------------------------------------------------------

describe('useBatteryCells', () => {
  const status: CellStatus = 'significant_deviation';
  const cell: CellReading = {
    cell_number: 1,
    voltage: 3.91,
    delta_from_avg: 12,
    status,
  };
  const historyPoint: CellHistoryPoint = {
    timestamp: '2024-01-01T00:00:00Z',
    min_voltage: 3.88,
    max_voltage: 3.95,
    avg_voltage: 3.91,
    imbalance_mv: 70,
  };
  const fixture: BatteryCellData = {
    status: 'ok',
    total_cells: 96,
    avg_voltage: 3.91,
    min_voltage: 3.88,
    max_voltage: 3.95,
    voltage_spread: 0.07,
    imbalance_mv: 70,
    pack_voltage: 375,
    avg_temperature: 24,
    min_temperature: 22,
    max_temperature: 26,
    temp_spread: 4,
    cells: [cell],
    history: [historyPoint],
    min_cell: '1',
    max_cell: '42',
  };

  it('GETs the battery-cells endpoint and surfaces the SI snapshot', async () => {
    mockedRequest.mockResolvedValueOnce(fixture);
    const { result } = renderHook(() => useBatteryCells('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/analytics/battery-cells?vehicle_id=7');
    expect(result.current.data?.total_cells).toBe(96);
    expect(result.current.data?.cells[0].status).toBe('significant_deviation');
    expect(result.current.data?.history[0].imbalance_mv).toBe(70);
  });

  it('is disabled without a vehicle id', async () => {
    renderHook(() => useBatteryCells(''), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useRangeProjection
// ---------------------------------------------------------------------------

describe('useRangeProjection', () => {
  const factor: RangeFactor = {
    name: 'Temperature',
    impact_pct: -12,
    description: 'Cold ambient reduces range',
  };
  const curvePoint: RangeCurvePoint = {
    battery_pct: 80,
    rated_range: 400,
    projected_range: 360,
  };
  const bucket: EfficiencyBucket = {
    temp_bucket: '0-10C',
    speed_bucket: '80-100',
    wh_km: 180,
    samples: 12,
  };
  const scenario: RangeScenario = {
    name: 'Highway 110',
    speed_kmh: 110,
    temp_c: 5,
    efficiency_wh_km: 200,
    range_km: 300,
    sample_count: 8,
    extras: ['AC on'],
    is_current: true,
  };
  const fixture: RangeProjection = {
    current_range_km: 350,
    projected_range_km: 330,
    battery_level: 82,
    efficiency_factor: 0.92,
    factors: [factor],
    projection_curve: [curvePoint],
    current_battery_pct: 82,
    usable_capacity_wh: 72000,
    health_factor: 0.96,
    scenarios: [scenario],
    efficiency_matrix: [bucket],
    tesla_estimate_km: 360,
    your_estimate_km: 330,
    accuracy_note: 'Based on 40 recent drives',
  };

  it('GETs the range-projection endpoint and surfaces the model', async () => {
    mockedRequest.mockResolvedValueOnce(fixture);
    const { result } = renderHook(() => useRangeProjection('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/analytics/range-projection?vehicle_id=7');
    expect(result.current.data?.scenarios[0].name).toBe('Highway 110');
    expect(result.current.data?.factors[0].impact_pct).toBe(-12);
  });

  it('is disabled without a vehicle id', async () => {
    renderHook(() => useRangeProjection(''), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useTemperatureImpact
// ---------------------------------------------------------------------------

describe('useTemperatureImpact', () => {
  const point: TemperatureImpactPoint = {
    outside_temp: 4,
    efficiency_wh_km: 190,
    distance_km: 42,
    drive_date: '2024-01-05',
  };
  const effBucket: TemperatureImpactEfficiencyBucket = {
    temp_bucket: '0-10C',
    drive_count: 20,
    avg_distance_km: 38,
    avg_duration_s: 2100,
    avg_battery_pct_per_100km: 22,
    avg_temp: 5,
  };
  const trend: TemperatureImpactMonthlyTrend = {
    month: '2024-01',
    avg_temp: 3,
    avg_efficiency: 195,
    drive_count: 40,
    total_distance: 1200,
  };
  const fixture: TemperatureImpactResponse = {
    points: [point],
    efficiency: [effBucket],
    vampire_drain: [],
    monthly_trend: [trend],
  };

  it('GETs the temperature-impact endpoint and surfaces every array', async () => {
    mockedRequest.mockResolvedValueOnce(fixture);
    const { result } = renderHook(() => useTemperatureImpact('7'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt()[0]).toBe('/analytics/temperature-impact?vehicle_id=7');
    expect(result.current.data?.points[0].outside_temp).toBe(4);
    expect(result.current.data?.monthly_trend[0].month).toBe('2024-01');
    expect(result.current.data?.vampire_drain).toEqual([]);
  });

  it('is disabled without a vehicle id', async () => {
    renderHook(() => useTemperatureImpact(''), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useFsdInsights
// ---------------------------------------------------------------------------

describe('useFsdInsights', () => {
  const fixture: FsdInsights = {
    vehicle_id: 7,
    period: {
      days: 30,
      timezone: 'America/Los_Angeles',
      start_date: '2026-02-02',
      end_date: '2026-03-03',
      start_at: '2026-02-02T08:00:00Z',
      end_at: '2026-03-03T18:00:00Z',
    },
    totals: {
      fsd_distance_m: 12_000,
      driving_distance_m: 48_000,
      fsd_share_pct: 25,
      active_days: 4,
      measured_days: 27,
      days_in_period: 30,
      avg_measured_day_fsd_distance_m: 444.444,
      avg_active_day_fsd_distance_m: 3_000,
      best_day: {
        date: '2026-02-20',
        fsd_distance_m: 6_000,
        driving_distance_m: 10_000,
        fsd_share_pct: 60,
      },
    },
    quality: {
      fsd_sample_count: 12,
      driving_sample_count: 14,
      fsd_invalid_sample_count: 0,
      driving_invalid_sample_count: 0,
      fsd_duplicate_sample_count: 0,
      driving_duplicate_sample_count: 0,
      fsd_reset_count: 0,
      driving_reset_count: 0,
      fsd_baseline_available: true,
      driving_baseline_available: true,
      fsd_reported_in_period: true,
      driving_reported_in_period: true,
      fsd_distance_derivable: true,
      driving_denominator_available: true,
      share_basis_available: true,
      fsd_measured_days: 27,
      historical_data_guarded: true,
      required_normalization_version: 1,
      fsd_untrusted_sample_count: 0,
      driving_untrusted_sample_count: 0,
      counter_observation_days: 9,
      days_without_counter_observation: 21,
      counter_observation_day_pct: 30,
      first_observation_at: '2026-02-04T10:00:00Z',
      last_observation_at: '2026-03-02T19:00:00Z',
      fsd_first_observation_at: '2026-02-04T10:00:00Z',
      fsd_last_observation_at: '2026-03-02T19:00:00Z',
      share_clamped: false,
    },
    daily: [
      {
        date: '2026-02-20',
        fsd_distance_m: 6_000,
        driving_distance_m: 10_000,
        fsd_share_pct: 60,
        fsd_observation_count: 3,
        driving_observation_count: 4,
        reset_count: 0,
        has_counter_observation: true,
      },
    ],
    drive_analytics: {
      comparison: {
        previous_period: {
          days: 30,
          timezone: 'America/Los_Angeles',
          start_date: '2026-01-03',
          end_date: '2026-02-01',
          start_at: '2026-01-03T08:00:00Z',
          end_at: '2026-02-02T07:59:59Z',
        },
        previous_fsd_distance_m: null,
        previous_driving_distance_m: null,
        previous_fsd_share_pct: null,
        fsd_distance_change_m: null,
        fsd_distance_change_pct: null,
        fsd_share_change_pct_points: null,
      },
      attribution: {
        attributed_distance_m: null,
        estimated_distance_m: null,
        ambiguous_distance_m: null,
        unattributed_distance_m: null,
        unknown_drive_distance_m: 0,
      },
      contributing_drives: [],
      reset_events: [],
      repeated_routes: [],
      time_of_day: [],
      firmware: [],
      route_efficiency: [],
      correlation_disclaimer: 'Correlation only.',
    },
  };

  it('builds a snake_case scoped path with no /api/v1 prefix', async () => {
    mockedRequest.mockResolvedValueOnce(fixture);
    const { result } = renderHook(
      () => useFsdInsights('7', 90, 'America/Los_Angeles'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, options] = callAt();
    expect(url.startsWith('/analytics/fsd?')).toBe(true);
    expect(url).not.toContain('/api/v1');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('vehicle_id')).toBe('7');
    expect(params.get('days')).toBe('90');
    expect(params.get('timezone')).toBe('America/Los_Angeles');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns raw SI meters untouched', async () => {
    mockedRequest.mockResolvedValueOnce(fixture);
    const { result } = renderHook(() => useFsdInsights('7', 30, 'UTC'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.totals.fsd_distance_m).toBe(12_000);
    expect(result.current.data?.daily[0].fsd_distance_m).toBe(6_000);
    expect(result.current.data?.totals.fsd_share_pct).toBe(25);
  });

  it('builds an explicit range request without a days parameter', async () => {
    mockedRequest.mockResolvedValueOnce(fixture);
    const { result } = renderHook(
      () => useFsdInsightsRange(
        '7',
        '2026-03-01T08:00:00.000Z',
        '2026-03-02T08:00:00.000Z',
        'America/Los_Angeles',
      ),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = callAt();
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('vehicle_id')).toBe('7');
    expect(params.get('start')).toBe('2026-03-01T08:00:00.000Z');
    expect(params.get('end')).toBe('2026-03-02T08:00:00.000Z');
    expect(params.get('timezone')).toBe('America/Los_Angeles');
    expect(params.has('days')).toBe(false);
    expect(params.has('include_evidence')).toBe(false);
  });

  it('opts into bounded route evidence only when requested', async () => {
    mockedRequest.mockResolvedValueOnce(fixture);
    const { result } = renderHook(
      () => useFsdInsightsRange(
        '7',
        '2026-03-01T08:00:00.000Z',
        '2026-03-02T08:00:00.000Z',
        'America/Los_Angeles',
        true,
      ),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = callAt();
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('include_evidence')).toBe('true');
  });

  it('refetches an inactive FSD query after a drive mutation invalidates it', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 60_000 } },
    });
    const stableWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const useRange = () => useFsdInsightsRange(
      '7',
      '2026-03-01T08:00:00.000Z',
      '2026-03-02T08:00:00.000Z',
      'UTC',
    );

    mockedRequest.mockResolvedValueOnce(fixture);
    const first = renderHook(useRange, { wrapper: stableWrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    await client.invalidateQueries({
      queryKey: ['analytics', 'fsd'],
      refetchType: 'none',
    });
    mockedRequest.mockResolvedValueOnce(fixture);
    const second = renderHook(useRange, { wrapper: stableWrapper });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
    second.unmount();
    client.clear();
  });

  it('keys the cache by vehicle, period, and timezone so scopes cannot bleed', () => {
    const a = analyticsKeys.fsdInsights({ vehicleId: '7', timezone: 'UTC', filters: { days: 30 } });
    const b = analyticsKeys.fsdInsights({ vehicleId: '8', timezone: 'UTC', filters: { days: 30 } });
    const c = analyticsKeys.fsdInsights({ vehicleId: '7', timezone: 'UTC', filters: { days: 90 } });
    const d = analyticsKeys.fsdInsights({
      vehicleId: '7',
      timezone: 'Europe/Berlin',
      filters: { days: 30 },
    });

    expect(a[0]).toBe('analytics');
    expect(a[1]).toBe('fsd');
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(d));
  });

  it('is disabled without a vehicle id', async () => {
    renderHook(() => useFsdInsights(undefined, 30, 'UTC'), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('surfaces the failure channel instead of throwing', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('fsd unavailable'));
    const { result } = renderHook(() => useFsdInsights('7', 30, 'UTC'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toContain('fsd unavailable');
  });
});