import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { fitQuadratic, solve3, summarizeAnomalies } from './driveAnomalies';

let nextId = 1;

function drive(speedKph: number, whPerKm: number, over: Partial<Drive> = {}): Drive {
  const distanceM = 20_000;
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
    regenEnergyWh: whPerKm * (distanceM / 1000) * 0.2,
    avgSpeedMps: speedKph / 3.6,
    maxSpeedMps: (speedKph + 20) / 3.6,
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

describe('solve3 / fitQuadratic', () => {
  it('recovers exact quadratic coefficients from clean data', () => {
    // y = 100 + 0.5x + 0.01x²
    const xs = [20, 30, 40, 50, 60, 70, 80, 90, 100];
    const ys = xs.map((x) => 100 + 0.5 * x + 0.01 * x * x);
    const c = fitQuadratic(xs, ys)!;
    expect(c[0]).toBeCloseTo(100, 4);
    expect(c[1]).toBeCloseTo(0.5, 4);
    expect(c[2]).toBeCloseTo(0.01, 6);
  });

  it('returns null for singular systems and thin samples', () => {
    expect(solve3([[1, 1, 1], [2, 2, 2], [3, 3, 3]], [1, 2, 3])).toBeNull();
    expect(fitQuadratic([1, 2, 3], [1, 2, 3])).toBeNull();
  });
});

describe('summarizeAnomalies', () => {
  // Clean baseline: y = 120 + 0.01v² with small alternating noise, at many speeds.
  const SPEEDS = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
  const baseline = () =>
    SPEEDS.map((v, i) => drive(v, 120 + 0.01 * v * v + (i % 2 === 0 ? 1 : -1)));

  it('fits the personal baseline and scores everything near zero', () => {
    const s = summarizeAnomalies(baseline());
    expect(s.coefficients).not.toBeNull();
    expect(s.sigma).not.toBeNull();
    expect(s.outliers).toHaveLength(0);
    expect(Math.max(...s.points.map((p) => Math.abs(p.z)))).toBeLessThan(2);
  });

  it('flags a wildly thirsty drive as an outlier with reasons', () => {
    const cold = drive(60, 260, { outsideTempAvgC: -12, regenEnergyWh: 0 });
    const s = summarizeAnomalies([...baseline(), cold]);
    expect(s.outliers.length).toBeGreaterThanOrEqual(1);
    const flagged = s.outliers[0]!;
    expect(flagged.driveId).toBe(cold.id);
    expect(flagged.z).toBeGreaterThanOrEqual(2);
    expect(flagged.reasons).toContain('cold');
    expect(flagged.reasons).toContain('lowRegen');
  });

  it('marks unusually thrifty drives as efficient outliers', () => {
    const thrifty = drive(60, 60);
    const s = summarizeAnomalies([...baseline(), thrifty]);
    const flagged = s.outliers.find((o) => o.driveId === thrifty.id)!;
    expect(flagged.z).toBeLessThanOrEqual(-2);
    expect(flagged.reasons).toEqual(['efficient']);
  });

  it('produces a monotone-thickness ±2σ band across the speed range', () => {
    const s = summarizeAnomalies(baseline());
    expect(s.curve.length).toBeGreaterThan(10);
    for (const c of s.curve) {
      expect(c.upper2).toBeGreaterThan(c.predicted);
      expect(c.lower2).toBeLessThanOrEqual(c.predicted);
    }
  });

  it('withholds everything below 8 usable drives', () => {
    const s = summarizeAnomalies(baseline().slice(0, 5));
    expect(s.coefficients).toBeNull();
    expect(s.points).toEqual([]);
  });
});
