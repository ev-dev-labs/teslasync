/**
 * Deadband analysis for numeric telemetry.
 *
 * The calculation is deliberately based on deltas rather than value entropy:
 * a deadband decides whether a new value is far enough from the last retained
 * value to emit. Candidate simulations therefore keep a running retained
 * value instead of filtering adjacent deltas independently.
 *
 * Pure and React-free.
 */

export interface DeadbandSample {
  timestamp?: string;
  ts?: string;
  valueNum?: number | null;
  value_numeric?: number | null;
}

export interface NumericDeadbandPoint {
  ms: number;
  value: number;
}

export interface DeadbandCandidate {
  threshold: number;
  retainedUpdates: number;
  reduction: number;
  noiseSuppression: number;
  materialRetention: number;
  fidelity: number;
}

export interface DeadbandAnalysis {
  sampleCount: number;
  updateCount: number;
  unchangedEmissionRatio: number;
  redundantEmissionRatio: number;
  deltaMedian: number;
  deltaMad: number;
  noiseScale: number;
  noiseThreshold: number;
  candidates: DeadbandCandidate[];
  recommended: DeadbandCandidate;
}

export interface DeadbandOptions {
  candidateThresholds?: readonly number[];
  targetNoiseSuppression?: number;
}

const MAD_TO_SIGMA = 1.4826;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function median(values: readonly number[]): number {
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

/** Sort, validate and timestamp-deduplicate the two supported history shapes. */
export function toNumericDeadbandSeries(
  samples: readonly DeadbandSample[],
): NumericDeadbandPoint[] {
  const points: NumericDeadbandPoint[] = [];
  for (const sample of samples) {
    const timestamp = sample.timestamp ?? sample.ts;
    const value = sample.valueNum ?? sample.value_numeric;
    if (timestamp == null || typeof value !== 'number' || !Number.isFinite(value)) continue;
    const ms = Date.parse(timestamp);
    if (!Number.isFinite(ms)) continue;
    points.push({ ms, value });
  }
  points.sort((a, b) => a.ms - b.ms);

  const deduped: NumericDeadbandPoint[] = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (previous?.ms === point.ms) previous.value = point.value;
    else deduped.push(point);
  }
  return deduped;
}

/**
 * Median-centred MAD estimate of signed delta noise.
 *
 * Centring the signed deltas prevents a genuine monotonic ramp from being
 * mistaken for noise merely because every absolute delta is non-zero.
 */
export function estimateDeltaNoise(values: readonly number[]): {
  deltaMedian: number;
  deltaMad: number;
  noiseScale: number;
  noiseThreshold: number;
} {
  const deltas = values.slice(1).map((value, index) => value - values[index]!);
  const deltaMedian = median(deltas);
  const deltaMad = median(deltas.map((delta) => Math.abs(delta - deltaMedian)));
  const noiseScale = MAD_TO_SIGMA * deltaMad;
  return {
    deltaMedian: round(deltaMedian),
    deltaMad: round(deltaMad),
    noiseScale: round(noiseScale),
    noiseThreshold: round(noiseScale * 3),
  };
}

