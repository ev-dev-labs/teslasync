/**
 * Evidence accounting for the climate endpoint's timestamped HVAC timeline.
 *
 * Rows are classified exactly once, timestamped unknown states remain in the
 * timeline as continuity barriers, and only adjacent intervals at or below the
 * configured gap ceiling contribute observed duration. Durations stay in SI
 * seconds; presentation code owns all display-unit conversion.
 */

import { resolveHvacActive } from '@/lib/climateState';

export const DEFAULT_HVAC_MAX_GAP_S = 30 * 60;
export const DEFAULT_HVAC_SHORT_CYCLE_THRESHOLD_S = 10 * 60;
export const DEFAULT_HVAC_RUN_DISPLAY_LIMIT = 50;
export const MAX_HVAC_RUN_DISPLAY_LIMIT = 500;

export interface HvacSignalSample {
  timestamp?: string | null;
  created_at?: string | null;
  hvacPower?: unknown;
  isAcOn?: unknown;
  fanSpeed?: unknown;
  hvacFanStatus?: unknown;
}

export type HvacRunBoundary =
  | 'observed_transition'
  | 'dataset_edge'
  | 'long_gap'
  | 'unknown_state';

export interface HvacRun {
  id: string;
  index: number;
  on: boolean;
  startMs: number;
  endMs: number;
  durationS: number;
  intervals: number;
  leftBoundary: HvacRunBoundary;
  rightBoundary: HvacRunBoundary;
  leftBoundaryObserved: boolean;
  rightBoundaryObserved: boolean;
  complete: boolean;
  support: 'complete' | 'partial';
  eligibleForShortCycle: boolean;
  shortCycle: boolean | null;
}

export interface HvacHourlyProfile {
  hour: number;
  onS: number;
  offS: number;
  observedS: number;
  dutyCycle: number | null;
  onTransitions: number;
  /** Compatibility alias; only observed off-to-on transitions are counted. */
  eventStarts: number;
}

export interface HvacRowAccounting {
  returnedRows: number;
  validKnownStateRows: number;
  missingTimestampRows: number;
  invalidTimestampRows: number;
  duplicateTimestampRows: number;
  uninterpretableStateRows: number;
  timestampValidRows: number;
  uniqueTimestampRows: number;
  knownOnRows: number;
  knownOffRows: number;
}

export interface HvacSignalAvailability {
  denominatorRows: number;
  hvacPowerRows: number;
  acRows: number;
  fanSpeedRows: number;
  fanStatusRows: number;
  anyFanRows: number;
  anySignalRows: number;
  powerAcConflictRows: number;
  fanConflictRows: number;
  anyConflictRows: number;
}

export interface HvacCoverage {
  earliestValidMs: number | null;
  latestValidMs: number | null;
  spanS: number | null;
  cadenceIntervals: number;
  medianGapS: number | null;
  p90GapS: number | null;
  maxObservedGapS: number | null;
  longGapCount: number;
  stateCoverage: number | null;
}

export interface HvacIntervalAccounting {
  candidateAdjacentPairs: number;
  observedIntervals: number;
  longGapExclusions: number;
  unknownStateBarriers: number;
  nonpositiveIntervals: number;
  duplicatesRemovedBeforePairing: number;
  terminalSamples: number;
}

export interface HvacTransitionMatrix {
  offToOff: number;
  offToOn: number;
  onToOff: number;
  onToOn: number;
  knownToUnknown: number;
}

export interface HvacRunQuantiles {
  count: number;
  completeCount: number;
  partialCount: number;
  p25S: number | null;
  medianS: number | null;
  p90S: number | null;
  maxS: number | null;
}

export interface HvacRunLengthBin {
  key: 'up_to_5m' | '5_to_10m' | '10_to_30m' | '30_to_60m' | 'over_60m';
  lowerS: number;
  upperS: number | null;
  onRuns: number;
  offRuns: number;
  completeOnRuns: number;
}

export interface HvacBoundaryAccounting {
  totalRunBoundaries: number;
  observedTransitionBoundaries: number;
  datasetEdgeBoundaries: number;
  longGapBoundaries: number;
  unknownStateBoundaries: number;
  completeRuns: number;
  partialRuns: number;
}

