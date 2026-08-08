/**
 * Pure utilization analytics derived from the ranged drive-history response.
 *
 * Calendar scope and rollups use UTC because the drives endpoint applies its
 * `start` and `end` calendar-date filters to UTC `started_at` values. The
 * selected end date is inclusive at the UI/API boundary and becomes an
 * exclusive next-midnight boundary in this model.
 */

import type { Drive } from '@/types/driving';

export const UTILIZATION_DRIVE_LIMIT = 1000;

const DAY_MS = 86_400_000;
const DAY_S = 86_400;
const HOUR_S = 3_600;
const MAX_RANKED_DAYS = 5;

export type DurationBandKey =
  | 'under15m'
  | '15to30m'
  | '30to60m'
  | '1to2h'
  | 'over2h';

export type DistanceBandKey =
  | 'under5km'
  | '5to15km'
  | '15to50km'
  | '50to100km'
  | 'over100km';

export interface UtilizationBand<Key extends string> {
  key: Key;
  minInclusive: number;
  maxExclusive: number | null;
  driveCount: number;
  share: number;
}

export interface UtilizationDay {
  day: string;
  dayStartMs: number;
  observedS: number;
  driveCount: number;
  drivingS: number;
  distanceM: number;
  energyWh: number;
  active: boolean;
}

export interface UtilizationMonth {
  month: string;
  monthStartMs: number;
  observedDays: number;
  activeDays: number;
  driveCount: number;
  drivingS: number;
  drivingShare: number | null;
  distanceM: number;
  energyWh: number;
}

export interface UtilizationWeek {
  weekStart: string;
  weekStartMs: number;
  /** Exact observed duration represented as 24-hour days. */
  observedDays: number;
  observedCalendarDays: number;
  activeDays: number;
  activeDayShare: number;
  driveCount: number;
  drivingS: number;
  distanceM: number;
  isPartial: boolean;
}

export interface WeekdayUtilization {
  /** UTC weekday index: 0 = Sunday, 6 = Saturday. */
  weekday: number;
  observedDays: number;
  activeDays: number;
  activeDayShare: number | null;
  driveCount: number;
  drivingS: number;
  distanceM: number;
  averageDistancePerActiveDayM: number | null;
}

export interface UtilizationSampleGuard {
  sampleSize: number;
  minimum: number;
  sufficient: boolean;
}

export interface UtilizationSampleGuards {
  monthlyTrend: UtilizationSampleGuard;
  weekdayProfile: UtilizationSampleGuard;
  durationDistribution: UtilizationSampleGuard;
  distanceDistribution: UtilizationSampleGuard;
  activeDayConsistency: UtilizationSampleGuard;
  busiestDays: UtilizationSampleGuard;
  energyCost: UtilizationSampleGuard;
}

export interface UtilizationAccounting {
  returnedRows: number;
  eligibleRows: number;
  excludedRows: number;
  invalidRangeRows: number;
  invalidTimestampRows: number;
  futureTimestampRows: number;
  beforeRangeRows: number;
  afterRangeRows: number;
  usableDurationRows: number;
  excludedDurationRows: number;
  truncatedDurationRows: number;
  usableDistanceRows: number;
  excludedDistanceRows: number;
  usableEnergyRows: number;
  excludedEnergyRows: number;
  historyCapReached: boolean;
}

export interface UtilizationWindow {
  rangeStart: string;
  rangeEnd: string;
  rangeValid: boolean;
  asOfValid: boolean;
  asOfMs: number;
  selectedStartMs: number | null;
  selectedEndExclusiveMs: number | null;
  analysisEndMs: number | null;
  observedStartMs: number | null;
  observedEndMs: number | null;
  observedDurationS: number;
  observedCalendarDays: number;
}

export interface ActiveDayConsistency {
  weeks: UtilizationWeek[];
  activeDays: number;
  inactiveObservedDays: number;
  weeksWithActivity: number;
  longestActiveStreakDays: number;
}

