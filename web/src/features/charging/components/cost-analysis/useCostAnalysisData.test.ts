/**
 * useCostAnalysisData — the Cost Analysis page's derivation hook.
 *
 * This hook is pure (a stack of `useMemo`s over the raw ChargingSession list),
 * so the suite drives it with `renderHook` and asserts the eight derived
 * outputs it returns — no DOM, network, or provider required.
 *
 * Beyond the happy path it pins the four correctness bugs this file fixed, each
 * chosen so the assertion FAILS loudly against the pre-fix code:
 *   - coreStats.costPerDist / gasComparison.costPer* converted distance twice
 *     (metres→miles then metres→display), inflating the per-distance figures
 *     ~1609×. `toDistanceDisplay` now receives raw SI metres exactly once.
 *   - lifetimeMetrics.freeEnergy summed raw Wh but is rendered as kWh — a
 *     1000× overstatement; it is now converted to kWh.
 *   - lifetimeMetrics.minSessionCost folded a literal 0 into `Math.min`, pinning
 *     the "cheapest paid session" to 0 whenever any paid session existed.
 * …plus the hardening: an unparseable `started_at` used to index buckets[NaN]
 * and throw; a missing `total_energy_added_wh` used to poison the sums with NaN;
 * and mpg=0 used to divide 0/0. All three are now guarded.
 *
 * `toDistanceDisplay` is supplied as the real metres→miles converter so the
 * distance assertions exercise the exact production contract.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/api/types';
import {
  KWH_PER_GALLON,
  CO2_PER_GAL_KG,
  KG_CO2_PER_TREE_YEAR,
} from './constants';
import { useCostAnalysisData } from './useCostAnalysisData';

const METERS_PER_MILE = 1609.344;

/** Real metres→miles conversion, mirroring `convertDistanceFromSI(m, 'mi')`. */
const toMiles = (meters: number) => meters / METERS_PER_MILE;

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  const started = overrides.started_at ?? '2024-01-15T10:00:00Z';
  return {
    id: 1,
    vehicle_id: 7,
    started_at: started,
    ended_at: '2024-01-15T11:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 10_000,
    peak_power_w: 11_000,
    avg_power_w: 9_000,
    cost_decimal: 5,
    cost_currency: 'USD',
    charger_type: null,
    cable_type: null,
    startedAt: started,
    duration_min: 60,
    ...overrides,
  };
}

/**
 * Canonical three-session fixture used across the happy-path blocks:
 *   A — Jan, Supercharger, 100 mi, 10 kWh, $5, 60 min, 10:00
 *   B — Feb, Home,         100 mi, 20 kWh, $4, 90 min, 14:00
 *   C — Feb, Public DC,      0 mi, 15 kWh, $0 (free), 30 min, 22:30
 */
const MILE_100_M = METERS_PER_MILE * 100; // 160934.4 m

const sessionA = makeSession({
  id: 1,
  started_at: '2024-01-15T10:00:00Z',
  ended_at: '2024-01-15T11:00:00Z',
  total_energy_added_wh: 10_000,
  cost_decimal: 5,
  start_odometer_m: 0,
  end_odometer_m: MILE_100_M,
  charger_type: 'Tesla',
  peak_power_w: 120_000,
  start_place: 'Supercharger LA',
});

const sessionB = makeSession({
  id: 2,
  started_at: '2024-02-20T14:00:00Z',
  ended_at: '2024-02-20T15:30:00Z',
  total_energy_added_wh: 20_000,
  cost_decimal: 4,
  start_odometer_m: 200_000,
  end_odometer_m: 200_000 + MILE_100_M,
  charger_type: null,
  peak_power_w: 7_000,
  start_place: 'Home',
});

const sessionC = makeSession({
  id: 3,
  started_at: '2024-02-25T22:30:00Z',
  ended_at: '2024-02-25T23:00:00Z',
  total_energy_added_wh: 15_000,
  cost_decimal: 0,
  start_odometer_m: null,
  end_odometer_m: null,
  charger_type: null,
  peak_power_w: 30_000,
  start_place: 'Office parking',
});

