import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

const DAY_S = 86_400;
const DAY_MS = DAY_S * 1_000;
const MIN_SOC_SWING_PCT = 0.05;
const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export const DEPTH_STRESS_EXPONENT = 1.7;
export const DEEP_CYCLE_THRESHOLD_PCT = 60;
export const DEFAULT_CYCLE_HISTORY_LIMIT = 1_000;
export const DEFAULT_CONTINUITY_GAP_S = 7 * DAY_S;
export const DEFAULT_BOUNDARY_JUMP_PCT = 5;
export const CYCLE_DEPTH_THRESHOLDS = [40, 50, 60, 70, 80] as const;
export const CYCLE_STRESS_EXPONENTS = [1.3, 1.5, 1.7, 2] as const;

export type CycleSource = 'drive' | 'charging';
export type CycleEvidenceBand =
  | 'none'
  | 'thin'
  | 'developing'
  | 'strong';

export type DriveCycleRowCategory =
  | 'included'
  | 'incomplete_live'
  | 'invalid_timestamp_order'
  | 'future'
  | 'missing_soc'
  | 'invalid_soc'
  | 'nonpositive_soc_drop'
  | 'overlapping_interval';

export type ChargingCycleRowCategory =
  | 'included'
  | 'incomplete_live'
  | 'invalid_timestamp_order'
  | 'future'
  | 'missing_soc'
  | 'invalid_soc'
  | 'nonpositive_soc_gain'
  | 'overlapping_interval';

export interface CycleStressOptions {
  exponent?: number;
  deepThresholdPct?: number;
  historyLimit?: number;
  maxContinuityGapS?: number;
  maxBoundaryJumpPct?: number;
  maxTrendMonths?: number;
  maxTimelinePoints?: number;
  maxRecentCycles?: number;
}

export interface ResolvedCycleStressOptions {
  exponent: number;
  deepThresholdPct: number;
  historyLimit: number;
  maxContinuityGapS: number;
  maxBoundaryJumpPct: number;
  maxTrendMonths: number;
  maxTimelinePoints: number;
  maxRecentCycles: number;
}

export interface CycleRowAccounting<Category extends string> {
  returnedRows: number;
  includedRows: number;
  excludedRows: number;
  historyLimit: number;
  historyCapReached: boolean;
  categories: Record<Category, number>;
}

export interface SocTurningPoint {
  ms: number;
  timestamp: string;
  socPct: number;
  source: CycleSource;
  kind: 'start' | 'end';
  rowId: string;
  segmentId: number;
}

export interface RainflowCycle {
  segmentId: number;
  depthPct: number;
  meanSocPct: number;
  count: 0.5 | 1;
  startMs: number;
  rangeEndMs: number;
  closedAtMs: number;
  durationS: number;
  startSocPct: number;
  endSocPct: number;
  startSource: CycleSource;
  endSource: CycleSource;
  equivalentFullCycles: number;
  depthWeightedIndex: number;
}

export interface CycleHistogramBin {
  lowerPct: number;
  upperPct: number;
  weightedCycles: number;
  equivalentFullCycles: number;
  depthWeightedIndex: number;
}

export interface CycleTrendPoint {
  monthKey: string;
  weightedCycles: number;
  equivalentFullCycles: number;
  depthWeightedIndex: number;
  meanDepthPct: number | null;
  deepCycleShare: number | null;
}

export interface CycleThresholdPoint {
  thresholdPct: number;
  weightedCycles: number;
  weightedShare: number | null;
  equivalentFullCycles: number;
  depthWeightedIndex: number;
}

export interface CycleExponentPoint {
  exponent: number;
  depthWeightedIndex: number;
  indexToEfcRatio: number | null;
}

export interface CycleMeanSocPoint {
  lowerPct: number;
  upperPct: number;
  weightedCycles: number;
  meanDepthPct: number | null;
  equivalentFullCycles: number;
  depthWeightedIndex: number;
}

export type CycleDurationBand =
  | 'under_day'
  | 'one_to_three_days'
  | 'three_to_seven_days'
  | 'seven_days_plus';

export interface CycleDurationPoint {
  band: CycleDurationBand;
  weightedCycles: number;
  meanDepthPct: number | null;
  equivalentFullCycles: number;
  depthWeightedIndex: number;
}

export interface CycleComposition {
  fullCycleRecords: number;
  halfCycleRecords: number;
  fullEquivalentFullCycles: number;
  halfEquivalentFullCycles: number;
  fullDepthWeightedIndex: number;
  halfDepthWeightedIndex: number;
}

export interface CycleStressSummary {
  weightedCycleCount: number;
  equivalentFullCycles: number;
  depthWeightedIndex: number;
  meanDepthPct: number | null;
  medianDepthPct: number | null;
  p90DepthPct: number | null;
  meanSocPct: number | null;
  deepCycleShare: number | null;
  deepEfcShare: number | null;
  composition: CycleComposition;
}

export interface CycleSourceCoverage {
  returnedRows: number;
  includedRows: number;
  firstObservationMs: number | null;
  lastObservationMs: number | null;
  observedSpanDays: number | null;
  historyCapReached: boolean;
}

export interface CycleSupportIngredient {
  value: number;
  target: number;
  score: number;
}

