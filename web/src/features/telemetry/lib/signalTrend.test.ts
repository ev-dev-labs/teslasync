import { describe, it, expect } from 'vitest';
import {
  toNumericPoints,
  theilSen,
  mannKendall,
  summarizeSignalTrend,
  type TrendSample,
} from './signalTrend';

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const HOUR = 3_600_000;

function hourlySeries(values: readonly number[]): TrendSample[] {
  return values.map((v, i) => ({
    timestamp: new Date(BASE + i * HOUR).toISOString(),
    valueNum: v,
  }));
}

describe('toNumericPoints', () => {
  it('drops non-numeric and unparsable-timestamp rows, sorts, and de-dupes', () => {
    const points = toNumericPoints([
      { timestamp: new Date(BASE + HOUR).toISOString(), valueNum: 2 },
      { timestamp: new Date(BASE).toISOString(), valueNum: 1 },
      { timestamp: new Date(BASE).toISOString(), valueNum: 9 },
      { timestamp: undefined, valueNum: 5 },
      { timestamp: new Date(BASE + 2 * HOUR).toISOString(), valueNum: undefined },
    ]);
    expect(points.map((p) => p.ms)).toEqual([BASE, BASE + HOUR]);
    expect(points[0]!.value).toBe(9);
  });
});

describe('theilSen', () => {
  it('recovers an exact slope and intercept from perfectly linear data', () => {
    const xs = Array.from({ length: 12 }, (_, i) => i);
    const ys = xs.map((x) => 5 + 2 * x);
    const { slope, intercept } = theilSen(xs, ys, 300);
    expect(slope).toBeCloseTo(2, 6);
    expect(intercept).toBeCloseTo(5, 6);
  });

  it('is robust to a single outlier that would swing an OLS fit', () => {
    const xs = Array.from({ length: 11 }, (_, i) => i);
    const ys = xs.map((x) => 10 - x);
    ys[5] = 1000; // one wild outlier
    const { slope } = theilSen(xs, ys, 300);
    expect(slope).toBeCloseTo(-1, 1);
  });
});

describe('mannKendall', () => {
  it('detects a perfectly monotonic increasing series with full tau', () => {
    const ys = Array.from({ length: 15 }, (_, i) => i);
    const r = mannKendall(ys, 0.05);
    expect(r.s).toBe((15 * 14) / 2);
    expect(r.tau).toBeCloseTo(1, 6);
    expect(r.significant).toBe(true);
  });

  it('detects a perfectly monotonic decreasing series with tau near -1', () => {
    const ys = Array.from({ length: 15 }, (_, i) => -i);
    const r = mannKendall(ys, 0.05);
    expect(r.tau).toBeCloseTo(-1, 6);
    expect(r.significant).toBe(true);
  });

  it('finds no significant trend in a constant series (fully tied)', () => {
    const ys = Array.from({ length: 20 }, () => 7);
    const r = mannKendall(ys, 0.05);
    expect(r.s).toBe(0);
    expect(r.tau).toBe(0);
    expect(r.pValue).toBe(1);
    expect(r.significant).toBe(false);
  });

  it('finds no strong trend in an oscillating (non-monotonic) series', () => {
    const ys = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0 : 1));
    const r = mannKendall(ys, 0.05);
    expect(Math.abs(r.tau)).toBeLessThan(0.3);
    expect(r.significant).toBe(false);
  });

  it('ties reduce the variance relative to an otherwise-equivalent tie-free series', () => {
    const tied = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
    const untied = [1, 1.01, 2, 2.01, 3, 3.01, 4, 4.01, 5, 5.01];
    const rTied = mannKendall(tied, 0.05);
    const rUntied = mannKendall(untied, 0.05);
    expect(rTied.varS).toBeLessThan(rUntied.varS);
  });
});

describe('summarizeSignalTrend', () => {
  it('returns nulls with no samples', () => {
    const s = summarizeSignalTrend([]);
    expect(s.samples).toBe(0);
    expect(s.slopePerHour).toBeNull();
    expect(s.mannKendall).toBeNull();
    expect(s.forecast).toEqual([]);
    expect(s.evidenceLimited).toBe(true);
  });

  it('detects a clean upward drift and forecasts within the evidence limit', () => {
    const values = Array.from({ length: 24 }, (_, i) => 5 + 2 * i);
    const samples = hourlySeries(values);
    const s = summarizeSignalTrend(samples);
    expect(s.slopePerHour).toBeCloseTo(2, 3);
    expect(s.slopePerDay).toBeCloseTo(48, 2);
    expect(s.mannKendall?.significant).toBe(true);
    expect(s.evidenceLimited).toBe(false);
    expect(s.forecast.length).toBeGreaterThan(0);

    // Evidence limit: forecast must never extend further into the future
    // than the signal has been observed (span ≈ 23h here).
    const spanMs = s.spanHours! * HOUR;
    for (const f of s.forecast) {
      expect(f.ms - BASE).toBeLessThanOrEqual(2 * spanMs + 1);
      // Perfectly noiseless data collapses the band to zero width, so the
      // only guarantee is that high never falls below low.
      expect(f.high).toBeGreaterThanOrEqual(f.low);
    }
  });

  it('withholds significance and forecast for a flat signal', () => {
    const samples = hourlySeries(Array.from({ length: 24 }, () => 100));
    const s = summarizeSignalTrend(samples);
    expect(s.slopePerHour).toBeCloseTo(0, 6);
    expect(s.mannKendall?.significant).toBe(false);
    expect(s.forecast).toEqual([]);
  });

  it('flags evidenceLimited below the minimum sample/span bar', () => {
    const samples = hourlySeries([1, 3, 5]); // 3 samples, 2h span
    const s = summarizeSignalTrend(samples);
    expect(s.evidenceLimited).toBe(true);
    expect(s.forecast).toEqual([]);
    // The slope itself is still reported even though it is not "defensible".
    expect(s.slopePerHour).not.toBeNull();
  });

  it('caps the forecast horizon to the observed span, not the requested horizon', () => {
    const values = Array.from({ length: 10 }, (_, i) => 5 + 3 * i); // 9h span
    const samples = hourlySeries(values);
    const s = summarizeSignalTrend(samples, { forecastHorizonHours: 500 });
    expect(s.spanHours).toBeCloseTo(9, 6);
    const spanMs = s.spanHours! * HOUR;
    const maxForecastMs = Math.max(...s.forecast.map((f) => f.ms));
    expect(maxForecastMs - BASE).toBeLessThanOrEqual(2 * spanMs + 1);
  });
});
