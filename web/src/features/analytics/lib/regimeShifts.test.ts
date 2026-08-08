import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { binarySegmentation, buildWeeklySeries, summarizeRegimes } from './regimeShifts';

let nextId = 1;

/** One drive in the week starting at the given local Monday. */
function weekDrive(monday: Date, whPerKm: number, tempC = 15): Drive {
  const distanceM = 100_000;
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 2, 9).toISOString(),
    endTs: null,
    durationS: 5400,
    distanceM,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 90,
    endBatteryPct: 60,
    energyUsedWh: whPerKm * (distanceM / 1000),
    regenEnergyWh: null,
    avgSpeedMps: 18,
    maxSpeedMps: 33,
    avgPowerW: null,
    outsideTempAvgC: tempC,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

/** N consecutive Mondays starting 2026-01-05. */
function mondays(n: number): Date[] {
  return Array.from({ length: n }, (_, i) => new Date(2026, 0, 5 + i * 7));
}

describe('binarySegmentation', () => {
  it('finds a clean level shift', () => {
    const values = [...Array(6).fill(100), ...Array(6).fill(140)];
    expect(binarySegmentation(values, 50)).toEqual([6]);
  });

  it('stays silent on stationary noise', () => {
    const values = Array.from({ length: 12 }, (_, i) => 100 + (i % 2 === 0 ? 2 : -2));
    // Penalty scaled to the noise magnitude keeps pure noise unsplit.
    expect(binarySegmentation(values, 100)).toEqual([]);
  });

  it('respects the minimum segment length', () => {
    const values = [500, ...Array(11).fill(100)];
    for (const s of binarySegmentation(values, 10)) {
      expect(s).toBeGreaterThanOrEqual(3);
      expect(s).toBeLessThanOrEqual(values.length - 3);
    }
  });

  it('finds two shifts in a three-regime series', () => {
    const values = [...Array(5).fill(100), ...Array(5).fill(150), ...Array(5).fill(100)];
    expect(binarySegmentation(values, 100)).toEqual([5, 10]);
  });
});

describe('buildWeeklySeries', () => {
  it('produces one ascending distance-weighted sample per week', () => {
    const [w1, w2] = mondays(2);
    const series = buildWeeklySeries([
      weekDrive(w1!, 150), weekDrive(w1!, 170), weekDrive(w2!, 200),
    ]);
    expect(series).toHaveLength(2);
    expect(series[0]!.whPerKm).toBe(160); // equal distances → plain mean
    expect(series[1]!.whPerKm).toBe(200);
    expect(series[0]!.weekStart < series[1]!.weekStart).toBe(true);
  });
});

describe('summarizeRegimes', () => {
  it('detects a winter-onset shift with temperature attribution', () => {
    const weeks = mondays(16);
    const drives = [
      ...weeks.slice(0, 8).map((m) => weekDrive(m, 140 + (nextId % 2), 18)),
      ...weeks.slice(8).map((m) => weekDrive(m, 185 + (nextId % 2), 2)),
    ];
    const s = summarizeRegimes(drives);
    expect(s.segments.length).toBe(2);
    expect(s.shifts).toHaveLength(1);
    const shift = s.shifts[0]!;
    expect(shift.deltaWhPerKm).toBeGreaterThan(30);
    expect(shift.deltaShare).toBeGreaterThan(0.2);
    expect(shift.tempDeltaC).not.toBeNull();
    expect(shift.tempDeltaC!).toBeLessThan(-10);
  });

  it('reports a single segment for a stable series', () => {
    const drives = mondays(12).map((m) => weekDrive(m, 150 + (nextId % 2)));
    const s = summarizeRegimes(drives);
    expect(s.segments).toHaveLength(1);
    expect(s.shifts).toEqual([]);
    expect(s.segments[0]!.weeks).toBe(12);
  });

  it('withholds segmentation under six weeks of data', () => {
    const s = summarizeRegimes(mondays(4).map((m) => weekDrive(m, 150)));
    expect(s.segments).toEqual([]);
    expect(s.analyzedWeeks).toBe(4);
  });
});
