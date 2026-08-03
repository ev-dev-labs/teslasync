import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { comfortScore, summarizeRangeBuffer } from './rangeBuffer';

let nextId = 1;

function drive(over: Partial<Drive>): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: '2026-07-01T08:30:00Z',
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

describe('summarizeRangeBuffer', () => {
  it('computes median, lowest, and threshold counts', () => {
    const drives = [10, 30, 50, 70, 90].map((pct) => drive({ endBatteryPct: pct }));
    const s = summarizeRangeBuffer(drives);
    expect(s.analyzed).toBe(5);
    expect(s.medianArrivalPct).toBe(50);
    expect(s.lowestArrivalPct).toBe(10);
    expect(s.lowCount).toBe(1); // 10 < 20
    expect(s.criticalCount).toBe(0); // 10 is not < 10
  });

  it('ignores drives without a usable arrival SoC', () => {
    const s = summarizeRangeBuffer([
      drive({ endBatteryPct: null }),
      drive({ endBatteryPct: NaN }),
      drive({ endBatteryPct: 120 }),
      drive({ endBatteryPct: 55 }),
    ]);
    expect(s.analyzed).toBe(1);
    expect(s.medianArrivalPct).toBe(55);
  });

  it('buckets arrivals into ten decades with 100% in the top bucket', () => {
    const s = summarizeRangeBuffer([
      drive({ endBatteryPct: 0 }),
      drive({ endBatteryPct: 9.9 }),
      drive({ endBatteryPct: 55 }),
      drive({ endBatteryPct: 100 }),
    ]);
    expect(s.buckets).toHaveLength(10);
    expect(s.buckets[0]!.count).toBe(2);
    expect(s.buckets[5]!.count).toBe(1);
    expect(s.buckets[9]!.count).toBe(1);
  });

  it('produces an ascending monthly median trend', () => {
    const s = summarizeRangeBuffer([
      drive({ startTs: '2026-01-05T08:00:00Z', endBatteryPct: 40 }),
      drive({ startTs: '2026-01-20T08:00:00Z', endBatteryPct: 60 }),
      drive({ startTs: '2026-02-05T08:00:00Z', endBatteryPct: 30 }),
    ]);
    expect(s.monthlyMedian).toEqual([
      { month: '2026-01', medianPct: 50 },
      { month: '2026-02', medianPct: 30 },
    ]);
  });

  it('lists the five lowest arrivals as close calls, ascending', () => {
    const drives = [80, 5, 60, 12, 33, 8, 90].map((pct) => drive({ endBatteryPct: pct }));
    const s = summarizeRangeBuffer(drives);
    expect(s.closeCalls.map((c) => c.arrivalPct)).toEqual([5, 8, 12, 33, 60]);
  });

  it('handles an empty input', () => {
    const s = summarizeRangeBuffer([]);
    expect(s.analyzed).toBe(0);
    expect(s.medianArrivalPct).toBeNull();
    expect(s.comfortScore).toBeNull();
    expect(s.closeCalls).toEqual([]);
  });
});

describe('comfortScore', () => {
  it('withholds a score below 5 samples', () => {
    expect(comfortScore([50, 50, 50, 50])).toBeNull();
  });

  it('equals the median when no arrivals are low', () => {
    expect(comfortScore([40, 45, 50, 55, 60])).toBe(50);
  });

  it('penalizes low and critical arrivals', () => {
    // median 50; 1/5 below 20 (−5), the same arrival below 10 (−10).
    expect(comfortScore([5, 45, 50, 55, 60])).toBe(50 - 5 - 10);
  });

  it('clamps to the 0–100 range', () => {
    expect(comfortScore([1, 1, 2, 2, 3])).toBe(0);
  });
});