/** Simulate a cumulative deadband against the last retained value. */
export function simulateDeadband(
  values: readonly number[],
  threshold: number,
  noiseThreshold: number,
): DeadbandCandidate {
  if (values.length === 0) {
    return {
      threshold: Math.max(0, threshold),
      retainedUpdates: 0,
      reduction: 0,
      noiseSuppression: 0,
      materialRetention: 0,
      fidelity: 0,
    };
  }

  const safeThreshold = Math.max(0, Number.isFinite(threshold) ? threshold : 0);
  const range = Math.max(...values) - Math.min(...values);
  const epsilon = Math.max(Number.EPSILON, range * 1e-12);
  const noiseCeiling = Math.max(noiseThreshold, epsilon);
  let retained = 1;
  let lastRetained = values[0]!;
  let squaredError = 0;
  let noisy = 0;
  let noisyRetained = 0;
  let material = 0;
  let materialRetained = 0;

  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    const adjacentDelta = Math.abs(value - values[index - 1]!);
    const emit = safeThreshold === 0 || Math.abs(value - lastRetained) >= safeThreshold;
    if (adjacentDelta <= noiseCeiling) noisy += 1;
    else material += 1;
    if (emit) {
      retained += 1;
      lastRetained = value;
      if (adjacentDelta <= noiseCeiling) noisyRetained += 1;
      else materialRetained += 1;
    }
    squaredError += (value - lastRetained) ** 2;
  }

  const robustSpan =
    quantile(values, 0.95) - quantile(values, 0.05) || range || Math.max(noiseCeiling, 1);
  const rmse = Math.sqrt(squaredError / values.length);
  return {
    threshold: round(safeThreshold),
    retainedUpdates: retained,
    reduction: round(1 - retained / values.length),
    noiseSuppression: round(noisy > 0 ? 1 - noisyRetained / noisy : 1),
    materialRetention: round(material > 0 ? materialRetained / material : 1),
    fidelity: round(clamp01(1 - rmse / robustSpan)),
  };
}

function buildThresholds(
  absoluteDeltas: readonly number[],
  noiseScale: number,
  supplied?: readonly number[],
): number[] {
  const raw = supplied ?? [
    0,
    ...[0.25, 0.5, 1, 1.5, 2, 3, 4, 6].map((factor) => noiseScale * factor),
    ...[0.25, 0.5, 0.75, 0.9, 0.95].map((q) => quantile(absoluteDeltas, q)),
  ];
  return [...new Set(raw.filter((value) => Number.isFinite(value) && value >= 0).map((v) => round(v)))]
    .sort((a, b) => a - b);
}

export function analyzeSignalDeadband(
  samples: readonly DeadbandSample[],
  options: DeadbandOptions = {},
): DeadbandAnalysis | null {
  const points = toNumericDeadbandSeries(samples);
  if (points.length < 3) return null;
  const values = points.map((point) => point.value);
  const deltas = values.slice(1).map((value, index) => value - values[index]!);
  const absoluteDeltas = deltas.map(Math.abs);
  const noise = estimateDeltaNoise(values);
  const range = Math.max(...values) - Math.min(...values);
  const epsilon = Math.max(Number.EPSILON, range * 1e-12);
  const unchanged = absoluteDeltas.filter((delta) => delta <= epsilon).length;
  const redundant = absoluteDeltas.filter(
    (delta) => delta <= Math.max(noise.noiseThreshold, epsilon),
  ).length;
  const candidates = buildThresholds(
    absoluteDeltas,
    noise.noiseScale,
    options.candidateThresholds,
  ).map((threshold) => simulateDeadband(values, threshold, noise.noiseThreshold));

  if (candidates.length === 0) return null;
  const target = clamp01(options.targetNoiseSuppression ?? 0.9);
  const score = (candidate: DeadbandCandidate) =>
    candidate.materialRetention * 0.55 +
    candidate.fidelity * 0.35 +
    candidate.reduction * 0.1 -
    Math.max(0, target - candidate.noiseSuppression) * 2;
  const targetCandidates = candidates.filter(
    (candidate) => candidate.noiseSuppression >= target,
  );
  const recommendationPool = targetCandidates.length > 0 ? targetCandidates : candidates;
  const recommended = recommendationPool.reduce((best, candidate) => {
    const delta = score(candidate) - score(best);
    if (delta > 1e-9) return candidate;
    if (Math.abs(delta) <= 1e-9 && candidate.threshold < best.threshold) return candidate;
    return best;
  });

  return {
    sampleCount: values.length,
    updateCount: deltas.length,
    unchangedEmissionRatio: round(unchanged / deltas.length),
    redundantEmissionRatio: round(redundant / deltas.length),
    ...noise,
    candidates,
    recommended,
  };
}
