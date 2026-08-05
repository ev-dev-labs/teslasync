/**
 * Departure Forecast — when is the car next likely to be driven?
 *
 * Treats departures as a **non-homogeneous Poisson process** whose intensity
 * depends only on the local weekday and hour. For each of the 168 weekday-hour
 * cells the module counts historical departures and — crucially — counts how
 * many times that cell actually *occurred* inside the observation window. The
 * rate is then a Gamma-posterior mean
 *
 *     λ(d,h) = (departures + α) / (occurrences + β)
 *
 * which degrades gracefully: an hour observed twice with one departure is not
 * declared a 50 % certainty, it is pulled toward the weak prior. The chance of
 * at least one departure inside a cell follows from the Poisson survival
 * function, `p = 1 − e^(−λ)`, and the chance of *any* departure across a
 * horizon is the complement of the product of the per-hour misses.
 *
 * That structure buys three things a punchcard cannot give: a calibrated
 * probability per hour, a cumulative "will I drive before noon?" curve, and a
 * preconditioning trigger placed a fixed lead time ahead of the peak hour.
 *
 * Pure, React-free and clock-free — `nowMs` is always injected.
 */

import type { Drive } from '@/types/driving';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Departure counts and cell occurrences, both indexed `[weekday][hour]`. */
export interface DepartureRates {
  /** Observed departures per weekday-hour. */
  counts: number[][];
  /** How many times each weekday-hour elapsed inside the window. */
  occurrences: number[][];
  /** Posterior Poisson intensity per weekday-hour. */
  lambda: number[][];
  /** Departures folded into the model. */
  totalDepartures: number;
  /** Observation window length in days (bounded by `windowDays`). */
  windowDays: number;
}

export interface ForecastSlot {
  /** Whole hours ahead of `nowMs`; slot 0 is the next full hour boundary. */
  offsetH: number;
  /** Epoch ms at the start of the slot. */
  startMs: number;
  /** Local weekday, 0 = Sunday (matches `Date#getDay`). */
  weekday: number;
  /** Local hour, 0–23. */
  hour: number;
  lambda: number;
  /** P(at least one departure inside this hour). */
  p: number;
  /** P(at least one departure at or before the end of this hour). */
  cumulative: number;
}

export interface DepartureForecast {
  slots: ForecastSlot[];
  /** Highest single-hour probability in the horizon. */
  peak: ForecastSlot | null;
  /** First slot whose probability crosses `likelyThreshold`. */
  nextLikely: ForecastSlot | null;
  /** P(any departure within the whole horizon). */
  pHorizon: number;
  /** Epoch ms to begin preconditioning, `leadMinutes` before {@link peak}. */
  preconditionAtMs: number | null;
  /** 0–1 evidence strength: observed weeks vs `fullConfidenceWeeks`. */
  confidence: number;
  observedWeeks: number;
  totalDepartures: number;
  rates: DepartureRates;
}

export interface DepartureForecastOptions {
  /** Only drives newer than this many days feed the model. */
  windowDays?: number;
  /** Hours to forecast forward. */
  horizonH?: number;
  /** Gamma prior shape — pseudo-departures added to every cell. */
  priorAlpha?: number;
  /** Gamma prior rate — pseudo-occurrences added to every cell. */
  priorBeta?: number;
  /** Probability at which a slot counts as a "likely" departure. */
  likelyThreshold?: number;
  /** Minutes of preconditioning lead time before the peak slot. */
  leadMinutes?: number;
  /** Weeks of history at which confidence saturates at 1. */
  fullConfidenceWeeks?: number;
}

const DEFAULTS = {
  windowDays: 120,
  horizonH: 24,
  // Prior mean α/β = 0.1 departures per occurrence: a weak "most hours are
  // quiet" belief that ~20 real observations comfortably overwhelm.
  priorAlpha: 0.5,
  priorBeta: 5,
  likelyThreshold: 0.4,
  leadMinutes: 20,
  fullConfidenceWeeks: 8,
} as const;

function emptyMatrix(): number[][] {
  return Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
}

/**
 * Build per-weekday-hour departure intensities from drive start times.
 *
 * Exported so the rate model can be tested without the forecast projection.
 */
