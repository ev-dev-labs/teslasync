import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { summarizeTarget, weekStartOf } from './efficiencyTarget';

let nextId = 1;

function drive(local: Date, distanceM: number, energyUsedWh: number): Drive {
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
    energyUsedWh,
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

describe('weekStartOf', () => {
  it('maps any local day to that week’s Monday', () => {
    // 2026-07-06 is a Monday.
    expect(weekStartOf(new Date(2026, 6, 6, 10).getTime())).toBe('2026-07-06');
    expect(weekStartOf(new Date(2026, 6, 9, 10).getTime())).toBe('2026-07-06'); // Thursday
    expect(weekStartOf(new Date(2026, 6, 12, 10).getTime())).toBe('2026-07-06'); // Sunday
    expect(weekStartOf(new Date(2026, 6, 13, 10).getTime())).toBe('2026-07-13'); // next Monday
  });
});

describe('summarizeTarget', () => {
  it('grades weeks by distance-weighted consumption', () => {
    const drives = [
      drive(new Date(2026, 6, 6, 9), 10_000, 1_500), // 150 Wh/km — hit at 160
      drive(new Date(2026, 6, 7, 9), 10_000, 1_500),
      drive(new Date(2026, 6, 13, 9), 10_000, 2_000), // 200 Wh/km — miss
    ];
    const s = summarizeTarget(drives, 160);
    expect(s.weeks).toHaveLength(2);
    expect(s.weeks[0]).toMatchObject({ weekStart: '2026-07-06', whPerKm: 150, hit: true });
    expect(s.weeks[1]).toMatchObject({ weekStart: '2026-07-13', whPerKm: 200, hit: false });
    expect(s.hitRate).toBeCloseTo(0.5);
  });

  it('tracks current and longest streaks over week order', () => {
    const wk = (offsetWeeks: number, whPerKm: number) =>
      drive(new Date(2026, 5, 1 + offsetWeeks * 7, 9), 10_000, whPerKm * 10);
    // hit, hit, miss, hit — current streak 1, longest 2.
    const s = summarizeTarget([wk(0, 150), wk(1, 150), wk(2, 210), wk(3, 150)], 160);
    expect(s.longestStreak).toBe(2);
    expect(s.currentStreak).toBe(1);
  });

  it('filters sub-km drives and reports overall consumption', () => {
    const s = summarizeTarget(
      [drive(new Date(2026, 6, 6, 9), 500, 900), drive(new Date(2026, 6, 6, 12), 20_000, 3_000)],
      160,
    );
    expect(s.analyzed).toBe(1);
    expect(s.overallWhPerKm).toBe(150);
  });

  it('marks nothing hit under an invalid target', () => {
    const s = summarizeTarget([drive(new Date(2026, 6, 6, 9), 10_000, 1_000)], 0);
    expect(s.weeks[0]!.hit).toBe(false);
    expect(s.currentStreak).toBe(0);
  });

  it('handles empty input', () => {
    const s = summarizeTarget([], 160);
    expect(s.weeks).toEqual([]);
    expect(s.hitRate).toBeNull();
    expect(s.overallWhPerKm).toBeNull();
  });
});
