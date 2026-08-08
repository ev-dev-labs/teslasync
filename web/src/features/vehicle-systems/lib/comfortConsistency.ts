/**
 * Evidence accounting for active-HVAC comfort consistency.
 *
 * Temperatures remain canonical Celsius and durations remain SI seconds.
 * Returned rows are classified before analysis so missing thermal evidence,
 * unknown HVAC state, duplicates, and inactive samples cannot disappear from
 * the denominator or bridge stabilization fragments.
 */

import { normalizeHvacOn, type HvacSignalSample } from './hvacCycling';

export interface ComfortSample extends HvacSignalSample {
  insideTemp?: number | null;
  driverTempSetting?: number | null;
  passengerTempSetting?: number | null;
}

export type ComfortRunBoundary =
  | 'dataset_edge'
  | 'hvac_inactive'
  | 'missing_evidence'
  | 'long_gap'
  | 'target_shift';

export type ComfortRunDirection = 'hot' | 'cold' | 'in_band';

export interface ComfortActiveRun {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  samples: number;
  sampleSpanS: number;
  direction: ComfortRunDirection;
  startDeviationC: number;
  endDeviationC: number;
  startTargetC: number;
  endTargetC: number;
  timeToBandS: number | null;
  overshootC: number;
  leftBoundary: ComfortRunBoundary;
  rightBoundary: ComfortRunBoundary;
  rightCensored: boolean;
}

export type StabilizationWindow = ComfortActiveRun & {
  direction: 'hot' | 'cold';
};

export interface OvershootBin {
  lowerC: number;
  upperC: number | null;
  windows: number;
  share: number;
}

export interface ComfortDeviationBin {
  lowerC: number;
  upperC: number | null;
  samples: number;
  share: number;
}

export interface ComfortRowAccounting {
  returnedRows: number;
  invalidRowRows: number;
  missingTimestampRows: number;
  invalidTimestampRows: number;
  timestampValidRows: number;
  duplicateTimestampRows: number;
  uniqueTimestampRows: number;
  unknownHvacRows: number;
  hvacOffRows: number;
  missingInsideTempRows: number;
  missingSetpointRows: number;
  analyzedRows: number;
}

export interface ComfortSourceCoverage {
  denominatorRows: number;
  insideTempRows: number;
  driverSetpointRows: number;
  passengerSetpointRows: number;
  anySetpointRows: number;
  pairedSetpointRows: number;
  singleSetpointRows: number;
  knownHvacRows: number;
  activeHvacRows: number;
  thermallyCompleteRows: number;
}

export interface ComfortCoverage {
  earliestValidMs: number | null;
  latestValidMs: number | null;
  spanS: number;
  cadenceIntervals: number;
  medianGapS: number | null;
  p90GapS: number | null;
  maxObservedGapS: number | null;
  longGapCount: number;
  stateCoverage: number | null;
  analyticCoverage: number | null;
}

export interface ComfortIntervalAccounting {
  candidateAdjacentPairs: number;
  observedActiveIntervals: number;
  longGapExclusions: number;
  inactiveStartIntervals: number;
  evidenceBarrierIntervals: number;
  nonpositiveIntervals: number;
  terminalSamples: number;
}

export interface ComfortIntervalComposition {
  observedActiveS: number;
  belowBandS: number;
  withinBandS: number;
  aboveBandS: number;
  withinBandShare: number | null;
  durationWeightedMeanAbsDeviationC: number | null;
}

export interface ComfortHourlyBucket {
  hour: number;
  observedS: number;
  belowBandS: number;
  withinBandS: number;
  aboveBandS: number;
  withinBandShare: number | null;
  meanAbsDeviationC: number | null;
}

export interface ComfortScoreBreakdown {
  bandAdherence: number | null;
  deviationScore: number | null;
  agreementScore: number;
  stabilizationScore: number;
  deviationZeroC: number;
  agreementZeroC: number;
  stabilizationZeroS: number;
  fullSampleConfidenceAt: number;
  fullWindowConfidenceAt: number;
  rawScore: number | null;
  sampleConfidence: number;
  windowConfidence: number;
  confidence: number;
  adjustedScore: number | null;
}

export interface ComfortBoundaryAccounting {
  datasetEdges: number;
  hvacInactiveBoundaries: number;
  missingEvidenceBoundaries: number;
  longGapBoundaries: number;
  targetShiftBoundaries: number;
}

