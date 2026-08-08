import { beforeEach, describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';

import {
  MAX_FORECAST_DAYS,
  buildMilestoneLadder,
  buildOdometerMilestones,
  downsampleOdometerSeries,
  type CumulativeOdometerPoint,
  type OdometerMilestoneOptions,
  type PaceScenarioId,
} from './odometerMilestones';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-08-01T00:00:00.000Z');
const KM_PER_MILE = 1.609344;

let nextId = 1;

function drive(
  startTs: string,
  distanceM: number,
  id = nextId++,
): Drive {
  return {
    id,
    vehicleId: 1,
    startTs,
    endTs: null,
    durationS: 1_800,
    distanceM,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 2_000,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function options(
  overrides: Partial<OdometerMilestoneOptions> = {},
): OdometerMilestoneOptions {
  return {
    baseOdometerKm: 0,
    nowMs: NOW,
    milestoneUnitKm: 1,
    ...overrides,
  };
}

function scenario(
  result: ReturnType<typeof buildOdometerMilestones>,
  id: PaceScenarioId,
) {
  return result.paceScenarios.find((candidate) => candidate.id === id)!;
}

beforeEach(() => {
  nextId = 1;
});

describe('buildMilestoneLadder', () => {
  it('uses 10k display-unit steps through 100k, then 50k steps', () => {
    const ladder = buildMilestoneLadder(120_000, 1);

    expect(ladder[0]).toBe(10_000);
    expect(ladder).toContain(100_000);
    expect(ladder).toContain(150_000);
    expect(ladder).not.toContain(110_000);
    expect(ladder.filter((value) => value > 120_000)).toHaveLength(5);
  });

  it('builds round mile thresholds while returning canonical kilometres', () => {
    const ladderKm = buildMilestoneLadder(
      120_000 * KM_PER_MILE,
      KM_PER_MILE,
    );
    const ladderMiles = ladderKm.map((km) => km / KM_PER_MILE);

    expect(ladderMiles[0]).toBeCloseTo(10_000, 10);
    expect(ladderMiles.some((value) => Math.abs(value - 100_000) < 1e-8)).toBe(true);
    expect(ladderMiles.some((value) => Math.abs(value - 150_000) < 1e-8)).toBe(true);
    expect(ladderMiles.some((value) => Math.abs(value - 110_000) < 1e-8)).toBe(false);
    expect(ladderKm[0]).toBeCloseTo(16_093.44, 8);
  });

  it.each([
    ['negative maximum', -1, 1, 5],
    ['zero unit factor', 1, 0, 5],
    ['non-finite unit factor', 1, Number.POSITIVE_INFINITY, 5],
    ['zero future count', 1, 1, 0],
  ])('rejects %s', (_name, maxKm, unitKm, count) => {
    expect(() => buildMilestoneLadder(maxKm, unitKm, count)).toThrow(
      RangeError,
    );
  });
});

describe('buildOdometerMilestones', () => {
  it('applies calibration before the first observed row and dates crossings', () => {
    const crossing = '2026-06-01T09:00:00.000Z';
    const result = buildOdometerMilestones(
      [drive(crossing, 3_000_000)],
      options({ baseOdometerKm: 9_000 }),
    );

    expect(result.baseOdometerKm).toBe(9_000);
    expect(result.eligibleDistanceKm).toBe(3_000);
    expect(result.currentOdometerKm).toBe(12_000);
    expect(result.reached).toEqual([
      {
        thresholdKm: 10_000,
        reachedAtMs: Date.parse(crossing),
        crossingDriveId: 1,
      },
    ]);
    expect(result.segment.previousMilestoneKm).toBe(10_000);
    expect(result.segment.nextMilestoneKm).toBe(20_000);
  });

  it('dates every milestone crossed by one long drive to that drive', () => {
    const crossing = '2026-06-01T09:00:00.000Z';
    const result = buildOdometerMilestones(
      [drive(crossing, 25_000_000)],
      options(),
    );

    expect(result.reached.map((item) => item.thresholdKm)).toEqual([
      10_000,
      20_000,
    ]);
    expect(
      new Set(result.reached.map((item) => item.reachedAtMs)),
    ).toEqual(new Set([Date.parse(crossing)]));
  });

  it('sorts by timestamp and drive id independently of input order', () => {
    const timestamp = '2026-05-01T12:00:00.000Z';
    const firstInput = [
      drive(timestamp, 3_000_000, 3),
      drive(timestamp, 1_000_000, 1),
      drive(timestamp, 2_000_000, 2),
    ];
    const secondInput = [...firstInput].reverse();

    const first = buildOdometerMilestones(firstInput, options());
    const second = buildOdometerMilestones(secondInput, options());

    expect(first.cumulativeSeries).toEqual(second.cumulativeSeries);
    expect(first.cumulativeSeries.map((point) => point.driveId)).toEqual([
      1, 2, 3,
    ]);
    expect(first.cumulativeSeries.map((point) => point.odometerKm)).toEqual([
      1_000, 3_000, 6_000,
    ]);
  });

  it('excludes and accounts for invalid, future, and unusable distances', () => {
    const result = buildOdometerMilestones(
      [
        drive('not-a-date', 1_000),
        drive(daysAgo(-1), 1_000),
        drive(daysAgo(6), Number.NaN),
        drive(daysAgo(5), Number.POSITIVE_INFINITY),
        drive(daysAgo(4), 0),
        drive(daysAgo(3), -1),
        drive(daysAgo(2), 2_000),
      ],
      options(),
    );

    expect(result.accounting).toMatchObject({
      returnedRows: 7,
      eligibleRows: 1,
      excludedRows: 6,
      capReached: false,
      exclusions: {
        invalidTimestampRows: 1,
        futureRows: 1,
        nonFiniteDistanceRows: 2,
        zeroDistanceRows: 1,
        negativeDistanceRows: 1,
      },
    });
    expect(result.eligibleDistanceKm).toBe(2);
  });

  it('computes current ladder-segment progress in canonical kilometres', () => {
    const result = buildOdometerMilestones(
      [drive(daysAgo(10), 5_000_000)],
      options({ baseOdometerKm: 20_000 }),
    );

    expect(result.segment).toEqual({
      previousMilestoneKm: 20_000,
      nextMilestoneKm: 30_000,
      segmentDistanceKm: 10_000,
      progressedKm: 5_000,
      remainingKm: 5_000,
      progressRatio: 0.5,
    });
  });

  it('builds supported 30-day, 90-day, and full-history evidence', () => {
    const rows = [
      drive(daysAgo(120), 100_000),
      drive(daysAgo(20), 100_000),
      drive(daysAgo(15), 100_000),
      drive(daysAgo(10), 100_000),
      drive(daysAgo(5), 100_000),
      drive(daysAgo(1), 100_000),
    ];
    const result = buildOdometerMilestones(rows, options());
    const trailing30 = scenario(result, 'trailing30');
    const trailing90 = scenario(result, 'trailing90');
    const history = scenario(result, 'observedHistory');

    expect(trailing30).toMatchObject({
      sampleCount: 5,
      observedDays: 30,
      distanceKm: 500,
      supported: true,
    });
    expect(trailing30.paceKmPerDay).toBeCloseTo(500 / 30, 12);
    expect(trailing90).toMatchObject({
      sampleCount: 5,
      observedDays: 90,
      distanceKm: 500,
      supported: true,
    });
    expect(trailing90.paceKmPerDay).toBeCloseTo(500 / 90, 12);
    expect(history).toMatchObject({
      sampleCount: 6,
      observedDays: 120,
      distanceKm: 600,
      supported: true,
    });
    expect(history.paceKmPerDay).toBeCloseTo(5, 12);
    expect(result.primaryPace).toBe(trailing90);
    expect(result.upcoming[0]!.forecast?.scenarioCount).toBe(3);
    expect(result.upcoming[0]!.forecast!.rangeStartMs).toBeLessThanOrEqual(
      result.upcoming[0]!.forecast!.etaMs,
    );
    expect(result.upcoming[0]!.forecast!.rangeEndMs).toBeGreaterThanOrEqual(
      result.upcoming[0]!.forecast!.etaMs,
    );
  });

  it('uses the actual shorter observed span instead of dividing by 90', () => {
    const result = buildOdometerMilestones(
      [10, 8, 6, 4, 2].map((days) =>
        drive(daysAgo(days), 100_000),
      ),
      options(),
    );

    expect(result.primaryPace.sampleCount).toBe(5);
    expect(result.primaryPace.observedDays).toBe(10);
    expect(result.primaryPace.paceKmPerDay).toBeCloseTo(50, 12);
  });

  it('withholds recent pace while allowing a supported full-window scenario', () => {
    const oldRows = [200, 190, 180, 170, 160].map((days) =>
      drive(daysAgo(days), 100_000),
    );
    const recentRows = [20, 15, 10, 5].map((days) =>
      drive(daysAgo(days), 100_000),
    );
    const result = buildOdometerMilestones(
      [...oldRows, ...recentRows],
      options(),
    );

    expect(scenario(result, 'trailing30').sampleCount).toBe(4);
    expect(scenario(result, 'trailing30').supported).toBe(false);
    expect(result.primaryPace.sampleCount).toBe(4);
    expect(result.primaryPace.paceKmPerDay).toBeNull();
    expect(scenario(result, 'observedHistory').supported).toBe(true);
    expect(result.upcoming[0]!.forecast).toBeNull();
    expect(
      scenario(result, 'observedHistory').nextMilestoneEtaMs,
    ).not.toBeNull();
  });

  it('projects with unrounded pace and emits valid full timestamps', () => {
    const result = buildOdometerMilestones(
      [10, 8, 6, 4, 2].map((days) =>
        drive(daysAgo(days), 100_200),
      ),
      options({ baseOdometerKm: 9_000 }),
    );
    const expectedPace = 501 / 10;
    const expectedEta = NOW + (499 / expectedPace) * DAY_MS;
    const forecast = result.upcoming[0]!.forecast;

    expect(result.primaryPace.paceKmPerDay).toBeCloseTo(expectedPace, 12);
    expect(forecast?.etaMs).toBeCloseTo(expectedEta, 4);
    expect(Number.isFinite(forecast?.etaMs)).toBe(true);
    expect(new Date(forecast!.etaMs).toISOString()).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect(forecast!.etaMs).toBeGreaterThan(NOW);
  });

  it('withholds projections beyond the finite forecast horizon', () => {
    const result = buildOdometerMilestones(
      [90, 80, 70, 60, 50].map((days) =>
        drive(daysAgo(days), 1),
      ),
      options(),
    );

    expect(result.primaryPace.supported).toBe(true);
    expect(result.upcoming[0]!.forecast).toBeNull();
    expect(result.primaryPace.nextMilestoneEtaMs).toBeNull();
    expect(result.method.maxForecastDays).toBe(MAX_FORECAST_DAYS);
  });

  it('returns cumulative points and UTC monthly rollups from every eligible drive', () => {
    const result = buildOdometerMilestones(
      [
        drive('2026-01-02T00:00:00.000Z', 100_000),
        drive('2026-01-20T00:00:00.000Z', 200_000),
        drive('2026-02-03T00:00:00.000Z', 300_000),
      ],
      options({ baseOdometerKm: 1_000 }),
    );

    expect(
      result.cumulativeSeries.map((point) => ({
        driveCount: point.driveCount,
        distance: point.cumulativeDistanceKm,
        odometer: point.odometerKm,
      })),
    ).toEqual([
      { driveCount: 1, distance: 100, odometer: 1_100 },
      { driveCount: 2, distance: 300, odometer: 1_300 },
      { driveCount: 3, distance: 600, odometer: 1_600 },
    ]);
    expect(result.monthly).toEqual([
      {
        month: '2026-01',
        monthStartMs: Date.parse('2026-01-01T00:00:00.000Z'),
        driveCount: 2,
        distanceKm: 300,
        endingOdometerKm: 1_300,
      },
      {
        month: '2026-02',
        monthStartMs: Date.parse('2026-02-01T00:00:00.000Z'),
        driveCount: 1,
        distanceKm: 300,
        endingOdometerKm: 1_600,
      },
    ]);
  });

  it('downsamples deterministically while all rows still feed aggregates', () => {
    const rows = [5, 4, 3, 2, 1].map((days) =>
      drive(daysAgo(days), 1_000),
    );
    const result = buildOdometerMilestones(
      rows,
      options({ cumulativePointLimit: 3 }),
    );

    expect(result.cumulativePointCount).toBe(5);
    expect(result.cumulativeSeries.map((point) => point.driveCount)).toEqual([
      1, 3, 5,
    ]);
    expect(result.eligibleDistanceKm).toBe(5);
  });

  it('detects the cap only when returned rows equal the requested limit', () => {
    const capped = Array.from({ length: 1_000 }, () =>
      drive('invalid', 1_000),
    );
    const belowCap = capped.slice(0, 999);

    expect(
      buildOdometerMilestones(capped, options()).accounting.capReached,
    ).toBe(true);
    expect(
      buildOdometerMilestones(belowCap, options()).accounting.capReached,
    ).toBe(false);
  });

  it('returns a complete empty-window contract without inventing pace', () => {
    const result = buildOdometerMilestones(
      [],
      options({ baseOdometerKm: 4_000 }),
    );

    expect(result.accounting).toMatchObject({
      returnedRows: 0,
      eligibleRows: 0,
      excludedRows: 0,
      capReached: false,
    });
    expect(result.currentOdometerKm).toBe(4_000);
    expect(result.cumulativeSeries).toEqual([]);
    expect(result.monthly).toEqual([]);
    expect(result.reached).toEqual([]);
    expect(result.upcoming).toHaveLength(5);
    expect(result.primaryPace.paceKmPerDay).toBeNull();
    expect(result.upcoming.every((item) => item.forecast == null)).toBe(true);
  });

  it.each([
    ['negative base', { baseOdometerKm: -1 }],
    ['invalid clock', { nowMs: Number.NaN }],
    ['invalid unit factor', { milestoneUnitKm: 0 }],
    ['invalid history limit', { historyLimit: 0 }],
    ['invalid pace minimum', { minimumPaceDrives: 4 }],
    ['invalid series limit', { cumulativePointLimit: -1 }],
    ['invalid upcoming count', { upcomingCount: 0 }],
  ])('rejects %s options', (_name, override) => {
    expect(() =>
      buildOdometerMilestones([], options(override)),
    ).toThrow(RangeError);
  });
});

describe('downsampleOdometerSeries', () => {
  it('keeps the first and last point and chooses stable interior indices', () => {
    const points: CumulativeOdometerPoint[] = Array.from(
      { length: 7 },
      (_, index) => ({
        timestampMs: index,
        driveId: index,
        driveCount: index + 1,
        cumulativeDistanceKm: index + 1,
        odometerKm: index + 1,
      }),
    );

    expect(
      downsampleOdometerSeries(points, 4).map((point) => point.driveCount),
    ).toEqual([1, 3, 5, 7]);
  });
});
