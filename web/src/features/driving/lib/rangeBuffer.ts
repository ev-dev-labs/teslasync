import type { Drive } from '@/types/driving';

const MS_PER_DAY = 86_400_000;
const PROFILE_HOURS = 4;
const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export const DEFAULT_RANGE_BUFFER_THRESHOLD_PCT = 20;
export const CRITICAL_RANGE_BUFFER_THRESHOLD_PCT = 10;
export const RANGE_BUFFER_THRESHOLDS = [10, 15, 20, 25, 30, 40] as const;

export type RangeBufferEvidenceBand =
  | 'none'
  | 'thin'
  | 'developing'
  | 'strong';

export interface RangeBufferOptions {
  thresholdPct?: number;
  historyLimit?: number;
  minDestinationSamples?: number;
  maxDestinationProfiles?: number;
  maxTrendMonths?: number;
}

export interface ResolvedRangeBufferOptions {
  thresholdPct: number;
  historyLimit: number;
  minDestinationSamples: number;
  maxDestinationProfiles: number;
  maxTrendMonths: number;
}

export interface RangeBufferAccounting {
  returnedRows: number;
  includedRows: number;
  excludedRows: number;
  incompleteRows: number;
  invalidTimestampOrOrderRows: number;
  futureRows: number;
  invalidArrivalRows: number;
  historyLimit: number;
  historyCapReached: boolean;
}

export interface RangeBufferPercentiles {
  samples: number;
  p10Pct: number | null;
  p25Pct: number | null;
  medianPct: number | null;
  p75Pct: number | null;
  p90Pct: number | null;
  minimumPct: number | null;
  maximumPct: number | null;
  belowThresholdCount: number;
  belowThresholdShare: number | null;
}

export interface RangeBufferSummary extends RangeBufferPercentiles {
  latestArrivalPct: number | null;
  latestArrivalMs: number | null;
  singleDigitCount: number;
  singleDigitShare: number | null;
}

export interface RangeBufferBucket {
  fromPct: number;
  toPct: number;
  count: number;
  share: number | null;
}

export interface RangeBufferMonthPoint extends RangeBufferPercentiles {
  monthKey: string;
  firstObservationMs: number;
  lastObservationMs: number;
}

export interface RangeBufferWeekdayPoint extends RangeBufferPercentiles {
  /** Monday = 0, Sunday = 6. */
  weekday: number;
}

export interface RangeBufferHourPoint extends RangeBufferPercentiles {
  bucketStartHour: number;
}

export interface RangeBufferDistancePoint extends RangeBufferPercentiles {
  fromM: number;
  toM: number | null;
  medianDropPct: number | null;
}

export interface RangeBufferThresholdPoint {
  thresholdPct: number;
  count: number;
  share: number | null;
}

export interface RangeBufferDriveContext {
  startSocRows: number;
  invalidStartSocRows: number;
  depletionRows: number;
  increasingSocRows: number;
  distanceRows: number;
  invalidDistanceRows: number;
  medianStartPct: number | null;
  medianDropPct: number | null;
  p90DropPct: number | null;
  medianDistanceM: number | null;
}

export interface RangeBufferDestinationProfile
  extends RangeBufferPercentiles {
  key: string;
  label: string;
  source: 'address' | 'coordinates';
  activeLocalDays: number;
  latestArrivalMs: number;
  medianDistanceM: number | null;
}

export interface RangeBufferDestinationCoverage {
  locatableRows: number;
  unlocatableRows: number;
  groupedDestinations: number;
  supportedDestinations: number;
  supportedRows: number;
  unsupportedRows: number;
  repeatedCoverage: number | null;
  displayedDestinations: number;
  omittedSupportedDestinations: number;
}

export interface RangeBufferLowArrival {
  driveId: number;
  endTs: string;
  endMs: number;
  arrivalPct: number;
  startPct: number | null;
  dropPct: number | null;
  distanceM: number | null;
  destinationLabel: string | null;
}

export interface RangeBufferSupportIngredient {
  value: number;
  target: number;
  score: number;
}

