/**
 * Charge Advisor's pure, descriptive model.
 *
 * The model works in battery percentage points and watt-hours because those
 * are the SI-canonical values returned by the web API. It never presents a
 * battery-condition assessment or a calibrated output. Its scenarios are
 * seven complete vehicle-local calendar days beginning tomorrow, based on
 * observed drive-associated SoC drops and charging history.
 */

import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

export const RESERVE_FLOOR_PCT = 20;
export const DEFAULT_HISTORY_WINDOW_DAYS = 180;
export const DEFAULT_FALLBACK_MAX_AGE_MS = 2 * 86_400_000;
export const DEFAULT_HISTORY_LIMIT = 1_000;

export type Guidance =
  | 'current_state_unavailable'
  | 'stale'
  | 'already_charging'
  | 'insufficient_history'
  | 'charge_before_next_use'
  | 'monitor'
  | 'no_immediate_need';

export type Freshness = 'fresh' | 'stale' | 'unavailable';
export type SupportBand = 'none' | 'thin' | 'moderate' | 'strong';

export type DriveRowCategory =
  | 'included'
  | 'outside_window'
  | 'incomplete_live'
  | 'invalid_timestamp_order'
  | 'future'
  | 'invalid_duration'
  | 'missing_soc'
  | 'invalid_soc'
  | 'nonpositive_soc_drop'
  | 'implausible_soc_drop';

export type ChargingRowCategory =
  | 'included'
  | 'outside_window'
  | 'incomplete_live'
  | 'invalid_timestamp_order'
  | 'future'
  | 'missing_soc'
  | 'invalid_soc'
  | 'nonpositive_soc_gain';

export interface ChargeAdvisorLiveSnapshot {
  /** Battery percentage from the live signal store. */
  batteryPct: number | null;
  /** Retrieval time of the live snapshot, not a browser render time. */
  observedAtMs: number | null;
  source: 'live' | 'unknown';
  retrievalState: 'connected' | 'disconnected' | 'unavailable' | 'unknown';
  connected: boolean | null;
  isCharging: boolean | null;
  chargeLimitPct: number | null;
}

export interface ChargeAdvisorOptions {
  historyWindowDays?: number;
  historyLimit?: number;
  fallbackMaxAgeMs?: number;
  /** Clock used only to validate and age current-state candidates. */
  currentStateNowMs?: number;
  reserveFloorPct?: number;
  reserveSensitivityPcts?: readonly number[];
  maxDriveDurationS?: number;
  maxSoCDropPct?: number;
  minCalendarDays?: number;
  minDrivingDays?: number;
  minActiveWeeks?: number;
  actionableCrossingDays?: number;
}

export interface RowAccounting<Category extends string> {
  returnedRows: number;
  inWindowRows: number;
  includedRows: number;
  historyLimit: number;
  historyCapReached: boolean;
  categories: Record<Category, number>;
}

export interface Distribution {
  count: number;
  meanPct: number | null;
  medianPct: number | null;
  p75Pct: number | null;
  p90Pct: number | null;
  minPct: number | null;
  maxPct: number | null;
}

export interface SupportSummary {
  score: number;
  band: SupportBand;
  includedRows: number;
  activeLocalDays: number;
  activeWeeks: number;
  observedSpanDays: number;
}

export interface WeekdayProfile {
  weekday: number;
  calendarOccurrences: number;
  drivingDays: number;
  driveDayShare: number;
  /** Statistics across every local calendar occurrence, including zero-use days. */
  meanPct: number | null;
  medianPct: number | null;
  p75Pct: number | null;
  p90Pct: number | null;
  /** Statistics across active local days only, for descriptive context. */
  activeDayMeanPct: number | null;
  activeDayMedianPct: number | null;
  activeDayP75Pct: number | null;
  activeDayP90Pct: number | null;
  activeWeeks: number;
  support: SupportSummary;
}

export interface DailyDrop {
  localDate: string;
  weekday: number;
  driveCount: number;
  dropPct: number;
}

export interface ScenarioDay {
  localDate: string;
  weekday: number;
  meanBurnPct: number;
  p75BurnPct: number;
  meanEndSocPct: number;
  p75EndSocPct: number;
}

export interface ScenarioSet {
  horizonDays: number;
  startsLocalDate: string | null;
  meanPath: ScenarioDay[];
  p75Path: ScenarioDay[];
  meanEndSocPct: number | null;
  p75EndSocPct: number | null;
  meanDaysToCrossReserve: number | null;
  p75DaysToCrossReserve: number | null;
}

export interface ReserveSensitivity {
  floorPct: number;
  meanDaysToCross: number | null;
  p75DaysToCross: number | null;
}

export interface CurrentState {
  batteryPct: number | null;
  observedAtMs: number | null;
  source: 'live' | 'drive_end' | 'charge_end' | null;
  ageMs: number | null;
  freshness: Freshness;
  retrievalState: ChargeAdvisorLiveSnapshot['retrievalState'];
  connected: boolean | null;
  isCharging: boolean | null;
  chargeLimitPct: number | null;
}

