/**
 * Cabin Thermal Model — how fast this specific cabin loses (or gains) heat.
 *
 * A parked car is a first-order thermal system: with the HVAC off the cabin
 * relaxes toward ambient along Newton's law of cooling,
 *
 *     T(t) = T_amb + (T₀ − T_amb) · e^(−t/τ)
 *
 * where τ — the thermal time constant — is a property of *this* car (glazing,
 * insulation, tint, sun load). Taking logs linearises it:
 *
 *     ln|T(t) − T_amb| = ln|T₀ − T_amb| − t/τ
 *
 * so each parked "soak" window yields τ from an ordinary least-squares slope,
 * with R² as a built-in quality gate. Windows where the HVAC is on, where the
 * cabin moves *away* from ambient (solar gain), or where the temperature
 * difference is too small to resolve are rejected rather than fitted.
 *
 * The aggregate τ then answers questions no snapshot can: what will the cabin
 * be at 07:00 tomorrow, and how far ahead of departure must preconditioning
 * start? Both fall out of the same exponential, inverted.
 *
 * Pure, React-free and clock-free.
 */

import { resolveHvacActive } from '@/lib/climateState';

/**
 * Minimal structural shape this model needs. Declared locally rather than
 * importing `ClimateState` because the climate history endpoint returns rows
 * keyed by either `timestamp` or `created_at`, and only a small subset of the
 * full climate payload is thermally relevant.
 */
export interface CabinSample {
  timestamp?: string | null;
  created_at?: string | null;
  insideTemp?: number | null;
  outsideTemp?: number | null;
  isAcOn?: boolean | null;
  hvacPower?: boolean | null;
}

/** One clean parked window with a fitted time constant. */
export interface SoakEvent {
  startTs: string;
  endTs: string;
  startMs: number;
  durationMin: number;
  samples: number;
  startInsideC: number;
  endInsideC: number;
  ambientC: number;
  /** Thermal time constant in minutes. */
  tauMin: number;
  /** Coefficient of determination of the log-linear fit, 0–1. */
  r2: number;
  /** True when the cabin was warmer than ambient (cooling down). */
  cooling: boolean;
}

export interface CabinThermalSummary {
  events: SoakEvent[];
  /** Median τ across qualifying events, minutes. `null` without evidence. */
  tauMin: number | null;
  /** Median τ of cooling-down events only. */
  coolingTauMin: number | null;
  /** Median τ of warming-up events only. */
  warmingTauMin: number | null;
  /** Half-life: minutes to close half the gap to ambient. */
  halfLifeMin: number | null;
  /** Mean R² of the accepted fits — how first-order this cabin really is. */
  meanR2: number | null;
  analyzedSamples: number;
  rejectedWindows: number;
}

export interface CabinThermalOptions {
  /** A gap larger than this ends the current window, minutes. */
  maxGapMin?: number;
  /** Windows shorter than this are not fitted, minutes. */
  minDurationMin?: number;
  /** Minimum samples per window. */
  minSamples?: number;
  /** |T_inside − T_ambient| below this is unresolvable noise, °C. */
  minDeltaC?: number;
  /** Fits below this R² are discarded. */
  minR2?: number;
}

const DEFAULTS = {
  maxGapMin: 45,
  minDurationMin: 25,
  minSamples: 4,
  minDeltaC: 3,
  minR2: 0.8,
} as const;

const MS_PER_MIN = 60_000;

interface NormalizedSample {
  ms: number;
  ts: string;
  inside: number;
  outside: number;
  hvacOn: boolean;
}

function normalize(samples: readonly CabinSample[]): NormalizedSample[] {
  const out: NormalizedSample[] = [];
  for (const s of samples) {
    const ts = s.timestamp ?? s.created_at ?? null;
    if (ts == null) continue;
    const ms = new Date(ts).getTime();
    if (!Number.isFinite(ms)) continue;
    const inside = s.insideTemp;
    const outside = s.outsideTemp;
    if (inside == null || outside == null) continue;
    if (!Number.isFinite(inside) || !Number.isFinite(outside)) continue;

    out.push({
      ms,
      ts,
      inside,
      outside,
      hvacOn: resolveHvacActive(s.hvacPower, s.isAcOn) === true,
    });
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

/** OLS of y on x returning slope and R². */
function regress(
  xs: readonly number[],
  ys: readonly number[],
): { slope: number; r2: number } | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return { slope: sxy / sxx, r2: (sxy * sxy) / (sxx * syy) };
}

/** Fit one candidate window; `null` means the window was rejected. */
function fitWindow(
  run: readonly NormalizedSample[],
  opts: Required<CabinThermalOptions>,
): SoakEvent | null {
  if (run.length < opts.minSamples) return null;

  const first = run[0]!;
  const last = run[run.length - 1]!;
  const durationMin = (last.ms - first.ms) / MS_PER_MIN;
  if (durationMin < opts.minDurationMin) return null;

  // Ambient is averaged across the window: the outside probe is noisy and a
  // single endpoint reading would bias τ badly once pushed through the log.
  const ambientC = run.reduce((sum, r) => sum + r.outside, 0) / run.length;
  const startDelta = first.inside - ambientC;
  if (Math.abs(startDelta) < opts.minDeltaC) return null;

  const cooling = startDelta > 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of run) {
    const delta = r.inside - ambientC;
    // The cabin must stay on one side of ambient; a sign flip means the window
    // spans a crossing and the log model no longer applies.
    if (cooling ? delta <= 0.2 : delta >= -0.2) return null;
    xs.push((r.ms - first.ms) / MS_PER_MIN);
    ys.push(Math.log(Math.abs(delta)));
  }

  const fit = regress(xs, ys);
  if (fit == null || fit.r2 < opts.minR2) return null;
  // A non-negative slope means the gap widened — solar gain, or a heater we
  // could not observe. Either way it is not a relaxation event.
  if (fit.slope >= -1e-6) return null;

  return {
    startTs: first.ts,
    endTs: last.ts,
    startMs: first.ms,
    durationMin: Math.round(durationMin),
    samples: run.length,
    startInsideC: Math.round(first.inside * 10) / 10,
    endInsideC: Math.round(last.inside * 10) / 10,
    ambientC: Math.round(ambientC * 10) / 10,
    tauMin: Math.round(-1 / fit.slope),
    r2: Math.round(fit.r2 * 1000) / 1000,
    cooling,
  };
}