export interface ComfortIdentities {
  rowsBalanced: boolean;
  timestampsBalanced: boolean;
  timelineBalanced: boolean;
  intervalsBalanced: boolean;
  intervalDurationBalanced: boolean;
  activeFragmentsBalanced: boolean;
  windowOutcomesBalanced: boolean;
}

export interface ComfortWindowDirectory {
  total: number;
  displayed: number;
  omitted: number;
  cap: number;
  items: StabilizationWindow[];
}

export interface ComfortConsistencyOptions {
  comfortBandC?: number;
  maxGapS?: number;
  sustainSamples?: number;
  maxTargetShiftC?: number;
  setpointDisagreementC?: number;
  windowDisplayLimit?: number;
}

export interface ComfortConsistencySummary {
  rows: ComfortRowAccounting;
  sources: ComfortSourceCoverage;
  coverage: ComfortCoverage;
  intervals: ComfortIntervalAccounting;
  intervalComposition: ComfortIntervalComposition;
  hourlyProfile: ComfortHourlyBucket[];
  activeRuns: ComfortActiveRun[];
  activeRunCount: number;
  insideBandStartRuns: number;
  stabilizationWindows: StabilizationWindow[];
  stabilizedWindows: number;
  unstabilizedWindows: number;
  censoredUnstabilizedWindows: number;
  hotStartWindows: number;
  coldStartWindows: number;
  analyzedSamples: number;
  withinComfortBandShare: number | null;
  meanAbsDeviationC: number | null;
  medianAbsDeviationC: number | null;
  p90AbsDeviationC: number | null;
  durationWeightedMeanAbsDeviationC: number | null;
  pairedSetpointAnalyzedSamples: number;
  singleSetpointAnalyzedSamples: number;
  meanSetpointDisagreementC: number | null;
  medianSetpointDisagreementC: number | null;
  p90SetpointDisagreementC: number | null;
  disagreementSampleShare: number | null;
  medianStabilizationS: number | null;
  medianOvershootC: number | null;
  overshootDistribution: OvershootBin[];
  deviationDistribution: ComfortDeviationBin[];
  score: ComfortScoreBreakdown;
  consistencyScore: number | null;
  confidence: number;
  thresholds: Required<ComfortConsistencyOptions>;
  boundaryAccounting: ComfortBoundaryAccounting;
  windowDirectory: ComfortWindowDirectory;
  identities: ComfortIdentities;
}

type ComfortRowOutcome =
  | 'unknown_hvac'
  | 'hvac_off'
  | 'missing_inside'
  | 'missing_setpoint'
  | 'analyzed';

interface NormalizedComfortRow {
  ms: number;
  insideC: number | null;
  driverC: number | null;
  passengerC: number | null;
  targetC: number | null;
  deviationC: number | null;
  disagreementC: number | null;
  hvacOn: boolean | null;
  outcome: ComfortRowOutcome;
}

type AnalyzedComfortRow = NormalizedComfortRow & {
  insideC: number;
  targetC: number;
  deviationC: number;
  outcome: 'analyzed';
};

interface NormalizationResult {
  timeline: NormalizedComfortRow[];
  rows: ComfortRowAccounting;
  sources: ComfortSourceCoverage;
}

interface IntervalResult {
  accounting: ComfortIntervalAccounting;
  composition: ComfortIntervalComposition;
  hourly: ComfortHourlyBucket[];
}

interface ActiveRunDraft {
  rows: AnalyzedComfortRow[];
  leftBoundary: ComfortRunBoundary;
}

export const DEFAULT_COMFORT_BAND_C = 1.5;
export const DEFAULT_COMFORT_MAX_GAP_S = 30 * 60;
export const DEFAULT_COMFORT_SUSTAIN_SAMPLES = 2;
export const DEFAULT_COMFORT_MAX_TARGET_SHIFT_C = 2;
export const DEFAULT_SETPOINT_DISAGREEMENT_C = 1;
export const DEFAULT_COMFORT_WINDOW_DISPLAY_LIMIT = 80;
export const MAX_COMFORT_WINDOW_DISPLAY_LIMIT = 200;

const DEFAULTS: Required<ComfortConsistencyOptions> = {
  comfortBandC: DEFAULT_COMFORT_BAND_C,
  maxGapS: DEFAULT_COMFORT_MAX_GAP_S,
  sustainSamples: DEFAULT_COMFORT_SUSTAIN_SAMPLES,
  maxTargetShiftC: DEFAULT_COMFORT_MAX_TARGET_SHIFT_C,
  setpointDisagreementC: DEFAULT_SETPOINT_DISAGREEMENT_C,
  windowDisplayLimit: DEFAULT_COMFORT_WINDOW_DISPLAY_LIMIT,
};

