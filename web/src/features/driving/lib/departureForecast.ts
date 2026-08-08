/**
 * Departure Forecast
 *
 * A pure, clock-injected weekday/hour model for recorded drive starts. Every
 * qualifying drive start is deliberately treated as a separate departure
 * event, including multiple drives on the same local day.
 *
 * The model uses a Gamma-Poisson posterior mean for each local weekday/hour:
 *
 *   lambda = (departures + alpha) / (cell occurrences + beta)
 *
 * `1 - exp(-lambda)` is surfaced as a modeled likelihood estimate. It is not
 * called a calibrated probability because TeslaSync has no forecast
 * backtesting/calibration result for this model.
 *
 * All calendar work is explicit in `timeZone`. No browser-local Date getters
 * participate in bucketing or projection. Hour boundaries are discovered as
 * real instants whose zoned minute is `00`, which preserves repeated/skipped
 * DST hours and zones with non-whole-hour UTC offsets.
 */

import type { Drive } from '@/types/driving';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const HOURS_PER_WEEK = 7 * 24;

export type EvidenceBand = 'none' | 'thin' | 'developing' | 'strong';
export type DepartureDaypart =
  | 'overnight'
  | 'morning'
  | 'afternoon'
  | 'evening';

export interface DepartureForecastOptions {
  /** Absolute lookback from `nowMs`; returned rows outside it are excluded. */
  windowDays?: number;
  /** Number of real upcoming local-hour boundaries to project. */
  horizonHours?: number;
  /** Gamma prior shape (pseudo-departures). */
  priorAlpha?: number;
  /** Gamma prior rate (pseudo-cell-occurrences). */
  priorBeta?: number;
  /** Modeled likelihood needed for `nextLikely`. */
  likelyThreshold?: number;
  /** Illustrative lead before a supported peak-hour boundary. */
  planningLeadMinutes?: number;
  /** Minimum descriptive support index needed for a planning marker. */
  planningMinimumEvidence?: number;
  /** Returned-row cap requested from the history hook. */
  historyLimit?: number;
  /** Number of supported upcoming windows retained after ranking. */
  rankedWindowCount?: number;
  /** Included events at which the volume ingredient reaches one. */
  strongDepartureCount?: number;
  /** Active local weeks at which the recurrence ingredient reaches one. */
  strongActiveWeeks?: number;
  /** Repeat events beyond a cell's first event needed for full support. */
  strongRepeatedDepartures?: number;
  /** Mean occupied-cell occurrences needed for full exposure support. */
  strongCellOccurrences?: number;
}

export interface ResolvedDepartureForecastOptions {
  windowDays: number;
  horizonHours: number;
  priorAlpha: number;
  priorBeta: number;
  likelyThreshold: number;
  planningLeadMinutes: number;
  planningMinimumEvidence: number;
  historyLimit: number;
  rankedWindowCount: number;
  strongDepartureCount: number;
  strongActiveWeeks: number;
  strongRepeatedDepartures: number;
  strongCellOccurrences: number;
}

export interface DepartureEvidenceAccounting {
  returnedRows: number;
  includedRows: number;
  invalidRows: number;
  futureRows: number;
  outsideWindowRows: number;
  historyLimit: number;
  historyCapReached: boolean;
  cutoffMs: number;
}

export interface DepartureMatrixCell {
  weekday: number;
  hour: number;
  departures: number;
  occurrences: number;
  /** Gamma-Poisson posterior mean events per observed cell occurrence. */
  lambda: number;
  /** Poisson-derived modeled likelihood estimate, not calibrated. */
  p: number;
  /** At least one qualifying departure was recorded in this cell. */
  supported: boolean;
}

export interface DepartureRates {
  counts: number[][];
  occurrences: number[][];
  lambda: number[][];
  matrix: DepartureMatrixCell[][];
  totalDepartures: number;
  observedSpanDays: number;
}

