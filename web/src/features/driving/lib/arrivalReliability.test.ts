import { beforeEach, describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';
import {
  analyzeArrivalReliability,
  normalizeArrivalTimeZone,
  normalizeRouteLocation,
  quantile,
  type ArrivalReliabilityOptions,
} from './arrivalReliability';

const NOW = Date.parse('2026-08-08T12:00:00.000Z');
let id = 1;

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: id++,
    vehicleId: 1,
    startTs: '2026-01-05T08:00:00.000Z',
    endTs: '2026-01-05T08:30:00.000Z',
    durationS: 1_800,
    distanceM: 20_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 37.1,
    startLon: -122.1,
    endLat: 37.2,
    endLon: -122.2,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 3_200,
    regenEnergyWh: 200,
    avgSpeedMps: 15,
    maxSpeedMps: 25,
    avgPowerW: 9_000,
    outsideTempAvgC: 15,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function analyze(
  drives: readonly Drive[],
  timeZone = 'UTC',
  options: ArrivalReliabilityOptions = {},
) {
  return analyzeArrivalReliability(drives, NOW, timeZone, options);
}

function expectFiniteTree(value: unknown): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(expectFiniteTree);
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(expectFiniteTree);
  }
}

beforeEach(() => {
  id = 1;
});

describe('route location and quantiles', () => {
  it('normalizes address case, punctuation, and whitespace', () => {
    const first = normalizeRouteLocation('  123 Main St. ', 1, 2);
    const second = normalizeRouteLocation('123 MAIN ST', 8, 9);

    expect(first?.key).toBe(second?.key);
    expect(first?.label).toBe('123 Main St.');
  });

  it('uses rounded valid coordinates when an address is absent', () => {
    expect(normalizeRouteLocation(null, 37.12349, -122.98751)).toEqual({
      key: 'geo:37.123,-122.988',
      label: '37.123, -122.988',
    });
    expect(normalizeRouteLocation('', 91, 0)).toBeNull();
    expect(normalizeRouteLocation(null, Number.NaN, 0)).toBeNull();
  });

  it('interpolates finite quantiles without mutating the sample', () => {
    const values = [40, 10, Number.NaN, 20, 30];
    const snapshot = values.slice();

    expect(quantile(values, 0.5)).toBe(25);
    expect(quantile([0, 10], 0.9)).toBe(9);
    expect(quantile([], 0.5)).toBeNaN();
    expect(values).toEqual(snapshot);
  });
});

describe('returned-row accounting', () => {
  it('assigns every returned row to exactly one mutually exclusive category', () => {
    const result = analyze([
      drive(),
      drive({ endTs: null }),
      drive({ startTs: 'not-a-date' }),
      drive({
        startTs: '2026-01-05T09:00:00.000Z',
        endTs: '2026-01-05T08:00:00.000Z',
      }),
      drive({
        startTs: '2026-09-05T08:00:00.000Z',
        endTs: '2026-09-05T08:30:00.000Z',
      }),
      drive({ durationS: 0 }),
      drive({
        startAddress: null,
        startLat: null,
        startLon: null,
      }),
    ]);
    const accounting = result.accounting;
    const total =
      accounting.includedRows
      + accounting.incompleteRows
      + accounting.invalidTimestampOrOrderRows
      + accounting.futureRows
      + accounting.invalidDurationRows
      + accounting.unlocatableRows;

    expect(accounting).toMatchObject({
      returnedRows: 7,
      includedRows: 1,
      excludedRows: 6,
      incompleteRows: 1,
      invalidTimestampOrOrderRows: 2,
      futureRows: 1,
      invalidDurationRows: 1,
      unlocatableRows: 1,
    });
    expect(total).toBe(accounting.returnedRows);
  });

  it('rejects invalid end timestamps, future ends, and equal end order', () => {
    const result = analyze([
      drive({ endTs: 'invalid' }),
      drive({ endTs: '2026-01-05T08:00:00.000Z' }),
      drive({ endTs: '2026-09-01T00:00:00.000Z' }),
    ]);

    expect(result.accounting.invalidTimestampOrOrderRows).toBe(2);
    expect(result.accounting.futureRows).toBe(1);
    expect(result.accounting.includedRows).toBe(0);
  });

  it('reports the requested cap when exactly the limit is returned', () => {
    const rows = Array.from({ length: 1_000 }, () => drive());
    const result = analyze(rows);

    expect(result.accounting.historyLimit).toBe(1_000);
    expect(result.accounting.historyCapReached).toBe(true);
  });
});

