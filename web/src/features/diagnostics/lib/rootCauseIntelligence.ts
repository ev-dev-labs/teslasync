/**
 * Root-Cause Intelligence engine.
 *
 * Pure, React-free, deterministic statistics module. Given a focal signal's
 * raw history plus a small, deterministically-selected set of related
 * signals' raw histories, this module:
 *
 *   1. Classifies signals into coarse domains (battery, charge, thermal, …).
 *   2. Selects a bounded set of "related" signals from a catalog using a
 *      deterministic, domain + token-overlap scoring heuristic.
 *   3. Finds the focal signal's strongest robust (median/MAD-based) level
 *      shift in the analyzed window.
 *   4. For each related candidate, looks for its own strongest robust shift
 *      within a bounded time radius of the focal shift, and — if the
 *      evidence clears minimum bars for sample coverage and effect size —
 *      emits a ranked, evidence-based hypothesis.
 *   5. Produces a small evidence graph (nodes/edges) and a normalized,
 *      shared-time-grid timeline suitable for a multi-series chart.
 *
 * IMPORTANT — this module never claims causation. Every hypothesis is an
 * evidence-ranked statistical association ("worth reviewing"), never a
 * diagnosis or a claim of causal proof. See `NO_CAUSAL_PROOF_DISCLAIMER` and
 * the "no causal overclaim" test suite in the colocated test file — no
 * generated string may match an affirmative-causation pattern.
 *
 * This module intentionally has zero imports from `@/api` or `@/types` — it
 * accepts a small structural `RawSignalPoint` shape so it never depends on
 * the shape of any particular backend response, and defensively parses
 * `timestamp`/`ts` and `valueNum`/`value_num`/`value` aliases because real
 * API payloads may mirror either snake_case or camelCase.
 *
 * No `any`. No `Array.prototype.at` (uses index arithmetic instead so it
 * keeps working in every supported runtime/lint configuration).
 */

// ─────────────────────────────────────────────────────────────────────────
// Domains
// ─────────────────────────────────────────────────────────────────────────

export type SignalDomain =
  | 'battery'
  | 'charge'
  | 'thermal'
  | 'drivetrain'
  | 'tire'
  | 'connectivity'
  | 'climate'
  | 'motion';

/** Fixed iteration order — keeps `classifySignalDomains` output deterministic. */
const DOMAIN_ORDER: readonly SignalDomain[] = [
  'battery',
  'charge',
  'thermal',
  'drivetrain',
  'tire',
  'connectivity',
  'climate',
  'motion',
];

/**
 * Lightweight, deliberately simple substring heuristics (not a linguistic
 * parser). Domains are not mutually exclusive — a name such as
 * "PackTemperature" legitimately belongs to both `battery` and `thermal`,
 * which is what lets the relatedness scorer treat it as strongly related to
 * other battery- or thermal-domain signals.
 */
const DOMAIN_PATTERNS: Record<SignalDomain, RegExp> = {
  battery: /batt|\bsoc\b|\bsoh\b|pack_?voltage|cell_?voltage/i,
  charge: /charg|plug|pilot_?current|energy_?added|charge_?rate/i,
  thermal: /temp|therm|coolant|heater|chiller/i,
  drivetrain: /motor|inverter|torque|\brpm\b|gear|regen/i,
  tire: /tire|tyre|tpms|wheel_?pressure/i,
  connectivity: /signal_?strength|rssi|wifi|cellular|gps_?accuracy|network/i,
  climate: /hvac|cabin|climate|fan_?speed/i,
  motion: /speed|accel|gyro|heading|odomet|altitude/i,
};

/** Classify a signal name into zero or more coarse domains. Pure, deterministic. */
export function classifySignalDomains(signal: string): SignalDomain[] {
  const domains: SignalDomain[] = [];
  for (const domain of DOMAIN_ORDER) {
    if (DOMAIN_PATTERNS[domain].test(signal)) domains.push(domain);
  }
  return domains;
}

// ─────────────────────────────────────────────────────────────────────────
// Related-signal selection
// ─────────────────────────────────────────────────────────────────────────

export const MAX_RELATED_SIGNALS = 7;
const DOMAIN_WEIGHT = 10;
const TOKEN_WEIGHT = 6;
const FIRST_TOKEN_WEIGHT = 2;
/** Two shared domains + full token overlap + shared first token — the
 *  realistic ceiling used to normalize a candidate's relatedness score into
 *  a [0,1] "reliability" sub-score. */
const RELIABILITY_REFERENCE_SCORE = 2 * DOMAIN_WEIGHT + TOKEN_WEIGHT + FIRST_TOKEN_WEIGHT;

export interface RelatedSignalCandidate {
  signal: string;
  score: number;
  sharedDomains: SignalDomain[];
}

