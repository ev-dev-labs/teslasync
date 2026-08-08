/**
 * Arrival timing evidence for directional routes.
 *
 * This module is deliberately descriptive. It does not consume a promised
 * arrival, calendar target, traffic, weather, or held-out outcome. Calendar
 * fields are derived with an explicit IANA timezone and the analysis clock is
 * injected by the caller.
 */
import type { Drive } from '@/types/driving';

const MS_PER_DAY = 86_400_000;
const BUCKET_HOURS = 2;
const SCALED_MAD_FACTOR = 1.4826;
const MAX_NORMALIZED_DURATION_INDEX = 1_000;

export type ArrivalEvidenceBand = 'none' | 'thin' | 'developing' | 'strong';

export interface ArrivalReliabilityOptions {
  minRouteSamples?: number;
  minWindowSamples?: number;
  historyLimit?: number;
  strongRouteSamples?: number;
  strongRouteActiveDays?: number;
  strongRouteActiveWeeks?: number;
  strongGlobalDrives?: number;
  strongGlobalRoutes?: number;
  strongGlobalActiveWeeks?: number;
}

export interface ResolvedArrivalReliabilityOptions {
  minRouteSamples: number;
  minWindowSamples: number;
  historyLimit: number;
  strongRouteSamples: number;
  strongRouteActiveDays: number;
  strongRouteActiveWeeks: number;
  strongGlobalDrives: number;
  strongGlobalRoutes: number;
  strongGlobalActiveWeeks: number;
}

export interface RouteLocation {
  key: string;
  label: string;
}

export interface ArrivalReliabilityAccounting {
  returnedRows: number;
  includedRows: number;
  excludedRows: number;
  incompleteRows: number;
  invalidTimestampOrOrderRows: number;
  futureRows: number;
  invalidDurationRows: number;
  unlocatableRows: number;
  historyLimit: number;
  historyCapReached: boolean;
}

export interface TimingSummary {
  samples: number;
  p10DurationS: number;
  p50DurationS: number;
  p90DurationS: number;
  robustSpreadS: number;
  p90BufferS: number;
  allowanceThresholdS: number;
  withinAllowanceCount: number;
  withinAllowanceShare: number;
  relativeSpread: number;
  timingConsistencyIndex: number;
}

export interface RouteSupport {
  index: number;
  band: ArrivalEvidenceBand;
  sampleVolumeIngredient: number;
  activeDayIngredient: number;
  activeWeekIngredient: number;
}

export interface ReliabilityWindow extends TimingSummary {
  routeKey: string;
  routeLabel: string;
  bucketStartHour: number;
  firstObservationMs: number;
  lastObservationMs: number;
}

export interface RouteReliability extends TimingSummary {
  key: string;
  label: string;
  activeLocalDays: number;
  activeLocalWeeks: number;
  firstObservationMs: number;
  lastObservationMs: number;
  support: RouteSupport;
  windows: ReliabilityWindow[];
}

export interface TwoHourProfilePoint {
  bucketStartHour: number;
  samples: number;
  normalizedDurationIndex: number | null;
  withinAllowanceCount: number;
  withinAllowanceShare: number | null;
}

export interface WeekdayProfilePoint {
  weekday: number;
  samples: number;
  normalizedDurationIndex: number | null;
  withinAllowanceCount: number;
  withinAllowanceShare: number | null;
}

export interface MonthProfilePoint {
  monthKey: string;
  firstObservationMs: number;
  samples: number;
  normalizedDurationIndex: number | null;
  withinAllowanceCount: number;
  withinAllowanceShare: number | null;
}

export interface GlobalArrivalSupport {
  index: number;
  band: ArrivalEvidenceBand;
  supportedDriveVolumeIngredient: number;
  supportedRouteIngredient: number;
  activeWeekIngredient: number;
  repeatedCoverageIngredient: number;
}

export interface ArrivalCoverageEvidence {
  supportedRoutes: number;
  unsupportedRoutes: number;
  groupedRoutes: number;
  repeatedDrives: number;
  unsupportedDrives: number;
  repeatedRouteCoverage: number | null;
  activeLocalDays: number;
  activeLocalWeeks: number;
  supportedActiveLocalDays: number;
  supportedActiveLocalWeeks: number;
  returnedFirstObservationMs: number | null;
  returnedLastObservationMs: number | null;
  returnedSpanDays: number | null;
  firstIncludedObservationMs: number | null;
  lastIncludedObservationMs: number | null;
  includedSpanDays: number | null;
  daysSinceLastIncludedObservation: number | null;
  routeConcentration: number | null;
  globalSupport: GlobalArrivalSupport;
}

