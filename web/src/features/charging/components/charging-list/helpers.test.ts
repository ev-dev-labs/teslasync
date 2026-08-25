/**
 * charging-list/helpers — behaviour, branch, unit, null-safety & regression
 * coverage for every export of the Charging list computation module.
 *
 * These are pure functions (no React, no network) so the tests exercise them
 * directly. The only seam mocked is the sibling `../ChargingSessionCard`
 * re-export barrel: it pulls in the whole shared React component tree just to
 * re-export `getChargerCategory`, so we substitute the REAL implementation
 * from `@/lib/chargingAggregation` (where the logic actually lives) to keep the
 * unit hermetic and fast while preserving true categorisation behaviour.
 *
 * The suite pins the bugs the hardening pass fixed:
 *   - UNIT (×1000): computeEnergyTrend / computeCostByType / computeAcDcBreakdown
 *     emitted raw watt-hours where consumers label/treat the value as kWh.
 *     They now convert at the display boundary.
 *   - SEMANTICS: energy divided by duration was previously called
 *     "efficiency" and displayed as a percentage. It is now modeled in
 *     canonical watts as charging delivery rate.
 *   - SEPARATOR corruption: the old `parseFloat(fmtNumber(x, n))` idiom
 *     truncated any value ≥ 1000 at its thousands separator ("12,345.0" → 12).
 *   - CRASH: computeStartLevelDist indexed buckets[-1] / buckets[NaN] for a
 *     negative or non-finite start SOC and threw on `.count`.
 */
import { describe, it, expect, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { ChargingSession } from '@/api/types';
import { CHARGER_COLORS } from '@/lib/colors';
import {
  computeStats,
  computeChargerBreakdown,
  computeEnergyTrend,
  computeCostByType,
  computeStartLevelDist,
  computeAcDcBreakdown,
  computeChargeRateStats,
  computeChargerSpecs,
  computeEnhancedStats,
  filterAndSortSessions,
  type ChargingStats,
} from './helpers';

// jsdom lacks matchMedia; the shared ThemeProvider reached transitively via
// `@/lib/colors` may read it at module init. Install a benign stub first.
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

// `../ChargingSessionCard` only re-exports `getChargerCategory` (its real home
// is `@/lib/chargingAggregation`). Swap in the real logic without dragging in
// the React component tree.
vi.mock('../ChargingSessionCard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chargingAggregation')>(
    '@/lib/chargingAggregation',
  );
  return { getChargerCategory: actual.getChargerCategory };
});

/* ── Fixtures ─────────────────────────────────────────────────────────── */

/** Build one charging session; every field defaults to a zeroed/null value. */
function makeSession(over: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: '2024-06-01T10:00:00Z',
    ended_at: '2024-06-01T11:00:00Z',
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
    cost_currency: null,
    charger_type: null,
    cable_type: null,
    startedAt: '2024-06-01T10:00:00Z',
    duration_min: 60,
    ...over,
  };
}

/** A session `minutes` long on 2024-06-{id}, with the given extra metadata. */
function sessionMin(
  id: number,
  minutes: number,
  over: Partial<ChargingSession> = {},
): ChargingSession {
  const start = Date.UTC(2024, 5, id, 10, 0, 0);
  const iso = (t: number) => new Date(t).toISOString();
  return makeSession({
    id,
    started_at: iso(start),
    ended_at: iso(start + minutes * 60_000),
    startedAt: iso(start),
    duration_min: minutes,
    ...over,
  });
}

function makeStats(over: Partial<ChargingStats> = {}): ChargingStats {
  return {
    totalEnergy: 0,
    totalCost: 0,
    totalDuration: 0,
    avgPower: 0,
    avgCostPerKwh: 0,
    homeCount: 0,
    scCount: 0,
    dcCount: 0,
    count: 0,
    ...over,
  };
}

/** Minimal i18n stub that returns the developer fallback string. */
const t = ((_key: string, fallback?: string) => fallback ?? _key) as unknown as TFunction;

/* ── computeStats ─────────────────────────────────────────────────────── */

