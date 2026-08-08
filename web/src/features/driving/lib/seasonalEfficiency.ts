/**
 * Descriptive seasonal efficiency analysis.
 *
 * The model consumes and returns SI-canonical values: metres, seconds, Wh,
 * and Wh/m. Unit conversion belongs at the render boundary. Calendar fields
 * are derived from the vehicle IANA timezone, never from the browser clock.
 */
import type { Drive } from '@/types/driving';

const DAY_MS = 86_400_000;
const YEAR_MS = 365.2425 * DAY_MS;
const DAYS_PER_HARMONIC_YEAR = 365.2425;
const PARAMETER_COUNT = 6;
const DEFAULT_HISTORY_LIMIT = 1_000;
const DEFAULT_MIN_SAMPLES = 24;
const DEFAULT_MIN_SPAN_DAYS = 300;
const DEFAULT_MIN_MONTHS = 9;
const DEFAULT_MIN_DISTANCE_M = 1_000;
const DEFAULT_MIN_INTENSITY = 0.02;
const DEFAULT_MAX_INTENSITY = 1;
const DEFAULT_RIDGE = 1e-6;
const DEFAULT_TIMELINE_POINTS = 240;

export type SeasonalRowCategory =
  | 'included'
  | 'incompleteLive'
  | 'invalidTimestampOrder'
  | 'future'
  | 'invalidDuration'
  | 'invalidDistance'
  | 'missingEnergy'
  | 'invalidEnergy'
  | 'implausibleIntensity';

export type SeasonalFitStatus =
  | 'ready'
  | 'insufficient samples'
  | 'insufficient span'
  | 'insufficient month coverage'
  | 'singular'
  | 'numerical failure';

export interface SeasonalEfficiencyOptions {
  historyLimit?: number;
  minSamples?: number;
  minSpanDays?: number;
  minCalendarMonths?: number;
  minDistanceM?: number;
  minEnergyIntensityWhPerM?: number;
  maxEnergyIntensityWhPerM?: number;
  ridgeLambda?: number;
  maxTimelinePoints?: number;
}

export interface SeasonalObservation {
  driveId: number;
  timestampMs: number;
  localDate: string;
  localYear: number;
  localMonth: number;
  dayOfYear: number;
  activeWeekKey: string;
  activeMonthKey: string;
  distanceM: number;
  energyUsedWh: number;
  actualEnergyIntensityWhPerM: number;
  fittedEnergyIntensityWhPerM: number | null;
  deseasonalizedEnergyIntensityWhPerM: number | null;
  residualWhPerM: number | null;
}

export interface SeasonalCurvePoint {
  dayOfYear: number;
  fittedEnergyIntensityWhPerM: number;
  lowerEnergyIntensityWhPerM: number | null;
  upperEnergyIntensityWhPerM: number | null;
}

export interface SeasonalMonthProfile {
  month: number;
  sampleCount: number;
  activeYears: number;
  distanceM: number;
  observedEnergyIntensityWhPerM: number | null;
  fittedEnergyIntensityWhPerM: number | null;
  deseasonalizedEnergyIntensityWhPerM: number | null;
  seasonalIndex: number | null;
}

export interface SeasonalYearSummary {
  year: number;
  sampleCount: number;
  distanceM: number;
  observedEnergyIntensityWhPerM: number | null;
  fittedEnergyIntensityWhPerM: number | null;
  deseasonalizedEnergyIntensityWhPerM: number | null;
  changeFromPreviousWhPerM: number | null;
}

export interface SeasonalResidualBin {
  key: string;
  lowerWhPerM: number;
  upperWhPerM: number;
  centerWhPerM: number;
  sampleCount: number;
  distanceM: number;
}

export interface SeasonalAccounting {
  returnedRows: number;
  includedRows: number;
  excludedRows: number;
  incompleteRows: number;
  incompleteLiveRows: number;
  invalidTimestampOrderRows: number;
  futureRows: number;
  invalidDurationRows: number;
  invalidDistanceRows: number;
  missingEnergyRows: number;
  invalidEnergyRows: number;
  implausibleIntensityRows: number;
  historyLimit: number;
  historyCapReached: boolean;
  counts: Record<SeasonalRowCategory, number>;
  categoryCounts: Record<SeasonalRowCategory, number>;
}

export interface SeasonalSupport {
  index: number;
  band: 'thin' | 'moderate' | 'strong';
  volumeScore: number;
  calendarMonthScore: number;
  activeWeekScore: number;
  activeYearScore: number;
  sampleParameterScore: number;
}

export interface SeasonalFit {
  status: SeasonalFitStatus;
  reason: string;
  parameterCount: number;
  sampleToParameterRatio: number;
}

export interface SeasonalDiagnostics {
  weightedRmseWhPerM: number | null;
  weightedMaeWhPerM: number | null;
  residualP10WhPerM: number | null;
  residualP50WhPerM: number | null;
  residualP90WhPerM: number | null;
  seasonalPeakWhPerM: number | null;
  seasonalTroughWhPerM: number | null;
  seasonalAmplitudeWhPerM: number | null;
  annualComponentAmplitudeWhPerM: number | null;
  semiannualComponentAmplitudeWhPerM: number | null;
  sampleToParameterRatio: number;
  trendSupport: {
    sampleCount: number;
    spanDays: number;
    calendarMonths: number;
    supportBand: SeasonalSupport['band'];
  };
}

