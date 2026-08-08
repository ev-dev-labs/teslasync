/**
 * Signal Cross-Correlation — what leads, what follows, and by how long.
 *
 * A vehicle emits dozens of telemetry channels and almost all of the
 * interesting relationships between them are *delayed*. Cabin temperature
 * responds to HVAC power a few minutes later. Pack temperature responds to
 * charge current later still. Plotting two signals on the same axes shows the
 * relationship exists; it does not show which one moves first, which is the
 * only part that tells you about causality.
 *
 * This module computes a **lagged cross-correlogram**: Pearson's r between one
 * signal and a time-shifted copy of another, swept across a range of lags. The
 * lag that maximises |r| is the system's response time, and its sign says which
 * signal leads.
 *
 * Three things make this honest rather than decorative:
 *
 *  1. **Resampling before correlating.** The two signals arrive at unrelated,
 *     irregular timestamps, so they are first placed on a shared uniform grid
 *     by last-observation-carried-forward with a staleness limit. Without the
 *     limit, a signal that stopped reporting for six hours would be held flat
 *     and manufacture a correlation out of nothing.
 *  2. **Detrending.** Two signals that both drift over a day correlate at ~0.9
 *     no matter what they are. First differences are offered so the user can
 *     ask about co-movement rather than shared drift.
 *  3. **Effective sample size.** Resampled series are heavily autocorrelated,
 *     so the naive n wildly overstates significance. The reported significance
 *     uses an autocorrelation-adjusted n, which is why a correlogram peak here
 *     is far harder to reach than in a naive implementation.
 *
 * Pure and React-free.
 */

import type { SignalObservation } from '@/types/signals';

/**
 * The two signal shapes this app actually serves.
 *
 * `signal_log` rows arrive as `SignalObservation` (snake_case, `ts`), while
 * `/signals/{id}/{name}/history` returns `SignalPoint` (camelCase,
 * `timestamp`). Rather than force every caller through an adapter — and risk
 * one of them silently mapping the wrong key and correlating an empty series —
 * the module reads whichever pair is present.
 */
export interface CorrelatableSample {
  ts?: string;
  timestamp?: string;
  value_numeric?: number | null;
  valueNum?: number | null;
  value_bool?: boolean | null;
  valueBool?: boolean | null;
}

/** Structural check that `SignalObservation` remains assignable to the input. */
export type SignalObservationIsCorrelatable = SignalObservation extends CorrelatableSample
  ? true
  : never;

export interface ResampledSeries {
  /** Grid timestamps, ms. */
  t: number[];
  /** Values on the grid; `null` where the source was too stale to hold. */
  v: Array<number | null>;
  /** Grid step, ms. */
  stepMs: number;
  /** Samples actually filled, vs. gaps. */
  filled: number;
  gaps: number;
}

export interface LagPoint {
  /** Positive = signal B lags behind signal A. */
  lagS: number;
  r: number;
  /** Overlapping samples used at this lag. */
  n: number;
}

export interface CorrelationResult {
  /** Full correlogram, ascending by lag. */
  correlogram: LagPoint[];
  /** Correlation at zero lag — what a naive overlay chart shows. */
  zeroLagR: number;
  /** The lag with the largest |r|. */
  bestLagS: number;
  bestR: number;
  /** Samples contributing at the best lag. */
  bestN: number;
  /** Autocorrelation-adjusted sample size at the best lag. */
  effectiveN: number;
  /** |r| needed to clear 95 % significance at `effectiveN`. */
  significanceThreshold: number;
  significant: boolean;
  /** Which signal moves first. */
  lead: 'a' | 'b' | 'simultaneous' | 'none';
  seriesA: ResampledSeries;
  seriesB: ResampledSeries;
  overlapStartMs: number | null;
  overlapEndMs: number | null;
}

export interface CorrelationOptions {
  /** Resampling grid step, seconds. */
  stepS?: number;
  /** Largest lag swept, seconds. */
  maxLagS?: number;
  /** Beyond this age a sample is a gap, not a held value. Seconds. */
  maxStaleS?: number;
  /** Correlate first differences instead of levels. */
  detrend?: boolean;
  /** Minimum overlapping samples before a lag is reported at all. */
  minOverlap?: number;
}