export interface RangeBufferSupport {
  index: number;
  band: RangeBufferEvidenceBand;
  sampleVolume: RangeBufferSupportIngredient;
  activeDays: RangeBufferSupportIngredient;
  activeWeeks: RangeBufferSupportIngredient;
  recency: RangeBufferSupportIngredient;
}

export interface RangeBufferCoverage {
  activeLocalDays: number;
  activeLocalWeeks: number;
  firstObservationMs: number | null;
  lastObservationMs: number | null;
  observedSpanDays: number | null;
  daysSinceLastObservation: number | null;
  returnedTrendMonths: number;
  displayedTrendMonths: number;
  omittedTrendMonths: number;
  support: RangeBufferSupport;
}

export interface RangeBufferResult {
  nowMs: number;
  timeZone: string;
  config: ResolvedRangeBufferOptions;
  accounting: RangeBufferAccounting;
  summary: RangeBufferSummary;
  buckets: RangeBufferBucket[];
  monthTrend: RangeBufferMonthPoint[];
  weekdayProfile: RangeBufferWeekdayPoint[];
  hourProfile: RangeBufferHourPoint[];
  distanceProfile: RangeBufferDistancePoint[];
  thresholdSensitivity: RangeBufferThresholdPoint[];
  driveContext: RangeBufferDriveContext;
  destinationCoverage: RangeBufferDestinationCoverage;
  destinationProfiles: RangeBufferDestinationProfile[];
  lowArrivals: RangeBufferLowArrival[];
  coverage: RangeBufferCoverage;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number;
  dateKey: string;
  monthKey: string;
  weekKey: string;
}

interface DestinationIdentity {
  key: string;
  label: string;
  source: 'address' | 'coordinates';
}

interface RangeBufferSample {
  drive: Drive;
  sourceIndex: number;
  startMs: number;
  endMs: number;
  arrivalPct: number;
  startPct: number | null;
  dropPct: number | null;
  distanceM: number | null;
  destination: DestinationIdentity | null;
  zoned: ZonedParts;
}

const DEFAULTS: ResolvedRangeBufferOptions = {
  thresholdPct: DEFAULT_RANGE_BUFFER_THRESHOLD_PCT,
  historyLimit: 1_000,
  minDestinationSamples: 3,
  maxDestinationProfiles: 12,
  maxTrendMonths: 24,
};

const DISTANCE_BANDS: ReadonlyArray<{
  fromM: number;
  toM: number | null;
}> = [
  { fromM: 0, toM: 10_000 },
  { fromM: 10_000, toM: 25_000 },
  { fromM: 25_000, toM: 50_000 },
  { fromM: 50_000, toM: 100_000 },
  { fromM: 100_000, toM: null },
];

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function resolveOptions(
  options: RangeBufferOptions,
): ResolvedRangeBufferOptions {
  const thresholdPct =
    options.thresholdPct != null
    && Number.isFinite(options.thresholdPct)
    && options.thresholdPct > 0
    && options.thresholdPct < 100
      ? options.thresholdPct
      : DEFAULTS.thresholdPct;

  return {
    thresholdPct,
    historyLimit: clampInteger(
      options.historyLimit,
      DEFAULTS.historyLimit,
      1,
      1_000,
    ),
    minDestinationSamples: clampInteger(
      options.minDestinationSamples,
      DEFAULTS.minDestinationSamples,
      2,
      100,
    ),
    maxDestinationProfiles: clampInteger(
      options.maxDestinationProfiles,
      DEFAULTS.maxDestinationProfiles,
      1,
      100,
    ),
    maxTrendMonths: clampInteger(
      options.maxTrendMonths,
      DEFAULTS.maxTrendMonths,
      1,
      120,
    ),
  };
}

function round(value: number, precision = 1): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function validPercent(value: number | null | undefined): number | null {
  return value != null
    && Number.isFinite(value)
    && value >= 0
    && value <= 100
    ? value
    : null;
}