export function buildDepartureRates(
  drives: readonly Drive[],
  nowMs: number,
  options: DepartureForecastOptions = {},
): DepartureRates {
  const opts = { ...DEFAULTS, ...options };
  const counts = emptyMatrix();
  const occurrences = emptyMatrix();
  const lambda = emptyMatrix();

  const cutoffMs = nowMs - opts.windowDays * MS_PER_DAY;
  let earliestMs = Number.POSITIVE_INFINITY;
  let totalDepartures = 0;

  for (const d of drives) {
    const ms = new Date(d.startTs).getTime();
    if (!Number.isFinite(ms) || ms < cutoffMs || ms > nowMs) continue;
    const dt = new Date(ms);
    counts[dt.getDay()]![dt.getHours()]! += 1;
    totalDepartures += 1;
    if (ms < earliestMs) earliestMs = ms;
  }

  // Occurrences are counted over the *actual* observed window (first drive →
  // now), not the nominal `windowDays`: a fresh install with three days of
  // data must not be told that Tuesday 08:00 happened 17 times.
  if (Number.isFinite(earliestMs)) {
    // Walk hour boundaries so DST shifts and partial weeks are handled by the
    // calendar itself rather than by dividing by 168.
    const start = new Date(earliestMs);
    start.setMinutes(0, 0, 0);
    for (let t = start.getTime(); t <= nowMs; t += MS_PER_HOUR) {
      const dt = new Date(t);
      occurrences[dt.getDay()]![dt.getHours()]! += 1;
    }
  }

  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      lambda[d]![h] =
        (counts[d]![h]! + opts.priorAlpha) / (occurrences[d]![h]! + opts.priorBeta);
    }
  }

  const windowDays = Number.isFinite(earliestMs)
    ? Math.max(0, (nowMs - earliestMs) / MS_PER_DAY)
    : 0;

  return {
    counts,
    occurrences,
    lambda,
    totalDepartures,
    windowDays: Math.round(windowDays * 10) / 10,
  };
}

export function forecastDepartures(
  drives: readonly Drive[],
  nowMs: number,
  options: DepartureForecastOptions = {},
): DepartureForecast {
  const opts = { ...DEFAULTS, ...options };
  const rates = buildDepartureRates(drives, nowMs, options);

  // Start at the next whole hour: the current hour is already partly spent and
  // a "you might leave in the next 60 minutes" claim about it would overstate.
  const firstSlot = new Date(nowMs);
  firstSlot.setMinutes(0, 0, 0);
  const firstSlotMs = firstSlot.getTime() + MS_PER_HOUR;

  const slots: ForecastSlot[] = [];
  let miss = 1;
  for (let i = 0; i < opts.horizonH; i++) {
    const startMs = firstSlotMs + i * MS_PER_HOUR;
    const dt = new Date(startMs);
    const weekday = dt.getDay();
    const hour = dt.getHours();
    const l = rates.lambda[weekday]![hour]!;
    const p = 1 - Math.exp(-l);
    miss *= 1 - p;
    slots.push({
      offsetH: i,
      startMs,
      weekday,
      hour,
      lambda: Math.round(l * 10000) / 10000,
      p: Math.round(p * 1000) / 1000,
      cumulative: Math.round((1 - miss) * 1000) / 1000,
    });
  }

  let peak: ForecastSlot | null = null;
  for (const s of slots) {
    if (peak == null || s.p > peak.p) peak = s;
  }
  const nextLikely = slots.find((s) => s.p >= opts.likelyThreshold) ?? null;

  const observedWeeks = Math.round((rates.windowDays / 7) * 10) / 10;
  const confidence = Math.min(1, observedWeeks / opts.fullConfidenceWeeks);

  return {
    slots,
    peak,
    nextLikely,
    pHorizon: Math.round((1 - miss) * 1000) / 1000,
    preconditionAtMs: peak ? peak.startMs - opts.leadMinutes * 60_000 : null,
    confidence: Math.round(confidence * 100) / 100,
    observedWeeks,
    totalDepartures: rates.totalDepartures,
    rates,
  };
}

/**
 * Collapse the rate matrix to a per-weekday "busiest hour" digest, used by the
 * page's weekly outlook table.
 */
export interface WeekdayPeak {
  weekday: number;
  hour: number;
  p: number;
  departures: number;
}

export function weekdayPeaks(rates: DepartureRates): WeekdayPeak[] {
  const out: WeekdayPeak[] = [];
  for (let d = 0; d < 7; d++) {
    let bestHour = 0;
    let bestLambda = -1;
    for (let h = 0; h < 24; h++) {
      const l = rates.lambda[d]![h]!;
      if (l > bestLambda) {
        bestLambda = l;
        bestHour = h;
      }
    }
    out.push({
      weekday: d,
      hour: bestHour,
      p: Math.round((1 - Math.exp(-bestLambda)) * 1000) / 1000,
      departures: rates.counts[d]![bestHour]!,
    });
  }
  return out;
}
