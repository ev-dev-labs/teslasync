/**
 * Pure Share Card evidence model.
 *
 * Runtime rows are treated as untrusted input. The model preserves canonical
 * SI values, records one terminal disposition per returned row, and never
 * substitutes a missing measurement with a measured zero.
 */

export const SHARE_CARD_HISTORY_LIMIT = 1_000;
export const SHARE_CARD_SVG_REVOKE_DELAY_MS = 1_500;

export type ShareCardDisposition =
  | 'invalidRow'
  | 'invalidId'
  | 'duplicateId'
  | 'invalidTimestamp'
  | 'beforeWindow'
  | 'atOrAfterEnd'
  | 'eligible';

export interface ShareCardWindowInput {
  startLabel: string;
  endLabel: string;
  startInstant: string;
  endInstantExclusive: string;
  timezone: string;
}

export interface ShareCardWindowAnalysis extends ShareCardWindowInput {
  valid: boolean;
  timezoneValid: boolean;
  resolvedTimezone: string;
  requestedCalendarDays: number | null;
}

export interface ShareCardFieldCoverage {
  validRows: number;
  missingRows: number;
}

export interface ShareCardCoverage {
  distance: ShareCardFieldCoverage;
  duration: ShareCardFieldCoverage;
  energy: ShareCardFieldCoverage;
  regen: ShareCardFieldCoverage;
  averageSpeed: ShareCardFieldCoverage;
  maxSpeed: ShareCardFieldCoverage;
  temperature: ShareCardFieldCoverage;
  routeLabels: ShareCardFieldCoverage;
}

export interface ShareCardAggregate {
  value: number | null;
  supportRows: number;
}

export interface ShareCardAggregates {
  distanceM: ShareCardAggregate;
  durationS: ShareCardAggregate;
  energyUsedWh: ShareCardAggregate;
  regenEnergyWh: ShareCardAggregate;
  averageSpeedMps: ShareCardAggregate;
  maxSpeedMps: ShareCardAggregate;
  averageTemperatureC: ShareCardAggregate;
  longestDistanceM: ShareCardAggregate;
}

export interface ShareCardEfficiencyEvidence {
  whPerKm: number | null;
  supportRows: number;
  supportDistanceM: number | null;
  supportEnergyWh: number | null;
}

export interface ShareCardRegenEvidence {
  recoveredWh: number | null;
  measuredRows: number;
  pairedRows: number;
  pairedDriveEnergyWh: number | null;
  pairedRegenWh: number | null;
  recoveredSharePct: number | null;
}

export interface ShareCardMonthlyBucket {
  month: string;
  driveCount: number;
  distanceM: number | null;
  distanceSupportRows: number;
  energyWh: number | null;
  energySupportRows: number;
}

export interface ShareCardWeekdayBucket {
  weekday: number;
  driveCount: number;
  distanceM: number | null;
  distanceSupportRows: number;
  energyWh: number | null;
  energySupportRows: number;
}

export interface ShareCardDayBucket {
  day: string;
  driveCount: number;
  distanceM: number | null;
  durationS: number | null;
  energyWh: number | null;
}

export interface ShareCardDistributionBucket {
  id: string;
  minInclusive: number;
  maxExclusive: number | null;
  count: number;
  sum: number;
}