const THREE = [sessionA, sessionB, sessionC];

function render(params: {
  sessions: ChargingSession[] | undefined;
  gasPrice?: number;
  mpg?: number;
  electricityRate?: number;
  toDistanceDisplay?: (m: number) => number;
}) {
  const { result } = renderHook(() =>
    useCostAnalysisData({
      sessions: params.sessions,
      gasPrice: params.gasPrice ?? 3.5,
      mpg: params.mpg ?? 30,
      electricityRate: params.electricityRate ?? 0.13,
      toDistanceDisplay: params.toDistanceDisplay ?? toMiles,
    }),
  );
  return result;
}

describe('useCostAnalysisData — empty & undefined inputs', () => {
  it('returns the fully-empty shape for undefined sessions', () => {
    const result = render({ sessions: undefined });
    expect(result.current.coreStats).toBeNull();
    expect(result.current.gasComparison).toBeNull();
    expect(result.current.touInsights).toBeNull();
    expect(result.current.lifetimeMetrics).toBeNull();
    expect(result.current.monthlyData).toEqual([]);
    expect(result.current.costPerKwhTrend).toEqual([]);
    expect(result.current.chargerTypeData).toEqual([]);
    expect(result.current.hourlyData).toEqual([]);
  });

  it('returns the fully-empty shape for an empty array', () => {
    const result = render({ sessions: [] });
    expect(result.current.coreStats).toBeNull();
    expect(result.current.monthlyData).toEqual([]);
    expect(result.current.hourlyData).toEqual([]);
    expect(result.current.lifetimeMetrics).toBeNull();
  });
});

describe('useCostAnalysisData — coreStats', () => {
  it('aggregates totals and derives averages, savings and CO2', () => {
    const stats = render({ sessions: THREE }).current.coreStats;
    expect(stats).not.toBeNull();
    expect(stats!.count).toBe(3);
    expect(stats!.totalCost).toBe(9);
    // 45 000 Wh → 45 kWh.
    expect(stats!.totalEnergy).toBe(45);
    expect(stats!.avgCostPerKwh).toBeCloseTo(0.2, 6);
    expect(stats!.totalDuration).toBe(180);
    expect(stats!.totalDistanceM).toBeCloseTo(2 * MILE_100_M, 3);

    const gallons = 45 / KWH_PER_GALLON;
    expect(stats!.gallonsEquiv).toBeCloseTo(gallons, 6);
    expect(stats!.gasCost).toBeCloseTo(gallons * 3.5, 6);
    expect(stats!.co2SavedKg).toBeCloseTo(gallons * CO2_PER_GAL_KG, 6);
    expect(stats!.treeEquiv).toBeCloseTo(
      (gallons * CO2_PER_GAL_KG) / KG_CO2_PER_TREE_YEAR,
      6,
    );
  });

  it('computes costPerDist from SI metres exactly once (no double conversion)', () => {
    // 200 mi driven for $9 ⇒ $0.045/mi. The pre-fix double conversion produced
    // ~$72/mi (off by the 1609.344 metres-per-mile factor).
    const stats = render({ sessions: THREE }).current.coreStats!;
    expect(stats.costPerDist).toBeCloseTo(0.045, 6);
    expect(stats.costPerDist).toBeLessThan(1);
  });

  it('honours the display-unit converter for costPerDist (km path)', () => {
    // metres→km ⇒ 321.869 km for $9 ⇒ ~$0.02796/km, distinct from the mi path.
    const stats = render({
      sessions: THREE,
      toDistanceDisplay: (m) => m / 1000,
    }).current.coreStats!;
    expect(stats.costPerDist).toBeCloseTo(9 / (2 * MILE_100_M / 1000), 6);
  });
});