export interface CycleEvidenceSupport {
  index: number;
  band: CycleEvidenceBand;
  intervals: CycleSupportIngredient;
  cycles: CycleSupportIngredient;
  activeWeeks: CycleSupportIngredient;
  recency: CycleSupportIngredient;
  sourceCoverage: CycleSupportIngredient;
}

export interface CycleContinuity {
  acceptedIntervals: number;
  rawBoundaryPoints: number;
  retainedObservations: number;
  turningPoints: number;
  compactedPoints: number;
  segmentCount: number;
  timeGapBoundaries: number;
  socJumpBoundaries: number;
  coincidentBoundaryCollapses: number;
  overlappingIntervals: number;
}

export interface CycleCoverage {
  drive: CycleSourceCoverage;
  charging: CycleSourceCoverage;
  activeLocalDays: number;
  activeLocalWeeks: number;
  firstObservationMs: number | null;
  lastObservationMs: number | null;
  observedSpanDays: number | null;
  daysSinceLastObservation: number | null;
  commonSourceOverlapDays: number | null;
  returnedTrendMonths: number;
  displayedTrendMonths: number;
  omittedTrendMonths: number;
  timelinePoints: number;
  omittedTimelinePoints: number;
  support: CycleEvidenceSupport;
}

export interface CycleStressResult {
  nowMs: number;
  timeZone: string;
  config: ResolvedCycleStressOptions;
  driveAccounting: CycleRowAccounting<DriveCycleRowCategory>;
  chargingAccounting: CycleRowAccounting<ChargingCycleRowCategory>;
  continuity: CycleContinuity;
  coverage: CycleCoverage;
  summary: CycleStressSummary;
  turningPoints: SocTurningPoint[];
  timeline: SocTurningPoint[];
  cycles: RainflowCycle[];
  recentCycles: RainflowCycle[];
  histogram: CycleHistogramBin[];
  monthTrend: CycleTrendPoint[];
  thresholdSensitivity: CycleThresholdPoint[];
  exponentSensitivity: CycleExponentPoint[];
  meanSocProfile: CycleMeanSocPoint[];
  durationProfile: CycleDurationPoint[];
}

interface CycleInterval {
  source: CycleSource;
  rowId: string;
  sourceIndex: number;
  startMs: number;
  endMs: number;
  startSocPct: number;
  endSocPct: number;
}

interface ClassifiedInterval<Category extends string> {
  interval: CycleInterval | null;
  category: Category | null;
}

interface ObservationSegment {
  id: number;
  observations: SocTurningPoint[];
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  dateKey: string;
  monthKey: string;
  weekKey: string;
}

const DEFAULTS: ResolvedCycleStressOptions = {
  exponent: DEPTH_STRESS_EXPONENT,
  deepThresholdPct: DEEP_CYCLE_THRESHOLD_PCT,
  historyLimit: DEFAULT_CYCLE_HISTORY_LIMIT,
  maxContinuityGapS: DEFAULT_CONTINUITY_GAP_S,
  maxBoundaryJumpPct: DEFAULT_BOUNDARY_JUMP_PCT,
  maxTrendMonths: 18,
  maxTimelinePoints: 200,
  maxRecentCycles: 25,
};

const HISTOGRAM_EDGES = [0, 10, 25, 50, 75, 100] as const;
const MEAN_SOC_EDGES = [0, 20, 40, 60, 80, 100] as const;

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function clampNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function resolveOptions(
  options: CycleStressOptions,
): ResolvedCycleStressOptions {
  return {
    exponent: clampNumber(options.exponent, DEFAULTS.exponent, 1, 3),
    deepThresholdPct: clampNumber(
      options.deepThresholdPct,
      DEFAULTS.deepThresholdPct,
      1,
      100,
    ),
    historyLimit: clampInteger(
      options.historyLimit,
      DEFAULTS.historyLimit,
      1,
      1_000,
    ),
    maxContinuityGapS: clampNumber(
      options.maxContinuityGapS,
      DEFAULTS.maxContinuityGapS,
      0,
      90 * DAY_S,
    ),
    maxBoundaryJumpPct: clampNumber(
      options.maxBoundaryJumpPct,
      DEFAULTS.maxBoundaryJumpPct,
      0,
      100,
    ),
    maxTrendMonths: clampInteger(
      options.maxTrendMonths,
      DEFAULTS.maxTrendMonths,
      1,
      60,
    ),
    maxTimelinePoints: clampInteger(
      options.maxTimelinePoints,
      DEFAULTS.maxTimelinePoints,
      10,
      1_000,
    ),
    maxRecentCycles: clampInteger(
      options.maxRecentCycles,
      DEFAULTS.maxRecentCycles,
      1,
      100,
    ),
  };
}

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function timestampText(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (value?.trim()) return value;
  }
  return null;
}

