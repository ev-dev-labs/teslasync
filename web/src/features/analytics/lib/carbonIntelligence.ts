const HOURS_PER_DAY = 24;
const LEGACY_KWH_TO_WH = 1_000;
const KG_TO_G = 1_000;
const WH_PER_KWH = 1_000;

export const GAS_BASELINE_KG_CO2_PER_KM = 0.192;
export const RECOMMENDATION_WINDOW_HOURS = 3;

const ROUNDING = {
  energyWh: 5,
  massKg: 0.005,
  intensity: 0.05,
  percentage: 0.05,
} as const;

type UnknownRecord = Record<string, unknown>;

export type CarbonAvailability =
  | 'missing'
  | 'invalid'
  | 'empty'
  | 'available';

export type CarbonCurveAvailability =
  | 'missing'
  | 'invalid'
  | 'empty'
  | 'partial'
  | 'complete';

export type CarbonIntensityBand = 'clean' | 'middle' | 'dirty' | 'flat';

export interface CarbonCurveSourceAccounting {
  payloadPresent: boolean;
  returnedRows: number;
  validRows: number;
  validUniqueHours: number;
  invalidHourRows: number;
  invalidIntensityRows: number;
  duplicateHourRows: number;
  missingHours: number[];
  coverageComplete: boolean;
}

export interface CarbonCurveRow {
  hour: number;
  intensityGPerKwh: number;
  rank: number;
  band: CarbonIntensityBand;
}

export interface CarbonCurveStats {
  minGPerKwh: number | null;
  maxGPerKwh: number | null;
  meanGPerKwh: number | null;
  medianGPerKwh: number | null;
  spanGPerKwh: number | null;
  cleanThresholdGPerKwh: number | null;
  dirtyThresholdGPerKwh: number | null;
  greenestHours: number[];
  dirtiestHours: number[];
  cleanHours: number[];
  dirtyHours: number[];
}

export interface CarbonCurveAnalysis {
  availability: CarbonCurveAvailability;
  source: CarbonCurveSourceAccounting;
  rows: CarbonCurveRow[];
  rankedRows: CarbonCurveRow[];
  stats: CarbonCurveStats;
  reported: {
    minGPerKwh: number | null;
    maxGPerKwh: number | null;
    greenestHours: number[];
    dirtiestHours: number[];
  };
}

export interface CarbonMonthlyRow {
  month: string;
  energyWh: number;
  co2Kg: number;
}

export interface CarbonSummarySourceAccounting {
  returnedMonthlyRows: number;
  validMonthlyRows: number;
  invalidMonthlyRows: number;
  duplicateMonthRows: number;
}

export interface CarbonSummaryAnalysis {
  availability: CarbonAvailability;
  totalEnergyWh: number | null;
  totalCo2Kg: number | null;
  gasBaselineCo2Kg: number | null;
  reportedSavedCo2Kg: number | null;
  netAvoidedCo2Kg: number | null;
  netDisposition: 'avoided' | 'excess' | 'balanced' | 'unknown';
  greenScore: number | null;
  sessionsScored: number | null;
  energyWeightedIntensityGPerKwh: number | null;
  inferredGasBaselineDistanceM: number | null;
  monthly: CarbonMonthlyRow[];
  source: CarbonSummarySourceAccounting;
}

export interface CarbonPeriodContext {
  energySharePct: number | null;
  co2SharePct: number | null;
  gasBaselineSharePct: number | null;
  sessionSharePct: number | null;
}

export interface CarbonDateWindow {
  availability: 'valid' | 'invalid';
  startLabel: string;
  endLabel: string;
  startInstant: string;
  endInstantExclusive: string;
  timezone: string;
  calendarDays: number | null;
  instantDurationHours: number | null;
  upperBoundExclusive: true;
}

export interface CarbonRecommendationAnalysis {
  availability: CarbonAvailability;
  scope: 'lifetime';
  currentAvgIntensityGPerKwh: number | null;
  windowStartHour: number | null;
  windowEndHour: number | null;
  windowDurationHours: number | null;
  windowAvgIntensityGPerKwh: number | null;
  reportedPotentialSavingKg: number | null;
  reportedPotentialSavingPct: number | null;
  shiftedEnergyWh: number | null;
  currentScenarioCo2Kg: number | null;
  shiftedScenarioCo2Kg: number | null;
  calculatedPotentialSavingKg: number | null;
  calculatedPotentialSavingPct: number | null;
}

