import { beforeEach, describe, expect, it } from 'vitest';
import type { Drive } from '@/types/driving';
import { computeSweetSpot } from './speedSweetSpot';

let nextId = 1;

function drive(speedKph: number, whPerKm: number, over: Partial<Drive> = {}): Drive {
  const distanceM = over.distanceM ?? 10_000;
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: null,
    durationS: 600,
    distanceM,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: whPerKm * (distanceM / 1_000),
    regenEnergyWh: null,
    avgSpeedMps: speedKph / 3.6,
    maxSpeedMps: (speedKph + 20) / 3.6,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

beforeEach(() => {
  nextId = 1;
});

describe('computeSweetSpot', () => {
  it('finds the lowest-consumption qualified bucket and runner-up contrast', () => {
    const result = computeSweetSpot([
      drive(52, 130), drive(55, 140), drive(58, 135),
      drive(102, 190), drive(105, 200), drive(108, 195),
    ]);

    expect(result.eligible).toBe(6);
    expect(result.sweetSpot).toMatchObject({
      fromKph: 50,
      toKph: 60,
      whPerKm: 135,
      drives: 3,
    });
    expect(result.qualifiedBandCount).toBe(2);
    expect(result.runnerUp?.band.fromKph).toBe(100);
    expect(result.runnerUp?.gapWhPerKm).toBe(60);
    expect(result.runnerUp?.gapShare).toBeCloseTo(60 / 135);
    expect(result.bands.map((band) => band.rank)).toEqual([1, 2]);
  });

  it('keeps sparse buckets visible but does not let them qualify', () => {
    const result = computeSweetSpot([
      drive(52, 100),
      drive(102, 190), drive(105, 200), drive(108, 195),
    ]);

    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toMatchObject({ qualified: false, drives: 1 });
    expect(result.sweetSpot?.fromKph).toBe(100);
    expect(result.runnerUp).toBeNull();
  });

  it('weights bucket and overall consumption by distance', () => {
    const result = computeSweetSpot([
      drive(55, 100, { distanceM: 90_000, energyUsedWh: 9_000 }),
      drive(55, 200, { distanceM: 10_000, energyUsedWh: 2_000 }),
      drive(55, 110),
      drive(105, 220, { distanceM: 10_000 }),
      drive(105, 220, { distanceM: 10_000 }),
      drive(105, 220, { distanceM: 10_000 }),
    ]);

    expect(result.points[0]?.whPerKm).toBe(110);
    expect(result.overallWhPerKm).toBeCloseTo(133.6, 1);
    expect(result.winningBandCoverage?.distanceM).toBe(110_000);
    expect(result.winningBandCoverage?.distanceShare).toBeCloseTo(110 / 140);
  });

  it('places an exact boundary in the higher half-open bucket', () => {
    const result = computeSweetSpot(
      [
        drive(60, 140),
        drive(60, 140),
        drive(60, 140),
        drive(59.999, 150),
      ],
      { minDrivesPerBucket: 1 },
    );

    expect(result.points.map((point) => [point.fromKph, point.toKph, point.drives]))
      .toEqual([[50, 60, 1], [60, 70, 3]]);
  });

  it('includes drives exactly at the distance and duration eligibility floors', () => {
    const result = computeSweetSpot([
      drive(55, 140, { distanceM: 2_000, durationS: 300, energyUsedWh: 280 }),
      drive(55, 140, { distanceM: 2_000, durationS: 300, energyUsedWh: 280 }),
      drive(55, 140, { distanceM: 2_000, durationS: 300, energyUsedWh: 280 }),
    ]);

    expect(result).toMatchObject({ observed: 3, eligible: 3, excluded: 0 });
    expect(result.sweetSpot?.whPerKm).toBe(140);
  });

  it('reports a descriptive observed gap without claiming a forecast', () => {
    const result = computeSweetSpot([
      drive(55, 100), drive(55, 100), drive(55, 100),
      drive(105, 200), drive(105, 200), drive(105, 200),
    ]);

    expect(result.overallWhPerKm).toBe(150);
    expect(result.observedGapWhPerKm).toBe(50);
    expect(result.observedGapShare).toBeCloseTo(1 / 3);
  });

  it('allows a signed gap when sparse efficient drives pull overall below the winner', () => {
    const result = computeSweetSpot([
      drive(25, 50, { distanceM: 100_000, energyUsedWh: 5_000 }),
      drive(55, 100), drive(55, 100), drive(55, 100),
    ]);

    expect(result.sweetSpot?.fromKph).toBe(50);
    expect(result.observedGapShare).toBeLessThan(0);
  });

  it('uses total monthly distance divided by total duration for average speed', () => {
    const result = computeSweetSpot(
      [
        drive(18, 100, {
          startTs: '2026-02-20T00:00:00Z',
          distanceM: 10_000,
          durationS: 1_000,
          energyUsedWh: 1_000,
        }),
        drive(108, 200, {
          startTs: '2026-02-01T00:00:00Z',
          distanceM: 30_000,
          durationS: 1_000,
          energyUsedWh: 6_000,
        }),
      ],
      { minDrivesPerBucket: 1 },
    );

    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0]).toMatchObject({
      month: '2026-02',
      drives: 2,
      distanceM: 40_000,
      durationS: 2_000,
      avgSpeedMps: 20,
      whPerKm: 175,
    });
  });

  it('sorts months and excludes only malformed dates from date-derived output', () => {
    const result = computeSweetSpot(
      [
        drive(55, 140, { startTs: 'not-a-date' }),
        drive(55, 140, { startTs: '2099-01-01T00:00:00Z' }),
        drive(55, 140, { startTs: '2025-12-01T00:00:00Z' }),
      ],
      { minDrivesPerBucket: 1 },
    );

    expect(result.eligible).toBe(3);
    expect(result.invalidDateCount).toBe(1);
    expect(result.monthly.map((month) => month.month)).toEqual([
      '2025-12',
      '2099-01',
    ]);
  });

  it('caps only visual scatter evidence with deterministic even sampling', () => {
    const drives = Array.from({ length: 10 }, (_, index) =>
      drive(50 + index, 120 + index, {
        startTs: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      }),
    );
    const result = computeSweetSpot(drives, {
      minDrivesPerBucket: 1,
      scatterLimit: 3,
    });

    expect(result.eligible).toBe(10);
    expect(result.points.reduce((sum, point) => sum + point.drives, 0)).toBe(10);
    expect(result.driveEvidenceCapped).toBe(true);
    expect(result.driveEvidenceTotal).toBe(10);
    expect(result.driveEvidence.map((point) => point.driveId)).toEqual([1, 6, 10]);
    expect(
      computeSweetSpot([...drives].reverse(), {
        minDrivesPerBucket: 1,
        scatterLimit: 3,
      }).driveEvidence.map((point) => point.driveId),
    ).toEqual([1, 6, 10]);
  });

  it('accounts for malformed measurements, empty input, and an unqualified window', () => {
    const malformed = [
      drive(55, 140, { distanceM: Number.NaN }),
      drive(55, 140, { durationS: Number.POSITIVE_INFINITY }),
      drive(55, 140, { energyUsedWh: null }),
      drive(55, 140, { avgSpeedMps: 0 }),
      drive(55, 140, { distanceM: 1_999 }),
      drive(55, 140, { durationS: 299 }),
    ];
    const result = computeSweetSpot(malformed);
    const empty = computeSweetSpot([]);

    expect(result).toMatchObject({
      observed: 6,
      eligible: 0,
      excluded: 6,
      sweetSpot: null,
      overallWhPerKm: null,
      observedGapShare: null,
    });
    expect(empty.points).toEqual([]);
    expect(empty.monthly).toEqual([]);
    expect(empty.sweetSpot).toBeNull();
  });

  it('detects a returned-window cap without changing eligibility accounting', () => {
    const rows = [drive(55, 140), drive(55, 140), drive(55, 140)];
    const capped = computeSweetSpot(rows, { windowLimit: 3 });
    const below = computeSweetSpot(rows, { windowLimit: 4 });

    expect(capped.historyCapReached).toBe(true);
    expect(capped).toMatchObject({ observed: 3, eligible: 3, excluded: 0 });
    expect(below.historyCapReached).toBe(false);
  });

  it.each([
    [{ bucketKph: 0 }, 'bucketKph'],
    [{ bucketKph: Number.NaN }, 'bucketKph'],
    [{ minDrivesPerBucket: -1 }, 'minDrivesPerBucket'],
    [{ minDrivesPerBucket: Number.POSITIVE_INFINITY }, 'minDrivesPerBucket'],
    [{ scatterLimit: 0 }, 'scatterLimit'],
    [{ windowLimit: Number.NaN }, 'windowLimit'],
  ])('rejects invalid options %o', (options, name) => {
    expect(() => computeSweetSpot([], options)).toThrow(name);
  });
});