const DEFAULTS = {
  stepS: 60,
  maxLagS: 1800,
  maxStaleS: 600,
  detrend: false,
  minOverlap: 10,
} as const;

/** Numeric observations only, ascending, de-duplicated by timestamp. */
export function toNumericSeries(
  observations: readonly CorrelatableSample[],
): Array<{ ms: number; value: number }> {
  const points: Array<{ ms: number; value: number }> = [];
  for (const o of observations) {
    const iso = o.ts ?? o.timestamp;
    if (iso == null) continue;
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) continue;

    const numeric = o.value_numeric ?? o.valueNum;
    const bool = o.value_bool ?? o.valueBool;
    let value: number | null = null;
    if (typeof numeric === 'number' && Number.isFinite(numeric)) {
      value = numeric;
    } else if (typeof bool === 'boolean') {
      // Booleans are genuinely correlatable (HVAC on/off vs. cabin temp), so
      // they are promoted rather than discarded.
      value = bool ? 1 : 0;
    }
    if (value == null) continue;
    points.push({ ms, value });
  }
  points.sort((a, b) => a.ms - b.ms);

  const deduped: Array<{ ms: number; value: number }> = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (last != null && last.ms === p.ms) last.value = p.value;
    else deduped.push(p);
  }
  return deduped;
}

/**
 * Place an irregular series on a uniform grid by last-observation-carried-
 * forward, marking anything older than `maxStaleMs` as a gap.
 *
 * Exported because the staleness rule is the difference between a real
 * correlation and one invented from a flat-held dead signal.
 */
export function resample(
  points: ReadonlyArray<{ ms: number; value: number }>,
  startMs: number,
  endMs: number,
  stepMs: number,
  maxStaleMs: number,
): ResampledSeries {
  const t: number[] = [];
  const v: Array<number | null> = [];
  let filled = 0;
  let gaps = 0;

  if (stepMs <= 0 || endMs < startMs) {
    return { t, v, stepMs, filled, gaps };
  }

  let cursor = 0;
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    while (cursor + 1 < points.length && points[cursor + 1]!.ms <= ms) cursor += 1;
    const candidate = points[cursor];
    const usable =
      candidate != null && candidate.ms <= ms && ms - candidate.ms <= maxStaleMs;
    t.push(ms);
    if (usable) {
      v.push(candidate.value);
      filled += 1;
    } else {
      v.push(null);
      gaps += 1;
    }
  }
  return { t, v, stepMs, filled, gaps };
}

/** Pearson's r over index pairs where both series have a value. */
export function pearson(
  a: ReadonlyArray<number | null>,
  b: ReadonlyArray<number | null>,
  offset: number,
): { r: number; n: number } {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    const j = i + offset;
    if (j < 0 || j >= b.length) continue;
    const x = a[i];
    const y = b[j];
    if (x == null || y == null) continue;
    n += 1;
    sa += x;
    sb += y;
  }
  if (n < 2) return { r: 0, n };

  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const j = i + offset;
    if (j < 0 || j >= b.length) continue;
    const x = a[i];
    const y = b[j];
    if (x == null || y == null) continue;
    const dx = x - ma;
    const dy = y - mb;
    num += dx * dy;
    da += dx * dx;
    db += dy * dy;
  }
  const denom = Math.sqrt(da * db);
  // A constant series has zero variance: correlation is undefined, and
  // reporting 0 is the only defensible answer.
  if (denom === 0) return { r: 0, n };
  return { r: num / denom, n };
}

/** Lag-1 autocorrelation, used to discount an over-sampled series. */
function lag1Autocorrelation(series: ReadonlyArray<number | null>): number {
  const { r } = pearson(series, series, 1);
  return Math.max(-0.99, Math.min(0.99, r));
}

/**
 * Bartlett's adjustment for autocorrelated series.
 *
 * Resampling a 10-minute signal onto a 60-second grid multiplies the apparent
 * sample size tenfold without adding a single new observation; without this
 * correction every correlogram peak would look overwhelmingly significant.
 */
