/**
 * Firmware Impact — did that over-the-air update actually change anything?
 *
 * Tesla ships firmware every few weeks and owners endlessly speculate about
 * range regressions. This module turns the speculation into a hypothesis test:
 * for every installed version it takes the drives in a window *before* the
 * install and the drives in the matching window *after*, and asks whether the
 * two consumption samples plausibly came from the same distribution.
 *
 * The test is **Welch's t-test** rather than Student's, because the two
 * samples have neither equal variance nor equal size — a driver may take four
 * long trips one month and thirty commutes the next. Welch–Satterthwaite
 * degrees of freedom and a regularised incomplete beta give a real two-sided
 * p-value, and Cohen's d reports the effect size, because with enough drives
 * a statistically significant 1 Wh/km is still meaningless.
 *
 * Windows are clipped at neighbouring installs so two updates a week apart
 * never claim credit for the same drives.
 *
 * Pure and React-free.
 */

import type { Drive } from '@/types/driving';

/** Minimal software-update shape: only version + install time are needed. */
export interface FirmwareInstall {
  version: string;
  installedAt: string | null;
  status?: string;
}

export interface SampleStats {
  n: number;
  /** Mean consumption, Wh/km. */
  meanWhPerKm: number;
  /** Sample standard deviation, Wh/km. */
  sdWhPerKm: number;
  totalDistanceM: number;
}

export type ImpactVerdict = 'better' | 'worse' | 'noChange' | 'insufficient';

export interface FirmwareImpact {
  version: string;
  installedAt: string;
  installedMs: number;
  before: SampleStats;
  after: SampleStats;
  /** after − before, Wh/km. Negative = the car got more efficient. */
  deltaWhPerKm: number;
  /** {@link deltaWhPerKm} as a share of the before-mean. */
  deltaShare: number;
  /** Welch t statistic; `null` when a sample is too small. */
  t: number | null;
  /** Welch–Satterthwaite degrees of freedom. */
  df: number | null;
  /** Two-sided p-value. */
  p: number | null;
  /** Cohen's d using the pooled SD. */
  cohensD: number | null;
  verdict: ImpactVerdict;
}

export interface FirmwareImpactSummary {
  impacts: FirmwareImpact[];
  /** Installs skipped for want of drives on one side. */
  skipped: number;
  /** Installs whose p-value cleared `alpha`. */
  significantCount: number;
  analyzedDrives: number;
}

export interface FirmwareImpactOptions {
  /** Days of drives sampled on each side of an install. */
  windowDays?: number;
  /** Minimum drives required on each side. */
  minSample?: number;
  /** Significance level for the verdict. */
  alpha?: number;
  /** Minimum |Cohen's d| for a verdict to be called at all. */
  minEffect?: number;
}

const DEFAULTS = {
  windowDays: 30,
  minSample: 5,
  alpha: 0.05,
  minEffect: 0.2,
} as const;

const MS_PER_DAY = 86_400_000;

/* ── Statistics ──────────────────────────────────────────────────────── */

/**
 * Continued-fraction expansion of the incomplete beta function (Lentz's
 * method). Underpins the t-distribution CDF — implemented here because the
 * app carries no statistics dependency and a normal approximation would
 * overstate significance badly at the small sample sizes this page sees.
 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAX_ITER = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Lanczos approximation of ln Γ(x). */
function lnGamma(x: number): number {
  const g = [
    76.18009172947146, -86.50532032941678, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j]! / ++y;
  return -tmp + Math.log((2.5066282746310007 * ser) / x);
}

/**
 * Regularised incomplete beta I_x(a, b).
 *
 * Exported so the numerics can be pinned against textbook values — a silent
 * error here would quietly turn noise into "significant" findings.
 */
export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Two-sided p-value of a t statistic with `df` degrees of freedom. */
export function twoSidedTP(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return 1;
  return regularizedIncompleteBeta(df / 2, 0.5, df / (df + t * t));
}

export interface WelchResult {
  t: number;
  df: number;
  p: number;
}

/**
 * Welch's unequal-variance t-test.
 *
 * Exported for direct testing: identical samples must return p ≈ 1, and a
 * clean mean separation must return a small p.
 */
export function welchTTest(
  a: { n: number; mean: number; sd: number },
  b: { n: number; mean: number; sd: number },
): WelchResult | null {
  if (a.n < 2 || b.n < 2) return null;
  const va = (a.sd * a.sd) / a.n;
  const vb = (b.sd * b.sd) / b.n;
  const denom = va + vb;
  if (denom <= 0) return null;

  const t = (b.mean - a.mean) / Math.sqrt(denom);
  const df =
    (denom * denom) / ((va * va) / (a.n - 1) + (vb * vb) / (b.n - 1));
  return { t, df, p: twoSidedTP(t, df) };
}

/* ── Model ───────────────────────────────────────────────────────────── */

interface DriveSample {
  ms: number;
  whPerKm: number;
  distanceM: number;
}

function toSamples(drives: readonly Drive[]): DriveSample[] {
  const out: DriveSample[] = [];
  for (const d of drives) {
    if (!Number.isFinite(d.distanceM) || d.distanceM < 2000) continue;
    if (d.energyUsedWh == null || !Number.isFinite(d.energyUsedWh) || d.energyUsedWh <= 0) continue;
    const ms = new Date(d.startTs).getTime();
    if (!Number.isFinite(ms)) continue;
    out.push({ ms, whPerKm: d.energyUsedWh / (d.distanceM / 1000), distanceM: d.distanceM });
  }
  return out.sort((x, y) => x.ms - y.ms);
}

