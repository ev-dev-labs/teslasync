/**
 * Pure parking-behaviour model reconstructed from gaps between drives.
 *
 * The API scopes drive starts by UTC calendar date. Parking starts, weekday
 * and month rollups, and the 22:00–06:00 split use an explicit IANA display
 * timezone. The clock is injected so trailing-stint handling is deterministic.
 */

import type { Drive } from '@/types/driving';

export const PARKING_DRIVE_LIMIT = 1_000;

const HOUR_MS = 3_600_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_CALENDAR_DAYS = 36_600;

export type ParkingDurationBandKey =
  | 'under1h'
  | '1to4h'
  | '4to12h'
  | '12to24h'
  | '1to3d'
  | '3dPlus';

export interface ParkingStint {
  sourceDriveId: number;
  location: string | null;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** True only when the selected range contains the injected page clock. */
  ongoing: boolean;
  /** The next drive is unknown because this is the final returned drive. */
  rightCensored: boolean;
}

export interface LocationDwell {
  location: string | null;
  totalMs: number;
  stints: number;
  /** Share of reconstructed parked time, 0–1. */
  share: number;
}

export interface ParkingDurationBand {
  key: ParkingDurationBandKey;
  minMs: number;
  maxMs: number | null;
  stints: number;
  totalMs: number;
  stintShare: number;
  dwellShare: number;
}

export interface HourlyParkingRollup {
  hour: number;
  stints: number;
  totalMs: number;
}

export interface WeekdayParkingRollup {
  /** Sunday = 0 through Saturday = 6. */
  weekday: number;
  stints: number;
  totalMs: number;
}

export interface MonthlyParkingRollup {
  /** Local parking-start month in YYYY-MM form. */
  month: string;
  stints: number;
  totalMs: number;
  averageMs: number;
}

export interface ParkingCoverage {
  recordsReturned: number;
  rowLimit: number;
  possiblyCapped: boolean;
  validDrives: number;
  excludedDrives: number;
  invalidStart: number;
  futureStart: number;
  outsideWindow: number;
  invalidEnd: number;
  futureEnd: number;
  inferredEndDrives: number;
  openDrives: number;
  overlappingGaps: number;
  zeroLengthGaps: number;
  knownLocationStints: number;
  missingLocationStints: number;
  rightCensoredStints: number;
  ongoingStints: number;
  invalidRange: boolean;
  rangeStartMs: number | null;
  rangeEndExclusiveMs: number | null;
  observationStartMs: number | null;
  observationEndMs: number | null;
  timeZone: string;
  timeZoneFallback: boolean;
}

export interface ParkingSummary {
  stints: ParkingStint[];
  /** Descending by total dwell, then stint count, then location. */
  locations: LocationDwell[];
  /** Descending by duration with deterministic timestamp/id tie-breaks. */
  rankedStints: ParkingStint[];
  durationBands: ParkingDurationBand[];
  hourly: HourlyParkingRollup[];
  weekdays: WeekdayParkingRollup[];
  monthly: MonthlyParkingRollup[];
  totalParkedMs: number;
  totalDrivingMs: number;
  nightMs: number;
  daytimeMs: number;
  /** Parked ÷ (parked + driving), 0–1; null without tracked time. */
  parkedShare: number | null;
  /** Parked time overlapping local 22:00–06:00, 0–1; null without stints. */
  nightShare: number | null;
  longestStint: ParkingStint | null;
  coverage: ParkingCoverage;
}

export interface SummarizeParkingOptions {
  nowMs: number;
  rangeStart: string;
  rangeEnd: string;
  timeZone: string;
  rowLimit?: number;
}

interface UtcDateRange {
  startMs: number;
  endExclusiveMs: number;
}

