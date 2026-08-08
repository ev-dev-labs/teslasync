/**
 * Deterministic cabin thermal evidence analysis.
 *
 * The model fits Newton cooling only to contiguous, HVAC-off windows:
 *
 *   T(t) = T_ambient + (T0 - T_ambient) * exp(-t / tau)
 *
 * This module deliberately keeps four populations separate:
 * returned API rows, normalized samples, candidate windows, and accepted
 * fits. A rejected candidate is diagnostic evidence about a gate; it is not
 * an observation supporting a thermal time constant.
 *
 * Pure, React-free, clock-free, and non-mutating.
 */

import { resolveHvacActive } from '@/lib/climateState';

/** Runtime-tolerant subset of the climate-history wire payload. */
export interface CabinSample {
  timestamp?: unknown;
  created_at?: unknown;
  insideTemp?: unknown;
  outsideTemp?: unknown;
  isAcOn?: unknown;
  hvacPower?: unknown;
}

export type CabinRowExclusionReason =
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'missing_inside_temperature'
  | 'nonfinite_inside_temperature'
  | 'missing_outside_temperature'
  | 'nonfinite_outside_temperature'
  | 'duplicate_timestamp';

export const CABIN_ROW_EXCLUSION_REASONS: readonly CabinRowExclusionReason[] = [
  'missing_timestamp',
  'invalid_timestamp',
  'missing_inside_temperature',
  'nonfinite_inside_temperature',
  'missing_outside_temperature',
  'nonfinite_outside_temperature',
  'duplicate_timestamp',
] as const;

export type CandidateRejectionReason =
  | 'insufficient_samples'
  | 'below_minimum_duration'
  | 'initial_gap_below_threshold'
  | 'ambient_crossing'
  | 'regression_unavailable'
  | 'non_relaxing_gap'
  | 'r2_below_gate'
  | 'invalid_tau';

/** Gate order is also the deterministic first-failure precedence. */
export const CANDIDATE_REJECTION_REASONS: readonly CandidateRejectionReason[] = [
  'insufficient_samples',
  'below_minimum_duration',
  'initial_gap_below_threshold',
  'ambient_crossing',
  'regression_unavailable',
  'non_relaxing_gap',
  'r2_below_gate',
  'invalid_tau',
] as const;

export type ThermalDirection = 'cooling' | 'warming' | 'indeterminate';

export interface CabinThermalOptions {
  /** A larger adjacent-sample gap ends a candidate, minutes. */
  maxGapMin?: number;
  /** Candidates shorter than this fail before regression, minutes. */
  minDurationMin?: number;
  /** Minimum normalized HVAC-off samples in a candidate. */
  minSamples?: number;
  /** Minimum absolute initial cabin-to-ambient gap, °C. */
  minDeltaC?: number;
  /** Minimum accepted coefficient of determination, 0–1. */
  minR2?: number;
  /** Entering this band around ambient counts as a crossing, °C. */
  ambientCrossingToleranceC?: number;
  /** Slopes at or above -epsilon are treated as non-relaxing, 1/min. */
  relaxingSlopeEpsilon?: number;
  /** Smallest physically usable fitted time constant, minutes. */
  minTauMin?: number;
  /** Largest physically usable fitted time constant, minutes. */
  maxTauMin?: number;
  /** Maximum candidates exposed in the newest-first display directory. */
  candidateDisplayCap?: number;
}

export interface CabinThermalThresholds {
  maxGapMin: number;
  minDurationMin: number;
  minSamples: number;
  minDeltaC: number;
  minR2: number;
  ambientCrossingToleranceC: number;
  relaxingSlopeEpsilon: number;
  minTauMin: number;
  maxTauMin: number;
  candidateDisplayCap: number;
}

export const CABIN_THERMAL_DEFAULTS: Readonly<CabinThermalThresholds> = {
  maxGapMin: 45,
  minDurationMin: 25,
  minSamples: 4,
  minDeltaC: 3,
  minR2: 0.8,
  ambientCrossingToleranceC: 0.2,
  relaxingSlopeEpsilon: 0.000001,
  minTauMin: 1,
  maxTauMin: 1_440,
  candidateDisplayCap: 50,
};

