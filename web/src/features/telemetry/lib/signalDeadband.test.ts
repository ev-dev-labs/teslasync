import { describe, expect, it } from 'vitest';
import {
  analyzeSignalDeadband,
  estimateDeltaNoise,
  simulateDeadband,
  toNumericDeadbandSeries,
  type DeadbandSample,
} from './signalDeadband';

const ANCHOR = Date.UTC(2026, 6, 1);

function samples(values: readonly number[], stepMs = 1_000): DeadbandSample[] {
  return values.map((value, index) => ({
    timestamp: new Date(ANCHOR + index * stepMs).toISOString(),
    valueNum: value,
  }));
}

describe('toNumericDeadbandSeries', () => {
  it('accepts camelCase and snake_case histories, sorts, and deduplicates', () => {
    const rows: DeadbandSample[] = [
      { ts: new Date(ANCHOR + 1_000).toISOString(), value_numeric: 2 },
      { timestamp: new Date(ANCHOR).toISOString(), valueNum: 1 },
      { timestamp: new Date(ANCHOR).toISOString(), valueNum: 1.5 },
    ];
    expect(toNumericDeadbandSeries(rows).map((point) => point.value)).toEqual([1.5, 2]);
  });

  it('drops invalid timestamps and non-finite values', () => {
    expect(toNumericDeadbandSeries([
      { timestamp: 'bad', valueNum: 1 },
      { timestamp: new Date(ANCHOR).toISOString(), valueNum: Number.NaN },
      { timestamp: new Date(ANCHOR + 1_000).toISOString(), valueNum: 4 },
    ])).toHaveLength(1);
  });
});

describe('estimateDeltaNoise', () => {
  it('uses a robust MAD that is not inflated by a material outlier', () => {
    const clean = estimateDeltaNoise([0, 0.1, -0.1, 0.05, -0.05, 0]);
    const withStep = estimateDeltaNoise([0, 0.1, -0.1, 100, 99.9, 100]);
    expect(withStep.noiseScale).toBeLessThan(1);
    expect(withStep.noiseScale).toBeLessThan(clean.noiseScale * 3);
  });

  it('does not call a perfectly steady ramp noisy', () => {
    const result = estimateDeltaNoise([0, 2, 4, 6, 8]);
    expect(result.deltaMedian).toBe(2);
    expect(result.deltaMad).toBe(0);
    expect(result.noiseThreshold).toBe(0);
  });
});

describe('simulateDeadband', () => {
  it('compares against the last retained value, not only the adjacent value', () => {
    const result = simulateDeadband([0, 0.2, 0.4, 0.6], 0.5, 0.2);
    expect(result.retainedUpdates).toBe(2);
  });

  it('retains every baseline emission at threshold zero', () => {
    const result = simulateDeadband([5, 5, 5, 5], 0, 0);
    expect(result.retainedUpdates).toBe(4);
    expect(result.reduction).toBe(0);
  });

  it('suppresses small jitter while preserving a large step', () => {
    const result = simulateDeadband([0, 0.05, -0.04, 0.03, 10, 10.02], 0.2, 0.15);
    expect(result.noiseSuppression).toBeGreaterThan(0.7);
    expect(result.materialRetention).toBe(1);
    expect(result.fidelity).toBeGreaterThan(0.98);
  });

  it('returns a safe empty result', () => {
    expect(simulateDeadband([], 1, 1)).toMatchObject({
      retainedUpdates: 0,
      fidelity: 0,
    });
  });
});

describe('analyzeSignalDeadband', () => {
  it('requires at least three numeric observations', () => {
    expect(analyzeSignalDeadband([])).toBeNull();
    expect(analyzeSignalDeadband(samples([1, 2]))).toBeNull();
  });

  it('measures unchanged and MAD-redundant emissions separately', () => {
    const result = analyzeSignalDeadband(samples([10, 10, 10.05, 9.95, 10, 20]))!;
    expect(result.unchangedEmissionRatio).toBeCloseTo(0.2, 5);
    expect(result.redundantEmissionRatio).toBeGreaterThan(result.unchangedEmissionRatio);
  });

  it('returns deterministic, ascending candidate thresholds', () => {
    const first = analyzeSignalDeadband(samples([0, 0.1, -0.1, 0.05, 4, 4.1, 3.9]))!;
    const second = analyzeSignalDeadband(samples([0, 0.1, -0.1, 0.05, 4, 4.1, 3.9]))!;
    expect(first).toEqual(second);
    expect(first.candidates.map((candidate) => candidate.threshold)).toEqual(
      [...first.candidates].map((candidate) => candidate.threshold).sort((a, b) => a - b),
    );
  });

  it('recommends a threshold that suppresses at least 90% of repeated noise', () => {
    const values = [
      ...Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0.02 : -0.02)),
      5,
      ...Array.from({ length: 30 }, (_, i) => 5 + (i % 2 === 0 ? 0.02 : -0.02)),
    ];
    const result = analyzeSignalDeadband(samples(values))!;
    expect(result.recommended.noiseSuppression).toBeGreaterThanOrEqual(0.9);
    expect(result.recommended.materialRetention).toBe(1);
    expect(result.recommended.reduction).toBeGreaterThan(0.8);
  });

  it('balances suppression against fidelity instead of choosing the largest threshold', () => {
    const result = analyzeSignalDeadband(samples([0, 0.1, -0.1, 0, 5, 5.1, 4.9, 5, 10]), {
      candidateThresholds: [0, 0.5, 20],
    })!;
    expect(result.recommended.threshold).toBe(0.5);
    expect(result.recommended.fidelity).toBeGreaterThan(0.9);
  });

  it('accounts for every point in projected retained updates', () => {
    const result = analyzeSignalDeadband(samples([1, 1, 1, 2, 2, 3]), {
      candidateThresholds: [0, 0.5],
    })!;
    expect(result.candidates[0]!.retainedUpdates).toBe(result.sampleCount);
    expect(result.candidates[1]!.retainedUpdates).toBe(3);
  });
});
