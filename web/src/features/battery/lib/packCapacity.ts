/**
 * Pack Capacity Estimator — a recursive Bayesian estimate of usable pack size.
 *
 * Every charging session is a noisy measurement of one hidden quantity: how
 * many watt-hours the pack holds between 0 % and 100 %. A session that adds
 * `E` Wh while SoC climbs by `Δs` percent implies
 *
 *     capacity ≈ E ÷ (Δs / 100)
 *
 * Taken individually those implied capacities are wild — a 4 % top-up divides
 * by a tiny, 1 %-quantised denominator and swings by kilowatt-hours. Rather
 * than throwing the small sessions away or averaging everything with equal
 * weight, this module runs a **scalar Kalman filter** over the session series:
 *
 *  - The *measurement* variance is derived from the session itself. SoC
 *    quantisation propagates as `σ_cap = capacity · σ_soc / Δs`, so a 40 %
 *    charge is trusted ~10× more than a 4 % one — automatically, with no
 *    hand-tuned cutoff.
 *  - The *process* variance grows with the calendar gap between sessions,
 *    encoding "a pack can genuinely fade a little between charges". After a
 *    long silence the filter reopens to new evidence instead of clinging to a
 *    stale estimate.
 *
 * The output is therefore not a scatter plot with a trendline through it, but
 * a filtered capacity state with an honest ±1.96σ credible band that narrows
 * as evidence accumulates and widens across data gaps. Fade rate is then the
 * OLS slope of that *filtered* series, which is far more stable than
 * regressing the raw observations.
 *
 * Pure, clock-free (`nowMs` is never read) and React-free.
 */

import type { ChargingSession } from '@/types/charging';

/** One charging session reduced to a capacity measurement. */
export interface CapacityObservation {
  sessionId: string;
  ts: string;
  tsMs: number;
  /** Implied usable pack capacity in Wh. */
  capacityWh: number;
  /** SoC gained during the session, percentage points. */
  socDeltaPct: number;
  energyAddedWh: number;
  /** 1σ measurement uncertainty in Wh (SoC quantisation ⊕ metering error). */
  sigmaWh: number;
}

/** Posterior state after folding in one observation. */
export interface CapacityState {
  ts: string;
  tsMs: number;
  /** Filtered (posterior) capacity estimate, Wh. */
  capacityWh: number;
  /** Posterior 1σ uncertainty, Wh. */
  sigmaWh: number;
  /** The raw measurement that produced this update, Wh. */
  observedWh: number;
  /** Kalman gain 0–1: how much this observation was allowed to move the state. */
  gain: number;
}

export interface RejectionTally {
  /** SoC window below `minSocWindowPct`. */
  narrowWindow: number;
  /** No usable `total_energy_added_wh`. */
  missingEnergy: number;
  /** Start or end SoC missing / non-increasing. */
  missingSoc: number;
  /** Unparseable `started_at`. */
  badTimestamp: number;
}

export interface PackCapacitySummary {
  observations: CapacityObservation[];
  states: CapacityState[];
  /** Latest filtered estimate, Wh. `null` when no session qualified. */
  currentWh: number | null;
  /** Latest posterior 1σ, Wh. */
  currentSigmaWh: number | null;
  /** Highest filtered estimate ever reached — the reference "healthy" pack. */
  peakWh: number | null;
  /** `currentWh ÷ peakWh`, 0–1. `null` without a peak. */
  stateOfHealth: number | null;
  /** OLS slope of the filtered series in Wh lost per year (positive = fading). */
  fadeWhPerYear: number | null;
  /** {@link fadeWhPerYear} as a share of `peakWh` (0.023 → 2.3 %/yr). */
  fadeSharePerYear: number | null;
  /** Calendar span covered by qualifying sessions, in days. */
  spanDays: number;
  rejected: RejectionTally;
}