function finiteMs(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

function isMissingSoc(value: number | null | undefined): boolean {
  return value == null;
}

function finiteSoc(value: number | null | undefined): number | null {
  return value != null
    && Number.isFinite(value)
    && value >= 0
    && value <= 100
    ? value
    : null;
}

function classifyDrive(
  drive: Drive,
  sourceIndex: number,
  nowMs: number,
): ClassifiedInterval<DriveCycleRowCategory> {
  if (!drive.endTs?.trim()) {
    return { interval: null, category: 'incomplete_live' };
  }
  const startMs = finiteMs(timestampText(drive.startTs));
  const endMs = finiteMs(timestampText(drive.endTs));
  if (
    startMs == null
    || endMs == null
    || endMs <= startMs
  ) {
    return { interval: null, category: 'invalid_timestamp_order' };
  }
  if (endMs > nowMs) {
    return { interval: null, category: 'future' };
  }
  if (
    isMissingSoc(drive.startBatteryPct)
    || isMissingSoc(drive.endBatteryPct)
  ) {
    return { interval: null, category: 'missing_soc' };
  }
  const startSocPct = finiteSoc(drive.startBatteryPct);
  const endSocPct = finiteSoc(drive.endBatteryPct);
  if (startSocPct == null || endSocPct == null) {
    return { interval: null, category: 'invalid_soc' };
  }
  if (startSocPct - endSocPct <= MIN_SOC_SWING_PCT) {
    return { interval: null, category: 'nonpositive_soc_drop' };
  }
  return {
    interval: {
      source: 'drive',
      rowId: `drive:${drive.id}`,
      sourceIndex,
      startMs,
      endMs,
      startSocPct,
      endSocPct,
    },
    category: null,
  };
}

function classifyCharging(
  session: ChargingSession,
  sourceIndex: number,
  nowMs: number,
): ClassifiedInterval<ChargingCycleRowCategory> {
  const startTs = timestampText(
    session.started_at,
    session.start_ts,
    session.startedAt,
  );
  const endTs = timestampText(session.ended_at);
  if (!endTs) {
    return { interval: null, category: 'incomplete_live' };
  }
  const startMs = finiteMs(startTs);
  const endMs = finiteMs(endTs);
  if (
    startMs == null
    || endMs == null
    || endMs <= startMs
  ) {
    return { interval: null, category: 'invalid_timestamp_order' };
  }
  if (endMs > nowMs) {
    return { interval: null, category: 'future' };
  }
  if (
    isMissingSoc(session.start_soc_pct)
    || isMissingSoc(session.end_soc_pct)
  ) {
    return { interval: null, category: 'missing_soc' };
  }
  const startSocPct = finiteSoc(session.start_soc_pct);
  const endSocPct = finiteSoc(session.end_soc_pct);
  if (startSocPct == null || endSocPct == null) {
    return { interval: null, category: 'invalid_soc' };
  }
  if (endSocPct - startSocPct <= MIN_SOC_SWING_PCT) {
    return { interval: null, category: 'nonpositive_soc_gain' };
  }
  return {
    interval: {
      source: 'charging',
      rowId: `charging:${session.id}`,
      sourceIndex,
      startMs,
      endMs,
      startSocPct,
      endSocPct,
    },
    category: null,
  };
}

function emptyDriveCategories(): Record<
  DriveCycleRowCategory,
  number
> {
  return {
    included: 0,
    incomplete_live: 0,
    invalid_timestamp_order: 0,
    future: 0,
    missing_soc: 0,
    invalid_soc: 0,
    nonpositive_soc_drop: 0,
    overlapping_interval: 0,
  };
}

function emptyChargingCategories(): Record<
  ChargingCycleRowCategory,
  number
> {
  return {
    included: 0,
    incomplete_live: 0,
    invalid_timestamp_order: 0,
    future: 0,
    missing_soc: 0,
    invalid_soc: 0,
    nonpositive_soc_gain: 0,
    overlapping_interval: 0,
  };
}

function buildIntervals(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  nowMs: number,
  historyLimit: number,
): {
  intervals: CycleInterval[];
  driveAccounting: CycleRowAccounting<DriveCycleRowCategory>;
  chargingAccounting: CycleRowAccounting<ChargingCycleRowCategory>;
} {
  const driveCategories = emptyDriveCategories();
  const chargingCategories = emptyChargingCategories();
  const candidates: CycleInterval[] = [];

  drives.forEach((drive, sourceIndex) => {
    const classified = classifyDrive(drive, sourceIndex, nowMs);
    if (classified.interval) candidates.push(classified.interval);
    else if (classified.category) driveCategories[classified.category] += 1;
  });
  sessions.forEach((session, sourceIndex) => {
    const classified = classifyCharging(session, sourceIndex, nowMs);
    if (classified.interval) candidates.push(classified.interval);
    else if (classified.category) {
      chargingCategories[classified.category] += 1;
    }
  });

  candidates.sort(
    (left, right) =>
      left.startMs - right.startMs
      || left.endMs - right.endMs
      || left.source.localeCompare(right.source)
      || left.sourceIndex - right.sourceIndex,
  );
  const intervals: CycleInterval[] = [];
  for (const interval of candidates) {
    const previous = intervals[intervals.length - 1];
    if (previous && interval.startMs < previous.endMs) {
      if (interval.source === 'drive') {
        driveCategories.overlapping_interval += 1;
      } else {
        chargingCategories.overlapping_interval += 1;
      }
      continue;
    }
    intervals.push(interval);
    if (interval.source === 'drive') driveCategories.included += 1;
    else chargingCategories.included += 1;
  }

  const driveIncluded = driveCategories.included;
  const chargingIncluded = chargingCategories.included;
  return {
    intervals,
    driveAccounting: {
      returnedRows: drives.length,
      includedRows: driveIncluded,
      excludedRows: drives.length - driveIncluded,
      historyLimit,
      historyCapReached: drives.length >= historyLimit,
      categories: driveCategories,
    },
    chargingAccounting: {
      returnedRows: sessions.length,
      includedRows: chargingIncluded,
      excludedRows: sessions.length - chargingIncluded,
      historyLimit,
      historyCapReached: sessions.length >= historyLimit,
      categories: chargingCategories,
    },
  };
}

function observation(
  interval: CycleInterval,
  kind: 'start' | 'end',
  segmentId: number,
): SocTurningPoint {
  const ms = kind === 'start' ? interval.startMs : interval.endMs;
  return {
    ms,
    timestamp: new Date(ms).toISOString(),
    socPct:
      kind === 'start' ? interval.startSocPct : interval.endSocPct,
    source: interval.source,
    kind,
    rowId: interval.rowId,
    segmentId,
  };
}

function appendObservation(
  points: SocTurningPoint[],
  point: SocTurningPoint,
): 'added' | 'collapsed' | 'ignored' {
  const previous = points[points.length - 1];
  if (!previous) {
    points.push(point);
    return 'added';
  }
  if (previous.ms === point.ms) {
    points[points.length - 1] = point;
    return 'collapsed';
  }
  if (Math.abs(previous.socPct - point.socPct) < MIN_SOC_SWING_PCT) {
    return 'ignored';
  }
  points.push(point);
  return 'added';
}

function buildObservationSegments(
  intervals: readonly CycleInterval[],
  config: ResolvedCycleStressOptions,
): {
  segments: ObservationSegment[];
  retainedObservations: number;
  timeGapBoundaries: number;
  socJumpBoundaries: number;
  coincidentBoundaryCollapses: number;
} {
  const segments: ObservationSegment[] = [];
  let current: ObservationSegment | null = null;
  let previous: CycleInterval | null = null;
  let timeGapBoundaries = 0;
  let socJumpBoundaries = 0;
  let coincidentBoundaryCollapses = 0;

  for (const interval of intervals) {
    const gapS =
      previous == null ? null : (interval.startMs - previous.endMs) / 1_000;
    const boundaryJump =
      previous == null
        ? null
        : Math.abs(interval.startSocPct - previous.endSocPct);
    const startsNew =
      previous == null
      || (gapS != null && gapS > config.maxContinuityGapS)
      || (
        boundaryJump != null
        && boundaryJump > config.maxBoundaryJumpPct
      );

    if (startsNew) {
      if (previous != null) {
        if (gapS != null && gapS > config.maxContinuityGapS) {
          timeGapBoundaries += 1;
        } else {
          socJumpBoundaries += 1;
        }
      }
      current = { id: segments.length + 1, observations: [] };
      segments.push(current);
    }

    const startResult = appendObservation(
      current!.observations,
      observation(interval, 'start', current!.id),
    );
    if (startResult === 'collapsed') coincidentBoundaryCollapses += 1;
    const endResult = appendObservation(
      current!.observations,
      observation(interval, 'end', current!.id),
    );
    if (endResult === 'collapsed') coincidentBoundaryCollapses += 1;
    previous = interval;
  }

  return {
    segments,
    retainedObservations: segments.reduce(
      (total, segment) => total + segment.observations.length,
      0,
    ),
    timeGapBoundaries,
    socJumpBoundaries,
    coincidentBoundaryCollapses,
  };
}

function compactTurningPoints(
  observations: readonly SocTurningPoint[],
): SocTurningPoint[] {
  if (observations.length <= 2) return [...observations];
  const turns: SocTurningPoint[] = [observations[0]!];
  for (let index = 1; index < observations.length - 1; index += 1) {
    const before = observations[index - 1]!;
    const current = observations[index]!;
    const after = observations[index + 1]!;
    const incoming = current.socPct - before.socPct;
    const outgoing = after.socPct - current.socPct;
    if (incoming * outgoing < 0) turns.push(current);
  }
  turns.push(observations[observations.length - 1]!);
  return turns;
}

function makeCycle(
  start: SocTurningPoint,
  end: SocTurningPoint,
  count: 0.5 | 1,
  closedAtMs: number,
  exponent: number,
): RainflowCycle {
  const depthPct = Math.abs(end.socPct - start.socPct);
  const depth = depthPct / 100;
  return {
    segmentId: start.segmentId,
    depthPct,
    meanSocPct: (start.socPct + end.socPct) / 2,
    count,
    startMs: Math.min(start.ms, end.ms),
    rangeEndMs: Math.max(start.ms, end.ms),
    closedAtMs,
    durationS:
      Math.max(0, closedAtMs - Math.min(start.ms, end.ms)) / 1_000,
    startSocPct: start.socPct,
    endSocPct: end.socPct,
    startSource: start.source,
    endSource: end.source,
    equivalentFullCycles: count * depth,
    depthWeightedIndex: count * depth ** exponent,
  };
}

export function extractRainflowCycles(
  turningPoints: readonly SocTurningPoint[],
  exponent = DEPTH_STRESS_EXPONENT,
): RainflowCycle[] {
  const stack: SocTurningPoint[] = [];
  const cycles: RainflowCycle[] = [];

  for (const point of turningPoints) {
    stack.push(point);
    while (stack.length >= 3) {
      const size = stack.length;
      const a = stack[size - 3]!;
      const b = stack[size - 2]!;
      const c = stack[size - 1]!;
      const olderRange = Math.abs(b.socPct - a.socPct);
      const newerRange = Math.abs(c.socPct - b.socPct);
      if (newerRange < olderRange) break;

      if (size === 3) {
        if (olderRange >= MIN_SOC_SWING_PCT) {
          cycles.push(makeCycle(a, b, 0.5, b.ms, exponent));
        }
        stack.shift();
      } else {
        if (olderRange >= MIN_SOC_SWING_PCT) {
          cycles.push(makeCycle(a, b, 1, c.ms, exponent));
        }
        stack.splice(size - 3, 2);
      }
    }
  }

  for (let index = 0; index < stack.length - 1; index += 1) {
    const a = stack[index]!;
    const b = stack[index + 1]!;
    if (Math.abs(a.socPct - b.socPct) >= MIN_SOC_SWING_PCT) {
      cycles.push(makeCycle(a, b, 0.5, b.ms, exponent));
    }
  }
  return cycles.sort(
    (left, right) =>
      left.closedAtMs - right.closedAtMs
      || left.startMs - right.startMs,
  );
}

function resolveTimeZone(candidate: string): string {
  const trimmed = candidate.trim();
  if (!trimmed) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(0);
    return trimmed;
  } catch {
    return 'UTC';
  }
}

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = PARTS_FORMATTERS.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(
    'en-US-u-ca-gregory-nu-latn',
    {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
  );
  PARTS_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function localWeekKey(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const mondayIndex = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayIndex);
  return date.toISOString().slice(0, 10);
}