function validDistance(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function rangeBufferQuantile(
  values: readonly number[],
  quantile: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const bounded = Math.min(1, Math.max(0, quantile));
  const position = (sorted.length - 1) * bounded;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function summarizeArrivals(
  samples: readonly RangeBufferSample[],
  thresholdPct: number,
): RangeBufferPercentiles {
  const arrivals = samples.map((sample) => sample.arrivalPct);
  const belowThresholdCount = arrivals.filter(
    (arrival) => arrival < thresholdPct,
  ).length;
  const percentile = (quantile: number) => {
    const value = rangeBufferQuantile(arrivals, quantile);
    return value == null ? null : round(value);
  };

  return {
    samples: arrivals.length,
    p10Pct: percentile(0.1),
    p25Pct: percentile(0.25),
    medianPct: percentile(0.5),
    p75Pct: percentile(0.75),
    p90Pct: percentile(0.9),
    minimumPct: arrivals.length > 0 ? Math.min(...arrivals) : null,
    maximumPct: arrivals.length > 0 ? Math.max(...arrivals) : null,
    belowThresholdCount,
    belowThresholdShare:
      arrivals.length > 0 ? belowThresholdCount / arrivals.length : null,
  };
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
      hour: '2-digit',
      hourCycle: 'h23',
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

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const numberPart = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((part) => part.type === type)?.value);
    return Number.isFinite(value) ? value : 0;
  };
  const year = numberPart('year');
  const month = numberPart('month');
  const day = numberPart('day');
  const hour = numberPart('hour') % 24;
  const localDate = new Date(Date.UTC(year, month - 1, day));

  return {
    year,
    month,
    day,
    hour,
    weekday: (localDate.getUTCDay() + 6) % 7,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    monthKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
    weekKey: localWeekKey(year, month, day),
  };
}

function dateOrdinal(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / MS_PER_DAY;
}

function destinationOf(drive: Drive): DestinationIdentity | null {
  const address = drive.endAddress?.trim().replace(/\s+/g, ' ');
  if (address) {
    return {
      key: `address:${address.toLocaleLowerCase('en-US')}`,
      label: address,
      source: 'address',
    };
  }

  const latitude = drive.endLat;
  const longitude = drive.endLon;
  if (
    latitude == null
    || longitude == null
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }

  const label = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
  return {
    key: `coordinates:${label}`,
    label,
    source: 'coordinates',
  };
}

function supportIngredient(value: number, target: number) {
  return {
    value,
    target,
    score: target > 0 ? Math.min(1, value / target) : 0,
  };
}

function recencyScore(daysSince: number | null): number {
  if (daysSince == null) return 0;
  if (daysSince <= 7) return 1;
  if (daysSince <= 30) return 0.75;
  if (daysSince <= 90) return 0.5;
  if (daysSince <= 180) return 0.25;
  return 0;
}

function supportBand(
  samples: number,
  index: number,
): RangeBufferEvidenceBand {
  if (samples === 0) return 'none';
  if (index < 35) return 'thin';
  if (index < 70) return 'developing';
  return 'strong';
}

function buildSupport(
  samples: number,
  activeDays: number,
  activeWeeks: number,
  daysSinceLastObservation: number | null,
): RangeBufferSupport {
  const sampleVolume = supportIngredient(samples, 50);
  const dayCoverage = supportIngredient(activeDays, 20);
  const weekCoverage = supportIngredient(activeWeeks, 8);
  const recency = {
    value: daysSinceLastObservation ?? 0,
    target: 30,
    score: recencyScore(daysSinceLastObservation),
  };
  const index = round(
    100
      * (0.35 * sampleVolume.score
        + 0.25 * dayCoverage.score
        + 0.25 * weekCoverage.score
        + 0.15 * recency.score),
  );

  return {
    index,
    band: supportBand(samples, index),
    sampleVolume,
    activeDays: dayCoverage,
    activeWeeks: weekCoverage,
    recency,
  };
}

function buildBuckets(
  samples: readonly RangeBufferSample[],
): RangeBufferBucket[] {
  const counts = Array.from({ length: 10 }, () => 0);
  for (const sample of samples) {
    counts[Math.min(9, Math.floor(sample.arrivalPct / 10))]! += 1;
  }
  return counts.map((count, index) => ({
    fromPct: index * 10,
    toPct: (index + 1) * 10,
    count,
    share: samples.length > 0 ? count / samples.length : null,
  }));
}