export function effectiveSampleSize(n: number, rhoA: number, rhoB: number): number {
  const product = rhoA * rhoB;
  if (product <= 0) return n;
  const adjusted = (n * (1 - product)) / (1 + product);
  return Math.max(3, Math.min(n, adjusted));
}

function firstDifference(v: ReadonlyArray<number | null>): Array<number | null> {
  const out: Array<number | null> = [null];
  for (let i = 1; i < v.length; i++) {
    const a = v[i];
    const b = v[i - 1];
    out.push(a == null || b == null ? null : a - b);
  }
  return out;
}

export function crossCorrelate(
  a: readonly CorrelatableSample[],
  b: readonly CorrelatableSample[],
  options: CorrelationOptions = {},
): CorrelationResult | null {
  const opts = { ...DEFAULTS, ...options };
  const stepMs = opts.stepS * 1000;
  const maxStaleMs = opts.maxStaleS * 1000;

  const pa = toNumericSeries(a);
  const pb = toNumericSeries(b);
  if (pa.length < 2 || pb.length < 2) return null;

  // Only the window where both signals were actually reporting can be used.
  const startMs = Math.max(pa[0]!.ms, pb[0]!.ms);
  const endMs = Math.min(pa[pa.length - 1]!.ms, pb[pb.length - 1]!.ms);
  if (endMs <= startMs) return null;

  const seriesA = resample(pa, startMs, endMs, stepMs, maxStaleMs);
  const seriesB = resample(pb, startMs, endMs, stepMs, maxStaleMs);

  const va = opts.detrend ? firstDifference(seriesA.v) : seriesA.v;
  const vb = opts.detrend ? firstDifference(seriesB.v) : seriesB.v;

  const maxOffset = Math.min(Math.floor(opts.maxLagS / opts.stepS), va.length - 1);
  if (maxOffset < 0) return null;

  const correlogram: LagPoint[] = [];
  for (let offset = -maxOffset; offset <= maxOffset; offset++) {
    const { r, n } = pearson(va, vb, offset);
    if (n < opts.minOverlap) continue;
    correlogram.push({ lagS: offset * opts.stepS, r: Math.round(r * 10000) / 10000, n });
  }
  if (correlogram.length === 0) return null;

  const best = correlogram.reduce((acc, p) => {
    const delta = Math.abs(p.r) - Math.abs(acc.r);
    if (delta > 1e-9) return p;
    // A periodic signal correlates just as strongly with an echo a full cycle
    // away. When two lags tie, the shortest delay is the only defensible
    // reading — otherwise a 40-minute cabin cycle reports a 40-minute
    // "response time" that is really the same event seen twice.
    if (delta > -1e-9 && Math.abs(p.lagS) < Math.abs(acc.lagS)) return p;
    return acc;
  });
  const zero = correlogram.find((p) => p.lagS === 0);

  const rhoA = lag1Autocorrelation(va);
  const rhoB = lag1Autocorrelation(vb);
  const effectiveN = Math.round(effectiveSampleSize(best.n, rhoA, rhoB));

  // 95 % critical |r| for n−2 degrees of freedom, via the t↔r identity with
  // t ≈ 1.96 (adequate once the effective n clears ~30, conservative below).
  const df = Math.max(1, effectiveN - 2);
  const tCrit = 1.96;
  const significanceThreshold = Math.round(
    (tCrit / Math.sqrt(df + tCrit * tCrit)) * 10000,
  ) / 10000;
  const significant = Math.abs(best.r) >= significanceThreshold;

  let lead: CorrelationResult['lead'] = 'none';
  if (significant) {
    if (best.lagS > 0) lead = 'a';
    else if (best.lagS < 0) lead = 'b';
    else lead = 'simultaneous';
  }

  return {
    correlogram,
    zeroLagR: zero?.r ?? 0,
    bestLagS: best.lagS,
    bestR: best.r,
    bestN: best.n,
    effectiveN,
    significanceThreshold,
    significant,
    lead,
    seriesA,
    seriesB,
    overlapStartMs: startMs,
    overlapEndMs: endMs,
  };
}