export interface ArrivalAggregateTiming {
  timingConsistencyIndex: number | null;
  withinAllowanceCount: number;
  withinAllowanceShare: number | null;
  sampleWeightedP90BufferS: number | null;
  sampleWeightedRobustSpreadS: number | null;
  sampleWeightedRelativeSpread: number | null;
  sampleWeightedRouteSupportIndex: number | null;
}

export interface ArrivalReliabilityResult {
  nowMs: number;
  timeZone: string;
  config: ResolvedArrivalReliabilityOptions;
  accounting: ArrivalReliabilityAccounting;
  coverage: ArrivalCoverageEvidence;
  aggregate: ArrivalAggregateTiming;
  routes: RouteReliability[];
  routeRankings: RouteReliability[];
  supportedWindows: ReliabilityWindow[];
  bestWindow: ReliabilityWindow | null;
  worstWindow: ReliabilityWindow | null;
  soleSupportedWindow: ReliabilityWindow | null;
  twoHourProfile: TwoHourProfilePoint[];
  weekdayProfile: WeekdayProfilePoint[];
  monthTrend: MonthProfilePoint[];
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number;
  dateKey: string;
  monthKey: string;
}

interface RouteSample {
  durationS: number;
  startMs: number;
  sourceIndex: number;
  bucketStartHour: number;
  zoned: ZonedParts;
}

interface RouteGroup {
  key: string;
  label: string;
  samples: RouteSample[];
}

interface NormalizedSample extends RouteSample {
  routeKey: string;
  normalizedDurationIndex: number;
  withinAllowance: boolean;
}

const DEFAULTS: ResolvedArrivalReliabilityOptions = {
  minRouteSamples: 3,
  minWindowSamples: 3,
  historyLimit: 1_000,
  strongRouteSamples: 12,
  strongRouteActiveDays: 8,
  strongRouteActiveWeeks: 6,
  strongGlobalDrives: 60,
  strongGlobalRoutes: 5,
  strongGlobalActiveWeeks: 12,
};

const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function clamp(value: number, minimum = 0, maximum = 1): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function safeProduct(left: number, right: number): number {
  const product = left * right;
  return Number.isFinite(product) ? product : Number.MAX_VALUE;
}

function safeAdd(left: number, right: number): number {
  const sum = left + right;
  return Number.isFinite(sum) ? sum : Number.MAX_VALUE;
}

function safeDifference(high: number, low: number): number {
  const difference = high - low;
  return Number.isFinite(difference) ? Math.max(0, difference) : Number.MAX_VALUE;
}

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return finite(numerator / denominator);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const integer = Math.floor(value);
  if (integer <= 0) return fallback;
  return Math.min(maximum, Math.max(minimum, integer));
}

function resolveOptions(
  options: ArrivalReliabilityOptions,
): ResolvedArrivalReliabilityOptions {
  return {
    minRouteSamples: boundedInteger(
      options.minRouteSamples,
      DEFAULTS.minRouteSamples,
      3,
      10_000,
    ),
    minWindowSamples: boundedInteger(
      options.minWindowSamples,
      DEFAULTS.minWindowSamples,
      3,
      10_000,
    ),
    historyLimit: boundedInteger(
      options.historyLimit,
      DEFAULTS.historyLimit,
      1,
      100_000,
    ),
    strongRouteSamples: boundedInteger(
      options.strongRouteSamples,
      DEFAULTS.strongRouteSamples,
      3,
      100_000,
    ),
    strongRouteActiveDays: boundedInteger(
      options.strongRouteActiveDays,
      DEFAULTS.strongRouteActiveDays,
      1,
      100_000,
    ),
    strongRouteActiveWeeks: boundedInteger(
      options.strongRouteActiveWeeks,
      DEFAULTS.strongRouteActiveWeeks,
      1,
      100_000,
    ),
    strongGlobalDrives: boundedInteger(
      options.strongGlobalDrives,
      DEFAULTS.strongGlobalDrives,
      3,
      1_000_000,
    ),
    strongGlobalRoutes: boundedInteger(
      options.strongGlobalRoutes,
      DEFAULTS.strongGlobalRoutes,
      1,
      100_000,
    ),
    strongGlobalActiveWeeks: boundedInteger(
      options.strongGlobalActiveWeeks,
      DEFAULTS.strongGlobalActiveWeeks,
      1,
      100_000,
    ),
  };
}

