/**
 * energy — contract tests for the battery & energy domain view-models.
 *
 * This module is *type-only*: every export is an `interface`, erased at
 * runtime. A smoke render proves nothing, so — following the repo convention
 * for type modules (see features/charging/components/charging-curve/types.test.ts
 * and features/automations/components/stepInputTypes.test.ts) — this suite
 * enforces the contracts on two levels:
 *
 *   • Runtime (`expect`)      — the *shape + producer contract*. Fixtures are
 *     built the way real consumers build/read them (null-safe combined charge
 *     power like EnergyFlowPage, pack-imbalance millivolts like the
 *     batterycells handler, `degradation = 100 - health` like the battery
 *     handler), so the assertions verify real domain relationships rather than
 *     hand-typed echoes. Optional/nullable branches are exercised explicitly.
 *   • Compile-time (`expectTypeOf`) — the *type identities*: each export equals
 *     its documented shape, `| null` unions and the `stress_level` literal
 *     union are preserved, and optional keys stay optional. These are runtime
 *     no-ops; the production `tsc --noEmit` gate enforces them.
 *
 * The field names + units mirror the current Go handler JSON wire contract
 * (verified against internal/api/{energy,battery,batterycells,batterydegradation,
 * energyflow,rangeproj,sleep} and internal/service/energy_service.go). No
 * network, no DOM — pure structural assertions, so no MSW/QueryClient harness.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  EnergyStats,
  DailyEnergy,
  BatteryHealth,
  MonthlyTrend,
  BatteryCell,
  BatteryCellSummary,
  DegradationData,
  DegradationTrend,
  DegradationPrediction,
  ChargingHabits,
  PredictiveProjection,
  RiskFactorData,
  BatteryHealthAnalytics,
  BatteryHealthSnapshot,
  EnergyFlowData,
  VampireDrainStats,
  VampireDrainEvent,
  ProjectedRangeData,
  SleepEfficiencyData,
  SleepDrainEvent,
  TeslaEnergyHistoryEntry,
  TeslaBackupEvent,
  TeslaWCChargingEntry,
  TeslaEnergySite,
  TeslaEnergySiteInfo,
  TeslaEnergySiteInfoResponse,
  TeslaEnergyLiveStatus,
  TOUSettingsPayload,
  TariffContentV2,
  TOUPreset,
} from './energy';

// ── Real consumer-mirroring derivations (so assertions test math, not echoes) ──

/** Mirrors EnergyFlowPage.computeChargePower — null-safe AC + DC total. */
const combinedChargePower = (f: EnergyFlowData): number =>
  (f.dc_charging_power ?? 0) + (f.ac_charging_power ?? 0);

/** Mirrors the batterycells handler: pack imbalance in millivolts (V → mV). */
const voltageSpreadMv = (maxV: number, minV: number): number => (maxV - minV) * 1000;

/** Mirrors the battery/rangeproj handlers: degradation is the health complement. */
const degradationFromHealth = (healthScore: number): number => 100 - healthScore;

// ── EnergyStats + DailyEnergy ─────────────────────────────────────────────────

describe('EnergyStats & DailyEnergy', () => {
  const days: DailyEnergy[] = [
    { date: '2024-01-01', energy_wh: 12_000, cost: 1.5, distance_m: 60_000, efficiency_wh_per_m: 0.2 },
    { date: '2024-01-02', energy_wh: 18_000, cost: 2.25, distance_m: 90_000, efficiency_wh_per_m: 0.2 },
  ];
  const totalEnergy = days.reduce((s, d) => s + d.energy_wh, 0); // 30_000 Wh
  const totalDistance = days.reduce((s, d) => s + d.distance_m, 0); // 150_000 m

  const stats: EnergyStats = {
    vehicle_id: 7,
    period_days: 30,
    total_energy_used_wh: totalEnergy,
    total_energy_charged_wh: totalEnergy,
    total_wh: totalEnergy,
    total_cost: days.reduce((s, d) => s + d.cost, 0),
    total_distance_m: totalDistance,
    avg_efficiency_wh_per_m: totalEnergy / totalDistance,
    co2_saved_kg: 5.4,
    daily_breakdown: days,
  };

  it('echoes one TotalEnergy figure across the three legacy energy keys', () => {
    // The handler intentionally points total_energy_used_wh / _charged_wh /
    // total_wh at the same service.EnergyStats.TotalEnergy value.
    expect(stats.total_energy_used_wh).toBe(totalEnergy);
    expect(stats.total_energy_charged_wh).toBe(stats.total_energy_used_wh);
    expect(stats.total_wh).toBe(stats.total_energy_used_wh);
  });

  it('keeps SI efficiency consistent with energy / distance and daily aggregation', () => {
    expect(stats.avg_efficiency_wh_per_m).toBeCloseTo(0.2, 10);
    expect(stats.avg_efficiency_wh_per_m).toBeCloseTo(totalEnergy / totalDistance, 10);
    // total_wh is the sum of the daily breakdown — a real aggregation invariant.
    expect(stats.daily_breakdown.reduce((s, d) => s + d.energy_wh, 0)).toBe(stats.total_wh);
    expect(stats.daily_breakdown).toHaveLength(2);
    expect(stats.co2_saved_kg).toBeGreaterThanOrEqual(0);
  });

  it('treats vehicle_id / period_days as optional echo fields', () => {
    // Callers that don't request them (analytics view) omit both entirely.
    const minimal: EnergyStats = {
      total_energy_used_wh: 0,
      total_energy_charged_wh: 0,
      total_wh: 0,
      total_cost: 0,
      total_distance_m: 0,
      avg_efficiency_wh_per_m: 0,
      co2_saved_kg: 0,
      daily_breakdown: [],
    };
    expect(minimal.vehicle_id).toBeUndefined();
    expect(minimal.period_days).toBeUndefined();
    expect(minimal.daily_breakdown).toEqual([]);
    expectTypeOf<EnergyStats['vehicle_id']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<EnergyStats['period_days']>().toEqualTypeOf<number | undefined>();
  });

  it('locks the DailyEnergy element shape (all SI)', () => {
    expect(Object.keys(days[0]).sort()).toEqual([
      'cost',
      'date',
      'distance_m',
      'efficiency_wh_per_m',
      'energy_wh',
    ]);
    expectTypeOf<DailyEnergy>().toEqualTypeOf<{
      date: string;
      energy_wh: number;
      cost: number;
      distance_m: number;
      efficiency_wh_per_m: number;
    }>();
    expectTypeOf<EnergyStats['daily_breakdown']>().toEqualTypeOf<DailyEnergy[]>();
  });
});