export interface SeasonalEfficiencyResult {
  timeZone: string;
  accounting: SeasonalAccounting;
  sampleCount: number;
  returnedCount: number;
  includedCount: number;
  excludedCount: number;
  spanDays: number;
  firstIncludedTimestampMs: number | null;
  lastIncludedTimestampMs: number | null;
  daysSinceLatestIncluded: number | null;
  totalDistanceM: number;
  totalEnergyWh: number;
  activeLocalDays: number;
  activeLocalWeeks: number;
  activeLocalMonths: number;
  distinctYears: number;
  localMonthCoverage: number;
  observations: SeasonalObservation[];
  timeline: SeasonalObservation[];
  curve: SeasonalCurvePoint[];
  months: SeasonalMonthProfile[];
  years: SeasonalYearSummary[];
  residualHistogram: SeasonalResidualBin[];
  actualEnergyIntensityWhPerM: number | null;
  fittedEnergyIntensityWhPerM: number | null;
  trendWhPerMPerYear: number | null;
  residualBand: { lowerWhPerM: number; upperWhPerM: number } | null;
  rSquaredInSample: number | null;
  weightedRmseWhPerM: number | null;
  weightedMaeWhPerM: number | null;
  residualP10WhPerM: number | null;
  residualP50WhPerM: number | null;
  residualP90WhPerM: number | null;
  seasonalPeakWhPerM: number | null;
  seasonalTroughWhPerM: number | null;
  seasonalAmplitudeWhPerM: number | null;
  annualComponentAmplitudeWhPerM: number | null;
  semiannualComponentAmplitudeWhPerM: number | null;
  coefficients: readonly number[] | null;
  fitStatus: SeasonalFitStatus;
  fitReason: string;
  sampleToParameterRatio: number;
  fit: SeasonalFit;
  diagnostics: SeasonalDiagnostics;
  support: SeasonalSupport;
}

interface LocalParts {
  date: string;
  year: number;
  month: number;
  day: number;
  dayOfYear: number;
  weekKey: string;
  monthKey: string;
}

interface ValidObservation extends LocalParts {
  driveId: number;
  timestampMs: number;
  distanceM: number;
  energyUsedWh: number;
  actualEnergyIntensityWhPerM: number;
}

interface NormalizedOptions {
  historyLimit: number;
  minSamples: number;
  minSpanDays: number;
  minCalendarMonths: number;
  minDistanceM: number;
  minEnergyIntensityWhPerM: number;
  maxEnergyIntensityWhPerM: number;
  ridgeLambda: number;
  maxTimelinePoints: number;
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function finiteInteger(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.floor(value))
    : fallback;
}

function normalizeOptions(options: SeasonalEfficiencyOptions): NormalizedOptions {
  const low = finitePositive(
    options.minEnergyIntensityWhPerM,
    DEFAULT_MIN_INTENSITY,
  );
  const requestedHigh = finitePositive(
    options.maxEnergyIntensityWhPerM,
    DEFAULT_MAX_INTENSITY,
  );
  const high = requestedHigh > low ? requestedHigh : DEFAULT_MAX_INTENSITY;
  return {
    historyLimit: Math.min(
      DEFAULT_HISTORY_LIMIT,
      finiteInteger(options.historyLimit, DEFAULT_HISTORY_LIMIT, 1),
    ),
    // These are hard evidence floors for this six-parameter model. Callers
    // may demand stricter gates, but may never weaken the defaults.
    minSamples: Math.max(
      DEFAULT_MIN_SAMPLES,
      finiteInteger(options.minSamples, DEFAULT_MIN_SAMPLES, PARAMETER_COUNT + 1),
    ),
    minSpanDays: typeof options.minSpanDays === 'number'
      && Number.isFinite(options.minSpanDays)
      && options.minSpanDays >= 0
      ? Math.max(DEFAULT_MIN_SPAN_DAYS, options.minSpanDays)
      : DEFAULT_MIN_SPAN_DAYS,
    minCalendarMonths: Math.min(
      12,
      Math.max(
        DEFAULT_MIN_MONTHS,
        finiteInteger(options.minCalendarMonths, DEFAULT_MIN_MONTHS, 1),
      ),
    ),
    minDistanceM: finitePositive(options.minDistanceM, DEFAULT_MIN_DISTANCE_M),
    minEnergyIntensityWhPerM: low,
    maxEnergyIntensityWhPerM: high,
    ridgeLambda:
      typeof options.ridgeLambda === 'number'
      && Number.isFinite(options.ridgeLambda)
      && options.ridgeLambda >= 0
        ? Math.min(options.ridgeLambda, 1e6)
        : DEFAULT_RIDGE,
    maxTimelinePoints: Math.min(
      1_000,
      finiteInteger(options.maxTimelinePoints, DEFAULT_TIMELINE_POINTS, 2),
    ),
  };
}

