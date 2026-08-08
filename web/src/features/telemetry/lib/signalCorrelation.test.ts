import { describe, it, expect } from 'vitest';
import type { SignalObservation } from '@/types/signals';
import {
  crossCorrelate,
  effectiveSampleSize,
  pearson,
  resample,
  toNumericSeries,
} from './signalCorrelation';

const ANCHOR = Date.UTC(2026, 6, 1, 0, 0, 0);

function obs(name: string, secondsIn: number, value: number | boolean | null): SignalObservation {
  return {
    vehicle_id: 1,
    ts: new Date(ANCHOR + secondsIn * 1000).toISOString(),
    signal_name: name,
    value_numeric: typeof value === 'number' ? value : null,
    value_text: null,
    value_bool: typeof value === 'boolean' ? value : null,
    source: 'telemetry' as SignalObservation['source'],
  };
}

/** A signal sampled every `stepS` seconds from a generator. */
function signal(
  name: string,
  n: number,
  stepS: number,
  fn: (i: number) => number,
  offsetS = 0,
): SignalObservation[] {
  return Array.from({ length: n }, (_, i) => obs(name, offsetS + i * stepS, fn(i)));
}

describe('toNumericSeries', () => {
  it('keeps numerics, promotes booleans and drops text-only rows', () => {
    const series = toNumericSeries([
      obs('a', 0, 12.5),
      obs('a', 60, true),
      obs('a', 120, false),
      obs('a', 180, null),
    ]);
    expect(series.map((p) => p.value)).toEqual([12.5, 1, 0]);
  });

  it('sorts by time and collapses duplicate timestamps to the last value', () => {
    const series = toNumericSeries([obs('a', 120, 3), obs('a', 0, 1), obs('a', 0, 2)]);
    expect(series.map((p) => p.value)).toEqual([2, 3]);
  });

  it('discards unparseable timestamps', () => {
    const bad = { ...obs('a', 0, 5), ts: 'not a date' };
    expect(toNumericSeries([bad, obs('a', 60, 6)])).toHaveLength(1);
  });
});

describe('resample', () => {
  const points = [
    { ms: ANCHOR, value: 10 },
    { ms: ANCHOR + 300_000, value: 20 },
  ];

  it('holds the last observation forward across the grid', () => {
    // 0 → 600 s in 60 s steps is 11 grid points.
    const r = resample(points, ANCHOR, ANCHOR + 600_000, 60_000, 600_000);
    expect(r.v).toEqual([10, 10, 10, 10, 10, 20, 20, 20, 20, 20, 20]);
    expect(r.gaps).toBe(0);
  });

  it('marks samples older than the staleness limit as gaps', () => {
    // 120 s staleness: each held value expires two steps after its sample.
    const r = resample(points, ANCHOR, ANCHOR + 600_000, 60_000, 120_000);
    expect(r.v).toEqual([10, 10, 10, null, null, 20, 20, 20, null, null, null]);
    expect(r.gaps).toBe(5);
    expect(r.filled).toBe(6);
  });

  it('never interpolates backwards from a future sample', () => {
    const r = resample([{ ms: ANCHOR + 300_000, value: 99 }], ANCHOR, ANCHOR + 300_000, 60_000, 600_000);
    expect(r.v.slice(0, 5).every((x) => x === null)).toBe(true);
    expect(r.v[5]).toBe(99);
  });

  it('degrades safely on a nonsense window', () => {
    expect(resample(points, ANCHOR + 1000, ANCHOR, 60_000, 600_000).t).toEqual([]);
    expect(resample(points, ANCHOR, ANCHOR + 1000, 0, 600_000).t).toEqual([]);
  });
});