export interface ForecastSlot {
  slotIndex: number;
  startMs: number;
  endMs: number;
  weekday: number;
  hour: number;
  localDateKey: string;
  /** Truthful elapsed time from injected `nowMs` to this boundary. */
  minutesFromNow: number;
  /** Unrounded elapsed hours; can be fractional around the first boundary. */
  hoursFromNow: number;
  lambda: number;
  /** Poisson-derived modeled likelihood estimate, not calibrated. */
  p: number;
  cumulative: number;
  supported: boolean;
  historicalDepartures: number;
  cellOccurrences: number;
}

export interface WeekdayPeak {
  weekday: number;
  supported: boolean;
  hour: number | null;
  p: number | null;
  departures: number;
  cellOccurrences: number;
  totalDepartures: number;
}

export interface WeekdayDepartureProfile extends WeekdayPeak {
  activeDays: number;
  concentration: number | null;
}

export interface LocalHourDistribution {
  hour: number;
  departures: number;
  share: number | null;
  supported: boolean;
}

export interface DaypartDistribution {
  daypart: DepartureDaypart;
  startHour: number;
  endHour: number;
  departures: number;
  share: number | null;
  supported: boolean;
}

export interface WeeklyDepartureTrend {
  weekStartKey: string;
  departures: number;
  activeDays: number;
}

export interface RoutineStability {
  normalizedEntropy: number | null;
  routineConcentration: number | null;
  topCellShare: number | null;
  occupiedCells: number;
}

export interface DepartureEvidenceStrength {
  /** Descriptive support index; not statistical confidence. */
  value: number;
  band: EvidenceBand;
  includedDepartures: number;
  observedWeeks: number;
  activeWeeks: number;
  occupiedCells: number;
  repeatedCells: number;
  repeatedDepartures: number;
  meanOccupiedCellOccurrences: number;
  volumeScore: number;
  activeWeekScore: number;
  repeatScore: number;
  occurrenceScore: number;
}

export interface DepartureForecast {
  nowMs: number;
  timeZone: string;
  config: ResolvedDepartureForecastOptions;
  accounting: DepartureEvidenceAccounting;
  rates: DepartureRates;
  slots: ForecastSlot[];
  rankedWindows: ForecastSlot[];
  peak: ForecastSlot | null;
  nextLikely: ForecastSlot | null;
  horizonLikelihood: number | null;
  /** Illustrative only; never an automatic or weather-aware command. */
  planningMarkerAtMs: number | null;
  evidenceStrength: DepartureEvidenceStrength;
  weekdayProfiles: WeekdayDepartureProfile[];
  localHourDistribution: LocalHourDistribution[];
  daypartDistribution: DaypartDistribution[];
  weeklyTrend: WeeklyDepartureTrend[];
  routineStability: RoutineStability;
  totalDepartures: number;
  activeDays: number;
  activeWeeks: number;
  observedSpanDays: number;
  observedWeeks: number;
}

interface ParsedDriveStart {
  ms: number;
  sourceIndex: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  dateKey: string;
}

interface IncludedDeparture extends ParsedDriveStart {
  zoned: ZonedParts;
  weekStartKey: string;
}

const DEFAULTS: ResolvedDepartureForecastOptions = {
  windowDays: 120,
  horizonHours: 24,
  priorAlpha: 0.25,
  priorBeta: 8,
  likelyThreshold: 0.25,
  planningLeadMinutes: 20,
  planningMinimumEvidence: 0.25,
  historyLimit: 1_000,
  rankedWindowCount: 5,
  strongDepartureCount: 40,
  strongActiveWeeks: 8,
  strongRepeatedDepartures: 16,
  strongCellOccurrences: 8,
};

const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function clamp(value: number, minimum = 0, maximum = 1): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function positive(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return clamp(value, minimum, maximum);
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.round(positive(value, fallback, minimum, maximum));
}

