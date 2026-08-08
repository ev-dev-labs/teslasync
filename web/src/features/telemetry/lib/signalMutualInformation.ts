/**
 * Mutual-information analysis for two telemetry histories.
 *
 * Unlike linear correlation, mutual information measures repeatable
 * dependence between quantile states. Histories are first aligned onto a
 * median-derived common cadence, then compared with empirical joint and
 * marginal distributions. A deterministic permutation test supplies the
 * finite-sample noise floor.
 *
 * Pure and React-free.
 */

export interface MutualInformationSample {
  timestamp?: string;
  ts?: string;
  valueNum?: number | null;
  value_numeric?: number | null;
  valueBool?: boolean | null;
  value_bool?: boolean | null;
}

export interface TimedValue {
  ms: number;
  value: number;
}

export interface AlignedValue {
  ms: number;
  a: number;
  b: number;
}

export interface InformationCell {
  aBin: number;
  bBin: number;
  count: number;
  probability: number;
  contribution: number;
  aLow: number;
  aHigh: number;
  bLow: number;
  bHigh: number;
}

export interface MutualInformationResult {
  cadenceMs: number;
  alignedCount: number;
  binCount: number;
  entropyA: number;
  entropyB: number;
  jointEntropy: number;
  mutualInformation: number;
  normalizedMutualInformation: number;
  nullThreshold: number;
  permutationPValue: number;
  significant: boolean;
  cells: InformationCell[];
  aligned: Array<AlignedValue & { aBin: number; bBin: number }>;
}

export interface MutualInformationOptions {
  cadenceMs?: number;
  maxStaleCadences?: number;
  bins?: number;
  permutations?: number;
  seed?: number;
  minSamples?: number;
  significanceQuantile?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp01(probability) * (sorted.length - 1);
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower]! + ((sorted[lower + 1] ?? sorted[lower]!) - sorted[lower]!) * fraction;
}

export function toTimedValues(samples: readonly MutualInformationSample[]): TimedValue[] {
  const points: TimedValue[] = [];
  for (const sample of samples) {
    const timestamp = sample.timestamp ?? sample.ts;
    if (timestamp == null) continue;
    const numeric = sample.valueNum ?? sample.value_numeric;
    const boolean = sample.valueBool ?? sample.value_bool;
    const value =
      typeof numeric === 'number' && Number.isFinite(numeric)
        ? numeric
        : typeof boolean === 'boolean'
          ? boolean ? 1 : 0
          : null;
    const ms = Date.parse(timestamp);
    if (value == null || !Number.isFinite(ms)) continue;
    points.push({ ms, value });
  }
  points.sort((a, b) => a.ms - b.ms);
  const deduped: TimedValue[] = [];
  for (const point of points) {
    const prior = deduped[deduped.length - 1];
    if (prior?.ms === point.ms) prior.value = point.value;
    else deduped.push(point);
  }
  return deduped;
}

/** Median positive sampling interval, robust to an isolated reporting gap. */
export function robustCadence(points: readonly TimedValue[]): number {
  const intervals = points
    .slice(1)
    .map((point, index) => point.ms - points[index]!.ms)
    .filter((interval) => interval > 0 && Number.isFinite(interval));
  return median(intervals);
}

function nearestAt(
  points: readonly TimedValue[],
  ms: number,
  cursor: number,
  maxDistanceMs: number,
): { point: TimedValue | null; cursor: number } {
  let nextCursor = cursor;
  while (nextCursor + 1 < points.length && points[nextCursor + 1]!.ms <= ms) nextCursor += 1;
  const before = points[nextCursor];
  const after = points[nextCursor + 1];
  let nearest: TimedValue | undefined;
  if (before != null && after != null) {
    nearest = ms - before.ms <= after.ms - ms ? before : after;
  } else {
    nearest = before ?? after;
  }
  return {
    point: nearest != null && Math.abs(nearest.ms - ms) <= maxDistanceMs ? nearest : null,
    cursor: nextCursor,
  };
}

