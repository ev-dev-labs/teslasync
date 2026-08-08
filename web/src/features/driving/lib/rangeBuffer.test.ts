import { describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';
import {
  analyzeRangeBuffer,
  rangeBufferQuantile,
} from './rangeBuffer';

const NOW = Date.parse('2026-08-08T12:00:00.000Z');
let nextId = 1;

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: nextId++,
    vehicleId: 7,
    startTs: '2026-08-01T08:00:00.000Z',
    endTs: '2026-08-01T08:30:00.000Z',
    durationS: 1_800,
    distanceM: 20_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 37.1,
    startLon: -122.1,
    endLat: 37.2,
    endLon: -122.2,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: 2_000,
    regenEnergyWh: 200,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 4_000,
    outsideTempAvgC: 20,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-01T08:30:00.000Z',
    ...overrides,
  };
}

describe('analyzeRangeBuffer', () => {
  it('puts every returned row into one primary accounting category', () => {
    const result = analyzeRangeBuffer(
      [
        drive(),
        drive({ endTs: null }),
        drive({ startTs: 'invalid' }),
        drive({
          startTs: '2026-08-01T09:00:00.000Z',
          endTs: '2026-08-01T08:00:00.000Z',
        }),
        drive({
          startTs: '2026-09-01T08:00:00.000Z',
          endTs: '2026-09-01T08:30:00.000Z',
        }),
        drive({ endBatteryPct: null }),
        drive({ endBatteryPct: 101 }),
      ],
      NOW,
      'UTC',
    );

    expect(result.accounting).toMatchObject({
      returnedRows: 7,
      includedRows: 1,
      excludedRows: 6,
      incompleteRows: 1,
      invalidTimestampOrOrderRows: 2,
      futureRows: 1,
      invalidArrivalRows: 2,
    });
    expect(
      result.accounting.includedRows + result.accounting.excludedRows,
    ).toBe(result.accounting.returnedRows);
  });

  it('computes interpolated quantiles and strict threshold shares', () => {
    const result = analyzeRangeBuffer(
      [10, 20, 30, 40, 50].map((arrival) =>
        drive({ endBatteryPct: arrival }),
      ),
      NOW,
      'UTC',
      { thresholdPct: 30 },
    );

    expect(result.summary).toMatchObject({
      samples: 5,
      p10Pct: 14,
      p25Pct: 20,
      medianPct: 30,
      p75Pct: 40,
      p90Pct: 46,
      minimumPct: 10,
      maximumPct: 50,
      belowThresholdCount: 2,
      belowThresholdShare: 0.4,
    });
  });

  it('keeps 100 percent in the top histogram bucket', () => {
    const result = analyzeRangeBuffer(
      [0, 9.9, 55, 100].map((arrival) =>
        drive({ endBatteryPct: arrival }),
      ),
      NOW,
      'UTC',
    );

    expect(result.buckets).toHaveLength(10);
    expect(result.buckets[0]).toMatchObject({ count: 2, share: 0.5 });
    expect(result.buckets[5]).toMatchObject({ count: 1, share: 0.25 });
    expect(result.buckets[9]).toMatchObject({ count: 1, share: 0.25 });
  });

  it('uses the vehicle timezone for month, weekday, and hour profiles', () => {
    const result = analyzeRangeBuffer(
      [
        drive({
          startTs: '2026-03-01T07:20:00.000Z',
          endTs: '2026-03-01T07:50:00.000Z',
          endBatteryPct: 44,
        }),
      ],
      NOW,
      'America/Los_Angeles',
    );

    expect(result.monthTrend[0]?.monthKey).toBe('2026-02');
    expect(result.weekdayProfile[5]?.samples).toBe(1);
    expect(result.hourProfile[5]?.samples).toBe(1);
  });

  it('falls back to UTC for an invalid timezone', () => {
    const result = analyzeRangeBuffer(
      [drive()],
      NOW,
      'Not/A_Timezone',
    );

    expect(result.timeZone).toBe('UTC');
  });

  it('uses the selected threshold across profiles and sensitivity', () => {
    const result = analyzeRangeBuffer(
      [15, 25, 35].map((arrival) =>
        drive({ endBatteryPct: arrival }),
      ),
      NOW,
      'UTC',
      { thresholdPct: 25 },
    );

    expect(result.summary.belowThresholdCount).toBe(1);
    expect(
      result.thresholdSensitivity.find(
        (point) => point.thresholdPct === 25,
      ),
    ).toMatchObject({ count: 1, share: 1 / 3 });
    expect(result.weekdayProfile[5]?.belowThresholdCount).toBe(1);
  });

  it('limits the visible trend to the newest configured local months', () => {
    const rows = Array.from({ length: 6 }, (_, month) =>
      drive({
        startTs: `2026-0${month + 1}-05T08:00:00.000Z`,
        endTs: `2026-0${month + 1}-05T08:30:00.000Z`,
      }),
    );
    const result = analyzeRangeBuffer(rows, NOW, 'UTC', {
      maxTrendMonths: 3,
    });

    expect(result.monthTrend.map((point) => point.monthKey)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
    expect(result.coverage).toMatchObject({
      returnedTrendMonths: 6,
      displayedTrendMonths: 3,
      omittedTrendMonths: 3,
    });
  });

  it('assigns exact distance boundaries to the next SI band', () => {
    const result = analyzeRangeBuffer(
      [
        drive({ distanceM: 9_999 }),
        drive({ distanceM: 10_000 }),
        drive({ distanceM: 25_000 }),
        drive({ distanceM: 100_000 }),
        drive({ distanceM: NaN }),
      ],
      NOW,
      'UTC',
    );

    expect(result.distanceProfile.map((point) => point.samples)).toEqual([
      1, 1, 1, 0, 1,
    ]);
    expect(result.driveContext).toMatchObject({
      distanceRows: 4,
      invalidDistanceRows: 1,
    });
  });

  it('separates valid depletion rows from increasing and invalid start SoC', () => {
    const result = analyzeRangeBuffer(
      [
        drive({ startBatteryPct: 80, endBatteryPct: 60 }),
        drive({ startBatteryPct: 40, endBatteryPct: 45 }),
        drive({ startBatteryPct: null, endBatteryPct: 50 }),
        drive({ startBatteryPct: 120, endBatteryPct: 50 }),
      ],
      NOW,
      'UTC',
    );

    expect(result.driveContext).toMatchObject({
      startSocRows: 2,
      invalidStartSocRows: 2,
      depletionRows: 1,
      increasingSocRows: 1,
      medianStartPct: 60,
      medianDropPct: 20,
      p90DropPct: 20,
    });
  });

  it('normalizes address destinations and supports coordinate fallback', () => {
    const result = analyzeRangeBuffer(
      [
        drive({ endAddress: ' Office  Garage ' }),
        drive({ endAddress: 'office garage' }),
        drive({ endAddress: 'OFFICE GARAGE' }),
        drive({
          endAddress: null,
          endLat: 37.12341,
          endLon: -122.98761,
        }),
        drive({
          endAddress: null,
          endLat: 37.12344,
          endLon: -122.98764,
        }),
        drive({
          endAddress: null,
          endLat: 37.12342,
          endLon: -122.98762,
        }),
      ],
      NOW,
      'UTC',
      { minDestinationSamples: 3 },
    );

    expect(result.destinationCoverage).toMatchObject({
      locatableRows: 6,
      groupedDestinations: 2,
      supportedDestinations: 2,
      supportedRows: 6,
      repeatedCoverage: 1,
    });
    expect(
      result.destinationProfiles
        .map((profile) => profile.source)
        .sort(),
    ).toEqual(['address', 'coordinates']);
  });

  it('keeps unsupported and unlocatable destination rows visible in coverage', () => {
    const result = analyzeRangeBuffer(
      [
        drive({ endAddress: 'Office' }),
        drive({ endAddress: 'Office' }),
        drive({ endAddress: 'Gym' }),
        drive({
          endAddress: null,
          endLat: null,
          endLon: null,
        }),
      ],
      NOW,
      'UTC',
      { minDestinationSamples: 3 },
    );

    expect(result.destinationProfiles).toEqual([]);
    expect(result.destinationCoverage).toMatchObject({
      locatableRows: 3,
      unlocatableRows: 1,
      groupedDestinations: 2,
      supportedDestinations: 0,
      unsupportedRows: 3,
      repeatedCoverage: 0,
    });
  });

  it('returns at most ten lowest arrivals with deterministic tie ordering', () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      drive({
        id: index + 1,
        startTs: `2026-08-01T${String(index).padStart(2, '0')}:00:00.000Z`,
        endTs: `2026-08-01T${String(index).padStart(2, '0')}:30:00.000Z`,
        endBatteryPct: index,
      }),
    );
    const result = analyzeRangeBuffer(rows, NOW, 'UTC');

    expect(result.lowArrivals).toHaveLength(10);
    expect(result.lowArrivals.map((row) => row.arrivalPct)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it('freezes recency and reports active local support explicitly', () => {
    const result = analyzeRangeBuffer(
      [
        drive({
          startTs: '2026-08-01T08:00:00.000Z',
          endTs: '2026-08-01T08:30:00.000Z',
        }),
        drive({
          startTs: '2026-08-08T08:00:00.000Z',
          endTs: '2026-08-08T08:30:00.000Z',
        }),
      ],
      NOW,
      'UTC',
    );

    expect(result.coverage).toMatchObject({
      activeLocalDays: 2,
      activeLocalWeeks: 2,
      observedSpanDays: 8,
    });
    expect(result.coverage.daysSinceLastObservation).toBeCloseTo(3.5 / 24);
    expect(result.coverage.support.recency.score).toBe(1);
  });

  it('discloses an exact return-cap hit', () => {
    const rows = Array.from({ length: 5 }, () => drive());
    const result = analyzeRangeBuffer(rows, NOW, 'UTC', {
      historyLimit: 5,
    });

    expect(result.accounting.historyCapReached).toBe(true);
  });

  it('returns stable empty structures without making evidence claims', () => {
    const result = analyzeRangeBuffer([], NOW, 'UTC');

    expect(result.summary.medianPct).toBeNull();
    expect(result.summary.belowThresholdShare).toBeNull();
    expect(result.destinationProfiles).toEqual([]);
    expect(result.lowArrivals).toEqual([]);
    expect(result.coverage.support).toMatchObject({
      index: 0,
      band: 'none',
    });
    expect(result.weekdayProfile).toHaveLength(7);
    expect(result.hourProfile).toHaveLength(6);
  });

  it('does not mutate the returned drive history', () => {
    const rows = [
      drive({ endBatteryPct: 80 }),
      drive({ endBatteryPct: 20 }),
    ];
    const snapshot = structuredClone(rows);

    analyzeRangeBuffer(rows, NOW, 'UTC');

    expect(rows).toEqual(snapshot);
  });

  it('rejects a non-finite analysis clock', () => {
    expect(() => analyzeRangeBuffer([], NaN, 'UTC')).toThrow(RangeError);
  });
});

describe('rangeBufferQuantile', () => {
  it('interpolates without mutating the source array', () => {
    const values = [30, 10, 20];
    expect(rangeBufferQuantile(values, 0.25)).toBe(15);
    expect(values).toEqual([30, 10, 20]);
  });

  it('returns null for no observations', () => {
    expect(rangeBufferQuantile([], 0.5)).toBeNull();
  });
});