export type ReconciliationStatus =
  | 'balances'
  | 'outside_tolerance'
  | 'unavailable';

export interface CarbonReconciliation {
  id: string;
  status: ReconciliationStatus;
  expected: number | null;
  observed: number | null;
  residual: number | null;
  tolerance: number;
  unit: 'Wh' | 'kg' | 'g/kWh' | '%' | 'hour' | 'hour_set';
  expectedHours?: number[];
  observedHours?: number[];
}

export interface CarbonIntelligenceAnalysis {
  curve: CarbonCurveAnalysis;
  period: CarbonSummaryAnalysis;
  lifetime: CarbonSummaryAnalysis;
  context: CarbonPeriodContext;
  recommendation: CarbonRecommendationAnalysis;
  window: CarbonDateWindow;
  reconciliations: CarbonReconciliation[];
}

export interface CarbonWindowInput {
  startLabel: string;
  endLabel: string;
  startInstant: string;
  endInstantExclusive: string;
  timezone: string;
}

export interface CarbonIntelligenceInput {
  intensity: unknown;
  periodSummary: unknown;
  lifetimeSummary: unknown;
  recommendation: unknown;
  window: CarbonWindowInput;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null && number >= 0 ? number : null;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  const number = finiteNumber(value);
  return number != null && number >= minimum && number <= maximum
    ? number
    : null;
}

function hourNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null
    && Number.isInteger(number)
    && number >= 0
    && number < HOURS_PER_DAY
    ? number
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = nonNegativeNumber(value);
  return number != null && Number.isInteger(number) ? number : null;
}

function sortedUniqueHours(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(hourNumber).filter((hour): hour is number => hour != null))]
    .sort((left, right) => left - right);
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? null;
  const left = sorted[midpoint - 1];
  const right = sorted[midpoint];
  return left != null && right != null ? (left + right) / 2 : null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
}

function deriveCurveStats(
  rows: ReadonlyArray<{ hour: number; intensityGPerKwh: number }>,
): CarbonCurveStats {
  if (rows.length === 0) {
    return {
      minGPerKwh: null,
      maxGPerKwh: null,
      meanGPerKwh: null,
      medianGPerKwh: null,
      spanGPerKwh: null,
      cleanThresholdGPerKwh: null,
      dirtyThresholdGPerKwh: null,
      greenestHours: [],
      dirtiestHours: [],
      cleanHours: [],
      dirtyHours: [],
    };
  }

  const intensities = rows
    .map((row) => row.intensityGPerKwh)
    .sort((left, right) => left - right);
  const minGPerKwh = intensities[0] ?? null;
  const maxGPerKwh = intensities[intensities.length - 1] ?? null;
  if (minGPerKwh == null || maxGPerKwh == null) {
    return deriveCurveStats([]);
  }
  const spanGPerKwh = maxGPerKwh - minGPerKwh;
  const flat = sameNumber(spanGPerKwh, 0);
  const cleanThresholdGPerKwh = flat
    ? minGPerKwh
    : minGPerKwh + spanGPerKwh / 3;
  const dirtyThresholdGPerKwh = flat
    ? maxGPerKwh
    : maxGPerKwh - spanGPerKwh / 3;

  return {
    minGPerKwh,
    maxGPerKwh,
    meanGPerKwh: mean(intensities),
    medianGPerKwh: median(intensities),
    spanGPerKwh,
    cleanThresholdGPerKwh,
    dirtyThresholdGPerKwh,
    greenestHours: rows
      .filter((row) => sameNumber(row.intensityGPerKwh, minGPerKwh))
      .map((row) => row.hour)
      .sort((left, right) => left - right),
    dirtiestHours: rows
      .filter((row) => sameNumber(row.intensityGPerKwh, maxGPerKwh))
      .map((row) => row.hour)
      .sort((left, right) => left - right),
    cleanHours: flat
      ? []
      : rows
        .filter((row) => row.intensityGPerKwh <= cleanThresholdGPerKwh)
        .map((row) => row.hour)
        .sort((left, right) => left - right),
    dirtyHours: flat
      ? []
      : rows
        .filter((row) => row.intensityGPerKwh >= dirtyThresholdGPerKwh)
        .map((row) => row.hour)
        .sort((left, right) => left - right),
  };
}