describe('explicit vehicle-timezone calendar fields', () => {
  it('buckets hour, weekday, local date, and month across a UTC boundary', () => {
    const rows = Array.from({ length: 3 }, (_, index) =>
      drive({
        startTs: `2026-01-01T01:${String(30 + index).padStart(2, '0')}:00.000Z`,
        endTs: `2026-01-01T02:${String(index).padStart(2, '0')}:00.000Z`,
      }),
    );
    const result = analyze(rows, 'America/Los_Angeles');

    expect(result.timeZone).toBe('America/Los_Angeles');
    expect(result.routes[0]?.windows[0]?.bucketStartHour).toBe(16);
    expect(result.weekdayProfile.find((point) => point.weekday === 3)?.samples).toBe(3);
    expect(result.monthTrend[0]?.monthKey).toBe('2025-12');
    expect(result.coverage.activeLocalDays).toBe(1);
  });

  it('falls back to UTC for an invalid timezone', () => {
    const rows = Array.from({ length: 3 }, () =>
      drive({
        startTs: '2026-01-01T01:30:00.000Z',
        endTs: '2026-01-01T02:00:00.000Z',
      }),
    );
    const result = analyze(rows, 'Mars/Olympus_Mons');

    expect(normalizeArrivalTimeZone('Mars/Olympus_Mons')).toBe('UTC');
    expect(result.timeZone).toBe('UTC');
    expect(result.routes[0]?.windows[0]?.bucketStartHour).toBe(0);
    expect(result.weekdayProfile.find((point) => point.weekday === 4)?.samples).toBe(3);
    expect(result.monthTrend[0]?.monthKey).toBe('2026-01');
  });

  it('treats offset-free ISO timestamps as UTC rather than browser local time', () => {
    const result = analyze(
      Array.from({ length: 3 }, () =>
        drive({
          startTs: '2026-01-05T08:00:00',
          endTs: '2026-01-05T08:30:00',
        }),
      ),
      'UTC',
    );

    expect(result.routes[0]?.windows[0]?.bucketStartHour).toBe(8);
  });
});