export interface ChargingProfile {
  sessions: number;
  activeWeeks: number;
  startsByWeekday: number[];
  startsByHour: number[];
  endsByWeekday: number[];
  endsByHour: number[];
  medianStartSocPct: number | null;
  medianEndSocPct: number | null;
  medianAddedPct: number | null;
  daysSinceLatestCompletedCharge: number | null;
  totalEnergyAddedWh: number | null;
  energyRows: number;
  support: SupportSummary;
}

export interface EvidenceSummary {
  returnedRows: number;
  inWindowRows: number;
  includedRows: number;
  activeLocalDays: number;
  activeWeeks: number;
  observedSpanDays: number;
  windowDays: number;
  windowStartLocalDate: string;
  windowEndLocalDate: string;
  historyLimit: number;
  historyCapReached: boolean;
  support: SupportSummary;
}

export interface ChargeAdvice {
  timeZone: string;
  nowMs: number;
  currentStateNowMs: number;
  reserveFloorPct: number;
  guidance: Guidance;
  evidenceGatePassed: boolean;
  current: CurrentState;
  driveAccounting: RowAccounting<DriveRowCategory>;
  chargingAccounting: RowAccounting<ChargingRowCategory>;
  evidence: EvidenceSummary;
  chargingEvidence: EvidenceSummary;
  weekdayProfiles: WeekdayProfile[];
  dailyTrend: DailyDrop[];
  burnDistribution: Distribution;
  scenarios: ScenarioSet;
  reserveSensitivity: ReserveSensitivity[];
  chargingProfile: ChargingProfile;
}

