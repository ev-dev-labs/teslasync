/**
 * Seasonal efficiency normalization using distance-weighted harmonic ridge.
 *
 * The response remains SI throughout: distance is metres, energy is Wh, and
 * efficiency is Wh/km. The model contains annual and semiannual sin/cos terms
 * plus a linear time trend. It intentionally does not attribute seasonality
 * to temperature, firmware, tyres, route mix, or driving behavior.
 */
import type { Drive } from '@/types/driving';

const DAY_MS = 86_400_000;
const YEAR_MS = 365.2425 * DAY_MS;
const DAYS_PER_HARMONIC_YEAR = 365.2425;
const FEATURES = 6;

export interface SeasonalEfficiencyOptions {
  minSamples?: number;
  /** Minimum observed calendar span required before fitting annual terms. */
  minSpanDays?: number;
  minDistanceM?: number;
  minWhPerKm?: number;
  maxWhPerKm?: number;
  ridgeLambda?: number;
}

export interface SeasonalObservation {
  driveId: number;
  timestampMs: number;
  dayOfYear: number;
  distanceM: number;
  actualWhPerKm: number;
  expectedWhPerKm: number | null;
  deseasonalizedWhPerKm: number | null;
  residualWhPerKm: number | null;
}

export interface SeasonalCurvePoint {
  dayOfYear: number;
  expectedWhPerKm: number;
  lowerWhPerKm: number;
  upperWhPerKm: number;
  index: number;
}

export interface MonthlySeasonIndex {
  month: number;
  index: number;
  expectedWhPerKm: number;
}

export interface SeasonalEfficiencyResult {
  sampleCount: number;
  spanDays: number;
  totalDistanceM: number;
  observations: SeasonalObservation[];
  curve: SeasonalCurvePoint[];
  months: MonthlySeasonIndex[];
  actualWhPerKm: number | null;
  expectedWhPerKm: number | null;
  rSquared: number | null;
  trendWhPerKmPerYear: number | null;
  residualBand: { lowerWhPerKm: number; upperWhPerKm: number } | null;
  coefficients: readonly number[] | null;
}

interface ValidObservation {
  driveId: number;
  timestampMs: number;
  dayOfYear: number;
  distanceM: number;
  actualWhPerKm: number;
}

function dayOfYear(timestampMs: number): number {
  const date = new Date(timestampMs);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - yearStart) / DAY_MS) + 1;
}

function design(day: number, timeYears: number): number[] {
  const phase = 2 * Math.PI * (day - 1) / DAYS_PER_HARMONIC_YEAR;
  return [1, Math.sin(phase), Math.cos(phase), Math.sin(2 * phase), Math.cos(2 * phase), timeYears];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index]!, 0);
}

function solve(matrix: number[][], rhs: number[]): number[] | null {
  const augmented = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let column = 0; column < matrix.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < matrix.length; row++) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    for (let cell = column; cell <= matrix.length; cell++) augmented[column]![cell]! /= divisor;
    for (let row = 0; row < matrix.length; row++) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let cell = column; cell <= matrix.length; cell++) {
        augmented[row]![cell]! -= factor * augmented[column]![cell]!;
      }
    }
  }
  return augmented.map((row) => row[matrix.length]!);
}

function weightedQuantile(
  rows: readonly { value: number; weight: number }[],
  probability: number,
): number {
  const sorted = rows
    .filter((row) => Number.isFinite(row.value) && Number.isFinite(row.weight) && row.weight > 0)
    .slice()
    .sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, row) => sum + row.weight, 0);
  if (total === 0) return Number.NaN;
  const target = Math.max(0, Math.min(1, probability)) * total;
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative >= target) return row.value;
  }
  return sorted[sorted.length - 1]!.value;
}

function positive(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : fallback;
}

function emptyResult(valid: readonly ValidObservation[]): SeasonalEfficiencyResult {
  const totalDistanceM = valid.reduce((sum, row) => sum + row.distanceM, 0);
  const actualWhPerKm = totalDistanceM > 0
    ? valid.reduce((sum, row) => sum + row.actualWhPerKm * row.distanceM, 0) / totalDistanceM
    : null;
  return {
    sampleCount: valid.length,
    spanDays: valid.length > 1
      ? (valid[valid.length - 1]!.timestampMs - valid[0]!.timestampMs) / DAY_MS
      : 0,
    totalDistanceM,
    observations: valid.map((row) => ({ ...row, expectedWhPerKm: null, deseasonalizedWhPerKm: null, residualWhPerKm: null })),
    curve: [],
    months: [],
    actualWhPerKm,
    expectedWhPerKm: null,
    rSquared: null,
    trendWhPerKmPerYear: null,
    residualBand: null,
    coefficients: null,
  };
}