function roundedCoordinate(value: number): string {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? '0.000' : rounded.toFixed(3);
}

/** Normalize one route endpoint, preferring its address over rounded GPS. */
export function normalizeRouteLocation(
  address: string | null | undefined,
  lat: number | null | undefined,
  lon: number | null | undefined,
): RouteLocation | null {
  const label = typeof address === 'string' ? address.trim().replace(/\s+/g, ' ') : '';
  if (label) {
    const normalized = label
      .normalize('NFKD')
      .toLocaleLowerCase('en-US')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (normalized) return { key: `address:${normalized}`, label };
  }
  if (
    lat == null
    || lon == null
    || !Number.isFinite(lat)
    || !Number.isFinite(lon)
    || lat < -90
    || lat > 90
    || lon < -180
    || lon > 180
  ) {
    return null;
  }
  const coordinate = `${roundedCoordinate(lat)}, ${roundedCoordinate(lon)}`;
  return {
    key: `geo:${coordinate.replace(' ', '')}`,
    label: coordinate,
  };
}

/** Linear-interpolated quantile over finite values. */
export function quantile(values: readonly number[], q: number): number {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const boundedQ = clamp(q);
  const position = (sorted.length - 1) * boundedQ;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const distance = safeDifference(sorted[upper]!, sorted[lower]!);
  return safeAdd(sorted[lower]!, safeProduct(distance, position - lower));
}