describe('useCostAnalysisData — monthlyData & costPerKwhTrend', () => {
  it('buckets by month ascending, energy in kWh, with gas equivalents', () => {
    const monthly = render({ sessions: THREE }).current.monthlyData;
    expect(monthly).toHaveLength(2);
    expect(monthly.map((m) => m.month)).toEqual(['2024-01', '2024-02']);

    const [jan, feb] = monthly;
    expect(jan.cost).toBe(5);
    expect(jan.energy).toBe(10);
    expect(jan.sessions).toBe(1);
    expect(jan.avgCostPerKwh).toBeCloseTo(0.5, 6);

    expect(feb.cost).toBe(4);
    expect(feb.energy).toBe(35);
    expect(feb.sessions).toBe(2);
    // gasEquiv is energy-driven (mpg cancels): 35 kWh → gallons → $.
    expect(feb.gasEquiv).toBeCloseTo((35 / KWH_PER_GALLON) * 3.5, 6);
    expect(feb.savings).toBeCloseTo(feb.gasEquiv - feb.cost, 6);
  });

  it('builds an ascending per-session $/kWh trend', () => {
    const trend = render({ sessions: THREE }).current.costPerKwhTrend;
    expect(trend).toHaveLength(3);
    // Sorted by started_at: A (Jan, $0.50/kWh), B (Feb, $0.20), C (Feb, $0).
    expect(trend.map((p) => p.costPerKwh)).toEqual([0.5, 0.2, 0]);
    trend.forEach((p) => {
      expect(typeof p.date).toBe('string');
      expect(p.date).not.toBe('—');
    });
  });
});

describe('useCostAnalysisData — chargerTypeData & hourlyData', () => {
  it('groups by charger category with colours, sorted by cost desc', () => {
    const groups = render({ sessions: THREE }).current.chargerTypeData;
    expect(groups.map((g) => g.name)).toEqual([
      'Supercharger',
      'Home',
      'Public DC',
    ]);
    expect(groups.map((g) => g.cost)).toEqual([5, 4, 0]);
    expect(groups.map((g) => g.energy)).toEqual([10, 20, 15]);
    expect(groups[0].color).toBe('#ef4444'); // Supercharger
    expect(groups[1].color).toBe('#10b981'); // Home
    expect(groups[2].color).toBe('#a855f7'); // Public DC
  });

  it('spreads sessions across 24 hourly buckets, energy in kWh', () => {
    const hourly = render({ sessions: THREE }).current.hourlyData;
    expect(hourly).toHaveLength(24);
    // Buckets stay sorted 0..23 with a zero-padded HH:00 label.
    expect(hourly[0].label).toBe('00:00');
    expect(hourly[9].label).toBe('09:00');
    // Exactly three populated buckets (one per session), summing to 3 sessions
    // and 45 kWh regardless of the runner's timezone.
    const populated = hourly.filter((h) => h.sessions > 0);
    expect(populated).toHaveLength(3);
    expect(hourly.reduce((s, h) => s + h.sessions, 0)).toBe(3);
    expect(hourly.reduce((s, h) => s + h.totalEnergy, 0)).toBeCloseTo(45, 6);
  });
});

describe('useCostAnalysisData — touInsights', () => {
  it('surfaces cheapest, priciest and busiest hours', () => {
    const tou = render({ sessions: THREE }).current.touInsights;
    expect(tou).not.toBeNull();
    // The free session ($0) is the cheapest; the $5 Supercharger the priciest.
    expect(tou!.cheapest.avgCost).toBe(0);
    expect(tou!.priciest.avgCost).toBe(5);
    expect(tou!.busiest.sessions).toBe(1);
    expect(tou!.offPeakPct).toBeGreaterThanOrEqual(0);
    expect(tou!.offPeakPct).toBeLessThanOrEqual(100);
  });
});

