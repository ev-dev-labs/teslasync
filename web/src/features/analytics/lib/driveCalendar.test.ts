import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { buildDriveCalendar } from './driveCalendar';

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

describe('buildDriveCalendar', () => {
  it('starts the grid on a Sunday and ends today', () => {
    const cal = buildDriveCalendar([], NOW);
    expect(cal.days[0]!.day).toBe(0);
    expect(cal.days[cal.days.length - 1]!.date).toBe('2026-07-30');
    expect(cal.weeks).toHaveLength(53);
    expect(cal.weeks[0]!.monthKey).toBe('2025-08');
    expect(cal.weeks.filter((week) => week.monthKey).at(-1)!.monthKey).toBe('2026-07');
  });

  it('aggregates same-day drives into one cell', () => {
    const d = new Date(2026, 6, 20, 9);
    const cal = buildDriveCalendar([driveOn(d, 5_000), driveOn(new Date(2026, 6, 20, 18), 7_000)], NOW);
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
    const cal = buildDriveCalendar(drives, NOW);
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
    const cal = buildDriveCalendar(drives, NOW);
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
    const cal = buildDriveCalendar(drives, NOW);
    expect(cal.currentStreak).toBe(1); // the 29th is empty, today (30th) counts
    expect(cal.longestStreak).toBe(2);
  });

  it('ignores drives outside the 52-week window', () => {
    const cal = buildDriveCalendar([driveOn(new Date(2024, 0, 1, 9))], NOW);
    expect(cal.totalDrives).toBe(0);
    expect(cal.activeDays).toBe(0);
  });

  it('excludes old outliers from the visible heatmap intensity scale', () => {
    const cal = buildDriveCalendar([
      driveOn(new Date(2024, 0, 1, 9), 1_000_000),
      driveOn(new Date(2026, 6, 20, 9), 10_000),
    ], NOW);

    expect(cal.days.find((day) => day.date === '2026-07-20')?.level).toBe(4);
  });

  it('aggregates chronological monthly distance, drives, and active days', () => {
    const cal = buildDriveCalendar([
      driveOn(new Date(2026, 5, 30, 9), 4_000),
      driveOn(new Date(2026, 6, 1, 9), 6_000),
      driveOn(new Date(2026, 6, 1, 18), 2_000),
      driveOn(new Date(2026, 6, 20, 9), 8_000),
    ], NOW);

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
    const cal = buildDriveCalendar([
      driveOn(new Date(2026, 6, 20, 9), 5_000), // Monday
      driveOn(new Date(2026, 6, 20, 18), 7_000),
      driveOn(new Date(2026, 6, 26, 9), 3_000), // Sunday
    ], NOW);

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
    const cal = buildDriveCalendar([
      driveOn(new Date(2026, 5, 1, 9), 6_000),
      driveOn(new Date(2026, 5, 2, 9), 2_000),
      driveOn(new Date(2026, 6, 1, 9), 9_000),
      driveOn(new Date(2026, 6, 2, 9), 4_000),
      driveOn(new Date(2026, 6, 3, 9), 8_000),
      driveOn(new Date(2026, 6, 4, 9), 3_000),
    ], NOW);

    expect(cal.topDays.map((day) => day.distanceM)).toEqual([9_000, 8_000, 6_000, 4_000, 3_000]);
    expect(cal.topDays[0]!.date).toBe('2026-07-01');
    expect(cal.busiestMonth?.month).toBe('2026-07');
    expect(cal.busiestMonth?.distanceM).toBe(24_000);
  });

  it('returns explicit null insights when no distance activity exists', () => {
    const cal = buildDriveCalendar([], NOW);
    expect(cal.topDays).toEqual([]);
    expect(cal.favoriteWeekday).toBeNull();
    expect(cal.busiestMonth).toBeNull();
    expect(cal.averageDistancePerActiveDayM).toBeNull();
    expect(cal.averageDrivesPerActiveDay).toBeNull();
    expect(cal.weekendDistanceShare).toBeNull();
  });
});