/** Split a signal name into lowercase tokens at camelCase/snake_case/kebab-case boundaries. */
function tokenize(signal: string): Set<string> {
  const spaced = signal
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase();
  const tokens = spaced.split(/\s+/).filter((t) => t.length > 0);
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function firstToken(tokens: Set<string>): string {
  for (const t of tokens) return t;
  return '';
}

/**
 * Deterministically select up to `MAX_RELATED_SIGNALS` catalog signals
 * "related" to `focalSignal`, using domain overlap + token-overlap scoring.
 *
 * Deterministic: calling this twice with the same inputs always yields the
 * same array (same members, same order) — sorted by score desc, then
 * signal name asc as a stable tie-break so ordering never depends on
 * catalog iteration order or engine sort stability quirks.
 */
export function selectRelatedSignals(
  focalSignal: string,
  catalog: readonly string[],
): RelatedSignalCandidate[] {
  const trimmedFocal = focalSignal.trim();
  if (trimmedFocal === '') return [];

  const focalDomains = new Set(classifySignalDomains(trimmedFocal));
  const focalTokens = tokenize(trimmedFocal);
  const focalFirstToken = firstToken(focalTokens);

  const seen = new Set<string>();
  const scored: RelatedSignalCandidate[] = [];

  for (const raw of catalog ?? []) {
    const signal = typeof raw === 'string' ? raw.trim() : '';
    if (signal === '' || signal === trimmedFocal || seen.has(signal)) continue;
    seen.add(signal);

    const domains = classifySignalDomains(signal);
    const sharedDomains = domains.filter((d) => focalDomains.has(d));
    const domainScore = sharedDomains.length * DOMAIN_WEIGHT;

    const tokens = tokenize(signal);
    const tokenScore = jaccard(focalTokens, tokens) * TOKEN_WEIGHT;

    const sharesFirstToken = focalFirstToken !== '' && firstToken(tokens) === focalFirstToken;
    const firstTokenScore = sharesFirstToken ? FIRST_TOKEN_WEIGHT : 0;

    const score = domainScore + tokenScore + firstTokenScore;
    if (score > 0) {
      scored.push({ signal, score, sharedDomains });
    }
  }

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.signal.localeCompare(b.signal)));
  return scored.slice(0, MAX_RELATED_SIGNALS);
}

// ─────────────────────────────────────────────────────────────────────────
// Defensive point parsing
// ─────────────────────────────────────────────────────────────────────────

/**
 * Structural shape accepted from any signal-history-like API response.
 * Deliberately loose/optional on every field — the real backend response is
 * camelCase (`timestamp`/`valueNum`) per `SignalHistoryResponse`, but this
 * module defensively also accepts `ts`/`value_num`/`value` so it degrades
 * gracefully instead of silently dropping data if a payload ever mirrors
 * snake_case.
 */
export interface RawSignalPoint {
  timestamp?: string | number | null;
  ts?: string | number | null;
  valueNum?: number | string | null;
  value_num?: number | string | null;
  value?: number | string | null;
}

