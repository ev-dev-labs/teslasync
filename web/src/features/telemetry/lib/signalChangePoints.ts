/**
 * Signal Change Points — where did this numeric signal abruptly jump to a
 * new level, as opposed to slowly drifting there?
 *
 * Deliberately narrow scope: this module detects **abrupt regime shifts** —
 * a signal stepping from one stable level to another over a handful of
 * samples. It is intentionally blind to slow monotonic drift (that is
 * `signalTrend.ts`'s job — a gentle ramp produces no Page-Hinkley alarm
 * here because the running mean tracks it) and to the drive-week
 * aggregate regime clustering elsewhere in the app (this operates on one
 * signal's raw sample sequence, not weekly rollups).
 *
 * The detector is a **two-sided, robust Page-Hinkley test**: for each new
 * sample it compares the value against the running mean of the *current*
 * segment, accumulating a one-sided CUSUM of the deviation in each
 * direction. When either cumulative statistic breaches a threshold, a
 * change point is declared, the segment closes, and both accumulators
 * reset so the next regime is judged against its own new mean rather than
 * carrying contamination from the old one.
 *
 * "Robust" here has two concrete meanings:
 *
 * 1. The tolerance (`delta`) and alarm threshold (`lambda`) are calibrated
 *    from a **median-absolute-deviation of first differences**, not the
 *    raw value distribution — see `estimateNoiseScale()` for why this
 *    matters (it keeps a big, genuine level shift from desensitizing the
 *    detector to itself).
 * 2. Each sample's contribution to the cumulative statistics is **clipped**
 *    to at most `lambda`, so a single wild reading can push the statistic
 *    close to the alarm boundary but never past it alone — a lone spike in
 *    an otherwise flat signal does not register as a change point below;
 *    only a sustained run of samples at a new level does.
 *
 * The **minimum segment length is fixed inside this module** (not exposed
 * as a page-level control): a change point is never tested for until the
 * current segment has accumulated at least `MIN_SEGMENT_SAMPLES`
 * observations, so a two-sample blip cannot be reported as a "regime".
 *
 * Pure, React-free and clock-free.
 */

/**
 * Minimal structural shape this model needs — mirrors the `SignalPoint`
 * shape `useSignalHistory` resolves to, declared locally so this module
 * stays independently testable.
 */
export interface ChangePointSample {
  timestamp?: string | null;
  valueNum?: number | null;
}

export interface Segment {
  startMs: number;
  endMs: number;
  startIndex: number;
  endIndex: number;
  samples: number;
  mean: number;
  /** Robust spread (MAD × 1.4826) within the segment. */
  spread: number;
}

export interface ChangePoint {
  ms: number;
  index: number;
  beforeMean: number;
  afterMean: number;
  /** |afterMean − beforeMean|. */
  magnitude: number;
  /** Normalized effect size mapped to 0–1; higher = more unambiguous. */
  confidence: number;
  direction: 'up' | 'down';
}

export interface SignalChangePointsSummary {
  samples: number;
  segments: Segment[];
  changePoints: ChangePoint[];
  /** Global robust scale (MAD × 1.4826) used to derive delta/lambda. */
  globalSpread: number;
  /** The single largest change point, or `null` if none were detected. */
  biggestChange: ChangePoint | null;
  /** Fixed minimum segment length enforced by this module. */
  minSegmentSamples: number;
}

export interface SignalChangePointsOptions {
  /** Tolerance before a deviation counts toward the CUSUM, in units of global spread. Default 0.5. */
  deltaFactor?: number;
  /** Alarm threshold, in units of global spread. Default 5. */
  lambdaFactor?: number;
  /** Effect-size scale used to map magnitude/spread into a 0–1 confidence. Default 3. */
  confidenceEffectSizeScale?: number;
}

// Fixed, not exposed as a page-level control: the smallest run of samples
// this module will ever call a "segment" before testing it for a change.
const MIN_SEGMENT_SAMPLES = 5;

const DEFAULTS = {
  deltaFactor: 0.5,
  lambdaFactor: 5,
  confidenceEffectSizeScale: 3,
} as const;

interface NumericPoint {
  ms: number;
  value: number;
}

/** Numeric samples only, ascending, de-duplicated by timestamp. */
export function toNumericPoints(samples: readonly ChangePointSample[]): NumericPoint[] {
  const points: NumericPoint[] = [];
  for (const s of samples) {
    if (s.timestamp == null) continue;
    const ms = new Date(s.timestamp).getTime();
    if (!Number.isFinite(ms)) continue;
    if (typeof s.valueNum !== 'number' || !Number.isFinite(s.valueNum)) continue;
    points.push({ ms, value: s.valueNum });
  }
  points.sort((a, b) => a.ms - b.ms);
  const deduped: NumericPoint[] = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (last != null && last.ms === p.ms) deduped[deduped.length - 1] = p;
    else deduped.push(p);
  }
  return deduped;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Median absolute deviation scaled to a Gaussian-equivalent sigma. */
export function robustSpread(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  const spread = median(values.map((v) => Math.abs(v - m))) * 1.4826;
  return spread;
}

/**
 * Robust estimate of the *in-regime* sample-to-sample noise scale, derived
 * from first differences rather than the raw value distribution.
 *
 * Using `robustSpread(values)` directly would conflate genuine regime
 * separation with noise: a series that is flat at 10 for a while and then
 * flat at 50 has a huge spread in raw values even though each regime is
 * individually noise-free, which would blunt the detector exactly when a
 * big, obvious shift is present. First differences are small everywhere
 * *except* at the (rare) shift boundary, and the median of those
 * differences shrugs off that one boundary sample (and, symmetrically, a
 * lone spike's two large in/out differences) the same way a median shrugs
 * off any minority contamination — which is what makes this scale estimate
 * usable as a stable calibration for `delta`/`lambda` even on a series that
 * itself contains the shifts being searched for.
 */
