import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { computeMilestones, milestoneLadder } from './odometerMilestones';

let nextId = 1;

function drive(startTs: string, distanceM: number): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs,
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

const NOW = new Date(2026, 6, 30).getTime();

describe('milestoneLadder', () => {
  it('steps 10k to 100k then 50k beyond', () => {
    const ladder = milestoneLadder(120_000);
    expect(ladder).toContain(10_000);
    expect(ladder).toContain(100_000);
    expect(ladder).toContain(150_000);
    expect(ladder).not.toContain(110_000);
    expect(ladder[0]).toBe(10_000);
  });
});

describe('computeMilestones', () => {
  it('dates each crossed milestone by the crossing drive', () => {
    const drives = [
      drive('2026-01-10T09:00:00Z', 6_000_000), // → 6,000 km
      drive('2026-03-10T09:00:00Z', 5_000_000), // → 11,000 km, crosses 10k
    ];
    const r = computeMilestones(drives, 0, NOW);
    expect(r.passed).toEqual([{ km: 10_000, date: '2026-03-10' }]);
    expect(r.currentKm).toBeCloseTo(11_000);
  });

  it('respects a base odometer calibration', () => {
    const drives = [drive('2026-06-01T09:00:00Z', 3_000_000)]; // +3,000 km
    const r = computeMilestones(drives, 9_000, NOW);
    expect(r.currentKm).toBeCloseTo(12_000);
    expect(r.passed).toEqual([{ km: 10_000, date: '2026-06-01' }]);
    // Next up starts above the base, never behind it.
    expect(r.upcoming[0]!.km).toBe(20_000);
  });

  it('crossing two milestones in one drive dates both to it', () => {
    const drives = [drive('2026-06-01T09:00:00Z', 25_000_000)]; // 25,000 km
    const r = computeMilestones(drives, 0, NOW);
    expect(r.passed.map((p) => p.km)).toEqual([10_000, 20_000]);
    expect(new Set(r.passed.map((p) => p.date)).size).toBe(1);
  });

  it('projects upcoming ETAs from the trailing 90-day pace', () => {
    // Five recent drives, 900 km each within the window → 4,500 km / 90 d = 50 km/day.
    const drives = Array.from({ length: 5 }, (_, i) =>
      drive(`2026-07-${String(i + 10).padStart(2, '0')}T09:00:00Z`, 900_000),
    );
    const r = computeMilestones(drives, 0, NOW);
    expect(r.paceKmPerDay).toBeCloseTo(50, 0);
    expect(r.upcoming[0]!.km).toBe(10_000);
    expect(r.upcoming[0]!.etaMs).not.toBeNull();
    expect(r.upcoming[0]!.etaMs!).toBeGreaterThan(NOW);
    expect(r.upcoming.length).toBe(3);
  });

  it('withholds pace and ETAs on thin history', () => {
    const r = computeMilestones([drive('2026-07-10T09:00:00Z', 900_000)], 0, NOW);
    expect(r.paceKmPerDay).toBeNull();
    expect(r.upcoming[0]!.etaMs).toBeNull();
  });
});