// ── BatteryHealth + MonthlyTrend ──────────────────────────────────────────────

describe('BatteryHealth & MonthlyTrend', () => {
  const trend: MonthlyTrend[] = [
    { month: '2024-01', capacity_pct: 96, range_km: 480 },
    { month: '2024-02', capacity_pct: 95, range_km: 475 },
  ];
  const health: BatteryHealth = {
    health_score: 95,
    degradation_pct: degradationFromHealth(95),
    current_capacity_pct: 95,
    total_cycles: 320,
    estimated_range_current_km: 475,
    estimated_range_new_km: 500,
    monthly_trend: trend,
  };

  it('derives degradation as the complement of health and echoes capacity', () => {
    expect(health.degradation_pct).toBe(100 - health.health_score);
    expect(health.degradation_pct).toBe(5);
    // The battery handler points current_capacity_pct at the same healthScore.
    expect(health.current_capacity_pct).toBe(health.health_score);
  });

  it('keeps the degraded current range below the nominal (new) range', () => {
    expect(health.estimated_range_current_km).toBeLessThan(health.estimated_range_new_km);
    expect(health.degradation_pct).toBeGreaterThanOrEqual(0);
    expect(health.degradation_pct).toBeLessThanOrEqual(100);
    expect(health.total_cycles).toBeGreaterThan(0);
  });

  it('locks the MonthlyTrend element shape', () => {
    expect(health.monthly_trend).toHaveLength(2);
    expect(Object.keys(trend[0]).sort()).toEqual(['capacity_pct', 'month', 'range_km']);
    expectTypeOf<MonthlyTrend>().toEqualTypeOf<{
      month: string;
      capacity_pct: number;
      range_km: number;
    }>();
  });
});

// ── BatteryCell + BatteryCellSummary ──────────────────────────────────────────

describe('BatteryCell & BatteryCellSummary', () => {
  const cells: BatteryCell[] = [
    { cell_id: 1, module: 1, voltage: 3.9, temperature: 24 },
    { cell_id: 2, module: 1, voltage: 3.95, temperature: 25 },
    { cell_id: 3, module: 2, voltage: 3.88, temperature: 23 },
  ];
  const voltages = cells.map((c) => c.voltage);
  const minV = Math.min(...voltages);
  const maxV = Math.max(...voltages);
  const summary: BatteryCellSummary = {
    total_cells: cells.length,
    avg_voltage: (minV + maxV) / 2,
    min_voltage: minV,
    max_voltage: maxV,
    voltage_spread: voltageSpreadMv(maxV, minV),
    avg_temperature: 24,
    min_temperature: 23,
    max_temperature: 25,
    temp_spread: 2,
    cells,
  };

  it('reports voltage spread as (max - min) in millivolts', () => {
    expect(summary.voltage_spread).toBeCloseTo((maxV - minV) * 1000, 6);
    expect(summary.voltage_spread).toBeCloseTo(70, 6); // 3.95 → 3.88 = 0.07 V
    expect(summary.max_voltage).toBeGreaterThanOrEqual(summary.min_voltage);
  });

  it('keeps temp spread and total_cells consistent with the cell array', () => {
    expect(summary.temp_spread).toBe(summary.max_temperature - summary.min_temperature);
    expect(summary.total_cells).toBe(summary.cells.length);
    expect(summary.cells).toHaveLength(3);
  });

  it('locks the BatteryCell element shape', () => {
    expect(Object.keys(cells[0]).sort()).toEqual(['cell_id', 'module', 'temperature', 'voltage']);
    expectTypeOf<BatteryCell>().toEqualTypeOf<{
      cell_id: number;
      module: number;
      voltage: number;
      temperature: number;
    }>();
    expectTypeOf<BatteryCellSummary['cells']>().toEqualTypeOf<BatteryCell[]>();
  });
});