export function analyzeCarbonCurve(input: unknown): CarbonCurveAnalysis {
  const record = isRecord(input) ? input : null;
  const curveValue = record?.curve;
  const payloadPresent = record != null && Array.isArray(curveValue);
  const returned = Array.isArray(curveValue) ? curveValue : [];
  const byHour = new Map<number, number>();
  let validRows = 0;
  let invalidHourRows = 0;
  let invalidIntensityRows = 0;
  let duplicateHourRows = 0;

  for (const candidate of returned) {
    const row = isRecord(candidate) ? candidate : null;
    const hour = hourNumber(row?.hour_of_day);
    const intensity = nonNegativeNumber(row?.g_co2_per_kwh);
    if (hour == null) invalidHourRows += 1;
    if (intensity == null) invalidIntensityRows += 1;
    if (hour == null || intensity == null) continue;
    validRows += 1;
    if (byHour.has(hour)) {
      duplicateHourRows += 1;
      continue;
    }
    byHour.set(hour, intensity);
  }

  const baseRows = [...byHour.entries()]
    .map(([hour, intensityGPerKwh]) => ({ hour, intensityGPerKwh }))
    .sort((left, right) => left.hour - right.hour);
  const stats = deriveCurveStats(baseRows);
  const rankedBase = [...baseRows].sort(
    (left, right) =>
      left.intensityGPerKwh - right.intensityGPerKwh
      || left.hour - right.hour,
  );
  let priorIntensity: number | null = null;
  let priorRank = 0;
  const ranks = new Map<number, number>();
  rankedBase.forEach((row, index) => {
    const rank = priorIntensity != null
      && sameNumber(priorIntensity, row.intensityGPerKwh)
      ? priorRank
      : index + 1;
    ranks.set(row.hour, rank);
    priorIntensity = row.intensityGPerKwh;
    priorRank = rank;
  });
  const flat = stats.spanGPerKwh != null && sameNumber(stats.spanGPerKwh, 0);
  const withMetadata = (row: { hour: number; intensityGPerKwh: number }): CarbonCurveRow => {
    let band: CarbonIntensityBand = 'middle';
    if (flat) {
      band = 'flat';
    } else if (
      stats.cleanThresholdGPerKwh != null
      && row.intensityGPerKwh <= stats.cleanThresholdGPerKwh
    ) {
      band = 'clean';
    } else if (
      stats.dirtyThresholdGPerKwh != null
      && row.intensityGPerKwh >= stats.dirtyThresholdGPerKwh
    ) {
      band = 'dirty';
    }
    return {
      ...row,
      rank: ranks.get(row.hour) ?? 0,
      band,
    };
  };
  const rows = baseRows.map(withMetadata);
  const rankedRows = rankedBase.map(withMetadata);
  const missingHours = Array.from(
    { length: HOURS_PER_DAY },
    (_, hour) => hour,
  ).filter((hour) => !byHour.has(hour));
  const coverageComplete =
    returned.length === HOURS_PER_DAY
    && byHour.size === HOURS_PER_DAY
    && invalidHourRows === 0
    && invalidIntensityRows === 0
    && duplicateHourRows === 0;
  const invalidRows = invalidHourRows > 0 || invalidIntensityRows > 0;
  const availability: CarbonCurveAvailability = !payloadPresent
    ? 'missing'
    : returned.length === 0
      ? 'empty'
      : rows.length === 0 && invalidRows
        ? 'invalid'
        : coverageComplete
          ? 'complete'
          : 'partial';

  return {
    availability,
    source: {
      payloadPresent,
      returnedRows: returned.length,
      validRows,
      validUniqueHours: byHour.size,
      invalidHourRows,
      invalidIntensityRows,
      duplicateHourRows,
      missingHours,
      coverageComplete,
    },
    rows,
    rankedRows,
    stats,
    reported: {
      minGPerKwh: nonNegativeNumber(record?.min),
      maxGPerKwh: nonNegativeNumber(record?.max),
      greenestHours: sortedUniqueHours(record?.greenest_hours),
      dirtiestHours: sortedUniqueHours(record?.dirtiest_hours),
    },
  };
}

function legacyKwhToCanonicalWh(value: unknown): number | null {
  const kwh = nonNegativeNumber(value);
  return kwh == null ? null : kwh * LEGACY_KWH_TO_WH;
}