interface NormalizedDrive {
  drive: Drive;
  startMs: number;
  endMs: number;
  open: boolean;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const DURATION_BANDS: ReadonlyArray<{
  key: ParkingDurationBandKey;
  minMs: number;
  maxMs: number | null;
}> = [
  { key: 'under1h', minMs: 0, maxMs: HOUR_MS },
  { key: '1to4h', minMs: HOUR_MS, maxMs: 4 * HOUR_MS },
  { key: '4to12h', minMs: 4 * HOUR_MS, maxMs: 12 * HOUR_MS },
  { key: '12to24h', minMs: 12 * HOUR_MS, maxMs: 24 * HOUR_MS },
  { key: '1to3d', minMs: 24 * HOUR_MS, maxMs: 72 * HOUR_MS },
  { key: '3dPlus', minMs: 72 * HOUR_MS, maxMs: null },
];

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function parseUtcDate(raw: string): CalendarDate | null {
  const match = DATE_ONLY.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Parse date-picker values exactly as the drive endpoint does: UTC dates. */
export function parseParkingUtcRange(
  rangeStart: string,
  rangeEnd: string,
): UtcDateRange | null {
  const start = parseUtcDate(rangeStart);
  const end = parseUtcDate(rangeEnd);
  if (!start || !end) return null;
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endExclusiveMs = Date.UTC(end.year, end.month - 1, end.day + 1);
  return endExclusiveMs > startMs ? { startMs, endExclusiveMs } : null;
}

function resolveTimeZone(raw: string): { timeZone: string; fallback: boolean } {
  const candidate = raw.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return { timeZone: candidate, fallback: false };
  } catch {
    return { timeZone: 'UTC', fallback: true };
  }
}

function getZonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    zonedFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(epochMs: number, timeZone: string): ZonedParts | null {
  if (!Number.isFinite(epochMs)) return null;
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of getZonedFormatter(timeZone).formatToParts(new Date(epochMs))) {
    if (
      part.type === 'year'
      || part.type === 'month'
      || part.type === 'day'
      || part.type === 'hour'
      || part.type === 'minute'
      || part.type === 'second'
    ) {
      values[part.type] = Number(part.value);
    }
  }
  const { year, month, day, hour, minute, second } = values;
  if (
    year == null
    || month == null
    || day == null
    || hour == null
    || minute == null
    || second == null
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function calendarOrdinal(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

/**
 * Convert an existing local wall-clock hour to an epoch in an IANA zone.
 * The relevant 06:00/22:00 boundaries are outside normal DST transition
 * hours; iterative offset correction still handles half-hour offsets.
 */
function zonedHourToEpoch(
  date: CalendarDate,
  hour: number,
  timeZone: string,
): number | null {
  const targetWallMs = Date.UTC(date.year, date.month - 1, date.day, hour);
  let guess = targetWallMs;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const parts = zonedParts(guess, timeZone);
    if (!parts) return null;
    const representedWallMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = targetWallMs - representedWallMs;
    if (correction === 0) return guess;
    guess += correction;
  }
  return guess;
}

/** Milliseconds of `[startMs, endMs)` inside 22:00–06:00 in `timeZone`. */
export function nightOverlapMs(
  startMs: number,
  endMs: number,
  requestedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  const { timeZone } = resolveTimeZone(requestedTimeZone);
  const firstParts = zonedParts(startMs, timeZone);
  const lastParts = zonedParts(endMs - 1, timeZone);
  if (!firstParts || !lastParts) return 0;

  let cursor = addCalendarDays(firstParts, -1);
  const lastDate: CalendarDate = {
    year: lastParts.year,
    month: lastParts.month,
    day: lastParts.day,
  };
  const lastOrdinal = calendarOrdinal(lastDate);
  let overlapMs = 0;

  for (
    let dayIndex = 0;
    dayIndex < MAX_CALENDAR_DAYS && calendarOrdinal(cursor) <= lastOrdinal;
    dayIndex += 1
  ) {
    const nextDate = addCalendarDays(cursor, 1);
    const nightStart = zonedHourToEpoch(cursor, 22, timeZone);
    const nightEnd = zonedHourToEpoch(nextDate, 6, timeZone);
    if (nightStart != null && nightEnd != null && nightEnd > nightStart) {
      overlapMs += Math.max(
        0,
        Math.min(endMs, nightEnd) - Math.max(startMs, nightStart),
      );
    }
    cursor = nextDate;
  }
  return overlapMs;
}

function emptyDurationBands(): ParkingDurationBand[] {
  return DURATION_BANDS.map((band) => ({
    ...band,
    stints: 0,
    totalMs: 0,
    stintShare: 0,
    dwellShare: 0,
  }));
}

function emptyHourly(): HourlyParkingRollup[] {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, stints: 0, totalMs: 0 }));
}

function emptyWeekdays(): WeekdayParkingRollup[] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    stints: 0,
    totalMs: 0,
  }));
}

function emptySummary(coverage: ParkingCoverage): ParkingSummary {
  return {
    stints: [],
    locations: [],
    rankedStints: [],
    durationBands: emptyDurationBands(),
    hourly: emptyHourly(),
    weekdays: emptyWeekdays(),
    monthly: [],
    totalParkedMs: 0,
    totalDrivingMs: 0,
    nightMs: 0,
    daytimeMs: 0,
    parkedShare: null,
    nightShare: null,
    longestStint: null,
    coverage,
  };
}

function normalizedLocation(drive: Drive): string | null {
  const location = drive.endAddress?.trim();
  return location ? location : null;
}