const OVERSHOOT_EDGES = [0, 0.5, 1, 2] as const;
const SCORE_DEVIATION_ZERO_C = 5;
const SCORE_AGREEMENT_ZERO_C = 4;
const SCORE_STABILIZATION_ZERO_S = 45 * 60;
const FULL_SAMPLE_CONFIDENCE_AT = 80;
const FULL_WINDOW_CONFIDENCE_AT = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function percentile(
  values: readonly number[],
  proportion: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const bounded = Math.max(0, Math.min(1, proportion));
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * bounded) - 1),
  );
  return sorted[index]!;
}

function positiveOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function resolveOptions(
  options: ComfortConsistencyOptions | null | undefined,
): Required<ComfortConsistencyOptions> {
  const source = isRecord(options) ? options : {};
  const sustainSamples = Math.min(
    50,
    Math.max(
      1,
      Math.floor(
        positiveOption(
          source.sustainSamples,
          DEFAULTS.sustainSamples,
        ),
      ),
    ),
  );
  const windowDisplayLimit = Math.min(
    MAX_COMFORT_WINDOW_DISPLAY_LIMIT,
    Math.max(
      1,
      Math.floor(
        positiveOption(
          source.windowDisplayLimit,
          DEFAULTS.windowDisplayLimit,
        ),
      ),
    ),
  );
  return {
    comfortBandC: positiveOption(
      source.comfortBandC,
      DEFAULTS.comfortBandC,
    ),
    maxGapS: positiveOption(source.maxGapS, DEFAULTS.maxGapS),
    sustainSamples,
    maxTargetShiftC: positiveOption(
      source.maxTargetShiftC,
      DEFAULTS.maxTargetShiftC,
    ),
    setpointDisagreementC: positiveOption(
      source.setpointDisagreementC,
      DEFAULTS.setpointDisagreementC,
    ),
    windowDisplayLimit,
  };
}

function parseTimestamp(
  record: Record<string, unknown>,
): { kind: 'missing' | 'invalid' | 'valid'; ms: number | null } {
  const candidates = [record.timestamp, record.created_at];
  const present = candidates.filter(
    (value) => value !== null && value !== undefined && value !== '',
  );
  if (present.length === 0) return { kind: 'missing', ms: null };
  for (const candidate of present) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      continue;
    }
    const ms = new Date(candidate).getTime();
    if (Number.isFinite(ms)) return { kind: 'valid', ms };
  }
  return { kind: 'invalid', ms: null };
}

function emptyRowAccounting(returnedRows: number): ComfortRowAccounting {
  return {
    returnedRows,
    invalidRowRows: 0,
    missingTimestampRows: 0,
    invalidTimestampRows: 0,
    timestampValidRows: 0,
    duplicateTimestampRows: 0,
    uniqueTimestampRows: 0,
    unknownHvacRows: 0,
    hvacOffRows: 0,
    missingInsideTempRows: 0,
    missingSetpointRows: 0,
    analyzedRows: 0,
  };
}

function emptySourceCoverage(): ComfortSourceCoverage {
  return {
    denominatorRows: 0,
    insideTempRows: 0,
    driverSetpointRows: 0,
    passengerSetpointRows: 0,
    anySetpointRows: 0,
    pairedSetpointRows: 0,
    singleSetpointRows: 0,
    knownHvacRows: 0,
    activeHvacRows: 0,
    thermallyCompleteRows: 0,
  };
}

