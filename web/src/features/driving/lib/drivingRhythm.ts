/**
 * Driving Rhythm model — deterministic departure evidence for one API window.
 *
 * Drive timestamps are UTC instants. Calendar fields are derived in one
 * explicit IANA timezone (the page supplies the viewer-local zone), so every
 * weekday, hour, day, and month rollup shares the same wall-clock semantics.
 * Distance remains SI meters; conversion is a render-boundary concern.
 */

import type { Drive } from '@/types/driving';

export const DEFAULT_MIN_PREDICTABILITY_DRIVES = 5;
export const DEFAULT_MIN_CONSISTENCY_DRIVES = 3;
export const DEFAULT_MIN_SLOT_DRIVES = 3;
export const DEFAULT_TOP_SLOT_LIMIT = 6;

const MINUTES_PER_DAY = 24 * 60;

/** Counts indexed by JS weekday (`0 = Sunday`) and local hour. */
export type RhythmMatrix = number[][];
export type RhythmTimeBandKey =
  | 'overnight'
  | 'morning'
  | 'afternoon'
  | 'evening';
export type RhythmDayType = 'weekday' | 'weekend';

export interface RhythmSlot {
  /** JS day-of-week, `0 = Sunday`. */
  day: number;
  hour: number;
  count: number;
}

export interface RankedRhythmSlot extends RhythmSlot {
  rank: number;
  share: number;
  distanceM: number;
  measuredDistanceDrives: number;
  qualified: boolean;
}

export interface HourlyRhythm {
  hour: number;
  drives: number;
  share: number;
  distanceM: number;
  measuredDistanceDrives: number;
}

export interface TimeBandRhythm {
  key: RhythmTimeBandKey;
  startHour: number;
  endHourExclusive: number;
  drives: number;
  share: number;
  distanceM: number;
}

export interface DayTypeRhythm {
  key: RhythmDayType;
  drives: number;
  share: number;
  activeDays: number;
  /** Number of this day type in the selected calendar range, when valid. */
  calendarDays: number | null;
  drivesPerCalendarDay: number | null;
  distanceM: number;
  measuredDistanceDrives: number;
  averageDistanceM: number | null;
}

export interface DayDepartureProfile {
  /** JS day-of-week, `0 = Sunday`. */
  day: number;
  drives: number;
  /** Circular median local minute after midnight. */
  medianDepartureMinute: number | null;
  /**
   * Median circular absolute deviation from the circular median, in SI
   * seconds. Null until the configured per-day sample floor is met.
   */
  consistencyDeviationS: number | null;
  consistencySupported: boolean;
}

export interface MonthlyRhythm {
  /** Local calendar month, `YYYY-MM`. */
  month: string;
  drives: number;
  activeDays: number;
  activeSlots: number;
  distanceM: number;
  measuredDistanceDrives: number;
  predictability: number | null;
}

export interface DrivingRhythmOptions {
  /** Frozen analysis clock. Valid timestamps after it are counted as future. */
  nowMs?: number;
  /** IANA timezone used for every calendar rollup. Defaults to browser-local. */
  timeZone?: string;
  /** Selected `YYYY-MM-DD` calendar bounds, used for per-day normalization. */
  rangeStart?: string;
  rangeEnd?: string;
  /** Requested API row cap, used only to flag potentially truncated coverage. */
  windowLimit?: number;
  minPredictabilityDrives?: number;
  minConsistencyDrives?: number;
  minSlotDrives?: number;
  topSlotLimit?: number;
}

