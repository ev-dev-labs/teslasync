import { beforeEach, describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';

import {
  nightOverlapMs,
  parseParkingUtcRange,
  summarizeParking,
  type SummarizeParkingOptions,
} from './parkingDwell';

const HOUR_MS = 3_600_000;
let nextId = 1;

function makeDrive(
  start: string,
  end: string | null,
  endAddress: string | null = 'Home',
  overrides: Partial<Drive> = {},
): Drive {
  const startMs = Date.parse(start);
  const endMs = end == null ? Number.NaN : Date.parse(end);
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: start,
    endTs: end,
    durationS:
      Number.isFinite(startMs) && Number.isFinite(endMs)
        ? (endMs - startMs) / 1_000
        : 0,
    distanceM: 10_000,
    startAddress: null,
    endAddress,
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
    ...overrides,
  };
}

function options(
  overrides: Partial<SummarizeParkingOptions> = {},
): SummarizeParkingOptions {
  return {
    nowMs: Date.parse('2026-12-31T12:00:00.000Z'),
    rangeStart: '2026-01-01',
    rangeEnd: '2026-12-31',
    timeZone: 'UTC',
    rowLimit: 1_000,
    ...overrides,
  };
}

beforeEach(() => {
  nextId = 1;
});

describe('UTC range and local-time assumptions', () => {
  it('parses date-only picker values as a UTC half-open range', () => {
    expect(parseParkingUtcRange('2026-01-02', '2026-01-02')).toEqual({
      startMs: Date.parse('2026-01-02T00:00:00.000Z'),
      endExclusiveMs: Date.parse('2026-01-03T00:00:00.000Z'),
    });
    expect(parseParkingUtcRange('2026-02-30', '2026-03-01')).toBeNull();
    expect(parseParkingUtcRange('2026-03-02', '2026-03-01')).toBeNull();
  });

  it('filters on UTC boundaries but assigns profiles in the requested timezone', () => {
    const inside = makeDrive(
      '2026-01-02T01:00:00.000Z',
      '2026-01-02T01:30:00.000Z',
      'Office',
    );
    const before = makeDrive(
      '2026-01-01T23:59:59.000Z',
      '2026-01-02T00:00:00.000Z',
      'Before',
    );
    const atExclusiveEnd = makeDrive(
      '2026-01-03T00:00:00.000Z',
      '2026-01-03T00:30:00.000Z',
      'After',
    );

    const summary = summarizeParking(
      [inside, before, atExclusiveEnd],
      options({
        nowMs: Date.parse('2026-01-03T00:00:00.000Z'),
        rangeStart: '2026-01-02',
        rangeEnd: '2026-01-02',
        timeZone: 'America/Los_Angeles',
      }),
    );

    expect(summary.coverage.validDrives).toBe(1);
    expect(summary.coverage.outsideWindow).toBe(2);
    expect(summary.hourly[17]?.stints).toBe(1);
    expect(summary.weekdays[4]?.stints).toBe(1);
    expect(summary.monthly).toMatchObject([{ month: '2026-01', stints: 1 }]);
  });
});

describe('nightOverlapMs', () => {
  it('counts only 22:00–06:00 in the explicit timezone', () => {
    const start = Date.parse('2026-07-07T04:00:00.000Z');
    const end = Date.parse('2026-07-07T14:00:00.000Z');
    expect(nightOverlapMs(start, end, 'America/Los_Angeles')).toBe(8 * HOUR_MS);
    expect(nightOverlapMs(start, end, 'UTC')).toBe(2 * HOUR_MS);
  });

  it('respects the shorter spring-forward night', () => {
    const local2200 = Date.parse('2026-03-08T06:00:00.000Z');
    const local0600 = Date.parse('2026-03-08T13:00:00.000Z');
    expect(
      nightOverlapMs(local2200, local0600, 'America/Los_Angeles'),
    ).toBe(7 * HOUR_MS);
  });

  it('returns zero for invalid or inverted intervals', () => {
    expect(nightOverlapMs(Number.NaN, 10, 'UTC')).toBe(0);
    expect(nightOverlapMs(10, 10, 'UTC')).toBe(0);
    expect(nightOverlapMs(10, 0, 'UTC')).toBe(0);
  });
});

