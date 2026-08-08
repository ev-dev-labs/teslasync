import { describe, it, expect } from 'vitest';
import {
  toNumericPoints,
  quantileEdges,
  binIndex,
  summarizeSignalEntropy,
  type EntropySample,
} from './signalEntropy';

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const MIN = 60_000;

function series(values: readonly number[]): EntropySample[] {
  return values.map((v, i) => ({
    timestamp: new Date(BASE + i * MIN).toISOString(),
    valueNum: v,
  }));
}

describe('toNumericPoints', () => {
  it('drops non-numeric and unparsable-timestamp rows', () => {
    const points = toNumericPoints([
      { timestamp: new Date(BASE).toISOString(), valueNum: 1 },
      { timestamp: new Date(BASE + MIN).toISOString(), valueNum: undefined },
      { timestamp: undefined, valueNum: 2 },
      { timestamp: 'not-a-date', valueNum: 3 },
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]!.value).toBe(1);
  });

  it('sorts ascending and de-duplicates identical timestamps', () => {
    const points = toNumericPoints([
      { timestamp: new Date(BASE + MIN).toISOString(), valueNum: 2 },
      { timestamp: new Date(BASE).toISOString(), valueNum: 1 },
      { timestamp: new Date(BASE).toISOString(), valueNum: 9 },
    ]);
    expect(points.map((p) => p.ms)).toEqual([BASE, BASE + MIN]);
    expect(points[0]!.value).toBe(9);
  });
});

describe('quantileEdges', () => {
  it('collapses a constant series to a single degenerate bin', () => {
    const edges = quantileEdges([5, 5, 5, 5], 8);
    expect(edges).toEqual([5, 5]);
  });

  it('spans the full min–max range', () => {
    const edges = quantileEdges([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4);
    expect(edges[0]).toBe(0);
    expect(edges[edges.length - 1]).toBe(9);
  });
});

describe('binIndex', () => {
  const edges = [0, 10, 20, 30];
  it('assigns the first bin at or below the lowest edge', () => {
    expect(binIndex(-5, edges)).toBe(0);
    expect(binIndex(0, edges)).toBe(0);
  });
  it('assigns interior values to the correct bin', () => {
    expect(binIndex(15, edges)).toBe(1);
  });
  it('assigns the last bin at or above the highest edge', () => {
    expect(binIndex(30, edges)).toBe(2);
    expect(binIndex(999, edges)).toBe(2);
  });
});

describe('summarizeSignalEntropy', () => {
  it('returns a zeroed, empty summary with no samples', () => {
    const s = summarizeSignalEntropy([]);
    expect(s.samples).toBe(0);
    expect(s.entropyBits).toBe(0);
    expect(s.effectiveStates).toBe(1);
    expect(s.rolling).toEqual([]);
  });

  it('reports zero entropy for a perfectly constant signal (fully stuck)', () => {
    const samples = series(Array.from({ length: 40 }, () => 42));
    const s = summarizeSignalEntropy(samples, { bins: 8 });
    expect(s.entropyBits).toBe(0);
    expect(s.normalizedEntropy).toBe(0);
    expect(s.effectiveBins).toBe(1);
    expect(s.dominantBinFraction).toBe(1);
    expect(s.changeRate).toBe(0);
  });

  it('reports near-maximal normalized entropy for an evenly spread signal', () => {
    // 32 evenly spaced values into 4 quantile bins → each bin ~equally
    // populated → entropy close to log2(4) = 2 bits, normalized ~1.
    const samples = series(Array.from({ length: 32 }, (_, i) => i));
    const s = summarizeSignalEntropy(samples, { bins: 4 });
    expect(s.effectiveBins).toBe(4);
    expect(s.entropyBits).toBeGreaterThan(1.9);
    expect(s.normalizedEntropy).toBeGreaterThan(0.95);
    expect(s.effectiveStates).toBeGreaterThan(3.7);
  });

  it('flags a mostly-stuck signal with a high dominant-bin fraction and low entropy', () => {
    const values = Array.from({ length: 100 }, (_, i) => (i < 90 ? 10 : 10 + (i % 5)));
    const samples = series(values);
    const s = summarizeSignalEntropy(samples, { bins: 8 });
    expect(s.dominantBinFraction).toBeGreaterThan(0.85);
    expect(s.normalizedEntropy).toBeLessThan(0.5);
  });

  it('gives a strictly alternating two-state signal a change rate near 1', () => {
    const values = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 0 : 1));
    const samples = series(values);
    const s = summarizeSignalEntropy(samples, { bins: 8 });
    expect(s.changeRate).toBeGreaterThan(0.95);
    expect(s.effectiveBins).toBe(2);
    expect(s.effectiveStates).toBeGreaterThan(1.9);
  });

  it('rolling density is low over a stable stretch and high over a volatile one', () => {
    const stable = Array.from({ length: 30 }, () => 5);
    const volatile = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0 : 20));
    const samples = series([...stable, ...volatile]);
    const s = summarizeSignalEntropy(samples, { bins: 4, rollingWindow: 10, rollingStep: 10 });
    expect(s.rolling.length).toBeGreaterThan(0);
    const firstWindowBits = s.rolling[0]!.bits;
    const lastWindowBits = s.rolling[s.rolling.length - 1]!.bits;
    expect(firstWindowBits).toBeLessThan(lastWindowBits);
  });

  it('produces no rolling points when there are fewer samples than the window', () => {
    const samples = series([1, 2, 3]);
    const s = summarizeSignalEntropy(samples, { rollingWindow: 20 });
    expect(s.rolling).toEqual([]);
  });

  it('reports min/max across the observed values', () => {
    const samples = series([3, 1, 4, 1, 5, 9, 2, 6]);
    const s = summarizeSignalEntropy(samples);
    expect(s.minValue).toBe(1);
    expect(s.maxValue).toBe(9);
  });
});
