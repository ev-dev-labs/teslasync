import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { estimatePackWh, mulberry32, simulateTrip, SIM_RESERVE_PCT } from './rangeSimulator';

let nextId = 1;

function drive(over: Partial<Drive>): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: null,
    durationS: 3600,
    distanceM: 50_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 66, // 14% for 7.5 kWh → ~53.6 kWh pack
    energyUsedWh: 7_500, // 150 Wh/km over 50 km
    regenEnergyWh: null,
    avgSpeedMps: 20,
    maxSpeedMps: 33,
    avgPowerW: null,
    outsideTempAvgC: 18,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('mulberry32', () => {
  it('is deterministic per seed and uniform-ish in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    const c = mulberry32(43)();
    expect(c).not.toBe(seqA[0]);
  });
});

describe('estimatePackWh', () => {
  it('takes the median implied capacity across drives', () => {
    const drives = [
      drive({}), drive({}), drive({}), drive({}), drive({}),
    ];
    // 7500 Wh / 14% × 100 ≈ 53,571 Wh.
    expect(estimatePackWh(drives)).toBeCloseTo(53_571, -2);
  });

  it('ignores tiny SoC deltas and returns null on thin data', () => {
    const noisy = drive({ startBatteryPct: 80, endBatteryPct: 78 }); // 2% — noise
    expect(estimatePackWh([noisy, noisy, noisy, noisy, noisy])).toBeNull();
    expect(estimatePackWh([drive({})])).toBeNull();
  });
});

describe('simulateTrip', () => {
  const history = Array.from({ length: 20 }, () => drive({}));

  it('is reproducible for a fixed seed', () => {
    const a = simulateTrip(history, 100, 80, { seed: 7 });
    const b = simulateTrip(history, 100, 80, { seed: 7 });
    expect(a).toEqual(b);
  });

  it('computes an exact arrival for a deterministic history', () => {
    // Uniform 150 Wh/km, pack ≈ 53.57 kWh → 100 km uses 15 kWh = 28% of pack.
    const r = simulateTrip(history, 100, 80, { seed: 1 });
    expect(r.p50).not.toBeNull();
    expect(r.p50!).toBeGreaterThan(50);
    expect(r.p50!).toBeLessThan(54);
    expect(r.successProb).toBe(1);
    expect(r.p10! <= r.p50! && r.p50! <= r.p90!).toBe(true);
  });

  it('reflects risk when the trip stretches the pack', () => {
    // ~350 km at 150 Wh/km ≈ 52.5 kWh ≈ 98% of the pack from 90%: doomed.
    const r = simulateTrip(history, 350, 90, { seed: 1 });
    expect(r.successProb).toBeLessThan(0.5);
  });

  it('mixes efficient and thirsty history into spread', () => {
    const mixed = [
      ...Array.from({ length: 10 }, () => drive({ energyUsedWh: 5_000 })), // 100 Wh/km
      ...Array.from({ length: 10 }, () => drive({ energyUsedWh: 10_000 })), // 200 Wh/km
    ];
    const r = simulateTrip(mixed, 150, 90, { seed: 3, trials: 3000 });
    expect(r.p10!).toBeLessThan(r.p90!);
    // Histogram counts must cover every trial.
    expect(r.histogram.reduce((s, b) => s + b.count, 0)).toBe(3000);
  });

  it('honours a pack override and withholds results on thin history', () => {
    const r = simulateTrip(history, 100, 80, { seed: 1, packWhOverride: 100_000 });
    // Double the pack → half the SoC cost (~15% instead of ~28%).
    expect(r.p50!).toBeGreaterThan(60);
    const thin = simulateTrip(history.slice(0, 4), 100, 80, { seed: 1 });
    expect(thin.p50).toBeNull();
    expect(thin.successProb).toBeNull();
  });

  it('exports a sane reserve threshold', () => {
    expect(SIM_RESERVE_PCT).toBeGreaterThan(0);
    expect(SIM_RESERVE_PCT).toBeLessThan(50);
  });
});