function validMonth(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return null;
  }
  return value;
}

function normalizeMonthly(input: unknown): {
  rows: CarbonMonthlyRow[];
  source: CarbonSummarySourceAccounting;
  arrayValid: boolean;
} {
  const returned = Array.isArray(input) ? input : [];
  const rows: CarbonMonthlyRow[] = [];
  const seenMonths = new Set<string>();
  let invalidMonthlyRows = 0;
  let duplicateMonthRows = 0;

  for (const candidate of returned) {
    const record = isRecord(candidate) ? candidate : null;
    const month = validMonth(record?.month);
    const energyWh = legacyKwhToCanonicalWh(record?.energy_kwh);
    const co2Kg = nonNegativeNumber(record?.co2_kg);
    if (month == null || energyWh == null || co2Kg == null) {
      invalidMonthlyRows += 1;
      continue;
    }
    if (seenMonths.has(month)) duplicateMonthRows += 1;
    seenMonths.add(month);
    rows.push({ month, energyWh, co2Kg });
  }

  return {
    rows: [...rows].sort((left, right) => left.month.localeCompare(right.month)),
    source: {
      returnedMonthlyRows: returned.length,
      validMonthlyRows: rows.length,
      invalidMonthlyRows,
      duplicateMonthRows,
    },
    arrayValid: Array.isArray(input),
  };
}

export function analyzeCarbonSummary(input: unknown): CarbonSummaryAnalysis {
  const record = isRecord(input) ? input : null;
  const totalEnergyWh = legacyKwhToCanonicalWh(record?.total_energy_kwh);
  const totalCo2Kg = nonNegativeNumber(record?.total_co2_kg);
  const gasBaselineCo2Kg = nonNegativeNumber(record?.gas_equiv_co2_kg);
  const reportedSavedCo2Kg = finiteNumber(record?.co2_saved_kg);
  const greenScore = boundedNumber(record?.green_score, 0, 100);
  const sessionsScored = nonNegativeInteger(record?.sessions_scored);
  const monthly = normalizeMonthly(record?.monthly);
  const requiredValid =
    totalEnergyWh != null
    && totalCo2Kg != null
    && gasBaselineCo2Kg != null
    && reportedSavedCo2Kg != null
    && greenScore != null
    && sessionsScored != null
    && monthly.arrayValid;
  const empty =
    totalEnergyWh === 0
    && totalCo2Kg === 0
    && gasBaselineCo2Kg === 0
    && reportedSavedCo2Kg === 0
    && sessionsScored === 0
    && monthly.rows.length === 0;
  const availability: CarbonAvailability = record == null
    ? 'missing'
    : !requiredValid
      || monthly.source.invalidMonthlyRows > 0
      || monthly.source.duplicateMonthRows > 0
      ? 'invalid'
      : empty
        ? 'empty'
        : 'available';
  const netAvoidedCo2Kg =
    gasBaselineCo2Kg != null && totalCo2Kg != null
      ? gasBaselineCo2Kg - totalCo2Kg
      : null;
  const savingsTolerance = ROUNDING.massKg * 3;
  const netDisposition = netAvoidedCo2Kg == null
    ? 'unknown'
    : netAvoidedCo2Kg > savingsTolerance
      ? 'avoided'
      : netAvoidedCo2Kg < -savingsTolerance
        ? 'excess'
        : 'balanced';
  const energyWeightedIntensityGPerKwh =
    totalEnergyWh != null && totalEnergyWh > 0 && totalCo2Kg != null
      ? totalCo2Kg * KG_TO_G * WH_PER_KWH / totalEnergyWh
      : null;

  return {
    availability,
    totalEnergyWh,
    totalCo2Kg,
    gasBaselineCo2Kg,
    reportedSavedCo2Kg,
    netAvoidedCo2Kg,
    netDisposition,
    greenScore,
    sessionsScored,
    energyWeightedIntensityGPerKwh,
    inferredGasBaselineDistanceM:
      gasBaselineCo2Kg != null
        ? gasBaselineCo2Kg / GAS_BASELINE_KG_CO2_PER_KM * 1_000
        : null,
    monthly: monthly.rows,
    source: monthly.source,
  };
}

function percentageShare(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return numerator / denominator * 100;
}