function totalUnionMs(
  drives: readonly NormalizedDrive[],
  rangeStartMs: number,
  observationEndMs: number,
): number {
  const intervals = drives
    .map((drive) => ({
      startMs: Math.max(rangeStartMs, drive.startMs),
      endMs: Math.min(observationEndMs, drive.endMs),
    }))
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  let totalMs = 0;
  let currentStart: number | null = null;
  let currentEnd = 0;
  for (const interval of intervals) {
    if (currentStart == null) {
      currentStart = interval.startMs;
      currentEnd = interval.endMs;
    } else if (interval.startMs <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endMs);
    } else {
      totalMs += currentEnd - currentStart;
      currentStart = interval.startMs;
      currentEnd = interval.endMs;
    }
  }
  return currentStart == null ? 0 : totalMs + currentEnd - currentStart;
}

function locationTieBreak(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

function buildDurationBands(
  stints: readonly ParkingStint[],
  totalParkedMs: number,
): ParkingDurationBand[] {
  const bands = emptyDurationBands();
  for (const stint of stints) {
    const band = bands.find(
      (candidate) =>
        stint.durationMs >= candidate.minMs
        && (candidate.maxMs == null || stint.durationMs < candidate.maxMs),
    );
    if (band) {
      band.stints += 1;
      band.totalMs += stint.durationMs;
    }
  }
  for (const band of bands) {
    band.stintShare = stints.length > 0 ? band.stints / stints.length : 0;
    band.dwellShare = totalParkedMs > 0 ? band.totalMs / totalParkedMs : 0;
  }
  return bands;
}

/**
 * Reconstruct and aggregate parking behaviour for one server-scoped window.
 * No current-time or browser-timezone reads occur inside this function.
 */
export function summarizeParking(
  drives: readonly Drive[],
  options: SummarizeParkingOptions,
): ParkingSummary {
  const rowLimit = Number.isFinite(options.rowLimit)
    ? Math.max(1, Math.floor(options.rowLimit ?? PARKING_DRIVE_LIMIT))
    : PARKING_DRIVE_LIMIT;
  const requestedNowMs = Number.isFinite(options.nowMs) ? options.nowMs : 0;
  const range = parseParkingUtcRange(options.rangeStart, options.rangeEnd);
  const resolvedZone = resolveTimeZone(options.timeZone);
  const coverage: ParkingCoverage = {
    recordsReturned: drives.length,
    rowLimit,
    possiblyCapped: drives.length >= rowLimit,
    validDrives: 0,
    excludedDrives: 0,
    invalidStart: 0,
    futureStart: 0,
    outsideWindow: 0,
    invalidEnd: 0,
    futureEnd: 0,
    inferredEndDrives: 0,
    openDrives: 0,
    overlappingGaps: 0,
    zeroLengthGaps: 0,
    knownLocationStints: 0,
    missingLocationStints: 0,
    rightCensoredStints: 0,
    ongoingStints: 0,
    invalidRange: range == null,
    rangeStartMs: range?.startMs ?? null,
    rangeEndExclusiveMs: range?.endExclusiveMs ?? null,
    observationStartMs: null,
    observationEndMs: range
      ? Math.min(requestedNowMs, range.endExclusiveMs)
      : null,
    timeZone: resolvedZone.timeZone,
    timeZoneFallback: resolvedZone.fallback,
  };

  if (!range) {
    coverage.outsideWindow = drives.length;
    coverage.excludedDrives = drives.length;
    return emptySummary(coverage);
  }

  const observationEndMs = Math.min(requestedNowMs, range.endExclusiveMs);
  const normalized: NormalizedDrive[] = [];

  for (const drive of drives) {
    const startMs = Date.parse(drive.startTs);
    if (!Number.isFinite(startMs)) {
      coverage.invalidStart += 1;
      continue;
    }
    if (startMs > requestedNowMs) {
      coverage.futureStart += 1;
      continue;
    }
    if (startMs < range.startMs || startMs >= range.endExclusiveMs) {
      coverage.outsideWindow += 1;
      continue;
    }

    let endMs: number;
    let open = false;
    if (drive.endTs != null) {
      endMs = Date.parse(drive.endTs);
      if (!Number.isFinite(endMs) || endMs < startMs) {
        coverage.invalidEnd += 1;
        continue;
      }
      if (endMs > requestedNowMs) {
        coverage.futureEnd += 1;
        continue;
      }
    } else if (drive.live === true) {
      endMs = observationEndMs;
      open = true;
      coverage.openDrives += 1;
    } else if (Number.isFinite(drive.durationS) && drive.durationS >= 0) {
      endMs = startMs + drive.durationS * 1_000;
      coverage.inferredEndDrives += 1;
      if (!Number.isFinite(endMs) || endMs > requestedNowMs) {
        coverage.futureEnd += 1;
        continue;
      }
    } else {
      coverage.invalidEnd += 1;
      continue;
    }

    normalized.push({ drive, startMs, endMs, open });
  }

  normalized.sort(
    (a, b) => a.startMs - b.startMs || a.drive.id - b.drive.id,
  );
  coverage.validDrives = normalized.length;
  coverage.excludedDrives =
    coverage.invalidStart
    + coverage.futureStart
    + coverage.outsideWindow
    + coverage.invalidEnd
    + coverage.futureEnd;
  coverage.observationStartMs = normalized[0]?.startMs ?? null;

  const stints: ParkingStint[] = [];
  const rangeContainsClock =
    requestedNowMs >= range.startMs && requestedNowMs < range.endExclusiveMs;

  for (let index = 0; index < normalized.length; index += 1) {
    const drive = normalized[index]!;
    const next = normalized[index + 1];
    if (drive.open) {
      if (next) coverage.overlappingGaps += 1;
      continue;
    }

    if (next) {
      const rawGapMs = next.startMs - drive.endMs;
      if (rawGapMs < 0) {
        coverage.overlappingGaps += 1;
        continue;
      }
      if (rawGapMs === 0) {
        coverage.zeroLengthGaps += 1;
        continue;
      }
    }

    const rightCensored = next == null;
    const stintEndMs = Math.min(next?.startMs ?? observationEndMs, observationEndMs);
    if (stintEndMs <= drive.endMs) continue;
    const ongoing =
      rightCensored
      && rangeContainsClock
      && observationEndMs === requestedNowMs;
    stints.push({
      sourceDriveId: drive.drive.id,
      location: normalizedLocation(drive.drive),
      startMs: drive.endMs,
      endMs: stintEndMs,
      durationMs: stintEndMs - drive.endMs,
      ongoing,
      rightCensored,
    });
  }

  const totalParkedMs = stints.reduce((total, stint) => total + stint.durationMs, 0);
  const totalDrivingMs = observationEndMs > range.startMs
    ? totalUnionMs(normalized, range.startMs, observationEndMs)
    : 0;
  const hourly = emptyHourly();
  const weekdays = emptyWeekdays();
  const monthlyMap = new Map<string, { stints: number; totalMs: number }>();
  const locationMap = new Map<string | null, { stints: number; totalMs: number }>();
  let nightMs = 0;

  for (const stint of stints) {
    const parts = zonedParts(stint.startMs, resolvedZone.timeZone);
    if (parts) {
      hourly[parts.hour]!.stints += 1;
      hourly[parts.hour]!.totalMs += stint.durationMs;
      const weekday = new Date(
        Date.UTC(parts.year, parts.month - 1, parts.day),
      ).getUTCDay();
      weekdays[weekday]!.stints += 1;
      weekdays[weekday]!.totalMs += stint.durationMs;
      const month = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}`;
      const monthRollup = monthlyMap.get(month) ?? { stints: 0, totalMs: 0 };
      monthRollup.stints += 1;
      monthRollup.totalMs += stint.durationMs;
      monthlyMap.set(month, monthRollup);
    }

    nightMs += nightOverlapMs(stint.startMs, stint.endMs, resolvedZone.timeZone);
    const locationRollup = locationMap.get(stint.location) ?? {
      stints: 0,
      totalMs: 0,
    };
    locationRollup.stints += 1;
    locationRollup.totalMs += stint.durationMs;
    locationMap.set(stint.location, locationRollup);

    if (stint.location == null) coverage.missingLocationStints += 1;
    else coverage.knownLocationStints += 1;
    if (stint.rightCensored) coverage.rightCensoredStints += 1;
    if (stint.ongoing) coverage.ongoingStints += 1;
  }

  const locations = Array.from(locationMap, ([location, rollup]) => ({
    location,
    stints: rollup.stints,
    totalMs: rollup.totalMs,
    share: totalParkedMs > 0 ? rollup.totalMs / totalParkedMs : 0,
  })).sort(
    (a, b) =>
      b.totalMs - a.totalMs
      || b.stints - a.stints
      || locationTieBreak(a.location, b.location),
  );
  const rankedStints = [...stints].sort(
    (a, b) =>
      b.durationMs - a.durationMs
      || a.startMs - b.startMs
      || a.sourceDriveId - b.sourceDriveId,
  );
  const monthly = Array.from(monthlyMap, ([month, rollup]) => ({
    month,
    stints: rollup.stints,
    totalMs: rollup.totalMs,
    averageMs: rollup.totalMs / rollup.stints,
  })).sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const totalTrackedMs = totalParkedMs + totalDrivingMs;

  return {
    stints,
    locations,
    rankedStints,
    durationBands: buildDurationBands(stints, totalParkedMs),
    hourly,
    weekdays,
    monthly,
    totalParkedMs,
    totalDrivingMs,
    nightMs,
    daytimeMs: Math.max(0, totalParkedMs - nightMs),
    parkedShare: totalTrackedMs > 0 ? totalParkedMs / totalTrackedMs : null,
    nightShare: totalParkedMs > 0 ? nightMs / totalParkedMs : null,
    longestStint: rankedStints[0] ?? null,
    coverage,
  };
}
