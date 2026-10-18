/**
 * useCostAnalysisData — the Cost Analysis page's derivation hook.
 *
 * The suite drives the derivations with `renderHook`, retaining real date
 * formatting and timezone resolution over controlled saved preferences.
 *
 * Beyond the happy path it pins the four correctness bugs this file fixed, each
 * chosen so the assertion FAILS loudly against the pre-fix code:
 *   - Charging-session odometer deltas are not driven-distance evidence;
 *     distance-based totals, rates and comparisons remain unavailable.
 *   - lifetimeMetrics.freeEnergy summed raw Wh but is rendered as kWh — a
 *     1000× overstatement; it is now converted to kWh.
 *   - lifetimeMetrics.minSessionCost folded a literal 0 into `Math.min`, pinning
 *     the "cheapest paid session" to 0 whenever any paid session existed.
 * Coverage distinguishes recorded totals from paired cost/energy rates.
 * Nullable raw measurements retain missingness; unavailable numeric view
 * fields use NaN for the existing formatters, never an invented zero.
 *
 * Raw odometer observations remain separate from driven-distance metrics.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { ChargingSession } from '@/api/types';
import {
  KWH_PER_GALLON,
  CO2_PER_GAL_KG,
  KG_CO2_PER_TREE_YEAR,
} from './constants';
import { useCostAnalysisData } from './useCostAnalysisData';

const preferences = vi.hoisted(() => ({
  locale: 'en-US',
  tz_display_default: 'user' as 'user' | 'vehicle' | 'utc',
  timezone_user: 'UTC',
  vehicleTimezone: 'America/New_York',
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: preferences, locale: preferences.locale }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { timezone: preferences.vehicleTimezone } }),
}));
vi.mock('@/lib/timezone', async importOriginal => (
  await importOriginal<typeof import('@/lib/timezone')>()
));

beforeEach(() => {
  preferences.locale = 'en-US';
  preferences.tz_display_default = 'user';
  preferences.timezone_user = 'UTC';
  preferences.vehicleTimezone = 'America/New_York';
});

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
 *   A — Jan, Supercharger, 100 mi odometer delta, 10 kWh, $5, 60 min, 10:00
 *   B — Feb, Home,         100 mi odometer delta, 20 kWh, $4, 90 min, 14:00
 *   C — Feb, Public DC,    unknown odometer delta, 15 kWh, $0, 30 min, 22:30
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
      isMiles: params.toDistanceDisplay == null,
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

describe('useCostAnalysisData — denomination', () => {
  it('retains a normalized denomination and the existing populated USD results', () => {
    const result = render({
      sessions: [makeSession({ cost_currency: ' usd ', cost_decimal: 5 }), makeSession({ cost_decimal: -2 })],
    }).current;
    expect(result.currencySummary).toMatchObject({
      currency: 'USD', status: 'single', hasUnknownCurrency: false, unknownCostCount: 0,
      totalsByCurrency: [{ currency: 'USD', cost: 3 }],
    });
    expect(result.coreStats?.totalCost).toBe(3);
    expect(result.costPerKwhTrend.map(point => point.currency)).toEqual(['USD', 'USD']);
  });

  it('never sums unlike denominations or compares their rates, while retaining operational totals', () => {
    const result = render({
      sessions: [
        makeSession({ id: 1, cost_currency: 'USD', cost_decimal: 5 }),
        makeSession({ id: 2, cost_currency: ' eur ', cost_decimal: -2 }),
      ],
    }).current;
    expect(result.currencySummary).toMatchObject({
      currency: null, status: 'mixed', hasUnknownCurrency: false,
      totalsByCurrency: [{ currency: 'USD', cost: 5 }, { currency: 'EUR', cost: -2 }],
      recordedAmounts: [
        { sessionId: 1, amount: 5, currency: 'USD' },
        { sessionId: 2, amount: -2, currency: 'EUR' },
      ],
    });
    expect(result.operationalTotals).toEqual({ count: 2, energyKwh: 20, durationMinutes: 120, distanceM: NaN });
    expect(result.coreStats).toBeNull();
    expect(result.gasComparison).toBeNull();
    expect(result.lifetimeMetrics).toBeNull();
    expect(result.touInsights).toBeNull();
    expect(result.monthlyData).toEqual([]);
    expect(result.chargerTypeData).toEqual([]);
    expect(result.hourlyData).toEqual([]);
    expect(result.costPerKwhTrend).toEqual([]);
  });

  it.each([null, '', '   ', 'XXX', 'invalid'])('does not infer a denomination for %s, even for zero cost', cost_currency => {
    const result = render({
      sessions: [makeSession({ cost_currency, cost_decimal: 0 })],
    }).current;
    expect(result.currencySummary).toMatchObject({
      currency: null, status: 'unknown', hasUnknownCurrency: true,
      totalsByCurrency: [], recordedAmounts: [{ sessionId: 1, amount: 0, currency: null }],
    });
    expect(result.coreStats).toBeNull();
    expect(result.operationalTotals.energyKwh).toBe(10);
  });

  it('retains known denomination totals without assuming the currency of other recorded amounts', () => {
    const result = render({
      sessions: [makeSession({ cost_decimal: 5 }), makeSession({ id: 2, cost_currency: null, cost_decimal: 7 })],
    }).current;
    expect(result.currencySummary.status).toBe('unknown');
    expect(result.currencySummary.totalsByCurrency).toEqual([{ currency: 'USD', cost: 5 }]);
    expect(result.currencySummary.recordedAmounts[1]).toEqual({ sessionId: 2, amount: 7, currency: null });
    expect(result.coreStats).toBeNull();
  });

  it('retains EUR amounts without inventing an exchange rate or comparing against USD calculator seeds', () => {
    const result = render({ sessions: [makeSession({ cost_currency: 'EUR', cost_decimal: 5 })] }).current;
    expect(result.currencySummary.currency).toBe('EUR');
    expect(result.currencySummary.status).toBe('single');
    expect(result.currencySummary.totalsByCurrency).toEqual([{ currency: 'EUR', cost: 5 }]);
    expect(result.coreStats).toBeNull();
    expect(result.gasComparison).toBeNull();
    expect(result.monthlyData).toEqual([]);
    expect(result.operationalTotals.count).toBe(1);
  });

  it('flags missing amounts as partial without counting them as zero-cost observations', () => {
    const result = render({ sessions: [makeSession({ cost_decimal: null }), makeSession({ id: 2 })] }).current;
    expect(result.currencySummary.unknownCostCount).toBe(1);
    expect(result.currencySummary.recordedAmounts[0].amount).toBeNull();
    expect(result.currencySummary.totalsByCurrency).toEqual([{ currency: 'USD', cost: 5 }]);
    expect(result.coreStats?.totalCost).toBe(5);
    expect(result.lifetimeMetrics?.freeCount).toBe(0);
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
    expect(stats!.totalDistanceM).toBeNaN();

    const gallons = 45 / KWH_PER_GALLON;
    expect(stats!.gallonsEquiv).toBeCloseTo(gallons, 6);
    expect(stats!.gasCost).toBeCloseTo(gallons * 3.5, 6);
    expect(stats!.co2SavedKg).toBeCloseTo(gallons * CO2_PER_GAL_KG, 6);
    expect(stats!.treeEquiv).toBeCloseTo(
      (gallons * CO2_PER_GAL_KG) / KG_CO2_PER_TREE_YEAR,
      6,
    );
  });

  it('does not use charging odometer deltas as a driven-distance denominator', () => {
    const stats = render({ sessions: THREE }).current.coreStats!;
    expect(stats.costPerDist).toBeNaN();
  });

  it('keeps costPerDist unavailable regardless of display units (km path)', () => {
    const stats = render({
      sessions: THREE,
      toDistanceDisplay: (m) => m / 1000,
    }).current.coreStats!;
    expect(stats.costPerDist).toBeNaN();
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

  describe('useCostAnalysisData — accounting timezone and saved locale', () => {
    it('uses the saved timezone at month/day boundaries and the saved locale for trend labels', () => {
      preferences.locale = 'de-DE';
      preferences.timezone_user = 'America/Los_Angeles';
      const sessions = [
        makeSession({ id: 1, started_at: '2024-02-01T07:59:59Z' }),
        makeSession({ id: 2, started_at: '2024-02-01T08:00:00Z' }),
      ];
      const result = render({ sessions }).current;
      expect(result.accountingTimezone).toBe('America/Los_Angeles');
      expect(result.monthlyData.map(bucket => [bucket.month, bucket.sessions])).toEqual([
        ['2024-01', 1], ['2024-02', 1],
      ]);
      expect(result.hourlyData.filter(bucket => bucket.sessions).map(bucket => bucket.hour)).toEqual([0, 23]);
      expect(result.costPerKwhTrend.map(point => point.date)).toEqual(sessions.map(session => (
        new Date(session.started_at).toLocaleDateString('de-DE', {
          timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
        })
      )));
      expect(result.coreStats?.count).toBe(2);
      expect(result.coreStats?.totalCost).toBe(10);
      expect(result.dateCoverage).toEqual({ totalCount: 2, datedCount: 2, undatedCount: 0 });
    });

    it('recomputes dates and buckets when saved locale/timezone preferences change', () => {
      const sessions = [makeSession({ started_at: '2024-02-01T00:30:00Z' })];
      const { result, rerender } = renderHook(() => useCostAnalysisData({
        sessions, gasPrice: 3.5, mpg: 30, electricityRate: 0.13,
        toDistanceDisplay: toMiles, isMiles: true,
      }));
      expect(result.current.monthlyData[0].month).toBe('2024-02');
      preferences.locale = 'fr-FR';
      preferences.timezone_user = 'America/Los_Angeles';
      rerender();
      expect(result.current.accountingTimezone).toBe('America/Los_Angeles');
      expect(result.current.monthlyData[0].month).toBe('2024-01');
      expect(result.current.hourlyData[16].sessions).toBe(1);
      expect(result.current.costPerKwhTrend[0].date).toBe(
        new Date(sessions[0].started_at).toLocaleDateString('fr-FR', {
          timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
        }),
      );
      preferences.tz_display_default = 'vehicle';
      rerender();
      expect(result.current.accountingTimezone).toBe('America/New_York');
      expect(result.current.hourlyData[19].sessions).toBe(1);
      preferences.tz_display_default = 'utc';
      rerender();
      expect(result.current.accountingTimezone).toBe('UTC');
      expect(result.current.monthlyData[0].month).toBe('2024-02');
    });

    it('keeps the exact 22:00 inclusive / 06:00 exclusive off-peak boundaries', () => {
      preferences.timezone_user = 'Asia/Tokyo';
      const sessions = [
        '2024-01-15T12:59:59Z', // 21:59
        '2024-01-15T13:00:00Z', // 22:00
        '2024-01-15T20:59:59Z', // 05:59
        '2024-01-15T21:00:00Z', // 06:00
      ].map((started_at, id) => makeSession({ id, started_at }));
      const result = render({ sessions }).current;
      expect(result.touInsights?.offPeakPct).toBe(50);
      expect(result.hourlyData.reduce((sum, bucket) => sum + bucket.sessions, 0)).toBe(4);
      expect(result.coreStats?.count).toBe(4);
    });

    it('handles DST without shifting elapsed durations or losing repeated-hour sessions', () => {
      preferences.timezone_user = 'America/New_York';
      const result = render({ sessions: [
        makeSession({ id: 1, started_at: '2024-11-03T05:30:00Z', ended_at: '2024-11-03T06:30:00Z' }),
        makeSession({ id: 2, started_at: '2024-11-03T06:30:00Z', ended_at: '2024-11-03T07:30:00Z' }),
      ] }).current;
      expect(result.hourlyData[1].sessions).toBe(2);
      expect(result.coreStats?.totalDuration).toBe(120);
      expect(result.monthlyData[0].sessions).toBe(2);
    });

    it.each([null, undefined, '', 'not-a-date'])(
      'discloses an unbucketable start %s without losing financial or session counts',
      started_at => {
        const missing = { ...makeSession({ id: 2 }), started_at } as ChargingSession;
        const result = render({ sessions: [sessionA, missing] }).current;
        expect(result.dateCoverage).toEqual({ totalCount: 2, datedCount: 1, undatedCount: 1 });
        expect(result.coreStats?.count).toBe(2);
        expect(result.coreStats?.totalCost).toBe(10);
        expect(result.operationalTotals.count).toBe(2);
        expect(result.rawMeasurements[1].durationMinutes).toBeNull();
        expect(result.monthlyData.reduce((sum, bucket) => sum + bucket.sessions, 0)).toBe(1);
        expect(result.hourlyData.reduce((sum, bucket) => sum + bucket.sessions, 0)).toBe(1);
        expect(result.chargerTypeData.reduce((sum, bucket) => sum + bucket.sessions, 0)).toBe(2);
        expect(result.costPerKwhTrend).toHaveLength(1);
        expect(result.touInsights?.offPeakPct).toBe(0);
      },
    );
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
  it('identifies fixed off-peak boundaries as an assumption in the accounting timezone', () => {
    preferences.timezone_user = 'America/Los_Angeles';
    const result = render({ sessions: undefined }).current;
    expect(result.touAssumptions).toEqual({
      source: 'assumption',
      startHourInclusive: 22,
      endHourExclusive: 6,
      timezone: 'America/Los_Angeles',
    });
    expect(result.touInsights).toBeNull();
  });

  it('ranks recorded per-session spend, not utility rates or energy-normalized costs', () => {
    const result = render({ sessions: [
      makeSession({ id: 1, started_at: '2024-01-15T10:00:00Z', cost_decimal: 0.5, total_energy_added_wh: 250 }),
      makeSession({ id: 2, started_at: '2024-01-15T14:00:00Z', cost_decimal: 1.25, total_energy_added_wh: 10_000 }),
    ] }).current;
    expect(result.touInsights).toMatchObject({
      comparisonBasis: 'recorded-spend-per-session',
      cheapest: { hour: 10, avgCost: 0.5 },
      priciest: { hour: 14, avgCost: 1.25 },
      datedSessionCount: 2,
      undatedSessionCount: 0,
    });
    // Lower session spend does not imply a lower energy-paired rate.
    expect(result.hourlyData[10].coverage.rate).toBe(2);
    expect(result.hourlyData[14].coverage.rate).toBe(0.125);
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'does not rank an hour with missing/invalid spend %s as measured zero',
    cost_decimal => {
      const result = render({ sessions: [
        makeSession({ id: 1, started_at: '2024-01-15T10:00:00Z', cost_decimal }),
        makeSession({ id: 2, started_at: '2024-01-15T14:00:00Z', cost_decimal: 0 }),
      ] }).current;
      expect(result.hourlyData[10].avgCost).toBeNaN();
      expect(result.hourlyData[10].coverage.unknownCostCount).toBe(1);
      expect(result.touInsights?.cheapest).toMatchObject({ hour: 14, avgCost: 0 });
      expect(result.touInsights?.priciest).toMatchObject({ hour: 14, avgCost: 0 });
    },
  );

  it('retains signed fractional spend and does not require energy for a spend comparison', () => {
    const result = render({ sessions: [
      makeSession({ id: 1, started_at: '2024-01-15T10:00:00Z', cost_decimal: -0.125, total_energy_added_wh: null }),
      makeSession({ id: 2, started_at: '2024-01-15T10:30:00Z', cost_decimal: -0.375, total_energy_added_wh: NaN }),
      makeSession({ id: 3, started_at: '2024-01-15T14:00:00Z', cost_decimal: 0.125, total_energy_added_wh: 0 }),
    ] }).current;
    expect(result.touInsights?.cheapest).toMatchObject({ hour: 10, avgCost: -0.25 });
    expect(result.touInsights?.priciest).toMatchObject({ hour: 14, avgCost: 0.125 });
    expect(result.hourlyData[10].coverage.rate).toBeNull();
    expect(result.hourlyData[14].coverage.rate).toBeNull();
  });

  it('excludes undated sessions from the assumed-window share instead of treating them as on-peak', () => {
    const result = render({ sessions: [
      makeSession({ id: 1, started_at: '2024-01-15T22:00:00Z', cost_decimal: 0 }),
      makeSession({ id: 2, started_at: '2024-01-15T06:00:00Z', cost_decimal: null }),
      makeSession({ id: 3, started_at: 'invalid' }),
    ] }).current;
    expect(result.touInsights).toMatchObject({
      offPeakPct: 50, datedSessionCount: 2, undatedSessionCount: 1,
    });
    expect(result.coreStats?.count).toBe(3);
  });

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
  it('retains charging costs but does not model driving savings from charging odometers', () => {
    const gas = render({ sessions: THREE }).current.gasComparison;
    expect(gas).not.toBeNull();
    expect(gas!.gasCost).toBeNaN();
    expect(gas!.evCost).toBeCloseTo(45 * 0.13, 6);
    expect(gas!.actualCost).toBe(9);
    expect(gas!.savings).toBeNaN();
    expect(gas!.costPerMileGas).toBeNaN();
    expect(gas!.costPerMileEV).toBeNaN();
    expect(gas!.monthlySavings).toBeNaN();
    expect(gas!.yearlySavings).toBeNaN();
  });
});

describe('useCostAnalysisData — savings and observed-window disclosures', () => {
  it('separates rate-modeled savings from recorded-spend savings without changing populated calculations', () => {
    const result = render({ sessions: THREE }).current;
    const gasCost = (45 / KWH_PER_GALLON) * 3.5;
    expect(result.coreStats?.savingsDisclosure).toEqual({
      basis: 'energy-content-equivalence',
      modeledEvCost: 45 * 0.13,
      modeledSavings: gasCost - 45 * 0.13,
      actualSavings: gasCost - 9,
    });
    expect(result.coreStats?.gasCost).toBe(gasCost);
    expect(result.coreStats?.savings).toBe(gasCost - 9);
    for (const month of result.monthlyData) {
      expect(month.savingsDisclosure.modeledEvCost).toBe(month.energy * 0.13);
      expect(month.savingsDisclosure.modeledSavings).toBe(month.gasEquiv - month.energy * 0.13);
      expect(month.savingsDisclosure.actualSavings).toBe(month.savings);
      expect(month.accountingMonthCompleteness).toBe('unknown');
    }
    expect(result.gasComparison).toMatchObject({
      basis: 'driven-distance',
      unavailableReason: 'no-verified-driven-distance',
      modeledSavings: null, actualSavings: null, projectionStatus: 'unavailable',
      gasCost: NaN, savings: NaN, monthlySavings: NaN, yearlySavings: NaN,
      actualCost: 9, evCost: 45 * 0.13,
    });
  });

  it('changes only the modeled savings when the assumed electricity rate changes', () => {
    const low = render({ sessions: THREE, electricityRate: 0.1 }).current;
    const high = render({ sessions: THREE, electricityRate: 0.4 }).current;
    expect(low.coreStats?.savingsDisclosure.modeledSavings)
      .not.toBe(high.coreStats?.savingsDisclosure.modeledSavings);
    expect(low.coreStats?.savingsDisclosure.actualSavings).toBe(high.coreStats?.savings);
    expect(low.monthlyData.map(month => month.savings))
      .toEqual(high.monthlyData.map(month => month.savings));
  });

  it('keeps modeled savings available with unknown spend, but never invents actual savings', () => {
    const result = render({ sessions: [makeSession({ cost_decimal: null })] }).current;
    expect(result.coreStats?.savingsDisclosure).toMatchObject({
      modeledEvCost: 1.3, actualSavings: null,
    });
    expect(result.coreStats?.savingsDisclosure.modeledSavings)
      .toBeCloseTo((10 / KWH_PER_GALLON) * 3.5 - 1.3);
    expect(result.monthlyData[0].savingsDisclosure.actualSavings).toBeNull();
    expect(result.coreStats?.savings).toBeNaN();
  });

  it('discloses unavailable model inputs independently of recorded-spend savings', () => {
    const invalidRate = render({ sessions: THREE, electricityRate: Infinity }).current;
    expect(invalidRate.coreStats?.savingsDisclosure.modeledEvCost).toBeNull();
    expect(invalidRate.coreStats?.savingsDisclosure.modeledSavings).toBeNull();
    expect(invalidRate.coreStats?.savingsDisclosure.actualSavings).toBe(invalidRate.coreStats?.savings);
    const missingEnergy = render({ sessions: [makeSession({ total_energy_added_wh: null })] }).current;
    expect(missingEnergy.coreStats?.savingsDisclosure).toMatchObject({
      modeledEvCost: null, modeledSavings: null, actualSavings: null,
    });
  });

  it('reports loaded start bounds and observed months, not complete or continuously covered months', () => {
    preferences.timezone_user = 'America/Los_Angeles';
    const result = render({ sessions: [
      makeSession({ id: 1, started_at: '2024-04-01T07:00:00Z' }),
      makeSession({ id: 2, started_at: 'invalid' }),
      makeSession({ id: 3, started_at: '2024-02-01T07:59:59Z' }),
    ] }).current;
    expect(result.observedWindow).toEqual({
      source: 'loaded-session-starts',
      firstSessionStart: '2024-02-01T07:59:59.000Z',
      lastSessionStart: '2024-04-01T07:00:00.000Z',
      observedMonthCount: 2,
      accountingMonthCompleteness: 'unknown',
    });
    expect(result.dateCoverage).toEqual({ totalCount: 3, datedCount: 2, undatedCount: 1 });
    expect(result.monthlyData.map(month => month.month)).toEqual(['2024-01', '2024-04']);
    expect(result.monthlyData.every(month => month.accountingMonthCompleteness === 'unknown')).toBe(true);
    expect(result.coreStats?.count).toBe(3);
  });

  it.each([undefined, [], [makeSession({ started_at: 'invalid' })]])(
    'does not fabricate an observed window when no valid start is loaded (%s)', sessions => {
      expect(render({ sessions }).current.observedWindow).toEqual({
        source: 'loaded-session-starts',
        firstSessionStart: null, lastSessionStart: null, observedMonthCount: 0,
        accountingMonthCompleteness: 'unknown',
      });
    },
  );
});

describe('useCostAnalysisData — charging odometer evidence', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'retains missing/invalid odometer %s as unknown for either endpoint',
    value => {
      for (const endpoints of [
        { start_odometer_m: value, end_odometer_m: 100 },
        { start_odometer_m: 100, end_odometer_m: value },
      ]) {
        const result = render({ sessions: [makeSession(endpoints)] }).current;
        expect(result.rawMeasurements[0].distanceM).toBeNull();
        expect(result.operationalTotals.distanceM).toBeNaN();
        expect(result.coreStats?.totalDistanceM).toBeNaN();
        expect(result.coreStats?.costPerDist).toBeNaN();
        expect(result.gasComparison?.gasCost).toBeNaN();
      }
    },
  );

  it.each([
    [0, 0, 0],
    [100, 100, 0],
    [100, 125, 25],
    [100, 75, -25],
    [100, 100.125, 0.125],
    [100, 99.875, -0.125],
  ])('retains the measured delta %s → %s as %s, without inferring driving', (start, end, delta) => {
    const toDistanceDisplay = vi.fn(toMiles);
    const result = render({
      sessions: [makeSession({ start_odometer_m: start, end_odometer_m: end })],
      toDistanceDisplay,
    }).current;
    expect(result.rawMeasurements[0].distanceM).toBe(delta);
    expect(result.operationalTotals.distanceM).toBeNaN();
    expect(result.coreStats?.totalDistanceM).toBeNaN();
    expect(result.coreStats?.costPerDist).toBeNaN();
    expect(result.gasComparison).toMatchObject({
      gasCost: NaN, savings: NaN, monthlySavings: NaN, yearlySavings: NaN,
      costPerMileGas: NaN, costPerMileEV: NaN,
      actualCost: 5, evCost: 1.3,
    });
    expect(toDistanceDisplay).not.toHaveBeenCalled();
  });

  it('retains an overflowing delta as unknown rather than driving evidence', () => {
    const result = render({ sessions: [makeSession({
      start_odometer_m: -Number.MAX_VALUE,
      end_odometer_m: Number.MAX_VALUE,
    })] }).current;
    expect(result.rawMeasurements[0].distanceM).toBeNull();
    expect(result.coreStats?.costPerDist).toBeNaN();
  });

  it('does not turn invalid session dates into zero monthly driving savings', () => {
    const result = render({ sessions: [makeSession({ started_at: 'invalid' })] }).current;
    expect(result.monthlyData).toEqual([]);
    expect(result.gasComparison?.monthlySavings).toBeNaN();
    expect(result.gasComparison?.yearlySavings).toBeNaN();
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

  it('retains 0 min/max with one free and one unknown-cost session without counting unknown as free', () => {
    const free = [
      makeSession({ id: 10, cost_decimal: 0 }),
      makeSession({ id: 11, cost_decimal: null }),
    ];
    const life = render({ sessions: free }).current.lifetimeMetrics!;
    expect(life.minSessionCost).toBe(0);
    expect(life.maxSessionCost).toBe(0);
    expect(life.freeCount).toBe(1);
    expect(life.freeEnergy).toBe(10);
  });

  it('excludes unknown cost from free count and energy without dropping it from loaded history totals', () => {
    const sessions = [
      makeSession({ id: 10, cost_decimal: 0, total_energy_added_wh: 0 }),
      makeSession({ id: 11, cost_decimal: 0, total_energy_added_wh: 15_000 }),
      makeSession({ id: 12, cost_decimal: null, total_energy_added_wh: 80_000 }),
      makeSession({ id: 13, cost_decimal: 4, total_energy_added_wh: 20_000 }),
    ];
    const result = render({ sessions }).current;
    expect(result.lifetimeMetrics?.freeCount).toBe(2);
    expect(result.lifetimeMetrics?.freeEnergy).toBe(15);
    expect(result.coreStats?.count).toBe(4);
    expect(result.coreStats?.totalEnergy).toBe(115);
    expect(result.coreStats?.totalCost).toBe(4);
    expect(result.costPerKwhTrend.map(point => point.costPerKwh)).toEqual([0, 0.2]);
  });

  it('counts no free sessions when all recorded costs are unknown', () => {
    const result = render({
      sessions: [makeSession({ cost_decimal: null, total_energy_added_wh: 80_000 })],
    }).current;
    expect(result.lifetimeMetrics?.freeCount).toBe(0);
    expect(result.lifetimeMetrics?.freeEnergy).toBe(0);
    expect(result.coreStats?.count).toBe(1);
    expect(result.coreStats?.totalEnergy).toBe(80);
    expect(result.costPerKwhTrend).toEqual([]);
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

  it('marks an unmeasured energy total as unknown rather than measured zero', () => {
    const noEnergy = makeSession({
      id: 21,
      total_energy_added_wh: undefined,
      cost_decimal: 5,
    });
    const result = render({ sessions: [noEnergy] });
    const stats = result.current.coreStats!;
    expect(stats.totalEnergy).toBeNaN();
    expect(result.current.coverage.unknownEnergyCount).toBe(1);
    expect(Number.isFinite(result.current.lifetimeMetrics!.freeEnergy)).toBe(true);
  });

  it('marks an invalid mpg as unknown rather than free gasoline', () => {
    const result = render({ sessions: THREE, mpg: 0 });
    const gas = result.current.gasComparison!;
    expect(gas.gasCost).toBeNaN();
    expect(gas.costPerMileGas).toBeNaN();
    expect(
      result.current.monthlyData.every(
        (m) => Number.isFinite(m.gasEquiv) && Number.isFinite(m.savings),
      ),
    ).toBe(true);
  });

  describe('useCostAnalysisData — measurement coverage', () => {
    it('uses matched cost/energy observations for partial rates, not all loaded energy', () => {
      const result = render({ sessions: [
        makeSession({ id: 1, cost_decimal: 0, total_energy_added_wh: 500 }),
        makeSession({ id: 2, cost_decimal: -0.25, total_energy_added_wh: 250 }),
        makeSession({ id: 3, cost_decimal: null, total_energy_added_wh: 10_000 }),
        makeSession({ id: 4, cost_decimal: 2, total_energy_added_wh: null }),
      ] }).current;
      expect(result.coverage).toMatchObject({
        pricedCount: 3, energyCount: 3, pairedCount: 2,
        unknownCostCount: 1, unknownEnergyCount: 1,
        pricedEnergyWh: 750, rateStatus: 'partial',
      });
      expect(result.coverage.rate).toBeCloseTo(-1 / 3);
      expect(result.coreStats?.totalCost).toBe(1.75);
      expect(result.coreStats?.totalEnergy).toBe(10.75);
      expect(result.coreStats?.avgCostPerKwh).toBeCloseTo(-1 / 3);
      expect(result.monthlyData[0].coverage).toEqual(result.coverage);
      expect(result.monthlyData[0].avgCostPerKwh).toBeCloseTo(-1 / 3);
      expect(result.chargerTypeData[0].coverage).toEqual(result.coverage);
      const hour = result.hourlyData.find(h => h.sessions > 0)!;
      expect(hour.coverage).toEqual(result.coverage);
      expect(hour.avgCost).toBeCloseTo(1.75 / 3);
      expect(result.touInsights).toBeNull();
      expect(result.coreStats?.savings).toBeNaN();
      expect(result.gasComparison?.evCost).toBeNaN();
      expect(result.lifetimeMetrics?.avgSessionCost).toBeCloseTo(1.75 / 3);
      expect(result.lifetimeMetrics?.avgSessionEnergy).toBeCloseTo(10.75 / 3);
      expect(result.lifetimeMetrics?.minSessionCost).toBe(-0.25);
      expect(result.lifetimeMetrics?.freeCount).toBe(1);
    });

    it.each([null, undefined, NaN, Infinity, -Infinity])(
      'keeps missing/invalid cost %s distinct from measured zero',
      cost_decimal => {
        const result = render({ sessions: [makeSession({ cost_decimal })] }).current;
        expect(result.rawMeasurements[0].cost).toBeNull();
        expect(result.coverage).toMatchObject({
          pricedCount: 0, unknownCostCount: 1, rate: null, rateStatus: 'unknown',
        });
        expect(result.coreStats?.avgCostPerKwh).toBeNaN();
        expect(result.monthlyData[0].avgCostPerKwh).toBeNaN();
        expect(result.hourlyData.find(h => h.sessions)?.avgCost).toBeNaN();
        expect(result.lifetimeMetrics?.avgSessionCost).toBeNaN();
        expect(result.lifetimeMetrics?.maxSessionCost).toBeNaN();
        expect(result.lifetimeMetrics?.minSessionCost).toBeNaN();
        expect(result.lifetimeMetrics?.freeCount).toBe(0);
        expect(result.costPerKwhTrend).toEqual([]);
      },
    );

    it.each([null, undefined, NaN, Infinity, -Infinity])(
      'keeps missing/invalid energy %s distinct from measured zero',
      total_energy_added_wh => {
        const result = render({ sessions: [makeSession({ total_energy_added_wh, cost_decimal: 0 })] }).current;
        expect(result.rawMeasurements[0].energyWh).toBeNull();
        expect(result.coverage).toMatchObject({ unknownEnergyCount: 1, rate: null, rateStatus: 'unknown' });
        expect(result.operationalTotals.energyKwh).toBe(0);
        expect(result.coreStats?.avgCostPerKwh).toBeNaN();
        expect(result.lifetimeMetrics?.freeCount).toBe(1);
        expect(result.lifetimeMetrics?.freeEnergy).toBeNaN();
        expect(result.lifetimeMetrics?.avgSessionEnergy).toBeNaN();
        expect(result.costPerKwhTrend).toEqual([]);
      },
    );

    it('retains genuine free rates and distinguishes a measured zero denominator', () => {
      const free = render({ sessions: [makeSession({ cost_decimal: 0, total_energy_added_wh: 250 })] }).current;
      expect(free.coverage).toMatchObject({ rate: 0, rateStatus: 'complete', unknownCostCount: 0 });
      expect(free.coreStats?.avgCostPerKwh).toBe(0);
      expect(free.lifetimeMetrics?.freeEnergy).toBe(0.25);
      const zero = render({ sessions: [makeSession({ cost_decimal: 0, total_energy_added_wh: 0 })] }).current;
      expect(zero.rawMeasurements[0]).toMatchObject({ cost: 0, energyWh: 0 });
      expect(zero.coverage).toMatchObject({ energyCount: 1, unknownEnergyCount: 0, rate: null });
      expect(zero.coreStats?.avgCostPerKwh).toBeNaN();
      expect(zero.lifetimeMetrics?.avgSessionEnergy).toBe(0);
    });

    it('retains measured zero and signed calculator prices, but rejects invalid prices', () => {
      const zero = render({ sessions: [sessionA], gasPrice: 0, electricityRate: 0 }).current;
      expect(zero.coreStats?.gasCost).toBe(0);
      expect(zero.gasComparison?.gasCost).toBeNaN();
      expect(zero.gasComparison?.evCost).toBe(0);
      const signed = render({ sessions: [sessionA], gasPrice: -0.5, electricityRate: -0.125 }).current;
      expect(signed.coreStats?.gasCost).toBeCloseTo(-10 / KWH_PER_GALLON * 0.5);
      expect(signed.gasComparison?.gasCost).toBeNaN();
      expect(signed.gasComparison?.evCost).toBe(-1.25);
      const invalid = render({ sessions: [sessionA], gasPrice: Infinity, electricityRate: NaN }).current;
      expect(invalid.coreStats?.gasCost).toBeNaN();
      expect(invalid.gasComparison?.gasCost).toBeNaN();
      expect(invalid.gasComparison?.evCost).toBeNaN();
    });

    it('retains signed and fractional energy without rounding or treating it as missing', () => {
      const result = render({ sessions: [
        makeSession({ cost_decimal: -0.125, total_energy_added_wh: -250.5 }),
        makeSession({ id: 2, cost_decimal: 0.375, total_energy_added_wh: 750.5 }),
      ] }).current;
      expect(result.rawMeasurements[0]).toMatchObject({ cost: -0.125, energyWh: -250.5 });
      expect(result.coverage).toMatchObject({ energyCount: 2, rate: 0.5, rateStatus: 'complete' });
      expect(result.coreStats?.totalEnergy).toBe(0.5);
      expect(result.coreStats?.totalCost).toBe(0.25);
    });

    it('preserves unknown duration/distance and fractional or zero elapsed time before rendering', () => {
      const result = render({ sessions: [
        makeSession({ ended_at: null }),
        makeSession({ id: 2, ended_at: '2024-01-15T10:00:30Z', start_odometer_m: 10, end_odometer_m: 9.5 }),
        makeSession({ id: 3, ended_at: '2024-01-15T10:00:00Z', start_odometer_m: 0, end_odometer_m: 0 }),
      ] }).current;
      expect(result.rawMeasurements.map(s => s.durationMinutes)).toEqual([null, 0.5, 0]);
      expect(result.rawMeasurements.map(s => s.distanceM)).toEqual([null, -0.5, 0]);
      expect(result.lifetimeMetrics?.avgDuration).toBe(0.25);
    });
  });
});