function localParts(ms: number, timeZone: string): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const parsed = Number(parts.find((part) => part.type === type)?.value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const year = value('year');
  const month = value('month');
  const day = value('day');
  return {
    year,
    month,
    day,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    monthKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
    weekKey: localWeekKey(year, month, day),
  };
}

function dateOrdinal(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / DAY_MS;
}

function addMonths(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + amount, 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function weightedSum(
  cycles: readonly RainflowCycle[],
  value: (cycle: RainflowCycle) => number,
): number {
  return cycles.reduce(
    (total, cycle) => total + value(cycle) * cycle.count,
    0,
  );
}

function weightedMean(
  cycles: readonly RainflowCycle[],
  value: (cycle: RainflowCycle) => number,
): number | null {
  const weight = cycles.reduce((total, cycle) => total + cycle.count, 0);
  return weight > 0 ? weightedSum(cycles, value) / weight : null;
}

function weightedQuantile(
  cycles: readonly RainflowCycle[],
  value: (cycle: RainflowCycle) => number,
  quantile: number,
): number | null {
  if (cycles.length === 0) return null;
  const sorted = [...cycles].sort(
    (left, right) => value(left) - value(right),
  );
  const total = sorted.reduce((sum, cycle) => sum + cycle.count, 0);
  const target = Math.min(1, Math.max(0, quantile)) * total;
  let cumulative = 0;
  for (const cycle of sorted) {
    cumulative += cycle.count;
    if (cumulative >= target) return value(cycle);
  }
  return value(sorted[sorted.length - 1]!);
}

function cycleAggregates(cycles: readonly RainflowCycle[]) {
  const weightedCycles = cycles.reduce(
    (sum, cycle) => sum + cycle.count,
    0,
  );
  const equivalentFullCycles = cycles.reduce(
    (sum, cycle) => sum + cycle.equivalentFullCycles,
    0,
  );
  const depthWeightedIndex = cycles.reduce(
    (sum, cycle) => sum + cycle.depthWeightedIndex,
    0,
  );
  return {
    weightedCycles: round(weightedCycles),
    equivalentFullCycles: round(equivalentFullCycles),
    depthWeightedIndex: round(depthWeightedIndex),
    meanDepthPct:
      weightedCycles > 0
        ? round(
            weightedSum(cycles, (cycle) => cycle.depthPct)
              / weightedCycles,
          )
        : null,
  };
}

function buildSummary(
  cycles: readonly RainflowCycle[],
  deepThresholdPct: number,
): CycleStressSummary {
  const aggregates = cycleAggregates(cycles);
  const deep = cycles.filter(
    (cycle) => cycle.depthPct >= deepThresholdPct,
  );
  const deepAggregates = cycleAggregates(deep);
  const full = cycles.filter((cycle) => cycle.count === 1);
  const half = cycles.filter((cycle) => cycle.count === 0.5);

  return {
    weightedCycleCount: aggregates.weightedCycles,
    equivalentFullCycles: aggregates.equivalentFullCycles,
    depthWeightedIndex: aggregates.depthWeightedIndex,
    meanDepthPct: aggregates.meanDepthPct,
    medianDepthPct:
      cycles.length > 0
        ? round(weightedQuantile(cycles, (cycle) => cycle.depthPct, 0.5)!)
        : null,
    p90DepthPct:
      cycles.length > 0
        ? round(weightedQuantile(cycles, (cycle) => cycle.depthPct, 0.9)!)
        : null,
    meanSocPct:
      cycles.length > 0
        ? round(weightedMean(cycles, (cycle) => cycle.meanSocPct)!)
        : null,
    deepCycleShare:
      aggregates.weightedCycles > 0
        ? round(
            deepAggregates.weightedCycles
              / aggregates.weightedCycles,
          )
        : null,
    deepEfcShare:
      aggregates.equivalentFullCycles > 0
        ? round(
            deepAggregates.equivalentFullCycles
              / aggregates.equivalentFullCycles,
          )
        : null,
    composition: {
      fullCycleRecords: full.length,
      halfCycleRecords: half.length,
      fullEquivalentFullCycles: round(
        full.reduce(
          (sum, cycle) => sum + cycle.equivalentFullCycles,
          0,
        ),
      ),
      halfEquivalentFullCycles: round(
        half.reduce(
          (sum, cycle) => sum + cycle.equivalentFullCycles,
          0,
        ),
      ),
      fullDepthWeightedIndex: round(
        full.reduce(
          (sum, cycle) => sum + cycle.depthWeightedIndex,
          0,
        ),
      ),
      halfDepthWeightedIndex: round(
        half.reduce(
          (sum, cycle) => sum + cycle.depthWeightedIndex,
          0,
        ),
      ),
    },
  };
}

function buildHistogram(
  cycles: readonly RainflowCycle[],
): CycleHistogramBin[] {
  return HISTOGRAM_EDGES.slice(0, -1).map((lowerPct, index) => {
    const upperPct = HISTOGRAM_EDGES[index + 1]!;
    const members = cycles.filter(
      (cycle) =>
        cycle.depthPct >= lowerPct
        && (
          index === HISTOGRAM_EDGES.length - 2
            ? cycle.depthPct <= upperPct
            : cycle.depthPct < upperPct
        ),
    );
    return {
      lowerPct,
      upperPct,
      ...cycleAggregates(members),
    };
  });
}

function buildMonthTrend(
  cycles: readonly RainflowCycle[],
  timeZone: string,
  config: ResolvedCycleStressOptions,
): {
  returnedMonths: number;
  points: CycleTrendPoint[];
} {
  if (cycles.length === 0) return { returnedMonths: 0, points: [] };
  const grouped = new Map<string, RainflowCycle[]>();
  for (const cycle of cycles) {
    const key = localParts(cycle.closedAtMs, timeZone).monthKey;
    const rows = grouped.get(key) ?? [];
    rows.push(cycle);
    grouped.set(key, rows);
  }
  const first = Array.from(grouped.keys()).sort()[0]!;
  const orderedKeys = Array.from(grouped.keys()).sort();
  const latest = orderedKeys[orderedKeys.length - 1]!;
  const all: CycleTrendPoint[] = [];
  for (let month = first; month <= latest; month = addMonths(month, 1)) {
    const members = grouped.get(month) ?? [];
    const aggregates = cycleAggregates(members);
    const deepWeight = members
      .filter((cycle) => cycle.depthPct >= config.deepThresholdPct)
      .reduce((sum, cycle) => sum + cycle.count, 0);
    all.push({
      monthKey: month,
      ...aggregates,
      deepCycleShare:
        aggregates.weightedCycles > 0
          ? round(deepWeight / aggregates.weightedCycles)
          : null,
    });
    if (month === latest) break;
  }
  return {
    returnedMonths: all.length,
    points: all.slice(-config.maxTrendMonths),
  };
}

function buildThresholdSensitivity(
  cycles: readonly RainflowCycle[],
  selectedThreshold: number,
): CycleThresholdPoint[] {
  const thresholds = Array.from(
    new Set([...CYCLE_DEPTH_THRESHOLDS, selectedThreshold]),
  ).sort((left, right) => left - right);
  const totalWeight = cycles.reduce(
    (sum, cycle) => sum + cycle.count,
    0,
  );
  return thresholds.map((thresholdPct) => {
    const members = cycles.filter(
      (cycle) => cycle.depthPct >= thresholdPct,
    );
    const aggregates = cycleAggregates(members);
    return {
      thresholdPct,
      weightedCycles: aggregates.weightedCycles,
      weightedShare:
        totalWeight > 0
          ? round(aggregates.weightedCycles / totalWeight)
          : null,
      equivalentFullCycles: aggregates.equivalentFullCycles,
      depthWeightedIndex: aggregates.depthWeightedIndex,
    };
  });
}

function buildExponentSensitivity(
  cycles: readonly RainflowCycle[],
  selectedExponent: number,
  equivalentFullCycles: number,
): CycleExponentPoint[] {
  const exponents = Array.from(
    new Set([...CYCLE_STRESS_EXPONENTS, selectedExponent]),
  ).sort((left, right) => left - right);
  return exponents.map((exponent) => {
    const index = cycles.reduce(
      (sum, cycle) =>
        sum + cycle.count * (cycle.depthPct / 100) ** exponent,
      0,
    );
    return {
      exponent,
      depthWeightedIndex: round(index),
      indexToEfcRatio:
        equivalentFullCycles > 0
          ? round(index / equivalentFullCycles)
          : null,
    };
  });
}

function buildMeanSocProfile(
  cycles: readonly RainflowCycle[],
): CycleMeanSocPoint[] {
  return MEAN_SOC_EDGES.slice(0, -1).map((lowerPct, index) => {
    const upperPct = MEAN_SOC_EDGES[index + 1]!;
    const members = cycles.filter(
      (cycle) =>
        cycle.meanSocPct >= lowerPct
        && (
          index === MEAN_SOC_EDGES.length - 2
            ? cycle.meanSocPct <= upperPct
            : cycle.meanSocPct < upperPct
        ),
    );
    return {
      lowerPct,
      upperPct,
      ...cycleAggregates(members),
    };
  });
}

function durationBand(durationS: number): CycleDurationBand {
  if (durationS < DAY_S) return 'under_day';
  if (durationS < 3 * DAY_S) return 'one_to_three_days';
  if (durationS < 7 * DAY_S) return 'three_to_seven_days';
  return 'seven_days_plus';
}

function buildDurationProfile(
  cycles: readonly RainflowCycle[],
): CycleDurationPoint[] {
  const bands: CycleDurationBand[] = [
    'under_day',
    'one_to_three_days',
    'three_to_seven_days',
    'seven_days_plus',
  ];
  return bands.map((band) => {
    const members = cycles.filter(
      (cycle) => durationBand(cycle.durationS) === band,
    );
    return {
      band,
      ...cycleAggregates(members),
    };
  });
}

function sourceCoverage(
  source: CycleSource,
  intervals: readonly CycleInterval[],
  accounting:
    | CycleRowAccounting<DriveCycleRowCategory>
    | CycleRowAccounting<ChargingCycleRowCategory>,
): CycleSourceCoverage {
  const rows = intervals.filter((interval) => interval.source === source);
  return {
    returnedRows: accounting.returnedRows,
    includedRows: rows.length,
    firstObservationMs:
      rows.length > 0
        ? Math.min(...rows.map((row) => row.startMs))
        : null,
    lastObservationMs:
      rows.length > 0
        ? Math.max(...rows.map((row) => row.endMs))
        : null,
    observedSpanDays:
      rows.length > 0
        ? round(
            (
              Math.max(...rows.map((row) => row.endMs))
              - Math.min(...rows.map((row) => row.startMs))
            ) / DAY_MS,
            1,
          )
        : null,
    historyCapReached: accounting.historyCapReached,
  };
}

function supportIngredient(value: number, target: number) {
  return {
    value,
    target,
    score: target > 0 ? Math.min(1, value / target) : 0,
  };
}

function recencyScore(days: number | null): number {
  if (days == null) return 0;
  if (days <= 7) return 1;
  if (days <= 30) return 0.75;
  if (days <= 90) return 0.5;
  if (days <= 180) return 0.25;
  return 0;
}

function buildSupport(
  intervals: number,
  weightedCycles: number,
  activeWeeks: number,
  daysSinceLast: number | null,
  sourcesWithRows: number,
): CycleEvidenceSupport {
  const intervalIngredient = supportIngredient(intervals, 50);
  const cycleIngredient = supportIngredient(weightedCycles, 20);
  const weekIngredient = supportIngredient(activeWeeks, 8);
  const recency = {
    value: daysSinceLast ?? 0,
    target: 30,
    score: recencyScore(daysSinceLast),
  };
  const sourceIngredient = supportIngredient(sourcesWithRows, 2);
  const index = round(
    100
      * (
        0.25 * intervalIngredient.score
        + 0.25 * cycleIngredient.score
        + 0.2 * weekIngredient.score
        + 0.15 * recency.score
        + 0.15 * sourceIngredient.score
      ),
    1,
  );
  const band: CycleEvidenceBand =
    intervals === 0
      ? 'none'
      : index < 35
        ? 'thin'
        : index < 70
          ? 'developing'
          : 'strong';
  return {
    index,
    band,
    intervals: intervalIngredient,
    cycles: cycleIngredient,
    activeWeeks: weekIngredient,
    recency,
    sourceCoverage: sourceIngredient,
  };
}

export function analyzeCycleStress(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  nowMs: number,
  requestedTimeZone: string,
  options: CycleStressOptions = {},
): CycleStressResult {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError('Cycle Stress analysis requires a finite clock');
  }
  const config = resolveOptions(options);
  const timeZone = resolveTimeZone(requestedTimeZone);
  const intervalResult = buildIntervals(
    sessions,
    drives,
    nowMs,
    config.historyLimit,
  );
  const sequenceResult = buildObservationSegments(
    intervalResult.intervals,
    config,
  );
  const compactedSegments = sequenceResult.segments.map((segment) => ({
    ...segment,
    turningPoints: compactTurningPoints(segment.observations),
  }));
  const turningPoints = compactedSegments.flatMap(
    (segment) => segment.turningPoints,
  );
  const cycles = compactedSegments.flatMap((segment) =>
    extractRainflowCycles(segment.turningPoints, config.exponent),
  ).sort(
    (left, right) =>
      left.closedAtMs - right.closedAtMs
      || left.startMs - right.startMs,
  );
  const summary = buildSummary(cycles, config.deepThresholdPct);
  const trend = buildMonthTrend(cycles, timeZone, config);
  const evidenceParts = intervalResult.intervals.flatMap((interval) => [
    localParts(interval.startMs, timeZone),
    localParts(interval.endMs, timeZone),
  ]);
  const activeDates = Array.from(
    new Set(evidenceParts.map((parts) => parts.dateKey)),
  ).sort();
  const activeWeeks = new Set(
    evidenceParts.map((parts) => parts.weekKey),
  );
  const evidenceMs = intervalResult.intervals.flatMap((interval) => [
    interval.startMs,
    interval.endMs,
  ]);
  const firstObservationMs =
    evidenceMs.length > 0 ? Math.min(...evidenceMs) : null;
  const lastObservationMs =
    evidenceMs.length > 0 ? Math.max(...evidenceMs) : null;
  const daysSinceLastObservation =
    lastObservationMs == null
      ? null
      : Math.max(0, (nowMs - lastObservationMs) / DAY_MS);
  const driveCoverage = sourceCoverage(
    'drive',
    intervalResult.intervals,
    intervalResult.driveAccounting,
  );
  const chargingCoverage = sourceCoverage(
    'charging',
    intervalResult.intervals,
    intervalResult.chargingAccounting,
  );
  const commonSourceStart =
    driveCoverage.firstObservationMs != null
    && chargingCoverage.firstObservationMs != null
      ? Math.max(
          driveCoverage.firstObservationMs,
          chargingCoverage.firstObservationMs,
        )
      : null;
  const commonSourceEnd =
    driveCoverage.lastObservationMs != null
    && chargingCoverage.lastObservationMs != null
      ? Math.min(
          driveCoverage.lastObservationMs,
          chargingCoverage.lastObservationMs,
        )
      : null;
  const sourcesWithRows =
    (driveCoverage.includedRows > 0 ? 1 : 0)
    + (chargingCoverage.includedRows > 0 ? 1 : 0);

  return {
    nowMs,
    timeZone,
    config,
    driveAccounting: intervalResult.driveAccounting,
    chargingAccounting: intervalResult.chargingAccounting,
    continuity: {
      acceptedIntervals: intervalResult.intervals.length,
      rawBoundaryPoints: intervalResult.intervals.length * 2,
      retainedObservations: sequenceResult.retainedObservations,
      turningPoints: turningPoints.length,
      compactedPoints:
        sequenceResult.retainedObservations - turningPoints.length,
      segmentCount: sequenceResult.segments.length,
      timeGapBoundaries: sequenceResult.timeGapBoundaries,
      socJumpBoundaries: sequenceResult.socJumpBoundaries,
      coincidentBoundaryCollapses:
        sequenceResult.coincidentBoundaryCollapses,
      overlappingIntervals:
        intervalResult.driveAccounting.categories.overlapping_interval
        + intervalResult.chargingAccounting.categories.overlapping_interval,
    },
    coverage: {
      drive: driveCoverage,
      charging: chargingCoverage,
      activeLocalDays: activeDates.length,
      activeLocalWeeks: activeWeeks.size,
      firstObservationMs,
      lastObservationMs,
      observedSpanDays:
        activeDates.length > 0
          ? dateOrdinal(activeDates[activeDates.length - 1]!)
            - dateOrdinal(activeDates[0]!)
            + 1
          : null,
      daysSinceLastObservation,
      commonSourceOverlapDays:
        commonSourceStart != null
        && commonSourceEnd != null
        && commonSourceEnd >= commonSourceStart
          ? round((commonSourceEnd - commonSourceStart) / DAY_MS, 1)
          : null,
      returnedTrendMonths: trend.returnedMonths,
      displayedTrendMonths: trend.points.length,
      omittedTrendMonths:
        trend.returnedMonths - trend.points.length,
      timelinePoints: Math.min(
        turningPoints.length,
        config.maxTimelinePoints,
      ),
      omittedTimelinePoints: Math.max(
        0,
        turningPoints.length - config.maxTimelinePoints,
      ),
      support: buildSupport(
        intervalResult.intervals.length,
        summary.weightedCycleCount,
        activeWeeks.size,
        daysSinceLastObservation,
        sourcesWithRows,
      ),
    },
    summary,
    turningPoints,
    timeline: turningPoints.slice(-config.maxTimelinePoints),
    cycles,
    recentCycles: [...cycles]
      .sort(
        (left, right) =>
          right.closedAtMs - left.closedAtMs
          || right.startMs - left.startMs,
      )
      .slice(0, config.maxRecentCycles),
    histogram: buildHistogram(cycles),
    monthTrend: trend.points,
    thresholdSensitivity: buildThresholdSensitivity(
      cycles,
      config.deepThresholdPct,
    ),
    exponentSensitivity: buildExponentSensitivity(
      cycles,
      config.exponent,
      summary.equivalentFullCycles,
    ),
    meanSocProfile: buildMeanSocProfile(cycles),
    durationProfile: buildDurationProfile(cycles),
  };
}