// ── DegradationData family ────────────────────────────────────────────────────

describe('DegradationData & its nested view-models', () => {
  const habits: ChargingHabits = {
    fast_charge_count: 12,
    slow_charge_count: 40,
    deep_discharge_count: 3,
    charge_to_full_count: 8,
    high_soc_count: 5,
    total_count: 52,
  };
  const trend: DegradationTrend[] = [
    { month: '2024-01', avg_health: 96, avg_capacity: 96, avg_range: 480 },
    { month: '2024-02', avg_health: 95, avg_capacity: 95, avg_range: 475 },
  ];
  const prediction: DegradationPrediction = {
    has_enough_data: true,
    slope_per_year: -2.5,
    years_to_80_pct: 6,
    predicted_date: '2030-02-01',
    projection_points: [
      { month: '2024-03', health: 94.8 },
      { month: '2024-04', health: 94.6 },
    ],
  };
  const projections: PredictiveProjection[] = [
    { date: '2024-06-01', health_pct: 94, confidence_low: 92, confidence_high: 96 },
    { date: '2025-06-01', health_pct: 91, confidence_low: 88, confidence_high: 94 },
  ];
  const riskFactors: RiskFactorData[] = [
    { name: 'fast_charging', score: 30, label: 'Moderate', detail: 'Supercharger use elevated' },
    { name: 'thermal', score: 10, label: 'Low', detail: 'Temperatures nominal' },
  ];

  const degradation: DegradationData = {
    current_health: 95,
    current_capacity: 71.25,
    current_cycles: 320,
    current_range: 475,
    current_temp: 24,
    stress_level: 'Medium',
    fast_charge_ratio: 0.23,
    snapshots: [],
    monthly_trend: trend,
    prediction,
    charging_habits: habits,
    current_health_pct: 95,
    degradation_rate_pct_per_month: 0.2,
    projected_80pct_date: '2030-02-01',
    projections,
    risk_factors: riskFactors,
    recommendations: ['Charge to 80% for daily use', 'Avoid deep discharges below 10%'],
  };

  it('carries every predictive slice with array + nullable branch fields', () => {
    expect(degradation.current_health_pct).toBe(degradation.current_health);
    expect(degradation.monthly_trend).toHaveLength(2);
    expect(degradation.projections).toHaveLength(2);
    expect(degradation.risk_factors).toHaveLength(2);
    expect(degradation.recommendations).toContain('Charge to 80% for daily use');
    expect(degradation.snapshots).toEqual([]);
    expect(degradation.prediction).not.toBeNull();
    expect(degradation.charging_habits).not.toBeNull();
  });

  it('constrains stress_level to the Low | Medium | High literal union', () => {
    const levels: DegradationData['stress_level'][] = ['Low', 'Medium', 'High'];
    expect(levels).toContain(degradation.stress_level);
    expectTypeOf<DegradationData['stress_level']>().toEqualTypeOf<'Low' | 'Medium' | 'High'>();
  });

  it('allows prediction / charging_habits / projected_80pct_date to be null (no history)', () => {
    const empty: DegradationData = {
      ...degradation,
      stress_level: 'Low',
      prediction: null,
      charging_habits: null,
      projected_80pct_date: null,
      snapshots: [],
      monthly_trend: [],
      projections: [],
      risk_factors: [],
      recommendations: [],
    };
    expect(empty.prediction).toBeNull();
    expect(empty.charging_habits).toBeNull();
    expect(empty.projected_80pct_date).toBeNull();
    expectTypeOf<DegradationData['prediction']>().toEqualTypeOf<DegradationPrediction | null>();
    expectTypeOf<DegradationData['charging_habits']>().toEqualTypeOf<ChargingHabits | null>();
    expectTypeOf<DegradationData['projected_80pct_date']>().toEqualTypeOf<string | null>();
  });

  it('ChargingHabits total_count bounds each categorized bucket', () => {
    expect(habits.total_count).toBeGreaterThanOrEqual(habits.fast_charge_count);
    expect(habits.total_count).toBeGreaterThanOrEqual(habits.slow_charge_count);
    expect(habits.fast_charge_count + habits.slow_charge_count).toBeLessThanOrEqual(habits.total_count);
    expectTypeOf<ChargingHabits>().toEqualTypeOf<{
      fast_charge_count: number;
      slow_charge_count: number;
      deep_discharge_count: number;
      charge_to_full_count: number;
      high_soc_count: number;
      total_count: number;
    }>();
  });

  it('DegradationPrediction pairs a slope with month/health projection points', () => {
    expect(prediction.has_enough_data).toBe(true);
    expect(prediction.slope_per_year).toBeLessThan(0); // health decays over time
    expect(prediction.projection_points[0]).toEqual({ month: '2024-03', health: 94.8 });
    expect(prediction.predicted_date).toBe('2030-02-01');
    expectTypeOf<DegradationPrediction['predicted_date']>().toEqualTypeOf<string | null>();
    expectTypeOf<DegradationPrediction['projection_points']>().toEqualTypeOf<
      { month: string; health: number }[]
    >();
  });

  it('PredictiveProjection keeps health_pct inside its confidence band', () => {
    for (const p of projections) {
      expect(p.confidence_low).toBeLessThanOrEqual(p.health_pct);
      expect(p.health_pct).toBeLessThanOrEqual(p.confidence_high);
    }
    expectTypeOf<PredictiveProjection>().toEqualTypeOf<{
      date: string;
      health_pct: number;
      confidence_low: number;
      confidence_high: number;
    }>();
  });

  it('RiskFactorData + DegradationTrend lock their element shapes', () => {
    expect(riskFactors.map((r) => r.name)).toEqual(['fast_charging', 'thermal']);
    expect(riskFactors[0].score).toBeGreaterThan(riskFactors[1].score);
    expect(Object.keys(trend[0]).sort()).toEqual(['avg_capacity', 'avg_health', 'avg_range', 'month']);
    expectTypeOf<RiskFactorData>().toEqualTypeOf<{
      name: string;
      score: number;
      label: string;
      detail: string;
    }>();
    expectTypeOf<DegradationTrend>().toEqualTypeOf<{
      month: string;
      avg_health: number;
      avg_capacity: number;
      avg_range: number;
    }>();
    // snapshots is intentionally loose (raw backend rows the SPA does not read).
    expectTypeOf<DegradationData['snapshots']>().toEqualTypeOf<unknown[]>();
  });
});