export interface HvacRunDirectory {
  items: HvacRun[];
  total: number;
  displayed: number;
  omitted: number;
  cap: number;
}

export interface HvacCyclingThresholds {
  maxGapS: number;
  shortCycleThresholdS: number;
  runDisplayLimit: number;
}

export interface HvacAccountingIdentities {
  rowsBalanced: boolean;
  timelineBalanced: boolean;
  intervalsBalanced: boolean;
  runIntervalsBalanced: boolean;
  observedDurationBalanced: boolean;
}

export interface HvacCyclingSummary {
  rows: HvacRowAccounting;
  signals: HvacSignalAvailability;
  coverage: HvacCoverage;
  intervals: HvacIntervalAccounting;
  transitions: HvacTransitionMatrix;
  transitionCount: number;
  observedOnStarts: number;
  runs: HvacRun[];
  activeRunCount: number;
  completeCycles: number;
  completeOnRunCount: number;
  shortCompleteOnRunCount: number;
  qualifiedShortCycleRate: number | null;
  allOnRunShortCycleRate: number | null;
  boundaryAccounting: HvacBoundaryAccounting;
  onRunQuantiles: HvacRunQuantiles;
  offRunQuantiles: HvacRunQuantiles;
  completeOnRunQuantiles: HvacRunQuantiles;
  runLengthDistribution: HvacRunLengthBin[];
  runDirectory: HvacRunDirectory;
  thresholds: HvacCyclingThresholds;
  identities: HvacAccountingIdentities;
  totalOnObservedS: number;
  totalOffObservedS: number;
  hourlyProfile: HvacHourlyProfile[];
  /** Compatibility aggregates retained for existing consumers. */
  analyzedSamples: number;
  observedS: number;
  dutyCycle: number | null;
  eventCount: number;
  medianOnS: number | null;
  medianOffS: number | null;
  shortCycleRate: number | null;
  longestRunS: number | null;
}

export interface HvacCyclingOptions {
  maxGapS?: number;
  shortCycleThresholdS?: number;
  runDisplayLimit?: number;
}

interface SignalStates {
  power: boolean | null;
  ac: boolean | null;
  fanSpeed: boolean | null;
  fanStatus: boolean | null;
  all: boolean[];
}

interface TimelineRow {
  ms: number;
  on: boolean | null;
  sourceIndex: number;
  signals: SignalStates;
}

type PairDisposition =
  | 'observed'
  | 'long_gap'
  | 'unknown_state'
  | 'nonpositive';

interface TimelinePair {
  index: number;
  startMs: number;
  endMs: number;
  durationS: number;
  disposition: PairDisposition;
}

interface RunDraft {
  on: boolean;
  startMs: number;
  endMs: number;
  durationS: number;
  intervals: number;
  firstPairIndex: number;
  lastPairIndex: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function finiteSignal(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanSignal(value: unknown): boolean | null {
  return value === true || value === false ? value : null;
}

function signalStates(sample: HvacSignalSample): SignalStates {
  const row = isRecord(sample) ? sample : {};
  const power = booleanSignal(row.hvacPower);
  const ac = booleanSignal(row.isAcOn);
  const fanSpeedValue = finiteSignal(row.fanSpeed);
  const fanStatusValue = finiteSignal(row.hvacFanStatus);
  const fanSpeed = fanSpeedValue != null ? fanSpeedValue > 0 : null;
  const fanStatus = fanStatusValue != null ? fanStatusValue > 0 : null;
  return {
    power,
    ac,
    fanSpeed,
    fanStatus,
    all: [power, ac, fanSpeed, fanStatus].filter(
      (state): state is boolean => state != null,
    ),
  };
}

/**
 * Resolve HVAC-on without allowing one explicit active signal to be cancelled
 * by a stale off signal. Strict booleans and finite fan numbers are the only
 * interpretable runtime values. No interpretable input remains `null`.
 */
export function normalizeHvacOn(sample: HvacSignalSample): boolean | null {
  const row = isRecord(sample) ? sample : {};
  const states: boolean[] = [];
  const primary = resolveHvacActive(row.hvacPower, row.isAcOn);
  if (primary != null) states.push(primary);
  for (const fan of [finiteSignal(row.fanSpeed), finiteSignal(row.hvacFanStatus)]) {
    if (fan != null) states.push(fan > 0);
  }
  if (states.some(Boolean)) return true;
  return states.length > 0 ? false : null;
}

function parseTimestamp(
  sample: HvacSignalSample,
): { outcome: 'missing' | 'invalid' | 'valid'; ms: number | null } {
  const row = isRecord(sample) ? sample : {};
  const values = [row.timestamp, row.created_at];
  const present = values.filter(
    (value) =>
      value != null
      && !(typeof value === 'string' && value.trim().length === 0),
  );
  if (present.length === 0) return { outcome: 'missing', ms: null };
  for (const value of present) {
    if (typeof value !== 'string') continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return { outcome: 'valid', ms };
  }
  return { outcome: 'invalid', ms: null };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * proportion) - 1),
  );
  return sorted[index]!;
}

function positiveOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function displayLimitOption(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return DEFAULT_HVAC_RUN_DISPLAY_LIMIT;
  }
  return Math.min(MAX_HVAC_RUN_DISPLAY_LIMIT, Math.floor(value));
}

function emptyHourlyProfile(): HvacHourlyProfile[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    onS: 0,
    offS: 0,
    observedS: 0,
    dutyCycle: null,
    onTransitions: 0,
    eventStarts: 0,
  }));
}

function splitIntervalByHour(
  startMs: number,
  endMs: number,
  on: boolean,
  profile: HvacHourlyProfile[],
): void {
  let cursor = startMs;
  while (cursor < endMs) {
    const boundary = new Date(cursor);
    boundary.setMinutes(0, 0, 0);
    boundary.setHours(boundary.getHours() + 1);
    const next = Math.min(endMs, Math.max(cursor + 1, boundary.getTime()));
    const durationS = (next - cursor) / 1000;
    const bucket = profile[new Date(cursor).getHours()]!;
    bucket.observedS += durationS;
    if (on) bucket.onS += durationS;
    else bucket.offS += durationS;
    cursor = next;
  }
}

function boundaryFromDisposition(disposition: PairDisposition): HvacRunBoundary {
  if (disposition === 'long_gap') return 'long_gap';
  if (disposition === 'unknown_state') return 'unknown_state';
  return 'dataset_edge';
}

function runQuantiles(runs: readonly HvacRun[]): HvacRunQuantiles {
  const durations = runs.map((run) => run.durationS);
  return {
    count: runs.length,
    completeCount: runs.filter((run) => run.complete).length,
    partialCount: runs.filter((run) => !run.complete).length,
    p25S: percentile(durations, 0.25),
    medianS: median(durations),
    p90S: percentile(durations, 0.9),
    maxS: durations.length > 0 ? Math.max(...durations) : null,
  };
}

function buildDistribution(runs: readonly HvacRun[]): HvacRunLengthBin[] {
  const bins: HvacRunLengthBin[] = [
    { key: 'up_to_5m', lowerS: 0, upperS: 300, onRuns: 0, offRuns: 0, completeOnRuns: 0 },
    { key: '5_to_10m', lowerS: 300, upperS: 600, onRuns: 0, offRuns: 0, completeOnRuns: 0 },
    { key: '10_to_30m', lowerS: 600, upperS: 1_800, onRuns: 0, offRuns: 0, completeOnRuns: 0 },
    { key: '30_to_60m', lowerS: 1_800, upperS: 3_600, onRuns: 0, offRuns: 0, completeOnRuns: 0 },
    { key: 'over_60m', lowerS: 3_600, upperS: null, onRuns: 0, offRuns: 0, completeOnRuns: 0 },
  ];
  for (const run of runs) {
    const bin = bins.find(
      (candidate) =>
        run.durationS > candidate.lowerS
        && (candidate.upperS == null || run.durationS <= candidate.upperS),
    ) ?? bins[0]!;
    if (run.on) {
      bin.onRuns += 1;
      if (run.complete) bin.completeOnRuns += 1;
    } else {
      bin.offRuns += 1;
    }
  }
  return bins;
}