export function alignHistories(
  aSamples: readonly MutualInformationSample[],
  bSamples: readonly MutualInformationSample[],
  cadenceOverrideMs?: number,
  maxStaleCadences = 1.5,
): { cadenceMs: number; points: AlignedValue[] } {
  const a = toTimedValues(aSamples);
  const b = toTimedValues(bSamples);
  if (a.length < 2 || b.length < 2) return { cadenceMs: 0, points: [] };
  const cadenceMs = cadenceOverrideMs ?? Math.max(robustCadence(a), robustCadence(b));
  const start = Math.max(a[0]!.ms, b[0]!.ms);
  const end = Math.min(a[a.length - 1]!.ms, b[b.length - 1]!.ms);
  if (!Number.isFinite(cadenceMs) || cadenceMs <= 0 || end < start) {
    return { cadenceMs: 0, points: [] };
  }

  const points: AlignedValue[] = [];
  const maxDistance = cadenceMs * Math.max(0, maxStaleCadences);
  let aCursor = 0;
  let bCursor = 0;
  for (let ms = start; ms <= end; ms += cadenceMs) {
    const nearestA = nearestAt(a, ms, aCursor, maxDistance);
    const nearestB = nearestAt(b, ms, bCursor, maxDistance);
    aCursor = nearestA.cursor;
    bCursor = nearestB.cursor;
    if (nearestA.point != null && nearestB.point != null) {
      points.push({ ms, a: nearestA.point.value, b: nearestB.point.value });
    }
  }
  return { cadenceMs, points };
}

export function quantileBins(values: readonly number[], requestedBins: number): {
  assignments: number[];
  ranges: Array<{ low: number; high: number }>;
} {
  const bins = Math.max(2, Math.floor(requestedBins));
  const edges = Array.from({ length: bins - 1 }, (_, index) =>
    quantile(values, (index + 1) / bins),
  );
  const assignments = values.map((value) => {
    let bin = 0;
    while (bin < edges.length && value > edges[bin]!) bin += 1;
    return bin;
  });
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const ranges = Array.from({ length: bins }, (_, index) => ({
    low: index === 0 ? minimum : edges[index - 1]!,
    high: index === bins - 1 ? maximum : edges[index]!,
  }));
  return { assignments, ranges };
}