export interface PackCapacityOptions {
  /**
   * Sessions gaining less than this many SoC points are discarded outright.
   * Kept low (the filter already down-weights them) but non-zero, because
   * below ~5 % the quantisation error dwarfs the signal entirely.
   */
  minSocWindowPct?: number;
  /**
   * 1σ uncertainty of a single SoC reading, in percentage points. Tesla
   * reports integer SoC, and each session uses two readings, so the default
   * covers both endpoints conservatively.
   */
  socSigmaPct?: number;
  /** Relative 1σ error of the session's energy meter (0.015 → 1.5 %). */
  energyRelSigma?: number;
  /**
   * Process noise: 1σ of genuine capacity drift per day, in Wh. Defaults to a
   * pack that could plausibly wander ~30 Wh/day (≈1 % of a 75 kWh pack per
   * month) — loose enough to track real fade, tight enough to reject noise.
   */
  driftWhPerDay?: number;
  /** Implied capacities outside this range are physically implausible. */
  minPlausibleWh?: number;
  maxPlausibleWh?: number;
}

const DEFAULTS = {
  minSocWindowPct: 5,
  socSigmaPct: 1,
  energyRelSigma: 0.015,
  driftWhPerDay: 30,
  minPlausibleWh: 10_000,
  maxPlausibleWh: 200_000,
} as const;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

/**
 * Reduce raw sessions to capacity measurements, ascending by time.
 *
 * Exported so the detector's front half can be unit-tested independently of
 * the filter — a bad observation set and a bad filter fail differently.
 */
export function buildCapacityObservations(
  sessions: readonly ChargingSession[],
  options: PackCapacityOptions = {},
): { observations: CapacityObservation[]; rejected: RejectionTally } {
  const opts = { ...DEFAULTS, ...options };
  const rejected: RejectionTally = {
    narrowWindow: 0,
    missingEnergy: 0,
    missingSoc: 0,
    badTimestamp: 0,
  };
  const observations: CapacityObservation[] = [];

  for (const s of sessions) {
    const startedRaw = s.started_at ?? s.startedAt ?? s.start_ts;
    const tsMs = startedRaw ? new Date(startedRaw).getTime() : NaN;
    if (!Number.isFinite(tsMs)) {
      rejected.badTimestamp += 1;
      continue;
    }

    const energy = finite(s.total_energy_added_wh);
    if (energy == null || energy <= 0) {
      rejected.missingEnergy += 1;
      continue;
    }

    const startSoc = finite(s.start_soc_pct);
    const endSoc = finite(s.end_soc_pct);
    if (startSoc == null || endSoc == null) {
      rejected.missingSoc += 1;
      continue;
    }

    const socDeltaPct = endSoc - startSoc;
    if (socDeltaPct <= 0) {
      rejected.missingSoc += 1;
      continue;
    }
    if (socDeltaPct < opts.minSocWindowPct) {
      rejected.narrowWindow += 1;
      continue;
    }

    const capacityWh = energy / (socDeltaPct / 100);
    if (capacityWh < opts.minPlausibleWh || capacityWh > opts.maxPlausibleWh) {
      rejected.narrowWindow += 1;
      continue;
    }

    // Quantisation error propagates through the division; metering error is
    // multiplicative. Independent sources combine in quadrature.
    const socTerm = (capacityWh * opts.socSigmaPct) / socDeltaPct;
    const meterTerm = capacityWh * opts.energyRelSigma;
    const sigmaWh = Math.sqrt(socTerm * socTerm + meterTerm * meterTerm);

    observations.push({
      sessionId: String(s.id),
      ts: startedRaw,
      tsMs,
      capacityWh: Math.round(capacityWh),
      socDeltaPct: Math.round(socDeltaPct * 10) / 10,
      energyAddedWh: Math.round(energy),
      sigmaWh: Math.round(sigmaWh),
    });
  }

  observations.sort((a, b) => a.tsMs - b.tsMs);
  return { observations, rejected };
}

