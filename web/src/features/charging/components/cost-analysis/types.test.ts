/**
 * cost-analysis/types — the view-model contract, locked at its boundaries.
 *
 * `types.ts` exports seven interfaces and no runtime values, so — exactly like
 * the `weekly-digest/types.test.ts` and `devtools/types.test.ts` precedents —
 * the only honest way to lock them is to pin the contract where it is actually
 * produced and consumed:
 *
 *   producer → `useCostAnalysisData()` is the SOLE factory for every derived
 *              shape ({@link CoreStats}, {@link MonthlyBucket},
 *              {@link ChargerTypeData}, {@link HourBucket}, {@link TouInsights},
 *              {@link GasComparison}, {@link LifetimeMetrics}). Given the
 *              per-session inputs it MUST structurally satisfy those interfaces
 *              AND carry the correct aggregate values.
 *   input    → {@link ChargingSession} is the per-record shape the hook reads;
 *              the fixtures below are typed against it, so a field rename in
 *              types.ts (or api/types.ts) breaks this file at compile time.
 *
 * Each `assert*Shape` guard takes its interface type as a parameter (compile-time
 * pin) and asserts the exact key set plus every field's runtime type (runtime
 * pin) — so a wire-shape drift or a producer regression can't slip past unseen.
 *
 * Strategy: `useCostAnalysisData` takes its sessions and calculator inputs as
 * plain params (no network, no react-query, no router), so the hook is rendered
 * bare with `renderHook`. Every fixture timestamp is built from LOCAL date
 * components and serialised with `toISOString()`, so month/hour bucketing — which
 * the hook derives with `getMonth()` / `getHours()` — round-trips to the same
 * wall-clock values in any timezone. `toDistanceDisplay` is injected as an
 * identity function so the distance-derived fields are computed from a known
 * transform rather than the app's live unit preference.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// jsdom lacks matchMedia; install a benign stub before the colors module the
// hook pulls in (via @/lib/colors → ThemeProvider) can read it at import time.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

import type { ChargingSession } from '@/api/types';
import { KWH_PER_GALLON, CO2_PER_GAL_KG, KG_CO2_PER_TREE_YEAR } from './constants';
import { CHARGER_COLORS } from '@/lib/colors';
import { useCostAnalysisData } from './useCostAnalysisData';
import type {
  CoreStats,
  MonthlyBucket,
  ChargerTypeData,
  HourBucket,
  TouInsights,
  GasComparison,
  LifetimeMetrics,
} from './types';

// ── Interface shape guards (compile-time + runtime pins) ─────────────────────

function assertMonthlyBucketShape(b: MonthlyBucket): void {
  expect(Object.keys(b).sort()).toEqual(
    ['avgCostPerKwh', 'cost', 'energy', 'gasEquiv', 'month', 'savings', 'sessions'],
  );
  expect(typeof b.month).toBe('string');
  for (const k of ['cost', 'energy', 'sessions', 'avgCostPerKwh', 'gasEquiv', 'savings'] as const) {
    expect(typeof b[k]).toBe('number');
    expect(Number.isNaN(b[k])).toBe(false);
  }
}

function assertChargerTypeDataShape(c: ChargerTypeData): void {
  expect(Object.keys(c).sort()).toEqual(['color', 'cost', 'energy', 'name', 'sessions']);
  expect(typeof c.name).toBe('string');
  expect(typeof c.color).toBe('string');
  for (const k of ['cost', 'energy', 'sessions'] as const) {
    expect(typeof c[k]).toBe('number');
  }
}

function assertHourBucketShape(h: HourBucket): void {
  expect(Object.keys(h).sort()).toEqual(['avgCost', 'hour', 'label', 'sessions', 'totalEnergy']);
  expect(typeof h.label).toBe('string');
  for (const k of ['hour', 'sessions', 'avgCost', 'totalEnergy'] as const) {
    expect(typeof h[k]).toBe('number');
  }
}

function assertCoreStatsShape(s: CoreStats): void {
  const keys: Array<keyof CoreStats> = [
    'totalCost', 'totalEnergy', 'avgCostPerKwh', 'totalDuration', 'totalDistanceM',
    'costPerDist', 'gasCost', 'savings', 'savingsPercent', 'co2SavedKg',
    'treeEquiv', 'gallonsEquiv', 'count',
  ];
  expect(Object.keys(s).sort()).toEqual([...keys].sort());
  for (const k of keys) {
    expect(typeof s[k]).toBe('number');
    expect(Number.isNaN(s[k])).toBe(false);
  }
}

function assertGasComparisonShape(g: GasComparison): void {
  const keys: Array<keyof GasComparison> = [
    'gasCost', 'evCost', 'actualCost', 'savings', 'monthlySavings',
    'yearlySavings', 'costPerMileGas', 'costPerMileEV',
  ];
  expect(Object.keys(g).sort()).toEqual([...keys].sort());
  for (const k of keys) {
    expect(typeof g[k]).toBe('number');
    expect(Number.isNaN(g[k])).toBe(false);
  }
}

function assertLifetimeMetricsShape(m: LifetimeMetrics): void {
  const keys: Array<keyof LifetimeMetrics> = [
    'avgSessionCost', 'avgSessionEnergy', 'avgDuration', 'freeCount',
    'freeEnergy', 'maxSessionCost', 'minSessionCost',
  ];
  expect(Object.keys(m).sort()).toEqual([...keys].sort());
  for (const k of keys) {
    expect(typeof m[k]).toBe('number');
    expect(Number.isNaN(m[k])).toBe(false);
  }
}

function assertTouInsightsShape(t: TouInsights): void {
  expect(Object.keys(t).sort()).toEqual(['busiest', 'cheapest', 'offPeakPct', 'priciest']);
  assertHourBucketShape(t.cheapest);
  assertHourBucketShape(t.priciest);
  assertHourBucketShape(t.busiest);
  expect(typeof t.offPeakPct).toBe('number');
}

// ── Timezone-safe fixtures ───────────────────────────────────────────────────
//
// Build instants from LOCAL date components then serialise to ISO; the hook
// reads them back with getMonth()/getHours(), recovering the same wall time in
// any timezone. Hours avoid the 02:00–03:00 DST window; dates avoid transition
// months so duration deltas stay exact.
const localIso = (y: number, mo: number, d: number, h: number, mi = 0): string =>
  new Date(y, mo, d, h, mi, 0, 0).toISOString();

function makeSession(over: Partial<ChargingSession> & Pick<ChargingSession, 'id'>): ChargingSession {
  return {
    vehicle_id: 7,
    started_at: localIso(2024, 0, 1, 12, 0),
    ended_at: localIso(2024, 0, 1, 12, 30),
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 0,
    peak_power_w: null,
    avg_power_w: null,
    cost_decimal: null,
    cost_currency: 'USD',
    charger_type: null,
    cable_type: null,
    startedAt: localIso(2024, 0, 1, 12, 0),
    duration_min: 30,
    ...over,
  };
}

// A representative fleet spanning two months, four charger categories and four
// hours of the day. Deliberately clean Wh values (÷1000 → whole kWh) and one
// free (cost 0) plus one uncosted (cost null) session so the free-charging and
// null-safety branches are exercised by real data.
const SESSIONS: ChargingSession[] = [
  // #1 Supercharger, Jan 05 10:00, paid, 20 kWh, +50 km odo, 30 min
  makeSession({
    id: 1,
    started_at: localIso(2024, 0, 5, 10, 0),
    ended_at: localIso(2024, 0, 5, 10, 30),
    total_energy_added_wh: 20_000,
    cost_decimal: 10,
    charger_type: 'Tesla Supercharger',
    peak_power_w: 150_000,
    start_place: 'Supercharger — Fremont',
    start_odometer_m: 1_000,
    end_odometer_m: 51_000,
  }),
  // #2 Public DC (peak > 22 kW), Jan 20 14:00, paid, 30 kWh, +30 km, 20 min
  makeSession({
    id: 2,
    started_at: localIso(2024, 0, 20, 14, 0),
    ended_at: localIso(2024, 0, 20, 14, 20),
    total_energy_added_wh: 30_000,
    cost_decimal: 15,
    charger_type: null,
    peak_power_w: 50_000,
    start_place: 'Highway Plaza',
    start_odometer_m: 51_000,
    end_odometer_m: 81_000,
  }),
  // #3 Home, Feb 10 23:00 (off-peak), FREE (cost 0), 10 kWh, +10 km, 120 min
  makeSession({
    id: 3,
    started_at: localIso(2024, 1, 10, 23, 0),
    ended_at: localIso(2024, 1, 11, 1, 0),
    total_energy_added_wh: 10_000,
    cost_decimal: 0,
    charger_type: null,
    peak_power_w: 7_000,
    start_place: 'Home Garage',
    start_odometer_m: 81_000,
    end_odometer_m: 91_000,
  }),
  // #4 Work / L2, Feb 15 10:00, uncosted (cost null → free), 15 kWh, +30 km, 120 min
  makeSession({
    id: 4,
    started_at: localIso(2024, 1, 15, 10, 0),
    ended_at: localIso(2024, 1, 15, 12, 0),
    total_energy_added_wh: 15_000,
    cost_decimal: null,
    charger_type: null,
    peak_power_w: 11_000,
    start_place: 'Downtown Office Garage',
    start_odometer_m: 91_000,
    end_odometer_m: 121_000,
  }),
];

const GAS_PRICE = 4;
const MPG = 30;
const ELECTRICITY_RATE = 0.2;
const identityDistance = (meters: number): number => meters; // injected transform

function render(sessions: ChargingSession[] | undefined) {
  return renderHook(() =>
    useCostAnalysisData({
      sessions,
      gasPrice: GAS_PRICE,
      mpg: MPG,
      electricityRate: ELECTRICITY_RATE,
      toDistanceDisplay: identityDistance,
      isMiles: false,
    }),
  );
}

// Derived-from-fixtures constants used by multiple blocks.
const TOTAL_KWH = 75; // (20+30+10+15) k Wh
const TOTAL_COST = 25; // 10 + 15 + 0 + (null→0)
const TOTAL_DISTANCE_M = 120_000; // 50k + 30k + 10k + 30k

// ─────────────────────────────────────────────────────────────────────────────
describe('ChargingSession input contract', () => {
  it('the fixtures the hook consumes structurally satisfy the input interface', () => {
    expect(SESSIONS).toHaveLength(4);
    for (const s of SESSIONS) {
      expect(typeof s.id).toBe('number');
      expect(typeof s.started_at).toBe('string');
      expect(typeof s.total_energy_added_wh).toBe('number');
    }
    // The categorisation-relevant fields carry the values the assertions rely on.
    expect(SESSIONS[0].charger_type).toContain('Supercharger');
    expect(SESSIONS[1].peak_power_w).toBeGreaterThan(22_000);
    expect(SESSIONS[3].start_place).toContain('Office');
  });

  it('exposes the eight documented result keys', () => {
    const { result } = render(SESSIONS);
    expect(Object.keys(result.current).sort()).toEqual(
      [
        'chargerTypeData', 'coreStats', 'costPerKwhTrend', 'gasComparison',
        'hourlyData', 'lifetimeMetrics', 'monthlyData', 'touInsights',
      ],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useCostAnalysisData → CoreStats', () => {
  it('satisfies the interface and derives every lifetime aggregate', () => {
    const { result } = render(SESSIONS);
    const s = result.current.coreStats;
    expect(s).not.toBeNull();
    assertCoreStatsShape(s as CoreStats);

    const cs = s as CoreStats;
    // Exact, unit-clean aggregates.
    expect(cs.totalCost).toBe(TOTAL_COST);
    expect(cs.totalEnergy).toBe(TOTAL_KWH); // Wh sum ÷ 1000 → kWh
    expect(cs.count).toBe(4);
    expect(cs.totalDuration).toBe(290); // 30 + 20 + 120 + 120
    expect(cs.totalDistanceM).toBe(TOTAL_DISTANCE_M); // raw SI metres

    // Blended rate + gasoline model derived from the shared constants.
    expect(cs.avgCostPerKwh).toBeCloseTo(TOTAL_COST / TOTAL_KWH, 10);
    expect(cs.gallonsEquiv).toBeCloseTo(TOTAL_KWH / KWH_PER_GALLON, 10);
    expect(cs.gasCost).toBeCloseTo((TOTAL_KWH / KWH_PER_GALLON) * GAS_PRICE, 10);
    expect(cs.co2SavedKg).toBeCloseTo((TOTAL_KWH / KWH_PER_GALLON) * CO2_PER_GAL_KG, 10);
    expect(cs.treeEquiv).toBeCloseTo(
      ((TOTAL_KWH / KWH_PER_GALLON) * CO2_PER_GAL_KG) / KG_CO2_PER_TREE_YEAR,
      10,
    );
    // savings = gasCost - totalCost, and savingsPercent scales it against gasCost.
    expect(cs.savings).toBeCloseTo(cs.gasCost - TOTAL_COST, 10);
    expect(cs.savingsPercent).toBeCloseTo((cs.savings / cs.gasCost) * 100, 10);
    // costPerDist uses the injected identity transform (metres → miles number).
    expect(cs.costPerDist).toBeCloseTo(TOTAL_COST / TOTAL_DISTANCE_M, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useCostAnalysisData → MonthlyBucket[] + cost/kWh trend', () => {
  it('buckets by calendar month, sorted ascending, with correct per-month figures', () => {
    const { result } = render(SESSIONS);
    const months = result.current.monthlyData;
    expect(months).toHaveLength(2);
    months.forEach(assertMonthlyBucketShape);
    expect(months.map((m) => m.month)).toEqual(['2024-01', '2024-02']);

    const [jan, feb] = months;
    // January = sessions #1 + #2.
    expect(jan.cost).toBe(25);
    expect(jan.energy).toBe(50);
    expect(jan.sessions).toBe(2);
    expect(jan.avgCostPerKwh).toBe(0.5);
    expect(jan.gasEquiv).toBeCloseTo((50 / KWH_PER_GALLON) * GAS_PRICE, 10);
    expect(jan.savings).toBeCloseTo((50 / KWH_PER_GALLON) * GAS_PRICE - 25, 10);

    // February = sessions #3 (cost 0) + #4 (cost null → 0).
    expect(feb.cost).toBe(0);
    expect(feb.energy).toBe(25);
    expect(feb.sessions).toBe(2);
    expect(feb.avgCostPerKwh).toBe(0);
  });

  it('emits a cost-per-kWh trend for costed sessions only, sorted oldest-first', () => {
    const { result } = render(SESSIONS);
    const trend = result.current.costPerKwhTrend;
    // #4 (cost null) is filtered out; #1, #2, #3 remain in chronological order.
    expect(trend).toHaveLength(3);
    trend.forEach((p) => expect(typeof p.date).toBe('string'));
    expect(trend.map((p) => p.costPerKwh)).toEqual([0.5, 0.5, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useCostAnalysisData → ChargerTypeData[]', () => {
  it('categorises, colours, and orders charger groups by descending spend', () => {
    const { result } = render(SESSIONS);
    const groups = result.current.chargerTypeData;
    expect(groups).toHaveLength(4);
    groups.forEach(assertChargerTypeDataShape);

    // Sorted by cost desc; the two zero-cost groups keep insertion order.
    expect(groups.map((g) => g.name)).toEqual(['Public DC', 'Supercharger', 'Home', 'Work / L2']);

    const byName = Object.fromEntries(groups.map((g) => [g.name, g]));
    expect(byName['Public DC'].cost).toBe(15);
    expect(byName['Public DC'].energy).toBe(30);
    expect(byName['Supercharger'].cost).toBe(10);
    expect(byName['Home'].cost).toBe(0);
    expect(byName['Work / L2'].energy).toBe(15);

    // Colours come from the shared CHARGER_COLORS map, not ad-hoc literals.
    expect(byName['Supercharger'].color).toBe(CHARGER_COLORS['Supercharger']);
    expect(byName['Public DC'].color).toBe(CHARGER_COLORS['Public DC']);
    expect(byName['Home'].color).toBe(CHARGER_COLORS['Home']);
    expect(byName['Work / L2'].color).toBe(CHARGER_COLORS['Work / L2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useCostAnalysisData → HourBucket[] + TouInsights', () => {
  it('produces a full 24-hour histogram with per-hour cost and energy', () => {
    const { result } = render(SESSIONS);
    const hours = result.current.hourlyData;
    expect(hours).toHaveLength(24);
    hours.forEach(assertHourBucketShape);
    expect(hours.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));

    const at = (h: number) => hours[h];
    // 10:00 = sessions #1 (20 kWh, $10) + #4 (15 kWh, cost null → $0).
    expect(at(10)).toMatchObject({ hour: 10, label: '10:00', sessions: 2, avgCost: 5, totalEnergy: 35 });
    expect(at(14)).toMatchObject({ sessions: 1, avgCost: 15, totalEnergy: 30 });
    expect(at(23)).toMatchObject({ sessions: 1, avgCost: 0, totalEnergy: 10 });
    // An empty hour stays present with zeroed metrics (never dropped).
    expect(at(0)).toMatchObject({ hour: 0, sessions: 0, avgCost: 0, totalEnergy: 0 });
  });

  it('derives cheapest / priciest / busiest hours and the off-peak share', () => {
    const { result } = render(SESSIONS);
    const tou = result.current.touInsights;
    expect(tou).not.toBeNull();
    assertTouInsightsShape(tou as TouInsights);

    const t = tou as TouInsights;
    expect(t.cheapest.hour).toBe(23); // avgCost 0
    expect(t.priciest.hour).toBe(14); // avgCost 15
    expect(t.busiest.hour).toBe(10); // 2 sessions
    // Only session #3 (23:00) is off-peak (22:00–06:00): 1 of 4 → 25%.
    expect(t.offPeakPct).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useCostAnalysisData → GasComparison', () => {
  it('satisfies the interface and models gas-vs-EV economics', () => {
    const { result } = render(SESSIONS);
    const gc = result.current.gasComparison;
    expect(gc).not.toBeNull();
    assertGasComparisonShape(gc as GasComparison);

    const g = gc as GasComparison;
    expect(g.actualCost).toBe(TOTAL_COST);
    expect(g.evCost).toBeCloseTo(TOTAL_KWH * ELECTRICITY_RATE, 10); // 75 * 0.2 = 15
    // Per-distance gas cost collapses to gasPrice / mpg regardless of distance.
    expect(g.costPerMileGas).toBeCloseTo(g.gasCost / TOTAL_DISTANCE_M, 10);
    expect(g.savings).toBeCloseTo(g.gasCost - TOTAL_COST, 10);
    // yearly is exactly 12× monthly.
    expect(g.yearlySavings).toBeCloseTo(g.monthlySavings * 12, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useCostAnalysisData → LifetimeMetrics', () => {
  it('satisfies the interface and derives per-session averages', () => {
    const { result } = render(SESSIONS);
    const lm = result.current.lifetimeMetrics;
    expect(lm).not.toBeNull();
    assertLifetimeMetricsShape(lm as LifetimeMetrics);

    const m = lm as LifetimeMetrics;
    expect(m.avgSessionCost).toBe(TOTAL_COST / 4); // 6.25
    expect(m.avgSessionEnergy).toBe(TOTAL_KWH / 4); // 18.75 kWh
    expect(m.avgDuration).toBe(290 / 4); // 72.5 min
    expect(m.maxSessionCost).toBe(15);
    // minSessionCost is floored at 0 by design (guards against Math.min() = ∞).
    expect(m.minSessionCost).toBe(10);
  });

  it('reports free-session count AND energy in kWh (regression: was raw Wh)', () => {
    const { result } = render(SESSIONS);
    const m = result.current.lifetimeMetrics as LifetimeMetrics;
    // Free sessions = #3 (cost 0) + #4 (cost null): 10 kWh + 15 kWh = 25 kWh.
    expect(m.freeCount).toBe(2);
    // The consumer renders this via fmtWithUnit(_, 'kWh'); it MUST be 25, not
    // 25000 — freeEnergy is converted from the SI Wh sum like every sibling
    // energy field, so the "Free Sessions" tile can't read 1000× too high.
    expect(m.freeEnergy).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('empty + null-safety guards', () => {
  it('returns null scalars and empty arrays for an empty session list', () => {
    const { result } = render([]);
    const r = result.current;
    expect(r.coreStats).toBeNull();
    expect(r.touInsights).toBeNull();
    expect(r.gasComparison).toBeNull();
    expect(r.lifetimeMetrics).toBeNull();
    expect(r.monthlyData).toEqual([]);
    expect(r.costPerKwhTrend).toEqual([]);
    expect(r.chargerTypeData).toEqual([]);
    expect(r.hourlyData).toEqual([]);
  });

  it('treats an undefined session feed (query still loading) exactly like empty', () => {
    const { result } = render(undefined);
    const r = result.current;
    expect(r.coreStats).toBeNull();
    expect(r.lifetimeMetrics).toBeNull();
    expect(r.monthlyData).toEqual([]);
    expect(r.chargerTypeData).toEqual([]);
    expect(r.hourlyData).toEqual([]);
  });
});