describe('parking reconstruction and exclusions', () => {
  it('builds ordered gaps and a current trailing stint from an injected clock', () => {
    const morning = makeDrive(
      '2026-01-06T08:00:00.000Z',
      '2026-01-06T09:00:00.000Z',
      'Office',
    );
    const evening = makeDrive(
      '2026-01-06T17:00:00.000Z',
      '2026-01-06T18:00:00.000Z',
      'Home',
    );

    const summary = summarizeParking(
      [evening, morning],
      options({
        nowMs: Date.parse('2026-01-06T20:00:00.000Z'),
        rangeStart: '2026-01-06',
        rangeEnd: '2026-01-06',
      }),
    );

    expect(summary.stints).toHaveLength(2);
    expect(summary.stints[0]).toMatchObject({
      location: 'Office',
      durationMs: 8 * HOUR_MS,
      ongoing: false,
      rightCensored: false,
    });
    expect(summary.stints[1]).toMatchObject({
      location: 'Home',
      durationMs: 2 * HOUR_MS,
      ongoing: true,
      rightCensored: true,
    });
    expect(summary.totalDrivingMs).toBe(2 * HOUR_MS);
    expect(summary.parkedShare).toBeCloseTo(10 / 12);
    expect(summary.coverage.ongoingStints).toBe(1);
  });

  it('accounts for malformed, future, outside, and overlapping records', () => {
    const overlappingA = makeDrive(
      '2026-01-06T08:00:00.000Z',
      '2026-01-06T10:00:00.000Z',
      'A',
    );
    const overlappingB = makeDrive(
      '2026-01-06T09:00:00.000Z',
      '2026-01-06T11:00:00.000Z',
      'B',
    );
    const touching = makeDrive(
      '2026-01-06T11:00:00.000Z',
      '2026-01-06T12:00:00.000Z',
      null,
    );
    const invalidStart = makeDrive('not-a-date', null, 'Invalid');
    const futureStart = makeDrive(
      '2026-01-07T08:00:00.000Z',
      '2026-01-07T09:00:00.000Z',
      'Future',
    );
    const outside = makeDrive(
      '2026-01-05T08:00:00.000Z',
      '2026-01-05T09:00:00.000Z',
      'Outside',
    );
    const invalidEnd = makeDrive(
      '2026-01-06T10:00:00.000Z',
      'invalid-end',
      'Invalid end',
    );
    const negativeEnd = makeDrive(
      '2026-01-06T10:00:00.000Z',
      '2026-01-06T09:00:00.000Z',
      'Negative',
    );
    const futureEnd = makeDrive(
      '2026-01-06T12:15:00.000Z',
      '2026-01-06T14:00:00.000Z',
      'Future end',
    );

    const summary = summarizeParking(
      [
        invalidStart,
        futureStart,
        outside,
        invalidEnd,
        negativeEnd,
        futureEnd,
        touching,
        overlappingB,
        overlappingA,
      ],
      options({
        nowMs: Date.parse('2026-01-06T13:00:00.000Z'),
        rangeStart: '2026-01-06',
        rangeEnd: '2026-01-06',
      }),
    );

    expect(summary.coverage).toMatchObject({
      recordsReturned: 9,
      validDrives: 3,
      excludedDrives: 6,
      invalidStart: 1,
      futureStart: 1,
      outsideWindow: 1,
      invalidEnd: 2,
      futureEnd: 1,
      overlappingGaps: 1,
      zeroLengthGaps: 1,
      missingLocationStints: 1,
    });
    expect(summary.stints).toHaveLength(1);
    expect(summary.stints[0]?.location).toBeNull();
    expect(summary.totalDrivingMs).toBe(4 * HOUR_MS);
  });

  it('uses duration fallback but never invents parking after an open drive', () => {
    const inferred = makeDrive(
      '2026-01-06T08:00:00.000Z',
      null,
      'Inferred',
      { durationS: 3_600 },
    );
    const open = makeDrive(
      '2026-01-06T12:00:00.000Z',
      null,
      'Driving',
      { durationS: 900, live: true },
    );
    const summary = summarizeParking(
      [inferred, open],
      options({
        nowMs: Date.parse('2026-01-06T13:00:00.000Z'),
        rangeStart: '2026-01-06',
        rangeEnd: '2026-01-06',
      }),
    );

    expect(summary.coverage.inferredEndDrives).toBe(1);
    expect(summary.coverage.openDrives).toBe(1);
    expect(summary.stints).toHaveLength(1);
    expect(summary.stints[0]).toMatchObject({
      location: 'Inferred',
      durationMs: 3 * HOUR_MS,
      ongoing: false,
    });
  });
});