export interface NormalizedCabinSample {
  sourceIndex: number;
  ms: number;
  timestamp: string;
  insideC: number;
  outsideC: number;
  hvacOn: boolean | null;
}

export interface CabinRowExclusions
  extends Record<CabinRowExclusionReason, number> {
  total: number;
}

export interface CandidateWindow {
  id: string;
  index: number;
  startTs: string;
  endTs: string;
  startMs: number;
  endMs: number;
  samples: number;
  durationMin: number;
  startInsideC: number;
  endInsideC: number;
  ambientC: number | null;
  initialGapC: number | null;
  direction: ThermalDirection;
  slopePerMin: number | null;
  r2: number | null;
  /** May be negative for a widening gap; only accepted fits have valid τ. */
  tauMin: number | null;
  disposition: 'accepted' | 'rejected';
  reason: CandidateRejectionReason | null;
}

/** One accepted parked window with a valid fitted time constant. */
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
  /** True when the cabin began warmer than ambient. */
  cooling: boolean;
}

export interface CandidateReasonCount {
  reason: CandidateRejectionReason;
  count: number;
}

export type AcceptanceFunnelStage =
  | 'candidates'
  | 'sample_gate'
  | 'duration_gate'
  | 'initial_gap_gate'
  | 'crossing_gate'
  | 'regression_gate'
  | 'relaxation_gate'
  | 'r2_gate'
  | 'tau_gate';

export interface AcceptanceFunnelPoint {
  stage: AcceptanceFunnelStage;
  count: number;
}

export interface CandidateDirectory {
  /** Newest candidate first; full `candidates` remains chronological. */
  items: CandidateWindow[];
  total: number;
  displayed: number;
  omitted: number;
  cap: number;
}

export interface CabinThermalCoverage {
  earliestValidTs: string | null;
  latestValidTs: string | null;
  timespanMin: number | null;
  gapIntervals: number;
  medianCadenceMin: number | null;
  p90CadenceMin: number | null;
  maxObservedGapMin: number | null;
  longGapCount: number;
  longGapSegments: number;
  hvacOnSamples: number;
  hvacOffSamples: number;
  hvacUnknownSamples: number;
  hvacOnRuns: number;
  hvacUnknownRuns: number;
  hvacBoundaryCount: number;
}

export interface CabinThermalAccounting {
  returnedRows: number;
  excludedRows: number;
  normalizedRows: number;
  hvacOnRows: number;
  hvacUnknownRows: number;
  candidateSampleRows: number;
  candidateWindows: number;
  acceptedFits: number;
  rejectedCandidates: number;
}

export interface CabinThermalSummary {
  /** Accepted fits only, chronological. */
  events: SoakEvent[];
  /** Every candidate, chronological, accepted or rejected. */
  candidates: CandidateWindow[];
  /** Valid, deduplicated rows, chronological. */
  normalizedSamples: NormalizedCabinSample[];
  accounting: CabinThermalAccounting;
  rowExclusions: CabinRowExclusions;
  rejectionReasonCounts: CandidateReasonCount[];
  candidateDirectory: CandidateDirectory;
  acceptanceFunnel: AcceptanceFunnelPoint[];
  thresholds: CabinThermalThresholds;
  coverage: CabinThermalCoverage;
  /** Median τ across accepted fits, minutes. */
  tauMin: number | null;
  coolingTauMin: number | null;
  warmingTauMin: number | null;
  halfLifeMin: number | null;
  meanR2: number | null;
  /** Compatibility aliases retained for existing consumers. */
  analyzedSamples: number;
  rejectedWindows: number;
  rawReturnedRows: number;
}