export interface DrivingRhythm {
  matrix: RhythmMatrix;
  /** Rows with valid, non-future starts included in all rhythm aggregates. */
  total: number;
  /** Raw rows returned by the API before timestamp eligibility checks. */
  observed: number;
  excluded: number;
  invalidTimestampCount: number;
  futureTimestampCount: number;
  distanceMeasuredDrives: number;
  invalidDistanceCount: number;
  totalDistanceM: number;
  maxCount: number;
  favorite: RhythmSlot | null;
  weekdayCount: number;
  weekendCount: number;
  activeSlotCount: number;
  /**
   * 0–100 concentration of valid departures across local hours. Null below
   * the configured sample floor. `100` means one hour; `0` means all 24 hours
   * are represented uniformly.
   */
  predictability: number | null;
  /** Compatibility digest: circular median departure as a fractional hour. */
  medianDepartureByDay: (number | null)[];
  hourly: HourlyRhythm[];
  timeBands: TimeBandRhythm[];
  dayTypes: Record<RhythmDayType, DayTypeRhythm>;
  dayProfiles: DayDepartureProfile[];
  monthly: MonthlyRhythm[];
  strongestSlots: RankedRhythmSlot[];
  firstStartTs: string | null;
  lastStartTs: string | null;
  selectedCalendarDays: number | null;
  timeZone: string;
  timeZoneFallback: boolean;
  analysisNowMs: number;
  windowLimit: number | null;
  historyCapReached: boolean;
  minPredictabilityDrives: number;
  minConsistencyDrives: number;
  minSlotDrives: number;
}

interface CalendarParts {
  day: number;
  dayKey: string;
  monthKey: string;
  hour: number;
  minuteOfDay: number;
}

interface RhythmObservation extends CalendarParts {
  driveId: number;
  startTs: string;
  startMs: number;
  distanceM: number;
  hasMeasuredDistance: boolean;
}

interface MutableAggregate {
  drives: number;
  distanceM: number;
  measuredDistanceDrives: number;
}

interface MutableMonth extends MutableAggregate {
  days: Set<string>;
  slots: Set<string>;
  hourCounts: number[];
}

const TIME_BANDS: readonly Pick<
  TimeBandRhythm,
  'key' | 'startHour' | 'endHourExclusive'
>[] = [
  { key: 'overnight', startHour: 0, endHourExclusive: 6 },
  { key: 'morning', startHour: 6, endHourExclusive: 12 },
  { key: 'afternoon', startHour: 12, endHourExclusive: 18 },
  { key: 'evening', startHour: 18, endHourExclusive: 24 },
];

function emptyMatrix(): RhythmMatrix {
  return Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0),
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return Math.max(1, Math.floor(value));
}

function median(sortedAsc: readonly number[]): number {
  const middle = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 === 1
    ? sortedAsc[middle]!
    : (sortedAsc[middle - 1]! + sortedAsc[middle]!) / 2;
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function resolveTimeZone(requested?: string): {
  timeZone: string;
  fallback: boolean;
} {
  const candidate = requested?.trim() || browserTimeZone();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return { timeZone: candidate, fallback: false };
  } catch {
    return { timeZone: 'UTC', fallback: true };
  }
}

function calendarFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function calendarParts(
  formatter: Intl.DateTimeFormat,
  timestampMs: number,
): CalendarParts | null {
  const parts = formatter.formatToParts(new Date(timestampMs));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = Number(value('year'));
  const month = Number(value('month'));
  const date = Number(value('day'));
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(date) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    month < 1 ||
    month > 12 ||
    date < 1 ||
    date > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const monthPart = String(month).padStart(2, '0');
  const datePart = String(date).padStart(2, '0');
  return {
    day: new Date(Date.UTC(year, month - 1, date)).getUTCDay(),
    dayKey: `${year}-${monthPart}-${datePart}`,
    monthKey: `${year}-${monthPart}`,
    hour,
    minuteOfDay: hour * 60 + minute,
  };
}

function validDistance(drive: Drive): number | null {
  return Number.isFinite(drive.distanceM) && drive.distanceM >= 0
    ? drive.distanceM
    : null;
}

function predictabilityScore(
  hourCounts: readonly number[],
  total: number,
  minimum: number,
): number | null {
  if (total < minimum) return null;
  let entropy = 0;
  for (const count of hourCounts) {
    if (count === 0) continue;
    const probability = count / total;
    entropy -= probability * Math.log(probability);
  }
  return Math.min(
    100,
    Math.max(0, Math.round((1 - entropy / Math.log(24)) * 100)),
  );
}

function circularDistanceMinutes(left: number, right: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, MINUTES_PER_DAY - direct);
}