describe('support gates and descriptive timing semantics', () => {
  it('requires three route and route-window samples by default', () => {
    expect(analyze([drive(), drive()]).routes).toHaveLength(0);

    const splitWindows = analyze([
      drive(),
      drive(),
      drive({
        startTs: '2026-01-05T10:00:00.000Z',
        endTs: '2026-01-05T10:30:00.000Z',
      }),
    ]);
    expect(splitWindows.routes).toHaveLength(1);
    expect(splitWindows.supportedWindows).toHaveLength(0);

    const oneWindow = analyze([drive(), drive(), drive()]);
    expect(oneWindow.supportedWindows).toHaveLength(1);
  });

  it('uses the explicit in-sample route allowance share', () => {
    const result = analyze(
      [600, 600, 1_200].map((durationS) => drive({ durationS })),
    );
    const route = result.routes[0]!;

    expect(route.p50DurationS).toBe(600);
    expect(route.allowanceThresholdS).toBe(900);
    expect(route.withinAllowanceCount).toBe(2);
    expect(route.withinAllowanceShare).toBeCloseTo(2 / 3);
    expect(route.timingConsistencyIndex).toBeCloseTo(
      100 * (0.65 * (2 / 3) + 0.35),
    );
  });

  it('implements the disclosed scaled-MAD timing index formula', () => {
    const result = analyze(
      [600, 900, 1_200].map((durationS) => drive({ durationS })),
    );
    const route = result.routes[0]!;
    const scaledMad = 1.4826 * 300;
    const expected =
      100 * (0.65 + 0.35 * Math.exp(-scaledMad / 900));

    expect(route.robustSpreadS).toBeCloseTo(scaledMad);
    expect(route.relativeSpread).toBeCloseTo(scaledMad / 900);
    expect(route.timingConsistencyIndex).toBeCloseTo(expected);
    expect(route.p90BufferS).toBeCloseTo(240);
  });

  it('keeps route support separate and exposes its ingredients and band', () => {
    const thin = analyze([drive(), drive(), drive()]).routes[0]!;
    expect(thin.support.sampleVolumeIngredient).toBeCloseTo(3 / 12);
    expect(thin.support.activeDayIngredient).toBeCloseTo(1 / 8);
    expect(thin.support.activeWeekIngredient).toBeCloseTo(1 / 6);
    expect(thin.support.index).toBeCloseTo(
      100 * (0.45 * (3 / 12) + 0.3 * (1 / 8) + 0.25 * (1 / 6)),
    );
    expect(thin.support.band).toBe('thin');

    const strong = analyze(
      [drive(), drive(), drive()],
      'UTC',
      {
        strongRouteSamples: 3,
        strongRouteActiveDays: 1,
        strongRouteActiveWeeks: 1,
        strongGlobalDrives: 3,
        strongGlobalRoutes: 1,
        strongGlobalActiveWeeks: 1,
      },
    );
    expect(strong.routes[0]?.support.index).toBe(100);
    expect(strong.routes[0]?.support.band).toBe('strong');
    expect(strong.coverage.globalSupport.index).toBe(100);
    expect(strong.coverage.globalSupport.band).toBe('strong');
  });

  it('withholds duplicated extreme claims when only one window is supported', () => {
    const result = analyze([drive(), drive(), drive()]);

    expect(result.supportedWindows).toHaveLength(1);
    expect(result.soleSupportedWindow).not.toBeNull();
    expect(result.bestWindow).toBeNull();
    expect(result.worstWindow).toBeNull();
  });
});

describe('weighted aggregates and normalized profiles', () => {
  it('sample-weights route aggregates instead of averaging route rows', () => {
    const routeA = [600, 600, 1_200].map((durationS) =>
      drive({ durationS }),
    );
    const routeB = Array.from({ length: 6 }, () =>
      drive({
        startAddress: 'Gym',
        endAddress: 'School',
        durationS: 1_000,
      }),
    );
    const result = analyze([...routeA, ...routeB]);
    const first = result.routes.find((route) => route.label === 'Home → Office')!;
    const second = result.routes.find((route) => route.label === 'Gym → School')!;

    expect(result.aggregate.sampleWeightedP90BufferS).toBeCloseTo(
      (first.p90BufferS * 3 + second.p90BufferS * 6) / 9,
    );
    expect(result.aggregate.timingConsistencyIndex).toBeCloseTo(
      (first.timingConsistencyIndex * 3 + second.timingConsistencyIndex * 6) / 9,
    );
    expect(result.aggregate.withinAllowanceShare).toBeCloseTo(8 / 9);
  });

  it('normalizes different route baselines before profile aggregation', () => {
    const shortRoute = Array.from({ length: 3 }, () =>
      drive({ durationS: 600 }),
    );
    const longRoute = Array.from({ length: 3 }, () =>
      drive({
        startAddress: 'Gym',
        endAddress: 'School',
        durationS: 1_200,
      }),
    );
    const result = analyze([...shortRoute, ...longRoute]);
    const profile = result.twoHourProfile.find(
      (point) => point.bucketStartHour === 8,
    )!;

    expect(profile.samples).toBe(6);
    expect(profile.normalizedDurationIndex).toBeCloseTo(100);
    expect(profile.withinAllowanceShare).toBe(1);
  });

  it('exposes repeated coverage, unsupported counts, span, and concentration', () => {
    const result = analyze([
      drive(),
      drive(),
      drive(),
      drive({ startAddress: 'Solo', endAddress: 'Elsewhere' }),
    ]);

    expect(result.coverage.repeatedDrives).toBe(3);
    expect(result.coverage.unsupportedDrives).toBe(1);
    expect(result.coverage.supportedRoutes).toBe(1);
    expect(result.coverage.unsupportedRoutes).toBe(1);
    expect(result.coverage.repeatedRouteCoverage).toBe(0.75);
    expect(result.coverage.routeConcentration).toBe(0.75);
    expect(result.coverage.returnedSpanDays).toBe(0);
    expect(result.coverage.daysSinceLastIncludedObservation).toBeGreaterThan(0);
  });
});