function buildMonthTrend(
  samples: readonly RangeBufferSample[],
  thresholdPct: number,
  maxMonths: number,
): {
  allMonths: number;
  points: RangeBufferMonthPoint[];
} {
  const groups = new Map<string, RangeBufferSample[]>();
  for (const sample of samples) {
    const rows = groups.get(sample.zoned.monthKey) ?? [];
    rows.push(sample);
    groups.set(sample.zoned.monthKey, rows);
  }
  const all = Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monthKey, rows]) => ({
      monthKey,
      firstObservationMs: Math.min(...rows.map((row) => row.endMs)),
      lastObservationMs: Math.max(...rows.map((row) => row.endMs)),
      ...summarizeArrivals(rows, thresholdPct),
    }));

  return {
    allMonths: all.length,
    points: all.slice(-maxMonths),
  };
}

function buildWeekdayProfile(
  samples: readonly RangeBufferSample[],
  thresholdPct: number,
): RangeBufferWeekdayPoint[] {
  return Array.from({ length: 7 }, (_, weekday) => {
    const rows = samples.filter((sample) => sample.zoned.weekday === weekday);
    return {
      weekday,
      ...summarizeArrivals(rows, thresholdPct),
    };
  });
}

function buildHourProfile(
  samples: readonly RangeBufferSample[],
  thresholdPct: number,
): RangeBufferHourPoint[] {
  return Array.from(
    { length: 24 / PROFILE_HOURS },
    (_, index) => {
      const bucketStartHour = index * PROFILE_HOURS;
      const rows = samples.filter(
        (sample) =>
          Math.floor(sample.zoned.hour / PROFILE_HOURS) * PROFILE_HOURS
          === bucketStartHour,
      );
      return {
        bucketStartHour,
        ...summarizeArrivals(rows, thresholdPct),
      };
    },
  );
}

function buildDistanceProfile(
  samples: readonly RangeBufferSample[],
  thresholdPct: number,
): RangeBufferDistancePoint[] {
  return DISTANCE_BANDS.map(({ fromM, toM }) => {
    const rows = samples.filter(
      (sample) =>
        sample.distanceM != null
        && sample.distanceM >= fromM
        && (toM == null || sample.distanceM < toM),
    );
    const drops = rows.flatMap((row) =>
      row.dropPct != null && row.dropPct >= 0 ? [row.dropPct] : [],
    );
    const medianDrop = rangeBufferQuantile(drops, 0.5);
    return {
      fromM,
      toM,
      medianDropPct: medianDrop == null ? null : round(medianDrop),
      ...summarizeArrivals(rows, thresholdPct),
    };
  });
}

function buildDestinations(
  samples: readonly RangeBufferSample[],
  config: ResolvedRangeBufferOptions,
): {
  coverage: RangeBufferDestinationCoverage;
  profiles: RangeBufferDestinationProfile[];
} {
  const groups = new Map<
    string,
    { destination: DestinationIdentity; rows: RangeBufferSample[] }
  >();
  for (const sample of samples) {
    if (!sample.destination) continue;
    const existing = groups.get(sample.destination.key) ?? {
      destination: sample.destination,
      rows: [],
    };
    existing.rows.push(sample);
    groups.set(sample.destination.key, existing);
  }

  const supported = Array.from(groups.values())
    .filter(({ rows }) => rows.length >= config.minDestinationSamples)
    .map(({ destination, rows }) => {
      const distances = rows.flatMap((row) =>
        row.distanceM != null ? [row.distanceM] : [],
      );
      const medianDistance = rangeBufferQuantile(distances, 0.5);
      return {
        key: destination.key,
        label: destination.label,
        source: destination.source,
        activeLocalDays: new Set(rows.map((row) => row.zoned.dateKey)).size,
        latestArrivalMs: Math.max(...rows.map((row) => row.endMs)),
        medianDistanceM:
          medianDistance == null ? null : round(medianDistance),
        ...summarizeArrivals(rows, config.thresholdPct),
      };
    })
    .sort(
      (left, right) =>
        right.samples - left.samples
        || left.label.localeCompare(right.label),
    );

  const locatableRows = Array.from(groups.values()).reduce(
    (total, group) => total + group.rows.length,
    0,
  );
  const supportedRows = supported.reduce(
    (total, profile) => total + profile.samples,
    0,
  );
  const displayed = supported.slice(0, config.maxDestinationProfiles);

  return {
    coverage: {
      locatableRows,
      unlocatableRows: samples.length - locatableRows,
      groupedDestinations: groups.size,
      supportedDestinations: supported.length,
      supportedRows,
      unsupportedRows: locatableRows - supportedRows,
      repeatedCoverage:
        locatableRows > 0 ? supportedRows / locatableRows : null,
      displayedDestinations: displayed.length,
      omittedSupportedDestinations: supported.length - displayed.length,
    },
    profiles: displayed,
  };
}