function resolveOptions(
  options: DepartureForecastOptions,
): ResolvedDepartureForecastOptions {
  return {
    windowDays: positive(options.windowDays, DEFAULTS.windowDays, 1, 3_650),
    horizonHours: positiveInteger(
      options.horizonHours,
      DEFAULTS.horizonHours,
      1,
      HOURS_PER_WEEK,
    ),
    priorAlpha: positive(options.priorAlpha, DEFAULTS.priorAlpha, 0, 100),
    priorBeta: positive(options.priorBeta, DEFAULTS.priorBeta, 0.001, 1_000),
    likelyThreshold: positive(
      options.likelyThreshold,
      DEFAULTS.likelyThreshold,
      0,
      1,
    ),
    planningLeadMinutes: positiveInteger(
      options.planningLeadMinutes,
      DEFAULTS.planningLeadMinutes,
      0,
      180,
    ),
    planningMinimumEvidence: positive(
      options.planningMinimumEvidence,
      DEFAULTS.planningMinimumEvidence,
      0,
      1,
    ),
    historyLimit: positiveInteger(
      options.historyLimit,
      DEFAULTS.historyLimit,
      1,
      100_000,
    ),
    rankedWindowCount: positiveInteger(
      options.rankedWindowCount,
      DEFAULTS.rankedWindowCount,
      1,
      24,
    ),
    strongDepartureCount: positive(
      options.strongDepartureCount,
      DEFAULTS.strongDepartureCount,
      1,
      10_000,
    ),
    strongActiveWeeks: positive(
      options.strongActiveWeeks,
      DEFAULTS.strongActiveWeeks,
      1,
      520,
    ),
    strongRepeatedDepartures: positive(
      options.strongRepeatedDepartures,
      DEFAULTS.strongRepeatedDepartures,
      1,
      10_000,
    ),
    strongCellOccurrences: positive(
      options.strongCellOccurrences,
      DEFAULTS.strongCellOccurrences,
      1,
      10_000,
    ),
  };
}