/**
 * Split the history into HVAC-off runs and fit τ to each.
 *
 * Exported so the segmentation and fitting can be tested against synthetic
 * exponentials with a known time constant.
 */
export function fitSoakEvents(
  samples: readonly CabinSample[],
  options: CabinThermalOptions = {},
): { events: SoakEvent[]; rejected: number; analyzed: number } {
  const opts: Required<CabinThermalOptions> = { ...DEFAULTS, ...options };
  const rows = normalize(samples);
  const events: SoakEvent[] = [];
  let rejected = 0;
  let window: NormalizedSample[] = [];

  const flush = () => {
    if (window.length === 0) return;
    const run = window;
    window = [];
    const event = fitWindow(run, opts);
    if (event == null) rejected += 1;
    else events.push(event);
  };

  for (const row of rows) {
    if (row.hvacOn) {
      flush();
      continue;
    }
    const prev = window[window.length - 1];
    if (prev && (row.ms - prev.ms) / MS_PER_MIN > opts.maxGapMin) flush();
    window.push(row);
  }
  flush();

  return { events, rejected, analyzed: rows.length };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function medianRounded(values: readonly number[]): number | null {
  const v = median(values);
  return v == null ? null : Math.round(v);
}

export function summarizeCabinThermal(
  samples: readonly CabinSample[],
  options: CabinThermalOptions = {},
): CabinThermalSummary {
  const { events, rejected, analyzed } = fitSoakEvents(samples, options);
  const tauMin = median(events.map((e) => e.tauMin));

  return {
    events,
    tauMin: tauMin == null ? null : Math.round(tauMin),
    coolingTauMin: medianRounded(events.filter((e) => e.cooling).map((e) => e.tauMin)),
    warmingTauMin: medianRounded(events.filter((e) => !e.cooling).map((e) => e.tauMin)),
    halfLifeMin: tauMin == null ? null : Math.round(tauMin * Math.LN2),
    meanR2:
      events.length > 0
        ? Math.round((events.reduce((s, e) => s + e.r2, 0) / events.length) * 1000) / 1000
        : null,
    analyzedSamples: analyzed,
    rejectedWindows: rejected,
  };
}

/** Cabin temperature after `minutes` of soaking, per the fitted model. */
export function predictCabinTemp(
  insideC: number,
  ambientC: number,
  tauMin: number,
  minutes: number,
): number {
  if (!Number.isFinite(tauMin) || tauMin <= 0) return insideC;
  return ambientC + (insideC - ambientC) * Math.exp(-minutes / tauMin);
}

/**
 * Minutes until the cabin first reaches `targetC` while soaking.
 *
 * Returns `null` when the target is unreachable — the exponential approaches
 * ambient asymptotically and never crosses it, so a target on the far side of
 * ambient has no finite answer and must not be faked with a large number.
 */
export function minutesToReach(
  insideC: number,
  ambientC: number,
  tauMin: number,
  targetC: number,
): number | null {
  if (!Number.isFinite(tauMin) || tauMin <= 0) return null;
  const start = insideC - ambientC;
  const target = targetC - ambientC;
  if (start === 0) return 0;
  if (Math.sign(target) !== Math.sign(start) || Math.abs(target) >= Math.abs(start)) return null;
  return Math.round(tauMin * Math.log(Math.abs(start) / Math.abs(target)));
}

/** Soak curve for charting: cabin temperature sampled every `stepMin`. */
export interface SoakCurvePoint {
  minutes: number;
  cabinC: number;
}

export function buildSoakCurve(
  insideC: number,
  ambientC: number,
  tauMin: number,
  horizonMin: number,
  stepMin = 15,
): SoakCurvePoint[] {
  const out: SoakCurvePoint[] = [];
  if (!Number.isFinite(tauMin) || tauMin <= 0 || stepMin <= 0) return out;
  for (let m = 0; m <= horizonMin; m += stepMin) {
    out.push({
      minutes: m,
      cabinC: Math.round(predictCabinTemp(insideC, ambientC, tauMin, m) * 10) / 10,
    });
  }
  return out;
}