describe('stability and hostile input', () => {
  it('uses deterministic route and window tie ordering', () => {
    const laterKey = Array.from({ length: 3 }, () =>
      drive({ startAddress: 'C', endAddress: 'D', durationS: 900 }),
    );
    const earlierKey = Array.from({ length: 3 }, () =>
      drive({ startAddress: 'A', endAddress: 'B', durationS: 900 }),
    );
    const result = analyze([...laterKey, ...earlierKey]);

    expect(result.routes.map((route) => route.label)).toEqual([
      'A → B',
      'C → D',
    ]);
    expect(result.routeRankings.map((route) => route.label)).toEqual([
      'A → B',
      'C → D',
    ]);
    expect(result.supportedWindows.map((window) => window.routeLabel)).toEqual([
      'A → B',
      'C → D',
    ]);
  });

  it('does not mutate drive order or drive objects', () => {
    const rows = [
      drive({ durationS: 1_200 }),
      drive({ durationS: 600 }),
      drive({ durationS: 900 }),
    ];
    const snapshot = JSON.parse(JSON.stringify(rows)) as Drive[];

    analyze(rows);

    expect(rows).toEqual(snapshot);
  });

  it('sanitizes hostile options and returns no non-finite analysis values', () => {
    const options: ArrivalReliabilityOptions = {
      minRouteSamples: 1,
      minWindowSamples: -20,
      historyLimit: Number.POSITIVE_INFINITY,
      strongRouteSamples: Number.NaN,
      strongRouteActiveDays: -1,
      strongRouteActiveWeeks: Number.POSITIVE_INFINITY,
      strongGlobalDrives: 0,
      strongGlobalRoutes: Number.NaN,
      strongGlobalActiveWeeks: -5,
    };
    const result = analyzeArrivalReliability(
      [
        drive({ durationS: Number.MAX_VALUE }),
        drive({ durationS: Number.MAX_VALUE }),
        drive({ durationS: Number.MAX_VALUE }),
      ],
      Number.NaN,
      'invalid/timezone',
      options,
    );

    expect(result.config.minRouteSamples).toBe(3);
    expect(result.config.minWindowSamples).toBe(3);
    expect(result.config.historyLimit).toBe(1_000);
    expect(result.timeZone).toBe('UTC');
    expectFiniteTree(result);
  });

  it('is null-safe for zero and one included sample', () => {
    const empty = analyze([]);
    const singleton = analyze([drive()]);

    expect(empty.routes).toEqual([]);
    expect(empty.aggregate.timingConsistencyIndex).toBeNull();
    expect(empty.aggregate.withinAllowanceShare).toBeNull();
    expect(singleton.routes).toEqual([]);
    expect(singleton.coverage.unsupportedDrives).toBe(1);
    expectFiniteTree(empty);
    expectFiniteTree(singleton);
  });
});