function normalizeTimeZone(timeZone: string): string {
  const candidate =
    typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : 'UTC';
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
  const formatter = new Intl.DateTimeFormat(
    'en-US-u-ca-gregory-nu-latn',
    {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    },
  );
  PARTS_FORMATTERS.set(timeZone, formatter);
  return formatter;
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
  const rawHour = numberPart('hour');
  const hour = rawHour === 24 ? 0 : clamp(rawHour, 0, 23);
  const minute = clamp(numberPart('minute'), 0, 59);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function weekStartKey(parts: ZonedParts): string {
  const daysSinceMonday = (parts.weekday + 6) % 7;
  return shiftDateKey(parts.dateKey, -daysSinceMonday);
}

function emptyMatrix(): number[][] {
  return Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
}

function parseStart(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function classifyDrives(
  drives: readonly Drive[],
  nowMs: number,
  opts: ResolvedDepartureForecastOptions,
): {
  parsed: ParsedDriveStart[];
  accounting: DepartureEvidenceAccounting;
} {
  const cutoffMs = nowMs - opts.windowDays * MS_PER_DAY;
  const parsed: ParsedDriveStart[] = [];
  let invalidRows = 0;
  let futureRows = 0;
  let outsideWindowRows = 0;

  drives.forEach((drive, sourceIndex) => {
    const ms = parseStart(
      drive && typeof drive === 'object'
        ? (drive as Partial<Drive>).startTs
        : null,
    );
    if (ms == null) {
      invalidRows += 1;
    } else if (ms > nowMs) {
      futureRows += 1;
    } else if (ms < cutoffMs) {
      outsideWindowRows += 1;
    } else {
      parsed.push({ ms, sourceIndex });
    }
  });

  parsed.sort((a, b) => a.ms - b.ms || a.sourceIndex - b.sourceIndex);
  return {
    parsed,
    accounting: {
      returnedRows: drives.length,
      includedRows: parsed.length,
      invalidRows,
      futureRows,
      outsideWindowRows,
      historyLimit: opts.historyLimit,
      historyCapReached: drives.length >= opts.historyLimit,
      cutoffMs,
    },
  };
}

function isWholeLocalHour(ms: number, timeZone: string): boolean {
  return ms % MS_PER_MINUTE === 0 && zonedParts(ms, timeZone).minute === 0;
}

function boundaryAtOrBefore(ms: number, timeZone: string): number {
  const minute = Math.floor(ms / MS_PER_MINUTE) * MS_PER_MINUTE;
  for (let index = 0; index <= 180; index += 1) {
    const candidate = minute - index * MS_PER_MINUTE;
    if (isWholeLocalHour(candidate, timeZone)) return candidate;
  }
  return Math.floor(ms / MS_PER_HOUR) * MS_PER_HOUR;
}

function nextHourBoundary(afterMs: number, timeZone: string): number {
  const knownBoundary = isWholeLocalHour(afterMs, timeZone);
  if (knownBoundary) {
    const usual = afterMs + MS_PER_HOUR;
    if (isWholeLocalHour(usual, timeZone)) return usual;
  }

  const firstMinute =
    Math.floor(afterMs / MS_PER_MINUTE) * MS_PER_MINUTE + MS_PER_MINUTE;
  for (let index = 0; index <= 180; index += 1) {
    const candidate = firstMinute + index * MS_PER_MINUTE;
    if (candidate > afterMs && isWholeLocalHour(candidate, timeZone)) {
      return candidate;
    }
  }
  return afterMs + MS_PER_HOUR;
}

function countOccurrences(
  startMs: number | null,
  nowMs: number,
  timeZone: string,
): number[][] {
  const occurrences = emptyMatrix();
  if (startMs == null) return occurrences;
  let boundary = boundaryAtOrBefore(startMs, timeZone);
  const maximumBoundaries =
    Math.ceil(Math.max(0, nowMs - boundary) / (30 * MS_PER_MINUTE)) + 4;
  for (let index = 0; index < maximumBoundaries; index += 1) {
    if (boundary > nowMs) break;
    const parts = zonedParts(boundary, timeZone);
    occurrences[parts.weekday]![parts.hour]! += 1;
    const next = nextHourBoundary(boundary, timeZone);
    if (!Number.isFinite(next) || next <= boundary) break;
    boundary = next;
  }
  return occurrences;
}

function modeledLikelihood(lambda: number): number {
  return clamp(1 - Math.exp(-Math.max(0, lambda)));
}

function buildRatesFromIncluded(
  included: readonly IncludedDeparture[],
  nowMs: number,
  timeZone: string,
  opts: ResolvedDepartureForecastOptions,
): DepartureRates {
  const counts = emptyMatrix();
  for (const departure of included) {
    counts[departure.zoned.weekday]![departure.zoned.hour]! += 1;
  }
  const earliestMs = included[0]?.ms ?? null;
  const occurrences = countOccurrences(earliestMs, nowMs, timeZone);
  const lambda = emptyMatrix();
  const matrix: DepartureMatrixCell[][] = Array.from(
    { length: 7 },
    () => [],
  );

  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const departures = counts[weekday]![hour]!;
      const cellOccurrences = occurrences[weekday]![hour]!;
      const rate =
        included.length === 0
          ? 0
          : (departures + opts.priorAlpha) /
            (cellOccurrences + opts.priorBeta);
      const safeRate = Number.isFinite(rate) ? Math.max(0, rate) : 0;
      lambda[weekday]![hour] = round(safeRate, 6);
      matrix[weekday]!.push({
        weekday,
        hour,
        departures,
        occurrences: cellOccurrences,
        lambda: round(safeRate, 6),
        p: round(modeledLikelihood(safeRate), 6),
        supported: departures > 0,
      });
    }
  }

  const observedSpanDays =
    earliestMs == null ? 0 : Math.max(0, (nowMs - earliestMs) / MS_PER_DAY);
  return {
    counts,
    occurrences,
    lambda,
    matrix,
    totalDepartures: included.length,
    observedSpanDays: round(observedSpanDays, 2),
  };
}

/**
 * Build timezone-scoped rates and complete returned-row accounting.
 *
 * This lower-level export is useful for inspecting the fitted matrix without
 * creating upcoming slots. Input order is never changed.
 */
export function buildDepartureRates(
  drives: readonly Drive[],
  nowMs: number,
  timeZone: string,
  options: DepartureForecastOptions = {},
): DepartureRates & { accounting: DepartureEvidenceAccounting } {
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : 0;
  const zone = normalizeTimeZone(timeZone);
  const opts = resolveOptions(options);
  const classified = classifyDrives(drives, safeNowMs, opts);
  const included = classified.parsed.map((departure) => {
    const zoned = zonedParts(departure.ms, zone);
    return {
      ...departure,
      zoned,
      weekStartKey: weekStartKey(zoned),
    };
  });
  return {
    ...buildRatesFromIncluded(included, safeNowMs, zone, opts),
    accounting: classified.accounting,
  };
}