/** Returns a valid IANA timezone or UTC without throwing. */
export function normalizeSeasonalTimezone(timeZone: string | null | undefined): string {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
    }).resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function dateParts(timestampMs: number, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(timestampMs));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const year = values.year;
  const month = values.month;
  const day = values.day;
  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const dayIndex = Math.floor(
    (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / DAY_MS,
  );
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysFromMonday = (weekday + 6) % 7;
  const monday = new Date(Date.UTC(year, month - 1, day - daysFromMonday));
  const weekKey = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
  return {
    date,
    year,
    month,
    day,
    dayOfYear: dayIndex + 1,
    weekKey,
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
  };
}

function design(dayOfYear: number, timeYears: number): number[] {
  const phase =
    (2 * Math.PI * (dayOfYear - 1)) / DAYS_PER_HARMONIC_YEAR;
  return [
    1,
    Math.sin(phase),
    Math.cos(phase),
    Math.sin(2 * phase),
    Math.cos(2 * phase),
    timeYears,
  ];
}

function dot(a: readonly number[], b: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    total += a[index]! * b[index]!;
  }
  return total;
}

function solve(matrix: number[][], rhs: number[]): number[] | null {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [...row, rhs[rowIndex]!]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) {
        pivot = row;
      }
    }
    const pivotValue = augmented[pivot]![column]!;
    if (!Number.isFinite(pivotValue) || Math.abs(pivotValue) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    for (let cell = column; cell <= size; cell += 1) {
      augmented[column]![cell] = augmented[column]![cell]! / divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let cell = column; cell <= size; cell += 1) {
        augmented[row]![cell] = augmented[row]![cell]! - factor * augmented[column]![cell]!;
      }
    }
  }
  const result = augmented.map((row) => row[size]!);
  return result.every(Number.isFinite) ? result : null;
}

function weightedAverage(
  rows: readonly { value: number; weight: number }[],
): number | null {
  const valid = rows.filter(
    (row) => Number.isFinite(row.value) && Number.isFinite(row.weight) && row.weight > 0,
  );
  const weight = finiteSum(valid.map((row) => row.weight));
  const numerator = finiteSum(valid.map((row) => row.value * row.weight));
  return weight != null && numerator != null && weight > 0
    ? numerator / weight
    : null;
}

function weightedQuantile(
  rows: readonly { value: number; weight: number }[],
  probability: number,
): number | null {
  const sorted = rows
    .filter(
      (row) => Number.isFinite(row.value) && Number.isFinite(row.weight) && row.weight > 0,
    )
    .slice()
    .sort((a, b) => a.value - b.value);
  const total = finiteSum(sorted.map((row) => row.weight));
  if (total == null || !total) return null;
  const target = Math.max(0, Math.min(1, probability)) * total;
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative >= target) return row.value;
  }
  return sorted[sorted.length - 1]!.value;
}

function finiteSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function emptyCounts(): Record<SeasonalRowCategory, number> {
  return {
    included: 0,
    incompleteLive: 0,
    invalidTimestampOrder: 0,
    future: 0,
    invalidDuration: 0,
    invalidDistance: 0,
    missingEnergy: 0,
    invalidEnergy: 0,
    implausibleIntensity: 0,
  };
}

function makeSupport(
  sampleCount: number,
  monthCount: number,
  weekCount: number,
  yearCount: number,
  sampleToParameterRatio: number,
): SeasonalSupport {
  const score = (value: number) => Math.max(0, Math.min(1, value));
  const support: SeasonalSupport = {
    volumeScore: score(sampleCount / 100),
    calendarMonthScore: score(monthCount / 12),
    activeWeekScore: score(weekCount / 52),
    activeYearScore: score(yearCount / 2),
    sampleParameterScore: score(sampleToParameterRatio / 10),
    index: 0,
    band: 'thin',
  };
  support.index = Math.round(
    100 * (
      support.volumeScore * 0.3
      + support.calendarMonthScore * 0.2
      + support.activeWeekScore * 0.15
      + support.activeYearScore * 0.15
      + support.sampleParameterScore * 0.2
    ),
  );
  support.band = support.index >= 70 ? 'strong' : support.index >= 45 ? 'moderate' : 'thin';
  return support;
}

function emptyFit(status: SeasonalFitStatus, sampleCount: number): SeasonalFit {
  return {
    status,
    reason:
      status === 'ready'
        ? 'ready'
        : status === 'insufficient samples'
          ? 'need more included samples'
          : status === 'insufficient span'
            ? 'need a longer observed span'
            : status === 'insufficient month coverage'
              ? 'need more local calendar months'
              : status === 'singular'
                ? 'distance-weighted normal matrix was singular'
                : 'numerical computation was not finite',
    parameterCount: PARAMETER_COUNT,
    sampleToParameterRatio: sampleCount / PARAMETER_COUNT,
  };
}

