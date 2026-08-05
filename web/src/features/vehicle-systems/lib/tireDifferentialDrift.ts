/**
 * Tire Differential Drift — is one corner leaking independently of the
 * other three?
 *
 * A parked car's four TPMS sensors move together far more than they move
 * independently: a cold morning drops all four readings a few kPa, a warm
 * afternoon lifts them back up. A naive "pressure is trending down" alarm
 * on a single corner therefore fires constantly on weather alone and tells
 * the driver nothing about which tire — if any — actually needs attention.
 *
 * This module isolates the *differential* signal instead. At every sample
 * the four-tire median ("common mode") is subtracted from each corner,
 * which cancels ambient-temperature and altitude effects that move all
 * four tires together and leaves only how each corner behaves relative to
 * its peers. A corner with a genuine slow leak drifts away from the group
 * even on a day when the common mode itself is rising; a corner that is
 * merely along for a shared weather swing does not.
 *
 * Two independent read-outs come out of the same residual series:
 *
 *   - **Leak ranking** — a Theil-Sen slope of each corner's residual over
 *     time. Theil-Sen (the median of all pairwise slopes) is used instead
 *     of ordinary least squares because a single re-inflation event — a
 *     step, not a trend — would otherwise dominate an OLS fit. Confidence
 *     is the fraction of those pairwise slopes that agree in sign with the
 *     median, i.e. how unanimous the corner's pairs are about drifting in
 *     one direction; a corner where the pairs disagree wildly is noise,
 *     not a leak, however large its median slope happens to be.
 *   - **Imbalance** — the spread of each corner's *mean* residual. This is
 *     a completely different failure mode from the leak ranking: a corner
 *     permanently offset from the other three (e.g. after a wheel swap
 *     onto a different load-rated tire) has zero slope but a nonzero
 *     constant residual, and would be invisible to the leak ranking alone.
 *
 * A "days to threshold" projection is only reported when the fit clears an
 * evidence bar (minimum samples, minimum time span, minimum pairwise
 * agreement) — see `TireDifferentialDriftOptions`. Below that bar the
 * projection is withheld (`null`) rather than guessed, per this module's
 * "clearly label inference" contract: every number here is an estimate
 * derived from resampled residuals, not a manufacturer specification.
 *
 * Pure, React-free and clock-free.
 */

export type TireCorner = 'fl' | 'fr' | 'rl' | 'rr';

export const TIRE_CORNERS: readonly TireCorner[] = ['fl', 'fr', 'rl', 'rr'];

/**
 * Minimal structural shape this model needs. Declared locally (rather than
 * importing the `TirePressureReading` type from `@/types/vehicle-systems`)
 * because the `/tire-pressure` history endpoint is a `signal.StateReader`
 * timeline that emits a flat `{ ts, front_left, front_right, ... }` map —
 * `camelCaseKeys()` at the `request()` boundary mirrors each key, but does
 * NOT add a `timestamp` field, so a caller trusting the canonical type's
 * required `timestamp: string` would silently read `undefined` for every
 * row. Reading both the snake_case wire keys and their camelCase mirrors
 * defensively is the same pattern `cabinThermal.ts` and `signalCorrelation
 * .ts` already use for the same reason.
 */
export interface TireDifferentialSample {
  ts?: string | null;
  timestamp?: string | null;
  created_at?: string | null;
  front_left?: number | null;
  frontLeft?: number | null;
  front_right?: number | null;
  frontRight?: number | null;
  rear_left?: number | null;
  rearLeft?: number | null;
  rear_right?: number | null;
  rearRight?: number | null;
}

/** One corner's differential-drift read-out. */
export interface CornerDrift {
  corner: TireCorner;
  /** Samples where this corner had a plausible reading. */
  samples: number;
  /** Theil-Sen slope of the common-mode-removed residual, Pa per day. */
  slopePaPerDay: number;
  /** Fraction of pairwise slopes agreeing in sign with the median, 0–1. */
  confidence: number;
  /** Mean residual across the whole window — the corner's constant offset from the group, Pa. */
  meanResidualPa: number;
  /** Most recent residual sample, Pa. */
  lastResidualPa: number;
  /**
   * Projected days until |residual| first reaches the alert threshold,
   * following the fitted trend. `null` when the corner is not currently
   * diverging, or the fit does not clear the evidence bar.
   */
  daysToThreshold: number | null;
}

