import { describe, expect, it } from 'vitest';
import {
  alignHistories,
  analyzeSignalMutualInformation,
  entropyOfBins,
  informationFromBins,
  quantileBins,
  robustCadence,
  seededShuffle,
  toTimedValues,
  type MutualInformationSample,
} from './signalMutualInformation';

const ANCHOR = Date.UTC(2026, 6, 1);

function history(
  values: readonly number[],
  cadenceMs = 60_000,
  offsetMs = 0,
): MutualInformationSample[] {
  return values.map((value, index) => ({
    timestamp: new Date(ANCHOR + offsetMs + index * cadenceMs).toISOString(),
    valueNum: value,
  }));
}

describe('history preparation', () => {
  it('accepts numeric and boolean values while dropping malformed rows', () => {
    const values = toTimedValues([
      { timestamp: new Date(ANCHOR).toISOString(), valueBool: false },
      { ts: new Date(ANCHOR + 1_000).toISOString(), value_bool: true },
      { timestamp: 'bad', valueNum: 4 },
    ]);
    expect(values.map((point) => point.value)).toEqual([0, 1]);
  });

  it('sorts and keeps the last row at duplicate timestamps', () => {
    const timestamp = new Date(ANCHOR).toISOString();
    expect(toTimedValues([
      { timestamp: new Date(ANCHOR + 1_000).toISOString(), valueNum: 3 },
      { timestamp, valueNum: 1 },
      { timestamp, valueNum: 2 },
    ]).map((point) => point.value)).toEqual([2, 3]);
  });

  it('uses a median cadence that resists a long outage', () => {
    const points = toTimedValues([
      ...history([0, 1, 2], 60_000),
      { timestamp: new Date(ANCHOR + 3_600_000).toISOString(), valueNum: 3 },
      { timestamp: new Date(ANCHOR + 3_660_000).toISOString(), valueNum: 4 },
    ]);
    expect(robustCadence(points)).toBe(60_000);
  });
});

describe('alignHistories', () => {
  it('chooses the slower robust cadence and aligns nearest observations', () => {
    const a = history([0, 1, 2, 3, 4, 5, 6], 30_000);
    const b = history([10, 20, 30, 40], 60_000, 5_000);
    const result = alignHistories(a, b);
    expect(result.cadenceMs).toBe(60_000);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
    expect(result.points[0]).toMatchObject({ a: 0, b: 10 });
  });

  it('does not bridge observations beyond the staleness tolerance', () => {
    const a = history([0, 1, 2, 3, 4], 60_000);
    const b = [
      { timestamp: new Date(ANCHOR).toISOString(), valueNum: 10 },
      { timestamp: new Date(ANCHOR + 240_000).toISOString(), valueNum: 20 },
    ];
    const result = alignHistories(a, b, 60_000, 0.4);
    expect(result.points).toHaveLength(2);
  });

  it('returns empty for non-overlapping histories', () => {
    const result = alignHistories(history([1, 2]), history([1, 2], 60_000, 600_000));
    expect(result.points).toEqual([]);
  });
});