export function entropyOfBins(assignments: readonly number[], binCount: number): number {
  if (assignments.length === 0) return 0;
  const counts = Array.from({ length: binCount }, () => 0);
  for (const bin of assignments) counts[bin] = (counts[bin] ?? 0) + 1;
  return counts.reduce((entropy, count) => {
    if (count === 0) return entropy;
    const probability = count / assignments.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

export function informationFromBins(
  aBins: readonly number[],
  bBins: readonly number[],
  binCount: number,
): { entropyA: number; entropyB: number; jointEntropy: number; mutualInformation: number } {
  const total = Math.min(aBins.length, bBins.length);
  if (total === 0) {
    return { entropyA: 0, entropyB: 0, jointEntropy: 0, mutualInformation: 0 };
  }
  const joint = Array.from({ length: binCount * binCount }, () => 0);
  for (let index = 0; index < total; index += 1) {
    joint[aBins[index]! * binCount + bBins[index]!]! += 1;
  }
  const jointEntropy = entropyOfBins(
    joint.flatMap((count, index) => Array.from({ length: count }, () => index)),
    joint.length,
  );
  const entropyA = entropyOfBins(aBins.slice(0, total), binCount);
  const entropyB = entropyOfBins(bBins.slice(0, total), binCount);
  return {
    entropyA,
    entropyB,
    jointEntropy,
    mutualInformation: Math.max(0, entropyA + entropyB - jointEntropy),
  };
}

function normalizedInformation(aBins: readonly number[], bBins: readonly number[], bins: number): number {
  const information = informationFromBins(aBins, bBins, bins);
  const denominator = Math.sqrt(information.entropyA * information.entropyB);
  return denominator > 0 ? clamp01(information.mutualInformation / denominator) : 0;
}

/** Deterministic Fisher-Yates shuffle used by the permutation null model. */
export function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled;
}

export function analyzeSignalMutualInformation(
  aSamples: readonly MutualInformationSample[],
  bSamples: readonly MutualInformationSample[],
  options: MutualInformationOptions = {},
): MutualInformationResult | null {
  const binCount = Math.max(2, Math.floor(options.bins ?? 4));
  const aligned = alignHistories(
    aSamples,
    bSamples,
    options.cadenceMs,
    options.maxStaleCadences,
  );
  if (aligned.points.length < (options.minSamples ?? 20)) return null;

  const aQuantiles = quantileBins(aligned.points.map((point) => point.a), binCount);
  const bQuantiles = quantileBins(aligned.points.map((point) => point.b), binCount);
  const information = informationFromBins(
    aQuantiles.assignments,
    bQuantiles.assignments,
    binCount,
  );
  const normalizedMutualInformation = normalizedInformation(
    aQuantiles.assignments,
    bQuantiles.assignments,
    binCount,
  );
  const permutations = Math.max(0, Math.floor(options.permutations ?? 200));
  const seed = options.seed ?? 0x51a9d;
  const nullValues = Array.from({ length: permutations }, (_, index) =>
    normalizedInformation(
      aQuantiles.assignments,
      seededShuffle(bQuantiles.assignments, seed + index),
      binCount,
    ),
  ).sort((a, b) => a - b);
  const significanceQuantile = clamp01(options.significanceQuantile ?? 0.95);
  const thresholdIndex = Math.max(0, Math.ceil(significanceQuantile * nullValues.length) - 1);
  const nullThreshold = nullValues[thresholdIndex] ?? 0;
  const exceedances = nullValues.filter((value) => value >= normalizedMutualInformation).length;

  const aCounts = Array.from({ length: binCount }, () => 0);
  const bCounts = Array.from({ length: binCount }, () => 0);
  const jointCounts = Array.from({ length: binCount * binCount }, () => 0);
  for (let index = 0; index < aligned.points.length; index += 1) {
    const aBin = aQuantiles.assignments[index]!;
    const bBin = bQuantiles.assignments[index]!;
    aCounts[aBin]! += 1;
    bCounts[bBin]! += 1;
    jointCounts[aBin * binCount + bBin]! += 1;
  }
  const total = aligned.points.length;
  const cells = Array.from({ length: binCount * binCount }, (_, index) => {
    const aBin = Math.floor(index / binCount);
    const bBin = index % binCount;
    const count = jointCounts[index]!;
    const probability = count / total;
    const expected = (aCounts[aBin]! / total) * (bCounts[bBin]! / total);
    const contribution =
      probability > 0 && expected > 0 ? probability * Math.log2(probability / expected) : 0;
    return {
      aBin,
      bBin,
      count,
      probability: round(probability),
      contribution: round(contribution),
      aLow: aQuantiles.ranges[aBin]!.low,
      aHigh: aQuantiles.ranges[aBin]!.high,
      bLow: bQuantiles.ranges[bBin]!.low,
      bHigh: bQuantiles.ranges[bBin]!.high,
    };
  });

  return {
    cadenceMs: aligned.cadenceMs,
    alignedCount: total,
    binCount,
    entropyA: round(information.entropyA),
    entropyB: round(information.entropyB),
    jointEntropy: round(information.jointEntropy),
    mutualInformation: round(information.mutualInformation),
    normalizedMutualInformation: round(normalizedMutualInformation),
    nullThreshold: round(nullThreshold),
    permutationPValue: round((exceedances + 1) / (permutations + 1)),
    significant: normalizedMutualInformation > nullThreshold && permutations > 0,
    cells,
    aligned: aligned.points.map((point, index) => ({
      ...point,
      aBin: aQuantiles.assignments[index]!,
      bBin: bQuantiles.assignments[index]!,
    })),
  };
}
