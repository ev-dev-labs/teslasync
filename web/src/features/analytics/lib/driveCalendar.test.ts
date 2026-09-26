import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { buildDriveCalendar, driveCalendarBounds, type DriveCalendarWindow } from './driveCalendar';

let nextId = 1;

function driveOn(local: Date, distanceM = 10_000): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: local.toISOString(),
    endTs: null,
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
    energyUsedWh: 2000,
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

const NOW = new Date(2026, 6, 30, 18).getTime();
const ROLLING: DriveCalendarWindow = { start: '2025-07-27', end: '2026-07-30' };
const YEAR_2024: DriveCalendarWindow = { start: '2024-01-01', end: '2024-12-31' };

function calendar(drives: readonly Drive[], range: DriveCalendarWindow = ROLLING) {
  return buildDriveCalendar(drives, NOW, range);
}

describe('buildDriveCalendar', () => {
  it('starts the selected window grid on a Sunday and ends at the selected day', () => {
    const cal = calendar([]);
    expect(cal.days[0]!.day).toBe(0);
    expect(cal.days[cal.days.length - 1]!.date).toBe('2026-07-30');
    expect(cal.weeks).toHaveLength(53);
    expect(cal.weeks[0]!.monthKey).toBe('2025-08');
    expect(cal.weeks.filter((week) => week.monthKey).at(-1)!.monthKey).toBe('2026-07');
  });

  it('aggregates same-day drives into one cell', () => {
    const d = new Date(2026, 6, 20, 9);
    const cal = calendar([driveOn(d, 5_000), driveOn(new Date(2026, 6, 20, 18), 7_000)]);
    const cell = cal.days.find((x) => x.date === '2026-07-20')!;
    expect(cell.drives).toBe(2);
    expect(cell.distanceM).toBe(12_000);
    expect(cal.activeDays).toBe(1);
  });

  it('assigns intensity levels 1–4 with the p95 cap', () => {
    const drives = [
      driveOn(new Date(2026, 6, 1, 9), 10_000),
      driveOn(new Date(2026, 6, 2, 9), 10_000),
      driveOn(new Date(2026, 6, 3, 9), 10_000),
      driveOn(new Date(2026, 6, 4, 9), 1_000_000), // the outlier road trip
    ];
    const cal = calendar(drives);
    const normal = cal.days.find((x) => x.date === '2026-07-01')!;
    const epic = cal.days.find((x) => x.date === '2026-07-04')!;
    expect(normal.level).toBeGreaterThanOrEqual(1);
    expect(epic.level).toBe(4);
    expect(cal.busiestDay!.date).toBe('2026-07-04');
  });

  it('computes longest and current streaks, forgiving an empty today', () => {
    const drives = [
      driveOn(new Date(2026, 6, 26, 9)),
      driveOn(new Date(2026, 6, 27, 9)),
      driveOn(new Date(2026, 6, 28, 9)),
      driveOn(new Date(2026, 6, 29, 9)),
      // no drive on the 30th ("today") — streak must still be 4
    ];
    const cal = calendar(drives);
    expect(cal.currentStreak).toBe(4);
    expect(cal.longestStreak).toBe(4);
  });

  it('breaks the current streak on a full missed day', () => {
    const drives = [
      driveOn(new Date(2026, 6, 25, 9)),
      driveOn(new Date(2026, 6, 26, 9)),
      driveOn(new Date(2026, 6, 28, 9)), // gap on the 27th
      driveOn(new Date(2026, 6, 30, 9)),
    ];
    const cal = calendar(drives);
    expect(cal.currentStreak).toBe(1); // the 29th is empty, today (30th) counts
    expect(cal.longestStreak).toBe(2);
  });

  it('ignores drives outside the selected window', () => {
    const cal = calendar([driveOn(new Date(2024, 0, 1, 9))]);
    expect(cal.totalDrives).toBe(0);
    expect(cal.activeDays).toBe(0);
  });

  it('preserves earlier calendar years, including leap day and the last day of December', () => {
    const cal = calendar([
      driveOn(new Date(2024, 1, 29, 9), 5_000),
      driveOn(new Date(2024, 11, 31, 9), 7_000),
      driveOn(new Date(2025, 0, 1, 9), 99_000),
    ], YEAR_2024);
    expect(cal.days.find((day) => day.date === '2024-02-29')).toEqual(
      expect.objectContaining({ drives: 1, distanceM: 5_000 }),
    );
    expect(cal.days.at(-1)!.date).toBe('2024-12-31');
    expect(cal.totalDrives).toBe(2);
    expect(cal.totalDistanceM).toBe(12_000);
    expect(cal.months.map((month) => month.month)).toHaveLength(12);
    expect(cal.months.at(0)?.month).toBe('2024-01');
    expect(cal.months.at(-1)?.month).toBe('2024-12');
    expect(cal.activityRate).toBeCloseTo(2 / 366);
  });

  it('uses year-to-date for the current year and excludes last-year padding', () => {
    const cal = calendar([
      driveOn(new Date(2025, 11, 31, 9)),
      driveOn(new Date(2026, 0, 1, 9)),
      driveOn(new Date(2026, 6, 30, 9)),
    ], { start: '2026-01-01', end: '2026-07-30' });
    expect(cal.totalDrives).toBe(2);
    expect(cal.months.at(0)?.month).toBe('2026-01');
    expect(cal.days.at(-1)?.date).toBe('2026-07-30');
    expect(cal.activityRate).toBeCloseTo(2 / 211);
  });

  it('scopes grid bounds to local calendar midnights and clips future days', () => {
    const { start, endExclusive } = driveCalendarBounds(NOW, YEAR_2024);
    expect(start).toEqual(new Date(2024, 0, 1));
    expect(endExclusive).toEqual(new Date(2025, 0, 1));
    const current = driveCalendarBounds(NOW, { start: '2026-01-01', end: '2026-12-31' });
    expect(current.start).toEqual(new Date(2026, 0, 1));
    expect(current.endExclusive).toEqual(new Date(2026, 6, 31));
  });

  it('keeps every day when a leap year needs 54 Sunday-first columns', () => {
    const cal = calendar([driveOn(new Date(2000, 11, 31, 9))], { start: '2000-01-01', end: '2000-12-31' });
    expect(cal.weeks).toHaveLength(54);
    expect(cal.days.at(-1)?.date).toBe('2000-12-31');
    expect(cal.totalDrives).toBe(1);
  });

  it('excludes old outliers from the visible heatmap intensity scale', () => {
    const cal = calendar([
      driveOn(new Date(2024, 0, 1, 9), 1_000_000),
      driveOn(new Date(2026, 6, 20, 9), 10_000),
    ]);

    expect(cal.days.find((day) => day.date === '2026-07-20')?.level).toBe(4);
  });

  it('aggregates chronological monthly distance, drives, and active days', () => {
    const cal = calendar([
      driveOn(new Date(2026, 5, 30, 9), 4_000),
      driveOn(new Date(2026, 6, 1, 9), 6_000),
      driveOn(new Date(2026, 6, 1, 18), 2_000),
      driveOn(new Date(2026, 6, 20, 9), 8_000),
    ]);

    expect(cal.months.map((month) => month.month)).toEqual(
      [...cal.months.map((month) => month.month)].sort(),
    );
    expect(cal.months.find((month) => month.month === '2026-06')).toEqual(
      expect.objectContaining({ distanceM: 4_000, drives: 1, activeDays: 1 }),
    );
    expect(cal.months.find((month) => month.month === '2026-07')).toEqual(
      expect.objectContaining({ distanceM: 16_000, drives: 3, activeDays: 2 }),
    );
  });

  it('builds Sunday-first weekday totals and deterministic rhythm insights', () => {
    const cal = calendar([
      driveOn(new Date(2026, 6, 20, 9), 5_000), // Monday
      driveOn(new Date(2026, 6, 20, 18), 7_000),
      driveOn(new Date(2026, 6, 26, 9), 3_000), // Sunday
    ]);

    expect(cal.weekdays.map((weekday) => weekday.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(cal.weekdays[1]).toEqual(
      expect.objectContaining({ distanceM: 12_000, drives: 2, activeDays: 1 }),
    );
    expect(cal.favoriteWeekday?.day).toBe(1);
    expect(cal.averageDistancePerActiveDayM).toBe(7_500);
    expect(cal.averageDrivesPerActiveDay).toBe(1.5);
    expect(cal.weekendDistanceShare).toBeCloseTo(0.2);
    expect(cal.activityRate).toBeCloseTo(2 / cal.days.length);
  });

  it('ranks the five highest-distance active days and identifies the peak month', () => {
    const cal = calendar([
      driveOn(new Date(2026, 5, 1, 9), 6_000),
      driveOn(new Date(2026, 5, 2, 9), 2_000),
      driveOn(new Date(2026, 6, 1, 9), 9_000),
      driveOn(new Date(2026, 6, 2, 9), 4_000),
      driveOn(new Date(2026, 6, 3, 9), 8_000),
      driveOn(new Date(2026, 6, 4, 9), 3_000),
    ]);

    expect(cal.topDays.map((day) => day.distanceM)).toEqual([9_000, 8_000, 6_000, 4_000, 3_000]);
    expect(cal.topDays[0]!.date).toBe('2026-07-01');
    expect(cal.busiestMonth?.month).toBe('2026-07');
    expect(cal.busiestMonth?.distanceM).toBe(24_000);
  });

  it('returns explicit null insights when no distance activity exists', () => {
    const cal = calendar([]);
    expect(cal.topDays).toEqual([]);
    expect(cal.favoriteWeekday).toBeNull();
    expect(cal.busiestMonth).toBeNull();
    expect(cal.averageDistancePerActiveDayM).toBeNull();
    expect(cal.averageDrivesPerActiveDay).toBeNull();
    expect(cal.weekendDistanceShare).toBeNull();
  });

  it('scopes a custom two-day range without inflating totals from padded weekdays', () => {
    const cal = calendar([
      driveOn(new Date(2026, 6, 19, 9), 99_000),
      driveOn(new Date(2026, 6, 20, 9), 5_000),
      driveOn(new Date(2026, 6, 21, 9), 7_000),
      driveOn(new Date(2026, 6, 22, 9), 99_000),
    ], { start: '2026-07-20', end: '2026-07-21' });
    expect(cal.days[0]?.day).toBe(0);
    expect(cal.totalDrives).toBe(2);
    expect(cal.totalDistanceM).toBe(12_000);
    expect(cal.activeDays).toBe(2);
    expect(cal.months).toEqual([expect.objectContaining({ totalDays: 2, drives: 2 })]);
  });

  it('does not forgive an empty final day in a completed historical window', () => {
    const cal = calendar([
      driveOn(new Date(2024, 11, 29, 9)),
    ], { start: '2024-12-29', end: '2024-12-31' });
    expect(cal.currentStreak).toBe(0);
    expect(cal.longestStreak).toBe(1);
  });
});