describe('pearson', () => {
  it('is 1 for a series against itself', () => {
    const v = [1, 2, 3, 4, 5];
    expect(pearson(v, v, 0).r).toBeCloseTo(1, 9);
  });

  it('is −1 for a perfectly inverted series', () => {
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1], 0).r).toBeCloseTo(-1, 9);
  });

  it('skips index pairs where either side is a gap', () => {
    const { r, n } = pearson([1, null, 3, 4], [2, 9, 6, 8], 0);
    expect(n).toBe(3);
    expect(r).toBeCloseTo(1, 9);
  });

  it('returns 0 rather than NaN for a constant series', () => {
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4], 0).r).toBe(0);
  });

  it('honours the offset when pairing samples', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [0, 1, 2, 3, 4]; // b is a shifted by one index
    expect(pearson(a, b, 1).r).toBeCloseTo(1, 9);
    expect(pearson(a, b, 1).n).toBe(4);
  });
});

describe('effectiveSampleSize', () => {
  it('leaves an uncorrelated series untouched', () => {
    expect(effectiveSampleSize(100, 0, 0)).toBe(100);
  });

  it('shrinks a heavily autocorrelated series', () => {
    expect(effectiveSampleSize(100, 0.95, 0.95)).toBeLessThan(10);
  });

  it('never returns more than the raw n, nor fewer than 3', () => {
    expect(effectiveSampleSize(50, 0.5, 0.5)).toBeLessThanOrEqual(50);
    expect(effectiveSampleSize(5, 0.999, 0.999)).toBeGreaterThanOrEqual(3);
  });
});