function circularMedianMinute(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const candidates = [...new Set(values)].sort((left, right) => left - right);
  let winner = candidates[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const totalDistance = values.reduce(
      (sum, value) => sum + circularDistanceMinutes(candidate, value),
      0,
    );
    if (totalDistance < bestDistance) {
      winner = candidate;
      bestDistance = totalDistance;
    }
  }
  return winner;
}

function dayOrder(day: number): number {
  return (day + 6) % 7;
}

function parseDateKey(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? timestamp
    : null;
}

function selectedDayCoverage(
  start: string | undefined,
  end: string | undefined,
): {
  total: number | null;
  weekday: number | null;
  weekend: number | null;
} {
  const startMs = parseDateKey(start);
  const endMs = parseDateKey(end);
  if (startMs == null || endMs == null || startMs > endMs) {
    return { total: null, weekday: null, weekend: null };
  }
  const total = Math.floor((endMs - startMs) / 86_400_000) + 1;
  const fullWeeks = Math.floor(total / 7);
  let weekday = fullWeeks * 5;
  let weekend = fullWeeks * 2;
  const remainder = total % 7;
  const firstDay = new Date(startMs).getUTCDay();
  for (let offset = 0; offset < remainder; offset += 1) {
    const day = (firstDay + offset) % 7;
    if (day === 0 || day === 6) weekend += 1;
    else weekday += 1;
  }
  return { total: weekday + weekend, weekday, weekend };
}

function makeDayType(
  key: RhythmDayType,
  aggregate: MutableAggregate,
  activeDays: number,
  calendarDays: number | null,
  total: number,
): DayTypeRhythm {
  return {
    key,
    drives: aggregate.drives,
    share: total > 0 ? aggregate.drives / total : 0,
    activeDays,
    calendarDays,
    drivesPerCalendarDay:
      calendarDays != null && calendarDays > 0
        ? aggregate.drives / calendarDays
        : null,
    distanceM: aggregate.distanceM,
    measuredDistanceDrives: aggregate.measuredDistanceDrives,
    averageDistanceM:
      aggregate.measuredDistanceDrives > 0
        ? aggregate.distanceM / aggregate.measuredDistanceDrives
        : null,
  };
}