/**
 * Return one row per weekday. A weekday with no qualifying recorded
 * departure is explicit and has no prior-only peak.
 */
export function weekdayPeaks(rates: DepartureRates): WeekdayPeak[] {
  return rates.matrix.map((cells, weekday) => {
    const supportedCells = cells.filter((cell) => cell.supported);
    let peak: DepartureMatrixCell | null = null;
    for (const cell of supportedCells) {
      if (peak == null || cell.p > peak.p) peak = cell;
    }
    const totalDepartures = cells.reduce(
      (sum, cell) => sum + cell.departures,
      0,
    );
    return {
      weekday,
      supported: peak != null,
      hour: peak?.hour ?? null,
      p: peak?.p ?? null,
      departures: peak?.departures ?? 0,
      cellOccurrences: peak?.occurrences ?? 0,
      totalDepartures,
    };
  });
}

function evidenceBand(value: number, departures: number): EvidenceBand {
  if (departures === 0) return 'none';
  if (value < 0.25) return 'thin';
  if (value < 0.65) return 'developing';
  return 'strong';
}

function buildEvidenceStrength(
  rates: DepartureRates,
  included: readonly IncludedDeparture[],
  activeWeeks: number,
  observedWeeks: number,
  opts: ResolvedDepartureForecastOptions,
): DepartureEvidenceStrength {
  const occupied = rates.matrix
    .flat()
    .filter((cell) => cell.departures > 0);
  const repeatedCells = occupied.filter((cell) => cell.departures >= 2).length;
  const repeatedDepartures = occupied.reduce(
    (sum, cell) => sum + Math.max(0, cell.departures - 1),
    0,
  );
  const meanOccupiedCellOccurrences =
    occupied.length === 0
      ? 0
      : occupied.reduce((sum, cell) => sum + cell.occurrences, 0) /
        occupied.length;
  const volumeScore = clamp(included.length / opts.strongDepartureCount);
  const activeWeekScore = clamp(activeWeeks / opts.strongActiveWeeks);
  const repeatScore = clamp(
    repeatedDepartures / opts.strongRepeatedDepartures,
  );
  const occurrenceScore = clamp(
    meanOccupiedCellOccurrences / opts.strongCellOccurrences,
  );
  // Event volume gates the recurrence/exposure ingredients, so one old event
  // cannot become "strong" merely because a long elapsed span exposes cells.
  const recurrenceSupport =
    0.4 * activeWeekScore + 0.4 * repeatScore + 0.2 * occurrenceScore;
  const value = round(clamp(volumeScore * recurrenceSupport), 3);
  return {
    value,
    band: evidenceBand(value, included.length),
    includedDepartures: included.length,
    observedWeeks: round(observedWeeks, 2),
    activeWeeks,
    occupiedCells: occupied.length,
    repeatedCells,
    repeatedDepartures,
    meanOccupiedCellOccurrences: round(meanOccupiedCellOccurrences, 2),
    volumeScore: round(volumeScore, 3),
    activeWeekScore: round(activeWeekScore, 3),
    repeatScore: round(repeatScore, 3),
    occurrenceScore: round(occurrenceScore, 3),
  };
}

function buildRoutineStability(rates: DepartureRates): RoutineStability {
  const counts = rates.counts.flat();
  const total = counts.reduce((sum, count) => sum + count, 0);
  const occupiedCells = counts.filter((count) => count > 0).length;
  if (total === 0) {
    return {
      normalizedEntropy: null,
      routineConcentration: null,
      topCellShare: null,
      occupiedCells: 0,
    };
  }
  let entropy = 0;
  let topCount = 0;
  for (const count of counts) {
    topCount = Math.max(topCount, count);
    if (count <= 0) continue;
    const share = count / total;
    entropy -= share * Math.log(share);
  }
  const normalizedEntropy = clamp(entropy / Math.log(HOURS_PER_WEEK));
  return {
    normalizedEntropy: round(normalizedEntropy, 3),
    routineConcentration: round(1 - normalizedEntropy, 3),
    topCellShare: round(topCount / total, 3),
    occupiedCells,
  };
}

