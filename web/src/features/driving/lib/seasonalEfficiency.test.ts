import { describe, expect, it } from 'vitest';
import type { Drive } from '@/types/driving';
import { analyzeSeasonalEfficiency } from './seasonalEfficiency';

let id = 1;

function drive(date: string, whPerKm: number, distanceM = 10_000, overrides: Partial<Drive> = {}): Drive {
  return {
    id: id++,
    vehicleId: 1,
    startTs: date,
    endTs: date,
    durationS: 1800,
    distanceM,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: whPerKm * (distanceM / 1000),
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function harmonicDrives(): Drive[] {
  return Array.from({ length: 36 }, (_, index) => {
    const timestamp = Date.UTC(2023, index, 15);
    const date = new Date(timestamp);
    const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    const day = Math.floor((timestamp - yearStart) / 86_400_000) + 1;
    const phase = 2 * Math.PI * (day - 1) / 365.2425;
    const years = (timestamp - Date.UTC(2024, 5, 15)) / (365.2425 * 86_400_000);
    const efficiency = 180 + 28 * Math.sin(phase) - 12 * Math.cos(2 * phase) + 5 * years;
    return drive(date.toISOString(), efficiency, 5000 + (index % 4) * 5000);
  });
}

describe('analyzeSeasonalEfficiency', () => {
  it('fits annual, semiannual, and trend terms with high explanatory power', () => {
    const result = analyzeSeasonalEfficiency(harmonicDrives(), { ridgeLambda: 0.000001 });
    expect(result.sampleCount).toBe(36);
    expect(result.coefficients).toHaveLength(6);
    expect(result.rSquared).toBeGreaterThan(0.999);
    expect(result.trendWhPerKmPerYear).toBeCloseTo(5, 1);
    expect(result.curve).toHaveLength(365);
    expect(result.months).toHaveLength(12);
  });

  it('returns expected, actual, deseasonalized, and residual values per drive', () => {
    const result = analyzeSeasonalEfficiency(harmonicDrives(), { ridgeLambda: 0.000001 });
    const row = result.observations[10]!;
    expect(row.expectedWhPerKm).not.toBeNull();
    expect(row.deseasonalizedWhPerKm).not.toBeNull();
    expect(row.residualWhPerKm).not.toBeNull();
    expect(Math.abs(row.residualWhPerKm!)).toBeLessThan(0.1);
    expect(result.expectedWhPerKm).toBeCloseTo(result.actualWhPerKm!, 1);
  });

  it('uses distance weights for the aggregate actual efficiency', () => {
    const result = analyzeSeasonalEfficiency([
      drive('2026-01-01T00:00:00Z', 100, 1000),
      drive('2026-02-01T00:00:00Z', 200, 3000),
    ]);
    expect(result.sampleCount).toBe(2);
    expect(result.actualWhPerKm).toBe(175);
    expect(result.coefficients).toBeNull();
  });

  it('produces monthly indices around a 100 baseline', () => {
    const result = analyzeSeasonalEfficiency(harmonicDrives(), { ridgeLambda: 0.000001 });
    expect(Math.max(...result.months.map((month) => month.index))).toBeGreaterThan(105);
    expect(Math.min(...result.months.map((month) => month.index))).toBeLessThan(95);
    expect(result.months[0]?.month).toBe(0);
  });

  it('computes a distance-weighted central residual band', () => {
    const drives = harmonicDrives();
    drives[0] = drive(drives[0]!.startTs, 230, 50_000);
    const result = analyzeSeasonalEfficiency(drives, { ridgeLambda: 0.01 });
    expect(result.residualBand).not.toBeNull();
    expect(result.residualBand!.lowerWhPerKm).toBeLessThanOrEqual(
      result.residualBand!.upperWhPerKm,
    );
    expect(result.curve[100]!.lowerWhPerKm).toBeLessThanOrEqual(
      result.curve[100]!.upperWhPerKm,
    );
  });

  it('filters short, non-positive, implausible, missing-energy, and invalid-date rows', () => {
    const result = analyzeSeasonalEfficiency([
      drive('2026-01-01T00:00:00Z', 180, 999),
      drive('2026-02-01T00:00:00Z', 0),
      drive('2026-03-01T00:00:00Z', 1500),
      drive('2026-04-01T00:00:00Z', 180, 10_000, { energyUsedWh: null }),
      drive('bad', 180),
      drive('2026-05-01T00:00:00Z', 180),
    ]);
    expect(result.sampleCount).toBe(1);
    expect(result.observations[0]?.actualWhPerKm).toBe(180);
  });

  it('withholds fit outputs below the minimum sample count', () => {
    const drives = harmonicDrives().slice(0, 7);
    const result = analyzeSeasonalEfficiency(drives, { minSamples: 8 });
    expect(result.observations).toHaveLength(7);
    expect(result.observations.every((row) => row.expectedWhPerKm == null)).toBe(true);
    expect(result.rSquared).toBeNull();
    expect(result.curve).toEqual([]);
  });

  it('withholds annual terms when many samples cover only a recent short window', () => {
    const recent = Array.from({ length: 50 }, (_, day) =>
      drive(new Date(Date.UTC(2026, 0, day + 1)).toISOString(), 170 + day * 0.2),
    );
    const result = analyzeSeasonalEfficiency(recent);
    expect(result.sampleCount).toBe(50);
    expect(result.spanDays).toBe(49);
    expect(result.coefficients).toBeNull();
    expect(result.rSquared).toBeNull();
    expect(result.curve).toEqual([]);
  });

  it('returns a null R² for perfectly constant observations without failing the fit', () => {
    const drives = Array.from({ length: 12 }, (_, month) =>
      drive(new Date(Date.UTC(2025, month, 1)).toISOString(), 180),
    );
    const result = analyzeSeasonalEfficiency(drives, { ridgeLambda: 1 });
    expect(result.coefficients).not.toBeNull();
    expect(result.rSquared).toBeNull();
    expect(result.trendWhPerKmPerYear).toBeCloseTo(0, 3);
  });

  it('handles empty input and invalid options deterministically', () => {
    const empty = analyzeSeasonalEfficiency([], {
      minSamples: -1,
      ridgeLambda: Number.NaN,
      minDistanceM: -2,
    });
    expect(empty.sampleCount).toBe(0);
    expect(empty.actualWhPerKm).toBeNull();
    expect(empty.residualBand).toBeNull();
  });
});