export function derivePeriodContext(
  period: CarbonSummaryAnalysis,
  lifetime: CarbonSummaryAnalysis,
): CarbonPeriodContext {
  return {
    energySharePct: percentageShare(period.totalEnergyWh, lifetime.totalEnergyWh),
    co2SharePct: percentageShare(period.totalCo2Kg, lifetime.totalCo2Kg),
    gasBaselineSharePct: percentageShare(
      period.gasBaselineCo2Kg,
      lifetime.gasBaselineCo2Kg,
    ),
    sessionSharePct: percentageShare(
      period.sessionsScored,
      lifetime.sessionsScored,
    ),
  };
}

function calendarDateMilliseconds(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString().slice(0, 10) === value
    ? milliseconds
    : null;
}

function validTimezone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function analyzeDateWindow(input: CarbonWindowInput): CarbonDateWindow {
  const startDateMs = calendarDateMilliseconds(input.startLabel);
  const endDateMs = calendarDateMilliseconds(input.endLabel);
  const startInstantMs = Date.parse(input.startInstant);
  const endInstantMs = Date.parse(input.endInstantExclusive);
  const instantsValid =
    Number.isFinite(startInstantMs)
    && Number.isFinite(endInstantMs)
    && endInstantMs > startInstantMs;
  const labelsValid =
    startDateMs != null
    && endDateMs != null
    && endDateMs >= startDateMs;
  const timezoneValid = validTimezone(input.timezone);
  const valid = labelsValid && instantsValid && timezoneValid;

  return {
    availability: valid ? 'valid' : 'invalid',
    startLabel: input.startLabel,
    endLabel: input.endLabel,
    startInstant: input.startInstant,
    endInstantExclusive: input.endInstantExclusive,
    timezone: input.timezone,
    calendarDays:
      labelsValid && startDateMs != null && endDateMs != null
        ? Math.floor((endDateMs - startDateMs) / 86_400_000) + 1
        : null,
    instantDurationHours:
      instantsValid ? (endInstantMs - startInstantMs) / 3_600_000 : null,
    upperBoundExclusive: true,
  };
}

export function analyzeRecommendation(
  input: unknown,
  lifetime: CarbonSummaryAnalysis,
): CarbonRecommendationAnalysis {
  const record = isRecord(input) ? input : null;
  const window = isRecord(record?.greenest_window)
    ? record.greenest_window
    : null;
  const currentAvgIntensityGPerKwh = nonNegativeNumber(
    record?.current_avg_intensity,
  );
  const windowStartHour = hourNumber(window?.start_hour);
  const windowEndHour = hourNumber(window?.end_hour);
  const windowAvgIntensityGPerKwh = nonNegativeNumber(window?.avg_intensity);
  const reportedPotentialSavingKg = nonNegativeNumber(
    record?.potential_co2_saving_kg,
  );
  const reportedPotentialSavingPct = boundedNumber(
    record?.potential_saving_pct,
    0,
    100,
  );
  const windowDurationHours =
    windowStartHour != null && windowEndHour != null
      ? (windowEndHour - windowStartHour + HOURS_PER_DAY) % HOURS_PER_DAY
      : null;
  const requiredValid =
    currentAvgIntensityGPerKwh != null
    && windowStartHour != null
    && windowEndHour != null
    && windowAvgIntensityGPerKwh != null
    && reportedPotentialSavingKg != null
    && reportedPotentialSavingPct != null
    && windowDurationHours === RECOMMENDATION_WINDOW_HOURS;
  const shiftedEnergyWh = lifetime.totalEnergyWh;
  const currentScenarioCo2Kg =
    shiftedEnergyWh != null && currentAvgIntensityGPerKwh != null
      ? shiftedEnergyWh * currentAvgIntensityGPerKwh / 1_000_000
      : null;
  const shiftedScenarioCo2Kg =
    shiftedEnergyWh != null && windowAvgIntensityGPerKwh != null
      ? shiftedEnergyWh * windowAvgIntensityGPerKwh / 1_000_000
      : null;
  const calculatedPotentialSavingKg =
    currentScenarioCo2Kg != null && shiftedScenarioCo2Kg != null
      ? Math.max(0, currentScenarioCo2Kg - shiftedScenarioCo2Kg)
      : null;
  const calculatedPotentialSavingPct =
    currentAvgIntensityGPerKwh != null
    && currentAvgIntensityGPerKwh > 0
    && windowAvgIntensityGPerKwh != null
      ? Math.max(
        0,
        (currentAvgIntensityGPerKwh - windowAvgIntensityGPerKwh)
          / currentAvgIntensityGPerKwh
          * 100,
      )
      : null;
  const empty =
    lifetime.totalEnergyWh === 0
    && currentAvgIntensityGPerKwh === 0
    && reportedPotentialSavingKg === 0;

  return {
    availability: record == null
      ? 'missing'
      : !requiredValid
        ? 'invalid'
        : empty
          ? 'empty'
          : 'available',
    scope: 'lifetime',
    currentAvgIntensityGPerKwh,
    windowStartHour,
    windowEndHour,
    windowDurationHours,
    windowAvgIntensityGPerKwh,
    reportedPotentialSavingKg,
    reportedPotentialSavingPct,
    shiftedEnergyWh,
    currentScenarioCo2Kg,
    shiftedScenarioCo2Kg,
    calculatedPotentialSavingKg,
    calculatedPotentialSavingPct,
  };
}