describe('useCostAnalysisData — gasComparison', () => {
  it('derives gallons from real miles and per-distance cost from the display unit', () => {
    const gas = render({ sessions: THREE }).current.gasComparison;
    expect(gas).not.toBeNull();
    // 200 mi / 30 mpg = 6.667 gal × $3.50 = $23.33.
    expect(gas!.gasCost).toBeCloseTo((200 / 30) * 3.5, 4);
    expect(gas!.evCost).toBeCloseTo(45 * 0.13, 6);
    expect(gas!.actualCost).toBe(9);
    expect(gas!.savings).toBeCloseTo((200 / 30) * 3.5 - 9, 4);
    // $/mi figures must be sane single-conversion values (~$0.12 / $0.045),
    // not the ~$0.0145 / ~$72 the double-converted code produced.
    expect(gas!.costPerMileGas).toBeCloseTo(((200 / 30) * 3.5) / 200, 6);
    expect(gas!.costPerMileEV).toBeCloseTo(0.045, 6);
    // Two months in range ⇒ monthly = period/2, yearly = ×12.
    expect(gas!.monthlySavings).toBeCloseTo(((200 / 30) * 3.5 - 45 * 0.13) / 2, 4);
    expect(gas!.yearlySavings).toBeCloseTo(gas!.monthlySavings * 12, 4);
  });
});

describe('useCostAnalysisData — lifetimeMetrics', () => {
  it('derives per-session averages and free-session energy in kWh', () => {
    const life = render({ sessions: THREE }).current.lifetimeMetrics;
    expect(life).not.toBeNull();
    expect(life!.avgSessionCost).toBe(3); // 9 / 3
    expect(life!.avgSessionEnergy).toBe(15); // 45 kWh / 3
    expect(life!.avgDuration).toBe(60); // 180 min / 3
    expect(life!.freeCount).toBe(1); // only the $0 session
    // freeEnergy is the free session's 15 kWh — NOT 15 000 (raw Wh, pre-fix).
    expect(life!.freeEnergy).toBe(15);
  });

  it('reports the cheapest PAID session as minSessionCost, not 0', () => {
    const life = render({ sessions: THREE }).current.lifetimeMetrics!;
    // Paid sessions are $5 and $4; the free $0 session is excluded. The pre-fix
    // Math.min(...paid, 0) pinned this to 0.
    expect(life.minSessionCost).toBe(4);
    expect(life.maxSessionCost).toBe(5);
  });

  it('falls back to 0 min/max when every session is free', () => {
    const free = [
      makeSession({ id: 10, cost_decimal: 0 }),
      makeSession({ id: 11, cost_decimal: null }),
    ];
    const life = render({ sessions: free }).current.lifetimeMetrics!;
    expect(life.minSessionCost).toBe(0);
    expect(life.maxSessionCost).toBe(0);
    expect(life.freeCount).toBe(2);
  });
});

describe('useCostAnalysisData — hardening', () => {
  it('does not crash on an unparseable started_at (NaN hour bucket)', () => {
    const bad = makeSession({ id: 20, started_at: 'not-a-date', cost_decimal: 2 });
    const result = render({ sessions: [sessionA, bad] });
    // 24 buckets survive and only the valid session is counted — the pre-fix
    // buckets[NaN].sessions++ threw a TypeError here.
    const hourly = result.current.hourlyData;
    expect(hourly).toHaveLength(24);
    expect(hourly.reduce((s, h) => s + h.sessions, 0)).toBe(1);
    expect(result.current.coreStats).not.toBeNull();
  });

  it('coerces a missing total_energy_added_wh to 0 (no NaN)', () => {
    const noEnergy = makeSession({
      id: 21,
      total_energy_added_wh: undefined as unknown as number,
      cost_decimal: 5,
    });
    const result = render({ sessions: [noEnergy] });
    const stats = result.current.coreStats!;
    expect(Number.isFinite(stats.totalEnergy)).toBe(true);
    expect(stats.totalEnergy).toBe(0);
    expect(Number.isFinite(result.current.lifetimeMetrics!.freeEnergy)).toBe(true);
  });

  it('avoids NaN when mpg is 0', () => {
    const result = render({ sessions: THREE, mpg: 0 });
    const gas = result.current.gasComparison!;
    expect(gas.gasCost).toBe(0);
    expect(gas.costPerMileGas).toBe(0);
    expect(
      result.current.monthlyData.every(
        (m) => Number.isFinite(m.gasEquiv) && Number.isFinite(m.savings),
      ),
    ).toBe(true);
  });
});