/**
 * Run the scalar Kalman filter over pre-built observations.
 *
 * Exported separately so the recursion can be exercised with synthetic
 * measurement series (step changes, gaps, outliers) without constructing
 * charging sessions.
 */
export function kalmanFilterCapacity(
  observations: readonly CapacityObservation[],
  options: PackCapacityOptions = {},
): CapacityState[] {
  const opts = { ...DEFAULTS, ...options };
  if (observations.length === 0) return [];

  const first = observations[0]!;
  let x = first.capacityWh;
  // Seed the posterior variance at the first measurement's own variance: the
  // filter starts knowing exactly as much as one session tells it.
  let p = first.sigmaWh * first.sigmaWh;

  const states: CapacityState[] = [
    {
      ts: first.ts,
      tsMs: first.tsMs,
      capacityWh: Math.round(x),
      sigmaWh: Math.round(Math.sqrt(p)),
      observedWh: first.capacityWh,
      gain: 1,
    },
  ];

  for (let i = 1; i < observations.length; i++) {
    const obs = observations[i]!;
    const dtDays = Math.max(0, (obs.tsMs - observations[i - 1]!.tsMs) / MS_PER_DAY);

    // Predict: the state itself is a random walk (no deterministic drift term
    // is assumed — fade direction is an output, not an input).
    const q = (opts.driftWhPerDay * dtDays) ** 2;
    p += q;

    // Update.
    const r = Math.max(1, obs.sigmaWh * obs.sigmaWh);
    const gain = p / (p + r);
    x += gain * (obs.capacityWh - x);
    p *= 1 - gain;

    states.push({
      ts: obs.ts,
      tsMs: obs.tsMs,
      capacityWh: Math.round(x),
      sigmaWh: Math.round(Math.sqrt(p)),
      observedWh: obs.capacityWh,
      gain: Math.round(gain * 1000) / 1000,
    });
  }

  return states;
}

/** OLS slope of `y` against `x`; `null` when x has no spread. */
function olsSlope(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    num += dx * (ys[i]! - my);
    den += dx * dx;
  }
  return den > 0 ? num / den : null;
}

export function summarizePackCapacity(
  sessions: readonly ChargingSession[],
  options: PackCapacityOptions = {},
): PackCapacitySummary {
  const { observations, rejected } = buildCapacityObservations(sessions, options);
  const states = kalmanFilterCapacity(observations, options);

  if (states.length === 0) {
    return {
      observations,
      states,
      currentWh: null,
      currentSigmaWh: null,
      peakWh: null,
      stateOfHealth: null,
      fadeWhPerYear: null,
      fadeSharePerYear: null,
      spanDays: 0,
      rejected,
    };
  }

  const last = states[states.length - 1]!;
  const peakWh = states.reduce((max, s) => Math.max(max, s.capacityWh), 0);
  const spanDays = (last.tsMs - states[0]!.tsMs) / MS_PER_DAY;

  // Regress the filtered series, not the raw observations: the filter has
  // already discounted the low-information sessions that would otherwise
  // dominate a least-squares fit.
  const days = states.map((s) => (s.tsMs - states[0]!.tsMs) / MS_PER_DAY);
  const slopePerDay = spanDays >= 30 ? olsSlope(days, states.map((s) => s.capacityWh)) : null;
  const fadeWhPerYear = slopePerDay == null ? null : Math.round(-slopePerDay * DAYS_PER_YEAR);

  return {
    observations,
    states,
    currentWh: last.capacityWh,
    currentSigmaWh: last.sigmaWh,
    peakWh,
    stateOfHealth: peakWh > 0 ? Math.round((last.capacityWh / peakWh) * 1000) / 1000 : null,
    fadeWhPerYear,
    fadeSharePerYear:
      fadeWhPerYear != null && peakWh > 0
        ? Math.round((fadeWhPerYear / peakWh) * 10000) / 10000
        : null,
    spanDays: Math.round(spanDays * 10) / 10,
    rejected,
  };
}