function downsample(
  rows: SeasonalObservation[],
  maximum: number,
): SeasonalObservation[] {
  const safeMaximum = Math.max(2, Math.floor(maximum));
  if (rows.length <= safeMaximum) return rows.slice();
  const step = (rows.length - 1) / (safeMaximum - 1);
  return Array.from({ length: safeMaximum }, (_, index) => rows[Math.round(index * step)]!);
}

function observationFromValid(
  row: ValidObservation,
  values: Pick<
    SeasonalObservation,
    | 'fittedEnergyIntensityWhPerM'
    | 'deseasonalizedEnergyIntensityWhPerM'
    | 'residualWhPerM'
  >,
): SeasonalObservation {
  return {
    driveId: row.driveId,
    timestampMs: row.timestampMs,
    localDate: row.date,
    localYear: row.year,
    localMonth: row.month,
    dayOfYear: row.dayOfYear,
    activeWeekKey: row.weekKey,
    activeMonthKey: row.monthKey,
    distanceM: row.distanceM,
    energyUsedWh: row.energyUsedWh,
    actualEnergyIntensityWhPerM: row.actualEnergyIntensityWhPerM,
    ...values,
  };
}

function buildHistogram(
  rows: readonly SeasonalObservation[],
  lower: number | null,
  upper: number | null,
): SeasonalResidualBin[] | null {
  if (!rows.length || lower == null || upper == null) return [];
  const values = rows
    .map((row) => row.residualWhPerM)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (!values.length) return [];
  const minimum = Math.min(...values, lower);
  const maximum = Math.max(...values, upper);
  const width = maximum > minimum ? (maximum - minimum) / 9 : 0.1;
  if (!Number.isFinite(width) || width <= 0) return null;
  const bins = Array.from({ length: 9 }, (_, index) => {
    const binLower = minimum + index * width;
    const binUpper = index === 8 ? maximum : binLower + width;
    const matching = rows.filter((row) => {
      const value = row.residualWhPerM;
      return value != null
        && (index === 8 ? value >= binLower && value <= binUpper : value >= binLower && value < binUpper);
    });
    return {
      key: `residual-${index}`,
      lowerWhPerM: binLower,
      upperWhPerM: binUpper,
      centerWhPerM: binLower / 2 + binUpper / 2,
      sampleCount: matching.length,
      distanceM: finiteSum(matching.map((row) => row.distanceM)) ?? 0,
    };
  });
  return bins.every((bin) =>
    [bin.lowerWhPerM, bin.upperWhPerM, bin.centerWhPerM, bin.distanceM]
      .every(Number.isFinite))
    ? bins
    : null;
}

function blankMonths(): SeasonalMonthProfile[] {
  return Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    sampleCount: 0,
    activeYears: 0,
    distanceM: 0,
    observedEnergyIntensityWhPerM: null,
    fittedEnergyIntensityWhPerM: null,
    deseasonalizedEnergyIntensityWhPerM: null,
    seasonalIndex: null,
  }));
}

function blankResult(
  timeZone: string,
  accounting: SeasonalAccounting,
  valid: readonly ValidObservation[],
  nowMs: number,
  options: NormalizedOptions,
  fitStatus: SeasonalFitStatus,
): SeasonalEfficiencyResult {
  const monthCount = new Set(valid.map((row) => row.month)).size;
  const weekCount = new Set(valid.map((row) => row.weekKey)).size;
  const yearCount = new Set(valid.map((row) => row.year)).size;
  const totalDistanceM = finiteSum(valid.map((row) => row.distanceM)) ?? 0;
  const totalEnergyWh = finiteSum(valid.map((row) => row.energyUsedWh)) ?? 0;
  const actual = weightedAverage(
    valid.map((row) => ({ value: row.actualEnergyIntensityWhPerM, weight: row.distanceM })),
  );
  const first = valid[0]?.timestampMs ?? null;
  const last = valid[valid.length - 1]?.timestampMs ?? null;
  const spanDays = first != null && last != null ? (last - first) / DAY_MS : 0;
  const support = makeSupport(valid.length, monthCount, weekCount, yearCount, valid.length / PARAMETER_COUNT);
  const observations = valid.map((row) =>
    observationFromValid(row, {
      fittedEnergyIntensityWhPerM: null,
      deseasonalizedEnergyIntensityWhPerM: null,
      residualWhPerM: null,
    }));
  const fit = emptyFit(fitStatus, valid.length);
  return {
    timeZone,
    accounting,
    sampleCount: valid.length,
    returnedCount: accounting.returnedRows,
    includedCount: valid.length,
    excludedCount: accounting.excludedRows,
    spanDays,
    firstIncludedTimestampMs: first,
    lastIncludedTimestampMs: last,
    daysSinceLatestIncluded: last == null ? null : Math.max(0, (nowMs - last) / DAY_MS),
    totalDistanceM,
    totalEnergyWh,
    activeLocalDays: new Set(valid.map((row) => row.date)).size,
    activeLocalWeeks: weekCount,
    activeLocalMonths: new Set(valid.map((row) => row.monthKey)).size,
    distinctYears: yearCount,
    localMonthCoverage: monthCount,
    observations,
    timeline: downsample(observations, options.maxTimelinePoints),
    curve: [],
    months: blankMonths(),
    years: [],
    residualHistogram: [],
    actualEnergyIntensityWhPerM: actual,
    fittedEnergyIntensityWhPerM: null,
    trendWhPerMPerYear: null,
    residualBand: null,
    rSquaredInSample: null,
    weightedRmseWhPerM: null,
    weightedMaeWhPerM: null,
    residualP10WhPerM: null,
    residualP50WhPerM: null,
    residualP90WhPerM: null,
    seasonalPeakWhPerM: null,
    seasonalTroughWhPerM: null,
    seasonalAmplitudeWhPerM: null,
    annualComponentAmplitudeWhPerM: null,
    semiannualComponentAmplitudeWhPerM: null,
    coefficients: null,
    fitStatus: fit.status,
    fitReason: fit.reason,
    sampleToParameterRatio: fit.sampleToParameterRatio,
    fit,
    diagnostics: {
      weightedRmseWhPerM: null,
      weightedMaeWhPerM: null,
      residualP10WhPerM: null,
      residualP50WhPerM: null,
      residualP90WhPerM: null,
      seasonalPeakWhPerM: null,
      seasonalTroughWhPerM: null,
      seasonalAmplitudeWhPerM: null,
      annualComponentAmplitudeWhPerM: null,
      semiannualComponentAmplitudeWhPerM: null,
      sampleToParameterRatio: fit.sampleToParameterRatio,
      trendSupport: {
        sampleCount: valid.length,
        spanDays,
        calendarMonths: monthCount,
        supportBand: support.band,
      },
    },
    support,
  };
}