describe('computeStats', () => {
  it('returns null for an empty session list', () => {
    expect(computeStats([])).toBeNull();
  });

  it('aggregates energy in kWh, power in kW, and categorises each session', () => {
    const stats = computeStats([
      sessionMin(1, 60, { total_energy_added_wh: 10_000, cost_decimal: 5, peak_power_w: 11_000, charger_type: null }),
      sessionMin(2, 30, { total_energy_added_wh: 50_000, cost_decimal: 20, peak_power_w: 250_000, charger_type: 'Supercharger' }),
      sessionMin(3, 45, { total_energy_added_wh: 30_000, cost_decimal: null, peak_power_w: 100_000, charger_type: 'CCS' }),
    ])!;

    // Regression: 90 kWh, NOT 90_000 Wh — energy is converted at the boundary.
    expect(stats.totalEnergy).toBe(90);
    expect(stats.totalCost).toBe(25);
    expect(stats.totalDuration).toBe(135);
    expect(stats.count).toBe(3);
    expect(stats.homeCount).toBe(1);
    expect(stats.scCount).toBe(1);
    expect(stats.dcCount).toBe(1);
    // avg peak power = (11k+250k+100k)/3 / 1000 kW.
    expect(stats.avgPower).toBeCloseTo(120.333, 2);
    expect(stats.avgCostPerKwh).toBeCloseTo(25 / 90, 4);
  });

  it('averages power only over sessions that report peak power (no divide-by-zero)', () => {
    const withOne = computeStats([
      sessionMin(1, 60, { total_energy_added_wh: 5_000, peak_power_w: 22_000 }),
      sessionMin(2, 60, { total_energy_added_wh: 5_000, peak_power_w: null }),
    ])!;
    // Divisor is the count WITH power (1), not the total session count (2).
    expect(withOne.avgPower).toBe(22);

    const withNone = computeStats([sessionMin(1, 60, { peak_power_w: null })])!;
    expect(withNone.avgPower).toBe(0);
  });

  it('treats a non-numeric energy value as zero instead of poisoning the total', () => {
    const stats = computeStats([
      makeSession({ total_energy_added_wh: undefined as unknown as number, cost_decimal: 3 }),
      sessionMin(2, 60, { total_energy_added_wh: 10_000 }),
    ])!;
    expect(stats.totalEnergy).toBe(10);
    expect(Number.isNaN(stats.totalEnergy)).toBe(false);
  });
});

/* ── computeChargerBreakdown ──────────────────────────────────────────── */

describe('computeChargerBreakdown', () => {
  it('maps each category to its colour and drops zero-count slices', () => {
    const result = computeChargerBreakdown(
      makeStats({ scCount: 2, dcCount: 0, homeCount: 3 }),
      t,
    );

    // DC slice (count 0) is filtered out.
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.value > 0)).toBe(true);

    const sc = result.find((d) => d.name === 'Supercharger')!;
    expect(sc.value).toBe(2);
    expect(sc.fill).toBe(CHARGER_COLORS.supercharger);

    const home = result.find((d) => d.name === 'Home / AC')!;
    expect(home.value).toBe(3);
    expect(home.fill).toBe(CHARGER_COLORS.home);
  });

  it('returns an empty array when every category is empty', () => {
    expect(computeChargerBreakdown(makeStats(), t)).toEqual([]);
  });
});

/* ── computeEnergyTrend ───────────────────────────────────────────────── */

describe('computeEnergyTrend', () => {
  it('converts Wh→kWh, rounds to 1 decimal, and reverses chronological order', () => {
    const [first, second] = computeEnergyTrend([
      sessionMin(1, 60, { total_energy_added_wh: 12_345, cost_decimal: 3.5 }),
      sessionMin(2, 60, { total_energy_added_wh: 8_500, cost_decimal: null }),
    ]);

    // Input reversed: second session surfaces first.
    // Regression: 8_500 Wh → 8.5 kWh (old parseFloat(fmtNumber) gave 8).
    expect(first.energy).toBe(8.5);
    expect(first.cost).toBe(0);
    // Regression: 12_345 Wh → 12.3 kWh (old parseFloat("12,345.0") gave 12).
    expect(second.energy).toBe(12.3);
    expect(second.cost).toBe(3.5);
    expect(typeof first.date).toBe('string');
  });

  it('caps the series at the 20 most recent sessions', () => {
    const many = Array.from({ length: 25 }, (_, i) => sessionMin(1, 60, { id: i, total_energy_added_wh: 1_000 }));
    expect(computeEnergyTrend(many)).toHaveLength(20);
  });
});

