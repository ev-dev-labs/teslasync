/**
 * Pure regenerative-recovery evidence model.
 *
 * Every input measurement remains canonical SI (Wh, m, s, m/s, °C). Display
 * conversion belongs at the React boundary. The model makes no target,
 * benchmark, causal, savings, or composite-score claim.
 */

import type { Drive } from '@/types/driving';
import { ymdInTz } from '@/lib/dateFormat';

export const REGEN_HISTORY_LIMIT = 1_000;
export const REGEN_MONTH_DISPLAY_LIMIT = 24;
export const REGEN_RANKED_DRIVE_LIMIT = 10;

export type RegenRatioBucketKey =
  | 'below5'
  | 'from5To10'
  | 'from10To15'
  | 'from15To20'
  | 'from20To30'
  | 'from30';

export type RegenTemperatureBucketKey =
  | 'below0'
  | 'from0To10'
  | 'from10To20'
  | 'from20To30'
  | 'from30';

export type RegenSocBucketKey =
  | 'below40'
  | 'from40To60'
  | 'from60To80'
  | 'from80To90'
  | 'from90';

export interface RegenMissingFieldAccounting {
  regenEnergyWh: number;
  energyUsedWh: number;
  startTs: number;
  outsideTempAvgC: number;
  startBatteryPct: number;
}

export interface RegenInvalidFieldAccounting {
  /** Finite negative recovered-energy values. Zero is valid. */
  regenEnergyWh: number;
  /** Non-finite, zero, or negative drive-energy denominators. */
  energyUsedWh: number;
  startTs: number;
  outsideTempAvgC: number;
  /** Finite values outside the physical 0–100 percent interval. */
  startBatteryPct: number;
}

export interface RegenCoverageAccounting {
  observedCount: number;
  eligibleCount: number;
  excludedCount: number;
  historyLimit: number;
  historyCapReached: boolean;
  missingFields: RegenMissingFieldAccounting;
  invalidFields: RegenInvalidFieldAccounting;
}

export interface RegenRatioStatistics {
  medianPct: number | null;
  q1Pct: number | null;
  q3Pct: number | null;
  minPct: number | null;
  maxPct: number | null;
}

export interface RegenMonthBucket {
  month: string;
  totalRegenWh: number | null;
  totalDriveEnergyWh: number | null;
  eligibleCount: number;
  returnedCount: number;
  energyWeightedRatioPct: number | null;
}

export interface RegenRatioDistributionBucket {
  key: RegenRatioBucketKey;
  eligibleCount: number;
  eligibleSharePct: number;
}

export interface RegenContextBucket<Key extends string> {
  key: Key;
  returnedCount: number;
  eligibleCount: number;
  totalRegenWh: number;
  totalDriveEnergyWh: number;
  energyWeightedRatioPct: number | null;
}

export interface RankedRegenDrive {
  rank: number;
  driveId: number;
  startTs: string | null;
  regenEnergyWh: number;
  driveEnergyWh: number;
  recoveryRatioPct: number;
  distanceM: number | null;
  durationS: number | null;
  avgSpeedMps: number | null;
  startSocPct: number | null;
  outsideTempAvgC: number | null;
}

export interface RegenEfficiencyModel {
  /** IANA timezone used for every calendar-month assignment. */
  timeZone: string;
  accounting: RegenCoverageAccounting;
  totalMeasuredRegenWh: number;
  totalMeasuredDriveEnergyWh: number;
  energyWeightedRatioPct: number | null;
  ratioStatistics: RegenRatioStatistics;
  months: RegenMonthBucket[];
  displayMonths: RegenMonthBucket[];
  totalMonthCount: number;
  displayMonthLimit: number;
  monthsTruncated: boolean;
  ratioDistribution: RegenRatioDistributionBucket[];
  temperatureBuckets: Array<RegenContextBucket<RegenTemperatureBucketKey>>;
  startingSocBuckets: Array<RegenContextBucket<RegenSocBucketKey>>;
  rankedDrives: RankedRegenDrive[];
  rankedDriveTotal: number;
  rankedDriveLimit: number;
}

interface DateResult {
  month: string | null;
  startTs: string | null;
  status: 'valid' | 'missing' | 'invalid';
}

interface EligibleRow {
  sourceIndex: number;
  drive: Drive;
  date: DateResult;
  regenEnergyWh: number;
  driveEnergyWh: number;
  ratioPct: number;
}

type MutableContextBucket<Key extends string> = RegenContextBucket<Key>;

function positiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return Math.max(1, Math.floor(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMissing(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function normalizeTimeZone(timeZone: string): string {
  const candidate = timeZone.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return 'UTC';
  }
}

function parseDriveDate(value: unknown, timeZone: string): DateResult {
  if (isMissing(value)) {
    return { month: null, startTs: null, status: 'missing' };
  }
  if (typeof value !== 'string') {
    return { month: null, startTs: null, status: 'invalid' };
  }

  const calendarMatch = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (calendarMatch) {
    const year = Number(calendarMatch[1]);
    const month = Number(calendarMatch[2]);
    const day = Number(calendarMatch[3]);
    const maxDay =
      month >= 1 && month <= 12
        ? new Date(Date.UTC(year, month, 0)).getUTCDate()
        : 0;
    if (
      year >= 1 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= maxDay &&
      Number.isFinite(Date.parse(value))
    ) {
      const dayKey = ymdInTz(new Date(value), timeZone);
      if (!dayKey) {
        return { month: null, startTs: null, status: 'invalid' };
      }
      return {
        month: dayKey.slice(0, 7),
        startTs: value,
        status: 'valid',
      };
    }
    return { month: null, startTs: null, status: 'invalid' };
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return { month: null, startTs: null, status: 'invalid' };
  }
  const dayKey = ymdInTz(new Date(timestamp), timeZone);
  if (!dayKey) {
    return { month: null, startTs: null, status: 'invalid' };
  }
  return {
    month: dayKey.slice(0, 7),
    startTs: value,
    status: 'valid',
  };
}

function percentile(sorted: readonly number[], quantile: number): number | null {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
}

function weightedRatio(regenWh: number, driveEnergyWh: number, count: number): number | null {
  return count > 0 && driveEnergyWh > 0
    ? (regenWh / driveEnergyWh) * 100
    : null;
}

function ratioBucketKey(ratioPct: number): RegenRatioBucketKey {
  if (ratioPct < 5) return 'below5';
  if (ratioPct < 10) return 'from5To10';
  if (ratioPct < 15) return 'from10To15';
  if (ratioPct < 20) return 'from15To20';
  if (ratioPct < 30) return 'from20To30';
  return 'from30';
}

function temperatureBucketKey(valueC: number): RegenTemperatureBucketKey {
  if (valueC < 0) return 'below0';
  if (valueC < 10) return 'from0To10';
  if (valueC < 20) return 'from10To20';
  if (valueC < 30) return 'from20To30';
  return 'from30';
}

function socBucketKey(valuePct: number): RegenSocBucketKey {
  if (valuePct < 40) return 'below40';
  if (valuePct < 60) return 'from40To60';
  if (valuePct < 80) return 'from60To80';
  if (valuePct < 90) return 'from80To90';
  return 'from90';
}

function createContextBuckets<Key extends string>(
  keys: readonly Key[],
): Map<Key, MutableContextBucket<Key>> {
  return new Map(
    keys.map((key) => [
      key,
      {
        key,
        returnedCount: 0,
        eligibleCount: 0,
        totalRegenWh: 0,
        totalDriveEnergyWh: 0,
        energyWeightedRatioPct: null,
      },
    ]),
  );
}

function finalizeContextBuckets<Key extends string>(
  buckets: Map<Key, MutableContextBucket<Key>>,
): Array<RegenContextBucket<Key>> {
  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    energyWeightedRatioPct: weightedRatio(
      bucket.totalRegenWh,
      bucket.totalDriveEnergyWh,
      bucket.eligibleCount,
    ),
  }));
}