function normalize(samples: readonly ComfortSample[]): NormalizationResult {
  const rows = emptyRowAccounting(samples.length);
  const sources = emptySourceCoverage();
  const timeline: NormalizedComfortRow[] = [];
  const seenTimestamps = new Set<number>();

  for (const sample of samples as readonly unknown[]) {
    if (!isRecord(sample)) {
      rows.invalidRowRows += 1;
      continue;
    }
    const parsed = parseTimestamp(sample);
    if (parsed.kind === 'missing') {
      rows.missingTimestampRows += 1;
      continue;
    }
    if (parsed.kind === 'invalid' || parsed.ms == null) {
      rows.invalidTimestampRows += 1;
      continue;
    }
    rows.timestampValidRows += 1;
    if (seenTimestamps.has(parsed.ms)) {
      rows.duplicateTimestampRows += 1;
      continue;
    }
    seenTimestamps.add(parsed.ms);
    rows.uniqueTimestampRows += 1;
    sources.denominatorRows += 1;

    const insideC = finite(sample.insideTemp);
    const driverC = finite(sample.driverTempSetting);
    const passengerC = finite(sample.passengerTempSetting);
    const targetC =
      driverC != null && passengerC != null
        ? (driverC + passengerC) / 2
        : (driverC ?? passengerC);
    const hvacOn = normalizeHvacOn(sample as unknown as HvacSignalSample);

    if (insideC != null) sources.insideTempRows += 1;
    if (driverC != null) sources.driverSetpointRows += 1;
    if (passengerC != null) sources.passengerSetpointRows += 1;
    if (targetC != null) sources.anySetpointRows += 1;
    if (driverC != null && passengerC != null) {
      sources.pairedSetpointRows += 1;
    } else if (targetC != null) {
      sources.singleSetpointRows += 1;
    }
    if (insideC != null && targetC != null) {
      sources.thermallyCompleteRows += 1;
    }
    if (hvacOn != null) sources.knownHvacRows += 1;
    if (hvacOn === true) sources.activeHvacRows += 1;

    let outcome: ComfortRowOutcome;
    if (hvacOn == null) {
      outcome = 'unknown_hvac';
      rows.unknownHvacRows += 1;
    } else if (!hvacOn) {
      outcome = 'hvac_off';
      rows.hvacOffRows += 1;
    } else if (insideC == null) {
      outcome = 'missing_inside';
      rows.missingInsideTempRows += 1;
    } else if (targetC == null) {
      outcome = 'missing_setpoint';
      rows.missingSetpointRows += 1;
    } else {
      outcome = 'analyzed';
      rows.analyzedRows += 1;
    }

    timeline.push({
      ms: parsed.ms,
      insideC,
      driverC,
      passengerC,
      targetC,
      deviationC:
        insideC != null && targetC != null ? insideC - targetC : null,
      disagreementC:
        driverC != null && passengerC != null
          ? Math.abs(driverC - passengerC)
          : null,
      hvacOn,
      outcome,
    });
  }

  timeline.sort((a, b) => a.ms - b.ms);
  return { timeline, rows, sources };
}

function isAnalyzedRow(row: NormalizedComfortRow): row is AnalyzedComfortRow {
  return (
    row.outcome === 'analyzed'
    && row.insideC != null
    && row.targetC != null
    && row.deviationC != null
  );
}

function buildCoverage(
  timeline: readonly NormalizedComfortRow[],
  rows: ComfortRowAccounting,
  options: Required<ComfortConsistencyOptions>,
): ComfortCoverage {
  const gaps = timeline.slice(1).map(
    (row, index) => (row.ms - timeline[index]!.ms) / 1000,
  );
  return {
    earliestValidMs: timeline[0]?.ms ?? null,
    latestValidMs: timeline[timeline.length - 1]?.ms ?? null,
    spanS:
      timeline.length > 1
        ? (timeline[timeline.length - 1]!.ms - timeline[0]!.ms) / 1000
        : 0,
    cadenceIntervals: gaps.length,
    medianGapS: median(gaps),
    p90GapS: percentile(gaps, 0.9),
    maxObservedGapS:
      gaps.length > 0
        ? gaps.reduce((maximum, gap) => Math.max(maximum, gap), 0)
        : null,
    longGapCount: gaps.filter((gap) => gap > options.maxGapS).length,
    stateCoverage:
      rows.uniqueTimestampRows > 0
        ? (rows.hvacOffRows + rows.missingInsideTempRows
          + rows.missingSetpointRows + rows.analyzedRows)
          / rows.uniqueTimestampRows
        : null,
    analyticCoverage:
      rows.uniqueTimestampRows > 0
        ? rows.analyzedRows / rows.uniqueTimestampRows
        : null,
  };
}

function emptyHourlyProfile(): ComfortHourlyBucket[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    observedS: 0,
    belowBandS: 0,
    withinBandS: 0,
    aboveBandS: 0,
    withinBandShare: null,
    meanAbsDeviationC: null,
  }));
}

