/**
 * analytics/types — the analytics API contract, locked at its boundaries.
 *
 * `types/analytics.ts` exports twelve interfaces and no runtime values, so —
 * exactly like the `weekly-digest/types.test.ts` and `devtools/types.test.ts`
 * precedents — the only honest way to lock them is to pin the contract where it
 * is actually produced and consumed:
 *
 *   producer → every interface is the response shape (or an element of one) of a
 *              hook in `api/hooks/useAnalytics.ts`. The Go handlers emit
 *              snake_case JSON; the client's `camelCaseKeys()` transform exposes
 *              BOTH the original snake_case keys AND camelCase aliases, so the
 *              camelCase interfaces (AnalyticsSummary / WeeklyDigestData) and the
 *              snake_case ones (CostBreakdown / MileageStats / …) both resolve.
 *   consumer → the pages/widgets read these fields directly, so a field
 *              rename/removal/retype must break this file at COMPILE time.
 *
 * Each `assert*Shape` guard takes its interface type as a parameter (compile-time
 * pin) and asserts every field's runtime type (runtime pin) — so a wire-shape
 * drift or a producer regression can't slip past unseen. The wire-compatibility
 * block additionally runs the REAL `camelCaseKeys` (imported from
 * `@/lib/resilience`, NOT mocked) over backend-accurate fixtures copied from the
 * Go handlers, because the hook tests mock `request` and therefore never exercise
 * the actual snake→camel transform these interfaces depend on.
 */
import { describe, it, expect } from 'vitest';
import { camelCaseKeys } from '@/lib/resilience';
import { safeArray } from '@/lib/safeArray';
import type {
  AnalyticsSummary,
  VehicleComparisonEntry,
  MileageStats,
  MonthlyMileageBucket,
  MonthlyMileageResponse,
  DailyMileageBucket,
  DailyMileageResponse,
  CostBreakdown,
  MonthlyCostEntry,
  TimelineEvent,
  StateSummary,
  WeeklyDigestData,
} from './analytics';

// ── Interface shape guards (compile-time + runtime pins) ─────────────────────
// Each parameter is typed against its interface, so any field rename/removal in
// analytics.ts breaks compilation here; the body pins the runtime types.

function assertVehicleComparisonEntryShape(e: VehicleComparisonEntry): void {
  expect(typeof e.id).toBe('string');
  expect(typeof e.name).toBe('string');
  expect(typeof e.distance).toBe('number');
  expect(typeof e.energy).toBe('number');
  expect(typeof e.efficiency).toBe('number');
}

function assertAnalyticsSummaryShape(s: AnalyticsSummary): void {
  const numeric: Array<keyof AnalyticsSummary> = [
    'totalVehicles', 'totalDrives', 'totalChargingSessions', 'totalDistanceKm',
    'totalEnergyKwh', 'totalCost', 'avgEfficiencyWhKm',
  ];
  for (const k of numeric) {
    expect(typeof s[k]).toBe('number');
    expect(Number.isNaN(s[k] as number)).toBe(false);
  }
  // co2SavedKg is optional — /analytics/fleet omits it (see the interface doc).
  if (s.co2SavedKg !== undefined) expect(typeof s.co2SavedKg).toBe('number');
  expect(Array.isArray(s.vehicleComparison)).toBe(true);
  s.vehicleComparison.forEach(assertVehicleComparisonEntryShape);
}

function assertMileageStatsShape(s: MileageStats): void {
  expect(typeof s.vehicle_id).toBe('number');
  const numeric: Array<keyof MileageStats> = [
    'lifetime_km', 'last_7d_km', 'last_30d_km', 'last_365d_km',
    'drive_count_lifetime', 'drive_count_30d',
  ];
  for (const k of numeric) expect(typeof s[k]).toBe('number');
  // *time.Time pointers → JSON null for a vehicle with zero recorded drives.
  for (const k of ['first_drive_at', 'last_drive_at'] as const) {
    expect(s[k] === null || typeof s[k] === 'string').toBe(true);
  }
}

function assertMonthlyMileageBucketShape(b: MonthlyMileageBucket): void {
  expect(typeof b.year_month).toBe('string');
  expect(typeof b.drive_count).toBe('number');
  expect(typeof b.total_km).toBe('number');
  // *float64 pointers preserve JSON null when a month's drives all had NULL energy.
  expect(b.total_wh_consumed === null || typeof b.total_wh_consumed === 'number').toBe(true);
  expect(
    b.avg_efficiency_wh_per_km === null || typeof b.avg_efficiency_wh_per_km === 'number',
  ).toBe(true);
}