function validNonNegative(value: unknown): number | null {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

function validSoc(value: unknown): number | null {
  return isFiniteNumber(value) && value >= 0 && value <= 100 ? value : null;
}

function addEligibleToContext<Key extends string>(
  bucket: MutableContextBucket<Key>,
  eligible: EligibleRow | undefined,
): void {
  bucket.returnedCount += 1;
  if (!eligible) return;
  bucket.eligibleCount += 1;
  bucket.totalRegenWh += eligible.regenEnergyWh;
  bucket.totalDriveEnergyWh += eligible.driveEnergyWh;
}

/**
 * Build deterministic descriptive evidence from the exact rows returned by
 * `/drives`. The input array and drive objects are never sorted or mutated.
 */
export function buildRegenEfficiencyModel(
  drives: readonly Drive[],
  historyLimit: number,
  timeZone = 'UTC',
): RegenEfficiencyModel {
  const normalizedHistoryLimit = positiveInteger(historyLimit, 'historyLimit');
  const resolvedTimeZone = normalizeTimeZone(timeZone);
  const missingFields: RegenMissingFieldAccounting = {
    regenEnergyWh: 0,
    energyUsedWh: 0,
    startTs: 0,
    outsideTempAvgC: 0,
    startBatteryPct: 0,
  };
  const invalidFields: RegenInvalidFieldAccounting = {
    regenEnergyWh: 0,
    energyUsedWh: 0,
    startTs: 0,
    outsideTempAvgC: 0,
    startBatteryPct: 0,
  };
  const eligibleRows: EligibleRow[] = [];
  const dates: DateResult[] = [];

  drives.forEach((drive, sourceIndex) => {
    const date = parseDriveDate(drive.startTs, resolvedTimeZone);
    dates.push(date);
    if (date.status === 'missing') missingFields.startTs += 1;
    if (date.status === 'invalid') invalidFields.startTs += 1;

    const regen = drive.regenEnergyWh;
    if (regen == null) missingFields.regenEnergyWh += 1;
    else if (!isFiniteNumber(regen) || regen < 0) invalidFields.regenEnergyWh += 1;

    const driveEnergy = drive.energyUsedWh;
    if (driveEnergy == null) missingFields.energyUsedWh += 1;
    else if (!isFiniteNumber(driveEnergy) || driveEnergy <= 0) invalidFields.energyUsedWh += 1;

    const temperature = drive.outsideTempAvgC;
    if (temperature == null) missingFields.outsideTempAvgC += 1;
    else if (!isFiniteNumber(temperature)) invalidFields.outsideTempAvgC += 1;

    const startSoc = drive.startBatteryPct;
    if (startSoc == null) missingFields.startBatteryPct += 1;
    else if (!isFiniteNumber(startSoc) || startSoc < 0 || startSoc > 100) {
      invalidFields.startBatteryPct += 1;
    }

    if (
      isFiniteNumber(regen) &&
      regen >= 0 &&
      isFiniteNumber(driveEnergy) &&
      driveEnergy > 0
    ) {
      eligibleRows.push({
        sourceIndex,
        drive,
        date,
        regenEnergyWh: regen,
        driveEnergyWh: driveEnergy,
        ratioPct: (regen / driveEnergy) * 100,
      });
    }
  });

  const eligibleByIndex = new Map(
    eligibleRows.map((row) => [row.sourceIndex, row]),
  );
  const totalMeasuredRegenWh = eligibleRows.reduce(
    (sum, row) => sum + row.regenEnergyWh,
    0,
  );
  const totalMeasuredDriveEnergyWh = eligibleRows.reduce(
    (sum, row) => sum + row.driveEnergyWh,
    0,
  );
  const sortedRatios = eligibleRows
    .map((row) => row.ratioPct)
    .sort((left, right) => left - right);

  const monthMap = new Map<
    string,
    {
      totalRegenWh: number;
      totalDriveEnergyWh: number;
      eligibleCount: number;
      returnedCount: number;
    }
  >();
  drives.forEach((_drive, sourceIndex) => {
    const month = dates[sourceIndex]?.month;
    if (!month) return;
    const aggregate = monthMap.get(month) ?? {
      totalRegenWh: 0,
      totalDriveEnergyWh: 0,
      eligibleCount: 0,
      returnedCount: 0,
    };
    aggregate.returnedCount += 1;
    const eligible = eligibleByIndex.get(sourceIndex);
    if (eligible) {
      aggregate.eligibleCount += 1;
      aggregate.totalRegenWh += eligible.regenEnergyWh;
      aggregate.totalDriveEnergyWh += eligible.driveEnergyWh;
    }
    monthMap.set(month, aggregate);
  });
  const months = [...monthMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, aggregate]): RegenMonthBucket => {
      const hasEligibleMeasurement = aggregate.eligibleCount > 0;
      return {
        month,
        totalRegenWh: hasEligibleMeasurement ? aggregate.totalRegenWh : null,
        totalDriveEnergyWh: hasEligibleMeasurement
          ? aggregate.totalDriveEnergyWh
          : null,
        eligibleCount: aggregate.eligibleCount,
        returnedCount: aggregate.returnedCount,
        energyWeightedRatioPct: weightedRatio(
          aggregate.totalRegenWh,
          aggregate.totalDriveEnergyWh,
          aggregate.eligibleCount,
        ),
      };
    });

  const ratioKeys: readonly RegenRatioBucketKey[] = [
    'below5',
    'from5To10',
    'from10To15',
    'from15To20',
    'from20To30',
    'from30',
  ];
  const ratioCounts = new Map(ratioKeys.map((key) => [key, 0]));
  for (const row of eligibleRows) {
    const key = ratioBucketKey(row.ratioPct);
    ratioCounts.set(key, (ratioCounts.get(key) ?? 0) + 1);
  }
  const ratioDistribution = ratioKeys.map((key) => {
    const eligibleCount = ratioCounts.get(key) ?? 0;
    return {
      key,
      eligibleCount,
      eligibleSharePct:
        eligibleRows.length > 0
          ? (eligibleCount / eligibleRows.length) * 100
          : 0,
    };
  });

  const temperatureKeys: readonly RegenTemperatureBucketKey[] = [
    'below0',
    'from0To10',
    'from10To20',
    'from20To30',
    'from30',
  ];
  const temperatureMap = createContextBuckets(temperatureKeys);
  const socKeys: readonly RegenSocBucketKey[] = [
    'below40',
    'from40To60',
    'from60To80',
    'from80To90',
    'from90',
  ];
  const socMap = createContextBuckets(socKeys);

  drives.forEach((drive, sourceIndex) => {
    const eligible = eligibleByIndex.get(sourceIndex);
    if (isFiniteNumber(drive.outsideTempAvgC)) {
      const bucket = temperatureMap.get(
        temperatureBucketKey(drive.outsideTempAvgC),
      );
      if (bucket) addEligibleToContext(bucket, eligible);
    }
    const soc = validSoc(drive.startBatteryPct);
    if (soc != null) {
      const bucket = socMap.get(socBucketKey(soc));
      if (bucket) addEligibleToContext(bucket, eligible);
    }
  });

  const ranked = eligibleRows
    .map((row) => ({ row, sourceIndex: row.sourceIndex }))
    .sort(
      (left, right) =>
        right.row.regenEnergyWh - left.row.regenEnergyWh ||
        left.sourceIndex - right.sourceIndex,
    );
  const rankedDrives = ranked
    .slice(0, REGEN_RANKED_DRIVE_LIMIT)
    .map(({ row }, index): RankedRegenDrive => ({
      rank: index + 1,
      driveId: row.drive.id,
      startTs: row.date.startTs,
      regenEnergyWh: row.regenEnergyWh,
      driveEnergyWh: row.driveEnergyWh,
      recoveryRatioPct: row.ratioPct,
      distanceM: validNonNegative(row.drive.distanceM),
      durationS: validNonNegative(row.drive.durationS),
      avgSpeedMps: validNonNegative(row.drive.avgSpeedMps),
      startSocPct: validSoc(row.drive.startBatteryPct),
      outsideTempAvgC: isFiniteNumber(row.drive.outsideTempAvgC)
        ? row.drive.outsideTempAvgC
        : null,
    }));

  const totalMonthCount = months.length;
  const displayMonths = months.slice(-REGEN_MONTH_DISPLAY_LIMIT);
  const accounting: RegenCoverageAccounting = {
    observedCount: drives.length,
    eligibleCount: eligibleRows.length,
    excludedCount: drives.length - eligibleRows.length,
    historyLimit: normalizedHistoryLimit,
    historyCapReached: drives.length >= normalizedHistoryLimit,
    missingFields,
    invalidFields,
  };

  return {
    timeZone: resolvedTimeZone,
    accounting,
    totalMeasuredRegenWh,
    totalMeasuredDriveEnergyWh,
    energyWeightedRatioPct: weightedRatio(
      totalMeasuredRegenWh,
      totalMeasuredDriveEnergyWh,
      eligibleRows.length,
    ),
    ratioStatistics: {
      medianPct: percentile(sortedRatios, 0.5),
      q1Pct: percentile(sortedRatios, 0.25),
      q3Pct: percentile(sortedRatios, 0.75),
      minPct: sortedRatios[0] ?? null,
      maxPct: sortedRatios[sortedRatios.length - 1] ?? null,
    },
    months,
    displayMonths,
    totalMonthCount,
    displayMonthLimit: REGEN_MONTH_DISPLAY_LIMIT,
    monthsTruncated: totalMonthCount > REGEN_MONTH_DISPLAY_LIMIT,
    ratioDistribution,
    temperatureBuckets: finalizeContextBuckets(temperatureMap),
    startingSocBuckets: finalizeContextBuckets(socMap),
    rankedDrives,
    rankedDriveTotal: ranked.length,
    rankedDriveLimit: REGEN_RANKED_DRIVE_LIMIT,
  };
}