function addHourlyInterval(
  buckets: ComfortHourlyBucket[],
  startMs: number,
  endMs: number,
  deviationC: number,
  comfortBandC: number,
  weightedDeviationByHour: number[],
): void {
  let cursor = startMs;
  while (cursor < endMs) {
    const current = new Date(cursor);
    const nextHour = new Date(cursor);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    const segmentEnd = Math.min(endMs, nextHour.getTime());
    const durationS = (segmentEnd - cursor) / 1000;
    const hour = current.getHours();
    const bucket = buckets[hour]!;
    bucket.observedS += durationS;
    weightedDeviationByHour[hour] =
      (weightedDeviationByHour[hour] ?? 0)
      + Math.abs(deviationC) * durationS;
    if (deviationC < -comfortBandC) {
      bucket.belowBandS += durationS;
    } else if (deviationC > comfortBandC) {
      bucket.aboveBandS += durationS;
    } else {
      bucket.withinBandS += durationS;
    }
    cursor = segmentEnd;
  }
}

function buildIntervals(
  timeline: readonly NormalizedComfortRow[],
  options: Required<ComfortConsistencyOptions>,
): IntervalResult {
  const accounting: ComfortIntervalAccounting = {
    candidateAdjacentPairs: Math.max(0, timeline.length - 1),
    observedActiveIntervals: 0,
    longGapExclusions: 0,
    inactiveStartIntervals: 0,
    evidenceBarrierIntervals: 0,
    nonpositiveIntervals: 0,
    terminalSamples: timeline.length > 0 ? 1 : 0,
  };
  const hourly = emptyHourlyProfile();
  const weightedDeviationByHour = Array.from({ length: 24 }, () => 0);
  let observedActiveS = 0;
  let belowBandS = 0;
  let withinBandS = 0;
  let aboveBandS = 0;
  let weightedAbsDeviationCS = 0;

  for (let index = 0; index < timeline.length - 1; index += 1) {
    const current = timeline[index]!;
    const next = timeline[index + 1]!;
    const durationS = (next.ms - current.ms) / 1000;
    if (durationS <= 0) {
      accounting.nonpositiveIntervals += 1;
      continue;
    }
    if (durationS > options.maxGapS) {
      accounting.longGapExclusions += 1;
      continue;
    }
    if (current.outcome === 'hvac_off') {
      accounting.inactiveStartIntervals += 1;
      continue;
    }
    if (!isAnalyzedRow(current)) {
      accounting.evidenceBarrierIntervals += 1;
      continue;
    }

    accounting.observedActiveIntervals += 1;
    observedActiveS += durationS;
    weightedAbsDeviationCS += Math.abs(current.deviationC) * durationS;
    if (current.deviationC < -options.comfortBandC) {
      belowBandS += durationS;
    } else if (current.deviationC > options.comfortBandC) {
      aboveBandS += durationS;
    } else {
      withinBandS += durationS;
    }
    addHourlyInterval(
      hourly,
      current.ms,
      next.ms,
      current.deviationC,
      options.comfortBandC,
      weightedDeviationByHour,
    );
  }

  for (const bucket of hourly) {
    bucket.withinBandShare =
      bucket.observedS > 0 ? bucket.withinBandS / bucket.observedS : null;
    bucket.meanAbsDeviationC =
      bucket.observedS > 0
        ? weightedDeviationByHour[bucket.hour]! / bucket.observedS
        : null;
  }

  return {
    accounting,
    composition: {
      observedActiveS,
      belowBandS,
      withinBandS,
      aboveBandS,
      withinBandShare:
        observedActiveS > 0 ? withinBandS / observedActiveS : null,
      durationWeightedMeanAbsDeviationC:
        observedActiveS > 0
          ? weightedAbsDeviationCS / observedActiveS
          : null,
    },
    hourly,
  };
}

function timeToSustainedBand(
  rows: readonly AnalyzedComfortRow[],
  options: Required<ComfortConsistencyOptions>,
): number | null {
  for (
    let index = 0;
    index <= rows.length - options.sustainSamples;
    index += 1
  ) {
    const sustained = rows
      .slice(index, index + options.sustainSamples)
      .every((row) => Math.abs(row.deviationC) <= options.comfortBandC);
    if (sustained) return (rows[index]!.ms - rows[0]!.ms) / 1000;
  }
  return null;
}

