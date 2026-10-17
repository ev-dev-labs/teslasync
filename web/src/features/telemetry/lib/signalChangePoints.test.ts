import { describe, expect, it } from 'vitest';
import {
  detectChangePoints,
  estimateNoiseScale,
  robustSpread,
  summarizeSignalChangePoints,
  toNumericPoints,
  type ChangePointSample,
} from './signalChangePoints';

const HOUR = 3_600_000;
const BASE = Date.UTC(2024, 0, 1, 0, 0, 0);

/**
 * Deterministic pseudo-noise: no Math.random, fully reproducible, but
 * (unlike a plain sine wave, which is smooth and highly autocorrelated
 * from one integer step to the next) behaves like genuine sample-to-sample
 * noise thanks to the large multiplier aliasing the fractional part — the
 * standard "hash from sine" trick.
 */
function jitter(i: number, amplitude: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  const frac = x - Math.floor(x);
  return (frac - 0.5) * 2 * amplitude;
}

function buildSamples(
  levels: readonly { level: number; count: number }[],
  noiseAmplitude = 1,
): ChangePointSample[] {
  const samples: ChangePointSample[] = [];
  let i = 0;
  for (const { level, count } of levels) {
    for (let k = 0; k < count; k++) {
      samples.push({
        ts: new Date(BASE + i * HOUR).toISOString(),
        kind: 'ValueKindDouble',
        value: level + jitter(i, noiseAmplitude),
      });
      i++;
    }
  }
  return samples;
}

describe('toNumericPoints', () => {
  it('keeps measured zero and signed fractions while excluding invalid measurements', () => {
    const values = [null, undefined, NaN, Infinity, -Infinity, '0', false, {}, 0, -0.0001234, 0.0005678];
    const samples = values.map((value, i) => ({
      ts: new Date(BASE + i * HOUR).toISOString(),
      kind: 'ValueKindDouble',
      value,
    }));
    expect(toNumericPoints(samples)).toEqual([
      { ms: BASE + 8 * HOUR, value: 0 },
      { ms: BASE + 9 * HOUR, value: -0.0001234 },
      { ms: BASE + 10 * HOUR, value: 0.0005678 },
    ]);
  });

  it('drops null/undefined/non-numeric samples and sorts ascending', () => {
    const points = toNumericPoints([
      { ts: new Date(BASE + 2 * HOUR).toISOString(), kind: 'ValueKindDouble', value: 3 },
      { ts: '', kind: 'ValueKindDouble', value: 99 },
      { ts: new Date(BASE).toISOString(), kind: 'ValueKindDouble', value: 1 },
      { ts: new Date(BASE + HOUR).toISOString(), kind: 'ValueKindDouble', value: null },
    ]);
    expect(points).toEqual([
      { ms: BASE, value: 1 },
      { ms: BASE + 2 * HOUR, value: 3 },
    ]);
  });

  it('de-duplicates repeated timestamps, keeping the last value', () => {
    const ts = new Date(BASE).toISOString();
    const points = toNumericPoints([
      { ts, kind: 'ValueKindDouble', value: 1 },
      { ts, kind: 'ValueKindDouble', value: 2 },
    ]);
    expect(points).toEqual([{ ms: BASE, value: 2 }]);
  });

  it('returns an empty array for no samples', () => {
    expect(toNumericPoints([])).toEqual([]);
  });
});

describe('robustSpread', () => {
  it('is zero for a constant series', () => {
    expect(robustSpread([5, 5, 5, 5])).toBe(0);
  });

  it('is unmoved by a single extreme outlier (median resistance)', () => {
    const withOutlier = robustSpread([10, 10, 10, 10, 10, 10, 10, 1000]);
    const without = robustSpread([10, 10, 10, 10, 10, 10, 10]);
    expect(withOutlier).toBe(without);
  });

  it('returns 0 for an empty array', () => {
    expect(robustSpread([])).toBe(0);
  });
});

describe('estimateNoiseScale', () => {
  it('is small for a stable, lightly-jittered signal', () => {
    const values = Array.from({ length: 40 }, (_, i) => 10 + jitter(i, 1));
    expect(estimateNoiseScale(values)).toBeLessThan(3);
  });

  it('is NOT inflated by a single large, sustained level shift', () => {
    const flat = Array.from({ length: 40 }, (_, i) => 10 + jitter(i, 1));
    const shifted = [
      ...Array.from({ length: 20 }, (_, i) => 10 + jitter(i, 1)),
      ...Array.from({ length: 20 }, (_, i) => 60 + jitter(i, 1)),
    ];
    const flatScale = estimateNoiseScale(flat);
    const shiftedScale = estimateNoiseScale(shifted);
    // A single 50-unit step among 40 samples should barely move the
    // diff-based median scale, unlike a raw-value spread which would
    // balloon from ~1 to ~25.
    expect(Math.abs(shiftedScale - flatScale)).toBeLessThan(2);
  });

  it('returns 0 for fewer than two samples', () => {
    expect(estimateNoiseScale([])).toBe(0);
    expect(estimateNoiseScale([5])).toBe(0);
  });
});

