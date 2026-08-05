/**
 * Charge Interruption — which sessions probably didn't finish the way they
 * should have?
 *
 * TeslaSync never receives an explicit "this charge was interrupted" event.
 * All it has is the same handful of session-level fields every charge
 * carries: whether an end SoC was ever recorded, how much SoC was gained,
 * how long the session ran, how much energy went in, and the average/peak
 * power. This module turns those fields into a *hedged* estimate of which
 * sessions were likely cut short or under-delivered — never a diagnosis.
 *
 * Every signal here is circumstantial:
 *   - A missing end SoC is consistent with a dropped connection, but could
 *     also just be a backfill gap.
 *   - A SoC-gain rate far below a site's own history is consistent with a
 *     curtailed session, but could be a cold pack or a shared-circuit
 *     brownout.
 *   - A big collapse between peak and average power is consistent with the
 *     charger throttling or disconnecting mid-session, but a normal DC
 *     taper above ~80% SoC produces the same shape.
 *
 * Because none of these are proof, this module NEVER emits a verdict like
 * "hardware failure". It reports a **posterior risk** per site — the
 * probability, given the evidence seen so far, that a session at that site
 * is an interruption — using a Beta-Bernoulli model with a Jeffreys prior
 * (Beta(0.5, 0.5), the standard non-informative prior for a binomial rate).
 * That prior is deliberately weak: a site with one suspicious session out of
 * one gets a wide credible interval, not a confident "100% risk" — sparse
 * evidence yields sparse certainty, by construction.
 *
 * Pure and React-free.
 */

import type { ChargingSession } from '@/types/charging';

export type InterruptionCause =
  | 'no_end_timestamp'
  | 'no_end_soc'
  | 'stalled_soc_gain'
  | 'power_collapse'
  | 'aborted_early';

export interface SessionSignal {
  id: string;
  startedMs: number;
  siteKey: string;
  suspect: boolean;
  causes: InterruptionCause[];
  socGainPct: number | null;
  durationS: number | null;
  energyWh: number;
  avgPowerW: number | null;
  peakPowerW: number | null;
}

export type InterruptionTrend = 'rising' | 'falling' | 'flat' | 'insufficient_data';

export interface SiteInterruptionRisk {
  key: string;
  label: string;
  /** Number of scoreable sessions observed at this site — the Beta "n". */
  evidenceCount: number;
  /** How many of those looked suspect by at least one heuristic. */
  suspectedCount: number;
  /** Beta-posterior mean risk, 0..1. Not a certainty — see `posteriorLow/High`. */
  posteriorMean: number;
  /** 2.5th percentile of the posterior — a conservative "at least this risky" bound. */
  posteriorLow: number;
  /** 97.5th percentile of the posterior — an optimistic upper bound. */
  posteriorHigh: number;
  recentTrend: InterruptionTrend;
  /** Causes seen at this site, most frequent first. */
  topCauses: InterruptionCause[];
  lastSuspectedMs: number | null;
  sessions: SessionSignal[];
}

export interface ChargeInterruptionSummary {
  sites: SiteInterruptionRisk[];
  totalSessions: number;
  evaluableSessions: number;
  suspectedSessions: number;
  /** Posterior mean risk pooled across all evaluable sessions. */
  overallPosteriorMean: number;
  /**
   * The site with the highest *conservative* (2.5th percentile) risk bound,
   * not the highest raw mean — this is what keeps a single unlucky session
   * at a brand-new site from outranking a well-evidenced problem site.
   */
  highestRiskSite: SiteInterruptionRisk | null;
}