function buildHourDistribution(
  rates: DepartureRates,
): LocalHourDistribution[] {
  const total = rates.totalDepartures;
  return Array.from({ length: 24 }, (_, hour) => {
    const departures = rates.counts.reduce(
      (sum, weekday) => sum + weekday[hour]!,
      0,
    );
    return {
      hour,
      departures,
      share: total > 0 ? round(departures / total, 4) : null,
      supported: departures > 0,
    };
  });
}

function daypartForHour(hour: number): DepartureDaypart {
  if (hour < 6) return 'overnight';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function buildDaypartDistribution(
  hours: readonly LocalHourDistribution[],
  total: number,
): DaypartDistribution[] {
  const definitions: Array<{
    daypart: DepartureDaypart;
    startHour: number;
    endHour: number;
  }> = [
    { daypart: 'overnight', startHour: 0, endHour: 5 },
    { daypart: 'morning', startHour: 6, endHour: 11 },
    { daypart: 'afternoon', startHour: 12, endHour: 17 },
    { daypart: 'evening', startHour: 18, endHour: 23 },
  ];
  return definitions.map((definition) => {
    const departures = hours
      .filter((hour) => daypartForHour(hour.hour) === definition.daypart)
      .reduce((sum, hour) => sum + hour.departures, 0);
    return {
      ...definition,
      departures,
      share: total > 0 ? round(departures / total, 4) : null,
      supported: departures > 0,
    };
  });
}

function buildWeeklyTrend(
  included: readonly IncludedDeparture[],
  nowParts: ZonedParts,
): WeeklyDepartureTrend[] {
  if (included.length === 0) return [];
  const counts = new Map<string, number>();
  const days = new Map<string, Set<string>>();
  for (const departure of included) {
    counts.set(
      departure.weekStartKey,
      (counts.get(departure.weekStartKey) ?? 0) + 1,
    );
    const activeDays = days.get(departure.weekStartKey) ?? new Set<string>();
    activeDays.add(departure.zoned.dateKey);
    days.set(departure.weekStartKey, activeDays);
  }

  const rows: WeeklyDepartureTrend[] = [];
  const endKey = weekStartKey(nowParts);
  let key = included[0]!.weekStartKey;
  for (let index = 0; index < 530 && key <= endKey; index += 1) {
    rows.push({
      weekStartKey: key,
      departures: counts.get(key) ?? 0,
      activeDays: days.get(key)?.size ?? 0,
    });
    key = shiftDateKey(key, 7);
  }
  return rows;
}

function buildWeekdayProfiles(
  rates: DepartureRates,
  included: readonly IncludedDeparture[],
): WeekdayDepartureProfile[] {
  const activeDays = Array.from({ length: 7 }, () => new Set<string>());
  for (const departure of included) {
    activeDays[departure.zoned.weekday]!.add(departure.zoned.dateKey);
  }
  return weekdayPeaks(rates).map((profile) => ({
    ...profile,
    activeDays: activeDays[profile.weekday]!.size,
    concentration:
      profile.totalDepartures > 0
        ? round(profile.departures / profile.totalDepartures, 3)
        : null,
  }));
}

function buildSlots(
  rates: DepartureRates,
  nowMs: number,
  timeZone: string,
  opts: ResolvedDepartureForecastOptions,
): ForecastSlot[] {
  if (rates.totalDepartures === 0) return [];
  const slots: ForecastSlot[] = [];
  let startMs = nextHourBoundary(nowMs, timeZone);
  let miss = 1;
  for (let index = 0; index < opts.horizonHours; index += 1) {
    const endMs = nextHourBoundary(startMs, timeZone);
    const parts = zonedParts(startMs, timeZone);
    const cell = rates.matrix[parts.weekday]![parts.hour]!;
    const p = modeledLikelihood(cell.lambda);
    miss = clamp(miss * (1 - p));
    const cumulative = clamp(1 - miss);
    slots.push({
      slotIndex: index + 1,
      startMs,
      endMs,
      weekday: parts.weekday,
      hour: parts.hour,
      localDateKey: parts.dateKey,
      minutesFromNow: Math.max(
        1,
        Math.ceil((startMs - nowMs) / MS_PER_MINUTE),
      ),
      hoursFromNow: round(Math.max(0, (startMs - nowMs) / MS_PER_HOUR), 3),
      lambda: round(cell.lambda, 6),
      p: round(p, 6),
      cumulative: round(cumulative, 6),
      supported: cell.supported,
      historicalDepartures: cell.departures,
      cellOccurrences: cell.occurrences,
    });
    startMs = endMs;
  }
  return slots;
}

/**
 * Fit and project a complete departure model.
 *
 * `nowMs` and `timeZone` are mandatory inputs so tests and consumers never
 * inherit the browser's clock or local timezone implicitly.
 */
export function forecastDepartures(
  drives: readonly Drive[],
  nowMs: number,
  timeZone: string,
  options: DepartureForecastOptions = {},
): DepartureForecast {
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : 0;
  const zone = normalizeTimeZone(timeZone);
  const opts = resolveOptions(options);
  const classified = classifyDrives(drives, safeNowMs, opts);
  const included: IncludedDeparture[] = classified.parsed.map((departure) => {
    const zoned = zonedParts(departure.ms, zone);
    return {
      ...departure,
      zoned,
      weekStartKey: weekStartKey(zoned),
    };
  });
  const rates = buildRatesFromIncluded(included, safeNowMs, zone, opts);
  const activeDayKeys = new Set(
    included.map((departure) => departure.zoned.dateKey),
  );
  const activeWeekKeys = new Set(
    included.map((departure) => departure.weekStartKey),
  );
  const observedSpanDays = rates.observedSpanDays;
  const observedWeeks = round(observedSpanDays / 7, 2);
  const evidenceStrength = buildEvidenceStrength(
    rates,
    included,
    activeWeekKeys.size,
    observedWeeks,
    opts,
  );
  const slots = buildSlots(rates, safeNowMs, zone, opts);
  const supportedSlots = slots.filter((slot) => slot.supported);

  let peak: ForecastSlot | null = null;
  for (const slot of supportedSlots) {
    if (peak == null || slot.p > peak.p) peak = slot;
  }
  const nextLikely =
    slots.find(
      (slot) => slot.supported && slot.p >= opts.likelyThreshold,
    ) ?? null;
  const rankedWindows = [...supportedSlots]
    .sort((a, b) => b.p - a.p || a.slotIndex - b.slotIndex)
    .slice(0, opts.rankedWindowCount);
  const candidatePlanningMarker =
    peak == null
      ? null
      : peak.startMs - opts.planningLeadMinutes * MS_PER_MINUTE;
  const planningMarkerAtMs =
    candidatePlanningMarker != null &&
    candidatePlanningMarker >= safeNowMs &&
    evidenceStrength.value >= opts.planningMinimumEvidence
      ? candidatePlanningMarker
      : null;
  const localHourDistribution = buildHourDistribution(rates);
  const nowParts = zonedParts(safeNowMs, zone);

  return {
    nowMs: safeNowMs,
    timeZone: zone,
    config: opts,
    accounting: classified.accounting,
    rates,
    slots,
    rankedWindows,
    peak,
    nextLikely,
    horizonLikelihood:
      slots.length > 0 ? slots[slots.length - 1]!.cumulative : null,
    planningMarkerAtMs,
    evidenceStrength,
    weekdayProfiles: buildWeekdayProfiles(rates, included),
    localHourDistribution,
    daypartDistribution: buildDaypartDistribution(
      localHourDistribution,
      included.length,
    ),
    weeklyTrend: buildWeeklyTrend(included, nowParts),
    routineStability: buildRoutineStability(rates),
    totalDepartures: included.length,
    activeDays: activeDayKeys.size,
    activeWeeks: activeWeekKeys.size,
    observedSpanDays,
    observedWeeks,
  };
}