describe('detectChangePoints — flat signal', () => {
  it('retains a finite, sub-milliscale noise estimate without rounding', () => {
    const values = Array.from({ length: 60 }, (_, i) => -0.0001234 + jitter(i, 0.00001));
    const ts = values.map((_, i) => BASE + i * HOUR);
    const result = detectChangePoints(values, ts);
    expect(result.globalSpread).toBe(estimateNoiseScale(values));
    expect(Number.isFinite(result.globalSpread)).toBe(true);
    expect(result.globalSpread).toBeGreaterThan(1e-9);
    expect(result.globalSpread).toBeLessThan(0.0005);
    expect(result.changePoints).toEqual([]);
  });

  it('reports zero change points for a stable, lightly-jittered series', () => {
    const values = Array.from({ length: 60 }, (_, i) => 20 + jitter(i, 1));
    const ts = Array.from({ length: 60 }, (_, i) => BASE + i * HOUR);
    const { changePoints, segments } = detectChangePoints(values, ts);
    expect(changePoints).toHaveLength(0);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.samples).toBe(60);
  });
});

describe('detectChangePoints — sustained drift policy', () => {
  it.each([{ step: 0.01, direction: 'up' }, { step: -0.01, direction: 'down' }])(
    'can repeatedly alarm on a slow $direction ramp after resetting the baseline',
    ({ step, direction }) => {
      const values = Array.from({ length: 60 }, (_, i) => i * step);
      const ts = values.map((_, i) => BASE + i * HOUR);
      const result = detectChangePoints(values, ts);

      expect(result.changePoints.length).toBeGreaterThan(1);
      expect(result.segments).toHaveLength(result.changePoints.length + 1);
      expect(result.changePoints.every((point) => point.direction === direction)).toBe(true);
      for (const [index, point] of result.changePoints.entries()) {
        const previousIndex = result.changePoints[index - 1]?.index ?? 0;
        expect(point.index - previousIndex).toBeGreaterThanOrEqual(4);
        expect(point.ms).toBe(ts[point.index]);
      }
    },
  );
});

describe('detectChangePoints — single sustained level shift', () => {
  const samples = buildSamples([
    { level: 10, count: 40 },
    { level: 60, count: 40 },
  ]);
  const points = toNumericPoints(samples);
  const values = points.map((p) => p.value);
  const ts = points.map((p) => p.ms);
  const result = detectChangePoints(values, ts);

  it('detects exactly one change point', () => {
    expect(result.changePoints).toHaveLength(1);
  });

  it('locates it near the true shift boundary (index 40)', () => {
    const cp = result.changePoints[0]!;
    expect(cp.index).toBeGreaterThanOrEqual(40);
    expect(cp.index).toBeLessThan(60);
  });

  it('reports the correct direction and a large magnitude', () => {
    const cp = result.changePoints[0]!;
    expect(cp.direction).toBe('up');
    expect(cp.magnitude).toBeGreaterThan(30);
  });

  it('produces two segments whose means bracket the shift', () => {
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]!.mean).toBeLessThan(20);
    expect(result.segments[1]!.mean).toBeGreaterThan(50);
  });

  it('gives high confidence for such a large, unambiguous shift', () => {
    expect(result.changePoints[0]!.confidence).toBeGreaterThan(0.8);
  });
});

describe('detectChangePoints — three regimes (up then down)', () => {
  const samples = buildSamples([
    { level: 20, count: 30 },
    { level: 70, count: 30 },
    { level: 15, count: 30 },
  ]);
  const points = toNumericPoints(samples);
  const values = points.map((p) => p.value);
  const ts = points.map((p) => p.ms);
  const result = detectChangePoints(values, ts);

  it('detects exactly two change points', () => {
    expect(result.changePoints).toHaveLength(2);
  });

  it('reports up then down directions in chronological order', () => {
    expect(result.changePoints[0]!.direction).toBe('up');
    expect(result.changePoints[1]!.direction).toBe('down');
  });

  it('produces three segments', () => {
    expect(result.segments).toHaveLength(3);
  });
});

describe('detectChangePoints — single-sample outlier robustness', () => {
  it('does not report a change point for one transient spike', () => {
    const values = Array.from({ length: 60 }, (_, i) => 10 + jitter(i, 1));
    values[30] = 1000; // one wild reading, reverts immediately after
    const ts = Array.from({ length: 60 }, (_, i) => BASE + i * HOUR);
    const { changePoints, segments } = detectChangePoints(values, ts);
    expect(changePoints).toHaveLength(0);
    expect(segments).toHaveLength(1);
  });
});