function buildDriveContext(
  samples: readonly RangeBufferSample[],
): RangeBufferDriveContext {
  const starts = samples.flatMap((sample) =>
    sample.startPct != null ? [sample.startPct] : [],
  );
  const drops = samples.flatMap((sample) =>
    sample.dropPct != null && sample.dropPct >= 0 ? [sample.dropPct] : [],
  );
  const distances = samples.flatMap((sample) =>
    sample.distanceM != null ? [sample.distanceM] : [],
  );
  const medianStart = rangeBufferQuantile(starts, 0.5);
  const medianDrop = rangeBufferQuantile(drops, 0.5);
  const p90Drop = rangeBufferQuantile(drops, 0.9);
  const medianDistance = rangeBufferQuantile(distances, 0.5);

  return {
    startSocRows: starts.length,
    invalidStartSocRows: samples.length - starts.length,
    depletionRows: drops.length,
    increasingSocRows: samples.filter(
      (sample) => sample.dropPct != null && sample.dropPct < 0,
    ).length,
    distanceRows: distances.length,
    invalidDistanceRows: samples.length - distances.length,
    medianStartPct: medianStart == null ? null : round(medianStart),
    medianDropPct: medianDrop == null ? null : round(medianDrop),
    p90DropPct: p90Drop == null ? null : round(p90Drop),
    medianDistanceM:
      medianDistance == null ? null : round(medianDistance),
  };
}

function thresholdSensitivity(
  samples: readonly RangeBufferSample[],
  selectedThreshold: number,
): RangeBufferThresholdPoint[] {
  const thresholds = Array.from(
    new Set([...RANGE_BUFFER_THRESHOLDS, selectedThreshold]),
  ).sort((left, right) => left - right);
  return thresholds.map((thresholdPct) => {
    const count = samples.filter(
      (sample) => sample.arrivalPct < thresholdPct,
    ).length;
    return {
      thresholdPct,
      count,
      share: samples.length > 0 ? count / samples.length : null,
    };
  });
}

