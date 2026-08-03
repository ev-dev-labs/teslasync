import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { buildDrivingRhythm, formatFractionalHour } from './drivingRhythm';

let nextId = 1;

/** Drive starting at a LOCAL wall-clock time — the model buckets by local time. */
function driveAt(local: Date, over: Partial<Drive> = {}): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: local.toISOString(),
    endTs: null,
    durationS: 1800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
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
    ...over,
  };
}

// A local Monday 08:15. new Date(2026, 6, 6) = 2026-07-06, a Monday.
const MONDAY_0815 = new Date(2026, 6, 6, 8, 15);
const SUNDAY_1400 = new Date(2026, 6, 5, 14, 0);

describe('buildDrivingRhythm', () => {
  it('buckets drives into the weekday × hour matrix in local time', () => {
    const r = buildDrivingRhythm([driveAt(MONDAY_0815), driveAt(MONDAY_0815)]);
    expect(r.total).toBe(2);
    expect(r.matrix[MONDAY_0815.getDay()]![8]).toBe(2);
    expect(r.maxCount).toBe(2);
    expect(r.favorite).toEqual({ day: MONDAY_0815.getDay(), hour: 8, count: 2 });
  });

  it('splits weekday vs weekend counts', () => {
    const r = buildDrivingRhythm([
      driveAt(MONDAY_0815),
      driveAt(SUNDAY_1400),
      driveAt(SUNDAY_1400),
    ]);
    expect(r.weekdayCount).toBe(1);
    expect(r.weekendCount).toBe(2);
  });

  it('withholds predictability below 5 drives, then scores concentration', () => {
    const few = buildDrivingRhythm([driveAt(MONDAY_0815)]);
    expect(few.predictability).toBeNull();

    const sameHour = buildDrivingRhythm(
      Array.from({ length: 10 }, () => driveAt(MONDAY_0815)),
    );
    expect(sameHour.predictability).toBe(100);

    const spread = buildDrivingRhythm(
      Array.from({ length: 24 }, (_, h) => driveAt(new Date(2026, 6, 6, h, 0))),
    );
    expect(spread.predictability).toBe(0);
  });

  it('computes per-day median departures in fractional hours', () => {
    const r = buildDrivingRhythm([
      driveAt(new Date(2026, 6, 6, 8, 0)),
      driveAt(new Date(2026, 6, 6, 8, 30)),
      driveAt(new Date(2026, 6, 6, 9, 0)),
    ]);
    expect(r.medianDepartureByDay[MONDAY_0815.getDay()]).toBeCloseTo(8.5);
    expect(r.medianDepartureByDay[(MONDAY_0815.getDay() + 1) % 7]).toBeNull();
  });

  it('ignores drives with missing or invalid timestamps', () => {
    const bad = driveAt(MONDAY_0815, { startTs: 'not-a-date' });
    const r = buildDrivingRhythm([bad, driveAt(MONDAY_0815)]);
    expect(r.total).toBe(1);
  });

  it('handles empty input', () => {
    const r = buildDrivingRhythm([]);
    expect(r.total).toBe(0);
    expect(r.favorite).toBeNull();
    expect(r.predictability).toBeNull();
  });
});

describe('formatFractionalHour', () => {
  it('formats whole and fractional hours', () => {
    expect(formatFractionalHour(8)).toBe('08:00');
    expect(formatFractionalHour(8.25)).toBe('08:15');
    expect(formatFractionalHour(14.5)).toBe('14:30');
  });

  it('carries a rounded 60th minute into the next hour', () => {
    expect(formatFractionalHour(7.9999)).toBe('08:00');
    expect(formatFractionalHour(23.9999)).toBe('00:00');
  });
});