/* ── computeCostByType ────────────────────────────────────────────────── */

describe('computeCostByType', () => {
  const labels = { home: 'Home', supercharger: 'Supercharger', dc: 'DC Fast', unknown: 'Other' };

  it('groups by charger label with kWh energy and correct $/kWh', () => {
    const result = computeCostByType(
      [
        sessionMin(1, 60, { total_energy_added_wh: 10_000, cost_decimal: 2, charger_type: null }),
        sessionMin(2, 60, { total_energy_added_wh: 20_000, cost_decimal: 4, charger_type: null }),
        sessionMin(3, 60, { total_energy_added_wh: 40_000, cost_decimal: 20, charger_type: 'Supercharger' }),
      ],
      labels,
    );

    const home = result.find((r) => r.name === 'Home')!;
    // Regression: 30 kWh, NOT 30_000 Wh.
    expect(home.energy).toBe(30);
    expect(home.cost).toBe(6);
    expect(home.perKwh).toBeCloseTo(0.2, 6);

    const sc = result.find((r) => r.name === 'Supercharger')!;
    expect(sc.energy).toBe(40);
    expect(sc.perKwh).toBeCloseTo(0.5, 6);
  });

  it('reports $/kWh as 0 for a zero-energy group instead of dividing by zero', () => {
    const [entry] = computeCostByType(
      [makeSession({ total_energy_added_wh: 0, cost_decimal: 5, charger_type: null })],
      labels,
    );
    expect(entry.energy).toBe(0);
    expect(entry.cost).toBe(5);
    expect(entry.perKwh).toBe(0);
  });
});

/* ── computeStartLevelDist ────────────────────────────────────────────── */

describe('computeStartLevelDist', () => {
  it('buckets sessions into ten 10%-wide start-SOC ranges (100% clamps into the last)', () => {
    const buckets = computeStartLevelDist([
      makeSession({ start_soc_pct: 5 }),
      makeSession({ start_soc_pct: 15 }),
      makeSession({ start_soc_pct: 95 }),
      makeSession({ start_soc_pct: 100 }),
    ]);

    expect(buckets).toHaveLength(10);
    expect(buckets[0]).toEqual({ range: '0-10%', count: 1 });
    expect(buckets[1].count).toBe(1);
    // 95% and 100% both land in the final [90-100%] bucket.
    expect(buckets[9].count).toBe(2);
  });

  it('does not throw on negative / non-finite start SOC (regression: buckets[-1]/[NaN])', () => {
    const run = () =>
      computeStartLevelDist([
        makeSession({ start_soc_pct: -5 }),
        makeSession({ start_soc_pct: Number.NaN }),
        makeSession({ start_soc_pct: null as unknown as number }),
        makeSession({ start_soc_pct: 100 }),
      ]);

    expect(run).not.toThrow();
    const buckets = run();
    // The three bad values fall back into bucket 0; 100 stays in bucket 9.
    expect(buckets[0].count).toBe(3);
    expect(buckets[9].count).toBe(1);
  });
});

/* ── computeAcDcBreakdown ─────────────────────────────────────────────── */