function normalizeTimeline(samples: readonly HvacSignalSample[]): {
  rows: TimelineRow[];
  accounting: HvacRowAccounting;
} {
  const parsed: TimelineRow[] = [];
  let missingTimestampRows = 0;
  let invalidTimestampRows = 0;

  samples.forEach((sample, sourceIndex) => {
    const parsedTimestamp = parseTimestamp(sample);
    if (parsedTimestamp.outcome === 'missing') {
      missingTimestampRows += 1;
      return;
    }
    if (parsedTimestamp.outcome === 'invalid' || parsedTimestamp.ms == null) {
      invalidTimestampRows += 1;
      return;
    }
    parsed.push({
      ms: parsedTimestamp.ms,
      on: normalizeHvacOn(sample),
      sourceIndex,
      signals: signalStates(sample),
    });
  });

  parsed.sort((a, b) => a.ms - b.ms || a.sourceIndex - b.sourceIndex);
  const rows: TimelineRow[] = [];
  let duplicateTimestampRows = 0;
  for (const row of parsed) {
    if (rows.length > 0 && rows[rows.length - 1]!.ms === row.ms) {
      duplicateTimestampRows += 1;
    } else {
      rows.push(row);
    }
  }

  const validKnownStateRows = rows.filter((row) => row.on != null).length;
  const uninterpretableStateRows = rows.length - validKnownStateRows;
  const knownOnRows = rows.filter((row) => row.on === true).length;
  const knownOffRows = rows.filter((row) => row.on === false).length;
  return {
    rows,
    accounting: {
      returnedRows: samples.length,
      validKnownStateRows,
      missingTimestampRows,
      invalidTimestampRows,
      duplicateTimestampRows,
      uninterpretableStateRows,
      timestampValidRows: parsed.length,
      uniqueTimestampRows: rows.length,
      knownOnRows,
      knownOffRows,
    },
  };
}

function summarizeSignals(rows: readonly TimelineRow[]): HvacSignalAvailability {
  const conflict = (states: readonly boolean[]) =>
    states.includes(true) && states.includes(false);
  return {
    denominatorRows: rows.length,
    hvacPowerRows: rows.filter((row) => row.signals.power != null).length,
    acRows: rows.filter((row) => row.signals.ac != null).length,
    fanSpeedRows: rows.filter((row) => row.signals.fanSpeed != null).length,
    fanStatusRows: rows.filter((row) => row.signals.fanStatus != null).length,
    anyFanRows: rows.filter(
      (row) => row.signals.fanSpeed != null || row.signals.fanStatus != null,
    ).length,
    anySignalRows: rows.filter((row) => row.signals.all.length > 0).length,
    powerAcConflictRows: rows.filter(
      (row) =>
        row.signals.power != null
        && row.signals.ac != null
        && row.signals.power !== row.signals.ac,
    ).length,
    fanConflictRows: rows.filter(
      (row) =>
        row.signals.fanSpeed != null
        && row.signals.fanStatus != null
        && row.signals.fanSpeed !== row.signals.fanStatus,
    ).length,
    anyConflictRows: rows.filter((row) => conflict(row.signals.all)).length,
  };
}