function aggregateProfiles(
  observations: readonly SeasonalObservation[],
  fittedBaseline: number | null,
): SeasonalMonthProfile[] {
  return Array.from({ length: 12 }, (_, index) => {
    const monthRows = observations.filter((row) => row.localMonth === index + 1);
    const observed = weightedAverage(
      monthRows.map((row) => ({ value: row.actualEnergyIntensityWhPerM, weight: row.distanceM })),
    );
    const fitted = weightedAverage(
      monthRows
        .filter((row) => row.fittedEnergyIntensityWhPerM != null)
        .map((row) => ({ value: row.fittedEnergyIntensityWhPerM!, weight: row.distanceM })),
    );
    const deseasonalized = weightedAverage(
      monthRows
        .filter((row) => row.deseasonalizedEnergyIntensityWhPerM != null)
        .map((row) => ({ value: row.deseasonalizedEnergyIntensityWhPerM!, weight: row.distanceM })),
    );
    return {
      month: index + 1,
      sampleCount: monthRows.length,
      activeYears: new Set(monthRows.map((row) => row.localYear)).size,
      distanceM: finiteSum(monthRows.map((row) => row.distanceM)) ?? 0,
      observedEnergyIntensityWhPerM: observed,
      fittedEnergyIntensityWhPerM: fitted,
      deseasonalizedEnergyIntensityWhPerM: deseasonalized,
      seasonalIndex: fittedBaseline && fitted != null && Number.isFinite((100 * fitted) / fittedBaseline)
        ? (100 * fitted) / fittedBaseline
        : null,
    };
  });
}

function aggregateYears(observations: readonly SeasonalObservation[]): SeasonalYearSummary[] {
  const years = [...new Set(observations.map((row) => row.localYear))].sort((a, b) => a - b);
  let previous: number | null = null;
  return years.map((year) => {
    const rows = observations.filter((row) => row.localYear === year);
    const observed = weightedAverage(
      rows.map((row) => ({ value: row.actualEnergyIntensityWhPerM, weight: row.distanceM })),
    );
    const fitted = weightedAverage(
      rows
        .filter((row) => row.fittedEnergyIntensityWhPerM != null)
        .map((row) => ({ value: row.fittedEnergyIntensityWhPerM!, weight: row.distanceM })),
    );
    const deseasonalized = weightedAverage(
      rows
        .filter((row) => row.deseasonalizedEnergyIntensityWhPerM != null)
        .map((row) => ({ value: row.deseasonalizedEnergyIntensityWhPerM!, weight: row.distanceM })),
    );
    const summary = {
      year,
      sampleCount: rows.length,
      distanceM: finiteSum(rows.map((row) => row.distanceM)) ?? 0,
      observedEnergyIntensityWhPerM: observed,
      fittedEnergyIntensityWhPerM: fitted,
      deseasonalizedEnergyIntensityWhPerM: deseasonalized,
      changeFromPreviousWhPerM: observed != null && previous != null ? observed - previous : null,
    };
    if (observed != null) previous = observed;
    return summary;
  });
}

function withFitStatus(
  result: SeasonalEfficiencyResult,
  status: Exclude<SeasonalFitStatus, 'ready' | 'insufficient samples' | 'insufficient span' | 'insufficient month coverage'>,
): SeasonalEfficiencyResult {
  const fit = emptyFit(status, result.sampleCount);
  return {
    ...result,
    coefficients: null,
    fitStatus: fit.status,
    fitReason: fit.reason,
    sampleToParameterRatio: fit.sampleToParameterRatio,
    fit,
    diagnostics: {
      ...result.diagnostics,
      sampleToParameterRatio: fit.sampleToParameterRatio,
    },
  };
}