function statsOf(samples: readonly DriveSample[]): SampleStats {
  const n = samples.length;
  if (n === 0) return { n: 0, meanWhPerKm: 0, sdWhPerKm: 0, totalDistanceM: 0 };
  let sum = 0;
  let dist = 0;
  for (const s of samples) {
    sum += s.whPerKm;
    dist += s.distanceM;
  }
  const mean = sum / n;
  let varSum = 0;
  for (const s of samples) {
    const d = s.whPerKm - mean;
    varSum += d * d;
  }
  return {
    n,
    meanWhPerKm: Math.round(mean * 10) / 10,
    sdWhPerKm: Math.round(Math.sqrt(n > 1 ? varSum / (n - 1) : 0) * 10) / 10,
    totalDistanceM: Math.round(dist),
  };
}

/**
 * Keep only installed versions with a parseable timestamp, deduplicated by
 * version (Tesla re-reports the same build) and sorted ascending.
 *
 * Exported so the install-timeline hygiene is testable on its own.
 */
export function normalizeInstalls(
  updates: readonly FirmwareInstall[],
): Array<{ version: string; ms: number; installedAt: string }> {
  const seen = new Map<string, { version: string; ms: number; installedAt: string }>();
  for (const u of updates) {
    if (u.status != null && u.status !== 'installed') continue;
    if (u.installedAt == null) continue;
    const ms = new Date(u.installedAt).getTime();
    if (!Number.isFinite(ms)) continue;
    const existing = seen.get(u.version);
    // Keep the earliest install of a given version: that is when the
    // behaviour would have changed.
    if (existing == null || ms < existing.ms) {
      seen.set(u.version, { version: u.version, ms, installedAt: u.installedAt });
    }
  }
  return [...seen.values()].sort((a, b) => a.ms - b.ms);
}

export function analyzeFirmwareImpact(
  updates: readonly FirmwareInstall[],
  drives: readonly Drive[],
  options: FirmwareImpactOptions = {},
): FirmwareImpactSummary {
  const opts = { ...DEFAULTS, ...options };
  const installs = normalizeInstalls(updates);
  const samples = toSamples(drives);

  const impacts: FirmwareImpact[] = [];
  let skipped = 0;

  for (let i = 0; i < installs.length; i++) {
    const install = installs[i]!;
    const nominal = opts.windowDays * MS_PER_DAY;

    // Clip each window at the neighbouring installs so no drive is ever
    // attributed to two different firmware versions.
    const beforeStart = Math.max(install.ms - nominal, installs[i - 1]?.ms ?? -Infinity);
    const afterEnd = Math.min(install.ms + nominal, installs[i + 1]?.ms ?? Infinity);

    const before = samples.filter((s) => s.ms >= beforeStart && s.ms < install.ms);
    const after = samples.filter((s) => s.ms >= install.ms && s.ms < afterEnd);

    const beforeStats = statsOf(before);
    const afterStats = statsOf(after);

    if (beforeStats.n < opts.minSample || afterStats.n < opts.minSample) {
      skipped += 1;
      impacts.push({
        version: install.version,
        installedAt: install.installedAt,
        installedMs: install.ms,
        before: beforeStats,
        after: afterStats,
        deltaWhPerKm: Math.round((afterStats.meanWhPerKm - beforeStats.meanWhPerKm) * 10) / 10,
        deltaShare:
          beforeStats.meanWhPerKm > 0
            ? Math.round(
                ((afterStats.meanWhPerKm - beforeStats.meanWhPerKm) / beforeStats.meanWhPerKm) * 1000,
              ) / 1000
            : 0,
        t: null,
        df: null,
        p: null,
        cohensD: null,
        verdict: 'insufficient',
      });
      continue;
    }

    const welch = welchTTest(
      { n: beforeStats.n, mean: beforeStats.meanWhPerKm, sd: beforeStats.sdWhPerKm },
      { n: afterStats.n, mean: afterStats.meanWhPerKm, sd: afterStats.sdWhPerKm },
    );

    const pooledSd = Math.sqrt(
      ((beforeStats.n - 1) * beforeStats.sdWhPerKm ** 2 +
        (afterStats.n - 1) * afterStats.sdWhPerKm ** 2) /
        Math.max(1, beforeStats.n + afterStats.n - 2),
    );
    const delta = afterStats.meanWhPerKm - beforeStats.meanWhPerKm;
    const cohensD = pooledSd > 0 ? delta / pooledSd : null;

    let verdict: ImpactVerdict = 'noChange';
    if (
      welch != null &&
      welch.p < opts.alpha &&
      cohensD != null &&
      Math.abs(cohensD) >= opts.minEffect
    ) {
      verdict = delta < 0 ? 'better' : 'worse';
    }

    impacts.push({
      version: install.version,
      installedAt: install.installedAt,
      installedMs: install.ms,
      before: beforeStats,
      after: afterStats,
      deltaWhPerKm: Math.round(delta * 10) / 10,
      deltaShare:
        beforeStats.meanWhPerKm > 0
          ? Math.round((delta / beforeStats.meanWhPerKm) * 1000) / 1000
          : 0,
      t: welch == null ? null : Math.round(welch.t * 1000) / 1000,
      df: welch == null ? null : Math.round(welch.df * 10) / 10,
      p: welch == null ? null : Math.round(welch.p * 10000) / 10000,
      cohensD: cohensD == null ? null : Math.round(cohensD * 1000) / 1000,
      verdict,
    });
  }

  impacts.sort((a, b) => b.installedMs - a.installedMs);

  return {
    impacts,
    skipped,
    significantCount: impacts.filter((i) => i.verdict === 'better' || i.verdict === 'worse').length,
    analyzedDrives: samples.length,
  };
}