export interface ChargeInterruptionOptions {
  /** SoC at/above which a low gain-rate is expected (DC taper), pct. */
  taperSocPct?: number;
  /** Clean sessions required at a site before its baseline rate is trusted. */
  minBaselineSessions?: number;
  /** Minimum duration for the gain-rate check to be meaningful, seconds. */
  minDurationForRateCheckS?: number;
  /** Observed rate below this fraction of the site baseline flags `stalled_soc_gain`. */
  rateShortfallRatio?: number;
  /** avg/peak power ratio below this flags `power_collapse`. */
  powerCollapseRatio?: number;
  /** Minimum duration before a power-collapse check applies, seconds. */
  minDurationForPowerCheckS?: number;
  /** Energy below this AND a short duration flags `aborted_early`, Wh. */
  minMeaningfulEnergyWh?: number;
  /** Duration below this AND low energy flags `aborted_early`, seconds. */
  minMeaningfulDurationS?: number;
  /** Sessions required at a site before a recent-trend verdict is attempted. */
  minSessionsForTrend?: number;
  /** Percentage-point shift between first/second half considered a real trend. */
  trendShiftThreshold?: number;
}

const DEFAULTS = {
  taperSocPct: 80,
  minBaselineSessions: 4,
  minDurationForRateCheckS: 300,
  rateShortfallRatio: 0.5,
  powerCollapseRatio: 0.35,
  minDurationForPowerCheckS: 300,
  minMeaningfulEnergyWh: 300,
  minMeaningfulDurationS: 180,
  minSessionsForTrend: 4,
  trendShiftThreshold: 0.2,
} as const;

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Group key for a session — place name when known, else a ~1 km geo cell.
 * Exported for tests; sessions with neither are excluded from site scoring
 * (there is nothing to compare them against).
 */
export function groupSiteKey(session: ChargingSession): { key: string; label: string } | null {
  const place = session.start_place?.trim();
  if (place != null && place.length > 0) {
    return { key: `place:${place.toLowerCase()}`, label: place };
  }
  const lat = num(session.start_lat);
  const lng = num(session.start_lng);
  if (lat == null || lng == null) return null;
  const rLat = Math.round(lat * 100) / 100;
  const rLng = Math.round(lng * 100) / 100;
  return { key: `geo:${rLat.toFixed(2)},${rLng.toFixed(2)}`, label: `${rLat.toFixed(2)}, ${rLng.toFixed(2)}` };
}

function startedMsOf(session: ChargingSession): number {
  return new Date(session.started_at ?? session.start_ts).getTime();
}

