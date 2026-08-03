import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { computeSweetSpot } from './speedSweetSpot';

let nextId = 1;

/** Drive at a given avg speed (km/h) and consumption (Wh/km) over 10 km. */
function drive(speedKph: number, whPerKm: number, over: Partial<Drive> = {}): Drive {
  const distanceM = 10_000;
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: null,
    durationS: (distanceM / 1000 / speedKph) * 3600,
    distanceM,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: whPerKm * (distanceM / 1000),
    regenEnergyWh: null,
    avgSpeedMps: speedKph / 3.6,
    maxSpeedMps: (speedKph + 20) / 3.6,
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

describe('computeSweetSpot', () => {
  it('finds the lowest-consumption qualified bucket', () => {
    const drives = [
      // 55 km/h bucket (50–60): efficient.
      drive(52, 130), drive(55, 140), drive(58, 135),
      // 105 km/h bucket (100–110): thirsty.
      drive(102, 190), drive(105, 200), drive(108, 195),
    ];
    const r = computeSweetSpot(drives);
    expect(r.analyzed).toBe(6);
    expect(r.sweetSpot).not.toBeNull();
    expect(r.sweetSpot!.fromKph).toBe(50);
    expect(r.sweetSpot!.toKph).toBe(60);
    expect(r.sweetSpot!.whPerKm).toBeCloseTo(135, 0);
  });

  it('ignores buckets with fewer drives than the qualification floor', () => {
    const drives = [
      drive(52, 100), // lone efficient outlier — must not win
      drive(102, 190), drive(105, 200), drive(108, 195),
    ];
    const r = computeSweetSpot(drives);
    expect(r.sweetSpot!.fromKph).toBe(100);
  });

  it('weights bucket consumption by distance', () => {
    const long = drive(55, 100, { distanceM: 90_000, energyUsedWh: 9_000 });
    const short = drive(55, 200, { distanceM: 10_000, energyUsedWh: 2_000 });
    const filler = drive(55, 110);
    const r = computeSweetSpot([long, short, filler]);
    // (9000 + 2000 + 1100) / 110 km = 110 Wh/km — dominated by the long drive.
    expect(r.points[0]!.whPerKm).toBeCloseTo(110, 0);
  });

  it('filters short, slow, and data-less drives', () => {
    const r = computeSweetSpot([
      drive(55, 140, { distanceM: 500 }), // too short
      drive(55, 140, { durationS: 60 }), // too brief
      drive(55, 140, { energyUsedWh: null }), // no energy
      drive(55, 140, { avgSpeedMps: null }), // no speed
    ]);
    expect(r.analyzed).toBe(0);
    expect(r.sweetSpot).toBeNull();
    expect(r.overallWhPerKm).toBeNull();
    expect(r.savingShare).toBeNull();
  });

  it('reports the relative saving vs overall consumption', () => {
    const drives = [
      drive(55, 100), drive(55, 100), drive(55, 100),
      drive(105, 200), drive(105, 200), drive(105, 200),
    ];
    const r = computeSweetSpot(drives);
    expect(r.overallWhPerKm).toBeCloseTo(150, 0);
    expect(r.sweetSpot!.whPerKm).toBeCloseTo(100, 0);
    expect(r.savingShare).toBeCloseTo(1 / 3, 2);
  });

  it('emits ascending bucket points', () => {
    const drives = [drive(105, 200), drive(55, 130), drive(75, 150)];
    const speeds = computeSweetSpot(drives).points.map((p) => p.speedKph);
    expect(speeds).toEqual([...speeds].sort((a, b) => a - b));
  });
});