export function analyzeRangeBuffer(
  drives: readonly Drive[],
  nowMs: number,
  requestedTimeZone: string,
  options: RangeBufferOptions = {},
): RangeBufferResult {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError('Range Buffer analysis requires a finite clock');
  }
  const config = resolveOptions(options);
  const timeZone = resolveTimeZone(requestedTimeZone);
  const accounting: RangeBufferAccounting = {
    returnedRows: drives.length,
    includedRows: 0,
    excludedRows: 0,
    incompleteRows: 0,
    invalidTimestampOrOrderRows: 0,
    futureRows: 0,
    invalidArrivalRows: 0,
    historyLimit: config.historyLimit,
    historyCapReached: drives.length >= config.historyLimit,
  };
  const samples: RangeBufferSample[] = [];

  drives.forEach((drive, sourceIndex) => {
    if (!drive.endTs?.trim()) {
      accounting.incompleteRows += 1;
      return;
    }
    const startMs = Date.parse(drive.startTs);
    const endMs = Date.parse(drive.endTs);
    if (
      !Number.isFinite(startMs)
      || !Number.isFinite(endMs)
      || endMs < startMs
    ) {
      accounting.invalidTimestampOrOrderRows += 1;
      return;
    }
    if (endMs > nowMs) {
      accounting.futureRows += 1;
      return;
    }
    const arrivalPct = validPercent(drive.endBatteryPct);
    if (arrivalPct == null) {
      accounting.invalidArrivalRows += 1;
      return;
    }
    const startPct = validPercent(drive.startBatteryPct);
    samples.push({
      drive,
      sourceIndex,
      startMs,
      endMs,
      arrivalPct,
      startPct,
      dropPct: startPct == null ? null : startPct - arrivalPct,
      distanceM: validDistance(drive.distanceM),
      destination: destinationOf(drive),
      zoned: zonedParts(endMs, timeZone),
    });
  });

  accounting.includedRows = samples.length;
  accounting.excludedRows =
    accounting.incompleteRows
    + accounting.invalidTimestampOrOrderRows
    + accounting.futureRows
    + accounting.invalidArrivalRows;

  const baseSummary = summarizeArrivals(samples, config.thresholdPct);
  const latest = [...samples].sort(
    (left, right) =>
      right.endMs - left.endMs || left.sourceIndex - right.sourceIndex,
  )[0];
  const singleDigitCount = samples.filter(
    (sample) =>
      sample.arrivalPct < CRITICAL_RANGE_BUFFER_THRESHOLD_PCT,
  ).length;
  const summary: RangeBufferSummary = {
    ...baseSummary,
    latestArrivalPct: latest?.arrivalPct ?? null,
    latestArrivalMs: latest?.endMs ?? null,
    singleDigitCount,
    singleDigitShare:
      samples.length > 0 ? singleDigitCount / samples.length : null,
  };

  const activeDates = Array.from(
    new Set(samples.map((sample) => sample.zoned.dateKey)),
  ).sort();
  const activeWeeks = new Set(samples.map((sample) => sample.zoned.weekKey));
  const firstObservationMs =
    samples.length > 0
      ? Math.min(...samples.map((sample) => sample.endMs))
      : null;
  const lastObservationMs =
    samples.length > 0
      ? Math.max(...samples.map((sample) => sample.endMs))
      : null;
  const daysSinceLastObservation =
    lastObservationMs == null
      ? null
      : Math.max(0, (nowMs - lastObservationMs) / MS_PER_DAY);
  const trend = buildMonthTrend(
    samples,
    config.thresholdPct,
    config.maxTrendMonths,
  );
  const destination = buildDestinations(samples, config);

  const lowArrivals = [...samples]
    .sort(
      (left, right) =>
        left.arrivalPct - right.arrivalPct
        || right.endMs - left.endMs
        || left.sourceIndex - right.sourceIndex,
    )
    .slice(0, 10)
    .map((sample) => ({
      driveId: sample.drive.id,
      endTs: sample.drive.endTs!,
      endMs: sample.endMs,
      arrivalPct: sample.arrivalPct,
      startPct: sample.startPct,
      dropPct:
        sample.dropPct != null && sample.dropPct >= 0
          ? sample.dropPct
          : null,
      distanceM: sample.distanceM,
      destinationLabel: sample.destination?.label ?? null,
    }));

  return {
    nowMs,
    timeZone,
    config,
    accounting,
    summary,
    buckets: buildBuckets(samples),
    monthTrend: trend.points,
    weekdayProfile: buildWeekdayProfile(samples, config.thresholdPct),
    hourProfile: buildHourProfile(samples, config.thresholdPct),
    distanceProfile: buildDistanceProfile(samples, config.thresholdPct),
    thresholdSensitivity: thresholdSensitivity(
      samples,
      config.thresholdPct,
    ),
    driveContext: buildDriveContext(samples),
    destinationCoverage: destination.coverage,
    destinationProfiles: destination.profiles,
    lowArrivals,
    coverage: {
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
      returnedTrendMonths: trend.allMonths,
      displayedTrendMonths: trend.points.length,
      omittedTrendMonths: trend.allMonths - trend.points.length,
      support: buildSupport(
        samples.length,
        activeDates.length,
        activeWeeks.size,
        daysSinceLastObservation,
      ),
    },
  };
}