function buildPairs(
  rows: readonly TimelineRow[],
  maxGapS: number,
): { pairs: TimelinePair[]; accounting: HvacIntervalAccounting } {
  const pairs: TimelinePair[] = [];
  let observedIntervals = 0;
  let longGapExclusions = 0;
  let unknownStateBarriers = 0;
  let nonpositiveIntervals = 0;

  for (let index = 0; index < rows.length - 1; index += 1) {
    const current = rows[index]!;
    const next = rows[index + 1]!;
    const durationS = (next.ms - current.ms) / 1000;
    let disposition: PairDisposition;
    if (durationS <= 0) {
      disposition = 'nonpositive';
      nonpositiveIntervals += 1;
    } else if (durationS > maxGapS) {
      disposition = 'long_gap';
      longGapExclusions += 1;
    } else if (current.on == null) {
      disposition = 'unknown_state';
      unknownStateBarriers += 1;
    } else {
      disposition = 'observed';
      observedIntervals += 1;
    }
    pairs.push({
      index,
      startMs: current.ms,
      endMs: next.ms,
      durationS,
      disposition,
    });
  }

  return {
    pairs,
    accounting: {
      candidateAdjacentPairs: pairs.length,
      observedIntervals,
      longGapExclusions,
      unknownStateBarriers,
      nonpositiveIntervals,
      duplicatesRemovedBeforePairing: 0,
      terminalSamples: rows.length > 0 ? 1 : 0,
    },
  };
}

function buildRuns(
  rows: readonly TimelineRow[],
  pairs: readonly TimelinePair[],
  shortCycleThresholdS: number,
): HvacRun[] {
  const drafts: RunDraft[] = [];
  for (const pair of pairs) {
    if (pair.disposition !== 'observed') continue;
    const on = rows[pair.index]!.on;
    if (on == null) continue;
    const previous = drafts[drafts.length - 1];
    if (
      previous
      && previous.on === on
      && previous.lastPairIndex === pair.index - 1
      && previous.endMs === pair.startMs
    ) {
      previous.endMs = pair.endMs;
      previous.durationS += pair.durationS;
      previous.intervals += 1;
      previous.lastPairIndex = pair.index;
    } else {
      drafts.push({
        on,
        startMs: pair.startMs,
        endMs: pair.endMs,
        durationS: pair.durationS,
        intervals: 1,
        firstPairIndex: pair.index,
        lastPairIndex: pair.index,
      });
    }
  }

  return drafts.map((draft, zeroIndex) => {
    const leftBoundary: HvacRunBoundary =
      draft.firstPairIndex === 0
        ? 'dataset_edge'
        : pairs[draft.firstPairIndex - 1]!.disposition === 'observed'
          ? 'observed_transition'
          : boundaryFromDisposition(pairs[draft.firstPairIndex - 1]!.disposition);
    const endpointIndex = draft.lastPairIndex + 1;
    const endpoint = rows[endpointIndex]!;
    let rightBoundary: HvacRunBoundary;
    if (endpoint.on == null) {
      rightBoundary = 'unknown_state';
    } else if (endpoint.on !== draft.on) {
      rightBoundary = 'observed_transition';
    } else if (endpointIndex === rows.length - 1) {
      rightBoundary = 'dataset_edge';
    } else {
      rightBoundary = boundaryFromDisposition(pairs[endpointIndex]!.disposition);
    }
    const complete =
      leftBoundary === 'observed_transition'
      && rightBoundary === 'observed_transition';
    const eligibleForShortCycle = draft.on && complete;
    return {
      id: `hvac-run-${zeroIndex + 1}-${draft.startMs}`,
      index: zeroIndex + 1,
      on: draft.on,
      startMs: draft.startMs,
      endMs: draft.endMs,
      durationS: draft.durationS,
      intervals: draft.intervals,
      leftBoundary,
      rightBoundary,
      leftBoundaryObserved: leftBoundary === 'observed_transition',
      rightBoundaryObserved: rightBoundary === 'observed_transition',
      complete,
      support: complete ? 'complete' : 'partial',
      eligibleForShortCycle,
      shortCycle: eligibleForShortCycle
        ? draft.durationS <= shortCycleThresholdS
        : null,
    };
  });
}