describe('computeAcDcBreakdown', () => {
  it('splits AC vs DC, sums kWh, and tracks free charging per bucket', () => {
    const b = computeAcDcBreakdown([
      // AC: no charger_type and peak ≤ 22 kW.
      sessionMin(1, 60, { total_energy_added_wh: 10_000, cost_decimal: 3, peak_power_w: 7_000 }),
      // DC: charger_type present.
      sessionMin(2, 30, { total_energy_added_wh: 50_000, cost_decimal: 25, charger_type: 'Supercharger' }),
      // DC: peak > 22 kW, free (no cost).
      sessionMin(3, 20, { total_energy_added_wh: 20_000, cost_decimal: null, peak_power_w: 30_000 }),
      // AC: free (cost exactly 0).
      sessionMin(4, 10, { total_energy_added_wh: 5_000, cost_decimal: 0, peak_power_w: 5_000 }),
    ]);

    // Regression: kWh, NOT Wh (AC 15 kWh, DC 70 kWh).
    expect(b.ac.energy).toBe(15);
    expect(b.ac.count).toBe(2);
    expect(b.ac.totalDuration).toBe(70);
    expect(b.ac.freeCount).toBe(1);
    expect(b.ac.freeEnergy).toBe(5);

    expect(b.dc.energy).toBe(70);
    expect(b.dc.count).toBe(2);
    expect(b.dc.freeCount).toBe(1);
    expect(b.dc.freeEnergy).toBe(20);

    expect(b.total.energy).toBe(85);
    expect(b.total.cost).toBe(28);
    expect(b.total.freeCount).toBe(2);
    expect(b.total.freeEnergy).toBe(25);
  });

  it('returns zeroed buckets for no sessions', () => {
    const b = computeAcDcBreakdown([]);
    expect(b.ac.count).toBe(0);
    expect(b.total.energy).toBe(0);
  });
});

/* ── computeChargeRateStats ───────────────────────────────────────────── */

describe('computeChargeRateStats', () => {
  it('returns null when there are no sessions or none carry usable data', () => {
    expect(computeChargeRateStats([])).toBeNull();
    // Zero energy AND zero duration → filtered out → null.
    expect(
      computeChargeRateStats([makeSession({ total_energy_added_wh: 0, ended_at: null })]),
    ).toBeNull();
  });

  it('ranks sessions by delivery power and keeps aggregate values SI-canonical', () => {
    const stats = computeChargeRateStats([
      sessionMin(1, 60, { total_energy_added_wh: 30_000 }),
      sessionMin(2, 60, { total_energy_added_wh: 10_000 }),
    ])!;

    expect(stats.count).toBe(2);
    expect(stats.best.id).toBe(1);
    expect(stats.best.powerW).toBeCloseTo(30_000, 3);
    expect(stats.worst.id).toBe(2);
    expect(stats.worst.powerW).toBeCloseTo(10_000, 3);
    expect(stats.averagePowerW).toBeCloseTo(20_000, 3);
    expect(stats.totalEnergyWh).toBe(40_000);
    expect(stats.totalDurationS).toBe(7_200);
  });

  it('weights average delivery power by elapsed time instead of averaging session rates', () => {
    const stats = computeChargeRateStats([
      sessionMin(1, 60, { total_energy_added_wh: 30_000 }),
      sessionMin(2, 120, { total_energy_added_wh: 10_000 }),
    ])!;

    // 40 kWh over 3 h = 13.333 kW; an unweighted mean would incorrectly be 17.5 kW.
    expect(stats.averagePowerW).toBeCloseTo(13_333.333, 3);
  });
});

/* ── computeChargerSpecs ──────────────────────────────────────────────── */

describe('computeChargerSpecs', () => {
  it('returns null for no sessions', () => {
    expect(computeChargerSpecs([])).toBeNull();
  });

  it('groups by brand and cable, ordering brands by frequency with kW averages', () => {
    const specs = computeChargerSpecs([
      makeSession({ charger_type: 'Tesla Supercharger', peak_power_w: 250_000, total_energy_added_wh: 40_000, cable_type: 'CCS' }),
      makeSession({ charger_type: 'Tesla Supercharger', peak_power_w: 150_000, total_energy_added_wh: 20_000, cable_type: 'CCS' }),
      makeSession({ charger_type: null, peak_power_w: 7_000, total_energy_added_wh: 10_000, cable_type: null }),
    ])!;

    // Brands sorted by count desc: the 2× Supercharger group leads.
    expect(specs.brand[0].name).toBe('Tesla Supercharger');
    expect(specs.brand[0].count).toBe(2);
    expect(specs.brand[0].energy).toBe(60); // 60_000 Wh → 60 kWh
    expect(specs.brand[0].avgPower).toBe(200); // (400_000/2)/1000 kW
    expect(specs.brand[1].name).toBe('AC/Home');

    // Cable grouping only counts sessions that carry a cable type.
    expect(specs.cable[0].name).toBe('CCS');
    expect(specs.cable[0].count).toBe(2);
    expect(specs.cable[0].avgPower).toBeUndefined();

    // Voltage/phase are not derivable from the current model → empty columns.
    expect(specs.voltage).toEqual([]);
    expect(specs.phase).toEqual([]);
  });
});