describe('duration, temporal, monthly, and ranking rollups', () => {
  it('places boundary durations into all six half-open bands', () => {
    const gapsHours = [0.5, 1, 4, 12, 24];
    const drives: Drive[] = [];
    let startMs = Date.parse('2026-01-01T00:00:00.000Z');
    for (let index = 0; index < 6; index += 1) {
      const endMs = startMs + 10 * 60_000;
      drives.push(
        makeDrive(
          new Date(startMs).toISOString(),
          new Date(endMs).toISOString(),
          `Location ${index}`,
        ),
      );
      if (index < gapsHours.length) {
        startMs = endMs + gapsHours[index]! * HOUR_MS;
      }
    }
    const finalEndMs = Date.parse(drives[5]!.endTs!);
    const summary = summarizeParking(
      drives,
      options({
        nowMs: finalEndMs + 72 * HOUR_MS,
        rangeStart: '2026-01-01',
        rangeEnd: '2026-01-31',
      }),
    );

    expect(summary.durationBands.map((band) => [band.key, band.stints])).toEqual([
      ['under1h', 1],
      ['1to4h', 1],
      ['4to12h', 1],
      ['12to24h', 1],
      ['1to3d', 1],
      ['3dPlus', 1],
    ]);
    expect(
      summary.durationBands.reduce((total, band) => total + band.stintShare, 0),
    ).toBeCloseTo(1);
  });

  it('rolls parking starts and dwell into local hour, weekday, and month buckets', () => {
    const januaryDrive = makeDrive(
      '2026-01-31T22:00:00.000Z',
      '2026-01-31T23:00:00.000Z',
      'January',
    );
    const februaryDrive = makeDrive(
      '2026-02-01T01:00:00.000Z',
      '2026-02-01T02:00:00.000Z',
      'February',
    );
    const summary = summarizeParking(
      [februaryDrive, januaryDrive],
      options({
        nowMs: Date.parse('2026-02-01T05:00:00.000Z'),
        rangeStart: '2026-01-01',
        rangeEnd: '2026-02-28',
      }),
    );

    expect(summary.hourly[23]).toMatchObject({ stints: 1, totalMs: 2 * HOUR_MS });
    expect(summary.hourly[2]).toMatchObject({ stints: 1, totalMs: 3 * HOUR_MS });
    expect(summary.weekdays[6]?.stints).toBe(1);
    expect(summary.weekdays[0]?.stints).toBe(1);
    expect(summary.monthly).toEqual([
      {
        month: '2026-01',
        stints: 1,
        totalMs: 2 * HOUR_MS,
        averageMs: 2 * HOUR_MS,
      },
      {
        month: '2026-02',
        stints: 1,
        totalMs: 3 * HOUR_MS,
        averageMs: 3 * HOUR_MS,
      },
    ]);
  });

  it('ranks equal durations by earlier start and aggregates location quality', () => {
    const first = makeDrive(
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T01:00:00.000Z',
      'Alpha',
    );
    const second = makeDrive(
      '2026-01-01T06:00:00.000Z',
      '2026-01-01T07:00:00.000Z',
      'Beta',
    );
    const third = makeDrive(
      '2026-01-01T12:00:00.000Z',
      '2026-01-01T13:00:00.000Z',
      null,
    );
    const summary = summarizeParking(
      [third, second, first],
      options({
        nowMs: Date.parse('2026-01-01T15:00:00.000Z'),
        rangeStart: '2026-01-01',
        rangeEnd: '2026-01-01',
      }),
    );

    expect(summary.rankedStints.map((stint) => stint.location)).toEqual([
      'Alpha',
      'Beta',
      null,
    ]);
    expect(summary.locations.map((location) => location.location)).toEqual([
      'Alpha',
      'Beta',
      null,
    ]);
    expect(summary.coverage).toMatchObject({
      knownLocationStints: 2,
      missingLocationStints: 1,
    });
  });
});

describe('bounded-window and ongoing handling', () => {
  it('flags an exact row-limit response as possibly capped', () => {
    const drives = [
      makeDrive(
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T01:00:00.000Z',
      ),
      makeDrive(
        '2026-01-01T02:00:00.000Z',
        '2026-01-01T03:00:00.000Z',
      ),
    ];
    expect(
      summarizeParking(drives, options({ rowLimit: 2 })).coverage.possiblyCapped,
    ).toBe(true);
    expect(
      summarizeParking(drives, options({ rowLimit: 3 })).coverage.possiblyCapped,
    ).toBe(false);
  });

  it('right-censors a historical trailing stint at the UTC range edge', () => {
    const drive = makeDrive(
      '2026-01-06T17:00:00.000Z',
      '2026-01-06T18:00:00.000Z',
      'Home',
    );
    const summary = summarizeParking(
      [drive],
      options({
        nowMs: Date.parse('2026-01-10T12:00:00.000Z'),
        rangeStart: '2026-01-06',
        rangeEnd: '2026-01-06',
      }),
    );

    expect(summary.stints[0]).toMatchObject({
      endMs: Date.parse('2026-01-07T00:00:00.000Z'),
      durationMs: 6 * HOUR_MS,
      ongoing: false,
      rightCensored: true,
    });
    expect(summary.coverage).toMatchObject({
      rightCensoredStints: 1,
      ongoingStints: 0,
    });
  });

  it('returns stable empty structures for an empty observed window', () => {
    const summary = summarizeParking([], options());
    expect(summary.stints).toEqual([]);
    expect(summary.durationBands).toHaveLength(6);
    expect(summary.hourly).toHaveLength(24);
    expect(summary.weekdays).toHaveLength(7);
    expect(summary.parkedShare).toBeNull();
    expect(summary.nightShare).toBeNull();
    expect(summary.longestStint).toBeNull();
  });
});
