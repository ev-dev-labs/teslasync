/**
 * Signal Trend — is this numeric signal drifting slowly and monotonically,
 * and how far can that trend be trusted forward?
 *
 * Deliberately narrow scope: this module answers "is there a slow, steady
 * drift, and what does it project to" — NOT "did something suddenly change"
 * (see `signalChangePoints.ts`) and NOT "are two signals related" (see
 * `signalCorrelation.ts`). A signal that steps sharply between two stable
 * levels has almost no Theil-Sen slope over the whole window (the step
 * cancels out) and is exactly the case the change-point detector exists
 * for instead.
 *
 * Two independent statistical tools are combined, deliberately:
 *
 *   - **Theil-Sen slope** (median of all pairwise slopes) gives a robust
 *     *magnitude* — Pa/°C/whatever-per-hour and per-day — that a handful of
 *     outliers cannot swing the way an ordinary-least-squares fit can.
 *   - **Mann-Kendall** gives *significance* — a nonparametric test of
 *     whether the observed ordering of values is more consistent with a
 *     monotonic trend than with chance, tie-aware because repeated sensor
 *     readings at the same value are common and naively treating every tie
 *     as informationless bias inflates apparent significance.
 *
 * A magnitude without a significance test invites reading noise as a
 * trend; a significance test without a magnitude cannot say how fast. This
 * module refuses to report either without the other.
 *
 * The forecast band is deliberately **evidence-limited**: it is never
 * projected further into the future than the signal has been observed in
 * the past, because a linear extrapolation trusted ten times further than
 * its supporting window is a fabrication, not a forecast. Band width comes
 * from the robust residual spread (MAD scaled to a Gaussian-equivalent
 * sigma) around the fitted line, so a noisy signal gets an honestly wide
 * band instead of a falsely confident thin one.
 *
 * Pure, React-free and clock-free.
 */

/**
 * Minimal structural shape this model needs — mirrors the `SignalPoint`
 * shape `useSignalHistory` resolves to, declared locally so this module
 * stays independently testable.
 */
export interface TrendSample {
  timestamp?: string | null;
  valueNum?: number | null;
}

export interface MannKendallResult {
  s: number;
  varS: number;
  z: number;
  /** Tie-corrected Kendall's tau, -1..1. */
  tau: number;
  /** Two-sided p-value from the normal approximation. */
  pValue: number;
  significant: boolean;
}

export interface ForecastPoint {
  ms: number;
  baseline: number;
  low: number;
  high: number;
}

export interface SignalTrendSummary {
  samples: number;
  spanHours: number | null;
  slopePerHour: number | null;
  slopePerDay: number | null;
  /** Theil-Sen baseline value at the first observed timestamp. */
  interceptAtStart: number | null;
  mannKendall: MannKendallResult | null;
  /** Robust residual spread around the fitted line (MAD × 1.4826). */
  residualSpread: number | null;
  forecast: ForecastPoint[];
  /**
   * True when the sample count or time span falls below the evidence bar —
   * the slope is still reported, but significance/forecast are withheld.
   */
  evidenceLimited: boolean;
}

export interface SignalTrendOptions {
  /** Two-sided significance level. Default 0.05. */
  alpha?: number;
  /** Minimum samples before significance/forecast are trusted. Default 8. */
  minSamples?: number;
  /** Minimum time span, hours, before significance/forecast are trusted. Default 6. */
  minSpanHours?: number;
  /** Requested forecast horizon, hours. Capped to the observed span (evidence limit). Default 24. */
  forecastHorizonHours?: number;
  /** Forecast sampling step, hours. Default 2. */
  forecastStepHours?: number;
  /** Band half-width in residual-spread units (≈95% under normality). Default 1.96. */
  bandZ?: number;
  /** Cap on pairwise-slope comparisons, for O(n²) safety on long histories. */
  maxPairwiseSamples?: number;
}

const DEFAULTS = {
  alpha: 0.05,
  minSamples: 8,
  minSpanHours: 6,
  forecastHorizonHours: 24,
  forecastStepHours: 2,
  bandZ: 1.96,
  maxPairwiseSamples: 300,
} as const;

const MS_PER_HOUR = 3_600_000;

interface NumericPoint {
  ms: number;
  value: number;
}

/** Numeric samples only, ascending, de-duplicated by timestamp. */
export function toNumericPoints(samples: readonly TrendSample[]): NumericPoint[] {
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

/** Theil-Sen slope (per unit of `xs`) and intercept (value at xs=0). */
export function theilSen(
  xs: readonly number[],
  ys: readonly number[],
  maxPairwiseSamples: number,
): { slope: number; intercept: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? ys[0]! : 0 };

  let idx: number[];
  if (n <= maxPairwiseSamples) {
    idx = Array.from({ length: n }, (_, i) => i);
  } else {
    idx = Array.from({ length: maxPairwiseSamples }, (_, i) =>
      Math.min(n - 1, Math.round((i * (n - 1)) / (maxPairwiseSamples - 1))),
    );
  }

  const slopes: number[] = [];
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const i = idx[a]!;
      const j = idx[b]!;
      const dx = xs[j]! - xs[i]!;
      if (dx === 0) continue;
      slopes.push((ys[j]! - ys[i]!) / dx);
    }
  }
  const slope = slopes.length > 0 ? median(slopes) : 0;
  const intercepts = xs.map((x, i) => ys[i]! - slope * x);
  const intercept = median(intercepts);
  return { slope, intercept };
}