const MS_PER_MIN = 60_000;

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function finiteNonNegative(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function resolveThresholds(
  options: CabinThermalOptions,
): CabinThermalThresholds {
  const minTauMin = finitePositive(
    options.minTauMin,
    CABIN_THERMAL_DEFAULTS.minTauMin,
  );
  const requestedMaxTau = finitePositive(
    options.maxTauMin,
    CABIN_THERMAL_DEFAULTS.maxTauMin,
  );
  return {
    maxGapMin: finitePositive(
      options.maxGapMin,
      CABIN_THERMAL_DEFAULTS.maxGapMin,
    ),
    minDurationMin: finiteNonNegative(
      options.minDurationMin,
      CABIN_THERMAL_DEFAULTS.minDurationMin,
    ),
    minSamples:
      typeof options.minSamples === 'number'
      && Number.isFinite(options.minSamples)
      && options.minSamples >= 1
        ? Math.floor(options.minSamples)
        : CABIN_THERMAL_DEFAULTS.minSamples,
    minDeltaC: finiteNonNegative(
      options.minDeltaC,
      CABIN_THERMAL_DEFAULTS.minDeltaC,
    ),
    minR2:
      typeof options.minR2 === 'number' && Number.isFinite(options.minR2)
        ? Math.min(1, Math.max(0, options.minR2))
        : CABIN_THERMAL_DEFAULTS.minR2,
    ambientCrossingToleranceC: finiteNonNegative(
      options.ambientCrossingToleranceC,
      CABIN_THERMAL_DEFAULTS.ambientCrossingToleranceC,
    ),
    relaxingSlopeEpsilon: finiteNonNegative(
      options.relaxingSlopeEpsilon,
      CABIN_THERMAL_DEFAULTS.relaxingSlopeEpsilon,
    ),
    minTauMin,
    maxTauMin: Math.max(minTauMin, requestedMaxTau),
    candidateDisplayCap:
      typeof options.candidateDisplayCap === 'number'
      && Number.isFinite(options.candidateDisplayCap)
      && options.candidateDisplayCap >= 1
        ? Math.floor(options.candidateDisplayCap)
        : CABIN_THERMAL_DEFAULTS.candidateDisplayCap,
  };
}

function emptyExclusions(): CabinRowExclusions {
  return {
    missing_timestamp: 0,
    invalid_timestamp: 0,
    missing_inside_temperature: 0,
    nonfinite_inside_temperature: 0,
    missing_outside_temperature: 0,
    nonfinite_outside_temperature: 0,
    duplicate_timestamp: 0,
    total: 0,
  };
}

function exclude(
  counts: CabinRowExclusions,
  reason: CabinRowExclusionReason,
): void {
  counts[reason] += 1;
  counts.total += 1;
}

function normalize(
  samples: readonly CabinSample[],
): {
  rows: NormalizedCabinSample[];
  exclusions: CabinRowExclusions;
} {
  const exclusions = emptyExclusions();
  const provisional: NormalizedCabinSample[] = [];

  for (let sourceIndex = 0; sourceIndex < samples.length; sourceIndex += 1) {
    const sample = samples[sourceIndex];
    if (sample == null || typeof sample !== 'object') {
      exclude(exclusions, 'missing_timestamp');
      continue;
    }
    const timestamp = sample.timestamp ?? sample.created_at;
    if (timestamp == null) {
      exclude(exclusions, 'missing_timestamp');
      continue;
    }
    if (typeof timestamp !== 'string') {
      exclude(exclusions, 'invalid_timestamp');
      continue;
    }
    const ms = new Date(timestamp).getTime();
    if (!Number.isFinite(ms)) {
      exclude(exclusions, 'invalid_timestamp');
      continue;
    }
    if (sample.insideTemp == null) {
      exclude(exclusions, 'missing_inside_temperature');
      continue;
    }
    if (
      typeof sample.insideTemp !== 'number'
      || !Number.isFinite(sample.insideTemp)
    ) {
      exclude(exclusions, 'nonfinite_inside_temperature');
      continue;
    }
    if (sample.outsideTemp == null) {
      exclude(exclusions, 'missing_outside_temperature');
      continue;
    }
    if (
      typeof sample.outsideTemp !== 'number'
      || !Number.isFinite(sample.outsideTemp)
    ) {
      exclude(exclusions, 'nonfinite_outside_temperature');
      continue;
    }

    provisional.push({
      sourceIndex,
      ms,
      timestamp: new Date(ms).toISOString(),
      insideC: sample.insideTemp,
      outsideC: sample.outsideTemp,
      hvacOn: resolveHvacActive(sample.hvacPower, sample.isAcOn),
    });
  }

  provisional.sort((a, b) => a.ms - b.ms || a.sourceIndex - b.sourceIndex);
  const rows: NormalizedCabinSample[] = [];
  let previousMs: number | null = null;
  for (const row of provisional) {
    if (previousMs === row.ms) {
      exclude(exclusions, 'duplicate_timestamp');
      continue;
    }
    rows.push(row);
    previousMs = row.ms;
  }
  return { rows, exclusions };
}

function rounded(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** OLS of y on x returning a finite slope and R². */
function regress(
  xs: readonly number[],
  ys: readonly number[],
): { slope: number; r2: number } | null {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  let sx = 0;
  let sy = 0;
  for (let index = 0; index < n; index += 1) {
    const x = xs[index]!;
    const y = ys[index]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    sx += x;
    sy += y;
  }
  const meanX = sx / n;
  const meanY = sy / n;
  if (!Number.isFinite(meanX) || !Number.isFinite(meanY)) return null;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = xs[index]! - meanX;
    const dy = ys[index]! - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (
    !Number.isFinite(sxy)
    || !Number.isFinite(sxx)
    || !Number.isFinite(syy)
    || sxx <= 0
    || syy <= 0
  ) {
    return null;
  }
  const slope = sxy / sxx;
  const rawR2 = (sxy * sxy) / (sxx * syy);
  if (!Number.isFinite(slope) || !Number.isFinite(rawR2)) return null;
  return { slope, r2: Math.min(1, Math.max(0, rawR2)) };
}

function rejected(
  base: CandidateWindow,
  reason: CandidateRejectionReason,
  derived: Partial<
    Pick<
      CandidateWindow,
      'ambientC' | 'initialGapC' | 'direction' | 'slopePerMin' | 'r2' | 'tauMin'
    >
  > = {},
): CandidateWindow {
  return {
    ...base,
    ...derived,
    disposition: 'rejected',
    reason,
  };
}

function evaluateCandidate(
  run: readonly NormalizedCabinSample[],
  index: number,
  thresholds: CabinThermalThresholds,
): CandidateWindow {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const durationMin = (last.ms - first.ms) / MS_PER_MIN;
  const base: CandidateWindow = {
    id: `candidate-${index}`,
    index,
    startTs: first.timestamp,
    endTs: last.timestamp,
    startMs: first.ms,
    endMs: last.ms,
    samples: run.length,
    durationMin: rounded(durationMin, 3),
    startInsideC: rounded(first.insideC, 3),
    endInsideC: rounded(last.insideC, 3),
    ambientC: null,
    initialGapC: null,
    direction: 'indeterminate',
    slopePerMin: null,
    r2: null,
    tauMin: null,
    disposition: 'rejected',
    reason: null,
  };

  let ambientC = 0;
  for (let sampleIndex = 0; sampleIndex < run.length; sampleIndex += 1) {
    ambientC += (run[sampleIndex]!.outsideC - ambientC) / (sampleIndex + 1);
  }
  const startDelta = first.insideC - ambientC;
  const hasFiniteInitial =
    Number.isFinite(ambientC) && Number.isFinite(startDelta);
  const direction: ThermalDirection = !hasFiniteInitial
    ? 'indeterminate'
    : startDelta > 0
      ? 'cooling'
      : startDelta < 0
        ? 'warming'
        : 'indeterminate';
  const initial = hasFiniteInitial
    ? {
        ambientC: rounded(ambientC, 3),
        initialGapC: rounded(startDelta, 3),
        direction,
      } as const
    : {};

  if (run.length < thresholds.minSamples) {
    return rejected(base, 'insufficient_samples', initial);
  }
  if (durationMin < thresholds.minDurationMin) {
    return rejected(base, 'below_minimum_duration', initial);
  }
  if (!Number.isFinite(ambientC) || !Number.isFinite(startDelta)) {
    return rejected(base, 'regression_unavailable');
  }
  if (Math.abs(startDelta) < thresholds.minDeltaC) {
    return rejected(base, 'initial_gap_below_threshold', initial);
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const row of run) {
    const delta = row.insideC - ambientC;
    if (!Number.isFinite(delta)) {
      return rejected(base, 'regression_unavailable', initial);
    }
    const crossed =
      direction === 'cooling'
        ? delta <= thresholds.ambientCrossingToleranceC
        : delta >= -thresholds.ambientCrossingToleranceC;
    if (crossed) return rejected(base, 'ambient_crossing', initial);
    const logGap = Math.log(Math.abs(delta));
    if (!Number.isFinite(logGap)) {
      return rejected(base, 'regression_unavailable', initial);
    }
    xs.push((row.ms - first.ms) / MS_PER_MIN);
    ys.push(logGap);
  }

  const fit = regress(xs, ys);
  if (fit == null) return rejected(base, 'regression_unavailable', initial);
  const rawTau = fit.slope === 0 ? null : -1 / fit.slope;
  const fitDetails = {
    ...initial,
    slopePerMin: rounded(fit.slope, 8),
    r2: rounded(fit.r2, 4),
    tauMin:
      rawTau != null && Number.isFinite(rawTau) ? rounded(rawTau, 3) : null,
  } as const;
  if (fit.slope >= -thresholds.relaxingSlopeEpsilon) {
    return rejected(base, 'non_relaxing_gap', fitDetails);
  }
  if (fit.r2 < thresholds.minR2) {
    return rejected(base, 'r2_below_gate', fitDetails);
  }
  if (
    rawTau == null
    || !Number.isFinite(rawTau)
    || rawTau < thresholds.minTauMin
    || rawTau > thresholds.maxTauMin
  ) {
    return rejected(base, 'invalid_tau', fitDetails);
  }
  return {
    ...base,
    ...fitDetails,
    disposition: 'accepted',
    reason: null,
  };
}

function candidateToEvent(candidate: CandidateWindow): SoakEvent | null {
  if (
    candidate.disposition !== 'accepted'
    || candidate.ambientC == null
    || candidate.tauMin == null
    || candidate.r2 == null
    || candidate.direction === 'indeterminate'
  ) {
    return null;
  }
  return {
    startTs: candidate.startTs,
    endTs: candidate.endTs,
    startMs: candidate.startMs,
    durationMin: Math.round(candidate.durationMin),
    samples: candidate.samples,
    startInsideC: rounded(candidate.startInsideC, 1),
    endInsideC: rounded(candidate.endInsideC, 1),
    ambientC: rounded(candidate.ambientC, 1),
    tauMin: Math.round(candidate.tauMin),
    r2: rounded(candidate.r2, 3),
    cooling: candidate.direction === 'cooling',
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2
    : sorted[midpoint]!;
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function medianRounded(values: readonly number[]): number | null {
  const value = median(values);
  return value == null ? null : Math.round(value);
}

interface CoreAnalysis {
  rows: NormalizedCabinSample[];
  exclusions: CabinRowExclusions;
  candidates: CandidateWindow[];
  events: SoakEvent[];
  thresholds: CabinThermalThresholds;
  coverage: CabinThermalCoverage;
}

function analyzeCore(
  samples: readonly CabinSample[],
  options: CabinThermalOptions,
): CoreAnalysis {
  const thresholds = resolveThresholds(options);
  const { rows, exclusions } = normalize(samples);
  const candidates: CandidateWindow[] = [];
  let window: NormalizedCabinSample[] = [];

  const flush = () => {
    if (window.length === 0) return;
    candidates.push(
      evaluateCandidate(window, candidates.length + 1, thresholds),
    );
    window = [];
  };

  for (const row of rows) {
    if (row.hvacOn !== false) {
      flush();
      continue;
    }
    const previous = window[window.length - 1];
    if (
      previous
      && (row.ms - previous.ms) / MS_PER_MIN > thresholds.maxGapMin
    ) {
      flush();
    }
    window.push(row);
  }
  flush();

  const gaps: number[] = [];
  let longGapCount = 0;
  let hvacBoundaryCount = 0;
  let hvacOnRuns = 0;
  let hvacUnknownRuns = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const previous = rows[index - 1];
    const gapMin = previous ? (row.ms - previous.ms) / MS_PER_MIN : null;
    if (gapMin != null) {
      gaps.push(gapMin);
      if (gapMin > thresholds.maxGapMin) longGapCount += 1;
      if (
        gapMin <= thresholds.maxGapMin
        && previous
        && previous.hvacOn != null
        && row.hvacOn != null
        && previous.hvacOn !== row.hvacOn
      ) {
        hvacBoundaryCount += 1;
      }
    }
    if (
      row.hvacOn === true
      && (
        previous == null
        || previous.hvacOn !== true
        || (gapMin != null && gapMin > thresholds.maxGapMin)
      )
    ) {
      hvacOnRuns += 1;
    }
    if (
      row.hvacOn == null
      && (
        previous == null
        || previous.hvacOn != null
        || (gapMin != null && gapMin > thresholds.maxGapMin)
      )
    ) {
      hvacUnknownRuns += 1;
    }
  }

  const hvacOnSamples = rows.filter((row) => row.hvacOn === true).length;
  const hvacOffSamples = rows.filter((row) => row.hvacOn === false).length;
  const hvacUnknownSamples = rows.length - hvacOnSamples - hvacOffSamples;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const events = candidates
    .map(candidateToEvent)
    .filter((event): event is SoakEvent => event != null);
  return {
    rows,
    exclusions,
    candidates,
    events,
    thresholds,
    coverage: {
      earliestValidTs: first?.timestamp ?? null,
      latestValidTs: last?.timestamp ?? null,
      timespanMin:
        first && last ? rounded((last.ms - first.ms) / MS_PER_MIN, 3) : null,
      gapIntervals: gaps.length,
      medianCadenceMin:
        median(gaps) == null ? null : rounded(median(gaps)!, 3),
      p90CadenceMin:
        percentile(gaps, 0.9) == null
          ? null
          : rounded(percentile(gaps, 0.9)!, 3),
      maxObservedGapMin:
        gaps.length > 0 ? rounded(Math.max(...gaps), 3) : null,
      longGapCount,
      longGapSegments: rows.length > 0 ? longGapCount + 1 : 0,
      hvacOnSamples,
      hvacOffSamples,
      hvacUnknownSamples,
      hvacOnRuns,
      hvacUnknownRuns,
      hvacBoundaryCount,
    },
  };
}

function buildReasonCounts(
  candidates: readonly CandidateWindow[],
): CandidateReasonCount[] {
  return CANDIDATE_REJECTION_REASONS.map((reason) => ({
    reason,
    count: candidates.filter((candidate) => candidate.reason === reason).length,
  }));
}

function buildFunnel(
  totalCandidates: number,
  reasonCounts: readonly CandidateReasonCount[],
): AcceptanceFunnelPoint[] {
  const count = (reason: CandidateRejectionReason) =>
    reasonCounts.find((item) => item.reason === reason)?.count ?? 0;
  let remaining = totalCandidates;
  const points: AcceptanceFunnelPoint[] = [
    { stage: 'candidates', count: remaining },
  ];
  const gates: readonly [
    AcceptanceFunnelStage,
    CandidateRejectionReason,
  ][] = [
    ['sample_gate', 'insufficient_samples'],
    ['duration_gate', 'below_minimum_duration'],
    ['initial_gap_gate', 'initial_gap_below_threshold'],
    ['crossing_gate', 'ambient_crossing'],
    ['regression_gate', 'regression_unavailable'],
    ['relaxation_gate', 'non_relaxing_gap'],
    ['r2_gate', 'r2_below_gate'],
    ['tau_gate', 'invalid_tau'],
  ];
  for (const [stage, reason] of gates) {
    remaining -= count(reason);
    points.push({ stage, count: remaining });
  }
  return points;
}

/**
 * Compatibility fitting surface. New consumers should prefer
 * `summarizeCabinThermal`, which exposes exact accounting and diagnostics.
 */
export function fitSoakEvents(
  samples: readonly CabinSample[],
  options: CabinThermalOptions = {},
): { events: SoakEvent[]; rejected: number; analyzed: number } {
  const core = analyzeCore(samples, options);
  return {
    events: core.events,
    rejected: core.candidates.length - core.events.length,
    analyzed: core.rows.length,
  };
}

export function summarizeCabinThermal(
  samples: readonly CabinSample[],
  options: CabinThermalOptions = {},
): CabinThermalSummary {
  const core = analyzeCore(samples, options);
  const rejectionReasonCounts = buildReasonCounts(core.candidates);
  const rejectedCandidates = core.candidates.length - core.events.length;
  const tau = median(core.events.map((event) => event.tauMin));
  const directoryItems = [...core.candidates]
    .reverse()
    .slice(0, core.thresholds.candidateDisplayCap);

  return {
    events: core.events,
    candidates: core.candidates,
    normalizedSamples: core.rows,
    accounting: {
      returnedRows: samples.length,
      excludedRows: core.exclusions.total,
      normalizedRows: core.rows.length,
      hvacOnRows: core.coverage.hvacOnSamples,
      hvacUnknownRows: core.coverage.hvacUnknownSamples,
      candidateSampleRows: core.coverage.hvacOffSamples,
      candidateWindows: core.candidates.length,
      acceptedFits: core.events.length,
      rejectedCandidates,
    },
    rowExclusions: core.exclusions,
    rejectionReasonCounts,
    candidateDirectory: {
      items: directoryItems,
      total: core.candidates.length,
      displayed: directoryItems.length,
      omitted: core.candidates.length - directoryItems.length,
      cap: core.thresholds.candidateDisplayCap,
    },
    acceptanceFunnel: buildFunnel(
      core.candidates.length,
      rejectionReasonCounts,
    ),
    thresholds: core.thresholds,
    coverage: core.coverage,
    tauMin: tau == null ? null : Math.round(tau),
    coolingTauMin: medianRounded(
      core.events.filter((event) => event.cooling).map((event) => event.tauMin),
    ),
    warmingTauMin: medianRounded(
      core.events.filter((event) => !event.cooling).map((event) => event.tauMin),
    ),
    halfLifeMin: tau == null ? null : Math.round(tau * Math.LN2),
    meanR2:
      core.events.length > 0
        ? rounded(
            core.events.reduce((sum, event) => sum + event.r2, 0)
              / core.events.length,
            3,
          )
        : null,
    analyzedSamples: core.rows.length,
    rejectedWindows: rejectedCandidates,
    rawReturnedRows: samples.length,
  };
}

/** Cabin temperature after `minutes` of passive soaking. */
export function predictCabinTemp(
  insideC: number,
  ambientC: number,
  tauMin: number,
  minutes: number,
): number {
  if (!Number.isFinite(tauMin) || tauMin <= 0) return insideC;
  return ambientC + (insideC - ambientC) * Math.exp(-minutes / tauMin);
}

/** Minutes until a passive soak first reaches `targetC`, or null if unreachable. */
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
  if (
    Math.sign(target) !== Math.sign(start)
    || Math.abs(target) >= Math.abs(start)
  ) {
    return null;
  }
  return Math.round(tauMin * Math.log(Math.abs(start) / Math.abs(target)));
}

export interface SoakCurvePoint {
  minutes: number;
  cabinC: number;
}

/** Build an SI-Celsius passive-soak curve for rendering at the unit boundary. */
export function buildSoakCurve(
  insideC: number,
  ambientC: number,
  tauMin: number,
  horizonMin: number,
  stepMin = 15,
): SoakCurvePoint[] {
  const out: SoakCurvePoint[] = [];
  if (
    !Number.isFinite(tauMin)
    || tauMin <= 0
    || !Number.isFinite(horizonMin)
    || horizonMin < 0
    || !Number.isFinite(stepMin)
    || stepMin <= 0
  ) {
    return out;
  }
  for (let minutes = 0; minutes <= horizonMin; minutes += stepMin) {
    out.push({
      minutes,
      cabinC: rounded(
        predictCabinTemp(insideC, ambientC, tauMin, minutes),
        1,
      ),
    });
  }
  return out;
}