interface NormalizedOptions {
  historyWindowDays: number;
  historyLimit: number;
  fallbackMaxAgeMs: number;
  reserveFloorPct: number;
  reserveSensitivityPcts: number[];
  maxDriveDurationS: number;
  maxSoCDropPct: number;
  minCalendarDays: number;
  minDrivingDays: number;
  minActiveWeeks: number;
  actionableCrossingDays: number;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

interface IncludedDrive {
  date: string;
  weekday: number;
  week: string;
  dropPct: number;
}

interface IncludedCharge {
  startMs: number;
  endMs: number;
  startDate: string;
  endDate: string;
  startWeek: string;
  startWeekday: number;
  startHour: number;
  endWeekday: number;
  endHour: number;
  startSocPct: number;
  endSocPct: number;
  addedPct: number;
  energyWh: number | null;
}

interface Observation {
  source: 'live' | 'drive_end' | 'charge_end';
  observedAtMs: number;
  batteryPct: number;
}

const DAY_MS = 86_400_000;
const MAX_CLOCK_MS = 8_640_000_000_000_000;
const DEFAULT_TIME_ZONE = 'UTC';
const DRIVE_CATEGORIES: DriveRowCategory[] = [
  'included',
  'outside_window',
  'incomplete_live',
  'invalid_timestamp_order',
  'future',
  'invalid_duration',
  'missing_soc',
  'invalid_soc',
  'nonpositive_soc_drop',
  'implausible_soc_drop',
];
const CHARGING_CATEGORIES: ChargingRowCategory[] = [
  'included',
  'outside_window',
  'incomplete_live',
  'invalid_timestamp_order',
  'future',
  'missing_soc',
  'invalid_soc',
  'nonpositive_soc_gain',
];

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeClock(value: unknown, fallback: number): number {
  return finite(value)
    ? Math.min(MAX_CLOCK_MS, Math.max(0, value))
    : fallback;
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return finite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function integerBounded(value: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(bounded(value, fallback, min, max));
}

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Number.isFinite(result) ? result : null;
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function valueAt(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
}

function timestamp(value: unknown): number | null {
  if (finite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validSoc(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 100;
}

function normalizeTimeZone(timeZone: unknown): string {
  const candidate = typeof timeZone === 'string' && timeZone.trim()
    ? timeZone.trim()
    : DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  formatters.set(timeZone, created);
  return created;
}

function localParts(ms: number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const item = parts.find((part) => part.type === type);
    const parsed = item ? Number(item.value) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

function dateKey(parts: LocalParts): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function dateNumber(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function dateFromNumber(value: number): string {
  const date = new Date(value);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(key: string, days: number): string {
  return dateFromNumber(dateNumber(key) + Math.round(days) * DAY_MS);
}

function daysBetween(start: string, end: string): number {
  return Math.max(0, Math.round((dateNumber(end) - dateNumber(start)) / DAY_MS) + 1);
}

function weekdayForDate(key: string): number {
  return new Date(dateNumber(key) + 12 * 60 * 60 * 1000).getUTCDay();
}

function weekKey(key: string): string {
  const weekday = weekdayForDate(key);
  return addDays(key, -((weekday + 6) % 7));
}

function calendarDates(start: string, end: string): string[] {
  const result: string[] = [];
  const count = daysBetween(start, end);
  for (let index = 0; index < count; index += 1) result.push(addDays(start, index));
  return result;
}

function normalizeOptions(options: ChargeAdvisorOptions | undefined): NormalizedOptions {
  const reserveFloorPct = bounded(
    options?.reserveFloorPct,
    RESERVE_FLOOR_PCT,
    0,
    100,
  );
  const configuredSensitivity = Array.isArray(options?.reserveSensitivityPcts)
    ? options.reserveSensitivityPcts
      .filter(finite)
      .map((value) => bounded(value, RESERVE_FLOOR_PCT, 0, 100))
    : [10, 20, 30];
  const reserveSensitivityPcts = [...new Set([...configuredSensitivity, reserveFloorPct])]
    .sort((a, b) => a - b);
  return {
    historyWindowDays: integerBounded(
      options?.historyWindowDays,
      DEFAULT_HISTORY_WINDOW_DAYS,
      1,
      3_650,
    ),
    historyLimit: integerBounded(
      options?.historyLimit,
      DEFAULT_HISTORY_LIMIT,
      1,
      100_000,
    ),
    fallbackMaxAgeMs: bounded(
      options?.fallbackMaxAgeMs,
      DEFAULT_FALLBACK_MAX_AGE_MS,
      0,
      365 * DAY_MS,
    ),
    reserveFloorPct,
    reserveSensitivityPcts,
    maxDriveDurationS: bounded(options?.maxDriveDurationS, 24 * 60 * 60, 1, 7 * DAY_MS / 1_000),
    maxSoCDropPct: bounded(options?.maxSoCDropPct, 50, 0.1, 100),
    minCalendarDays: integerBounded(options?.minCalendarDays, 28, 1, 3_650),
    minDrivingDays: integerBounded(options?.minDrivingDays, 8, 1, 3_650),
    minActiveWeeks: integerBounded(options?.minActiveWeeks, 4, 1, 3_650),
    actionableCrossingDays: integerBounded(options?.actionableCrossingDays, 2, 1, 7),
  };
}

function emptyCategories<Category extends string>(
  categories: readonly Category[],
): Record<Category, number> {
  return Object.fromEntries(categories.map((category) => [category, 0])) as Record<Category, number>;
}

function newAccounting<Category extends string>(
  returnedRows: number,
  limit: number,
  categories: readonly Category[],
): RowAccounting<Category> {
  return {
    returnedRows,
    inWindowRows: 0,
    includedRows: 0,
    historyLimit: limit,
    historyCapReached: returnedRows >= limit,
    categories: emptyCategories(categories),
  };
}

function mark<Category extends string>(
  accounting: RowAccounting<Category>,
  category: Category,
): void {
  accounting.categories[category] += 1;
  if (category === 'included') accounting.includedRows += 1;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const value = sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
  return round(value);
}

function distribution(values: readonly number[]): Distribution {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    return {
      count: 0,
      meanPct: null,
      medianPct: null,
      p75Pct: null,
      p90Pct: null,
      minPct: null,
      maxPct: null,
    };
  }
  const total = finiteValues.reduce((sum, value) => sum + value, 0);
  return {
    count: finiteValues.length,
    meanPct: round(total / finiteValues.length),
    medianPct: percentile(finiteValues, 0.5),
    p75Pct: percentile(finiteValues, 0.75),
    p90Pct: percentile(finiteValues, 0.9),
    minPct: round(Math.min(...finiteValues)),
    maxPct: round(Math.max(...finiteValues)),
  };
}

function observationsForDrive(
  row: Record<string, unknown>,
  nowMs: number,
): Observation | null {
  if (row.live === true) return null;
  const startMs = timestamp(valueAt(row, 'startTs', 'start_ts', 'started_at'));
  const endMs = timestamp(valueAt(row, 'endTs', 'end_ts', 'ended_at', 'endedAt'));
  const endSoc = valueAt(row, 'endBatteryPct', 'end_battery_pct', 'end_soc_pct');
  if (
    startMs == null
    || endMs == null
    || endMs <= startMs
    || endMs > nowMs
    || !validSoc(endSoc)
  ) return null;
  return { source: 'drive_end', observedAtMs: endMs, batteryPct: endSoc };
}

function observationsForCharge(
  row: Record<string, unknown>,
  nowMs: number,
): Observation | null {
  const startMs = timestamp(valueAt(row, 'started_at', 'start_ts', 'startedAt'));
  const endMs = timestamp(valueAt(row, 'ended_at', 'end_ts', 'endedAt'));
  const endSoc = valueAt(row, 'end_soc_pct', 'endSocPct');
  if (
    startMs == null
    || endMs == null
    || endMs <= startMs
    || endMs > nowMs
    || !validSoc(endSoc)
  ) return null;
  return { source: 'charge_end', observedAtMs: endMs, batteryPct: endSoc };
}

function currentObservationsForDrives(
  rows: readonly Drive[],
  nowMs: number,
): Observation[] {
  return rows.flatMap((raw) => {
    const row = record(raw);
    const observation = row == null ? null : observationsForDrive(row, nowMs);
    return observation == null ? [] : [observation];
  });
}

function currentObservationsForCharges(
  rows: readonly ChargingSession[],
  nowMs: number,
): Observation[] {
  return rows.flatMap((raw) => {
    const row = record(raw);
    const observation = row == null ? null : observationsForCharge(row, nowMs);
    return observation == null ? [] : [observation];
  });
}

function analyzeDrives(
  rows: readonly Drive[],
  nowMs: number,
  timeZone: string,
  startDate: string,
  endDate: string,
  options: NormalizedOptions,
): {
  accounting: RowAccounting<DriveRowCategory>;
  included: IncludedDrive[];
  observations: Observation[];
} {
  const accounting = newAccounting(rows.length, options.historyLimit, DRIVE_CATEGORIES);
  const included: IncludedDrive[] = [];
  const observations: Observation[] = [];

  for (const raw of rows) {
    const row = record(raw);
    if (!row) {
      mark(accounting, 'invalid_timestamp_order');
      continue;
    }
    const startValue = valueAt(row, 'startTs', 'start_ts', 'started_at');
    const endValue = valueAt(row, 'endTs', 'end_ts', 'ended_at', 'endedAt');
    const startMs = timestamp(startValue);
    const endMs = timestamp(endValue);
    if (startMs == null) {
      mark(accounting, 'invalid_timestamp_order');
      continue;
    }
    if (endValue != null && endMs == null) {
      mark(accounting, 'invalid_timestamp_order');
      continue;
    }
    if (startMs > nowMs || (endMs != null && endMs > nowMs)) {
      mark(accounting, 'future');
      continue;
    }
    const localDate = dateKey(localParts(startMs, timeZone));
    if (localDate < startDate || localDate > endDate) {
      mark(accounting, 'outside_window');
      continue;
    }
    accounting.inWindowRows += 1;
    if (endValue == null || row.live === true) {
      mark(accounting, 'incomplete_live');
      continue;
    }
    if (endMs == null || endMs <= startMs) {
      mark(accounting, 'invalid_timestamp_order');
      continue;
    }
    const observation = observationsForDrive(row, nowMs);
    if (observation) observations.push(observation);
    const durationS = valueAt(row, 'durationS', 'duration_s');
    if (!finite(durationS) || durationS <= 0 || durationS > options.maxDriveDurationS) {
      mark(accounting, 'invalid_duration');
      continue;
    }
    const startSoc = valueAt(row, 'startBatteryPct', 'start_battery_pct', 'start_soc_pct');
    const endSoc = valueAt(row, 'endBatteryPct', 'end_battery_pct', 'end_soc_pct');
    if (startSoc == null || endSoc == null) {
      mark(accounting, 'missing_soc');
      continue;
    }
    if (!validSoc(startSoc) || !validSoc(endSoc)) {
      mark(accounting, 'invalid_soc');
      continue;
    }
    const dropPct = startSoc - endSoc;
    if (dropPct <= 0) {
      mark(accounting, 'nonpositive_soc_drop');
      continue;
    }
    if (dropPct > options.maxSoCDropPct) {
      mark(accounting, 'implausible_soc_drop');
      continue;
    }
    const weekday = weekdayForDate(localDate);
    included.push({
      date: localDate,
      weekday,
      week: weekKey(localDate),
      dropPct,
    });
    mark(accounting, 'included');
  }
  return { accounting, included, observations };
}

function analyzeCharging(
  rows: readonly ChargingSession[],
  nowMs: number,
  timeZone: string,
  startDate: string,
  endDate: string,
  options: NormalizedOptions,
): {
  accounting: RowAccounting<ChargingRowCategory>;
  included: IncludedCharge[];
  observations: Observation[];
} {
  const accounting = newAccounting(rows.length, options.historyLimit, CHARGING_CATEGORIES);
  const included: IncludedCharge[] = [];
  const observations: Observation[] = [];

  for (const raw of rows) {
    const row = record(raw);
    if (!row) {
      mark(accounting, 'invalid_timestamp_order');
      continue;
    }
    const startValue = valueAt(row, 'started_at', 'start_ts', 'startedAt');
    const endValue = valueAt(row, 'ended_at', 'end_ts', 'endedAt');
    const startMs = timestamp(startValue);
    const endMs = timestamp(endValue);
    if (startMs == null || (endValue != null && endMs == null)) {
      mark(accounting, 'invalid_timestamp_order');
      continue;
    }
    if (startMs > nowMs || (endMs != null && endMs > nowMs)) {
      mark(accounting, 'future');
      continue;
    }
    const startDateLocal = dateKey(localParts(startMs, timeZone));
    if (startDateLocal < startDate || startDateLocal > endDate) {
      mark(accounting, 'outside_window');
      continue;
    }
    accounting.inWindowRows += 1;
    if (endValue == null) {
      mark(accounting, 'incomplete_live');
      continue;
    }
    if (endMs == null || endMs <= startMs) {
      mark(accounting, 'invalid_timestamp_order');
      continue;
    }
    const observation = observationsForCharge(row, nowMs);
    if (observation) observations.push(observation);
    const startSoc = valueAt(row, 'start_soc_pct', 'startSocPct');
    const endSoc = valueAt(row, 'end_soc_pct', 'endSocPct');
    if (startSoc == null || endSoc == null) {
      mark(accounting, 'missing_soc');
      continue;
    }
    if (!validSoc(startSoc) || !validSoc(endSoc)) {
      mark(accounting, 'invalid_soc');
      continue;
    }
    if (endSoc <= startSoc) {
      mark(accounting, 'nonpositive_soc_gain');
      continue;
    }
    const startParts = localParts(startMs, timeZone);
    const endParts = localParts(endMs, timeZone);
    const endDateLocal = dateKey(endParts);
    const energy = valueAt(row, 'total_energy_added_wh', 'totalEnergyAddedWh');
    included.push({
      startMs,
      endMs,
      startDate: startDateLocal,
      endDate: endDateLocal,
      startWeek: weekKey(startDateLocal),
      startWeekday: weekdayForDate(startDateLocal),
      startHour: startParts.hour,
      endWeekday: weekdayForDate(endDateLocal),
      endHour: endParts.hour,
      startSocPct: startSoc,
      endSocPct: endSoc,
      addedPct: endSoc - startSoc,
      energyWh: finite(energy) && energy >= 0 ? energy : null,
    });
    mark(accounting, 'included');
  }
  return { accounting, included, observations };
}

function support(
  includedRows: number,
  activeLocalDays: number,
  activeWeeks: number,
  observedSpanDays: number,
): SupportSummary {
  const score = Math.min(
    1,
    0.35 * Math.min(1, includedRows / 28)
      + 0.35 * Math.min(1, activeLocalDays / 28)
      + 0.2 * Math.min(1, activeWeeks / 4)
      + 0.1 * Math.min(1, observedSpanDays / 28),
  );
  const band: SupportBand = includedRows === 0
    ? 'none'
    : score >= 0.75
      ? 'strong'
      : score >= 0.45
        ? 'moderate'
        : 'thin';
  return {
    score: round(score, 3) ?? 0,
    band,
    includedRows,
    activeLocalDays,
    activeWeeks,
    observedSpanDays,
  };
}

function observedSpan(activeDates: readonly string[]): {
  activeLocalDays: number;
  activeWeeks: number;
  observedSpanDays: number;
  firstDate: string | null;
  lastDate: string | null;
} {
  const dates = [...new Set(activeDates)].sort();
  const weeks = new Set(dates.map(weekKey));
  return {
    activeLocalDays: dates.length,
    activeWeeks: weeks.size,
    observedSpanDays: dates.length > 0 ? daysBetween(dates[0]!, dates[dates.length - 1]!) : 0,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

function makeEvidence(
  accounting: RowAccounting<string>,
  activeDates: readonly string[],
  windowDays: number,
  startDate: string,
  endDate: string,
): EvidenceSummary {
  const span = observedSpan(activeDates);
  return {
    returnedRows: accounting.returnedRows,
    inWindowRows: accounting.inWindowRows,
    includedRows: accounting.includedRows,
    activeLocalDays: span.activeLocalDays,
    activeWeeks: span.activeWeeks,
    observedSpanDays: span.observedSpanDays,
    windowDays,
    windowStartLocalDate: startDate,
    windowEndLocalDate: endDate,
    historyLimit: accounting.historyLimit,
    historyCapReached: accounting.historyCapReached,
    support: support(
      accounting.includedRows,
      span.activeLocalDays,
      span.activeWeeks,
      span.observedSpanDays,
    ),
  };
}

function buildWeekdays(
  startDate: string,
  endDate: string,
  daily: ReadonlyMap<string, { dropPct: number; count: number; week: string }>,
): WeekdayProfile[] {
  const occurrenceCounts = Array.from({ length: 7 }, () => 0);
  const dates = calendarDates(startDate, endDate);
  for (const date of dates) occurrenceCounts[weekdayForDate(date)]! += 1;
  return Array.from({ length: 7 }, (_, weekday) => {
    const calendarDrops = dates
      .filter((date) => weekdayForDate(date) === weekday)
      .map((date) => daily.get(date)?.dropPct ?? 0);
    const activeRows = [...daily.entries()]
      .filter(([date]) => weekdayForDate(date) === weekday)
      .map(([, value]) => value);
    const activeDrops = activeRows.map((row) => row.dropPct);
    const activeWeeks = new Set(activeRows.map((row) => row.week)).size;
    const span = activeRows.length > 0
      ? observedSpan([...daily.keys()].filter((date) => weekdayForDate(date) === weekday))
      : { observedSpanDays: 0 };
    const calendarDistribution = distribution(calendarDrops);
    const activeDistribution = distribution(activeDrops);
    return {
      weekday,
      calendarOccurrences: occurrenceCounts[weekday]!,
      drivingDays: activeRows.length,
      driveDayShare: occurrenceCounts[weekday]! > 0
        ? round(activeRows.length / occurrenceCounts[weekday]!, 3) ?? 0
        : 0,
      meanPct: calendarDistribution.meanPct,
      medianPct: calendarDistribution.medianPct,
      p75Pct: calendarDistribution.p75Pct,
      p90Pct: calendarDistribution.p90Pct,
      activeDayMeanPct: activeDistribution.meanPct,
      activeDayMedianPct: activeDistribution.medianPct,
      activeDayP75Pct: activeDistribution.p75Pct,
      activeDayP90Pct: activeDistribution.p90Pct,
      activeWeeks,
      support: support(activeRows.length, activeRows.length, activeWeeks, span.observedSpanDays),
    };
  });
}

function buildScenarios(
  current: CurrentState,
  profiles: readonly WeekdayProfile[],
  distributionAll: Distribution,
  endDate: string,
  reserveFloorPct: number,
): ScenarioSet {
  const empty: ScenarioSet = {
    horizonDays: 7,
    startsLocalDate: null,
    meanPath: [],
    p75Path: [],
    meanEndSocPct: null,
    p75EndSocPct: null,
    meanDaysToCrossReserve: null,
    p75DaysToCrossReserve: null,
  };
  if (
    current.batteryPct == null
    || distributionAll.count === 0
    || current.batteryPct < 0
    || current.batteryPct > 100
  ) return empty;

  let meanSoc = current.batteryPct;
  let p75Soc = current.batteryPct;
  const meanPath: ScenarioDay[] = [];
  const p75Path: ScenarioDay[] = [];
  const startsLocalDate = addDays(endDate, 1);
  for (let index = 0; index < 7; index += 1) {
    const localDate = addDays(startsLocalDate, index);
    const profile = profiles[weekdayForDate(localDate)]!;
    const meanBase = profile.meanPct ?? distributionAll.meanPct ?? 0;
    const p75Base = profile.p75Pct ?? distributionAll.p75Pct ?? meanBase;
    const meanBurn = Math.max(0, meanBase);
    const p75Burn = Math.max(0, p75Base);
    meanSoc = clampPct(meanSoc - meanBurn);
    p75Soc = clampPct(p75Soc - p75Burn);
    const meanDay = {
      localDate,
      weekday: weekdayForDate(localDate),
      meanBurnPct: round(meanBurn) ?? 0,
      p75BurnPct: round(p75Burn) ?? 0,
      meanEndSocPct: round(meanSoc) ?? 0,
      p75EndSocPct: round(meanSoc) ?? 0,
    };
    const p75Day = {
      ...meanDay,
      p75EndSocPct: round(p75Soc) ?? 0,
    };
    meanPath.push(meanDay);
    p75Path.push(p75Day);
  }
  const crossing = (path: readonly ScenarioDay[], key: 'meanEndSocPct' | 'p75EndSocPct'): number | null => {
    if (current.batteryPct! <= reserveFloorPct) return 0;
    const found = path.findIndex((day) => day[key] <= reserveFloorPct);
    return found >= 0 ? found + 1 : null;
  };
  return {
    horizonDays: 7,
    startsLocalDate,
    meanPath,
    p75Path,
    meanEndSocPct: meanPath[meanPath.length - 1]?.meanEndSocPct ?? null,
    p75EndSocPct: p75Path[p75Path.length - 1]?.p75EndSocPct ?? null,
    meanDaysToCrossReserve: crossing(meanPath, 'meanEndSocPct'),
    p75DaysToCrossReserve: crossing(p75Path, 'p75EndSocPct'),
  };
}

function crossingForFloor(
  currentPct: number | null,
  path: readonly ScenarioDay[],
  floorPct: number,
  key: 'meanEndSocPct' | 'p75EndSocPct',
): number | null {
  if (currentPct == null) return null;
  if (currentPct <= floorPct) return 0;
  const index = path.findIndex((day) => day[key] <= floorPct);
  return index >= 0 ? index + 1 : null;
}

function buildChargingProfile(
  rows: readonly IncludedCharge[],
  latestChargeMs: number | null,
  nowMs: number,
): ChargingProfile {
  const startsByWeekday = Array.from({ length: 7 }, () => 0);
  const startsByHour = Array.from({ length: 24 }, () => 0);
  const endsByWeekday = Array.from({ length: 7 }, () => 0);
  const endsByHour = Array.from({ length: 24 }, () => 0);
  const startSoc = rows.map((row) => row.startSocPct);
  const endSoc = rows.map((row) => row.endSocPct);
  const added = rows.map((row) => row.addedPct).filter((value) => Number.isFinite(value));
  const weeks = new Set<string>();
  let totalEnergy = 0;
  let energyRows = 0;
  for (const row of rows) {
    startsByWeekday[row.startWeekday]! += 1;
    startsByHour[row.startHour]! += 1;
    endsByWeekday[row.endWeekday]! += 1;
    endsByHour[row.endHour]! += 1;
    weeks.add(row.startWeek);
    if (row.energyWh != null) {
      totalEnergy += row.energyWh;
      energyRows += 1;
    }
  }
  const daysSince = latestChargeMs == null
    ? null
    : round(Math.max(0, nowMs - latestChargeMs) / DAY_MS, 1);
  const span = observedSpan(rows.map((row) => row.startDate));
  return {
    sessions: rows.length,
    activeWeeks: weeks.size,
    startsByWeekday,
    startsByHour,
    endsByWeekday,
    endsByHour,
    medianStartSocPct: percentile(startSoc, 0.5),
    medianEndSocPct: percentile(endSoc, 0.5),
    medianAddedPct: percentile(added, 0.5),
    daysSinceLatestCompletedCharge: daysSince,
    totalEnergyAddedWh: energyRows > 0 ? round(totalEnergy) : null,
    energyRows,
    support: support(rows.length, span.activeLocalDays, weeks.size, span.observedSpanDays),
  };
}

function currentState(
  live: ChargeAdvisorLiveSnapshot | null | undefined,
  observations: readonly Observation[],
  nowMs: number,
  fallbackMaxAgeMs: number,
): CurrentState {
  const snapshot = live ?? {
    batteryPct: null,
    observedAtMs: null,
    source: 'unknown' as const,
    retrievalState: 'unavailable' as const,
    connected: null,
    isCharging: null,
    chargeLimitPct: null,
  };
  const liveTimestampValid = snapshot.source === 'live'
    && finite(snapshot.observedAtMs)
    && snapshot.observedAtMs <= nowMs;
  const liveCandidate = liveTimestampValid && validSoc(snapshot.batteryPct)
    ? {
      source: 'live' as const,
      observedAtMs: snapshot.observedAtMs!,
      batteryPct: snapshot.batteryPct!,
    }
    : null;
  const candidates: Observation[] = observations
    .filter((observation) =>
      validSoc(observation.batteryPct)
      && finite(observation.observedAtMs)
      && observation.observedAtMs <= nowMs)
    .map((observation) => ({ ...observation }));
  if (liveCandidate) candidates.push(liveCandidate);
  candidates.sort((a, b) => b.observedAtMs - a.observedAtMs);
  const selected = candidates[0] ?? null;
  const ageMs = selected == null ? null : Math.max(0, nowMs - selected.observedAtMs);
  const freshness: Freshness = selected == null
    ? 'unavailable'
    : ageMs != null && ageMs <= fallbackMaxAgeMs
      ? 'fresh'
      : 'stale';
  const liveFresh = liveTimestampValid
    && nowMs - snapshot.observedAtMs! <= fallbackMaxAgeMs
    && validSoc(snapshot.batteryPct);
  return {
    batteryPct: selected ? clampPct(selected.batteryPct) : null,
    observedAtMs: selected?.observedAtMs ?? null,
    source: selected?.source ?? null,
    ageMs,
    freshness,
    retrievalState: snapshot.retrievalState,
    connected: snapshot.connected,
    isCharging: liveFresh && typeof snapshot.isCharging === 'boolean'
      ? snapshot.isCharging
      : null,
    chargeLimitPct: liveFresh && validSoc(snapshot.chargeLimitPct)
      ? snapshot.chargeLimitPct
      : null,
  };
}

function guidanceFor(
  current: CurrentState,
  evidenceGatePassed: boolean,
  scenarios: ScenarioSet,
  reserveFloorPct: number,
  actionableCrossingDays: number,
): Guidance {
  if (current.isCharging === true) return 'already_charging';
  if (current.freshness === 'unavailable') return 'current_state_unavailable';
  if (current.freshness === 'stale') return 'stale';
  if (!evidenceGatePassed) return 'insufficient_history';
  if (current.batteryPct != null && current.batteryPct <= reserveFloorPct) {
    return 'charge_before_next_use';
  }
  if (
    scenarios.meanDaysToCrossReserve != null
    && scenarios.meanDaysToCrossReserve <= actionableCrossingDays
  ) return 'charge_before_next_use';
  if (
    (scenarios.p75DaysToCrossReserve != null && scenarios.p75DaysToCrossReserve <= actionableCrossingDays)
    || scenarios.meanDaysToCrossReserve != null
    || scenarios.p75DaysToCrossReserve != null
  ) return 'monitor';
  return 'no_immediate_need';
}

function safeRows<T>(rows: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(rows) ? rows : [];
}

/**
 * Computes the Charge Advisor from returned history and a frozen analysis
 * clock. The optional current-state clock may advance independently so a
 * later live snapshot can be validated without moving calendar windows.
 * Inputs are read only; all maps, arrays, and sorted distributions are newly
 * allocated.
 */
export function computeChargeAdvice(
  drives: readonly Drive[] | null | undefined,
  chargingSessions: readonly ChargingSession[] | null | undefined,
  liveSnapshot: ChargeAdvisorLiveSnapshot | null | undefined,
  nowMs: number,
  timeZone: string,
  options?: ChargeAdvisorOptions,
): ChargeAdvice {
  const config = normalizeOptions(options);
  const safeNowMs = sanitizeClock(nowMs, 0);
  const safeCurrentStateNowMs = sanitizeClock(
    options?.currentStateNowMs,
    safeNowMs,
  );
  const resolvedTimeZone = normalizeTimeZone(timeZone);
  const endDate = dateKey(localParts(safeNowMs, resolvedTimeZone));
  const startDate = addDays(endDate, -(config.historyWindowDays - 1));
  const driveResult = analyzeDrives(
    safeRows(drives),
    safeNowMs,
    resolvedTimeZone,
    startDate,
    endDate,
    config,
  );
  const chargeResult = analyzeCharging(
    safeRows(chargingSessions),
    safeNowMs,
    resolvedTimeZone,
    startDate,
    endDate,
    config,
  );

  const dailyMap = new Map<string, { dropPct: number; count: number; week: string }>();
  for (const row of driveResult.included) {
    const current = dailyMap.get(row.date) ?? { dropPct: 0, count: 0, week: row.week };
    current.dropPct += row.dropPct;
    current.count += 1;
    dailyMap.set(row.date, current);
  }
  const dailyTrend: DailyDrop[] = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([localDate, value]) => ({
      localDate,
      weekday: weekdayForDate(localDate),
      driveCount: value.count,
      dropPct: round(value.dropPct) ?? 0,
    }));
  const weekdayProfiles = buildWeekdays(startDate, endDate, dailyMap);
  const dailyDrops = dailyTrend.map((row) => row.dropPct);
  const burnDistribution = distribution(dailyDrops);
  const calendarDrops = calendarDates(startDate, endDate)
    .map((date) => dailyMap.get(date)?.dropPct ?? 0);
  const calendarBurnDistribution = dailyDrops.length > 0
    ? distribution(calendarDrops)
    : distribution([]);
  const driveEvidence = makeEvidence(
    driveResult.accounting as RowAccounting<string>,
    dailyTrend.map((row) => row.localDate),
    config.historyWindowDays,
    startDate,
    endDate,
  );
  const chargingDates = chargeResult.included.map((row) => row.startDate);
  const chargingEvidence = makeEvidence(
    chargeResult.accounting as RowAccounting<string>,
    chargingDates,
    config.historyWindowDays,
    startDate,
    endDate,
  );
  const observations = [
    ...currentObservationsForDrives(safeRows(drives), safeCurrentStateNowMs),
    ...currentObservationsForCharges(safeRows(chargingSessions), safeCurrentStateNowMs),
  ];
  const current = currentState(
    liveSnapshot,
    observations,
    safeCurrentStateNowMs,
    config.fallbackMaxAgeMs,
  );
  const scenarios = buildScenarios(
    current,
    weekdayProfiles,
    calendarBurnDistribution,
    endDate,
    config.reserveFloorPct,
  );
  const reserveSensitivity = config.reserveSensitivityPcts.map((floorPct) => ({
    floorPct: round(floorPct) ?? 0,
    meanDaysToCross: crossingForFloor(current.batteryPct, scenarios.meanPath, floorPct, 'meanEndSocPct'),
    p75DaysToCross: crossingForFloor(current.batteryPct, scenarios.p75Path, floorPct, 'p75EndSocPct'),
  }));
  const evidenceGatePassed =
    driveEvidence.observedSpanDays >= config.minCalendarDays
    && driveEvidence.activeLocalDays >= config.minDrivingDays
    && driveEvidence.activeWeeks >= config.minActiveWeeks;
  const latestChargeMs = chargeResult.included.reduce<number | null>(
    (latest, row) => latest == null || row.endMs > latest ? row.endMs : latest,
    null,
  );
  const chargingProfile = buildChargingProfile(chargeResult.included, latestChargeMs, safeNowMs);

  return {
    timeZone: resolvedTimeZone,
    nowMs: safeNowMs,
    currentStateNowMs: safeCurrentStateNowMs,
    reserveFloorPct: config.reserveFloorPct,
    guidance: guidanceFor(
      current,
      evidenceGatePassed,
      scenarios,
      config.reserveFloorPct,
      config.actionableCrossingDays,
    ),
    evidenceGatePassed,
    current,
    driveAccounting: driveResult.accounting,
    chargingAccounting: chargeResult.accounting,
    evidence: driveEvidence,
    chargingEvidence,
    weekdayProfiles,
    dailyTrend,
    burnDistribution,
    scenarios,
    reserveSensitivity,
    chargingProfile,
  };
}