export function analyzeSeasonalEfficiency(
  drives: readonly Drive[],
  nowMs: number,
  timeZone: string | null | undefined,
  options: SeasonalEfficiencyOptions = {},
): SeasonalEfficiencyResult {
  const normalizedTimeZone = normalizeSeasonalTimezone(timeZone);
  const normalizedOptions = normalizeOptions(options);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : 0;
  const counts = emptyCounts();
  const valid: ValidObservation[] = [];
  // Leave substantial headroom for every aggregate. This rejects finite
  // Number.MAX_VALUE-like row metrics before they can overflow totals or
  // weighted calculations, while remaining far above any realistic drive
  // distance or energy value.
  const safeRowMetricMaximum = Number.MAX_VALUE / Math.max(4, drives.length * 4);

  drives.forEach((drive, sourceIndex) => {
    const isIncomplete =
      drive.live === true
      || drive.endTs == null
      || ['active', 'in_progress', 'in-progress', 'open'].includes(
        String(drive.endedStatus ?? '').toLowerCase(),
      );
    if (isIncomplete) {
      counts.incompleteLive += 1;
      return;
    }
    const startMs = new Date(drive.startTs).getTime();
    const endTs = drive.endTs;
    const endMs = typeof endTs === 'string' ? new Date(endTs).getTime() : Number.NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      counts.invalidTimestampOrder += 1;
      return;
    }
    if (startMs > safeNowMs || endMs > safeNowMs) {
      counts.future += 1;
      return;
    }
    if (!Number.isFinite(drive.durationS) || drive.durationS <= 0) {
      counts.invalidDuration += 1;
      return;
    }
    if (
      !Number.isFinite(drive.distanceM)
      || drive.distanceM < normalizedOptions.minDistanceM
      || drive.distanceM > safeRowMetricMaximum
    ) {
      counts.invalidDistance += 1;
      return;
    }
    if (drive.energyUsedWh == null) {
      counts.missingEnergy += 1;
      return;
    }
    if (
      !Number.isFinite(drive.energyUsedWh)
      || drive.energyUsedWh <= 0
      || drive.energyUsedWh > safeRowMetricMaximum
    ) {
      counts.invalidEnergy += 1;
      return;
    }
    const actualEnergyIntensityWhPerM = drive.energyUsedWh / drive.distanceM;
    if (
      !Number.isFinite(actualEnergyIntensityWhPerM)
      || actualEnergyIntensityWhPerM < normalizedOptions.minEnergyIntensityWhPerM
      || actualEnergyIntensityWhPerM > normalizedOptions.maxEnergyIntensityWhPerM
    ) {
      counts.implausibleIntensity += 1;
      return;
    }
    const local = dateParts(startMs, normalizedTimeZone);
    valid.push({
      ...local,
      driveId: Number.isFinite(drive.id) ? drive.id : sourceIndex,
      timestampMs: startMs,
      distanceM: drive.distanceM,
      energyUsedWh: drive.energyUsedWh,
      actualEnergyIntensityWhPerM,
    });
  });

  valid.sort((a, b) => a.timestampMs - b.timestampMs || a.driveId - b.driveId);
  counts.included = valid.length;
  const returnedRows = drives.length;
  const accounting: SeasonalAccounting = {
    returnedRows,
    includedRows: valid.length,
    excludedRows: returnedRows - valid.length,
    incompleteRows: counts.incompleteLive,
    incompleteLiveRows: counts.incompleteLive,
    invalidTimestampOrderRows: counts.invalidTimestampOrder,
    futureRows: counts.future,
    invalidDurationRows: counts.invalidDuration,
    invalidDistanceRows: counts.invalidDistance,
    missingEnergyRows: counts.missingEnergy,
    invalidEnergyRows: counts.invalidEnergy,
    implausibleIntensityRows: counts.implausibleIntensity,
    historyLimit: normalizedOptions.historyLimit,
    historyCapReached: returnedRows >= normalizedOptions.historyLimit,
    counts,
    categoryCounts: counts,
  };
  const monthCount = new Set(valid.map((row) => row.month)).size;
  const spanDays = valid.length > 1
    ? (valid[valid.length - 1]!.timestampMs - valid[0]!.timestampMs) / DAY_MS
    : 0;
  const fitStatus: SeasonalFitStatus =
    valid.length < normalizedOptions.minSamples
      ? 'insufficient samples'
      : spanDays < normalizedOptions.minSpanDays
        ? 'insufficient span'
        : monthCount < normalizedOptions.minCalendarMonths
          ? 'insufficient month coverage'
          : 'ready';
  const base = blankResult(
    normalizedTimeZone,
    accounting,
    valid,
    safeNowMs,
    normalizedOptions,
    fitStatus,
  );
  base.months = aggregateProfiles(base.observations, null);
  base.years = aggregateYears(base.observations);
  if (fitStatus !== 'ready') return base;

  const totalDistanceM = finiteSum(valid.map((row) => row.distanceM));
  const totalEnergyWh = finiteSum(valid.map((row) => row.energyUsedWh));
  if (
    totalDistanceM == null
    || totalEnergyWh == null
    || totalDistanceM <= 0
    || totalEnergyWh <= 0
  ) {
    return withFitStatus(base, 'numerical failure');
  }
  // Calculate the weighted center from a local reference to avoid
  // timestampMs * distanceM overflowing for otherwise finite metrics.
  const centerReferenceMs = valid[0]?.timestampMs ?? 0;
  const weightedCenterYears = finiteSum(
    valid.map((row) =>
      (row.distanceM / totalDistanceM)
      * ((row.timestampMs - centerReferenceMs) / YEAR_MS)),
  );
  if (weightedCenterYears == null) return withFitStatus(base, 'numerical failure');
  const centerMs = centerReferenceMs + weightedCenterYears * YEAR_MS;
  if (!Number.isFinite(centerMs)) return withFitStatus(base, 'numerical failure');
  const normal = Array.from(
    { length: PARAMETER_COUNT },
    () => new Array<number>(PARAMETER_COUNT).fill(0),
  );
  const rhs = new Array<number>(PARAMETER_COUNT).fill(0);
  for (const row of valid) {
    const vector = design(row.dayOfYear, (row.timestampMs - centerMs) / YEAR_MS);
    const weight = row.distanceM / totalDistanceM;
    for (let left = 0; left < PARAMETER_COUNT; left += 1) {
      rhs[left] = rhs[left]! + weight * vector[left]! * row.actualEnergyIntensityWhPerM;
      for (let right = 0; right < PARAMETER_COUNT; right += 1) {
        normal[left]![right] =
          normal[left]![right]! + weight * vector[left]! * vector[right]!;
      }
    }
  }
  if (
    !normal.every((row) => row.every(Number.isFinite))
    || !rhs.every(Number.isFinite)
  ) {
    return withFitStatus(base, 'numerical failure');
  }
  for (let feature = 1; feature < PARAMETER_COUNT; feature += 1) {
    normal[feature]![feature] = normal[feature]![feature]! + normalizedOptions.ridgeLambda;
  }
  if (!normal.every((row) => row.every(Number.isFinite))) {
    return withFitStatus(base, 'numerical failure');
  }
  const coefficients = solve(normal, rhs);
  if (!coefficients) {
    return withFitStatus(base, 'singular');
  }

  const fitted = valid.map<SeasonalObservation>((row) => {
    const trendYears = (row.timestampMs - centerMs) / YEAR_MS;
    const fittedValue = dot(design(row.dayOfYear, trendYears), coefficients);
    const seasonalOnly = dot(design(row.dayOfYear, 0), coefficients) - coefficients[0]!;
    return observationFromValid(row, {
      fittedEnergyIntensityWhPerM: Number.isFinite(fittedValue) ? fittedValue : null,
      deseasonalizedEnergyIntensityWhPerM: Number.isFinite(row.actualEnergyIntensityWhPerM - seasonalOnly)
        ? row.actualEnergyIntensityWhPerM - seasonalOnly
        : null,
      residualWhPerM: Number.isFinite(fittedValue)
        ? row.actualEnergyIntensityWhPerM - fittedValue
        : null,
    });
  });
  if (fitted.some((row) =>
    row.fittedEnergyIntensityWhPerM == null
    || row.deseasonalizedEnergyIntensityWhPerM == null
    || row.residualWhPerM == null
    || !Number.isFinite(row.fittedEnergyIntensityWhPerM)
    || !Number.isFinite(row.deseasonalizedEnergyIntensityWhPerM)
    || !Number.isFinite(row.residualWhPerM))) {
    return withFitStatus(base, 'numerical failure');
  }
  const actual = weightedAverage(
    fitted.map((row) => ({ value: row.actualEnergyIntensityWhPerM, weight: row.distanceM })),
  );
  const fittedAggregate = weightedAverage(
    fitted
      .filter((row) => row.fittedEnergyIntensityWhPerM != null)
      .map((row) => ({ value: row.fittedEnergyIntensityWhPerM!, weight: row.distanceM })),
  );
  const residualRows = fitted
    .filter((row) => row.residualWhPerM != null)
    .map((row) => ({ value: row.residualWhPerM!, weight: row.distanceM }));
  const p10 = weightedQuantile(residualRows, 0.1);
  const p50 = weightedQuantile(residualRows, 0.5);
  const p90 = weightedQuantile(residualRows, 0.9);
  const weightedSse = finiteSum(
    fitted.map((row) => row.distanceM * (row.residualWhPerM ?? 0) ** 2),
  );
  const weightedMae = finiteSum(
    fitted.map((row) => row.distanceM * Math.abs(row.residualWhPerM ?? 0)),
  );
  const sst = actual == null
    ? null
    : finiteSum(
        fitted.map((row) =>
          row.distanceM * (row.actualEnergyIntensityWhPerM - actual) ** 2),
      );
  if (
    actual == null
    || fittedAggregate == null
    || p10 == null
    || p50 == null
    || p90 == null
    || weightedSse == null
    || weightedMae == null
    || sst == null
    || ![actual, fittedAggregate, p10, p50, p90, weightedSse, weightedMae, sst]
      .every(Number.isFinite)
  ) {
    return withFitStatus(base, 'numerical failure');
  }
  const curve = Array.from({ length: 365 }, (_, index) => {
    const day = index + 1;
    const fittedValue = dot(design(day, 0), coefficients);
    return {
      dayOfYear: day,
      fittedEnergyIntensityWhPerM: fittedValue,
      lowerEnergyIntensityWhPerM: p10 == null ? null : fittedValue + p10,
      upperEnergyIntensityWhPerM: p90 == null ? null : fittedValue + p90,
    };
  });
  if (curve.some((point) =>
    !Number.isFinite(point.fittedEnergyIntensityWhPerM)
    || (point.lowerEnergyIntensityWhPerM != null
      && !Number.isFinite(point.lowerEnergyIntensityWhPerM))
    || (point.upperEnergyIntensityWhPerM != null
      && !Number.isFinite(point.upperEnergyIntensityWhPerM)))) {
    return withFitStatus(base, 'numerical failure');
  }
  const peak = Math.max(...curve.map((point) => point.fittedEnergyIntensityWhPerM));
  const trough = Math.min(...curve.map((point) => point.fittedEnergyIntensityWhPerM));
  const weightedRmse = Math.sqrt(weightedSse / totalDistanceM);
  const weightedMeanAbsoluteError = weightedMae / totalDistanceM;
  const rSquared = sst > 1e-15 ? 1 - weightedSse / sst : null;
  const trend = coefficients[5]!;
  const seasonalAmplitude = (peak - trough) / 2;
  const annualAmplitude = Math.hypot(coefficients[1]!, coefficients[2]!);
  const semiannualAmplitude = Math.hypot(coefficients[3]!, coefficients[4]!);
  const residualHistogram = buildHistogram(fitted, p10, p90);
  if (
    ![
      peak,
      trough,
      weightedRmse,
      weightedMeanAbsoluteError,
      trend,
      seasonalAmplitude,
      annualAmplitude,
      semiannualAmplitude,
      ...(rSquared == null ? [] : [rSquared]),
    ].every(Number.isFinite)
    || residualHistogram == null
    || !residualHistogram.every((bin) =>
      [bin.lowerWhPerM, bin.upperWhPerM, bin.centerWhPerM, bin.distanceM]
        .every(Number.isFinite))
  ) {
    return withFitStatus(base, 'numerical failure');
  }
  const sampleToParameterRatio = valid.length / PARAMETER_COUNT;
  const support = makeSupport(
    valid.length,
    monthCount,
    new Set(valid.map((row) => row.weekKey)).size,
    new Set(valid.map((row) => row.year)).size,
    sampleToParameterRatio,
  );
  const result: SeasonalEfficiencyResult = {
    ...base,
    observations: fitted,
    timeline: downsample(fitted, normalizedOptions.maxTimelinePoints),
    curve,
    months: aggregateProfiles(fitted, coefficients[0] ?? null),
    years: aggregateYears(fitted),
    residualHistogram,
    actualEnergyIntensityWhPerM: actual,
    fittedEnergyIntensityWhPerM: fittedAggregate,
    trendWhPerMPerYear: trend,
    residualBand: { lowerWhPerM: p10, upperWhPerM: p90 },
    rSquaredInSample: rSquared,
    weightedRmseWhPerM: weightedRmse,
    weightedMaeWhPerM: weightedMeanAbsoluteError,
    residualP10WhPerM: p10,
    residualP50WhPerM: p50,
    residualP90WhPerM: p90,
    seasonalPeakWhPerM: peak,
    seasonalTroughWhPerM: trough,
    seasonalAmplitudeWhPerM: seasonalAmplitude,
    annualComponentAmplitudeWhPerM: annualAmplitude,
    semiannualComponentAmplitudeWhPerM: semiannualAmplitude,
    coefficients,
    fitStatus: 'ready',
    fitReason: 'ready',
    sampleToParameterRatio,
    fit: {
      status: 'ready',
      reason: 'ready',
      parameterCount: PARAMETER_COUNT,
      sampleToParameterRatio,
    },
    support,
    diagnostics: {
      weightedRmseWhPerM: weightedRmse,
      weightedMaeWhPerM: weightedMeanAbsoluteError,
      residualP10WhPerM: p10,
      residualP50WhPerM: p50,
      residualP90WhPerM: p90,
      seasonalPeakWhPerM: peak,
      seasonalTroughWhPerM: trough,
      seasonalAmplitudeWhPerM: seasonalAmplitude,
      annualComponentAmplitudeWhPerM: annualAmplitude,
      semiannualComponentAmplitudeWhPerM: semiannualAmplitude,
      sampleToParameterRatio,
      trendSupport: {
        sampleCount: valid.length,
        spanDays,
        calendarMonths: monthCount,
        supportBand: support.band,
      },
    },
  };
  return result;
}
