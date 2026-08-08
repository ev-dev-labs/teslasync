import { beforeEach, describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';

import {
  buildDrivingRhythm,
  formatFractionalHour,
  formatMinuteOfDay,
} from './drivingRhythm';

const NOW_MS = Date.parse('2026-08-07T12:00:00.000Z');
const UTC_OPTIONS = {
  nowMs: NOW_MS,
  timeZone: 'UTC',
  rangeStart: '2026-07-06',
  rangeEnd: '2026-07-12',
  windowLimit: 1_000,
} as const;

let nextId = 1;

function driveAt(startTs: string, overrides: Partial<Drive> = {}): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs,
    endTs: null,
    durationS: 1_800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
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

beforeEach(() => {
  nextId = 1;
});

describe('buildDrivingRhythm', () => {
  it('builds hourly, weekday-hour, and named time-band rollups in UTC', () => {
    const hours = [0, 5, 6, 11, 12, 17, 18, 23];
    const result = buildDrivingRhythm(
      hours.map((hour) =>
        driveAt(
          `2026-07-06T${String(hour).padStart(2, '0')}:15:00.000Z`,
        ),
      ),
      UTC_OPTIONS,
    );

    expect(result.total).toBe(8);
    expect(result.matrix[1]![0]).toBe(1);
    expect(result.matrix[1]![23]).toBe(1);
    expect(result.hourly[6]).toMatchObject({
      hour: 6,
      drives: 1,
      distanceM: 10_000,
      measuredDistanceDrives: 1,
    });
    expect(
      result.timeBands.map((band) => [band.key, band.drives]),
    ).toEqual([
      ['overnight', 2],
      ['morning', 2],
      ['afternoon', 2],
      ['evening', 2],
    ]);
    expect(result.activeSlotCount).toBe(8);
  });

  it('uses one explicit IANA timezone for day, hour, and month boundaries', () => {
    // 00:30Z on July 1 is 17:30 on June 30 in Los Angeles.
    const row = driveAt('2026-07-01T00:30:00.000Z');
    const utc = buildDrivingRhythm([row], {
      ...UTC_OPTIONS,
      timeZone: 'UTC',
    });
    const losAngeles = buildDrivingRhythm([row], {
      ...UTC_OPTIONS,
      timeZone: 'America/Los_Angeles',
    });

    expect(utc.matrix[3]![0]).toBe(1);
    expect(utc.monthly[0]?.month).toBe('2026-07');
    expect(losAngeles.matrix[2]![17]).toBe(1);
    expect(losAngeles.monthly[0]?.month).toBe('2026-06');
    expect(losAngeles.timeZone).toBe('America/Los_Angeles');
  });

  it('accounts separately for malformed, blank, and future timestamps', () => {
    const result = buildDrivingRhythm(
      [
        driveAt('2026-07-06T08:00:00.000Z'),
        driveAt(''),
        driveAt('not-a-date'),
        driveAt('2026-08-07T12:00:00.001Z'),
        driveAt('2026-08-07T12:00:00.000Z'),
      ],
      UTC_OPTIONS,
    );

    expect(result).toMatchObject({
      observed: 5,
      total: 2,
      excluded: 3,
      invalidTimestampCount: 2,
      futureTimestampCount: 1,
      firstStartTs: '2026-07-06T08:00:00.000Z',
      lastStartTs: '2026-08-07T12:00:00.000Z',
    });
  });

  it('normalizes weekday and weekend frequency over the selected calendar', () => {
    const result = buildDrivingRhythm(
      [
        driveAt('2026-07-06T08:00:00.000Z', { distanceM: 10_000 }),
        driveAt('2026-07-07T08:00:00.000Z', { distanceM: 20_000 }),
        driveAt('2026-07-12T10:00:00.000Z', { distanceM: 30_000 }),
      ],
      UTC_OPTIONS,
    );

    expect(result.selectedCalendarDays).toBe(7);
    expect(result.dayTypes.weekday).toMatchObject({
      drives: 2,
      activeDays: 2,
      calendarDays: 5,
      drivesPerCalendarDay: 0.4,
      distanceM: 30_000,
      measuredDistanceDrives: 2,
      averageDistanceM: 15_000,
    });
    expect(result.dayTypes.weekend).toMatchObject({
      drives: 1,
      activeDays: 1,
      calendarDays: 2,
      drivesPerCalendarDay: 0.5,
      distanceM: 30_000,
    });
    expect(result.weekdayCount).toBe(2);
    expect(result.weekendCount).toBe(1);
  });

  it('withholds predictability below five starts and scores concentration', () => {
    const four = buildDrivingRhythm(
      Array.from({ length: 4 }, () =>
        driveAt('2026-07-06T08:00:00.000Z'),
      ),
      UTC_OPTIONS,
    );
    const five = buildDrivingRhythm(
      Array.from({ length: 5 }, () =>
        driveAt('2026-07-06T08:00:00.000Z'),
      ),
      UTC_OPTIONS,
    );
    const uniform = buildDrivingRhythm(
      Array.from({ length: 24 }, (_, hour) =>
        driveAt(
          `2026-07-06T${String(hour).padStart(2, '0')}:00:00.000Z`,
        ),
      ),
      UTC_OPTIONS,
    );

    expect(four.predictability).toBeNull();
    expect(five.predictability).toBe(100);
    expect(uniform.predictability).toBe(0);
  });

  it('sorts local months and applies the score floor independently per month', () => {
    const january = Array.from({ length: 4 }, (_, index) =>
      driveAt(`2026-01-0${index + 1}T08:00:00.000Z`),
    );
    const february = Array.from({ length: 5 }, (_, index) =>
      driveAt(`2026-02-0${index + 1}T08:00:00.000Z`),
    );
    const result = buildDrivingRhythm(
      [...february, ...january],
      UTC_OPTIONS,
    );

    expect(result.monthly.map((month) => month.month)).toEqual([
      '2026-01',
      '2026-02',
    ]);
    expect(result.monthly[0]).toMatchObject({
      drives: 4,
      activeDays: 4,
      activeSlots: 4,
      predictability: null,
    });
    expect(result.monthly[1]).toMatchObject({
      drives: 5,
      activeDays: 5,
      predictability: 100,
    });
  });

  it('uses circular medians and deviations for midnight-adjacent departures', () => {
    // All three dates are Mondays in UTC, but departures straddle midnight.
    const result = buildDrivingRhythm(
      [
        driveAt('2026-07-06T23:50:00.000Z'),
        driveAt('2026-07-13T00:10:00.000Z'),
        driveAt('2026-07-20T00:00:00.000Z'),
      ],
      {
        ...UTC_OPTIONS,
        rangeEnd: '2026-07-20',
      },
    );
    const monday = result.dayProfiles[1]!;

    expect(monday).toMatchObject({
      drives: 3,
      medianDepartureMinute: 0,
      consistencyDeviationS: 600,
      consistencySupported: true,
    });
    expect(result.medianDepartureByDay[1]).toBe(0);
    expect(result.dayProfiles[2]?.consistencyDeviationS).toBeNull();

    const sparse = buildDrivingRhythm(
      [
        driveAt('2026-07-06T08:00:00.000Z'),
        driveAt('2026-07-13T08:15:00.000Z'),
      ],
      { ...UTC_OPTIONS, rangeEnd: '2026-07-20' },
    );
    expect(sparse.dayProfiles[1]).toMatchObject({
      drives: 2,
      consistencySupported: false,
      consistencyDeviationS: null,
    });
  });

  it('ranks slots deterministically and tracks sparse and distance evidence', () => {
    const result = buildDrivingRhythm(
      [
        ...Array.from({ length: 3 }, (_, index) =>
          driveAt('2026-07-07T07:00:00.000Z', {
            distanceM: 5_000 + index,
          }),
        ),
        driveAt('2026-07-06T08:00:00.000Z', { distanceM: 10_000 }),
        driveAt('2026-07-06T08:10:00.000Z', { distanceM: 20_000 }),
        driveAt('2026-07-06T08:20:00.000Z', {
          distanceM: Number.NaN,
        }),
        driveAt('2026-07-08T09:00:00.000Z'),
        driveAt('2026-07-08T09:30:00.000Z'),
      ],
      { ...UTC_OPTIONS, topSlotLimit: 3 },
    );

    expect(result.favorite).toEqual({ day: 1, hour: 8, count: 3 });
    expect(
      result.strongestSlots.map((slot) => [
        slot.rank,
        slot.day,
        slot.hour,
        slot.count,
        slot.qualified,
      ]),
    ).toEqual([
      [1, 1, 8, 3, true],
      [2, 2, 7, 3, true],
      [3, 3, 9, 2, false],
    ]);
    expect(result.strongestSlots[0]).toMatchObject({
      distanceM: 30_000,
      measuredDistanceDrives: 2,
    });
    expect(result.invalidDistanceCount).toBe(1);
    expect(result.distanceMeasuredDrives).toBe(7);
  });

  it('detects a returned-window cap without changing row accounting', () => {
    const rows = [
      driveAt('2026-07-06T08:00:00.000Z'),
      driveAt('2026-07-07T08:00:00.000Z'),
      driveAt('2026-07-08T08:00:00.000Z'),
    ];

    expect(
      buildDrivingRhythm(rows, {
        ...UTC_OPTIONS,
        windowLimit: 3,
      }).historyCapReached,
    ).toBe(true);
    expect(
      buildDrivingRhythm(rows, {
        ...UTC_OPTIONS,
        windowLimit: 4,
      }).historyCapReached,
    ).toBe(false);
  });

  it('returns complete zero-safe rollups for an empty window', () => {
    const result = buildDrivingRhythm([], UTC_OPTIONS);

    expect(result).toMatchObject({
      observed: 0,
      total: 0,
      excluded: 0,
      favorite: null,
      predictability: null,
      maxCount: 0,
      activeSlotCount: 0,
      historyCapReached: false,
    });
    expect(result.hourly).toHaveLength(24);
    expect(result.dayProfiles).toHaveLength(7);
    expect(result.monthly).toEqual([]);
    expect(result.strongestSlots).toEqual([]);
    expect(result.timeBands.every((band) => band.drives === 0)).toBe(true);
  });

  it('falls back to UTC for an invalid timezone and rejects invalid options', () => {
    const fallback = buildDrivingRhythm(
      [driveAt('2026-07-06T08:00:00.000Z')],
      { ...UTC_OPTIONS, timeZone: 'Not/A_Timezone' },
    );
    expect(fallback.timeZone).toBe('UTC');
    expect(fallback.timeZoneFallback).toBe(true);

    const invalidRange = buildDrivingRhythm([], {
      ...UTC_OPTIONS,
      rangeStart: 'not-a-date',
    });
    expect(invalidRange.selectedCalendarDays).toBeNull();
    expect(invalidRange.dayTypes.weekday.calendarDays).toBeNull();

    expect(() =>
      buildDrivingRhythm([], { ...UTC_OPTIONS, nowMs: Number.NaN }),
    ).toThrow('nowMs');
    expect(() =>
      buildDrivingRhythm([], { ...UTC_OPTIONS, minSlotDrives: 0 }),
    ).toThrow('minSlotDrives');
    expect(() =>
      buildDrivingRhythm([], { ...UTC_OPTIONS, topSlotLimit: Infinity }),
    ).toThrow('topSlotLimit');
    expect(() =>
      buildDrivingRhythm([], { ...UTC_OPTIONS, windowLimit: -1 }),
    ).toThrow('windowLimit');
  });
});

describe('wall-clock formatting', () => {
  it('formats fractional hours and minute-of-day values with carry and wrap', () => {
    expect(formatFractionalHour(8)).toBe('08:00');
    expect(formatFractionalHour(8.25)).toBe('08:15');
    expect(formatFractionalHour(7.9999)).toBe('08:00');
    expect(formatFractionalHour(23.9999)).toBe('00:00');
    expect(formatMinuteOfDay(-10)).toBe('23:50');
    expect(formatMinuteOfDay(Number.NaN)).toBe('—');
  });
});