/** Validate an IANA timezone, falling back deterministically to UTC. */
export function normalizeArrivalTimeZone(timeZone: string): string {
  const candidate =
    typeof timeZone === 'string' && timeZone.trim().length > 0
      ? timeZone.trim()
      : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return 'UTC';
  }
}

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = PARTS_FORMATTERS.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  PARTS_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const numberPart = (type: Intl.DateTimeFormatPartTypes): number => {
    const parsed = Number(parts.find((part) => part.type === type)?.value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const year = numberPart('year');
  const month = numberPart('month');
  const day = numberPart('day');
  const rawHour = numberPart('hour');
  const hour = rawHour === 24 ? 0 : Math.floor(clamp(rawHour, 0, 23));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const yearLabel = String(year).padStart(4, '0');
  const monthLabel = String(month).padStart(2, '0');
  const dayLabel = String(day).padStart(2, '0');
  return {
    year,
    month,
    day,
    hour,
    weekday,
    dateKey: `${yearLabel}-${monthLabel}-${dayLabel}`,
    monthKey: `${yearLabel}-${monthLabel}`,
  };
}

function shiftDateKey(dateKey: string, days: number): string {
  const [year = 0, month = 1, day = 1] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function weekStartKey(parts: ZonedParts): string {
  return shiftDateKey(parts.dateKey, -((parts.weekday + 6) % 7));
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const trimmed = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const offsetPresent = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const candidate = dateOnly
    ? `${trimmed}T00:00:00.000Z`
    : offsetPresent
      ? trimmed
      : `${trimmed}Z`;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function bandFor(index: number, hasEvidence: boolean): ArrivalEvidenceBand {
  if (!hasEvidence) return 'none';
  if (index < 35) return 'thin';
  if (index < 70) return 'developing';
  return 'strong';
}

function summarizeDurations(
  durations: readonly number[],
  fixedAllowanceThresholdS?: number,
): TimingSummary {
  const samples = durations.length;
  const p10DurationS = finite(quantile(durations, 0.1));
  const p50DurationS = finite(quantile(durations, 0.5));
  const p90DurationS = finite(quantile(durations, 0.9));
  const deviations = durations.map((duration) =>
    safeDifference(Math.max(duration, p50DurationS), Math.min(duration, p50DurationS)),
  );
  const rawMad = finite(quantile(deviations, 0.5));
  const robustSpreadS = safeProduct(SCALED_MAD_FACTOR, rawMad);
  const p90BufferS = safeDifference(p90DurationS, p50DurationS);
  const allowanceThresholdS =
    fixedAllowanceThresholdS != null && Number.isFinite(fixedAllowanceThresholdS)
      ? Math.max(0, fixedAllowanceThresholdS)
      : safeAdd(p50DurationS, Math.max(300, safeProduct(p50DurationS, 0.1)));
  const withinAllowanceCount = durations.reduce(
    (count, duration) => count + (duration <= allowanceThresholdS ? 1 : 0),
    0,
  );
  const withinAllowanceShare = clamp(ratio(withinAllowanceCount, samples));
  const relativeSpread = clamp(ratio(robustSpreadS, p50DurationS), 0, 1_000);
  const spreadComponent = clamp(Math.exp(-relativeSpread));
  const timingConsistencyIndex = clamp(
    100 * (0.65 * withinAllowanceShare + 0.35 * spreadComponent),
    0,
    100,
  );
  return {
    samples,
    p10DurationS,
    p50DurationS,
    p90DurationS,
    robustSpreadS,
    p90BufferS,
    allowanceThresholdS,
    withinAllowanceCount,
    withinAllowanceShare,
    relativeSpread,
    timingConsistencyIndex,
  };
}

function routeSupport(
  samples: number,
  activeDays: number,
  activeWeeks: number,
  options: ResolvedArrivalReliabilityOptions,
): RouteSupport {
  const sampleVolumeIngredient = clamp(samples / options.strongRouteSamples);
  const activeDayIngredient = clamp(activeDays / options.strongRouteActiveDays);
  const activeWeekIngredient = clamp(activeWeeks / options.strongRouteActiveWeeks);
  const index = clamp(
    100
      * (
        0.45 * sampleVolumeIngredient
        + 0.3 * activeDayIngredient
        + 0.25 * activeWeekIngredient
      ),
    0,
    100,
  );
  return {
    index,
    band: bandFor(index, samples > 0),
    sampleVolumeIngredient,
    activeDayIngredient,
    activeWeekIngredient,
  };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function minMax(values: readonly number[]): {
  first: number | null;
  last: number | null;
} {
  if (values.length === 0) return { first: null, last: null };
  let first = Number.MAX_VALUE;
  let last = -Number.MAX_VALUE;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    first = Math.min(first, value);
    last = Math.max(last, value);
  }
  return first === Number.MAX_VALUE
    ? { first: null, last: null }
    : { first, last };
}

function spanDays(first: number | null, last: number | null): number | null {
  if (first == null || last == null) return null;
  return finite(Math.max(0, last - first) / MS_PER_DAY);
}

function weightedRouteValue(
  routes: readonly RouteReliability[],
  key:
    | 'timingConsistencyIndex'
    | 'p90BufferS'
    | 'robustSpreadS'
    | 'relativeSpread',
  totalSamples: number,
): number | null {
  if (totalSamples <= 0) return null;
  const sum = routes.reduce(
    (value, route) => safeAdd(value, safeProduct(route[key], route.samples)),
    0,
  );
  return finite(sum / totalSamples);
}

function aggregateProfile(
  samples: readonly NormalizedSample[],
): {
  samples: number;
  normalizedDurationIndex: number | null;
  withinAllowanceCount: number;
  withinAllowanceShare: number | null;
} {
  if (samples.length === 0) {
    return {
      samples: 0,
      normalizedDurationIndex: null,
      withinAllowanceCount: 0,
      withinAllowanceShare: null,
    };
  }
  const normalizedTotal = samples.reduce(
    (sum, sample) => sum + sample.normalizedDurationIndex,
    0,
  );
  const withinAllowanceCount = samples.reduce(
    (count, sample) => count + (sample.withinAllowance ? 1 : 0),
    0,
  );
  return {
    samples: samples.length,
    normalizedDurationIndex: clamp(
      normalizedTotal / samples.length,
      0,
      MAX_NORMALIZED_DURATION_INDEX,
    ),
    withinAllowanceCount,
    withinAllowanceShare: clamp(withinAllowanceCount / samples.length),
  };
}

/**
 * Analyze returned drive history without mutating it.
 *
 * Every returned row enters exactly one accounting category. Supported-route
 * timing is based on at least three observations by default.
 */
export function analyzeArrivalReliability(
  drives: readonly Drive[],
  nowMs: number,
  timeZone: string,
  options: ArrivalReliabilityOptions = {},
): ArrivalReliabilityResult {
  const config = resolveOptions(options ?? {});
  const resolvedNowMs = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
  const resolvedTimeZone = normalizeArrivalTimeZone(timeZone);
  const groups = new Map<string, RouteGroup>();
  const includedSamples: Array<RouteSample & { routeKey: string }> = [];
  const returnedValidStarts: number[] = [];

  let incompleteRows = 0;
  let invalidTimestampOrOrderRows = 0;
  let futureRows = 0;
  let invalidDurationRows = 0;
  let unlocatableRows = 0;

  drives.forEach((drive, sourceIndex) => {
    const startMsForSpan = parseTimestamp(drive.startTs);
    if (startMsForSpan != null) returnedValidStarts.push(startMsForSpan);

    if (
      typeof drive.startTs !== 'string'
      || drive.startTs.trim().length === 0
      || typeof drive.endTs !== 'string'
      || drive.endTs.trim().length === 0
    ) {
      incompleteRows += 1;
      return;
    }
    const startMs = parseTimestamp(drive.startTs);
    const endMs = parseTimestamp(drive.endTs);
    if (startMs == null || endMs == null || endMs <= startMs) {
      invalidTimestampOrOrderRows += 1;
      return;
    }
    if (startMs > resolvedNowMs || endMs > resolvedNowMs) {
      futureRows += 1;
      return;
    }
    if (!Number.isFinite(drive.durationS) || drive.durationS <= 0) {
      invalidDurationRows += 1;
      return;
    }
    const start = normalizeRouteLocation(
      drive.startAddress,
      drive.startLat,
      drive.startLon,
    );
    const end = normalizeRouteLocation(
      drive.endAddress,
      drive.endLat,
      drive.endLon,
    );
    if (!start || !end) {
      unlocatableRows += 1;
      return;
    }

    const zoned = zonedParts(startMs, resolvedTimeZone);
    const routeKey = `${start.key}→${end.key}`;
    const sample: RouteSample = {
      durationS: drive.durationS,
      startMs,
      sourceIndex,
      bucketStartHour:
        Math.floor(zoned.hour / BUCKET_HOURS) * BUCKET_HOURS,
      zoned,
    };
    const group = groups.get(routeKey) ?? {
      key: routeKey,
      label: `${start.label} → ${end.label}`,
      samples: [],
    };
    group.samples.push(sample);
    groups.set(routeKey, group);
    includedSamples.push({ ...sample, routeKey });
  });

  for (const group of groups.values()) {
    group.samples.sort(
      (left, right) =>
        left.startMs - right.startMs || left.sourceIndex - right.sourceIndex,
    );
  }
  includedSamples.sort(
    (left, right) =>
      left.startMs - right.startMs || left.sourceIndex - right.sourceIndex,
  );

  const routes: RouteReliability[] = [];
  for (const group of groups.values()) {
    if (group.samples.length < config.minRouteSamples) continue;
    const durations = group.samples.map((sample) => sample.durationS);
    const summary = summarizeDurations(durations);
    const activeDays = new Set(
      group.samples.map((sample) => sample.zoned.dateKey),
    ).size;
    const activeWeeks = new Set(
      group.samples.map((sample) => weekStartKey(sample.zoned)),
    ).size;
    const buckets = new Map<number, RouteSample[]>();
    for (const sample of group.samples) {
      const bucket = buckets.get(sample.bucketStartHour) ?? [];
      bucket.push(sample);
      buckets.set(sample.bucketStartHour, bucket);
    }
    const windows: ReliabilityWindow[] = [];
    for (const [bucketStartHour, bucket] of buckets) {
      if (bucket.length < config.minWindowSamples) continue;
      const windowSummary = summarizeDurations(
        bucket.map((sample) => sample.durationS),
        summary.allowanceThresholdS,
      );
      windows.push({
        routeKey: group.key,
        routeLabel: group.label,
        bucketStartHour,
        firstObservationMs: bucket[0]!.startMs,
        lastObservationMs: bucket[bucket.length - 1]!.startMs,
        ...windowSummary,
      });
    }
    windows.sort((left, right) => left.bucketStartHour - right.bucketStartHour);
    routes.push({
      key: group.key,
      label: group.label,
      activeLocalDays: activeDays,
      activeLocalWeeks: activeWeeks,
      firstObservationMs: group.samples[0]!.startMs,
      lastObservationMs: group.samples[group.samples.length - 1]!.startMs,
      support: routeSupport(
        group.samples.length,
        activeDays,
        activeWeeks,
        config,
      ),
      windows,
      ...summary,
    });
  }

  routes.sort(
    (left, right) =>
      right.samples - left.samples
      || right.timingConsistencyIndex - left.timingConsistencyIndex
      || compareStrings(left.key, right.key),
  );
  const routeRankings = routes.slice().sort(
    (left, right) =>
      right.timingConsistencyIndex - left.timingConsistencyIndex
      || right.samples - left.samples
      || compareStrings(left.key, right.key),
  );
  const supportedWindows = routes
    .flatMap((route) => route.windows)
    .sort(
      (left, right) =>
        right.timingConsistencyIndex - left.timingConsistencyIndex
        || right.samples - left.samples
        || compareStrings(left.routeKey, right.routeKey)
        || left.bucketStartHour - right.bucketStartHour,
    );

  const supportedRouteKeys = new Set(routes.map((route) => route.key));
  const routeByKey = new Map(routes.map((route) => [route.key, route]));
  const normalizedSamples: NormalizedSample[] = [];
  for (const sample of includedSamples) {
    if (!supportedRouteKeys.has(sample.routeKey)) continue;
    const route = routeByKey.get(sample.routeKey);
    if (!route) continue;
    normalizedSamples.push({
      ...sample,
      normalizedDurationIndex: clamp(
        100 * ratio(sample.durationS, route.p50DurationS),
        0,
        MAX_NORMALIZED_DURATION_INDEX,
      ),
      withinAllowance: sample.durationS <= route.allowanceThresholdS,
    });
  }

  const twoHourProfile = Array.from({ length: 12 }, (_, index) => {
    const bucketStartHour = index * BUCKET_HOURS;
    return {
      bucketStartHour,
      ...aggregateProfile(
        normalizedSamples.filter(
          (sample) => sample.bucketStartHour === bucketStartHour,
        ),
      ),
    };
  });
  const weekdayProfile = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    ...aggregateProfile(
      normalizedSamples.filter((sample) => sample.zoned.weekday === weekday),
    ),
  }));
  const monthGroups = new Map<string, NormalizedSample[]>();
  for (const sample of normalizedSamples) {
    const month = monthGroups.get(sample.zoned.monthKey) ?? [];
    month.push(sample);
    monthGroups.set(sample.zoned.monthKey, month);
  }
  const monthTrend = [...monthGroups.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([monthKey, monthSamples]) => ({
      monthKey,
      firstObservationMs: monthSamples[0]!.startMs,
      ...aggregateProfile(monthSamples),
    }));

  const returnedRange = minMax(returnedValidStarts);
  const includedRange = minMax(includedSamples.map((sample) => sample.startMs));
  const includedRows = includedSamples.length;
  const repeatedDrives = normalizedSamples.length;
  const unsupportedDrives = Math.max(0, includedRows - repeatedDrives);
  const repeatedRouteCoverage =
    includedRows > 0 ? clamp(repeatedDrives / includedRows) : null;
  const activeLocalDays = new Set(
    includedSamples.map((sample) => sample.zoned.dateKey),
  ).size;
  const activeLocalWeeks = new Set(
    includedSamples.map((sample) => weekStartKey(sample.zoned)),
  ).size;
  const supportedActiveLocalDays = new Set(
    normalizedSamples.map((sample) => sample.zoned.dateKey),
  ).size;
  const supportedActiveLocalWeeks = new Set(
    normalizedSamples.map((sample) => weekStartKey(sample.zoned)),
  ).size;
  const largestGroup = [...groups.values()].reduce(
    (largest, group) => Math.max(largest, group.samples.length),
    0,
  );
  const routeConcentration =
    includedRows > 0 ? clamp(largestGroup / includedRows) : null;

  const supportedDriveVolumeIngredient = clamp(
    repeatedDrives / config.strongGlobalDrives,
  );
  const supportedRouteIngredient = clamp(
    routes.length / config.strongGlobalRoutes,
  );
  const activeWeekIngredient = clamp(
    supportedActiveLocalWeeks / config.strongGlobalActiveWeeks,
  );
  const repeatedCoverageIngredient = repeatedRouteCoverage ?? 0;
  const globalSupportIndex = clamp(
    100
      * (
        0.35 * supportedDriveVolumeIngredient
        + 0.2 * supportedRouteIngredient
        + 0.25 * activeWeekIngredient
        + 0.2 * repeatedCoverageIngredient
      ),
    0,
    100,
  );
  const globalSupport: GlobalArrivalSupport = {
    index: globalSupportIndex,
    band: bandFor(globalSupportIndex, repeatedDrives > 0),
    supportedDriveVolumeIngredient,
    supportedRouteIngredient,
    activeWeekIngredient,
    repeatedCoverageIngredient,
  };

  const withinAllowanceCount = routes.reduce(
    (count, route) => count + route.withinAllowanceCount,
    0,
  );
  const weightedSupport =
    repeatedDrives > 0
      ? finite(
          routes.reduce(
            (sum, route) =>
              safeAdd(sum, safeProduct(route.support.index, route.samples)),
            0,
          ) / repeatedDrives,
        )
      : null;
  const excludedRows =
    incompleteRows
    + invalidTimestampOrOrderRows
    + futureRows
    + invalidDurationRows
    + unlocatableRows;
  const accounting: ArrivalReliabilityAccounting = {
    returnedRows: drives.length,
    includedRows,
    excludedRows,
    incompleteRows,
    invalidTimestampOrOrderRows,
    futureRows,
    invalidDurationRows,
    unlocatableRows,
    historyLimit: config.historyLimit,
    historyCapReached: drives.length >= config.historyLimit,
  };

  return {
    nowMs: resolvedNowMs,
    timeZone: resolvedTimeZone,
    config,
    accounting,
    coverage: {
      supportedRoutes: routes.length,
      unsupportedRoutes: Math.max(0, groups.size - routes.length),
      groupedRoutes: groups.size,
      repeatedDrives,
      unsupportedDrives,
      repeatedRouteCoverage,
      activeLocalDays,
      activeLocalWeeks,
      supportedActiveLocalDays,
      supportedActiveLocalWeeks,
      returnedFirstObservationMs: returnedRange.first,
      returnedLastObservationMs: returnedRange.last,
      returnedSpanDays: spanDays(returnedRange.first, returnedRange.last),
      firstIncludedObservationMs: includedRange.first,
      lastIncludedObservationMs: includedRange.last,
      includedSpanDays: spanDays(includedRange.first, includedRange.last),
      daysSinceLastIncludedObservation:
        includedRange.last != null
          ? finite(Math.max(0, resolvedNowMs - includedRange.last) / MS_PER_DAY)
          : null,
      routeConcentration,
      globalSupport,
    },
    aggregate: {
      timingConsistencyIndex: weightedRouteValue(
        routes,
        'timingConsistencyIndex',
        repeatedDrives,
      ),
      withinAllowanceCount,
      withinAllowanceShare:
        repeatedDrives > 0
          ? clamp(withinAllowanceCount / repeatedDrives)
          : null,
      sampleWeightedP90BufferS: weightedRouteValue(
        routes,
        'p90BufferS',
        repeatedDrives,
      ),
      sampleWeightedRobustSpreadS: weightedRouteValue(
        routes,
        'robustSpreadS',
        repeatedDrives,
      ),
      sampleWeightedRelativeSpread: weightedRouteValue(
        routes,
        'relativeSpread',
        repeatedDrives,
      ),
      sampleWeightedRouteSupportIndex: weightedSupport,
    },
    routes,
    routeRankings,
    supportedWindows,
    bestWindow: supportedWindows.length >= 2 ? supportedWindows[0]! : null,
    worstWindow:
      supportedWindows.length >= 2
        ? supportedWindows[supportedWindows.length - 1]!
        : null,
    soleSupportedWindow:
      supportedWindows.length === 1 ? supportedWindows[0]! : null,
    twoHourProfile,
    weekdayProfile,
    monthTrend,
  };
}
