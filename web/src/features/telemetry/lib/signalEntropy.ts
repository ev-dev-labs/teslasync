/**
 * Signal Entropy — how much information is this channel actually carrying?
 *
 * Two signals can look equally "busy" on a raw event-count basis while
 * meaning completely different things operationally: a door-latch sensor
 * that toggles open/closed a dozen times a day is genuinely informative,
 * while a noisy analog channel that jitters within a fraction of a percent
 * every sample is not — it is reporting the same state over and over with
 * decoration. Shannon entropy is the standard way to tell those two apart:
 * it measures how surprised you should be by the next sample given the
 * distribution of everything seen so far, in bits.
 *
 * Because telemetry values are continuous, they must first be *binned*
 * before entropy is meaningful. This module uses **quantile (equal-
 * frequency) binning** rather than fixed-width bins: a fixed-width scheme
 * over a signal that spends 95 % of its time in a narrow band and 5 % in a
 * rare excursion would put almost every sample in one bin and call the
 * signal "boring" by construction. Quantile binning instead asks "into how
 * many roughly-equal-population buckets does this signal's own value
 * distribution naturally fall", which is the distribution-agnostic
 * question entropy is supposed to answer.
 *
 * From the binned distribution this module derives:
 *   - **normalized entropy** (0–1): entropy relative to the maximum
 *     possible for however many bins were actually populated, so a signal
 *     that only ever uses 2 of 8 requested bins is judged against a 2-state
 *     ceiling, not an 8-state one it never approached.
 *   - **effective states** (2^H): the "perplexity" — how many equally
 *     likely states this distribution behaves like, a more intuitive unit
 *     than raw bits for a KPI card.
 *   - **dominant-state / stuck fraction**: the occupancy of the single most
 *     common bin — a value near 1 means the signal is parked.
 *   - **change rate**: how often consecutive samples cross a bin boundary
 *     at all, independent of entropy (a signal can alternate between
 *     exactly two states every sample — high change rate — while still
 *     having low absolute entropy if a third rare state never recurs).
 *   - **rolling information density**: entropy recomputed over a sliding
 *     window using the *same* global bin edges, so a spike in the rolling
 *     series means "this stretch of time was unusually eventful" rather
 *     than an artefact of re-binning.
 *
 * Pure, React-free and clock-free.
 */

/**
 * Minimal structural shape this model needs. Mirrors the `SignalPoint`
 * shape `useSignalHistory` resolves to (`timestamp` + `valueNum`), declared
 * locally so this module stays independently testable without importing a
 * page-facing API type.
 */
export interface EntropySample {
  timestamp?: string | null;
  valueNum?: number | null;
}

export interface EntropyBin {
  /** Inclusive lower edge. */
  lo: number;
  /** Exclusive upper edge (inclusive for the last bin). */
  hi: number;
  count: number;
}

export interface RollingEntropyPoint {
  ms: number;
  bits: number;
  normalized: number;
}

export interface SignalEntropySummary {
  samples: number;
  /** Bins requested. */
  requestedBins: number;
  /** Bins that actually received at least one sample. */
  effectiveBins: number;
  bins: EntropyBin[];
  /** Shannon entropy of the binned distribution, bits. */
  entropyBits: number;
  /** entropyBits / log2(effectiveBins), 0–1. `0` when effectiveBins ≤ 1. */
  normalizedEntropy: number;
  /** 2^entropyBits — the "effective number of states". */
  effectiveStates: number;
  /** Occupancy fraction of the single most common bin, 0–1. */
  dominantBinFraction: number;
  dominantBinIndex: number | null;
  /** Fraction of consecutive sample pairs that cross a bin boundary, 0–1. */
  changeRate: number;
  rolling: RollingEntropyPoint[];
  minValue: number | null;
  maxValue: number | null;
}

export interface SignalEntropyOptions {
  /** Quantile bins requested. Default 8. */
  bins?: number;
  /** Rolling window size, samples. Default 20. */
  rollingWindow?: number;
  /** Rolling window step, samples. Default 5. */
  rollingStep?: number;
}

const DEFAULTS = {
  bins: 8,
  rollingWindow: 20,
  rollingStep: 5,
} as const;

interface NumericPoint {
  ms: number;
  value: number;
}