describe('crossCorrelate', () => {
  it('returns null without enough data on both sides', () => {
    expect(crossCorrelate([], [])).toBeNull();
    expect(crossCorrelate([obs('a', 0, 1)], signal('b', 10, 60, (i) => i))).toBeNull();
  });

  it('returns null when the two signals never overlap in time', () => {
    const a = signal('a', 10, 60, (i) => i, 0);
    const b = signal('b', 10, 60, (i) => i, 100_000);
    expect(crossCorrelate(a, b)).toBeNull();
  });

  it('finds a zero lag for simultaneous signals', () => {
    const a = signal('a', 200, 60, (i) => Math.sin(i / 8));
    const b = signal('b', 200, 60, (i) => 3 * Math.sin(i / 8) + 10);
    const r = crossCorrelate(a, b)!;
    expect(r.bestLagS).toBe(0);
    expect(r.bestR).toBeGreaterThan(0.99);
    expect(r.lead).toBe('simultaneous');
  });

  it('recovers a known delay and names the leading signal', () => {
    // b is a delayed by 300 s: HVAC power now, cabin temperature five minutes later.
    const a = signal('a', 300, 60, (i) => Math.sin(i / 9));
    const b = signal('b', 300, 60, (i) => Math.sin((i - 5) / 9), 0);
    const r = crossCorrelate(a, b, { maxLagS: 1200 })!;
    expect(r.bestLagS).toBe(300);
    expect(r.bestR).toBeGreaterThan(0.99);
    expect(r.lead).toBe('a');
    // The naive overlay chart would badly understate the relationship.
    expect(Math.abs(r.zeroLagR)).toBeLessThan(r.bestR);
  });

  it('reports a negative lag when the second signal leads', () => {
    const a = signal('a', 300, 60, (i) => Math.sin((i - 5) / 9));
    const b = signal('b', 300, 60, (i) => Math.sin(i / 9));
    const r = crossCorrelate(a, b, { maxLagS: 1200 })!;
    expect(r.bestLagS).toBe(-300);
    expect(r.lead).toBe('b');
  });

  it('detects an inverse relationship', () => {
    const a = signal('a', 200, 60, (i) => Math.sin(i / 8));
    const b = signal('b', 200, 60, (i) => -2 * Math.sin(i / 8));
    const r = crossCorrelate(a, b)!;
    expect(r.bestR).toBeLessThan(-0.99);
    expect(r.bestLagS).toBe(0);
  });

  it('refuses to call two slow drifting signals significant', () => {
    // Both ramp linearly: naive r ≈ 1 on ~200 samples, but the effective
    // sample size after the autocorrelation penalty is tiny.
    const a = signal('a', 200, 60, (i) => i);
    const b = signal('b', 200, 60, (i) => 2 * i + 5);
    const r = crossCorrelate(a, b)!;
    expect(r.bestR).toBeGreaterThan(0.99);
    expect(r.effectiveN).toBeLessThan(r.bestN);
    expect(r.significanceThreshold).toBeGreaterThan(0.1);
  });

  it('kills a spurious correlation from a signal that stopped reporting', () => {
    // b reports for ten minutes, goes silent for three hours, then sends one
    // final sample. Without a staleness limit the dead stretch would be held
    // flat and correlated against a live signal.
    const a = signal('a', 200, 60, (i) => Math.sin(i / 8));
    const b = [...signal('b', 10, 60, (i) => Math.sin(i / 8)), obs('b', 199 * 60, 0)];
    const r = crossCorrelate(a, b, { maxStaleS: 120, minOverlap: 3 })!;
    expect(r.seriesB.gaps).toBeGreaterThan(150);
    expect(r.bestN).toBeLessThan(30);
  });

  it('detrending removes shared drift but keeps co-movement', () => {
    const wiggle = (i: number) => Math.sin(i / 4);
    const a = signal('a', 200, 60, (i) => i * 0.5 + wiggle(i));
    const b = signal('b', 200, 60, (i) => i * 0.5 - wiggle(i));
    const levels = crossCorrelate(a, b, { detrend: false })!;
    const diffs = crossCorrelate(a, b, { detrend: true })!;
    // On levels the shared ramp dominates and hides the opposition.
    expect(levels.zeroLagR).toBeGreaterThan(0.9);
    // On first differences the true anti-correlation appears.
    expect(diffs.zeroLagR).toBeLessThan(-0.9);
  });

  it('produces a symmetric, ascending correlogram', () => {
    const a = signal('a', 200, 60, (i) => Math.sin(i / 8));
    const b = signal('b', 200, 60, (i) => Math.cos(i / 8));
    const r = crossCorrelate(a, b, { maxLagS: 600 })!;
    const lags = r.correlogram.map((p) => p.lagS);
    expect(lags[0]).toBe(-600);
    expect(lags[lags.length - 1]).toBe(600);
    expect([...lags].sort((x, y) => x - y)).toEqual(lags);
  });

  it('reads the camelCase history shape as well as the snake_case log shape', () => {
    // /signals/{id}/{name}/history returns { timestamp, valueNum }.
    const camel = Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date(ANCHOR + i * 60_000).toISOString(),
      valueNum: Math.sin(i / 6),
    }));
    const snake = signal('b', 60, 60, (i) => Math.sin(i / 6));
    const r = crossCorrelate(camel, snake)!;
    expect(r.bestLagS).toBe(0);
    expect(r.bestR).toBeGreaterThan(0.99);
  });

  it('prefers the shortest lag when a periodic signal ties', () => {
    // A 40-minute square wave correlates at −1 half a cycle away just as
    // strongly as +1 at zero lag. The shorter explanation must win.
    const square = (i: number) => (i % 40 < 20 ? 1 : 0);
    const a = signal('a', 240, 60, square);
    const b = signal('b', 240, 60, square);
    const r = crossCorrelate(a, b, { maxLagS: 1800 })!;
    expect(r.bestLagS).toBe(0);
    expect(r.bestR).toBeGreaterThan(0.99);
  });

  it('correlates a boolean signal against a numeric one', () => {
    // One clean ON block rather than a repeating cycle, so a single lag wins.
    const on = (i: number) => (i >= 50 && i < 90 ? 1 : 0);
    const hvac = signal('hvac_on', 200, 60, on).map((o) => ({
      ...o,
      value_numeric: null,
      value_bool: o.value_numeric === 1,
    }));
    const temp = signal('cabin', 200, 60, (i) => (on(i) === 1 ? 24 : 18));
    const r = crossCorrelate(hvac, temp)!;
    expect(r.bestR).toBeGreaterThan(0.9);
    expect(r.bestLagS).toBe(0);
  });
});