// ── BatteryHealthAnalytics + BatteryHealthSnapshot ────────────────────────────

describe('BatteryHealthAnalytics & BatteryHealthSnapshot', () => {
  const history: BatteryHealthSnapshot[] = [
    { date: '2023-01-01', odometer: 10_000, soh_pct: 99, capacity_wh: 74_250, range_km: 495 },
    { date: '2024-01-01', odometer: 30_000, soh_pct: 95, capacity_wh: 71_250, range_km: 475 },
  ];
  const analytics: BatteryHealthAnalytics = {
    current_soh: 95,
    estimated_capacity: 71_250,
    original_capacity: 75_000,
    degradation_rate_yr: 4,
    battery_age_months: 12,
    total_cycles: 320,
    avg_depth_of_discharge: 55,
    fast_charge_pct: 23,
    full_charge_pct: 8,
    charge_habits_score: 82,
    temp_exposure_score: 90,
    history,
  };

  it('keeps estimated capacity below original and SOH ≈ their ratio', () => {
    expect(analytics.estimated_capacity).toBeLessThan(analytics.original_capacity);
    const ratioPct = (analytics.estimated_capacity / analytics.original_capacity) * 100;
    expect(analytics.current_soh).toBeCloseTo(ratioPct, 0); // 71250/75000 = 95%
  });

  it('bounds percentage metrics to [0, 100] and exposes a snapshot history', () => {
    for (const pct of [analytics.current_soh, analytics.fast_charge_pct, analytics.full_charge_pct]) {
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
    expect(analytics.history).toHaveLength(2);
    // SOH declines while odometer climbs across the history window.
    expect(analytics.history[1].soh_pct).toBeLessThan(analytics.history[0].soh_pct);
    expect(analytics.history[1].odometer).toBeGreaterThan(analytics.history[0].odometer);
  });

  it('locks the BatteryHealthSnapshot element shape', () => {
    expect(Object.keys(history[0]).sort()).toEqual([
      'capacity_wh',
      'date',
      'odometer',
      'range_km',
      'soh_pct',
    ]);
    expectTypeOf<BatteryHealthSnapshot>().toEqualTypeOf<{
      date: string;
      odometer: number;
      soh_pct: number;
      capacity_wh: number;
      range_km: number;
    }>();
    expectTypeOf<BatteryHealthAnalytics['history']>().toEqualTypeOf<BatteryHealthSnapshot[]>();
  });
});

// ── EnergyFlowData — the fully-nullable live snapshot ─────────────────────────

describe('EnergyFlowData', () => {
  it('sums AC + DC charge power null-safely (active DC session)', () => {
    const flow: EnergyFlowData = {
      dc_charging_power: 48.5,
      ac_charging_power: null,
      energy_remaining: 62.3,
      pack_voltage: 380,
      pack_current: 128,
      soc: 72,
      charge_state: 'Charging',
    };
    expect(combinedChargePower(flow)).toBeCloseTo(48.5, 6); // null AC contributes 0
    expect(flow.charge_state).toBe('Charging');
  });

  it('collapses an all-null (parked, no telemetry) snapshot to zero power', () => {
    const idle: EnergyFlowData = {
      dc_charging_power: null,
      ac_charging_power: null,
      energy_remaining: null,
      pack_voltage: null,
      pack_current: null,
      soc: null,
      charge_state: null,
    };
    expect(combinedChargePower(idle)).toBe(0);
    expect(Number.isNaN(combinedChargePower(idle))).toBe(false);
    expect(idle.soc).toBeNull();
  });

  it('locks the fully-nullable wire shape', () => {
    expectTypeOf<EnergyFlowData>().toEqualTypeOf<{
      dc_charging_power: number | null;
      ac_charging_power: number | null;
      energy_remaining: number | null;
      pack_voltage: number | null;
      pack_current: number | null;
      soc: number | null;
      charge_state: string | null;
    }>();
  });
});

// ── VampireDrainStats + VampireDrainEvent (deprecated route, shape preserved) ──

describe('VampireDrainStats & VampireDrainEvent', () => {
  const stats: VampireDrainStats = {
    avg_drain_rate: 1.2,
    total_range_lost: 45,
    total_hours: 200,
    event_count: 14,
    avg_sentry_drain: 2.1,
    avg_nosentry_drain: 0.8,
  };

  it('shows sentry-mode drain exceeding non-sentry drain', () => {
    expect(stats.avg_sentry_drain).toBeGreaterThan(stats.avg_nosentry_drain);
    expect(stats.event_count).toBeGreaterThan(0);
    expectTypeOf<VampireDrainStats>().toEqualTypeOf<{
      avg_drain_rate: number;
      total_range_lost: number;
      total_hours: number;
      event_count: number;
      avg_sentry_drain: number;
      avg_nosentry_drain: number;
    }>();
  });

  it('allows a VampireDrainEvent with a null outside temperature', () => {
    const event: VampireDrainEvent = {
      id: 1,
      start_date: '2024-01-01T00:00:00Z',
      duration_hours: 8,
      battery_lost: 3,
      drain_rate_pct_per_hour: 0.375,
      outside_temp_avg: null,
      sentry_mode: true,
    };
    expect(event.sentry_mode).toBe(true);
    expect(event.outside_temp_avg).toBeNull();
    expect(event.drain_rate_pct_per_hour).toBeCloseTo(event.battery_lost / event.duration_hours, 6);
    expectTypeOf<VampireDrainEvent['outside_temp_avg']>().toEqualTypeOf<number | null>();
    expectTypeOf<VampireDrainEvent['sentry_mode']>().toEqualTypeOf<boolean>();
  });
});

// ── ProjectedRangeData ────────────────────────────────────────────────────────

describe('ProjectedRangeData', () => {
  const proj: ProjectedRangeData = {
    current_range_km: 475,
    new_range_km: 500,
    degradation_pct: degradationFromHealth(95),
    total_cycles: 320,
    health_score: 95,
    current_capacity_pct: 95,
    avg_daily_km: 42,
  };

  it('keeps current range below new range and degradation = 100 - health', () => {
    expect(proj.current_range_km).toBeLessThan(proj.new_range_km);
    expect(proj.degradation_pct).toBe(100 - proj.health_score);
    expect(proj.current_capacity_pct).toBe(proj.health_score);
    expect(proj.avg_daily_km).toBeGreaterThan(0);
  });

  it('locks the projected-range shape', () => {
    expectTypeOf<ProjectedRangeData>().toEqualTypeOf<{
      current_range_km: number;
      new_range_km: number;
      degradation_pct: number;
      total_cycles: number;
      health_score: number;
      current_capacity_pct: number;
      avg_daily_km: number;
    }>();
  });
});

// ── SleepEfficiencyData + SleepDrainEvent ─────────────────────────────────────

describe('SleepEfficiencyData & SleepDrainEvent', () => {
  const recent: SleepDrainEvent[] = [
    {
      id: 1,
      start_date: '2024-01-01T22:00:00Z',
      end_date: '2024-01-02T06:00:00Z',
      duration_hours: 8,
      battery_lost: 2,
      drain_rate: 0.25,
      sentry_mode: false,
      outside_temp: 12,
      start_battery: 80,
      end_battery: 78,
    },
    {
      id: 2,
      start_date: '2024-01-02T22:00:00Z',
      end_date: '2024-01-03T06:00:00Z',
      duration_hours: 8,
      battery_lost: 5,
      drain_rate: 0.625,
      sentry_mode: true,
      outside_temp: null,
      start_battery: 78,
      end_battery: 73,
    },
  ];
  const sleep: SleepEfficiencyData = {
    vehicle_id: 7,
    period_days: 30,
    sleep_efficiency_pct: 60,
    time_to_sleep_avg_min: 22,
    sentry_on_drain_rate: 0.625,
    sentry_off_drain_rate: 0.25,
    sentry_monthly_cost: 4.5,
    sentry_monthly_kwh: 12,
    sentry_extra_drain_rate: 0.375, // on - off
    sentry_extra_monthly_kwh: 7.2,
    sentry_extra_monthly_cost: 2.7,
    state_distribution: [
      { state: 'asleep', count: 12, total_minutes: 600 },
      { state: 'awake', count: 8, total_minutes: 400 },
    ],
    sentry_comparison: [
      {
        sentry_mode: false,
        count: 4,
        avg_drain_rate: 0.25,
        avg_duration_hours: 8,
        avg_battery_lost: 2,
        avg_temp: 12,
      },
      {
        sentry_mode: true,
        count: 5,
        avg_drain_rate: 0.625,
        avg_duration_hours: 8,
        avg_battery_lost: 5,
        avg_temp: 10,
      },
    ],
    battery_capacity_wh: 75_000,
    capacity_source: 'vin_estimate',
    base_cost_per_kwh: 0.12,
    recent_events: recent,
    total_events: 2,
    avg_sentry_duration_hours: 8,
  };

  it('derives the sentry extra drain rate as on - off and bounds efficiency', () => {
    expect(sleep.sentry_extra_drain_rate ?? 0).toBeCloseTo(
      (sleep.sentry_on_drain_rate ?? 0) - (sleep.sentry_off_drain_rate ?? 0),
      6,
    );
    expect(sleep.sleep_efficiency_pct ?? -1).toBeGreaterThanOrEqual(0);
    expect(sleep.sleep_efficiency_pct ?? 101).toBeLessThanOrEqual(100);
    expect(sleep.sentry_on_drain_rate ?? 0).toBeGreaterThan(
      sleep.sentry_off_drain_rate ?? 0,
    );
  });

  it('exposes typed state_distribution / sentry_comparison / recent_events arrays', () => {
    expect(
      (sleep.state_distribution ?? []).reduce(
        (sum, entry) => sum + (entry.total_minutes ?? 0),
        0,
      ),
    ).toBe(1000);
    expect(sleep.sentry_comparison ?? []).toHaveLength(2);
    expect((sleep.sentry_comparison ?? [])[1]?.sentry_mode).toBe(true);
    expect(sleep.recent_events ?? []).toHaveLength(2);
    expectTypeOf<SleepEfficiencyData['state_distribution']>().toEqualTypeOf<
      | {
          state?: string | null;
          count?: number | null;
          total_minutes?: number | null;
        }[]
      | null
      | undefined
    >();
    expectTypeOf<SleepEfficiencyData['recent_events']>().toEqualTypeOf<
      SleepDrainEvent[] | null | undefined
    >();
  });

  it('SleepDrainEvent includes endpoint timestamps and battery levels defensively', () => {
    expect(recent[0].outside_temp).toBe(12);
    expect(recent[1].outside_temp).toBeNull();
    expect(recent[1].sentry_mode).toBe(true);
    expect(recent[0].end_date).toBe('2024-01-02T06:00:00Z');
    expect(recent[0].start_battery).toBe(80);
    expectTypeOf<SleepDrainEvent['outside_temp']>().toEqualTypeOf<
      number | null | undefined
    >();
    expectTypeOf<SleepDrainEvent>().toEqualTypeOf<{
      id?: number | null;
      start_date?: string | null;
      end_date?: string | null;
      duration_hours?: number | null;
      battery_lost?: number | null;
      drain_rate?: number | null;
      sentry_mode?: boolean | null;
      outside_temp?: number | null;
      start_battery?: number | null;
      end_battery?: number | null;
    }>();
  });
});

// ── Tesla Energy Site history entries ─────────────────────────────────────────

describe('Tesla energy-site history entries', () => {
  it('TeslaEnergyHistoryEntry keeps every metered energy field nullable', () => {
    const entry: TeslaEnergyHistoryEntry = {
      id: 1,
      energy_site_id: 100,
      period: 'day',
      timestamp: '2024-01-01T00:00:00Z',
      solar_energy_wh: 25_000,
      battery_energy_in_wh: 5_000,
      battery_energy_out_wh: 4_800,
      grid_energy_in_wh: 3_000,
      grid_energy_out_wh: null,
      consumer_energy_wh: 30_000,
      fetched_at: '2024-01-02T00:00:00Z',
    };
    expect(entry.grid_energy_out_wh).toBeNull();
    expect(entry.solar_energy_wh).toBe(25_000);
    // battery round-trip loss is non-negative (in ≥ out).
    expect((entry.battery_energy_in_wh ?? 0) - (entry.battery_energy_out_wh ?? 0)).toBeGreaterThanOrEqual(0);
    expectTypeOf<TeslaEnergyHistoryEntry['solar_energy_wh']>().toEqualTypeOf<number | null>();
    expectTypeOf<TeslaEnergyHistoryEntry['consumer_energy_wh']>().toEqualTypeOf<number | null>();
  });

  it('TeslaBackupEvent carries a numeric outage duration', () => {
    const backup: TeslaBackupEvent = {
      id: 2,
      energy_site_id: 100,
      period: 'day',
      timestamp: '2024-01-03T18:00:00Z',
      duration_seconds: 3_600,
      fetched_at: '2024-01-03T19:00:00Z',
    };
    expect(backup.duration_seconds).toBe(3_600);
    expect(backup.duration_seconds).toBeGreaterThan(0);
    expectTypeOf<TeslaBackupEvent>().toEqualTypeOf<{
      id: number;
      energy_site_id: number;
      period: string;
      timestamp: string;
      duration_seconds: number;
      fetched_at: string;
    }>();
  });

  it('TeslaWCChargingEntry allows null din and null energy', () => {
    const withDin: TeslaWCChargingEntry = {
      id: 3,
      energy_site_id: 100,
      din: '1234567-00-A--ABC',
      timestamp: '2024-01-04T08:00:00Z',
      energy_wh: 6_400,
      fetched_at: '2024-01-04T09:00:00Z',
    };
    const anonymous: TeslaWCChargingEntry = { ...withDin, din: null, energy_wh: null };
    expect(withDin.din).toContain('1234567');
    expect(anonymous.din).toBeNull();
    expect(anonymous.energy_wh).toBeNull();
    expectTypeOf<TeslaWCChargingEntry['din']>().toEqualTypeOf<string | null>();
    expectTypeOf<TeslaWCChargingEntry['energy_wh']>().toEqualTypeOf<number | null>();
  });
});

// ── TeslaEnergySite (product) ─────────────────────────────────────────────────

describe('TeslaEnergySite', () => {
  const site: TeslaEnergySite = {
    id: 1,
    energy_site_id: 100,
    resource_type: 'battery',
    site_name: 'Home',
    gateway_id: 'GW-123',
    total_pack_energy: 27_000,
    percentage_charged: 80,
    battery_type: 'powerwall',
    backup_capable: true,
    storm_mode_enabled: false,
    has_solar: true,
    has_battery: true,
    has_grid: true,
    has_load_meter: true,
    tou_capable: true,
    storm_mode_capable: true,
    fetched_at: '2024-01-01T00:00:00Z',
    created_at: '2023-06-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    site_info_fetched_at: null,
  };

  it('exposes boolean capability flags and nullable numeric/site fields', () => {
    expect(site.has_solar && site.has_battery).toBe(true);
    expect(site.backup_capable).toBe(true);
    expect(site.percentage_charged).toBeGreaterThanOrEqual(0);
    expect(site.site_info_fetched_at).toBeNull();
    expectTypeOf<TeslaEnergySite['gateway_id']>().toEqualTypeOf<string | null>();
    expectTypeOf<TeslaEnergySite['total_pack_energy']>().toEqualTypeOf<number | null>();
    expectTypeOf<TeslaEnergySite['backup_capable']>().toEqualTypeOf<boolean>();
    expectTypeOf<TeslaEnergySite['site_info_fetched_at']>().toEqualTypeOf<string | null>();
  });

  it('permits a bare site with all optional-signal fields nulled out', () => {
    const bare: TeslaEnergySite = {
      ...site,
      gateway_id: null,
      total_pack_energy: null,
      percentage_charged: null,
      battery_type: null,
      has_solar: false,
      has_battery: false,
    };
    expect(bare.gateway_id).toBeNull();
    expect(bare.total_pack_energy).toBeNull();
    expect(bare.has_solar).toBe(false);
  });
});

// ── TeslaEnergySiteInfo (+ response envelope) ─────────────────────────────────

describe('TeslaEnergySiteInfo & TeslaEnergySiteInfoResponse', () => {
  it('treats every field as optional and honours the open index signature', () => {
    const info: TeslaEnergySiteInfo = {
      site_name: 'Home',
      backup_reserve_percent: 20,
      default_real_mode: 'self_consumption',
      battery_count: 2,
      nameplate_power: 10_000,
      nameplate_energy: 27_000,
      components: {
        solar: true,
        battery: true,
        grid: true,
        load_meter: true,
        tou_capable: true,
        storm_mode_capable: true,
        // index signature on components allows unknown extra keys
        wall_connectors: 1,
      },
      // top-level index signature allows unknown extra keys
      installation_date: '2023-06-01',
    };
    expect(info.backup_reserve_percent).toBe(20);
    expect(info.components?.solar).toBe(true);
    expect(info['installation_date']).toBe('2023-06-01');
    // A completely empty object still satisfies the interface (all optional).
    const empty: TeslaEnergySiteInfo = {};
    expect(Object.keys(empty)).toHaveLength(0);
    expectTypeOf<TeslaEnergySiteInfo['site_name']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<TeslaEnergySiteInfo['battery_count']>().toEqualTypeOf<number | undefined>();
  });

  it('wraps a nullable data payload with a nullable fetched_at in the response', () => {
    const loaded: TeslaEnergySiteInfoResponse = {
      data: { site_name: 'Home', battery_count: 1 },
      fetched_at: '2024-01-01T00:00:00Z',
    };
    const missing: TeslaEnergySiteInfoResponse = { data: null, fetched_at: null };
    expect(loaded.data?.site_name).toBe('Home');
    expect(missing.data).toBeNull();
    expect(missing.fetched_at).toBeNull();
    expectTypeOf<TeslaEnergySiteInfoResponse['data']>().toEqualTypeOf<TeslaEnergySiteInfo | null>();
    expectTypeOf<TeslaEnergySiteInfoResponse['fetched_at']>().toEqualTypeOf<string | null>();
  });
});

// ── TeslaEnergyLiveStatus (power-flow snapshot) ───────────────────────────────

describe('TeslaEnergyLiveStatus', () => {
  const live: TeslaEnergyLiveStatus = {
    id: 1,
    energy_site_id: 100,
    solar_power: 3_500,
    battery_power: -1_200,
    load_power: 2_300,
    grid_power: 0,
    grid_services_power: null,
    energy_left: 21_600,
    total_pack_energy: 27_000,
    percentage_charged: 80,
    grid_status: 'Active',
    backup_capable: true,
    storm_mode_active: false,
    timestamp: '2024-01-01T12:00:00Z',
    fetched_at: '2024-01-01T12:00:05Z',
  };

  it('keeps energy_left within pack capacity and reports a matching charge %', () => {
    expect(live.energy_left ?? 0).toBeLessThanOrEqual(live.total_pack_energy ?? 0);
    const pct = ((live.energy_left ?? 0) / (live.total_pack_energy ?? 1)) * 100;
    expect(live.percentage_charged).toBeCloseTo(pct, 0); // 21600/27000 = 80%
    expect(live.grid_services_power).toBeNull();
  });

  it('marks raw_json optional and every power channel + status flag nullable', () => {
    // raw_json is the only optional key; a snapshot without it is still valid.
    expect('raw_json' in live).toBe(false);
    expectTypeOf<TeslaEnergyLiveStatus['raw_json']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<TeslaEnergyLiveStatus['solar_power']>().toEqualTypeOf<number | null>();
    expectTypeOf<TeslaEnergyLiveStatus['grid_status']>().toEqualTypeOf<string | null>();
    expectTypeOf<TeslaEnergyLiveStatus['storm_mode_active']>().toEqualTypeOf<boolean | null>();
  });
});

// ── Time-of-Use settings payload + preset ─────────────────────────────────────

describe('TOUSettingsPayload, TariffContentV2 & TOUPreset', () => {
  const tariff: TariffContentV2 = {
    name: 'TOU-D-PRIME',
    utility: 'SCE',
    daily_charges: [{ amount: 0.03, name: 'Basic Charge' }],
    demand_charges: { Summer: { Peak: 12.5 } },
    energy_charges: {
      Summer: { Peak: [{ rate: 0.45, start: 16, end: 21 }] },
    },
    seasons: {
      Summer: { fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30 },
    },
  };
  const payload: TOUSettingsPayload = {
    tou_settings: {
      optimization_strategy: 'economics',
      tariff_content_v2: tariff,
    },
  };

  it('nests a TariffContentV2 under tou_settings with typed rate structures', () => {
    expect(payload.tou_settings.optimization_strategy).toBe('economics');
    expect(payload.tou_settings.tariff_content_v2?.utility).toBe('SCE');
    expect(tariff.daily_charges?.[0].amount).toBeCloseTo(0.03, 6);
    expect(tariff.energy_charges?.Summer.Peak[0].rate).toBeCloseTo(0.45, 6);
    expect(tariff.seasons?.Summer.fromMonth).toBe(6);
  });

  it('allows unknown extra keys via the open index signatures', () => {
    const extended: TOUSettingsPayload = {
      tou_settings: {
        optimization_strategy: 'economics',
        // index signature on tou_settings permits unknown vendor keys
        alt_prices: true,
      },
    };
    expect(extended.tou_settings['alt_prices']).toBe(true);
    // A minimal tariff (everything optional) is still assignable.
    const minimalTariff: TariffContentV2 = {};
    expect(Object.keys(minimalTariff)).toHaveLength(0);
    expectTypeOf<TOUSettingsPayload['tou_settings']['tariff_content_v2']>().toEqualTypeOf<
      TariffContentV2 | undefined
    >();
  });

  it('TOUPreset wraps a full TOUSettingsPayload with UI metadata', () => {
    const preset: TOUPreset = {
      id: 'sce-tou-d-prime',
      name: 'SCE TOU-D-PRIME',
      utility: 'SCE',
      settings: payload,
    };
    expect(preset.settings.tou_settings.tariff_content_v2).toBe(tariff);
    expect(preset.id).toBe('sce-tou-d-prime');
    expect(Object.keys(preset).sort()).toEqual(['id', 'name', 'settings', 'utility']);
    expectTypeOf<TOUPreset['settings']>().toEqualTypeOf<TOUSettingsPayload>();
  });
});