/** Numeric samples only, ascending, de-duplicated by timestamp. */
export function toNumericPoints(samples: readonly EntropySample[]): NumericPoint[] {
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

/**
 * Quantile (equal-frequency) bin edges for `values`. Returns `requested + 1`
 * edges, deduplicated — a signal with fewer distinct quantile boundaries
 * than requested (e.g. mostly-constant data) naturally collapses to fewer,
 * wider bins rather than producing empty bins that would understate
 * `effectiveBins`.
 */
export function quantileEdges(values: readonly number[], requested: number): number[] {
  if (values.length === 0) return [0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const k = Math.max(1, requested);
  const edges: number[] = [sorted[0]!];
  for (let i = 1; i < k; i++) {
    const pos = (i / k) * (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const frac = pos - lo;
    const v = sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
    edges.push(v);
  }
  edges.push(sorted[n - 1]!);

  const deduped: number[] = [];
  for (const e of edges) {
    if (deduped.length === 0 || e > deduped[deduped.length - 1]!) deduped.push(e);
  }
  // A fully-constant series collapses to a single edge; widen it into one
  // degenerate [v, v] bin so downstream binning has a valid range.
  if (deduped.length === 1) deduped.push(deduped[0]!);
  return deduped;
}

/** Index of the bin `value` falls into, given ascending `edges` (length k+1). */
export function binIndex(value: number, edges: readonly number[]): number {
  const k = edges.length - 1;
  if (k <= 0) return 0;
  if (value <= edges[0]!) return 0;
  if (value >= edges[k]!) return k - 1;
  // Binary search for the last edge ≤ value.
  let lo = 0;
  let hi = k;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges[mid]! <= value) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, k - 1);
}

function shannonEntropyBits(counts: readonly number[], total: number): number {
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function summarizeSignalEntropy(
  samples: readonly EntropySample[],
  options: SignalEntropyOptions = {},
): SignalEntropySummary {
  const opts = { ...DEFAULTS, ...options };
  const points = toNumericPoints(samples);
  const values = points.map((p) => p.value);

  if (points.length === 0) {
    return {
      samples: 0,
      requestedBins: opts.bins,
      effectiveBins: 0,
      bins: [],
      entropyBits: 0,
      normalizedEntropy: 0,
      effectiveStates: 1,
      dominantBinFraction: 0,
      dominantBinIndex: null,
      changeRate: 0,
      rolling: [],
      minValue: null,
      maxValue: null,
    };
  }

  const edges = quantileEdges(values, opts.bins);
  const k = Math.max(1, edges.length - 1);
  const counts = new Array<number>(k).fill(0);
  const assignments = points.map((p) => {
    const idx = binIndex(p.value, edges);
    counts[idx] = (counts[idx] ?? 0) + 1;
    return idx;
  });

  const total = points.length;
  const effectiveBins = counts.filter((c) => c > 0).length;
  const entropyBits = shannonEntropyBits(counts, total);
  const normalizedEntropy = effectiveBins > 1 ? entropyBits / Math.log2(effectiveBins) : 0;
  const effectiveStates = Math.pow(2, entropyBits);

  let dominantBinIndex: number | null = null;
  let dominantCount = -1;
  counts.forEach((c, i) => {
    if (c > dominantCount) {
      dominantCount = c;
      dominantBinIndex = i;
    }
  });
  const dominantBinFraction = dominantCount > 0 ? dominantCount / total : 0;

  let transitions = 0;
  for (let i = 1; i < assignments.length; i++) {
    if (assignments[i] !== assignments[i - 1]) transitions += 1;
  }
  const changeRate = assignments.length > 1 ? transitions / (assignments.length - 1) : 0;

  const rolling: RollingEntropyPoint[] = [];
  const { rollingWindow, rollingStep } = opts;
  if (rollingWindow >= 2 && total >= rollingWindow) {
    for (let start = 0; start + rollingWindow <= total; start += rollingStep) {
      const windowAssignments = assignments.slice(start, start + rollingWindow);
      const windowCounts = new Array<number>(k).fill(0);
      for (const idx of windowAssignments) windowCounts[idx] = (windowCounts[idx] ?? 0) + 1;
      const windowEffective = windowCounts.filter((c) => c > 0).length;
      const bits = shannonEntropyBits(windowCounts, windowAssignments.length);
      const normalized = windowEffective > 1 ? bits / Math.log2(windowEffective) : 0;
      rolling.push({
        ms: points[start + rollingWindow - 1]!.ms,
        bits: Math.round(bits * 1000) / 1000,
        normalized: Math.round(normalized * 1000) / 1000,
      });
    }
  }

  const bins: EntropyBin[] = [];
  for (let i = 0; i < k; i++) {
    bins.push({ lo: edges[i]!, hi: edges[i + 1]!, count: counts[i] ?? 0 });
  }

  return {
    samples: total,
    requestedBins: opts.bins,
    effectiveBins,
    bins,
    entropyBits: Math.round(entropyBits * 1000) / 1000,
    normalizedEntropy: Math.round(normalizedEntropy * 1000) / 1000,
    effectiveStates: Math.round(effectiveStates * 100) / 100,
    dominantBinFraction: Math.round(dominantBinFraction * 1000) / 1000,
    dominantBinIndex,
    changeRate: Math.round(changeRate * 1000) / 1000,
    rolling,
    minValue: values.length > 0 ? Math.min(...values) : null,
    maxValue: values.length > 0 ? Math.max(...values) : null,
  };
}