function endedMsOf(session: ChargingSession): number | null {
  if (session.ended_at == null) return null;
  const ms = new Date(session.ended_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function durationSOf(session: ChargingSession): number | null {
  const startedMs = startedMsOf(session);
  const endedMs = endedMsOf(session);
  if (Number.isFinite(startedMs) && endedMs != null && endedMs > startedMs) {
    return (endedMs - startedMs) / 1000;
  }
  const mins = num(session.duration_min);
  return mins != null && mins > 0 ? mins * 60 : null;
}

/* ── Regularized incomplete beta function (for posterior credible intervals) ──
 * Numerical-Recipes-style continued-fraction implementation. Used only to
 * turn (alpha, beta) into a 95% credible interval; no external stats
 * dependency is available to this pure lib. */

function lnGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  const xm1 = x - 1;
  let a = c[0]!;
  const t = xm1 + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += c[i]! / (xm1 + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (xm1 + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(x: number, a: number, b: number): number {
  const MAXIT = 200;
  const EPS = 3e-7;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
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

/** Regularized incomplete beta I_x(a, b), the Beta(a,b) CDF at x. */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(x, a, b)) / a;
  }
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

/** Inverse Beta CDF via bisection — accurate to ~1e-6, plenty for a UI bound. */
export function betaQuantile(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Jeffreys prior — standard non-informative prior for a binomial rate. */
const PRIOR_ALPHA = 0.5;
const PRIOR_BETA = 0.5;

export interface BetaPosterior {
  mean: number;
  low: number;
  high: number;
}

/** Beta(alpha0 + successes, beta0 + failures) posterior mean + 95% credible interval. */
export function betaPosterior(successes: number, trials: number): BetaPosterior {
  const alpha = PRIOR_ALPHA + successes;
  const beta = PRIOR_BETA + Math.max(0, trials - successes);
  return {
    mean: alpha / (alpha + beta),
    low: betaQuantile(0.025, alpha, beta),
    high: betaQuantile(0.975, alpha, beta),
  };
}

/**
 * Score one session against its site's own baseline. `baselineRatePctPerMin`
 * and `hasBaseline` come from the site's OTHER clean sessions — a session
 * never scores itself against its own value.
 */
export function evaluateSessionSignal(
  session: ChargingSession,
  siteKey: string,
  baselineRatePctPerMin: number | null,
  isLatestOverall: boolean,
  opts: Required<ChargeInterruptionOptions>,
): SessionSignal {
  const startedMs = startedMsOf(session);
  const durationS = durationSOf(session);
  const energyWh = Math.max(0, num(session.total_energy_added_wh) ?? 0);
  const avgPowerW = num(session.avg_power_w);
  const peakPowerW = num(session.peak_power_w);
  const startSoc = num(session.start_soc_pct);
  const endSoc = num(session.end_soc_pct);
  const socGainPct = startSoc != null && endSoc != null ? endSoc - startSoc : null;

  const causes: InterruptionCause[] = [];

  // The single most recent session overall might just still be charging —
  // we cannot tell "interrupted" from "in progress" from session-level
  // fields alone, so that one session is never flagged for missing fields.
  if (!isLatestOverall) {
    if (session.ended_at == null) causes.push('no_end_timestamp');
    if (endSoc == null) causes.push('no_end_soc');
  }

  // Stalled gain: only meaningful once the session ran long enough for a
  // rate estimate to be stable, the site has an established baseline, and
  // the session didn't start already deep in the DC taper band (where a
  // slow rate is simply physics, not a stall).
  if (
    socGainPct != null &&
    socGainPct > 0 &&
    durationS != null &&
    durationS >= opts.minDurationForRateCheckS &&
    baselineRatePctPerMin != null &&
    startSoc != null &&
    startSoc < opts.taperSocPct
  ) {
    const observedRate = socGainPct / (durationS / 60);
    if (observedRate < baselineRatePctPerMin * opts.rateShortfallRatio) {
      causes.push('stalled_soc_gain');
    }
  }

  // Power collapse: average power fell far below the session's own peak,
  // without the high starting SoC that would explain a natural taper.
  if (
    avgPowerW != null &&
    peakPowerW != null &&
    peakPowerW > 0 &&
    durationS != null &&
    durationS >= opts.minDurationForPowerCheckS &&
    (startSoc == null || startSoc < opts.taperSocPct)
  ) {
    if (avgPowerW / peakPowerW < opts.powerCollapseRatio) {
      causes.push('power_collapse');
    }
  }

  // Aborted early: real charging power was reached but almost nothing was
  // delivered in almost no time — consistent with a plug-in that never took.
  if (
    durationS != null &&
    durationS < opts.minMeaningfulDurationS &&
    energyWh < opts.minMeaningfulEnergyWh &&
    peakPowerW != null &&
    peakPowerW > 1000
  ) {
    causes.push('aborted_early');
  }

  return {
    id: session.id,
    startedMs,
    siteKey,
    suspect: causes.length > 0,
    causes,
    socGainPct,
    durationS,
    energyWh: Math.round(energyWh),
    avgPowerW,
    peakPowerW,
  };
}

/**
 * Robust "typical" SoC-gain rate for a site, in pct/minute, from its own
 * clean sessions (untapered, long enough, both SoCs known). Uses the median
 * so one anomalous session can't set the baseline.
 */
function baselineRateOf(session: readonly ChargingSession[], taperSocPct: number, minDurationS: number): number | null {
  const rates: number[] = [];
  for (const s of session) {
    const startSoc = num(s.start_soc_pct);
    const endSoc = num(s.end_soc_pct);
    const durationS = durationSOf(s);
    if (startSoc == null || endSoc == null || durationS == null) continue;
    if (startSoc >= taperSocPct) continue;
    if (durationS < minDurationS) continue;
    const gain = endSoc - startSoc;
    if (gain <= 0) continue;
    rates.push(gain / (durationS / 60));
  }
  if (rates.length === 0) return null;
  const sorted = [...rates].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function trendOf(
  history: readonly SessionSignal[],
  minSessions: number,
  shiftThreshold: number,
): InterruptionTrend {
  if (history.length < minSessions) return 'insufficient_data';
  const mid = Math.floor(history.length / 2);
  const first = history.slice(0, mid);
  const second = history.slice(mid);
  const rate = (arr: readonly SessionSignal[]) =>
    arr.length === 0 ? 0 : arr.filter((s) => s.suspect).length / arr.length;
  const r1 = rate(first);
  const r2 = rate(second);
  if (r2 - r1 >= shiftThreshold) return 'rising';
  if (r1 - r2 >= shiftThreshold) return 'falling';
  return 'flat';
}

function topCausesOf(history: readonly SessionSignal[]): InterruptionCause[] {
  const counts = new Map<InterruptionCause, number>();
  for (const s of history) {
    for (const c of s.causes) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cause]) => cause);
}

export function analyzeChargeInterruptions(
  sessions: readonly ChargingSession[],
  options: ChargeInterruptionOptions = {},
): ChargeInterruptionSummary {
  const opts = { ...DEFAULTS, ...options };

  // Determine the single overall-latest session (by start time) so its
  // missing-field checks can be suppressed — see evaluateSessionSignal.
  let latestId: string | null = null;
  let latestMs = -Infinity;
  for (const s of sessions) {
    const ms = startedMsOf(s);
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latestId = s.id;
    }
  }

  const groups = new Map<string, { label: string; raw: ChargingSession[] }>();
  for (const s of sessions) {
    const site = groupSiteKey(s);
    if (site == null) continue;
    let g = groups.get(site.key);
    if (g == null) {
      g = { label: site.label, raw: [] };
      groups.set(site.key, g);
    }
    g.raw.push(s);
  }

  const sites: SiteInterruptionRisk[] = [];
  let evaluableSessions = 0;
  let suspectedSessions = 0;
  let pooledSuspect = 0;
  let pooledTrials = 0;

  for (const [key, group] of groups) {
    const baselineRate = baselineRateOf(group.raw, opts.taperSocPct, opts.minDurationForRateCheckS);
    const rawSorted = [...group.raw].sort((a, b) => startedMsOf(a) - startedMsOf(b));
    const history = rawSorted.map((s) =>
      evaluateSessionSignal(s, key, baselineRate, s.id === latestId, opts),
    );

    evaluableSessions += history.length;
    const suspectedCount = history.filter((s) => s.suspect).length;
    suspectedSessions += suspectedCount;
    pooledSuspect += suspectedCount;
    pooledTrials += history.length;

    const posterior = betaPosterior(suspectedCount, history.length);
    const lastSuspect = [...history].reverse().find((s) => s.suspect);

    sites.push({
      key,
      label: group.label,
      evidenceCount: history.length,
      suspectedCount,
      posteriorMean: Math.round(posterior.mean * 1000) / 1000,
      posteriorLow: Math.round(posterior.low * 1000) / 1000,
      posteriorHigh: Math.round(posterior.high * 1000) / 1000,
      recentTrend: trendOf(history, opts.minSessionsForTrend, opts.trendShiftThreshold),
      topCauses: topCausesOf(history),
      lastSuspectedMs: lastSuspect?.startedMs ?? null,
      sessions: history,
    });
  }

  sites.sort((a, b) => b.posteriorMean - a.posteriorMean || b.evidenceCount - a.evidenceCount);

  const highestRiskSite =
    sites.length === 0
      ? null
      : sites.reduce((best, s) =>
          s.posteriorLow > best.posteriorLow ||
          (s.posteriorLow === best.posteriorLow && s.posteriorMean > best.posteriorMean)
            ? s
            : best,
        );

  const overallPosterior = betaPosterior(pooledSuspect, pooledTrials);

  return {
    sites,
    totalSessions: sessions.length,
    evaluableSessions,
    suspectedSessions,
    overallPosteriorMean: Math.round(overallPosterior.mean * 1000) / 1000,
    highestRiskSite,
  };
}