function assertDailyMileageBucketShape(b: DailyMileageBucket): void {
  expect(typeof b.date).toBe('string');
  expect(typeof b.drive_count).toBe('number');
  expect(typeof b.total_km).toBe('number');
  expect(b.end_odometer_km === null || typeof b.end_odometer_km === 'number').toBe(true);
}

function assertMonthlyCostEntryShape(e: MonthlyCostEntry): void {
  expect(typeof e.month).toBe('string');
  for (const k of ['ev_cost', 'equiv_gas_cost', 'cumulative_savings', 'energy_wh'] as const) {
    expect(typeof e[k]).toBe('number');
  }
}

function assertCostBreakdownShape(c: CostBreakdown): void {
  const numeric: Array<keyof CostBreakdown> = [
    'total_charging_cost', 'total_wh', 'total_sessions', 'total_km',
    'equivalent_gas_cost', 'total_savings', 'monthly_savings', 'cost_per_km_ev',
    'cost_per_km_ice', 'maintenance_savings_estimate', 'months_of_ownership',
    'gas_price', 'gas_efficiency_mpg',
  ];
  for (const k of numeric) expect(typeof c[k]).toBe('number');
  expect(typeof c.first_date).toBe('string');
  expect(typeof c.last_date).toBe('string');
  expect(Array.isArray(c.monthly_breakdown)).toBe(true);
  c.monthly_breakdown.forEach(assertMonthlyCostEntryShape);
}

function assertTimelineEventShape(e: TimelineEvent): void {
  expect(typeof e.id).toBe('string');
  expect(typeof e.state).toBe('string');
  expect(typeof e.startDate).toBe('string');
  expect(typeof e.durationMin).toBe('number');
}

function assertStateSummaryShape(s: StateSummary): void {
  expect(typeof s.state).toBe('string');
  expect(typeof s.totalMin).toBe('number');
  expect(typeof s.count).toBe('number');
}

function assertWeeklyDigestShape(w: WeeklyDigestData): void {
  const numeric: Array<keyof WeeklyDigestData> = [
    'drives', 'distanceKm', 'energyKwh', 'cost', 'efficiency',
    'prevDrives', 'prevDistanceKm', 'prevEnergyKwh', 'prevCost', 'prevEfficiency',
  ];
  for (const k of numeric) {
    expect(typeof w[k]).toBe('number');
    expect(Number.isNaN(w[k])).toBe(false);
  }
}

// ── Backend-accurate wire fixtures (copied from the Go handlers) ─────────────

/** GET /analytics/fleet body — internal/api/analytics/queries.go:571. */
const fleetWire = {
  period_days: 30,
  total_vehicles: 4,
  total_distance_km: 12345.6,
  total_drives: 128,
  total_charging_sessions: 47,
  total_energy_kwh: 450.5,
  total_cost: 321,
  avg_efficiency_wh_km: 158.2,
  most_efficient_vehicle: { id: 1, name: 'Model Y', efficiency: 147 },
  // NOTE: deliberately NO co2_saved_kg — the handler never emits it.
  vehicle_comparison: [
    { id: 1, name: 'Model Y', drives: 80, distance: 8000, energy: 1400, efficiency: 175 },
    { id: 2, name: 'Model 3', drives: 48, distance: 4345, energy: 640, efficiency: 147 },
  ],
} as const;

/** GET /vehicles/{id}/weekly-digest body — internal/api/weeklydigest/handler.go:84. */
const weeklyWire = {
  drives: 12,
  distance_km: 340.5,
  energy_kwh: 78.2,
  cost: 10.9,
  efficiency: 230,
  prev_drives: 9,
  prev_distance_km: 300,
  prev_energy_kwh: 70,
  prev_cost: 9.8,
  prev_efficiency: 233,
} as const;

/** GET /analytics/tco body — internal/api/tco/handler.go:57 (aitconar handler_test.go:103). */
const costWire = {
  vehicle_id: 1,
  total_charging_cost: 1234.56,
  total_wh: 5_000_000,
  total_sessions: 30,
  total_km: 8000,
  first_date: '2024-01-01',
  last_date: '2024-09-30',
  months_of_ownership: 9,
  cost_per_km_ev: 0.155,
  cost_per_km_ice: 0.23,
  equivalent_gas_cost: 1840,
  total_savings: 605.44,
  monthly_savings: 67.27,
  maintenance_savings_estimate: 450,
  gas_price: 3.5,
  gas_efficiency_mpg: 25,
  base_cost_per_kwh: 0.12,
  monthly_breakdown: [
    { month: '2024-01', ev_cost: 30, equiv_gas_cost: 60, cumulative_savings: 30, energy_wh: 250_000 },
  ],
} as const;