function finalizeActiveRun(
  draft: ActiveRunDraft,
  rightBoundary: ComfortRunBoundary,
  index: number,
  options: Required<ComfortConsistencyOptions>,
): ComfortActiveRun {
  const first = draft.rows[0]!;
  const last = draft.rows[draft.rows.length - 1]!;
  const direction: ComfortRunDirection =
    first.deviationC > options.comfortBandC
      ? 'hot'
      : first.deviationC < -options.comfortBandC
        ? 'cold'
        : 'in_band';
  const timeToBandS =
    direction === 'in_band'
      ? null
      : timeToSustainedBand(draft.rows, options);
  const overshootC = draft.rows.reduce((maximum, row) => {
    const opposite =
      direction === 'hot'
        ? -row.deviationC
        : direction === 'cold'
          ? row.deviationC
          : 0;
    return Math.max(maximum, opposite);
  }, 0);

  return {
    id: `comfort-run-${index}`,
    index,
    startMs: first.ms,
    endMs: last.ms,
    samples: draft.rows.length,
    sampleSpanS: (last.ms - first.ms) / 1000,
    direction,
    startDeviationC: first.deviationC,
    endDeviationC: last.deviationC,
    startTargetC: first.targetC,
    endTargetC: last.targetC,
    timeToBandS,
    overshootC,
    leftBoundary: draft.leftBoundary,
    rightBoundary,
    rightCensored:
      rightBoundary === 'dataset_edge'
      || rightBoundary === 'long_gap'
      || rightBoundary === 'missing_evidence',
  };
}

function buildActiveRuns(
  timeline: readonly NormalizedComfortRow[],
  options: Required<ComfortConsistencyOptions>,
): ComfortActiveRun[] {
  const runs: ComfortActiveRun[] = [];
  let draft: ActiveRunDraft | null = null;

  const flush = (rightBoundary: ComfortRunBoundary) => {
    if (!draft) return;
    runs.push(
      finalizeActiveRun(draft, rightBoundary, runs.length + 1, options),
    );
    draft = null;
  };

  for (let index = 0; index < timeline.length; index += 1) {
    const row = timeline[index]!;
    if (!isAnalyzedRow(row)) {
      const previous = draft?.rows[draft.rows.length - 1];
      const gapS = previous ? (row.ms - previous.ms) / 1000 : 0;
      flush(
        gapS > options.maxGapS
          ? 'long_gap'
          : row.outcome === 'hvac_off'
            ? 'hvac_inactive'
            : 'missing_evidence',
      );
      continue;
    }

    if (draft) {
      const previous = draft.rows[draft.rows.length - 1]!;
      const gapS = (row.ms - previous.ms) / 1000;
      if (gapS > options.maxGapS) {
        flush('long_gap');
        draft = { rows: [row], leftBoundary: 'long_gap' };
        continue;
      }
      if (
        Math.abs(row.targetC - previous.targetC)
        > options.maxTargetShiftC
      ) {
        flush('target_shift');
        draft = { rows: [row], leftBoundary: 'target_shift' };
        continue;
      }
      draft.rows.push(row);
      continue;
    }

    const previous = timeline[index - 1];
    let leftBoundary: ComfortRunBoundary = 'dataset_edge';
    if (previous) {
      const gapS = (row.ms - previous.ms) / 1000;
      if (gapS > options.maxGapS) {
        leftBoundary = 'long_gap';
      } else if (previous.outcome === 'hvac_off') {
        leftBoundary = 'hvac_inactive';
      } else if (previous.outcome !== 'analyzed') {
        leftBoundary = 'missing_evidence';
      }
    }
    draft = { rows: [row], leftBoundary };
  }
  flush('dataset_edge');
  return runs;
}

function isStabilizationWindow(
  run: ComfortActiveRun,
): run is StabilizationWindow {
  return run.direction === 'hot' || run.direction === 'cold';
}

function buildOvershootDistribution(
  windows: readonly StabilizationWindow[],
): OvershootBin[] {
  return OVERSHOOT_EDGES.map((lowerC, index) => {
    const upperC = OVERSHOOT_EDGES[index + 1] ?? null;
    const count = windows.filter(
      (window) =>
        window.overshootC >= lowerC
        && (upperC == null || window.overshootC < upperC),
    ).length;
    return {
      lowerC,
      upperC,
      windows: count,
      share: windows.length > 0 ? count / windows.length : 0,
    };
  });
}

function buildDeviationDistribution(
  deviations: readonly number[],
  comfortBandC: number,
): ComfortDeviationBin[] {
  const edges = [
    0,
    comfortBandC / 2,
    comfortBandC,
    comfortBandC * 2,
    comfortBandC * 4,
  ];
  return edges.map((lowerC, index) => {
    const upperC = edges[index + 1] ?? null;
    const samples = deviations.filter(
      (value) =>
        value >= lowerC && (upperC == null || value < upperC),
    ).length;
    return {
      lowerC,
      upperC,
      samples,
      share: deviations.length > 0 ? samples / deviations.length : 0,
    };
  });
}

