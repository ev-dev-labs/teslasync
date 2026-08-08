import { beforeEach, describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';

import { summarizeTarget, weekStartOf } from './efficiencyTarget';

let nextId = 1;

function drive(
  local: Date,
  distanceM: number,
  energyUsedWh: number | null,
  overrides: Partial<Drive> = {},
): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: local.toISOString(),
    endTs: local.toISOString(),
    durationS: 1800,
    distanceM,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: 'completed',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function at(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour).getTime();
}

beforeEach(() => {
  nextId = 1;
});

describe('weekStartOf', () => {
  it('maps local Monday through Sunday to the same local week', () => {
    expect(weekStartOf(at(2026, 7, 6))).toBe('2026-07-06');
    expect(weekStartOf(at(2026, 7, 9))).toBe('2026-07-06');
    expect(weekStartOf(at(2026, 7, 12))).toBe('2026-07-06');
    expect(weekStartOf(at(2026, 7, 13))).toBe('2026-07-13');
    expect(weekStartOf(Number.NaN)).toBe('');
  });
});

describe('summarizeTarget', () => {
  it('keeps the active week visible but excludes it from completed grades', () => {
    const drives = [
      drive(new Date(2026, 6, 29, 9), 10_000, 1_500),
      drive(new Date(2026, 7, 4, 9), 20_000, 4_000),
    ];

    const summary = summarizeTarget(drives, 160, at(2026, 8, 7));

    expect(summary.weeks).toHaveLength(2);
    expect(summary.completedWeeks).toHaveLength(1);
    expect(summary.latestCompletedWeek).toMatchObject({
      weekStart: '2026-07-27',
      whPerKm: 150,
      hit: true,
      isActive: false,
    });
    expect(summary.activeWeek).toMatchObject({
      weekStart: '2026-08-03',
      whPerKm: 200,
      hit: null,
      band: null,
      rank: null,
      isActive: true,
    });
    expect(summary.hitRate).toBe(1);
    expect(summary.currentStreak).toBe(1);
  });

  it('changes a Sunday snapshot to a completed grade at the Monday boundary', () => {
    const sundayDrive = drive(new Date(2026, 7, 9, 9), 10_000, 1_500);

    const sunday = summarizeTarget(
      [sundayDrive],
      160,
      new Date(2026, 7, 9, 20).getTime(),
    );
    const monday = summarizeTarget(
      [sundayDrive],
      160,
      new Date(2026, 7, 10, 0, 1).getTime(),
    );

    expect(sunday.activeWeek?.hit).toBeNull();
    expect(sunday.completedWeeks).toHaveLength(0);
    expect(monday.activeWeek).toBeNull();
    expect(monday.completedWeeks[0]).toMatchObject({ hit: true, band: 'onTarget' });
  });

  it('uses distance weighting for weekly and overall consumption', () => {
    const summary = summarizeTarget(
      [
        drive(new Date(2026, 6, 6, 9), 10_000, 1_000),
        drive(new Date(2026, 6, 7, 9), 30_000, 6_000),
      ],
      180,
      at(2026, 7, 20),
    );

    expect(summary.weeks[0]).toMatchObject({
      whPerKm: 175,
      distanceM: 40_000,
      drives: 2,
      hit: true,
    });
    expect(summary.overallWhPerKm).toBe(175);
  });

  it('computes streaks only across completed observed weeks', () => {
    const weekly = (day: number, whPerKm: number) =>
      drive(new Date(2026, 5, day, 9), 10_000, whPerKm * 10);
    const summary = summarizeTarget(
      [
        weekly(29, 150),
        drive(new Date(2026, 6, 6, 9), 10_000, 1_500),
        drive(new Date(2026, 6, 13, 9), 10_000, 2_100),
        drive(new Date(2026, 6, 20, 9), 10_000, 1_500),
        drive(new Date(2026, 6, 27, 9), 10_000, 1_500),
        drive(new Date(2026, 7, 3, 9), 10_000, 1_000),
      ],
      160,
      at(2026, 8, 7),
    );

    expect(summary.activeWeek?.hit).toBeNull();
    expect(summary.currentStreak).toBe(2);
    expect(summary.longestStreak).toBe(2);
    expect(summary.hitRate).toBeCloseTo(0.8);
  });

  it('builds a four-calendar-week distance-weighted rolling trend', () => {
    const summary = summarizeTarget(
      [
        drive(new Date(2026, 5, 1, 9), 10_000, 1_000),
        drive(new Date(2026, 5, 8, 9), 10_000, 2_000),
        drive(new Date(2026, 5, 15, 9), 30_000, 9_000),
        drive(new Date(2026, 5, 22, 9), 50_000, 20_000),
        drive(new Date(2026, 5, 29, 9), 10_000, 5_000),
      ],
      350,
      at(2026, 6, 30),
    );

    expect(summary.weeks[3]?.rolling4WeekWhPerKm).toBe(320);
    expect(summary.activeWeek?.rolling4WeekWhPerKm).toBe(360);
  });

  it('aggregates weekday patterns by distance rather than drive average', () => {
    const summary = summarizeTarget(
      [
        drive(new Date(2026, 6, 6, 9), 10_000, 1_000),
        drive(new Date(2026, 6, 6, 17), 30_000, 6_000),
        drive(new Date(2026, 6, 7, 9), 20_000, 4_000),
      ],
      180,
      at(2026, 7, 20),
    );

    expect(summary.weekdays).toHaveLength(7);
    expect(summary.weekdays[0]).toMatchObject({
      whPerKm: 175,
      distanceM: 40_000,
      drives: 2,
    });
    expect(summary.weekdays[1]).toMatchObject({ whPerKm: 200, drives: 1 });
    expect(summary.weekdays[2]).toMatchObject({ whPerKm: null, drives: 0 });
  });

  it('uses inclusive target and ten-percent consistency thresholds', () => {
    const summary = summarizeTarget(
      [
        drive(new Date(2026, 6, 6, 9), 10_000, 1_000),
        drive(new Date(2026, 6, 13, 9), 10_000, 1_100),
        // Renders as 110.0 after rounding, but raw 110.04 is still > 10%.
        drive(new Date(2026, 6, 20, 9), 10_000, 1_100.4),
      ],
      100,
      at(2026, 8, 7),
    );

    expect(summary.completedWeeks.map((week) => week.band)).toEqual([
      'onTarget',
      'nearMiss',
      'offTrack',
    ]);
    expect(summary.consistency).toEqual({
      onTarget: 1,
      nearMiss: 1,
      offTrack: 1,
      gradedWeeks: 3,
    });
    expect(summary.completedWeeks.map((week) => week.rank)).toEqual([1, 2, 3]);
  });

  it('filters short, future, and malformed rows while reporting cap coverage', () => {
    const valid = drive(new Date(2026, 6, 30, 9), 10_000, 1_500);
    const rows = [
      valid,
      drive(new Date(2026, 6, 30, 10), 999, 500),
      drive(new Date(2026, 6, 30, 11), Number.NaN, 500),
      drive(new Date(2026, 6, 30, 12), 10_000, 0),
      drive(new Date(2026, 6, 30, 13), 10_000, null),
      drive(new Date(2026, 6, 30, 14), 10_000, 1_000, {
        startTs: 'not-a-date',
      }),
      drive(new Date(2026, 7, 10, 9), 10_000, 1_000),
    ];

    const summary = summarizeTarget(rows, 160, at(2026, 8, 7), {
      historyLimit: 7,
    });

    expect(summary.observed).toBe(7);
    expect(summary.analyzed).toBe(1);
    expect(summary.excluded).toBe(6);
    expect(summary.historyCapReached).toBe(true);
    expect(summary.overallWhPerKm).toBe(150);
  });

  it('does not grade completed weeks when the target is invalid', () => {
    const summary = summarizeTarget(
      [drive(new Date(2026, 6, 6, 9), 10_000, 1_000)],
      0,
      at(2026, 7, 20),
    );

    expect(summary.completedWeeks[0]).toMatchObject({ hit: false, band: null });
    expect(summary.hitRate).toBeNull();
    expect(summary.currentStreak).toBe(0);
    expect(summary.consistency.gradedWeeks).toBe(0);
  });

  it('returns stable empty structures for empty input and invalid clocks', () => {
    const empty = summarizeTarget([], 160, at(2026, 8, 7));
    const invalidClock = summarizeTarget(
      [drive(new Date(2026, 6, 6, 9), 10_000, 1_000)],
      160,
      Number.NaN,
    );

    expect(empty.weeks).toEqual([]);
    expect(empty.weekdays).toHaveLength(7);
    expect(empty.hitRate).toBeNull();
    expect(empty.overallWhPerKm).toBeNull();
    expect(invalidClock).toMatchObject({
      analyzed: 0,
      excluded: 1,
      activeWeekStart: '',
    });
  });
});