describe('detectChangePoints — minimum segment length guard', () => {
  it('never reports a change point inside the first MIN_SEGMENT_SAMPLES', () => {
    // A hard, instantaneous jump one sample in — even though it is a real,
    // sustained shift, the fixed minimum-segment guard means it cannot be
    // confirmed (and reported) until the segment since the last change
    // reaches MIN_SEGMENT_SAMPLES (5) samples, i.e. index 4 at the
    // earliest (0-indexed, starting from segStart = 0).
    const values = [10, 90, 90, 90, 90, 90, 90, 90, 90, 90];
    const ts = values.map((_, i) => BASE + i * HOUR);
    const { changePoints } = detectChangePoints(values, ts);
    for (const cp of changePoints) {
      expect(cp.index).toBeGreaterThanOrEqual(4);
    }
  });

  it('reports minSegmentSamples on the summary', () => {
    const summary = summarizeSignalChangePoints(buildSamples([{ level: 5, count: 10 }]));
    expect(summary.minSegmentSamples).toBe(5);
  });
});

describe('detectChangePoints — empty and tiny inputs', () => {
  it('returns empty results for zero samples', () => {
    const result = detectChangePoints([], []);
    expect(result.segments).toEqual([]);
    expect(result.changePoints).toEqual([]);
    expect(result.globalSpread).toBe(0);
  });

  it('returns a single segment and no change points for a handful of samples', () => {
    const values = [10, 11, 9, 10];
    const ts = values.map((_, i) => BASE + i * HOUR);
    const result = detectChangePoints(values, ts);
    expect(result.changePoints).toEqual([]);
    expect(result.segments).toHaveLength(1);
  });
});

describe('summarizeSignalChangePoints', () => {
  it('distinguishes missing and invalid history from a measured zero regime', () => {
    const samples: ChangePointSample[] = [null, undefined, NaN, Infinity, -Infinity].map((value, i) => ({
      ts: new Date(BASE + i * HOUR).toISOString(),
      kind: 'ValueKindDouble',
      value,
    }));
    expect(summarizeSignalChangePoints(samples)).toMatchObject({
      samples: 0, segments: [], changePoints: [], globalSpread: 0, biggestChange: null,
    });
  });

  it.each([1, -1])('selects the largest fractional shift before formatting (sign %s)', (sign) => {
    const samples = buildSamples([
      { level: 0, count: 30 },
      { level: sign * 0.0001, count: 30 },
      { level: sign * 0.00021, count: 30 },
    ], 0);
    const confidenceEffectSizeScale = 1_000_000;
    const summary = summarizeSignalChangePoints(samples, { confidenceEffectSizeScale });
    expect(summary.changePoints).toHaveLength(2);
    expect(summary.globalSpread).toBe(1e-9);
    const [first, second] = summary.changePoints;
    expect(second!.magnitude).toBeGreaterThan(first!.magnitude);
    expect(summary.biggestChange).toBe(second);
    expect(Math.round(first!.magnitude * 1000)).toBe(Math.round(second!.magnitude * 1000));
    for (const point of summary.changePoints) {
      const segment = summary.segments.find((candidate) => candidate.endIndex === point.index - 1)!;
      const after = samples.slice(point.index, point.index + summary.minSegmentSamples);
      const afterMean = after.reduce((sum, sample) => sum + Number(sample.value), 0) / after.length;
      expect(point.beforeMean).toBe(segment.mean);
      expect(point.afterMean).toBe(afterMean);
      expect(point.magnitude).toBe(Math.abs(afterMean - segment.mean));
      expect(point.confidence).toBe(point.magnitude / summary.globalSpread / confidenceEffectSizeScale);
      expect(point.confidence).toBeGreaterThan(0);
      expect(point.confidence).toBeLessThan(1);
      expect(point.direction).toBe(sign > 0 ? 'up' : 'down');
      expect([point.beforeMean, point.afterMean, point.magnitude, point.confidence].every(Number.isFinite)).toBe(true);
    }
  });

  it('retains a canonical zero regime without inventing a change point', () => {
    const summary = summarizeSignalChangePoints(buildSamples([{ level: 0, count: 40 }], 0));
    expect(summary.samples).toBe(40);
    expect(summary.segments).toHaveLength(1);
    expect(summary.segments[0]).toMatchObject({
      startMs: BASE, endMs: BASE + 39 * HOUR, samples: 40, mean: 0, spread: 0,
    });
    expect(summary.changePoints).toEqual([]);
    expect(summary.biggestChange).toBeNull();
    expect(summary.minSegmentSamples).toBe(5);
  });

  it('picks the largest change point as biggestChange', () => {
    const samples = buildSamples([
      { level: 0, count: 30 },
      { level: 5, count: 30 },
      { level: 100, count: 30 },
    ]);
    const summary = summarizeSignalChangePoints(samples);
    expect(summary.biggestChange).not.toBeNull();
    expect(summary.biggestChange!.direction).toBe('up');
    expect(summary.biggestChange!.magnitude).toBeGreaterThan(50);
  });

  it('returns biggestChange null when no change points are found', () => {
    const summary = summarizeSignalChangePoints(buildSamples([{ level: 42, count: 40 }]));
    expect(summary.changePoints).toHaveLength(0);
    expect(summary.biggestChange).toBeNull();
  });

  it('counts samples correctly after de-duplication', () => {
    const summary = summarizeSignalChangePoints(buildSamples([{ level: 1, count: 25 }]));
    expect(summary.samples).toBe(25);
  });
});