/** One residual sample, exported for charting the differential timeline. */
export interface ResidualPoint {
  ms: number;
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

export interface TireDifferentialDriftSummary {
  corners: CornerDrift[];
  residuals: ResidualPoint[];
  /** Corner most likely to have an independent slow leak; `null` if none clears the detection bar. */
  leakCorner: TireCorner | null;
  /** 0 when no corner clears the detection bar. */
  leakScore: number;
  /** Spread of per-corner mean residuals — structural (non-drifting) imbalance, Pa. */
  imbalancePa: number;
  /** Corner most offset from the group's common mode. */
  imbalanceCorner: TireCorner | null;
  analyzedSamples: number;
  usableSamples: number;
  spanDays: number | null;
}

export interface TireDifferentialDriftOptions {
  /** Minimum usable samples before a corner's slope is trusted at all. */
  minSamples?: number;
  /** Minimum time span, days, before a slope is trusted. */
  minSpanDays?: number;
  /** Minimum pairwise-slope agreement before a slope counts toward leak ranking / projection. */
  confidenceMin?: number;
  /** |residual| beyond this is a differential alert, Pa. Default 0.3 bar. */
  thresholdPa?: number;
  /** Readings outside this range are treated as missing (sensor glitch / dropout), Pa. */
  minPlausiblePa?: number;
  maxPlausiblePa?: number;
  /** Cap on pairwise-slope comparisons per corner, for O(n²) safety on long histories. */
  maxPairwiseSamples?: number;
}

const DEFAULTS = {
  minSamples: 8,
  minSpanDays: 2,
  confidenceMin: 0.65,
  thresholdPa: 30_000, // 0.3 bar
  minPlausiblePa: 50_000, // 0.5 bar — below this a TPMS reading is not credible
  maxPlausiblePa: 700_000, // 7 bar — above this a TPMS reading is not credible
  maxPairwiseSamples: 200,
} as const;

const MS_PER_DAY = 86_400_000;

interface NormalizedRow {
  ms: number;
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

function readTs(s: TireDifferentialSample): number | null {
  const raw = s.ts ?? s.timestamp ?? s.created_at ?? null;
  if (raw == null) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function readCorner(
  s: TireDifferentialSample,
  snake: keyof TireDifferentialSample,
  camel: keyof TireDifferentialSample,
  min: number,
  max: number,
): number | null {
  const raw = s[snake] ?? s[camel];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < min || raw > max) return null;
  return raw;
}

/**
 * Parse, validate and time-sort the raw samples. Rows missing a plausible
 * reading on any of the four corners are dropped entirely — the common-mode
 * median needs all four to be meaningful. Consecutive identical four-corner
 * tuples are collapsed because the timeline endpoint forward-fills unchanged
 * TPMS values across unrelated signal emissions; treating those rows as
 * independent measurements would bias a robust slope toward zero.
 */
export function normalizeSamples(
  samples: readonly TireDifferentialSample[],
  options: TireDifferentialDriftOptions = {},
): NormalizedRow[] {
  const opts = { ...DEFAULTS, ...options };
  const rows: NormalizedRow[] = [];
  for (const s of samples) {
    const ms = readTs(s);
    if (ms == null) continue;
    const fl = readCorner(s, 'front_left', 'frontLeft', opts.minPlausiblePa, opts.maxPlausiblePa);
    const fr = readCorner(s, 'front_right', 'frontRight', opts.minPlausiblePa, opts.maxPlausiblePa);
    const rl = readCorner(s, 'rear_left', 'rearLeft', opts.minPlausiblePa, opts.maxPlausiblePa);
    const rr = readCorner(s, 'rear_right', 'rearRight', opts.minPlausiblePa, opts.maxPlausiblePa);
    if (fl == null || fr == null || rl == null || rr == null) continue;
    rows.push({ ms, fl, fr, rl, rr });
  }
  rows.sort((a, b) => a.ms - b.ms);

  // De-duplicate identical timestamps (keep the latest row for that instant)
  // so a re-emitted signal at the same ms doesn't create a zero-width pair.
  const deduped: NormalizedRow[] = [];
  for (const r of rows) {
    const last = deduped[deduped.length - 1];
    if (last != null && last.ms === r.ms) deduped[deduped.length - 1] = r;
    else deduped.push(r);
  }
  const changedRows: NormalizedRow[] = [];
  for (const row of deduped) {
    const previous = changedRows[changedRows.length - 1];
    if (
      previous != null &&
      previous.fl === row.fl &&
      previous.fr === row.fr &&
      previous.rl === row.rl &&
      previous.rr === row.rr
    ) {
      continue;
    }
    changedRows.push(row);
  }
  return changedRows;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Theil-Sen slope (Pa per day) plus a pairwise-agreement confidence score.
 *
 * `xsDays` and `ys` must be the same length and `xsDays` strictly
 * increasing (guaranteed by the caller's de-duplicated, sorted rows).
 * Confidence is the fraction of pairwise slopes sharing the sign of the
 * median slope, which is exactly the "how consistent were the pairs"
 * question a single point estimate cannot answer on its own.
 */
export function theilSenWithConfidence(
  xsDays: readonly number[],
  ys: readonly number[],
  maxPairwiseSamples: number,
): { slope: number; confidence: number } {
  const n = xsDays.length;
  if (n < 2) return { slope: 0, confidence: 0 };

  // Evenly-spaced index subsample keeps pairwise comparisons bounded on
  // long histories without biasing toward any particular time window.
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
      const dx = xsDays[j]! - xsDays[i]!;
      if (dx <= 0) continue;
      slopes.push((ys[j]! - ys[i]!) / dx);
    }
  }
  if (slopes.length === 0) return { slope: 0, confidence: 0 };

  const slope = median(slopes);
  const sign = Math.sign(slope);
  let concordant = 0;
  let counted = 0;
  for (const s of slopes) {
    const sSign = Math.sign(s);
    if (sSign === 0) continue;
    counted += 1;
    if (sSign === sign) concordant += 1;
  }
  const confidence = counted === 0 ? (sign === 0 ? 1 : 0) : concordant / counted;
  return { slope, confidence };
}

/**
 * Days until a corner's projected |residual| first reaches `thresholdPa`,
 * following its fitted linear trend — but ONLY when the corner is
 * currently diverging further from the group (matching sign of slope and
 * last residual). A corner drifting back toward the group gets `null`:
 * there is no "time to failure" for a trend that is healing.
 */
export function daysToThreshold(
  lastResidualPa: number,
  slopePaPerDay: number,
  thresholdPa: number,
  maxHorizonDays = 3650,
): number | null {
  if (!Number.isFinite(lastResidualPa) || !Number.isFinite(slopePaPerDay)) return null;
  if (Math.abs(lastResidualPa) >= thresholdPa) return 0;
  if (Math.abs(slopePaPerDay) < 1e-9) return null;

  const direction = lastResidualPa !== 0 ? Math.sign(lastResidualPa) : Math.sign(slopePaPerDay);
  const diverging = Math.sign(slopePaPerDay) === direction;
  if (!diverging) return null;

  const target = direction * thresholdPa;
  const t = (target - lastResidualPa) / slopePaPerDay;
  if (!Number.isFinite(t) || t <= 0 || t > maxHorizonDays) return null;
  return Math.round(t);
}

export function summarizeTireDifferentialDrift(
  samples: readonly TireDifferentialSample[],
  options: TireDifferentialDriftOptions = {},
): TireDifferentialDriftSummary {
  const opts = { ...DEFAULTS, ...options };
  const rows = normalizeSamples(samples, opts);

  const residuals: ResidualPoint[] = rows.map((r) => {
    const m = median([r.fl, r.fr, r.rl, r.rr]);
    return { ms: r.ms, fl: r.fl - m, fr: r.fr - m, rl: r.rl - m, rr: r.rr - m };
  });

  const spanDays =
    rows.length >= 2 ? (rows[rows.length - 1]!.ms - rows[0]!.ms) / MS_PER_DAY : null;
  const baseMs = rows.length > 0 ? rows[0]!.ms : 0;
  const xsDays = rows.map((r) => (r.ms - baseMs) / MS_PER_DAY);

  const corners: CornerDrift[] = TIRE_CORNERS.map((corner) => {
    const ys = residuals.map((r) => r[corner]);
    const n = ys.length;
    const meanResidualPa = n > 0 ? ys.reduce((s, v) => s + v, 0) / n : 0;
    const lastResidualPa = n > 0 ? ys[n - 1]! : 0;
    const { slope, confidence } =
      n >= 2 ? theilSenWithConfidence(xsDays, ys, opts.maxPairwiseSamples) : { slope: 0, confidence: 0 };

    const defensible =
      n >= opts.minSamples && (spanDays ?? 0) >= opts.minSpanDays && confidence >= opts.confidenceMin;

    return {
      corner,
      samples: n,
      slopePaPerDay: Math.round(slope * 100) / 100,
      confidence: Math.round(confidence * 1000) / 1000,
      meanResidualPa: Math.round(meanResidualPa),
      lastResidualPa: Math.round(lastResidualPa),
      daysToThreshold: defensible
        ? daysToThreshold(lastResidualPa, slope, opts.thresholdPa)
        : null,
    };
  });

  // Leak ranking: among corners losing pressure relative to the group
  // (negative slope) with enough pairwise agreement, the strongest,
  // most-agreed-upon negative slope is the likely leak.
  let leakCorner: TireCorner | null = null;
  let leakScore = 0;
  for (const c of corners) {
    if (c.slopePaPerDay >= 0) continue;
    if (c.samples < opts.minSamples) continue;
    if ((spanDays ?? 0) < opts.minSpanDays) continue;
    if (c.confidence < opts.confidenceMin) continue;
    const score = Math.abs(c.slopePaPerDay) * c.confidence;
    if (score > leakScore) {
      leakScore = score;
      leakCorner = c.corner;
    }
  }

  const meanResiduals = corners.map((c) => c.meanResidualPa);
  const imbalancePa =
    meanResiduals.length > 0 ? Math.max(...meanResiduals) - Math.min(...meanResiduals) : 0;
  let imbalanceCorner: TireCorner | null = null;
  if (corners.length > 0) {
    let best = -Infinity;
    for (const c of corners) {
      if (Math.abs(c.meanResidualPa) > best) {
        best = Math.abs(c.meanResidualPa);
        imbalanceCorner = c.corner;
      }
    }
  }

  return {
    corners,
    residuals,
    leakCorner,
    leakScore: Math.round(leakScore * 100) / 100,
    imbalancePa: Math.round(imbalancePa),
    imbalanceCorner,
    analyzedSamples: samples.length,
    usableSamples: rows.length,
    spanDays: spanDays == null ? null : Math.round(spanDays * 10) / 10,
  };
}