function reconciliation(
  id: string,
  expected: number | null,
  observed: number | null,
  tolerance: number,
  unit: CarbonReconciliation['unit'],
): CarbonReconciliation {
  const residual =
    expected != null && observed != null ? observed - expected : null;
  return {
    id,
    status: residual == null
      ? 'unavailable'
      : Math.abs(residual) <= tolerance
        ? 'balances'
        : 'outside_tolerance',
    expected,
    observed,
    residual,
    tolerance,
    unit,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sameHours(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length
    && left.every((hour, index) => hour === right[index]);
}

function hourSetReconciliation(
  id: string,
  expectedHours: readonly number[],
  observedHours: readonly number[],
): CarbonReconciliation {
  const available = expectedHours.length > 0;
  return {
    id,
    status: !available
      ? 'unavailable'
      : sameHours(expectedHours, observedHours)
        ? 'balances'
        : 'outside_tolerance',
    expected: null,
    observed: null,
    residual: null,
    tolerance: 0,
    unit: 'hour_set',
    expectedHours: [...expectedHours],
    observedHours: [...observedHours],
  };
}

function bestWindow(
  curve: CarbonCurveAnalysis,
): { start: number; end: number; average: number } | null {
  if (!curve.source.coverageComplete) return null;
  const lookup = new Map(
    curve.rows.map((row) => [row.hour, row.intensityGPerKwh] as const),
  );
  let best: { start: number; end: number; average: number } | null = null;
  for (let start = 0; start < HOURS_PER_DAY; start += 1) {
    const values = Array.from(
      { length: RECOMMENDATION_WINDOW_HOURS },
      (_, offset) => lookup.get((start + offset) % HOURS_PER_DAY),
    );
    if (values.some((value) => value == null)) continue;
    const average = sum(values as number[]) / RECOMMENDATION_WINDOW_HOURS;
    if (best == null || average < best.average) {
      best = {
        start,
        end: (start + RECOMMENDATION_WINDOW_HOURS) % HOURS_PER_DAY,
        average,
      };
    }
  }
  return best;
}

function summaryReconciliations(
  prefix: 'period' | 'lifetime',
  summary: CarbonSummaryAnalysis,
): CarbonReconciliation[] {
  const rowToleranceMultiplier = summary.monthly.length + 1;
  return [
    reconciliation(
      `${prefix}.monthly_energy`,
      summary.totalEnergyWh,
      summary.monthly.length > 0
        ? sum(summary.monthly.map((row) => row.energyWh))
        : summary.totalEnergyWh === 0 ? 0 : null,
      ROUNDING.energyWh * rowToleranceMultiplier,
      'Wh',
    ),
    reconciliation(
      `${prefix}.monthly_co2`,
      summary.totalCo2Kg,
      summary.monthly.length > 0
        ? sum(summary.monthly.map((row) => row.co2Kg))
        : summary.totalCo2Kg === 0 ? 0 : null,
      ROUNDING.massKg * rowToleranceMultiplier,
      'kg',
    ),
    reconciliation(
      `${prefix}.gas_less_charging`,
      summary.netAvoidedCo2Kg,
      summary.reportedSavedCo2Kg,
      ROUNDING.massKg * 3,
      'kg',
    ),
  ];
}

function recommendationReconciliations(
  curve: CarbonCurveAnalysis,
  lifetime: CarbonSummaryAnalysis,
  recommendation: CarbonRecommendationAnalysis,
): CarbonReconciliation[] {
  const energyWh = lifetime.totalEnergyWh;
  const delta =
    recommendation.currentAvgIntensityGPerKwh != null
    && recommendation.windowAvgIntensityGPerKwh != null
      ? Math.max(
        0,
        recommendation.currentAvgIntensityGPerKwh
          - recommendation.windowAvgIntensityGPerKwh,
      )
      : null;
  const savingTolerance =
    energyWh != null && delta != null
      ? ROUNDING.massKg
        + ROUNDING.energyWh * delta / 1_000_000
        + (energyWh + ROUNDING.energyWh)
          * (ROUNDING.intensity * 2)
          / 1_000_000
      : ROUNDING.massKg;
  const intensityTolerance =
    energyWh != null
    && energyWh > ROUNDING.energyWh
    && lifetime.totalCo2Kg != null
      ? ROUNDING.intensity
        + lifetime.totalCo2Kg * 1_000_000 * ROUNDING.energyWh
          / ((energyWh - ROUNDING.energyWh) * energyWh)
        + ROUNDING.massKg * 1_000_000 / (energyWh - ROUNDING.energyWh)
      : ROUNDING.intensity;
  const best = bestWindow(curve);
  const windowMatches =
    best != null
    && recommendation.windowStartHour != null
    && recommendation.windowEndHour != null
      ? best.start === recommendation.windowStartHour
        && best.end === recommendation.windowEndHour
      : null;

  return [
    reconciliation(
      'recommendation.current_intensity',
      lifetime.energyWeightedIntensityGPerKwh,
      recommendation.currentAvgIntensityGPerKwh,
      intensityTolerance,
      'g/kWh',
    ),
    reconciliation(
      'recommendation.window_start',
      best?.start ?? null,
      recommendation.windowStartHour,
      0,
      'hour',
    ),
    reconciliation(
      'recommendation.window_end',
      best?.end ?? null,
      recommendation.windowEndHour,
      0,
      'hour',
    ),
    reconciliation(
      'recommendation.window_average',
      windowMatches ? best?.average ?? null : null,
      recommendation.windowAvgIntensityGPerKwh,
      ROUNDING.intensity * 2,
      'g/kWh',
    ),
    reconciliation(
      'recommendation.saving_mass',
      recommendation.calculatedPotentialSavingKg,
      recommendation.reportedPotentialSavingKg,
      savingTolerance,
      'kg',
    ),
    reconciliation(
      'recommendation.saving_percentage',
      recommendation.calculatedPotentialSavingPct,
      recommendation.reportedPotentialSavingPct,
      ROUNDING.percentage * 3,
      '%',
    ),
  ];
}

function curveReconciliations(
  curve: CarbonCurveAnalysis,
): CarbonReconciliation[] {
  return [
    reconciliation(
      'curve.minimum',
      curve.stats.minGPerKwh,
      curve.reported.minGPerKwh,
      ROUNDING.intensity,
      'g/kWh',
    ),
    reconciliation(
      'curve.maximum',
      curve.stats.maxGPerKwh,
      curve.reported.maxGPerKwh,
      ROUNDING.intensity,
      'g/kWh',
    ),
    hourSetReconciliation(
      'curve.greenest_hours',
      curve.stats.greenestHours,
      curve.reported.greenestHours,
    ),
    hourSetReconciliation(
      'curve.dirtiest_hours',
      curve.stats.dirtiestHours,
      curve.reported.dirtiestHours,
    ),
  ];
}

export function buildCarbonIntelligence(
  input: CarbonIntelligenceInput,
): CarbonIntelligenceAnalysis {
  const curve = analyzeCarbonCurve(input.intensity);
  const period = analyzeCarbonSummary(input.periodSummary);
  const lifetime = analyzeCarbonSummary(input.lifetimeSummary);
  const recommendation = analyzeRecommendation(input.recommendation, lifetime);
  return {
    curve,
    period,
    lifetime,
    context: derivePeriodContext(period, lifetime),
    recommendation,
    window: analyzeDateWindow(input.window),
    reconciliations: [
      ...curveReconciliations(curve),
      ...summaryReconciliations('period', period),
      ...summaryReconciliations('lifetime', lifetime),
      ...recommendationReconciliations(curve, lifetime, recommendation),
    ],
  };
}