describe('quantile information primitives', () => {
  it('assigns every value to a bounded quantile bin', () => {
    const result = quantileBins([1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(result.assignments).toHaveLength(8);
    expect(Math.min(...result.assignments)).toBe(0);
    expect(Math.max(...result.assignments)).toBe(3);
    expect(result.ranges).toHaveLength(4);
  });

  it('computes two bits for four equally likely states', () => {
    expect(entropyOfBins([0, 1, 2, 3], 4)).toBeCloseTo(2, 8);
  });

  it('computes maximal information for identical bins', () => {
    const bins = [0, 1, 2, 3, 0, 1, 2, 3];
    const result = informationFromBins(bins, bins, 4);
    expect(result.mutualInformation).toBeCloseTo(2, 8);
    expect(result.jointEntropy).toBeCloseTo(2, 8);
  });

  it('computes zero information for a balanced Cartesian product', () => {
    const a = [0, 0, 1, 1];
    const b = [0, 1, 0, 1];
    expect(informationFromBins(a, b, 2).mutualInformation).toBeCloseTo(0, 8);
  });
});

describe('deterministic permutation support', () => {
  it('repeats exactly for the same seed', () => {
    expect(seededShuffle([1, 2, 3, 4, 5], 42)).toEqual(seededShuffle([1, 2, 3, 4, 5], 42));
  });

  it('preserves every value and usually changes order', () => {
    const shuffled = seededShuffle([1, 2, 3, 4, 5, 6], 7);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(shuffled).not.toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('analyzeSignalMutualInformation', () => {
  it('returns null below the aligned sample minimum', () => {
    expect(analyzeSignalMutualInformation(history([1, 2]), history([2, 4]))).toBeNull();
  });

  it('detects identical quantile states with normalized MI near one', () => {
    const values = Array.from({ length: 160 }, (_, index) => index % 16);
    const result = analyzeSignalMutualInformation(history(values), history(values), {
      permutations: 100,
      seed: 9,
    })!;
    expect(result.normalizedMutualInformation).toBeGreaterThan(0.99);
    expect(result.significant).toBe(true);
    expect(result.permutationPValue).toBeLessThan(0.05);
  });

  it('detects a nonlinear U-shaped relationship without Pearson correlation', () => {
    const x = Array.from({ length: 240 }, (_, index) => ((index % 41) - 20) / 5);
    const y = x.map((value) => value ** 2);
    const result = analyzeSignalMutualInformation(history(x), history(y), {
      bins: 5,
      permutations: 120,
      seed: 123,
    })!;
    expect(result.normalizedMutualInformation).toBeGreaterThan(0.5);
    expect(result.normalizedMutualInformation).toBeGreaterThan(result.nullThreshold);
    expect(result.significant).toBe(true);
  });

  it('keeps independent deterministic noise near the permutation null', () => {
    let stateA = 11;
    let stateB = 97;
    const random = (state: number) => (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const a = Array.from({ length: 500 }, () => {
      stateA = random(stateA);
      return stateA / 2 ** 32;
    });
    const b = Array.from({ length: 500 }, () => {
      stateB = random(stateB);
      return stateB / 2 ** 32;
    });
    const result = analyzeSignalMutualInformation(history(a), history(b), {
      permutations: 150,
      seed: 88,
    })!;
    expect(result.normalizedMutualInformation).toBeLessThan(0.1);
  });

  it('is fully reproducible with a seeded null model', () => {
    const a = Array.from({ length: 100 }, (_, index) => Math.sin(index / 5));
    const b = a.map((value, index) => value ** 2 + (index % 3) * 0.01);
    const options = { permutations: 40, seed: 321 };
    expect(analyzeSignalMutualInformation(history(a), history(b), options)).toEqual(
      analyzeSignalMutualInformation(history(a), history(b), options),
    );
  });

  it('builds a complete contribution matrix whose cells sum to MI', () => {
    const a = Array.from({ length: 120 }, (_, index) => index % 12);
    const result = analyzeSignalMutualInformation(history(a), history(a), {
      bins: 4,
      permutations: 20,
    })!;
    expect(result.cells).toHaveLength(16);
    expect(result.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(result.alignedCount);
    expect(result.cells.reduce((sum, cell) => sum + cell.contribution, 0))
      .toBeCloseTo(result.mutualInformation, 4);
  });

  it('reports the robust common cadence and aligned bin assignments', () => {
    const a = history(Array.from({ length: 80 }, (_, index) => index), 30_000);
    const b = history(Array.from({ length: 40 }, (_, index) => index ** 2), 60_000);
    const result = analyzeSignalMutualInformation(a, b, { permutations: 10 })!;
    expect(result.cadenceMs).toBe(60_000);
    expect(result.aligned).toHaveLength(result.alignedCount);
    expect(result.aligned.every((point) => point.aBin >= 0 && point.bBin >= 0)).toBe(true);
  });
});
