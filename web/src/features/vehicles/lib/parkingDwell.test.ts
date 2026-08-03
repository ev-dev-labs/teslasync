import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { nightOverlapMs, summarizeParking } from './parkingDwell';

let nextId = 1;

const HOUR = 3_600_000;

/** Drive with explicit LOCAL start/end times (the night split is local-time). */
function drive(start: Date, end: Date, endAddress: string | null = 'Home'): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: start.toISOString(),
    endTs: end.toISOString(),
    durationS: (end.getTime() - start.getTime()) / 1000,
    distanceM: 10_000,
    startAddress: null,
    endAddress,
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
  };
}

describe('nightOverlapMs', () => {
  it('returns zero for a fully-daytime window', () => {
    const from = new Date(2026, 6, 6, 9, 0).getTime();
    const to = new Date(2026, 6, 6, 17, 0).getTime();
    expect(nightOverlapMs(from, to)).toBe(0);
  });

  it('counts the 22:00–06:00 overlap across midnight', () => {
    const from = new Date(2026, 6, 6, 21, 0).getTime();
    const to = new Date(2026, 6, 7, 7, 0).getTime();
    // 22:00→06:00 = 8 h of the 10 h window.
    expect(nightOverlapMs(from, to)).toBe(8 * HOUR);
  });

  it('counts full nights over multi-day stints', () => {
    const from = new Date(2026, 6, 6, 12, 0).getTime();
    const to = new Date(2026, 6, 8, 12, 0).getTime();
    // Two complete nights of 8 h each.
    expect(nightOverlapMs(from, to)).toBe(16 * HOUR);
  });

  it('returns zero for empty or inverted windows', () => {
    const t = new Date(2026, 6, 6, 12, 0).getTime();
    expect(nightOverlapMs(t, t)).toBe(0);
    expect(nightOverlapMs(t, t - HOUR)).toBe(0);
  });
});

describe('summarizeParking', () => {
  it('builds stints from the gaps between consecutive drives', () => {
    const d1 = drive(new Date(2026, 6, 6, 8, 0), new Date(2026, 6, 6, 9, 0), 'Office');
    const d2 = drive(new Date(2026, 6, 6, 17, 0), new Date(2026, 6, 6, 18, 0), 'Home');
    const now = new Date(2026, 6, 6, 20, 0).getTime();

    const s = summarizeParking([d2, d1], now); // order-independent

    expect(s.stints).toHaveLength(2);
    expect(s.stints[0]).toMatchObject({ location: 'Office', ongoing: false, durationMs: 8 * HOUR });
    expect(s.stints[1]).toMatchObject({ location: 'Home', ongoing: true, durationMs: 2 * HOUR });
    expect(s.totalParkedMs).toBe(10 * HOUR);
    expect(s.totalDrivingMs).toBe(2 * HOUR);
    expect(s.parkedShare).toBeCloseTo(10 / 12);
  });

  it('aggregates dwell per location with shares, descending', () => {
    const d1 = drive(new Date(2026, 6, 6, 8, 0), new Date(2026, 6, 6, 9, 0), 'Office');
    const d2 = drive(new Date(2026, 6, 6, 12, 0), new Date(2026, 6, 6, 13, 0), 'Home');
    const now = new Date(2026, 6, 6, 22, 0).getTime();

    const s = summarizeParking([d1, d2], now);
    // Office 09→12 = 3 h; Home 13→22 = 9 h.
    expect(s.locations[0]).toMatchObject({ location: 'Home', totalMs: 9 * HOUR, stints: 1 });
    expect(s.locations[0]!.share).toBeCloseTo(9 / 12);
    expect(s.locations[1]).toMatchObject({ location: 'Office', totalMs: 3 * HOUR });
    expect(s.longestStint?.location).toBe('Home');
  });

  it('drops negative gaps from overlapping records', () => {
    const d1 = drive(new Date(2026, 6, 6, 8, 0), new Date(2026, 6, 6, 10, 0), 'A');
    const overlapping = drive(new Date(2026, 6, 6, 9, 0), new Date(2026, 6, 6, 11, 0), 'B');
    const now = new Date(2026, 6, 6, 12, 0).getTime();

    const s = summarizeParking([d1, overlapping], now);
    // Only the trailing stint after the second drive survives.
    expect(s.stints).toHaveLength(1);
    expect(s.stints[0]!.location).toBe('B');
  });

  it('handles empty input', () => {
    const s = summarizeParking([], Date.UTC(2026, 6, 6));
    expect(s.stints).toEqual([]);
    expect(s.parkedShare).toBeNull();
    expect(s.nightShare).toBeNull();
    expect(s.longestStint).toBeNull();
  });
});