export function buildDrivingRhythm(
  drives: readonly Drive[],
  options: DrivingRhythmOptions = {},
): DrivingRhythm {
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError('nowMs must be a finite number');
  }
  const minPredictabilityDrives = positiveInteger(
    options.minPredictabilityDrives ??
      DEFAULT_MIN_PREDICTABILITY_DRIVES,
    'minPredictabilityDrives',
  );
  const minConsistencyDrives = positiveInteger(
    options.minConsistencyDrives ?? DEFAULT_MIN_CONSISTENCY_DRIVES,
    'minConsistencyDrives',
  );
  const minSlotDrives = positiveInteger(
    options.minSlotDrives ?? DEFAULT_MIN_SLOT_DRIVES,
    'minSlotDrives',
  );
  const topSlotLimit = positiveInteger(
    options.topSlotLimit ?? DEFAULT_TOP_SLOT_LIMIT,
    'topSlotLimit',
  );
  const windowLimit =
    options.windowLimit == null
      ? null
      : positiveInteger(options.windowLimit, 'windowLimit');
  const zone = resolveTimeZone(options.timeZone);
  const formatter = calendarFormatter(zone.timeZone);

  let invalidTimestampCount = 0;
  let futureTimestampCount = 0;
  let invalidDistanceCount = 0;
  const observations: RhythmObservation[] = [];

  for (const drive of drives) {
    if (typeof drive.startTs !== 'string' || drive.startTs.trim() === '') {
      invalidTimestampCount += 1;
      continue;
    }
    const startMs = Date.parse(drive.startTs);
    if (!Number.isFinite(startMs)) {
      invalidTimestampCount += 1;
      continue;
    }
    if (startMs > nowMs) {
      futureTimestampCount += 1;
      continue;
    }
    const calendar = calendarParts(formatter, startMs);
    if (!calendar) {
      invalidTimestampCount += 1;
      continue;
    }
    const distanceM = validDistance(drive);
    if (distanceM == null) invalidDistanceCount += 1;
    observations.push({
      ...calendar,
      driveId: drive.id,
      startTs: drive.startTs,
      startMs,
      distanceM: distanceM ?? 0,
      hasMeasuredDistance: distanceM != null,
    });
  }

  observations.sort(
    (left, right) =>
      left.startMs - right.startMs || left.driveId - right.driveId,
  );

  const matrix = emptyMatrix();
  const distanceMatrix = emptyMatrix();
  const measuredDistanceMatrix = emptyMatrix();
  const hourCounts = Array.from({ length: 24 }, () => 0);
  const hourDistances = Array.from({ length: 24 }, () => 0);
  const hourMeasuredDistances = Array.from({ length: 24 }, () => 0);
  const departureMinutesByDay: number[][] = Array.from(
    { length: 7 },
    () => [],
  );
  const activeDays: Record<RhythmDayType, Set<string>> = {
    weekday: new Set<string>(),
    weekend: new Set<string>(),
  };
  const dayTypeAggregates: Record<RhythmDayType, MutableAggregate> = {
    weekday: { drives: 0, distanceM: 0, measuredDistanceDrives: 0 },
    weekend: { drives: 0, distanceM: 0, measuredDistanceDrives: 0 },
  };
  const months = new Map<string, MutableMonth>();

  for (const observation of observations) {
    const {
      day,
      hour,
      distanceM,
      hasMeasuredDistance,
      dayKey,
      monthKey,
    } = observation;
    matrix[day]![hour]! += 1;
    distanceMatrix[day]![hour]! += distanceM;
    hourCounts[hour]! += 1;
    hourDistances[hour]! += distanceM;
    departureMinutesByDay[day]!.push(observation.minuteOfDay);
    if (hasMeasuredDistance) {
      measuredDistanceMatrix[day]![hour]! += 1;
      hourMeasuredDistances[hour]! += 1;
    }

    const dayType: RhythmDayType =
      day === 0 || day === 6 ? 'weekend' : 'weekday';
    const dayAggregate = dayTypeAggregates[dayType];
    dayAggregate.drives += 1;
    dayAggregate.distanceM += distanceM;
    if (hasMeasuredDistance) dayAggregate.measuredDistanceDrives += 1;
    activeDays[dayType].add(dayKey);

    const month = months.get(monthKey) ?? {
      drives: 0,
      distanceM: 0,
      measuredDistanceDrives: 0,
      days: new Set<string>(),
      slots: new Set<string>(),
      hourCounts: Array.from({ length: 24 }, () => 0),
    };
    month.drives += 1;
    month.distanceM += distanceM;
    if (hasMeasuredDistance) month.measuredDistanceDrives += 1;
    month.days.add(dayKey);
    month.slots.add(`${day}:${hour}`);
    month.hourCounts[hour]! += 1;
    months.set(monthKey, month);
  }

  const total = observations.length;
  const allSlots: RankedRhythmSlot[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const count = matrix[day]![hour]!;
      if (count === 0) continue;
      allSlots.push({
        day,
        hour,
        count,
        rank: 0,
        share: total > 0 ? count / total : 0,
        distanceM: distanceMatrix[day]![hour]!,
        measuredDistanceDrives: measuredDistanceMatrix[day]![hour]!,
        qualified: count >= minSlotDrives,
      });
    }
  }
  allSlots.sort(
    (left, right) =>
      right.count - left.count ||
      dayOrder(left.day) - dayOrder(right.day) ||
      left.hour - right.hour,
  );
  allSlots.forEach((slot, index) => {
    slot.rank = index + 1;
  });

  const dayProfiles: DayDepartureProfile[] = departureMinutesByDay.map(
    (values, day) => {
      const medianDepartureMinute = circularMedianMinute(values);
      const supported = values.length >= minConsistencyDrives;
      const deviations =
        medianDepartureMinute == null
          ? []
          : values
              .map((value) =>
                circularDistanceMinutes(value, medianDepartureMinute),
              )
              .sort((left, right) => left - right);
      return {
        day,
        drives: values.length,
        medianDepartureMinute,
        consistencyDeviationS:
          supported && deviations.length > 0
            ? median(deviations) * 60
            : null,
        consistencySupported: supported,
      };
    },
  );

  const hourly: HourlyRhythm[] = hourCounts.map((count, hour) => ({
    hour,
    drives: count,
    share: total > 0 ? count / total : 0,
    distanceM: hourDistances[hour]!,
    measuredDistanceDrives: hourMeasuredDistances[hour]!,
  }));
  const timeBands: TimeBandRhythm[] = TIME_BANDS.map((band) => {
    const rows = hourly.slice(band.startHour, band.endHourExclusive);
    const count = rows.reduce((sum, row) => sum + row.drives, 0);
    return {
      ...band,
      drives: count,
      share: total > 0 ? count / total : 0,
      distanceM: rows.reduce((sum, row) => sum + row.distanceM, 0),
    };
  });

  const coverage = selectedDayCoverage(
    options.rangeStart,
    options.rangeEnd,
  );
  const dayTypes: Record<RhythmDayType, DayTypeRhythm> = {
    weekday: makeDayType(
      'weekday',
      dayTypeAggregates.weekday,
      activeDays.weekday.size,
      coverage.weekday,
      total,
    ),
    weekend: makeDayType(
      'weekend',
      dayTypeAggregates.weekend,
      activeDays.weekend.size,
      coverage.weekend,
      total,
    ),
  };

  const monthly: MonthlyRhythm[] = [...months.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, aggregate]) => ({
      month,
      drives: aggregate.drives,
      activeDays: aggregate.days.size,
      activeSlots: aggregate.slots.size,
      distanceM: aggregate.distanceM,
      measuredDistanceDrives: aggregate.measuredDistanceDrives,
      predictability: predictabilityScore(
        aggregate.hourCounts,
        aggregate.drives,
        minPredictabilityDrives,
      ),
    }));

  const favoriteSlot = allSlots[0];
  const weekdayCount = dayTypes.weekday.drives;
  const weekendCount = dayTypes.weekend.drives;
  const totalDistanceM = observations.reduce(
    (sum, observation) => sum + observation.distanceM,
    0,
  );
  const distanceMeasuredDrives = observations.reduce(
    (sum, observation) => sum + (observation.hasMeasuredDistance ? 1 : 0),
    0,
  );

  return {
    matrix,
    total,
    observed: drives.length,
    excluded: invalidTimestampCount + futureTimestampCount,
    invalidTimestampCount,
    futureTimestampCount,
    distanceMeasuredDrives,
    invalidDistanceCount,
    totalDistanceM,
    maxCount: favoriteSlot?.count ?? 0,
    favorite: favoriteSlot
      ? {
          day: favoriteSlot.day,
          hour: favoriteSlot.hour,
          count: favoriteSlot.count,
        }
      : null,
    weekdayCount,
    weekendCount,
    activeSlotCount: allSlots.length,
    predictability: predictabilityScore(
      hourCounts,
      total,
      minPredictabilityDrives,
    ),
    medianDepartureByDay: dayProfiles.map((profile) =>
      profile.medianDepartureMinute != null
        ? profile.medianDepartureMinute / 60
        : null,
    ),
    hourly,
    timeBands,
    dayTypes,
    dayProfiles,
    monthly,
    strongestSlots: allSlots.slice(0, topSlotLimit),
    firstStartTs: observations[0]?.startTs ?? null,
    lastStartTs: observations[observations.length - 1]?.startTs ?? null,
    selectedCalendarDays: coverage.total,
    timeZone: zone.timeZone,
    timeZoneFallback: zone.fallback,
    analysisNowMs: nowMs,
    windowLimit,
    historyCapReached: windowLimit != null && drives.length >= windowLimit,
    minPredictabilityDrives,
    minConsistencyDrives,
    minSlotDrives,
  };
}

/** Format a local minute-of-day (`0..1439`) as a 24-hour wall-clock label. */
export function formatMinuteOfDay(minute: number | null | undefined): string {
  if (minute == null || !Number.isFinite(minute)) return '—';
  const rounded = Math.round(minute);
  const normalized =
    ((rounded % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = String(Math.floor(normalized / 60)).padStart(2, '0');
  const minutes = String(normalized % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Format a fractional wall-clock hour (`8.25`) as a 24-hour label (`08:15`). */
export function formatFractionalHour(hour: number): string {
  return formatMinuteOfDay(hour * 60);
}