export interface NumericPoint {
  ms: number;
  value: number;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toEpochMs(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Parse a list of defensively-typed raw points into sorted, strictly
 * numeric `{ ms, value }` pairs. Non-numeric, missing, or unparsable
 * timestamp/value fields are silently dropped rather than throwing —
 * malformed telemetry should degrade the analysis, not crash the page.
 */
export function toNumericPoints(points: readonly RawSignalPoint[] | null | undefined): NumericPoint[] {
  const out: NumericPoint[] = [];
  for (const p of points ?? []) {
    if (p == null || typeof p !== 'object') continue;
    const ms = toEpochMs(p.timestamp ?? p.ts);
    const value = toFiniteNumber(p.valueNum ?? p.value_num ?? p.value);
    if (ms == null || value == null) continue;
    out.push({ ms, value });
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Robust statistics
// ─────────────────────────────────────────────────────────────────────────

const EPSILON = 1e-9;
/** Gaussian-consistent scale factor so MAD approximates a standard deviation. */
const MAD_CONSISTENCY_CONSTANT = 1.4826;

/** Median of a numeric array. Returns 0 for an empty array. */
export function median(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Median Absolute Deviation around `centre` (defaults to the array's own median). */
export function mad(values: readonly number[], centre?: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const m = centre ?? median(values);
  const deviations = values.map((v) => Math.abs(v - m));
  return median(deviations);
}

/** MAD scaled to be comparable to a standard deviation for a normal distribution. */
export function robustSpread(values: readonly number[], centre?: number): number {
  return mad(values, centre) * MAD_CONSISTENCY_CONSTANT;
}

function percentile(sortedValues: readonly number[], p: number): number {
  const n = sortedValues.length;
  if (n === 0) return 0;
  if (n === 1) return sortedValues[0]!;
  const idx = p * (n - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower]!;
  const weight = idx - lower;
  return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function roundTo(v: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

// ─────────────────────────────────────────────────────────────────────────
// Robust shift (change-point) detection
// ─────────────────────────────────────────────────────────────────────────

export const MIN_FOCAL_SAMPLES = 12;
export const MIN_WINDOW_MS = 10 * 60_000;
export const MIN_FOCAL_EFFECT_SIZE = 0.6;
export const MIN_CANDIDATE_SAMPLES = 8;
export const MIN_CANDIDATE_EFFECT_SIZE = 0.4;
export const MIN_SPLIT_SAMPLES = 4;
export const CONCURRENT_TOLERANCE_MS = 5 * 60_000;
export const MAX_EFFECT_SIZE = 50;
/** Coarse-search cap: bounds compute cost for series with thousands of samples. */
export const MAX_SPLIT_CANDIDATES = 400;
export const SEARCH_RADIUS_FRACTION = 0.15;
export const MIN_SEARCH_RADIUS_MS = 30 * 60_000;
export const MAX_SEARCH_RADIUS_MS = 6 * 60 * 60_000;

export interface RobustShift {
  splitMs: number;
  before: { median: number; mad: number; count: number };
  after: { median: number; mad: number; count: number };
  effectSize: number;
  direction: 'up' | 'down' | 'flat';
}

interface SplitStatsResult {
  shift: RobustShift;
  /**
   * Unclamped effect size, used ONLY for comparing candidate splits against
   * one another. Once many nearby splits all exceed `MAX_EFFECT_SIZE`, the
   * clamped values tie — comparing on the clamped number would then fall
   * back to "first candidate scanned" and could pick a split far from the
   * true strongest one. Comparing on the raw ratio keeps the search
   * selecting the genuinely-strongest split even beyond the clamp ceiling.
   */
  rawEffect: number;
}

function computeSplitStats(points: readonly NumericPoint[], splitMs: number): SplitStatsResult | null {
  const before: number[] = [];
  const after: number[] = [];
  for (const p of points) {
    if (p.ms < splitMs) before.push(p.value);
    else after.push(p.value);
  }
  if (before.length < MIN_SPLIT_SAMPLES || after.length < MIN_SPLIT_SAMPLES) return null;

  const beforeMedian = median(before);
  const afterMedian = median(after);
  const beforeMad = mad(before, beforeMedian);
  const afterMad = mad(after, afterMedian);
  // A floor (not a fixed absolute epsilon derived from data scale) keeps
  // the ratio finite when both segments are perfectly flat (MAD=0) yet
  // genuinely different — mathematically, zero within-segment variability
  // makes any between-segment gap maximally significant, so this
  // deliberately produces a very large (then clamped) effect size rather
  // than NaN/Infinity.
  const pooledSpread = Math.max(
    robustSpread(before, beforeMedian),
    robustSpread(after, afterMedian),
    EPSILON,
  );
  const diff = afterMedian - beforeMedian;
  const rawEffect = Math.abs(diff) / pooledSpread;
  const effectSize = Math.min(rawEffect, MAX_EFFECT_SIZE);
  const direction: RobustShift['direction'] =
    Math.abs(diff) < EPSILON ? 'flat' : diff > 0 ? 'up' : 'down';

  return {
    shift: {
      splitMs,
      before: { median: beforeMedian, mad: beforeMad, count: before.length },
      after: { median: afterMedian, mad: afterMad, count: after.length },
      effectSize,
      direction,
    },
    rawEffect,
  };
}

/** Evenly-spaced candidate split indices, capped at `MAX_SPLIT_CANDIDATES` so
 *  a long, high-frequency series never makes the search unbounded. */
function pickCandidateIndices(minIdx: number, maxIdx: number): number[] {
  if (maxIdx < minIdx) return [];
  const span = maxIdx - minIdx + 1;
  if (span <= MAX_SPLIT_CANDIDATES) {
    const out: number[] = [];
    for (let i = minIdx; i <= maxIdx; i += 1) out.push(i);
    return out;
  }
  const step = Math.ceil(span / MAX_SPLIT_CANDIDATES);
  const out: number[] = [];
  for (let i = minIdx; i <= maxIdx; i += step) out.push(i);
  return out;
}

/**
 * Find the single strongest robust (median/MAD) level shift anywhere in a
 * numeric series. Ties in effect size are broken deterministically by
 * keeping the earliest candidate (ascending scan, strict-improvement only).
 * Returns `null` when the series is too short/narrow to search at all.
 */
export function findStrongestRobustShift(points: readonly NumericPoint[]): RobustShift | null {
  const n = points.length;
  if (n < MIN_SPLIT_SAMPLES * 2) return null;

  const indices = pickCandidateIndices(MIN_SPLIT_SAMPLES, n - MIN_SPLIT_SAMPLES);
  let best: RobustShift | null = null;
  let bestRaw = -Infinity;
  for (const idx of indices) {
    const splitMs = points[idx]!.ms;
    const stats = computeSplitStats(points, splitMs);
    if (stats == null) continue;
    if (best == null || stats.rawEffect > bestRaw) {
      best = stats.shift;
      bestRaw = stats.rawEffect;
    }
  }
  return best;
}

/** Same search, restricted to candidate split points within `radiusMs` of `centreMs`. */
function findStrongestRobustShiftNear(
  points: readonly NumericPoint[],
  centreMs: number,
  radiusMs: number,
): RobustShift | null {
  const n = points.length;
  if (n < MIN_SPLIT_SAMPLES * 2) return null;

  const inRange: number[] = [];
  for (let i = MIN_SPLIT_SAMPLES; i <= n - MIN_SPLIT_SAMPLES; i += 1) {
    const ms = points[i]!.ms;
    if (ms >= centreMs - radiusMs && ms <= centreMs + radiusMs) inRange.push(i);
  }
  const indices =
    inRange.length <= MAX_SPLIT_CANDIDATES
      ? inRange
      : (() => {
          const step = Math.ceil(inRange.length / MAX_SPLIT_CANDIDATES);
          const out: number[] = [];
          for (let i = 0; i < inRange.length; i += step) out.push(inRange[i]!);
          return out;
        })();

  let best: RobustShift | null = null;
  let bestRaw = -Infinity;
  for (const idx of indices) {
    const stats = computeSplitStats(points, points[idx]!.ms);
    if (stats == null) continue;
    if (best == null || stats.rawEffect > bestRaw) {
      best = stats.shift;
      bestRaw = stats.rawEffect;
    }
  }
  return best;
}

function computeSearchRadiusMs(spanMs: number): number {
  const fraction = spanMs * SEARCH_RADIUS_FRACTION;
  return Math.min(MAX_SEARCH_RADIUS_MS, Math.max(MIN_SEARCH_RADIUS_MS, fraction));
}

// ─────────────────────────────────────────────────────────────────────────
// Ranked hypotheses
// ─────────────────────────────────────────────────────────────────────────

export type EvidenceRelation = 'leads' | 'lags' | 'concurrent';

export const WEIGHT_EFFECT = 0.4;
export const WEIGHT_TEMPORAL = 0.25;
export const WEIGHT_COVERAGE = 0.2;
export const WEIGHT_RELIABILITY = 0.15;
export const EFFECT_SCORE_REFERENCE = 4;
export const COVERAGE_REFERENCE_SAMPLES = 200;

/**
 * A single evidence-ranked hypothesis about a related signal's temporal
 * association with the focal signal's shift. This is a statistical
 * observation, never a diagnosis or a claim of causal proof.
 */
export interface RankedHypothesis {
  signal: string;
  domains: SignalDomain[];
  relation: EvidenceRelation;
  lagMs: number;
  shift: RobustShift;
  effectScore: number;
  temporalScore: number;
  coverageScore: number;
  reliabilityScore: number;
  score: number;
  sampleCount: number;
  rationale: string;
}

function buildHypothesisRationale(params: {
  focalSignal: string;
  signal: string;
  relation: EvidenceRelation;
  lagMs: number;
  effectSize: number;
}): string {
  const minutes = Math.round(Math.abs(params.lagMs) / 60_000);
  const timing =
    params.relation === 'concurrent'
      ? `shifted within ${minutes} min of ${params.focalSignal}'s change (concurrent)`
      : params.relation === 'leads'
        ? `shifted about ${minutes} min before ${params.focalSignal}'s change (leading)`
        : `shifted about ${minutes} min after ${params.focalSignal}'s change (lagging)`;
  return (
    `${params.signal} ${timing}, with a robust effect size of ${roundTo(params.effectSize, 2)}. ` +
    'Ranked by shift strength, timing proximity, sample coverage, and evidence reliability — ' +
    'a lead worth reviewing, not a diagnosis.'
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Evidence graph
// ─────────────────────────────────────────────────────────────────────────

export interface EvidenceGraphNode {
  id: string;
  kind: 'focal' | 'candidate';
  domains: SignalDomain[];
  sampleCount: number;
  hasEvidence: boolean;
}

export interface EvidenceGraphEdge {
  source: string;
  target: string;
  relation: EvidenceRelation;
  /** Mirrors the corresponding hypothesis's overall [0,1] rank score. */
  strength: number;
}

export interface EvidenceGraph {
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
}

// ─────────────────────────────────────────────────────────────────────────
// Normalized timeline
// ─────────────────────────────────────────────────────────────────────────

export const MAX_TIMELINE_POINTS = 240;
const MIN_STALE_CUTOFF_MS = 5 * 60_000;

/** A single shared-time-grid row. Series values are independently min-max
 *  normalized to [0,1] (visual comparability only — ranking uses the raw
 *  robust statistics, not this normalized view). `null` marks a grid point
 *  too far past a series' last observation to still be considered current. */
export type TimelineRow = {
  ms: number;
  time: string;
} & Record<string, number | string | null>;

function computeRobustBounds(values: readonly number[]): { lo: number; hi: number } {
  if (values.length === 0) return { lo: 0, hi: 1 };
  const sorted = [...values].sort((a, b) => a - b);
  const lo = percentile(sorted, 0.05);
  const hi = percentile(sorted, 0.95);
  if (hi - lo > EPSILON) return { lo, hi };
  // Degenerate/near-constant series (outlier-clamped 5th/95th percentile
  // collapse to the same value) — fall back to true min/max so a genuinely
  // flat signal still normalizes to a stable value instead of NaN.
  const trueLo = sorted[0]!;
  const trueHi = sorted[sorted.length - 1]!;
  return trueHi - trueLo > EPSILON ? { lo: trueLo, hi: trueHi } : { lo: trueLo - 1, hi: trueHi + 1 };
}

function normalize(value: number, lo: number, hi: number): number {
  if (hi - lo < EPSILON) return 0.5;
  return clamp01((value - lo) / (hi - lo));
}

/** Resample a sorted series onto a sorted grid via last-observation-carried-forward. */
function resampleColumn(
  points: readonly NumericPoint[],
  grid: readonly number[],
  staleCutoffMs: number,
): Array<number | null> {
  const out: Array<number | null> = [];
  let cursor = 0;
  let lastValue: number | null = null;
  let lastMs: number | null = null;
  for (const gridMs of grid) {
    while (cursor < points.length && points[cursor]!.ms <= gridMs) {
      lastValue = points[cursor]!.value;
      lastMs = points[cursor]!.ms;
      cursor += 1;
    }
    out.push(lastValue == null || lastMs == null || gridMs - lastMs > staleCutoffMs ? null : lastValue);
  }
  return out;
}

/**
 * Build a normalized, shared-time-grid timeline covering the focal series
 * plus an ordered list of related series, suitable for a multi-series chart.
 * Series order is preserved from `relatedSeriesOrdered` (expected to already
 * be in ranked-relatedness order) so chart color assignment stays stable.
 */
export function buildNormalizedTimeline(
  focalSignal: string,
  focalPoints: readonly NumericPoint[],
  relatedSeriesOrdered: ReadonlyArray<readonly [string, readonly NumericPoint[]]>,
): { timeline: TimelineRow[]; seriesNames: string[] } {
  if (focalSignal === '' || focalPoints.length === 0) {
    return { timeline: [], seriesNames: [] };
  }

  const seriesNames: string[] = [focalSignal];
  const allSeries: Array<readonly [string, readonly NumericPoint[]]> = [[focalSignal, focalPoints]];
  for (const [name, pts] of relatedSeriesOrdered) {
    if (pts.length > 0) {
      seriesNames.push(name);
      allSeries.push([name, pts]);
    }
  }

  let minMs = focalPoints[0]!.ms;
  let maxMs = focalPoints[focalPoints.length - 1]!.ms;
  for (const [, pts] of allSeries) {
    minMs = Math.min(minMs, pts[0]!.ms);
    maxMs = Math.max(maxMs, pts[pts.length - 1]!.ms);
  }
  if (maxMs <= minMs) return { timeline: [], seriesNames };

  const gridSize = Math.min(MAX_TIMELINE_POINTS, Math.max(2, focalPoints.length));
  const stepMs = (maxMs - minMs) / (gridSize - 1);
  const staleCutoffMs = Math.max(stepMs * 3, MIN_STALE_CUTOFF_MS);
  const grid: number[] = [];
  for (let i = 0; i < gridSize; i += 1) grid.push(minMs + i * stepMs);

  const columns = new Map<string, Array<number | null>>();
  for (const [name, pts] of allSeries) {
    const bounds = computeRobustBounds(pts.map((p) => p.value));
    const raw = resampleColumn(pts, grid, staleCutoffMs);
    columns.set(
      name,
      raw.map((v) => (v == null ? null : normalize(v, bounds.lo, bounds.hi))),
    );
  }

  const timeline: TimelineRow[] = grid.map((ms, i) => {
    const row: TimelineRow = { ms, time: new Date(ms).toISOString() };
    for (const name of seriesNames) {
      row[name] = columns.get(name)?.[i] ?? null;
    }
    return row;
  });

  return { timeline, seriesNames };
}

// ─────────────────────────────────────────────────────────────────────────
// Evidence quality
// ─────────────────────────────────────────────────────────────────────────

export type EvidenceQualityBand = 'insufficient' | 'weak' | 'moderate' | 'strong';

export const QUALITY_SAMPLE_REFERENCE = 200;
export const QUALITY_WINDOW_REFERENCE_MS = 24 * 60 * 60_000;
export const QUALITY_STRONG_THRESHOLD = 0.66;
export const QUALITY_MODERATE_THRESHOLD = 0.4;

export interface EvidenceQuality {
  band: EvidenceQualityBand;
  overallScore: number;
  focalSampleCount: number;
  candidatesWithEvidence: number;
  candidatesConsidered: number;
  windowMs: number;
}

function buildEvidenceQuality(params: {
  focalSampleCount: number;
  candidatesConsidered: number;
  hypothesesCount: number;
  focalQualifies: boolean;
  windowMs: number;
}): EvidenceQuality {
  const { focalSampleCount, candidatesConsidered, hypothesesCount, focalQualifies, windowMs } = params;

  if (!focalQualifies || focalSampleCount === 0) {
    return {
      band: 'insufficient',
      overallScore: 0,
      focalSampleCount,
      candidatesWithEvidence: 0,
      candidatesConsidered,
      windowMs,
    };
  }

  const sampleScore = clamp01(focalSampleCount / QUALITY_SAMPLE_REFERENCE);
  const coverageScore = candidatesConsidered === 0 ? 0 : clamp01(hypothesesCount / candidatesConsidered);
  const windowScore = clamp01(windowMs / QUALITY_WINDOW_REFERENCE_MS);
  const overallScore = clamp01(sampleScore * 0.4 + coverageScore * 0.35 + windowScore * 0.25);

  const band: EvidenceQualityBand =
    hypothesesCount === 0
      ? 'weak'
      : overallScore >= QUALITY_STRONG_THRESHOLD
        ? 'strong'
        : overallScore >= QUALITY_MODERATE_THRESHOLD
          ? 'moderate'
          : 'weak';

  return {
    band,
    overallScore,
    focalSampleCount,
    candidatesWithEvidence: hypothesesCount,
    candidatesConsidered,
    windowMs,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Hedged narrative text — never a diagnosis, never causal proof
// ─────────────────────────────────────────────────────────────────────────

/**
 * Canonical disclaimer reused verbatim by both the lib's own generated text
 * and the pages that render it, so there is exactly one string to keep
 * honest. Directly satisfies "every output must be described as an
 * evidence-ranked hypothesis, never a diagnosis or causal proof."
 */
export const NO_CAUSAL_PROOF_DISCLAIMER =
  'This is an evidence-ranked hypothesis, not a diagnosis or a claim of causal proof.';

function buildSummary(params: {
  focalSignal: string;
  focalShift: RobustShift | null;
  hypothesesCount: number;
  quality: EvidenceQuality;
}): string {
  const { focalSignal, focalShift, hypothesesCount, quality } = params;
  if (focalSignal === '') {
    return 'Choose a focal signal to generate an evidence-ranked summary.';
  }
  if (focalShift == null) {
    return (
      `No robust shift was found for ${focalSignal} in the analyzed window, so no hypotheses are offered. ` +
      'This may mean the signal was stable, or that the window was too short or sparse.'
    );
  }
  if (hypothesesCount === 0) {
    return (
      `${focalSignal} shows a robust shift, but no other analyzed signal showed a comparable, well-timed shift. ` +
      `Treat this as an isolated change with weak corroborating evidence. ${NO_CAUSAL_PROOF_DISCLAIMER}`
    );
  }
  const plural = hypothesesCount === 1 ? 'is' : 'es';
  return (
    `${focalSignal} shows a robust shift with ${hypothesesCount} ranked, evidence-based hypothes${plural} for review ` +
    `(evidence quality: ${quality.band}). ${NO_CAUSAL_PROOF_DISCLAIMER}`
  );
}

function buildLimitations(params: {
  focalQualifies: boolean;
  quality: EvidenceQuality;
  relatedCandidatesCount: number;
  hypothesesCount: number;
}): string[] {
  const { focalQualifies, quality, relatedCandidatesCount, hypothesesCount } = params;
  const notes: string[] = [
    `Every listed item is an evidence-ranked hypothesis derived from statistical association. ${NO_CAUSAL_PROOF_DISCLAIMER}`,
    'Analysis is limited to the selected time window and the bounded set of related signals available in the catalog; unrecorded or unavailable signals cannot be considered.',
  ];
  if (!focalQualifies) {
    notes.push(
      'The focal signal did not show a robust, well-supported shift in this window, so hypotheses are withheld rather than guessed.',
    );
  }
  if (relatedCandidatesCount === 0) {
    notes.push('No related signals were identified in the catalog for this focal signal.');
  } else if (hypothesesCount === 0 && focalQualifies) {
    notes.push('None of the related signals cleared the minimum evidence bar for sample coverage or shift strength.');
  }
  if (quality.band === 'weak' || quality.band === 'insufficient') {
    notes.push('Evidence quality is low — treat any listed hypothesis as preliminary and confirm with additional data before acting.');
  }
  notes.push('Temporal proximity alone does not establish which signal, if any, is upstream of the other.');
  return notes;
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level orchestration
// ─────────────────────────────────────────────────────────────────────────

export interface RootCauseAnalysisSeriesInput {
  signal: string;
  points: readonly RawSignalPoint[];
}

export interface RootCauseAnalysisInput {
  /** The user-selected signal under investigation. */
  focalSignal: string;
  /** Full signal-name catalog for the vehicle (used to (re)derive related candidates). */
  catalog: readonly string[];
  focalPoints: readonly RawSignalPoint[];
  /** History for whichever related candidates have resolved so far — may be a
   *  subset of the full related-signal selection while queries are loading. */
  relatedSeries: readonly RootCauseAnalysisSeriesInput[];
}

export interface RootCauseAnalysisResult {
  focalSignal: string;
  focalDomains: SignalDomain[];
  relatedCandidates: RelatedSignalCandidate[];
  focalShift: RobustShift | null;
  hypotheses: RankedHypothesis[];
  graph: EvidenceGraph;
  timeline: TimelineRow[];
  timelineSeriesNames: string[];
  quality: EvidenceQuality;
  limitations: string[];
  summary: string;
  dataWindow: { earliestMs: number | null; latestMs: number | null };
}

function computeDataWindow(
  focalPoints: readonly NumericPoint[],
  seriesBySignal: ReadonlyMap<string, readonly NumericPoint[]>,
): { earliestMs: number | null; latestMs: number | null } {
  let earliest: number | null = null;
  let latest: number | null = null;
  const consider = (pts: readonly NumericPoint[]): void => {
    if (pts.length === 0) return;
    const first = pts[0]!.ms;
    const last = pts[pts.length - 1]!.ms;
    earliest = earliest == null ? first : Math.min(earliest, first);
    latest = latest == null ? last : Math.max(latest, last);
  };
  consider(focalPoints);
  for (const pts of seriesBySignal.values()) consider(pts);
  return { earliestMs: earliest, latestMs: latest };
}

function buildEvidenceGraph(params: {
  focalSignal: string;
  focalDomains: SignalDomain[];
  focalSampleCount: number;
  relatedCandidates: readonly RelatedSignalCandidate[];
  seriesBySignal: ReadonlyMap<string, readonly NumericPoint[]>;
  hypotheses: readonly RankedHypothesis[];
}): EvidenceGraph {
  const { focalSignal, focalDomains, focalSampleCount, relatedCandidates, seriesBySignal, hypotheses } = params;
  if (focalSignal === '') return { nodes: [], edges: [] };

  const hypothesisBySignal = new Map(hypotheses.map((h) => [h.signal, h] as const));

  const nodes: EvidenceGraphNode[] = [
    { id: focalSignal, kind: 'focal', domains: focalDomains, sampleCount: focalSampleCount, hasEvidence: true },
    ...relatedCandidates.map((c) => ({
      id: c.signal,
      kind: 'candidate' as const,
      domains: classifySignalDomains(c.signal),
      sampleCount: seriesBySignal.get(c.signal)?.length ?? 0,
      hasEvidence: hypothesisBySignal.has(c.signal),
    })),
  ];

  const edges: EvidenceGraphEdge[] = [];
  for (const c of relatedCandidates) {
    const h = hypothesisBySignal.get(c.signal);
    if (h == null) continue;
    edges.push({ source: focalSignal, target: h.signal, relation: h.relation, strength: h.score });
  }

  return { nodes, edges };
}

/**
 * Returns true when a root-cause analysis has cleared the minimum evidence
 * bar to be considered "defensible" enough to export (a robust focal shift
 * was found, and overall evidence quality is not `insufficient`). Used to
 * gate the Service Evidence Pack export action.
 */
export function isAnalysisDefensible(result: RootCauseAnalysisResult): boolean {
  return result.focalShift != null && result.quality.band !== 'insufficient';
}

/**
 * Orchestrates the full root-cause analysis. Never throws — always returns
 * a structurally complete result, even for empty/malformed input, so the UI
 * can render a graceful "insufficient evidence" state instead of crashing.
 */
export function analyzeRootCause(input: RootCauseAnalysisInput): RootCauseAnalysisResult {
  const focalSignal = (input.focalSignal ?? '').trim();
  const focalDomains = classifySignalDomains(focalSignal);
  const relatedCandidates = selectRelatedSignals(focalSignal, input.catalog ?? []);

  const focalNumeric = toNumericPoints(input.focalPoints);
  const rawFocalShift = focalSignal !== '' ? findStrongestRobustShift(focalNumeric) : null;

  const seriesBySignal = new Map<string, NumericPoint[]>();
  for (const s of input.relatedSeries ?? []) {
    if (s == null || typeof s.signal !== 'string') continue;
    seriesBySignal.set(s.signal, toNumericPoints(s.points));
  }

  const dataWindow = computeDataWindow(focalNumeric, seriesBySignal);

  const focalQualifies =
    rawFocalShift != null &&
    focalNumeric.length >= MIN_FOCAL_SAMPLES &&
    dataWindow.latestMs != null &&
    dataWindow.earliestMs != null &&
    dataWindow.latestMs - dataWindow.earliestMs >= MIN_WINDOW_MS &&
    rawFocalShift.effectSize >= MIN_FOCAL_EFFECT_SIZE;

  const focalShift = focalQualifies ? rawFocalShift : null;

  const hypotheses: RankedHypothesis[] = [];
  if (focalShift != null) {
    const spanMs = focalNumeric[focalNumeric.length - 1]!.ms - focalNumeric[0]!.ms;
    const radiusMs = computeSearchRadiusMs(spanMs);

    for (const candidate of relatedCandidates) {
      const points = seriesBySignal.get(candidate.signal);
      if (points == null || points.length < MIN_CANDIDATE_SAMPLES) continue;

      const shift = findStrongestRobustShiftNear(points, focalShift.splitMs, radiusMs);
      if (shift == null || shift.effectSize < MIN_CANDIDATE_EFFECT_SIZE) continue;

      const lagMs = shift.splitMs - focalShift.splitMs;
      const relation: EvidenceRelation =
        Math.abs(lagMs) <= CONCURRENT_TOLERANCE_MS ? 'concurrent' : lagMs < 0 ? 'leads' : 'lags';

      const effectScore = clamp01(shift.effectSize / EFFECT_SCORE_REFERENCE);
      const temporalScore = clamp01(1 - Math.abs(lagMs) / Math.max(radiusMs, 1));
      const coverageScore = clamp01(points.length / COVERAGE_REFERENCE_SAMPLES);
      const reliabilityScore = clamp01(candidate.score / RELIABILITY_REFERENCE_SCORE);

      const score = clamp01(
        effectScore * WEIGHT_EFFECT +
          temporalScore * WEIGHT_TEMPORAL +
          coverageScore * WEIGHT_COVERAGE +
          reliabilityScore * WEIGHT_RELIABILITY,
      );

      hypotheses.push({
        signal: candidate.signal,
        domains: classifySignalDomains(candidate.signal),
        relation,
        lagMs,
        shift,
        effectScore,
        temporalScore,
        coverageScore,
        reliabilityScore,
        score,
        sampleCount: points.length,
        rationale: buildHypothesisRationale({
          focalSignal,
          signal: candidate.signal,
          relation,
          lagMs,
          effectSize: shift.effectSize,
        }),
      });
    }
  }

  hypotheses.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.signal.localeCompare(b.signal)));

  const graph = buildEvidenceGraph({
    focalSignal,
    focalDomains,
    focalSampleCount: focalNumeric.length,
    relatedCandidates,
    seriesBySignal,
    hypotheses,
  });

  const relatedSeriesOrdered: Array<readonly [string, readonly NumericPoint[]]> = relatedCandidates.map(
    (c) => [c.signal, seriesBySignal.get(c.signal) ?? []] as const,
  );
  const { timeline, seriesNames } = buildNormalizedTimeline(focalSignal, focalNumeric, relatedSeriesOrdered);

  const windowMs =
    dataWindow.earliestMs != null && dataWindow.latestMs != null
      ? Math.max(0, dataWindow.latestMs - dataWindow.earliestMs)
      : 0;
  const quality = buildEvidenceQuality({
    focalSampleCount: focalNumeric.length,
    candidatesConsidered: relatedCandidates.length,
    hypothesesCount: hypotheses.length,
    focalQualifies,
    windowMs,
  });

  const limitations = buildLimitations({
    focalQualifies,
    quality,
    relatedCandidatesCount: relatedCandidates.length,
    hypothesesCount: hypotheses.length,
  });

  const summary = buildSummary({ focalSignal, focalShift, hypothesesCount: hypotheses.length, quality });

  return {
    focalSignal,
    focalDomains,
    relatedCandidates,
    focalShift,
    hypotheses,
    graph,
    timeline,
    timelineSeriesNames: seriesNames,
    quality,
    limitations,
    summary,
    dataWindow,
  };
}