export interface UtilizationSummary {
  window: UtilizationWindow;
  accounting: UtilizationAccounting;
  sampleGuards: UtilizationSampleGuards;
  days: UtilizationDay[];
  months: UtilizationMonth[];
  weekdays: WeekdayUtilization[];
  durationBands: Array<UtilizationBand<DurationBandKey>>;
  distanceBands: Array<UtilizationBand<DistanceBandKey>>;
  busiestDays: UtilizationDay[];
  consistency: ActiveDayConsistency;
  /** Exact first eligible drive → analysis-boundary duration in days. */
  observedDays: number | null;
  observedCalendarDays: number;
  drivingHours: number;
  /** Logged driving duration ÷ exact observed duration, 0–1. */
  drivingShare: number | null;
  distanceM: number;
  energyWh: number;
  /** Average SI distance per observed UTC calendar day. */
  distancePerDayM: number | null;
  /** Active UTC calendar days ÷ observed UTC calendar days. */
  activeDayShare: number | null;
  /** Energy-priced distance among rows that also have usable energy. */
  pricedDistanceM: number;
  /** Energy-priced duration among rows that also have usable energy. */
  pricedDrivingS: number;
  energyCoverageShare: number | null;
  ratePerKwh: number | null;
  /** Major currency units per canonical kilometre. */
  costPerKm: number | null;
  /** Major currency units per matched logged driving hour. */
  costPerDrivingHour: number | null;
  /** Energy-only cost for rows with usable energy. */
  totalEnergyCost: number | null;
  drives: number;
}

export interface UtilizationOptions {
  rangeStart: string;
  rangeEnd: string;
  asOfMs: number;
  historyLimit?: number;
}

interface NormalizedDrive {
  drive: Drive;
  startMs: number;
  durationS: number | null;
  distanceM: number | null;
  energyWh: number | null;
}

interface MutableDay {
  day: string;
  dayStartMs: number;
  observedS: number;
  driveCount: number;
  drivingS: number;
  distanceM: number;
  energyWh: number;
}

interface DateRange {
  startMs: number;
  endExclusiveMs: number;
}

const DURATION_BANDS: ReadonlyArray<{
  key: DurationBandKey;
  minInclusive: number;
  maxExclusive: number | null;
}> = [
  { key: 'under15m', minInclusive: 0, maxExclusive: 15 * 60 },
  { key: '15to30m', minInclusive: 15 * 60, maxExclusive: 30 * 60 },
  { key: '30to60m', minInclusive: 30 * 60, maxExclusive: 60 * 60 },
  { key: '1to2h', minInclusive: 60 * 60, maxExclusive: 2 * HOUR_S },
  { key: 'over2h', minInclusive: 2 * HOUR_S, maxExclusive: null },
];

const DISTANCE_BANDS: ReadonlyArray<{
  key: DistanceBandKey;
  minInclusive: number;
  maxExclusive: number | null;
}> = [
  { key: 'under5km', minInclusive: 0, maxExclusive: 5_000 },
  { key: '5to15km', minInclusive: 5_000, maxExclusive: 15_000 },
  { key: '15to50km', minInclusive: 15_000, maxExclusive: 50_000 },
  { key: '50to100km', minInclusive: 50_000, maxExclusive: 100_000 },
  { key: 'over100km', minInclusive: 100_000, maxExclusive: null },
];

function parseUtcCalendarDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const parsed = new Date(ms);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

function parseRange(start: string, end: string): DateRange | null {
  const startMs = parseUtcCalendarDate(start);
  const endMs = parseUtcCalendarDate(end);
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return { startMs, endExclusiveMs: endMs + DAY_MS };
}

function utcDayStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

function dayKey(dayStartMs: number): string {
  return new Date(dayStartMs).toISOString().slice(0, 10);
}

function monthKey(dayStartMs: number): string {
  return new Date(dayStartMs).toISOString().slice(0, 7);
}

function mondayStart(dayStartMs: number): number {
  const weekday = new Date(dayStartMs).getUTCDay();
  return dayStartMs - ((weekday + 6) % 7) * DAY_MS;
}

function positiveFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function buildGuard(sampleSize: number, minimum: number): UtilizationSampleGuard {
  return { sampleSize, minimum, sufficient: sampleSize >= minimum };
}

function buildBands<Key extends string>(
  definitions: ReadonlyArray<{
    key: Key;
    minInclusive: number;
    maxExclusive: number | null;
  }>,
  values: readonly number[],
): Array<UtilizationBand<Key>> {
  return definitions.map((definition) => {
    const driveCount = values.filter(
      (value) =>
        value >= definition.minInclusive &&
        (definition.maxExclusive == null ||
          value < definition.maxExclusive),
    ).length;
    return {
      ...definition,
      driveCount,
      share: values.length > 0 ? driveCount / values.length : 0,
    };
  });
}