/* ── computeEnhancedStats ─────────────────────────────────────────────── */

describe('computeEnhancedStats', () => {
  it('returns null for an empty session list', () => {
    expect(computeEnhancedStats([], makeStats())).toBeNull();
  });

  it('derives average duration and the most common charger type', () => {
    const sessions = [
      makeSession({ charger_type: 'Supercharger' }),
      makeSession({ charger_type: 'Supercharger' }),
      makeSession({ charger_type: null }),
    ];
    const enhanced = computeEnhancedStats(sessions, makeStats({ count: 3, totalDuration: 150 }))!;

    expect(enhanced.avgDuration).toBe(50);
    expect(enhanced.mostCommonType[0]).toBe('Supercharger');
    expect(enhanced.mostCommonType[1]).toBe(2);
  });

  it('guards average duration against a zero session count', () => {
    const enhanced = computeEnhancedStats([makeSession()], makeStats({ count: 0 }))!;
    expect(enhanced.avgDuration).toBe(0);
  });
});

/* ── filterAndSortSessions ────────────────────────────────────────────── */

describe('filterAndSortSessions', () => {
  const a = sessionMin(1, 60, { total_energy_added_wh: 10_000, cost_decimal: 5, peak_power_w: 50_000, charger_type: 'Supercharger', start_place: 'Home Garage' });
  const b = sessionMin(2, 30, { total_energy_added_wh: 30_000, cost_decimal: 2, peak_power_w: 150_000, charger_type: 'CCS', start_place: 'Mall' });
  const c = sessionMin(3, 90, { total_energy_added_wh: 20_000, cost_decimal: 8, peak_power_w: 7_000, charger_type: null, start_place: 'Office' });
  const all = [a, b, c];
  const ids = (rows: ChargingSession[]) => rows.map((r) => r.id);

  it('sorts by each key in descending order', () => {
    expect(ids(filterAndSortSessions(all, 'all', 'date', true))).toEqual([3, 2, 1]);
    expect(ids(filterAndSortSessions(all, 'all', 'energy', true))).toEqual([2, 3, 1]);
    expect(ids(filterAndSortSessions(all, 'all', 'cost', true))).toEqual([3, 1, 2]);
    expect(ids(filterAndSortSessions(all, 'all', 'duration', true))).toEqual([3, 1, 2]);
    expect(ids(filterAndSortSessions(all, 'all', 'power', true))).toEqual([2, 1, 3]);
  });

  it('inverts ordering when sortDesc is false', () => {
    expect(ids(filterAndSortSessions(all, 'all', 'date', false))).toEqual([1, 2, 3]);
    expect(ids(filterAndSortSessions(all, 'all', 'energy', false))).toEqual([1, 3, 2]);
  });

  it('filters by charger category', () => {
    expect(ids(filterAndSortSessions(all, 'supercharger', 'date', true))).toEqual([1]);
    expect(ids(filterAndSortSessions(all, 'dc', 'date', true))).toEqual([2]);
    expect(ids(filterAndSortSessions(all, 'home', 'date', true))).toEqual([3]);
  });

  it('applies a case-insensitive search over place and charger type', () => {
    expect(ids(filterAndSortSessions(all, 'all', 'date', true, 'mall'))).toEqual([2]);
    expect(ids(filterAndSortSessions(all, 'all', 'date', true, 'CCS'))).toEqual([2]);
    expect(ids(filterAndSortSessions(all, 'all', 'date', true, 'office'))).toEqual([3]);
    // Query that matches nothing yields an empty result.
    expect(filterAndSortSessions(all, 'all', 'date', true, 'zzz')).toEqual([]);
  });

  it('returns an empty array for no input and never mutates the source order', () => {
    expect(filterAndSortSessions([], 'all', 'date', true)).toEqual([]);
    filterAndSortSessions(all, 'all', 'energy', true);
    // Source array left untouched by the internal copy-then-sort.
    expect(ids(all)).toEqual([1, 2, 3]);
  });
});