function buildBoundaryAccounting(
  runs: readonly ComfortActiveRun[],
): ComfortBoundaryAccounting {
  const result: ComfortBoundaryAccounting = {
    datasetEdges: 0,
    hvacInactiveBoundaries: 0,
    missingEvidenceBoundaries: 0,
    longGapBoundaries: 0,
    targetShiftBoundaries: 0,
  };
  for (const run of runs) {
    for (const boundary of [run.leftBoundary, run.rightBoundary]) {
      if (boundary === 'dataset_edge') result.datasetEdges += 1;
      if (boundary === 'hvac_inactive') {
        result.hvacInactiveBoundaries += 1;
      }
      if (boundary === 'missing_evidence') {
        result.missingEvidenceBoundaries += 1;
      }
      if (boundary === 'long_gap') result.longGapBoundaries += 1;
      if (boundary === 'target_shift') result.targetShiftBoundaries += 1;
    }
  }
  return result;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-6;
}

export function summarizeComfortConsistency(
  samples: readonly ComfortSample[],
  options: ComfortConsistencyOptions = {},
): ComfortConsistencySummary {
  const thresholds = resolveOptions(options);
  const normalized = normalize(Array.isArray(samples) ? samples : []);
  const coverage = buildCoverage(
    normalized.timeline,
    normalized.rows,
    thresholds,
  );
  const intervalResult = buildIntervals(normalized.timeline, thresholds);
  const analyzedRows = normalized.timeline.filter(isAnalyzedRow);
  const deviations = analyzedRows.map((row) => Math.abs(row.deviationC));
  const disagreements = analyzedRows
    .map((row) => row.disagreementC)
    .filter((value): value is number => value != null);
  const activeRuns = buildActiveRuns(normalized.timeline, thresholds);
  const stabilizationWindows = activeRuns
    .filter(isStabilizationWindow)
    .map((run, index) => ({
      ...run,
      id: `comfort-window-${index + 1}`,
      index: index + 1,
    }));
  const stabilizationValues = stabilizationWindows
    .map((window) => window.timeToBandS)
    .filter((value): value is number => value != null);
  const withinComfortBandShare =
    deviations.length > 0
      ? deviations.filter((value) => value <= thresholds.comfortBandC).length
        / deviations.length
      : null;
  const meanAbsDeviationC = mean(deviations);
  const meanSetpointDisagreementC = mean(disagreements);
  const medianStabilizationS = median(stabilizationValues);
  const sampleConfidence = Math.min(
    1,
    analyzedRows.length / FULL_SAMPLE_CONFIDENCE_AT,
  );
  const windowConfidence = Math.min(
    1,
    stabilizationWindows.length / FULL_WINDOW_CONFIDENCE_AT,
  );
  const confidence =
    analyzedRows.length > 0
      ? 0.75 * sampleConfidence + 0.25 * windowConfidence
      : 0;
  const bandAdherence = withinComfortBandShare;
  const scoreDeviation = meanAbsDeviationC;
  const deviationScore =
    scoreDeviation == null
      ? null
      : Math.max(0, 1 - scoreDeviation / SCORE_DEVIATION_ZERO_C);
  const agreementScore =
    meanSetpointDisagreementC == null
      ? 0.5
      : Math.max(
          0,
          1 - meanSetpointDisagreementC / SCORE_AGREEMENT_ZERO_C,
        );
  const stabilizationScore =
    medianStabilizationS == null
      ? 0.5
      : Math.max(
          0,
          1 - medianStabilizationS / SCORE_STABILIZATION_ZERO_S,
        );
  const rawScore =
    bandAdherence == null || deviationScore == null
      ? null
      : 100 * (
        0.5 * bandAdherence
        + 0.25 * deviationScore
        + 0.15 * agreementScore
        + 0.1 * stabilizationScore
      );
  const adjustedScore =
    rawScore == null ? null : Math.round(50 + confidence * (rawScore - 50));
  const stabilizedWindows = stabilizationValues.length;
  const unstabilizedWindows =
    stabilizationWindows.length - stabilizedWindows;
  const insideBandStartRuns = activeRuns.filter(
    (run) => run.direction === 'in_band',
  ).length;
  const directoryItems = [...stabilizationWindows]
    .sort((a, b) => b.startMs - a.startMs)
    .slice(0, thresholds.windowDisplayLimit);
  const boundaryAccounting = buildBoundaryAccounting(activeRuns);
  const rows = normalized.rows;
  const intervals = intervalResult.accounting;
  const composition = intervalResult.composition;
  const rowOutcomeTotal =
    rows.invalidRowRows
    + rows.missingTimestampRows
    + rows.invalidTimestampRows
    + rows.duplicateTimestampRows
    + rows.unknownHvacRows
    + rows.hvacOffRows
    + rows.missingInsideTempRows
    + rows.missingSetpointRows
    + rows.analyzedRows;
  const intervalOutcomeTotal =
    intervals.observedActiveIntervals
    + intervals.longGapExclusions
    + intervals.inactiveStartIntervals
    + intervals.evidenceBarrierIntervals
    + intervals.nonpositiveIntervals;

  return {
    rows,
    sources: normalized.sources,
    coverage,
    intervals,
    intervalComposition: composition,
    hourlyProfile: intervalResult.hourly,
    activeRuns,
    activeRunCount: activeRuns.length,
    insideBandStartRuns,
    stabilizationWindows,
    stabilizedWindows,
    unstabilizedWindows,
    censoredUnstabilizedWindows: stabilizationWindows.filter(
      (window) => window.timeToBandS == null && window.rightCensored,
    ).length,
    hotStartWindows: stabilizationWindows.filter(
      (window) => window.direction === 'hot',
    ).length,
    coldStartWindows: stabilizationWindows.filter(
      (window) => window.direction === 'cold',
    ).length,
    analyzedSamples: analyzedRows.length,
    withinComfortBandShare,
    meanAbsDeviationC,
    medianAbsDeviationC: median(deviations),
    p90AbsDeviationC: percentile(deviations, 0.9),
    durationWeightedMeanAbsDeviationC:
      composition.durationWeightedMeanAbsDeviationC,
    pairedSetpointAnalyzedSamples: disagreements.length,
    singleSetpointAnalyzedSamples:
      analyzedRows.length - disagreements.length,
    meanSetpointDisagreementC,
    medianSetpointDisagreementC: median(disagreements),
    p90SetpointDisagreementC: percentile(disagreements, 0.9),
    disagreementSampleShare:
      disagreements.length > 0
        ? disagreements.filter(
            (value) => value > thresholds.setpointDisagreementC,
          ).length / disagreements.length
        : null,
    medianStabilizationS,
    medianOvershootC: median(
      stabilizationWindows.map((window) => window.overshootC),
    ),
    overshootDistribution: buildOvershootDistribution(
      stabilizationWindows,
    ),
    deviationDistribution: buildDeviationDistribution(
      deviations,
      thresholds.comfortBandC,
    ),
    score: {
      bandAdherence,
      deviationScore,
      agreementScore,
      stabilizationScore,
      deviationZeroC: SCORE_DEVIATION_ZERO_C,
      agreementZeroC: SCORE_AGREEMENT_ZERO_C,
      stabilizationZeroS: SCORE_STABILIZATION_ZERO_S,
      fullSampleConfidenceAt: FULL_SAMPLE_CONFIDENCE_AT,
      fullWindowConfidenceAt: FULL_WINDOW_CONFIDENCE_AT,
      rawScore,
      sampleConfidence,
      windowConfidence,
      confidence,
      adjustedScore,
    },
    consistencyScore: adjustedScore,
    confidence,
    thresholds,
    boundaryAccounting,
    windowDirectory: {
      total: stabilizationWindows.length,
      displayed: directoryItems.length,
      omitted: stabilizationWindows.length - directoryItems.length,
      cap: thresholds.windowDisplayLimit,
      items: directoryItems,
    },
    identities: {
      rowsBalanced: rows.returnedRows === rowOutcomeTotal,
      timestampsBalanced:
        rows.timestampValidRows
        === rows.uniqueTimestampRows + rows.duplicateTimestampRows,
      timelineBalanced:
        rows.uniqueTimestampRows
        === intervals.candidateAdjacentPairs + intervals.terminalSamples,
      intervalsBalanced:
        intervals.candidateAdjacentPairs === intervalOutcomeTotal,
      intervalDurationBalanced: nearlyEqual(
        composition.observedActiveS,
        composition.belowBandS
          + composition.withinBandS
          + composition.aboveBandS,
      ),
      activeFragmentsBalanced:
        activeRuns.length
        === insideBandStartRuns + stabilizationWindows.length,
      windowOutcomesBalanced:
        stabilizationWindows.length
        === stabilizedWindows + unstabilizedWindows,
    },
  };
}