export function analyzeSeasonalEfficiency(
  drives: readonly Drive[],
  options: SeasonalEfficiencyOptions = {},
): SeasonalEfficiencyResult {
  const minSamples = Math.max(6, Math.floor(positive(options.minSamples, 8)));
  const minSpanDays = positive(options.minSpanDays, 270);
  const minDistanceM = positive(options.minDistanceM, 1000);
  const minWhPerKm = positive(options.minWhPerKm, 20);
  const maxWhPerKm = positive(options.maxWhPerKm, 1000);
  const ridgeLambda =
    options.ridgeLambda != null && Number.isFinite(options.ridgeLambda) && options.ridgeLambda >= 0
      ? options.ridgeLambda
      : 10;

  const valid = drives.flatMap<ValidObservation>((drive) => {
    const timestampMs = new Date(drive.startTs).getTime();
    if (
      !Number.isFinite(timestampMs) || !Number.isFinite(drive.distanceM)
      || drive.distanceM < minDistanceM || drive.energyUsedWh == null
      || !Number.isFinite(drive.energyUsedWh) || drive.energyUsedWh <= 0
    ) return [];
    const actualWhPerKm = drive.energyUsedWh / (drive.distanceM / 1000);
    if (actualWhPerKm < minWhPerKm || actualWhPerKm > maxWhPerKm) return [];
    return [{ driveId: drive.id, timestampMs, dayOfYear: dayOfYear(timestampMs), distanceM: drive.distanceM, actualWhPerKm }];
  }).sort((a, b) => a.timestampMs - b.timestampMs || a.driveId - b.driveId);

  const spanDays = valid.length > 1
    ? (valid[valid.length - 1]!.timestampMs - valid[0]!.timestampMs) / DAY_MS
    : 0;
  if (valid.length < minSamples || spanDays < minSpanDays) return emptyResult(valid);

  const totalDistanceM = valid.reduce((sum, row) => sum + row.distanceM, 0);
  const centerMs = valid.reduce((sum, row) => sum + row.timestampMs * row.distanceM, 0) / totalDistanceM;
  const normal = Array.from({ length: FEATURES }, () => new Array<number>(FEATURES).fill(0));
  const rhs = new Array<number>(FEATURES).fill(0);
  for (const row of valid) {
    const x = design(row.dayOfYear, (row.timestampMs - centerMs) / YEAR_MS);
    const weight = row.distanceM / 1000;
    for (let i = 0; i < FEATURES; i++) {
      rhs[i]! += weight * x[i]! * row.actualWhPerKm;
      for (let j = 0; j < FEATURES; j++) normal[i]![j]! += weight * x[i]! * x[j]!;
    }
  }
  for (let feature = 1; feature < FEATURES; feature++) normal[feature]![feature]! += ridgeLambda;
  const coefficients = solve(normal, rhs);
  if (!coefficients) return emptyResult(valid);

  const fitted = valid.map((row) => {
    const x = design(row.dayOfYear, (row.timestampMs - centerMs) / YEAR_MS);
    const expectedWhPerKm = dot(x, coefficients);
    const seasonalAtCenter = dot(design(row.dayOfYear, 0), coefficients);
    return {
      ...row,
      expectedWhPerKm,
      deseasonalizedWhPerKm: row.actualWhPerKm - (seasonalAtCenter - coefficients[0]!),
      residualWhPerKm: row.actualWhPerKm - expectedWhPerKm,
    };
  });
  const actualWhPerKm = valid.reduce(
    (sum, row) => sum + row.actualWhPerKm * row.distanceM,
    0,
  ) / totalDistanceM;
  const expectedWhPerKm = fitted.reduce(
    (sum, row) => sum + row.expectedWhPerKm * row.distanceM,
    0,
  ) / totalDistanceM;
  const sse = fitted.reduce(
    (sum, row) => sum + row.distanceM * row.residualWhPerKm ** 2,
    0,
  );
  const sst = valid.reduce(
    (sum, row) => sum + row.distanceM * (row.actualWhPerKm - actualWhPerKm) ** 2,
    0,
  );
  const residualRows = fitted.map((row) => ({ value: row.residualWhPerKm, weight: row.distanceM }));
  const lowerWhPerKm = weightedQuantile(residualRows, 0.1);
  const upperWhPerKm = weightedQuantile(residualRows, 0.9);
  const curve = Array.from({ length: 365 }, (_, index) => {
    const day = index + 1;
    const expected = dot(design(day, 0), coefficients);
    return {
      dayOfYear: day,
      expectedWhPerKm: expected,
      lowerWhPerKm: expected + lowerWhPerKm,
      upperWhPerKm: expected + upperWhPerKm,
      index: coefficients[0] !== 0 ? 100 * expected / coefficients[0]! : 100,
    };
  });
  const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let cursor = 0;
  const months = monthDays.map((days, month) => {
    const points = curve.slice(cursor, cursor + days);
    cursor += days;
    const expected = points.reduce((sum, point) => sum + point.expectedWhPerKm, 0) / points.length;
    return {
      month,
      expectedWhPerKm: expected,
      index: coefficients[0] !== 0 ? 100 * expected / coefficients[0]! : 100,
    };
  });

  return {
    sampleCount: valid.length,
    spanDays,
    totalDistanceM,
    observations: fitted,
    curve,
    months,
    actualWhPerKm,
    expectedWhPerKm,
    rSquared: sst > 0 ? 1 - sse / sst : null,
    trendWhPerKmPerYear: coefficients[5]!,
    residualBand: { lowerWhPerKm, upperWhPerKm },
    coefficients,
  };
}