export interface ShareCardQuantiles {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

export interface ShareCardRepresentativeDrive {
  rank: number;
  id: number;
  timestamp: string;
  localDay: string;
  distanceM: number | null;
  durationS: number | null;
  energyWh: number | null;
  efficiencyWhPerKm: number | null;
  maxSpeedMps: number | null;
  hasRouteLabels: boolean;
}

export interface ShareCardIdentity {
  id: string;
  expected: number;
  actual: number;
  residual: number;
  tolerance: number;
  passes: boolean;
}

export type ShareCardLineKey =
  | 'distance'
  | 'driveCount'
  | 'energy'
  | 'regen'
  | 'longest'
  | 'topSpeed';

export interface ShareCardLineEvidence {
  key: ShareCardLineKey;
  available: boolean;
  supportRows: number;
}

export interface ShareCardReadiness {
  ready: boolean;
  lineInventory: readonly ShareCardLineEvidence[];
  missingMetricKeys: readonly ShareCardLineKey[];
  scope: 'cappedSample' | 'returnedEvidence';
}

export interface ShareCardAnalysis {
  window: ShareCardWindowAnalysis;
  returnedRows: number;
  dispositions: Record<ShareCardDisposition, number>;
  eligibleRows: number;
  historyCapReached: boolean;
  coverage: ShareCardCoverage;
  aggregates: ShareCardAggregates;
  efficiency: ShareCardEfficiencyEvidence;
  regen: ShareCardRegenEvidence;
  activeDays: number;
  earliestEvidence: string | null;
  latestEvidence: string | null;
  observedSpanS: number | null;
  observedCalendarDays: number | null;
  monthly: readonly ShareCardMonthlyBucket[];
  weekdays: readonly ShareCardWeekdayBucket[];
  days: readonly ShareCardDayBucket[];
  distanceDistribution: readonly ShareCardDistributionBucket[];
  durationDistribution: readonly ShareCardDistributionBucket[];
  distanceQuantilesM: ShareCardQuantiles;
  durationQuantilesS: ShareCardQuantiles;
  representatives: readonly ShareCardRepresentativeDrive[];
  identities: readonly ShareCardIdentity[];
  card: ShareCardReadiness;
}

interface EligibleDrive {
  id: number;
  timestampMs: number;
  timestamp: string;
  localDay: string;
  month: string;
  weekday: number;
  distanceM: number | null;
  durationS: number | null;
  energyWh: number | null;
  regenWh: number | null;
  averageSpeedMps: number | null;
  maxSpeedMps: number | null;
  temperatureC: number | null;
  hasRouteLabels: boolean;
}

const DISPOSITIONS: readonly ShareCardDisposition[] = [
  'invalidRow',
  'invalidId',
  'duplicateId',
  'invalidTimestamp',
  'beforeWindow',
  'atOrAfterEnd',
  'eligible',
];

const COVERAGE_KEYS = [
  'distance',
  'duration',
  'energy',
  'regen',
  'averageSpeed',
  'maxSpeed',
  'temperature',
  'routeLabels',
] as const;

const DISTANCE_BANDS = [
  { id: 'under5km', minInclusive: 0, maxExclusive: 5_000 },
  { id: '5to20km', minInclusive: 5_000, maxExclusive: 20_000 },
  { id: '20to50km', minInclusive: 20_000, maxExclusive: 50_000 },
  { id: '50kmPlus', minInclusive: 50_000, maxExclusive: null },
] as const;

const DURATION_BANDS = [
  { id: 'under15min', minInclusive: 0, maxExclusive: 900 },
  { id: '15to30min', minInclusive: 900, maxExclusive: 1_800 },
  { id: '30to60min', minInclusive: 1_800, maxExclusive: 3_600 },
  { id: '60minPlus', minInclusive: 3_600, maxExclusive: null },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function read(
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): unknown {
  return row[camelKey] ?? row[snakeKey];
}

function finiteNonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function nonBlank(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function calendarDays(start: string, end: string): number | null {
  if (!validCalendarDate(start) || !validCalendarDate(end) || start > end) {
    return null;
  }
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function resolveTimeZone(timezone: string): {
  resolvedTimezone: string;
  timezoneValid: boolean;
} {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(0);
    return { resolvedTimezone: timezone, timezoneValid: true };
  } catch {
    return { resolvedTimezone: 'UTC', timezoneValid: false };
  }
}

function localDay(timestampMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestampMs);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function monthRange(startLabel: string, endLabel: string): string[] {
  if (!validCalendarDate(startLabel) || !validCalendarDate(endLabel) || startLabel > endLabel) {
    return [];
  }
  const out: string[] = [];
  let year = Number(startLabel.slice(0, 4));
  let month = Number(startLabel.slice(5, 7));
  const endYear = Number(endLabel.slice(0, 4));
  const endMonth = Number(endLabel.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

function coverage(validRows: number, eligibleRows: number): ShareCardFieldCoverage {
  return { validRows, missingRows: eligibleRows - validRows };
}

function aggregate(values: readonly (number | null)[]): ShareCardAggregate {
  const measured = values.filter((value): value is number => value != null);
  return {
    value: measured.length > 0
      ? measured.reduce((sum, value) => sum + value, 0)
      : null,
    supportRows: measured.length,
  };
}

function average(values: readonly (number | null)[]): ShareCardAggregate {
  const measured = values.filter((value): value is number => value != null);
  return {
    value: measured.length > 0
      ? measured.reduce((sum, value) => sum + value, 0) / measured.length
      : null,
    supportRows: measured.length,
  };
}

function maximum(values: readonly (number | null)[]): ShareCardAggregate {
  const measured = values.filter((value): value is number => value != null);
  return {
    value: measured.length > 0 ? Math.max(...measured) : null,
    supportRows: measured.length,
  };
}

function quantile(sortedValues: readonly number[], percentile: number): number | null {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0] ?? null;
  const index = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sortedValues[lower] ?? 0;
  const upperValue = sortedValues[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

function quantiles(values: readonly number[]): ShareCardQuantiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
  };
}

function distribution(
  values: readonly number[],
  bands: readonly {
    id: string;
    minInclusive: number;
    maxExclusive: number | null;
  }[],
): ShareCardDistributionBucket[] {
  return bands.map((band) => {
    const matching = values.filter((value) =>
      value >= band.minInclusive
      && (band.maxExclusive == null || value < band.maxExclusive));
    return {
      ...band,
      count: matching.length,
      sum: matching.reduce((sum, value) => sum + value, 0),
    };
  });
}

function identity(
  id: string,
  expected: number,
  actual: number,
  tolerance = 0,
): ShareCardIdentity {
  const residual = actual - expected;
  return {
    id,
    expected,
    actual,
    residual,
    tolerance,
    passes: Math.abs(residual) <= tolerance,
  };
}

function nullableTotal(current: number | null, value: number | null): number | null {
  if (value == null) return current;
  return (current ?? 0) + value;
}

function buildMonthly(
  drives: readonly EligibleDrive[],
  window: ShareCardWindowInput,
  historyCapReached: boolean,
): ShareCardMonthlyBucket[] {
  const requestedMonths = monthRange(window.startLabel, window.endLabel);
  const observedMonths = [...new Set(drives.map((drive) => drive.month))].sort();
  // Once the endpoint cap is reached, an absent requested month is unknown,
  // not a measured zero. Only months represented by returned evidence remain.
  const months = historyCapReached
    ? observedMonths
    : requestedMonths.length > 0
      ? requestedMonths
      : observedMonths;
  const buckets = new Map<string, ShareCardMonthlyBucket>(
    months.map((month) => [month, {
      month,
      driveCount: 0,
      distanceM: null,
      distanceSupportRows: 0,
      energyWh: null,
      energySupportRows: 0,
    }]),
  );
  for (const drive of drives) {
    const bucket = buckets.get(drive.month) ?? {
      month: drive.month,
      driveCount: 0,
      distanceM: null,
      distanceSupportRows: 0,
      energyWh: null,
      energySupportRows: 0,
    };
    bucket.driveCount += 1;
    bucket.distanceM = nullableTotal(bucket.distanceM, drive.distanceM);
    bucket.energyWh = nullableTotal(bucket.energyWh, drive.energyWh);
    if (drive.distanceM != null) bucket.distanceSupportRows += 1;
    if (drive.energyWh != null) bucket.energySupportRows += 1;
    buckets.set(drive.month, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function buildWeekdays(drives: readonly EligibleDrive[]): ShareCardWeekdayBucket[] {
  const buckets: ShareCardWeekdayBucket[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    driveCount: 0,
    distanceM: null,
    distanceSupportRows: 0,
    energyWh: null,
    energySupportRows: 0,
  }));
  for (const drive of drives) {
    const bucket = buckets[drive.weekday];
    if (!bucket) continue;
    bucket.driveCount += 1;
    bucket.distanceM = nullableTotal(bucket.distanceM, drive.distanceM);
    bucket.energyWh = nullableTotal(bucket.energyWh, drive.energyWh);
    if (drive.distanceM != null) bucket.distanceSupportRows += 1;
    if (drive.energyWh != null) bucket.energySupportRows += 1;
  }
  return buckets;
}

function buildDays(drives: readonly EligibleDrive[]): ShareCardDayBucket[] {
  const buckets = new Map<string, ShareCardDayBucket>();
  for (const drive of drives) {
    const bucket = buckets.get(drive.localDay) ?? {
      day: drive.localDay,
      driveCount: 0,
      distanceM: null,
      durationS: null,
      energyWh: null,
    };
    bucket.driveCount += 1;
    bucket.distanceM = nullableTotal(bucket.distanceM, drive.distanceM);
    bucket.durationS = nullableTotal(bucket.durationS, drive.durationS);
    bucket.energyWh = nullableTotal(bucket.energyWh, drive.energyWh);
    buckets.set(drive.localDay, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Build a selected-window analysis without mutating `runtimeRows`.
 */
export function analyzeShareCard(
  runtimeRows: readonly unknown[],
  inputWindow: ShareCardWindowInput,
): ShareCardAnalysis {
  const returnedRows = runtimeRows.length;
  const historyCapReached = returnedRows >= SHARE_CARD_HISTORY_LIMIT;
  const dispositions = Object.fromEntries(
    DISPOSITIONS.map((key) => [key, 0]),
  ) as Record<ShareCardDisposition, number>;
  const startMs = parseInstant(inputWindow.startInstant);
  const endMs = parseInstant(inputWindow.endInstantExclusive);
  const validWindow = startMs != null && endMs != null && startMs < endMs;
  const { resolvedTimezone, timezoneValid } = resolveTimeZone(inputWindow.timezone);
  const seenIds = new Set<number>();
  const eligible: EligibleDrive[] = [];

  for (const runtimeRow of runtimeRows) {
    if (!isRecord(runtimeRow)) {
      dispositions.invalidRow += 1;
      continue;
    }
    const rawId = read(runtimeRow, 'id', 'id');
    if (
      typeof rawId !== 'number'
      || !Number.isInteger(rawId)
      || rawId <= 0
    ) {
      dispositions.invalidId += 1;
      continue;
    }
    if (seenIds.has(rawId)) {
      dispositions.duplicateId += 1;
      continue;
    }
    seenIds.add(rawId);
    const timestampMs = parseInstant(read(runtimeRow, 'startTs', 'start_ts'));
    if (timestampMs == null) {
      dispositions.invalidTimestamp += 1;
      continue;
    }
    if (validWindow && timestampMs < startMs) {
      dispositions.beforeWindow += 1;
      continue;
    }
    if (validWindow && timestampMs >= endMs) {
      dispositions.atOrAfterEnd += 1;
      continue;
    }

    const day = localDay(timestampMs, resolvedTimezone);
    const distanceM = finiteNonnegative(read(runtimeRow, 'distanceM', 'distance_m'));
    const durationS = finiteNonnegative(read(runtimeRow, 'durationS', 'duration_s'));
    const energyWh = finiteNonnegative(read(runtimeRow, 'energyUsedWh', 'energy_used_wh'));
    const regenWh = finiteNonnegative(read(runtimeRow, 'regenEnergyWh', 'regen_energy_wh'));
    const averageSpeedMps = finiteNonnegative(read(runtimeRow, 'avgSpeedMps', 'avg_speed_mps'));
    const maxSpeedMps = finiteNonnegative(read(runtimeRow, 'maxSpeedMps', 'max_speed_mps'));
    const outsideTemperature = read(runtimeRow, 'outsideTempAvgC', 'outside_temp_avg_c');
    const insideTemperature = read(runtimeRow, 'insideTempAvgC', 'inside_temp_avg_c');
    const temperatureC = typeof outsideTemperature === 'number'
      && Number.isFinite(outsideTemperature)
      ? outsideTemperature
      : typeof insideTemperature === 'number' && Number.isFinite(insideTemperature)
        ? insideTemperature
        : null;
    const hasRouteLabels = nonBlank(read(runtimeRow, 'startAddress', 'start_address'))
      || nonBlank(read(runtimeRow, 'endAddress', 'end_address'));
    eligible.push({
      id: rawId,
      timestampMs,
      timestamp: new Date(timestampMs).toISOString(),
      localDay: day,
      month: day.slice(0, 7),
      weekday: new Date(`${day}T00:00:00Z`).getUTCDay(),
      distanceM,
      durationS,
      energyWh,
      regenWh,
      averageSpeedMps,
      maxSpeedMps,
      temperatureC,
      hasRouteLabels,
    });
    dispositions.eligible += 1;
  }

  const distanceValues = eligible.map((drive) => drive.distanceM);
  const durationValues = eligible.map((drive) => drive.durationS);
  const energyValues = eligible.map((drive) => drive.energyWh);
  const regenValues = eligible.map((drive) => drive.regenWh);
  const averageSpeedValues = eligible.map((drive) => drive.averageSpeedMps);
  const maxSpeedValues = eligible.map((drive) => drive.maxSpeedMps);
  const temperatureValues = eligible.map((drive) => drive.temperatureC);
  const measuredDistances = distanceValues.filter((value): value is number => value != null);
  const measuredDurations = durationValues.filter((value): value is number => value != null);
  const routeSupport = eligible.filter((drive) => drive.hasRouteLabels).length;

  const aggregates: ShareCardAggregates = {
    distanceM: aggregate(distanceValues),
    durationS: aggregate(durationValues),
    energyUsedWh: aggregate(energyValues),
    regenEnergyWh: aggregate(regenValues),
    averageSpeedMps: average(averageSpeedValues),
    maxSpeedMps: maximum(maxSpeedValues),
    averageTemperatureC: average(temperatureValues),
    longestDistanceM: maximum(distanceValues),
  };
  const analysisCoverage: ShareCardCoverage = {
    distance: coverage(aggregates.distanceM.supportRows, eligible.length),
    duration: coverage(aggregates.durationS.supportRows, eligible.length),
    energy: coverage(aggregates.energyUsedWh.supportRows, eligible.length),
    regen: coverage(aggregates.regenEnergyWh.supportRows, eligible.length),
    averageSpeed: coverage(aggregates.averageSpeedMps.supportRows, eligible.length),
    maxSpeed: coverage(aggregates.maxSpeedMps.supportRows, eligible.length),
    temperature: coverage(aggregates.averageTemperatureC.supportRows, eligible.length),
    routeLabels: coverage(routeSupport, eligible.length),
  };

  const efficiencyRows = eligible.filter((drive) =>
    drive.distanceM != null
    && drive.distanceM > 0
    && drive.energyWh != null);
  const efficiencyDistanceM = efficiencyRows.reduce(
    (sum, drive) => sum + (drive.distanceM ?? 0),
    0,
  );
  const efficiencyEnergyWh = efficiencyRows.reduce(
    (sum, drive) => sum + (drive.energyWh ?? 0),
    0,
  );
  const efficiency: ShareCardEfficiencyEvidence = {
    whPerKm: efficiencyRows.length > 0 && efficiencyDistanceM > 0
      ? efficiencyEnergyWh / (efficiencyDistanceM / 1_000)
      : null,
    supportRows: efficiencyRows.length,
    supportDistanceM: efficiencyRows.length > 0 ? efficiencyDistanceM : null,
    supportEnergyWh: efficiencyRows.length > 0 ? efficiencyEnergyWh : null,
  };

  const pairedRegenRows = eligible.filter((drive) =>
    drive.energyWh != null && drive.regenWh != null);
  const pairedDriveEnergyWh = pairedRegenRows.reduce(
    (sum, drive) => sum + (drive.energyWh ?? 0),
    0,
  );
  const pairedRegenWh = pairedRegenRows.reduce(
    (sum, drive) => sum + (drive.regenWh ?? 0),
    0,
  );
  const regenDenominator = pairedDriveEnergyWh + pairedRegenWh;
  const regen: ShareCardRegenEvidence = {
    recoveredWh: aggregates.regenEnergyWh.value,
    measuredRows: aggregates.regenEnergyWh.supportRows,
    pairedRows: pairedRegenRows.length,
    pairedDriveEnergyWh: pairedRegenRows.length > 0 ? pairedDriveEnergyWh : null,
    pairedRegenWh: pairedRegenRows.length > 0 ? pairedRegenWh : null,
    recoveredSharePct: pairedRegenRows.length > 0 && regenDenominator > 0
      ? (pairedRegenWh / regenDenominator) * 100
      : null,
  };

  const monthly = buildMonthly(eligible, inputWindow, historyCapReached);
  const weekdays = buildWeekdays(eligible);
  const days = buildDays(eligible);
  const distanceDistribution = distribution(measuredDistances, DISTANCE_BANDS);
  const durationDistribution = distribution(measuredDurations, DURATION_BANDS);
  const chronological = [...eligible].sort((a, b) => a.timestampMs - b.timestampMs);
  const earliest = chronological[0] ?? null;
  const latest = chronological[chronological.length - 1] ?? null;

  const representatives = [...eligible]
    .sort((a, b) =>
      (b.distanceM ?? -1) - (a.distanceM ?? -1)
      || (b.durationS ?? -1) - (a.durationS ?? -1)
      || a.timestampMs - b.timestampMs
      || a.id - b.id)
    .slice(0, 12)
    .map((drive, index): ShareCardRepresentativeDrive => ({
      rank: index + 1,
      id: drive.id,
      timestamp: drive.timestamp,
      localDay: drive.localDay,
      distanceM: drive.distanceM,
      durationS: drive.durationS,
      energyWh: drive.energyWh,
      efficiencyWhPerKm: drive.distanceM != null
        && drive.distanceM > 0
        && drive.energyWh != null
        ? drive.energyWh / (drive.distanceM / 1_000)
        : null,
      maxSpeedMps: drive.maxSpeedMps,
      hasRouteLabels: drive.hasRouteLabels,
    }));

  const dispositionSum = DISPOSITIONS.reduce(
    (sum, key) => sum + dispositions[key],
    0,
  );
  const identities: ShareCardIdentity[] = [
    identity('rows.dispositions', returnedRows, dispositionSum),
    ...COVERAGE_KEYS.map((key) =>
      identity(
        `coverage.${key}`,
        eligible.length,
        analysisCoverage[key].validRows + analysisCoverage[key].missingRows,
      )),
    identity(
      'buckets.monthlyCount',
      eligible.length,
      monthly.reduce((sum, bucket) => sum + bucket.driveCount, 0),
    ),
    identity(
      'buckets.weekdayCount',
      eligible.length,
      weekdays.reduce((sum, bucket) => sum + bucket.driveCount, 0),
    ),
    identity(
      'buckets.dayCount',
      eligible.length,
      days.reduce((sum, bucket) => sum + bucket.driveCount, 0),
    ),
    identity(
      'distribution.distanceSupport',
      aggregates.distanceM.supportRows,
      distanceDistribution.reduce((sum, bucket) => sum + bucket.count, 0),
    ),
    identity(
      'distribution.durationSupport',
      aggregates.durationS.supportRows,
      durationDistribution.reduce((sum, bucket) => sum + bucket.count, 0),
    ),
    identity(
      'distribution.distanceTotal',
      aggregates.distanceM.value ?? 0,
      distanceDistribution.reduce((sum, bucket) => sum + bucket.sum, 0),
      0.000_001,
    ),
    identity(
      'distribution.durationTotal',
      aggregates.durationS.value ?? 0,
      durationDistribution.reduce((sum, bucket) => sum + bucket.sum, 0),
      0.000_001,
    ),
  ];

  const lineInventory: ShareCardLineEvidence[] = [
    {
      key: 'distance',
      available: aggregates.distanceM.value != null,
      supportRows: aggregates.distanceM.supportRows,
    },
    {
      key: 'driveCount',
      available: eligible.length > 0,
      supportRows: eligible.length,
    },
    {
      key: 'energy',
      available: aggregates.energyUsedWh.value != null,
      supportRows: aggregates.energyUsedWh.supportRows,
    },
    {
      key: 'regen',
      available: aggregates.regenEnergyWh.value != null,
      supportRows: aggregates.regenEnergyWh.supportRows,
    },
    {
      key: 'longest',
      available: aggregates.longestDistanceM.value != null,
      supportRows: aggregates.longestDistanceM.supportRows,
    },
    {
      key: 'topSpeed',
      available: aggregates.maxSpeedMps.value != null,
      supportRows: aggregates.maxSpeedMps.supportRows,
    },
  ];

  return {
    window: {
      ...inputWindow,
      valid: validWindow,
      timezoneValid,
      resolvedTimezone,
      requestedCalendarDays: calendarDays(
        inputWindow.startLabel,
        inputWindow.endLabel,
      ),
    },
    returnedRows,
    dispositions,
    eligibleRows: eligible.length,
    historyCapReached,
    coverage: analysisCoverage,
    aggregates,
    efficiency,
    regen,
    activeDays: days.length,
    earliestEvidence: earliest?.timestamp ?? null,
    latestEvidence: latest?.timestamp ?? null,
    observedSpanS: earliest && latest
      ? (latest.timestampMs - earliest.timestampMs) / 1_000
      : null,
    observedCalendarDays: earliest && latest
      ? calendarDays(earliest.localDay, latest.localDay)
      : null,
    monthly,
    weekdays,
    days,
    distanceDistribution,
    durationDistribution,
    distanceQuantilesM: quantiles(measuredDistances),
    durationQuantilesS: quantiles(measuredDurations),
    representatives,
    identities,
    card: {
      ready: eligible.length > 0,
      lineInventory,
      missingMetricKeys: lineInventory
        .filter((line) => !line.available && line.key !== 'driveCount')
        .map((line) => line.key),
      scope: historyCapReached
        ? 'cappedSample'
        : 'returnedEvidence',
    },
  };
}

export type ShareCardTheme = 'midnight' | 'aurora' | 'ember';

export const SHARE_CARD_THEMES: Record<
  ShareCardTheme,
  { bg: string; accent: string; soft: string }
> = {
  midnight: { bg: '#0b1220', accent: '#22d3ee', soft: '#38bdf8' },
  aurora: { bg: '#071a12', accent: '#34d399', soft: '#a7f3d0' },
  ember: { bg: '#1c0f0a', accent: '#fb923c', soft: '#fdba74' },
};

export interface ShareCardLine {
  label: string;
  value: string;
}

export interface ShareCardSvgMetadata {
  disclosure?: string;
  footer?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapSvgText(
  value: string,
  maxCharacters: number,
  maxLines: number,
): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  let index = 0;

  while (index < words.length && lines.length < maxLines) {
    const word = words[index] ?? '';
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || current.length === 0) {
      current = candidate;
      index += 1;
      continue;
    }
    lines.push(current);
    current = '';
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (index < words.length) {
    const lastIndex = Math.max(0, lines.length - 1);
    const last = lines[lastIndex] ?? '';
    lines[lastIndex] = `${last.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
  }
  return lines;
}

function renderWrappedSvgText(
  value: string,
  {
    x,
    y,
    fill,
    fontSize,
    lineHeight,
    maxCharacters,
    maxLines,
  }: {
    x: number;
    y: number;
    fill: string;
    fontSize: number;
    lineHeight: number;
    maxCharacters: number;
    maxLines: number;
  },
): string {
  const lines = wrapSvgText(value, maxCharacters, maxLines);
  const tspans = lines.map((line, index) =>
    `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
  ).join('');
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${fontSize}" font-family="Segoe UI, Arial, sans-serif">${tspans}</text>`;
}

/**
 * Render a deterministic 800×418 SVG. All content is escaped and at most six
 * line items are included.
 */
export function renderShareCardSvg(
  title: string,
  subtitle: string,
  lines: readonly ShareCardLine[],
  theme: ShareCardTheme,
  metadata: ShareCardSvgMetadata = {},
): string {
  const selectedTheme = SHARE_CARD_THEMES[theme] ?? SHARE_CARD_THEMES.midnight;
  const width = 800;
  const height = 418;
  const shown = lines.slice(0, 6);
  const columns = shown.length > 3 ? 3 : Math.max(1, shown.length);
  const columnWidth = (width - 96) / columns;
  const cells = shown.map((line, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = 48 + column * columnWidth;
    const y = 216 + row * 88;
    return [
      `<text x="${x}" y="${y}" fill="${selectedTheme.accent}" font-size="32" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(line.value)}</text>`,
      `<text x="${x}" y="${y + 25}" fill="#94a3b8" font-size="14" font-family="Segoe UI, Arial, sans-serif">${escapeXml(line.label)}</text>`,
    ].join('');
  }).join('');
  const disclosure = metadata.disclosure
    ? renderWrappedSvgText(metadata.disclosure, {
      x: 48,
      y: 132,
      fill: '#cbd5e1',
      fontSize: 13,
      lineHeight: 17,
      maxCharacters: 88,
      maxLines: 2,
    })
    : '';
  const footer = metadata.footer ?? 'TeslaSync';
  const titleFit = title.length > 36
    ? ` textLength="${width - 96}" lengthAdjust="spacingAndGlyphs"`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="share-card-title share-card-description">`,
    `<title id="share-card-title">${escapeXml(title)}</title>`,
    `<desc id="share-card-description">${escapeXml([subtitle, metadata.disclosure].filter(Boolean).join('. '))}</desc>`,
    `<rect width="${width}" height="${height}" rx="24" fill="${selectedTheme.bg}"/>`,
    `<rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="22.5" fill="none" stroke="${selectedTheme.accent}" stroke-opacity="0.35" stroke-width="3"/>`,
    `<circle cx="${width - 84}" cy="84" r="120" fill="${selectedTheme.soft}" opacity="0.08"/>`,
    `<circle cx="${width - 44}" cy="44" r="60" fill="${selectedTheme.accent}" opacity="0.1"/>`,
    `<text x="48" y="72" fill="#f8fafc" font-size="38" font-weight="700" font-family="Segoe UI, Arial, sans-serif"${titleFit}>${escapeXml(title)}</text>`,
    renderWrappedSvgText(subtitle, {
      x: 48,
      y: 105,
      fill: '#94a3b8',
      fontSize: 17,
      lineHeight: 20,
      maxCharacters: 76,
      maxLines: 1,
    }),
    disclosure,
    `<line x1="48" y1="170" x2="${width - 48}" y2="170" stroke="${selectedTheme.accent}" stroke-opacity="0.3" stroke-width="1.5"/>`,
    cells,
    renderWrappedSvgText(footer, {
      x: 48,
      y: height - 20,
      fill: '#64748b',
      fontSize: 12,
      lineHeight: 14,
      maxCharacters: 96,
      maxLines: 1,
    }),
    '</svg>',
  ].join('');
}

/** Trigger a local SVG download and delay object URL cleanup for browser use. */
export function downloadShareCardSvg(svg: string | null, fileName: string): boolean {
  if (!svg || typeof document === 'undefined') return false;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.replace(/[^a-zA-Z0-9_.-]/g, '-');
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(
      () => URL.revokeObjectURL(url),
      SHARE_CARD_SVG_REVOKE_DELAY_MS,
    );
  }
  return true;
}