function emptySummary(
  drives: readonly Drive[],
  costPerKwh: number | null,
  options: UtilizationOptions,
  range: DateRange | null,
  asOfMs: number,
  asOfValid: boolean,
): UtilizationSummary {
  const historyLimit = options.historyLimit ?? UTILIZATION_DRIVE_LIMIT;
  const invalidRangeRows = range == null ? drives.length : 0;
  const accounting: UtilizationAccounting = {
    returnedRows: drives.length,
    eligibleRows: 0,
    excludedRows: invalidRangeRows,
    invalidRangeRows,
    invalidTimestampRows: 0,
    futureTimestampRows: 0,
    beforeRangeRows: 0,
    afterRangeRows: 0,
    usableDurationRows: 0,
    excludedDurationRows: 0,
    truncatedDurationRows: 0,
    usableDistanceRows: 0,
    excludedDistanceRows: 0,
    usableEnergyRows: 0,
    excludedEnergyRows: 0,
    historyCapReached: drives.length >= historyLimit,
  };
  const ratePerKwh =
    costPerKwh != null &&
    Number.isFinite(costPerKwh) &&
    costPerKwh >= 0
      ? costPerKwh
      : null;

  return {
    window: {
      rangeStart: options.rangeStart,
      rangeEnd: options.rangeEnd,
      rangeValid: range != null,
      asOfValid,
      asOfMs,
      selectedStartMs: range?.startMs ?? null,
      selectedEndExclusiveMs: range?.endExclusiveMs ?? null,
      analysisEndMs:
        range != null ? Math.min(range.endExclusiveMs, asOfMs) : null,
      observedStartMs: null,
      observedEndMs: null,
      observedDurationS: 0,
      observedCalendarDays: 0,
    },
    accounting,
    sampleGuards: {
      monthlyTrend: buildGuard(0, 2),
      weekdayProfile: buildGuard(0, 7),
      durationDistribution: buildGuard(0, 5),
      distanceDistribution: buildGuard(0, 5),
      activeDayConsistency: buildGuard(0, 14),
      busiestDays: buildGuard(0, 3),
      energyCost: buildGuard(0, 1),
    },
    days: [],
    months: [],
    weekdays: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      observedDays: 0,
      activeDays: 0,
      activeDayShare: null,
      driveCount: 0,
      drivingS: 0,
      distanceM: 0,
      averageDistancePerActiveDayM: null,
    })),
    durationBands: buildBands(DURATION_BANDS, []),
    distanceBands: buildBands(DISTANCE_BANDS, []),
    busiestDays: [],
    consistency: {
      weeks: [],
      activeDays: 0,
      inactiveObservedDays: 0,
      weeksWithActivity: 0,
      longestActiveStreakDays: 0,
    },
    observedDays: null,
    observedCalendarDays: 0,
    drivingHours: 0,
    drivingShare: null,
    distanceM: 0,
    energyWh: 0,
    distancePerDayM: null,
    activeDayShare: null,
    pricedDistanceM: 0,
    pricedDrivingS: 0,
    energyCoverageShare: null,
    ratePerKwh,
    costPerKm: null,
    costPerDrivingHour: null,
    totalEnergyCost: null,
    drives: 0,
  };
}