/** GET /mileage/stats body — internal/api/mileage/handler.go:160. */
const statsWire = {
  vehicle_id: 7,
  lifetime_km: 42000.5,
  last_7d_km: 210.2,
  last_30d_km: 900.1,
  last_365d_km: 12000,
  drive_count_lifetime: 512,
  drive_count_30d: 22,
  first_drive_at: '2021-05-01T08:00:00Z',
  last_drive_at: null,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
describe('analytics type contracts — interface shape guards (frontend fixtures)', () => {
  it('AnalyticsSummary + VehicleComparisonEntry conform (co2SavedKg present)', () => {
    const summary: AnalyticsSummary = {
      totalVehicles: 4,
      totalDrives: 128,
      totalChargingSessions: 47,
      totalDistanceKm: 12345,
      totalEnergyKwh: 450,
      totalCost: 321,
      avgEfficiencyWhKm: 158,
      co2SavedKg: 210,
      vehicleComparison: [
        { id: '1', name: 'Model Y', distance: 8000, energy: 1400, efficiency: 175 },
        { id: '2', name: 'Model 3', distance: 4345, energy: 640, efficiency: 147 },
      ],
    };
    assertAnalyticsSummaryShape(summary);
    expect(summary.vehicleComparison).toHaveLength(2);
    // Exact-key pin for the row interface — no field leaks past the five.
    expect(Object.keys(summary.vehicleComparison[0]).sort()).toEqual([
      'distance', 'efficiency', 'energy', 'id', 'name',
    ]);
  });

  it('AnalyticsSummary is valid without co2SavedKg (the optional, never-sent field)', () => {
    const summary: AnalyticsSummary = {
      totalVehicles: 0,
      totalDrives: 0,
      totalChargingSessions: 0,
      totalDistanceKm: 0,
      totalEnergyKwh: 0,
      totalCost: 0,
      avgEfficiencyWhKm: 0,
      vehicleComparison: [],
    };
    assertAnalyticsSummaryShape(summary);
    expect(summary.co2SavedKg).toBeUndefined();
    expect(summary.co2SavedKg ?? 0).toBe(0);
  });

  it('TimelineEvent + StateSummary conform (deprecated vehicle-states shapes)', () => {
    const event: TimelineEvent = {
      id: 'evt-1', state: 'driving', startDate: '2024-05-01T12:00:00Z', durationMin: 45,
    };
    const summary: StateSummary = { state: 'asleep', totalMin: 620, count: 3 };
    assertTimelineEventShape(event);
    assertStateSummaryShape(summary);
    expect(event.durationMin).toBe(45);
    expect(summary.count).toBe(3);
  });

  it('MonthlyCostEntry conforms in isolation', () => {
    const entry: MonthlyCostEntry = {
      month: '2025-03', ev_cost: 45, equiv_gas_cost: 120, cumulative_savings: 700, energy_wh: 310_000,
    };
    assertMonthlyCostEntryShape(entry);
    expect(entry.equiv_gas_cost - entry.ev_cost).toBe(75);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('camelCaseKeys wire compatibility (the REAL client transform)', () => {
  it('maps the /analytics/fleet snake_case body onto AnalyticsSummary camelCase fields', () => {
    const summary = camelCaseKeys(fleetWire) as AnalyticsSummary;

    expect(summary.totalVehicles).toBe(4);
    expect(summary.totalDistanceKm).toBe(12345.6);
    expect(summary.totalDrives).toBe(128);
    expect(summary.totalChargingSessions).toBe(47);
    expect(summary.totalEnergyKwh).toBe(450.5);
    expect(summary.totalCost).toBe(321);
    expect(summary.avgEfficiencyWhKm).toBe(158.2);

    expect(Array.isArray(summary.vehicleComparison)).toBe(true);
    expect(summary.vehicleComparison).toHaveLength(2);
    expect(summary.vehicleComparison[0].distance).toBe(8000);
    expect(summary.vehicleComparison[0].efficiency).toBe(175);
    expect(summary.vehicleComparison[1].name).toBe('Model 3');
  });

  it('surfaces the missing co2_saved_kg gap: co2SavedKg resolves undefined off the wire', () => {
    const summary = camelCaseKeys(fleetWire) as AnalyticsSummary;
    // The handler never emits co2_saved_kg — the field is genuinely absent,
    // which is exactly why the interface types it optional.
    expect(summary.co2SavedKg).toBeUndefined();
    expect('co2SavedKg' in (summary as object)).toBe(false);
    // Consumers therefore MUST default it (QuickStatsPage: `co2SavedKg ?? 0`).
    expect(summary.co2SavedKg ?? 0).toBe(0);
  });

  it('documents the vehicle id wire divergence: JSON number in, string in the type', () => {
    const summary = camelCaseKeys(fleetWire) as AnalyticsSummary;
    const raw = summary.vehicleComparison[0] as unknown as { id: unknown };
    // The backend serialises id as an int64 (JSON number); the frontend types it
    // string because it is only ever a React key (string|number both valid), so
    // this divergence is inert — see FleetComparisonPanel `key={r.id}`.
    expect(typeof raw.id).toBe('number');
    expect(String(raw.id)).toBe('1');
  });

  it('maps the /weekly-digest snake_case body onto WeeklyDigestData camelCase fields', () => {
    const w = camelCaseKeys(weeklyWire) as WeeklyDigestData;
    assertWeeklyDigestShape(w);
    expect(w.distanceKm).toBe(340.5);
    expect(w.energyKwh).toBe(78.2);
    expect(w.prevDistanceKm).toBe(300);
    expect(w.prevEnergyKwh).toBe(70);
    expect(w.prevEfficiency).toBe(233);
  });

  it('preserves original snake_case keys for the snake-typed interfaces (CostBreakdown / MileageStats)', () => {
    const cost = camelCaseKeys(costWire) as CostBreakdown;
    assertCostBreakdownShape(cost);
    // The interface reads the ORIGINAL keys — camelCaseKeys keeps them intact.
    expect(cost.total_charging_cost).toBe(1234.56);
    expect(cost.cost_per_km_ev).toBe(0.155);
    expect(cost.monthly_breakdown).toHaveLength(1);
    expect(cost.monthly_breakdown[0].ev_cost).toBe(30);

    const stats = camelCaseKeys(statsWire) as MileageStats;
    assertMileageStatsShape(stats);
    expect(stats.lifetime_km).toBe(42000.5);
    expect(stats.drive_count_lifetime).toBe(512);
    // *time.Time null preserved for the zero-drive case.
    expect(stats.last_drive_at).toBeNull();
    expect(stats.first_drive_at).toBe('2021-05-01T08:00:00Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('mileage envelopes + null-safety (the hook select contract)', () => {
  it('unwraps MonthlyMileageResponse.months and preserves nullable energy fields', () => {
    const resp: MonthlyMileageResponse = {
      vehicle_id: 7,
      months: [
        { year_month: '2024-01', drive_count: 10, total_km: 300, total_wh_consumed: 45_000, avg_efficiency_wh_per_km: 150 },
        { year_month: '2024-02', drive_count: 0, total_km: 0, total_wh_consumed: null, avg_efficiency_wh_per_km: null },
      ],
    };
    // useMonthlyMileage does `safeArray(resp?.months)`.
    const months = safeArray<MonthlyMileageBucket>(resp.months);
    expect(months).toHaveLength(2);
    months.forEach(assertMonthlyMileageBucketShape);
    expect(months[1].total_wh_consumed).toBeNull();
    expect(months[1].avg_efficiency_wh_per_km).toBeNull();
    expect(months[1].total_wh_consumed ?? 0).toBe(0);
  });

  it('unwraps DailyMileageResponse.days and preserves the nullable end_odometer_km', () => {
    const resp: DailyMileageResponse = {
      vehicle_id: 7,
      days: [
        { date: '2024-01-01', drive_count: 3, total_km: 120, end_odometer_km: 42_000 },
        { date: '2024-01-02', drive_count: 1, total_km: 20, end_odometer_km: null },
      ],
    };
    const days = safeArray<DailyMileageBucket>(resp.days);
    expect(days).toHaveLength(2);
    days.forEach(assertDailyMileageBucketShape);
    expect(days[1].end_odometer_km).toBeNull();
  });

  it('collapses a Go nil-slice envelope (JSON null) to [] instead of crashing', () => {
    // Mirrors the hook selects on an empty/absent body: `safeArray(resp?.months)`.
    const empty = null as unknown as MonthlyMileageResponse | null | undefined;
    expect(safeArray<MonthlyMileageBucket>(empty?.months)).toEqual([]);
    expect(safeArray<DailyMileageBucket>(empty?.days)).toEqual([]);
    expect(safeArray<TimelineEvent>(undefined)).toEqual([]);
    expect(safeArray<StateSummary>(null)).toEqual([]);
  });
});