export function summarizeHvacCycling(
  samples: readonly HvacSignalSample[],
  options: HvacCyclingOptions = {},
): HvacCyclingSummary {
  const source = Array.isArray(samples) ? samples : [];
  const optionValues = isRecord(options) ? options : {};
  const maxGapS = positiveOption(
    optionValues.maxGapS,
    DEFAULT_HVAC_MAX_GAP_S,
  );
  const shortCycleThresholdS = positiveOption(
    optionValues.shortCycleThresholdS,
    DEFAULT_HVAC_SHORT_CYCLE_THRESHOLD_S,
  );
  const runDisplayLimit = displayLimitOption(optionValues.runDisplayLimit);
  const normalized = normalizeTimeline(source);
  const timeline = normalized.rows;
  const rowAccounting = normalized.accounting;
  const signals = summarizeSignals(timeline);
  const builtPairs = buildPairs(timeline, maxGapS);
  const pairs = builtPairs.pairs;
  const intervals: HvacIntervalAccounting = {
    ...builtPairs.accounting,
    duplicatesRemovedBeforePairing: rowAccounting.duplicateTimestampRows,
  };
  const runs = buildRuns(timeline, pairs, shortCycleThresholdS);
  const hourlyProfile = emptyHourlyProfile();
  const transitions: HvacTransitionMatrix = {
    offToOff: 0,
    offToOn: 0,
    onToOff: 0,
    onToOn: 0,
    knownToUnknown: 0,
  };
  let totalOnObservedS = 0;
  let totalOffObservedS = 0;

  for (const pair of pairs) {
    if (pair.disposition !== 'observed') continue;
    const current = timeline[pair.index]!;
    const next = timeline[pair.index + 1]!;
    if (current.on == null) continue;
    splitIntervalByHour(pair.startMs, pair.endMs, current.on, hourlyProfile);
    if (current.on) totalOnObservedS += pair.durationS;
    else totalOffObservedS += pair.durationS;

    if (next.on == null) {
      transitions.knownToUnknown += 1;
    } else if (!current.on && !next.on) {
      transitions.offToOff += 1;
    } else if (!current.on && next.on) {
      transitions.offToOn += 1;
      hourlyProfile[new Date(next.ms).getHours()]!.onTransitions += 1;
    } else if (current.on && !next.on) {
      transitions.onToOff += 1;
    } else {
      transitions.onToOn += 1;
    }
  }
  for (const bucket of hourlyProfile) {
    bucket.dutyCycle =
      bucket.observedS > 0 ? bucket.onS / bucket.observedS : null;
    bucket.eventStarts = bucket.onTransitions;
  }

  const cadenceGaps = timeline.slice(0, -1).map(
    (row, index) => (timeline[index + 1]!.ms - row.ms) / 1000,
  );
  const earliestValidMs = timeline[0]?.ms ?? null;
  const latestValidMs = timeline[timeline.length - 1]?.ms ?? null;
  const coverage: HvacCoverage = {
    earliestValidMs,
    latestValidMs,
    spanS:
      earliestValidMs != null && latestValidMs != null
        ? (latestValidMs - earliestValidMs) / 1000
        : null,
    cadenceIntervals: cadenceGaps.length,
    medianGapS: median(cadenceGaps),
    p90GapS: percentile(cadenceGaps, 0.9),
    maxObservedGapS:
      cadenceGaps.length > 0 ? Math.max(...cadenceGaps) : null,
    longGapCount: cadenceGaps.filter((gap) => gap > maxGapS).length,
    stateCoverage:
      timeline.length > 0
        ? rowAccounting.validKnownStateRows / timeline.length
        : null,
  };

  const activeRuns = runs.filter((run) => run.on);
  const offRuns = runs.filter((run) => !run.on);
  const completeOnRuns = activeRuns.filter((run) => run.complete);
  const shortCompleteOnRuns = completeOnRuns.filter((run) => run.shortCycle);
  const allShortOnRuns = activeRuns.filter(
    (run) => run.durationS <= shortCycleThresholdS,
  );
  const observedS = totalOnObservedS + totalOffObservedS;
  const transitionCount = transitions.offToOn + transitions.onToOff;
  const boundaryAccounting: HvacBoundaryAccounting = {
    totalRunBoundaries: runs.length * 2,
    observedTransitionBoundaries: runs.reduce(
      (sum, run) =>
        sum
        + Number(run.leftBoundaryObserved)
        + Number(run.rightBoundaryObserved),
      0,
    ),
    datasetEdgeBoundaries: runs.reduce(
      (sum, run) =>
        sum
        + Number(run.leftBoundary === 'dataset_edge')
        + Number(run.rightBoundary === 'dataset_edge'),
      0,
    ),
    longGapBoundaries: runs.reduce(
      (sum, run) =>
        sum
        + Number(run.leftBoundary === 'long_gap')
        + Number(run.rightBoundary === 'long_gap'),
      0,
    ),
    unknownStateBoundaries: runs.reduce(
      (sum, run) =>
        sum
        + Number(run.leftBoundary === 'unknown_state')
        + Number(run.rightBoundary === 'unknown_state'),
      0,
    ),
    completeRuns: runs.filter((run) => run.complete).length,
    partialRuns: runs.filter((run) => !run.complete).length,
  };

  const newestFirst = [...runs].sort(
    (a, b) => b.startMs - a.startMs || b.index - a.index,
  );
  const directoryItems = newestFirst.slice(0, runDisplayLimit);
  const runIntervalSum = runs.reduce((sum, run) => sum + run.intervals, 0);
  const runDurationSum = runs.reduce((sum, run) => sum + run.durationS, 0);
  const rowOutcomeSum =
    rowAccounting.validKnownStateRows
    + rowAccounting.missingTimestampRows
    + rowAccounting.invalidTimestampRows
    + rowAccounting.duplicateTimestampRows
    + rowAccounting.uninterpretableStateRows;
  const intervalDispositionSum =
    intervals.observedIntervals
    + intervals.longGapExclusions
    + intervals.unknownStateBarriers
    + intervals.nonpositiveIntervals;

  return {
    rows: rowAccounting,
    signals,
    coverage,
    intervals,
    transitions,
    transitionCount,
    observedOnStarts: transitions.offToOn,
    runs,
    activeRunCount: activeRuns.length,
    completeCycles: completeOnRuns.length,
    completeOnRunCount: completeOnRuns.length,
    shortCompleteOnRunCount: shortCompleteOnRuns.length,
    qualifiedShortCycleRate:
      completeOnRuns.length > 0
        ? shortCompleteOnRuns.length / completeOnRuns.length
        : null,
    allOnRunShortCycleRate:
      activeRuns.length > 0 ? allShortOnRuns.length / activeRuns.length : null,
    boundaryAccounting,
    onRunQuantiles: runQuantiles(activeRuns),
    offRunQuantiles: runQuantiles(offRuns),
    completeOnRunQuantiles: runQuantiles(completeOnRuns),
    runLengthDistribution: buildDistribution(runs),
    runDirectory: {
      items: directoryItems,
      total: runs.length,
      displayed: directoryItems.length,
      omitted: Math.max(0, runs.length - directoryItems.length),
      cap: runDisplayLimit,
    },
    thresholds: {
      maxGapS,
      shortCycleThresholdS,
      runDisplayLimit,
    },
    identities: {
      rowsBalanced: rowAccounting.returnedRows === rowOutcomeSum,
      timelineBalanced:
        rowAccounting.uniqueTimestampRows
        === intervals.candidateAdjacentPairs + intervals.terminalSamples,
      intervalsBalanced:
        intervals.candidateAdjacentPairs === intervalDispositionSum,
      runIntervalsBalanced: intervals.observedIntervals === runIntervalSum,
      observedDurationBalanced:
        Math.abs(observedS - runDurationSum) < 1e-9,
    },
    totalOnObservedS,
    totalOffObservedS,
    hourlyProfile,
    analyzedSamples: rowAccounting.validKnownStateRows,
    observedS,
    dutyCycle: observedS > 0 ? totalOnObservedS / observedS : null,
    eventCount: activeRuns.length,
    medianOnS: median(activeRuns.map((run) => run.durationS)),
    medianOffS: median(offRuns.map((run) => run.durationS)),
    shortCycleRate:
      completeOnRuns.length > 0
        ? shortCompleteOnRuns.length / completeOnRuns.length
        : null,
    longestRunS:
      activeRuns.length > 0
        ? Math.max(...activeRuns.map((run) => run.durationS))
        : null,
  };
}