export function estimateNoiseScale(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i++) diffs.push(values[i]! - values[i - 1]!);
  // Var(diff) = 2 * Var(x) for independent same-scale noise, so divide the
  // diff-based robust sigma by sqrt(2) to recover the per-sample scale.
  return robustSpread(diffs) / Math.SQRT2;
}

function confidenceFromMagnitude(
  magnitude: number,
  pooledSpread: number,
  effectSizeScale: number,
): number {
  const spread = pooledSpread > 0 ? pooledSpread : 1e-9;
  const effectSize = magnitude / spread;
  return Math.max(0, Math.min(1, effectSize / effectSizeScale));
}

/**
 * Robust two-sided Page-Hinkley change-point detection over a chronological
 * numeric series. `values` and `timestampsMs` must be the same length.
 */
export function detectChangePoints(
  values: readonly number[],
  timestampsMs: readonly number[],
  options: SignalChangePointsOptions = {},
): { segments: Segment[]; changePoints: ChangePoint[]; globalSpread: number } {
  const opts = { ...DEFAULTS, ...options };
  const n = values.length;
  if (n === 0) {
    return { segments: [], changePoints: [], globalSpread: 0 };
  }

  const globalSpread = estimateNoiseScale(values) || 1e-9;
  const delta = opts.deltaFactor * globalSpread;
  const lambda = opts.lambdaFactor * globalSpread;
  // A single sample's contribution to either cumulative statistic is capped
  // at `lambda` itself (never negative once the tolerance is subtracted),
  // so one wild reading can push the statistic close to the alarm boundary
  // but never past it alone — only a *run* of samples at a new level, each
  // adding their own (smaller, but still capped) share, can actually cross
  // it. This is what keeps a transient outlier spike from registering as a
  // change point below.
  const clipSpread = lambda;

  const segments: Segment[] = [];
  const changePoints: ChangePoint[] = [];

  let segStart = 0;
  let runningSum = values[0]!;
  let runningCount = 1;
  let uPos = 0;
  let uNeg = 0;

  const finalizeSegment = (endIndexExclusive: number) => {
    const segValues = values.slice(segStart, endIndexExclusive);
    segments.push({
      startMs: timestampsMs[segStart]!,
      endMs: timestampsMs[endIndexExclusive - 1]!,
      startIndex: segStart,
      endIndex: endIndexExclusive - 1,
      samples: segValues.length,
      mean: segValues.reduce((s, v) => s + v, 0) / segValues.length,
      spread: robustSpread(segValues),
    });
  };

  for (let i = 1; i < n; i++) {
    const mean = runningSum / runningCount;
    const x = values[i]!;
    const clippedX = Math.max(mean - clipSpread, Math.min(mean + clipSpread, x));
    const deviation = clippedX - mean;
    uPos = Math.max(0, uPos + deviation - delta);
    uNeg = Math.max(0, uNeg - deviation - delta);

    // The running baseline itself is updated from the clipped value too, so
    // one extreme sample nudges the segment mean only by a bounded amount
    // instead of dragging it wherever the outlier happens to be.
    runningSum += clippedX;
    runningCount += 1;

    const segmentLength = i - segStart + 1;
    if (segmentLength < MIN_SEGMENT_SAMPLES) continue;

    if (uPos > lambda || uNeg > lambda) {
      // Change declared AT sample i: close the segment through i-1, start a
      // fresh one at i so the new regime is judged against its own mean.
      finalizeSegment(i);
      const before = segments[segments.length - 1]!;

      segStart = i;
      runningSum = x;
      runningCount = 1;
      uPos = 0;
      uNeg = 0;

      // Look ahead within the new segment (bounded by MIN_SEGMENT_SAMPLES
      // or the series end) to estimate the after-mean for reporting; the
      // detector itself does not need this, but the caller does.
      const lookahead = Math.min(n, i + MIN_SEGMENT_SAMPLES);
      const afterSlice = values.slice(i, lookahead);
      const afterMean = afterSlice.reduce((s, v) => s + v, 0) / afterSlice.length;

      const magnitude = Math.abs(afterMean - before.mean);
      const pooledSpread = (before.spread + robustSpread(afterSlice)) / 2 || globalSpread;
      changePoints.push({
        ms: timestampsMs[i]!,
        index: i,
        beforeMean: Math.round(before.mean * 1000) / 1000,
        afterMean: Math.round(afterMean * 1000) / 1000,
        magnitude: Math.round(magnitude * 1000) / 1000,
        confidence: Math.round(confidenceFromMagnitude(magnitude, pooledSpread, opts.confidenceEffectSizeScale) * 1000) / 1000,
        direction: afterMean >= before.mean ? 'up' : 'down',
      });
    }
  }

  finalizeSegment(n);

  return { segments, changePoints, globalSpread: Math.round(globalSpread * 1000) / 1000 };
}

export function summarizeSignalChangePoints(
  samples: readonly ChangePointSample[],
  options: SignalChangePointsOptions = {},
): SignalChangePointsSummary {
  const points = toNumericPoints(samples);
  const values = points.map((p) => p.value);
  const timestampsMs = points.map((p) => p.ms);

  const { segments, changePoints, globalSpread } = detectChangePoints(values, timestampsMs, options);

  let biggestChange: ChangePoint | null = null;
  for (const cp of changePoints) {
    if (biggestChange == null || cp.magnitude > biggestChange.magnitude) biggestChange = cp;
  }

  return {
    samples: points.length,
    segments,
    changePoints,
    globalSpread,
    biggestChange,
    minSegmentSamples: MIN_SEGMENT_SAMPLES,
  };
}