/** Standard normal CDF via the Abramowitz–Stegun erf approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}

/**
 * Tie-aware Mann-Kendall trend test. `xs` must be strictly increasing
 * (guaranteed by the caller's de-duplicated series), so only `ys` can carry
 * ties.
 */
export function mannKendall(ys: readonly number[], alpha: number): MannKendallResult {
  const n = ys.length;
  if (n < 2) {
    return { s: 0, varS: 0, z: 0, tau: 0, pValue: 1, significant: false };
  }

  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(ys[j]! - ys[i]!);
    }
  }

  const tieGroups = new Map<number, number>();
  for (const y of ys) tieGroups.set(y, (tieGroups.get(y) ?? 0) + 1);
  let tieCorrection = 0;
  let tieSumForTau = 0;
  for (const t of tieGroups.values()) {
    if (t > 1) {
      tieCorrection += t * (t - 1) * (2 * t + 5);
      tieSumForTau += t * (t - 1);
    }
  }

  const varS = (n * (n - 1) * (2 * n + 5) - tieCorrection) / 18;
  let z = 0;
  if (varS > 0) {
    if (s > 0) z = (s - 1) / Math.sqrt(varS);
    else if (s < 0) z = (s + 1) / Math.sqrt(varS);
  }

  const n0 = (n * (n - 1)) / 2;
  const denom = Math.sqrt(n0 * (n0 - tieSumForTau / 2));
  const tau = denom > 0 ? s / denom : 0;

  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const significant = pValue < alpha && s !== 0;

  return {
    s,
    varS: Math.round(varS * 100) / 100,
    z: Math.round(z * 1000) / 1000,
    tau: Math.round(tau * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    significant,
  };
}

/** Median absolute deviation scaled to a Gaussian-equivalent sigma. */
function robustSpread(residuals: readonly number[]): number {
  if (residuals.length === 0) return 0;
  const m = median(residuals);
  const absDev = residuals.map((r) => Math.abs(r - m));
  return median(absDev) * 1.4826;
}

export function summarizeSignalTrend(
  samples: readonly TrendSample[],
  options: SignalTrendOptions = {},
): SignalTrendSummary {
  const opts = { ...DEFAULTS, ...options };
  const points = toNumericPoints(samples);
  const n = points.length;

  if (n === 0) {
    return {
      samples: 0,
      spanHours: null,
      slopePerHour: null,
      slopePerDay: null,
      interceptAtStart: null,
      mannKendall: null,
      residualSpread: null,
      forecast: [],
      evidenceLimited: true,
    };
  }

  const baseMs = points[0]!.ms;
  const xsHours = points.map((p) => (p.ms - baseMs) / MS_PER_HOUR);
  const ys = points.map((p) => p.value);
  const spanHours = n >= 2 ? xsHours[n - 1]! : 0;

  const { slope, intercept } =
    n >= 2 ? theilSen(xsHours, ys, opts.maxPairwiseSamples) : { slope: 0, intercept: ys[0]! };

  const mk = n >= 2 ? mannKendall(ys, opts.alpha) : null;

  const residuals = points.map((p, i) => p.value - (intercept + slope * xsHours[i]!));
  const spread = robustSpread(residuals);

  const evidenceLimited = n < opts.minSamples || spanHours < opts.minSpanHours;

  const forecast: ForecastPoint[] = [];
  if (!evidenceLimited && mk?.significant) {
    // Evidence limit: never extrapolate further than the observed span.
    const horizonHours = Math.min(opts.forecastHorizonHours, spanHours);
    const step = Math.max(opts.forecastStepHours, spanHours > 0 ? spanHours / 100 : 1);
    for (let h = 0; h <= horizonHours + 1e-9; h += step) {
      const x = spanHours + h;
      const baseline = intercept + slope * x;
      const band = opts.bandZ * spread;
      forecast.push({
        ms: baseMs + x * MS_PER_HOUR,
        baseline: Math.round(baseline * 1000) / 1000,
        low: Math.round((baseline - band) * 1000) / 1000,
        high: Math.round((baseline + band) * 1000) / 1000,
      });
    }
  }

  return {
    samples: n,
    spanHours: Math.round(spanHours * 100) / 100,
    slopePerHour: Math.round(slope * 10000) / 10000,
    slopePerDay: Math.round(slope * 24 * 10000) / 10000,
    interceptAtStart: Math.round(intercept * 1000) / 1000,
    mannKendall: mk,
    residualSpread: Math.round(spread * 1000) / 1000,
    forecast,
    evidenceLimited,
  };
}