export function summarizeUtilization(
  drives: readonly Drive[],
  costPerKwh: number | null,
  options: UtilizationOptions,
): UtilizationSummary {
  const range = parseRange(options.rangeStart, options.rangeEnd);
  const asOfValid = Number.isFinite(options.asOfMs);
  const asOfMs = asOfValid ? options.asOfMs : 0;
  if (range == null) {
    return emptySummary(
      drives,
      costPerKwh,
      options,
      range,
      asOfMs,
      asOfValid,
    );
  }

  const historyLimit = options.historyLimit ?? UTILIZATION_DRIVE_LIMIT;
  const analysisEndMs = Math.min(range.endExclusiveMs, asOfMs);
  let invalidTimestampRows = 0;
  let futureTimestampRows = 0;
  let beforeRangeRows = 0;
  let afterRangeRows = 0;
  const eligible: NormalizedDrive[] = [];

  for (const drive of drives) {
    const startMs = drive.startTs ? Date.parse(drive.startTs) : Number.NaN;
    if (!Number.isFinite(startMs)) {
      invalidTimestampRows += 1;
      continue;
    }
    if (startMs >= asOfMs) {
      futureTimestampRows += 1;
      continue;
    }
    if (startMs < range.startMs) {
      beforeRangeRows += 1;
      continue;
    }
    if (startMs >= range.endExclusiveMs) {
      afterRangeRows += 1;
      continue;
    }
    eligible.push({
      drive,
      startMs,
      durationS: positiveFinite(drive.durationS),
      distanceM: positiveFinite(drive.distanceM),
      energyWh: positiveFinite(drive.energyUsedWh),
    });
  }

  eligible.sort(
    (left, right) =>
      left.startMs - right.startMs || left.drive.id - right.drive.id,
  );

  if (eligible.length === 0 || analysisEndMs <= eligible[0]!.startMs) {
    const summary = emptySummary(
      drives,
      costPerKwh,
      options,
      range,
      asOfMs,
      asOfValid,
    );
    const excludedRows =
      invalidTimestampRows +
      futureTimestampRows +
      beforeRangeRows +
      afterRangeRows;
    summary.accounting = {
      ...summary.accounting,
      excludedRows,
      invalidTimestampRows,
      futureTimestampRows,
      beforeRangeRows,
      afterRangeRows,
    };
    summary.window.analysisEndMs = analysisEndMs;
    return summary;
  }

  const observedStartMs = eligible[0]!.startMs;
  const observedDurationS = (analysisEndMs - observedStartMs) / 1000;
  const firstDayMs = utcDayStart(observedStartMs);
  const finalDayMs = utcDayStart(analysisEndMs - 1);
  const mutableDays = new Map<string, MutableDay>();

  for (
    let cursor = firstDayMs;
    cursor <= finalDayMs;
    cursor += DAY_MS
  ) {
    const key = dayKey(cursor);
    mutableDays.set(key, {
      day: key,
      dayStartMs: cursor,
      observedS:
        (Math.min(cursor + DAY_MS, analysisEndMs) -
          Math.max(cursor, observedStartMs)) /
        1000,
      driveCount: 0,
      drivingS: 0,
      distanceM: 0,
      energyWh: 0,
    });
  }

  let usableDurationRows = 0;
  let truncatedDurationRows = 0;
  let usableDistanceRows = 0;
  let usableEnergyRows = 0;
  let distanceM = 0;
  let energyWh = 0;
  let pricedDistanceM = 0;
  let pricedDrivingS = 0;
  let pricedDistanceEnergyWh = 0;
  let pricedDurationEnergyWh = 0;
  const durationValues: number[] = [];
  const distanceValues: number[] = [];

  for (const item of eligible) {
    const startDay = mutableDays.get(dayKey(utcDayStart(item.startMs)));
    if (startDay) {
      startDay.driveCount += 1;
    }

    let cappedEndMs = item.startMs;
    let truncated = false;
    if (item.durationS != null) {
      usableDurationRows += 1;
      const uncappedEndMs = item.startMs + item.durationS * 1000;
      cappedEndMs = Math.min(uncappedEndMs, analysisEndMs);
      truncated = cappedEndMs < uncappedEndMs;
      if (truncated) truncatedDurationRows += 1;
      else durationValues.push(item.durationS);
    }

    // A boundary-crossing drive has only partial time coverage. Its full-drive
    // distance and energy cannot be apportioned safely, so withhold those
    // fields and its duration-band sample while retaining clipped driving time.
    const measuredDistanceM = truncated ? null : item.distanceM;
    const measuredEnergyWh = truncated ? null : item.energyWh;

    if (startDay) {
      if (measuredDistanceM != null) {
        startDay.distanceM += measuredDistanceM;
      }
      if (measuredEnergyWh != null) {
        startDay.energyWh += measuredEnergyWh;
      }
    }

    if (measuredDistanceM != null) {
      usableDistanceRows += 1;
      distanceM += measuredDistanceM;
      distanceValues.push(measuredDistanceM);
    }
    if (measuredEnergyWh != null) {
      usableEnergyRows += 1;
      energyWh += measuredEnergyWh;
      if (measuredDistanceM != null) {
        pricedDistanceM += measuredDistanceM;
        pricedDistanceEnergyWh += measuredEnergyWh;
      }
    }

    if (item.durationS == null) continue;
    const cappedDurationS = Math.max(0, (cappedEndMs - item.startMs) / 1000);
    if (measuredEnergyWh != null) {
      pricedDrivingS += cappedDurationS;
      pricedDurationEnergyWh += measuredEnergyWh;
    }

    let cursor = item.startMs;
    while (cursor < cappedEndMs) {
      const cursorDayMs = utcDayStart(cursor);
      const segmentEndMs = Math.min(cursorDayMs + DAY_MS, cappedEndMs);
      const day = mutableDays.get(dayKey(cursorDayMs));
      if (day) day.drivingS += (segmentEndMs - cursor) / 1000;
      cursor = segmentEndMs;
    }
  }

  const days: UtilizationDay[] = Array.from(mutableDays.values()).map(
    (day) => ({
      ...day,
      drivingS: Math.min(day.drivingS, day.observedS),
      active: day.driveCount > 0,
    }),
  );
  const observedCalendarDays = days.length;
  const activeDays = days.filter((day) => day.active).length;
  const drivingS = Math.min(
    days.reduce((sum, day) => sum + day.drivingS, 0),
    observedDurationS,
  );

  const monthsByKey = new Map<string, UtilizationMonth>();
  const weeksByKey = new Map<string, UtilizationWeek>();
  const weekdayRows: WeekdayUtilization[] = Array.from(
    { length: 7 },
    (_, weekday) => ({
      weekday,
      observedDays: 0,
      activeDays: 0,
      activeDayShare: null,
      driveCount: 0,
      drivingS: 0,
      distanceM: 0,
      averageDistancePerActiveDayM: null,
    }),
  );

  for (const day of days) {
    const month = monthKey(day.dayStartMs);
    const monthRow = monthsByKey.get(month) ?? {
      month,
      monthStartMs: Date.UTC(
        new Date(day.dayStartMs).getUTCFullYear(),
        new Date(day.dayStartMs).getUTCMonth(),
        1,
      ),
      observedDays: 0,
      activeDays: 0,
      driveCount: 0,
      drivingS: 0,
      drivingShare: null,
      distanceM: 0,
      energyWh: 0,
    };
    monthRow.observedDays += day.observedS / DAY_S;
    monthRow.activeDays += day.active ? 1 : 0;
    monthRow.driveCount += day.driveCount;
    monthRow.drivingS += day.drivingS;
    monthRow.distanceM += day.distanceM;
    monthRow.energyWh += day.energyWh;
    monthsByKey.set(month, monthRow);

    const weekStartMs = mondayStart(day.dayStartMs);
    const weekStart = dayKey(weekStartMs);
    const weekRow = weeksByKey.get(weekStart) ?? {
      weekStart,
      weekStartMs,
      observedDays: 0,
      observedCalendarDays: 0,
      activeDays: 0,
      activeDayShare: 0,
      driveCount: 0,
      drivingS: 0,
      distanceM: 0,
      isPartial: false,
    };
    weekRow.observedDays += day.observedS / DAY_S;
    weekRow.observedCalendarDays += 1;
    weekRow.activeDays += day.active ? 1 : 0;
    weekRow.driveCount += day.driveCount;
    weekRow.drivingS += day.drivingS;
    weekRow.distanceM += day.distanceM;
    weeksByKey.set(weekStart, weekRow);

    const weekday = new Date(day.dayStartMs).getUTCDay();
    const weekdayRow = weekdayRows[weekday]!;
    weekdayRow.observedDays += 1;
    weekdayRow.activeDays += day.active ? 1 : 0;
    weekdayRow.driveCount += day.driveCount;
    weekdayRow.drivingS += day.drivingS;
    weekdayRow.distanceM += day.distanceM;
  }

  const months = Array.from(monthsByKey.values())
    .sort((left, right) => left.monthStartMs - right.monthStartMs)
    .map((month) => ({
      ...month,
      drivingShare:
        month.observedDays > 0
          ? Math.min(1, month.drivingS / (month.observedDays * DAY_S))
          : null,
    }));
  const weeks = Array.from(weeksByKey.values())
    .sort((left, right) => left.weekStartMs - right.weekStartMs)
    .map((week) => ({
      ...week,
      activeDayShare:
        week.observedCalendarDays > 0
          ? week.activeDays / week.observedCalendarDays
          : 0,
      isPartial: week.observedDays < 7,
    }));
  const weekdays = weekdayRows.map((weekday) => ({
    ...weekday,
    activeDayShare:
      weekday.observedDays > 0
        ? weekday.activeDays / weekday.observedDays
        : null,
    averageDistancePerActiveDayM:
      weekday.activeDays > 0
        ? weekday.distanceM / weekday.activeDays
        : null,
  }));

  let longestActiveStreakDays = 0;
  let activeStreak = 0;
  for (const day of days) {
    activeStreak = day.active ? activeStreak + 1 : 0;
    longestActiveStreakDays = Math.max(
      longestActiveStreakDays,
      activeStreak,
    );
  }

  const busiestDays = days
    .filter((day) => day.active)
    .sort(
      (left, right) =>
        right.drivingS - left.drivingS ||
        right.distanceM - left.distanceM ||
        right.driveCount - left.driveCount ||
        left.day.localeCompare(right.day),
    )
    .slice(0, MAX_RANKED_DAYS);

  const ratePerKwh =
    costPerKwh != null &&
    Number.isFinite(costPerKwh) &&
    costPerKwh >= 0
      ? costPerKwh
      : null;
  const totalEnergyCost =
    ratePerKwh != null && usableEnergyRows > 0
      ? (energyWh / 1000) * ratePerKwh
      : null;
  const costPerKm =
    ratePerKwh != null && pricedDistanceM > 0
      ? ((pricedDistanceEnergyWh / 1000) * ratePerKwh) /
        (pricedDistanceM / 1000)
      : null;
  const costPerDrivingHour =
    ratePerKwh != null && pricedDrivingS > 0
      ? ((pricedDurationEnergyWh / 1000) * ratePerKwh) /
        (pricedDrivingS / HOUR_S)
      : null;
  const excludedRows =
    invalidTimestampRows +
    futureTimestampRows +
    beforeRangeRows +
    afterRangeRows;
  const activeMonths = months.filter((month) => month.driveCount > 0).length;

  return {
    window: {
      rangeStart: options.rangeStart,
      rangeEnd: options.rangeEnd,
      rangeValid: true,
      asOfValid,
      asOfMs,
      selectedStartMs: range.startMs,
      selectedEndExclusiveMs: range.endExclusiveMs,
      analysisEndMs,
      observedStartMs,
      observedEndMs: analysisEndMs,
      observedDurationS,
      observedCalendarDays,
    },
    accounting: {
      returnedRows: drives.length,
      eligibleRows: eligible.length,
      excludedRows,
      invalidRangeRows: 0,
      invalidTimestampRows,
      futureTimestampRows,
      beforeRangeRows,
      afterRangeRows,
      usableDurationRows,
      excludedDurationRows: eligible.length - usableDurationRows,
      truncatedDurationRows,
      usableDistanceRows,
      excludedDistanceRows: eligible.length - usableDistanceRows,
      usableEnergyRows,
      excludedEnergyRows: eligible.length - usableEnergyRows,
      historyCapReached: drives.length >= historyLimit,
    },
    sampleGuards: {
      monthlyTrend: buildGuard(activeMonths, 2),
      weekdayProfile: buildGuard(eligible.length, 7),
      durationDistribution: buildGuard(durationValues.length, 5),
      distanceDistribution: buildGuard(distanceValues.length, 5),
      activeDayConsistency: buildGuard(observedCalendarDays, 14),
      busiestDays: buildGuard(activeDays, 3),
      energyCost: buildGuard(usableEnergyRows, 1),
    },
    days,
    months,
    weekdays,
    durationBands: buildBands(DURATION_BANDS, durationValues),
    distanceBands: buildBands(DISTANCE_BANDS, distanceValues),
    busiestDays,
    consistency: {
      weeks,
      activeDays,
      inactiveObservedDays: observedCalendarDays - activeDays,
      weeksWithActivity: weeks.filter((week) => week.activeDays > 0).length,
      longestActiveStreakDays,
    },
    observedDays: observedDurationS / DAY_S,
    observedCalendarDays,
    drivingHours: drivingS / HOUR_S,
    drivingShare:
      observedDurationS > 0
        ? Math.min(1, drivingS / observedDurationS)
        : null,
    distanceM,
    energyWh,
    distancePerDayM:
      observedCalendarDays > 0 ? distanceM / observedCalendarDays : null,
    activeDayShare:
      observedCalendarDays > 0 ? activeDays / observedCalendarDays : null,
    pricedDistanceM,
    pricedDrivingS,
    energyCoverageShare:
      eligible.length > 0 ? usableEnergyRows / eligible.length : null,
    ratePerKwh,
    costPerKm,
    costPerDrivingHour,
    totalEnergyCost,
    drives: eligible.length,
  };
}
