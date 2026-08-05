import { describe, expect, it } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  analyzeArrivalReliability,
  normalizeRouteLocation,
  quantile,
} from './arrivalReliability';

let id = 1;

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: id++,
    vehicleId: 1,
    startTs: '2026-01-05T08:00:00',
    endTs: '2026-01-05T08:30:00',
    durationS: 1800,
    distanceM: 20_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 37.1,
    startLon: -122.1,
    endLat: 37.2,
    endLon: -122.2,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 3200,
    regenEnergyWh: 200,
    avgSpeedMps: 15,
    maxSpeedMps: 25,
    avgPowerW: 9000,
    outsideTempAvgC: 15,
    insideTempAvgC: 21,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('normalizeRouteLocation', () => {
  it('normalizes address case, punctuation, and whitespace', () => {
    const a = normalizeRouteLocation('  123 Main St. ', 1, 2);
    const b = normalizeRouteLocation('123 MAIN ST', 8, 9);
    expect(a?.key).toBe(b?.key);
    expect(a?.label).toBe('123 Main St.');
  });

  it('falls back to rounded valid coordinates', () => {
    expect(normalizeRouteLocation(null, 37.12349, -122.98751)).toEqual({
      key: 'geo:37.123,-122.988',
      label: '37.123, -122.988',
    });
    expect(normalizeRouteLocation('', 91, 0)).toBeNull();
    expect(normalizeRouteLocation(null, Number.NaN, 0)).toBeNull();
  });
});

describe('quantile', () => {
  it('interpolates and ignores non-finite values', () => {
    expect(quantile([40, 10, Number.NaN, 20, 30], 0.5)).toBe(25);
    expect(quantile([0, 10], 0.9)).toBe(9);
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe('analyzeArrivalReliability', () => {
  it('groups directional repeated routes and rejects singletons', () => {
    const drives = [
      drive({ durationS: 1000 }),
      drive({ startAddress: ' home ', endAddress: 'OFFICE', durationS: 1100 }),
      drive({ durationS: 1200 }),
      drive({ startAddress: 'Office', endAddress: 'Home' }),
    ];
    const result = analyzeArrivalReliability(drives);
    expect(result.analyzedDrives).toBe(4);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.samples).toBe(3);
    expect(result.repeatedDrives).toBe(3);
  });

  it('computes route quantiles, MAD spread, and on-time probability', () => {
    const durations = [600, 600, 600, 1200, 1800];
    const result = analyzeArrivalReliability(durations.map((durationS) => drive({ durationS })));
    const route = result.routes[0]!;
    expect(route.p50DurationS).toBe(600);
    expect(route.p90DurationS).toBe(1560);
    expect(route.robustSpreadS).toBe(0);
    expect(route.onTimeProbability).toBe(0.6);
    expect(route.reliabilityScore).toBeCloseTo(74);
  });

  it('builds two-hour windows and ranks stable ahead of erratic windows', () => {
    const morning = [900, 910, 920].map((durationS) =>
      drive({ startTs: '2026-01-05T08:15:00', durationS }),
    );
    const evening = [600, 1800, 3000].map((durationS) =>
      drive({ startTs: '2026-01-05T17:15:00', durationS }),
    );
    const result = analyzeArrivalReliability([...evening, ...morning]);
    expect(result.routes[0]?.windows.map((window) => window.bucketStartHour)).toEqual([8, 16]);
    expect(result.bestWindow?.bucketStartHour).toBe(8);
    expect(result.worstWindow?.bucketStartHour).toBe(16);
  });

  it('uses coordinate fallback to absorb small GPS jitter', () => {
    const result = analyzeArrivalReliability([
      drive({ startAddress: null, endAddress: null }),
      drive({ startAddress: null, endAddress: null, startLat: 37.1002, endLat: 37.2002 }),
      drive({ startAddress: null, endAddress: null, startLat: 37.1003, endLat: 37.2003 }),
    ]);
    expect(result.routes).toHaveLength(1);
  });

  it('skips incomplete, invalid-duration, invalid-time, and unlocatable drives', () => {
    const result = analyzeArrivalReliability([
      drive({ endTs: null }),
      drive({ durationS: 0 }),
      drive({ startTs: 'bad' }),
      drive({ startAddress: null, startLat: null, startLon: null }),
    ]);
    expect(result.analyzedDrives).toBe(0);
    expect(result.routes).toEqual([]);
    expect(result.overallReliabilityScore).toBeNull();
    expect(result.bestWindow).toBeNull();
  });

  it('honors sample thresholds and sanitizes invalid options', () => {
    const drives = [drive(), drive()];
    expect(analyzeArrivalReliability(drives).routes).toHaveLength(0);
    expect(analyzeArrivalReliability(drives, { minRouteSamples: 2 }).routes).toHaveLength(1);
    expect(analyzeArrivalReliability(drives, { minRouteSamples: -2 }).routes).toHaveLength(0);
  });
});
