import type {
  BatteryPassport,
  BatteryPassportThermalExposure,
  BatteryPassportTrendPoint,
} from '@/api/hooks/useBatteryPassport';

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365.25;

export const BATTERY_PASSPORT_TREND_MAX_POINTS = 180;
export const BATTERY_PASSPORT_MIN_FIT_POINTS = 12;
export const BATTERY_PASSPORT_MIN_FIT_SPAN_DAYS = 90;

export type BatteryPassportTrendCategory =
  | 'included'
  | 'invalid_date'
  | 'future_date'
  | 'invalid_soh'
  | 'duplicate_date';

export type BatteryPassportFitStatus =
  | 'available'
  | 'insufficient_points'
  | 'insufficient_span';

export type BatteryPassportSupportBand =
  | 'none'
  | 'thin'
  | 'developing'
  | 'broad';

export interface BatteryPassportTrendEvidencePoint {
  date: string;
  dayMs: number;
  sohPct: number;
  sourceIndex: number;
}

export interface BatteryPassportTrendAccounting {
  returnedPoints: number;
  includedPoints: number;
  excludedPoints: number;
  categories: Record<BatteryPassportTrendCategory, number>;
}

export interface BatteryPassportTrendCap {
  backendMaximum: number;
  canonicalPoints: number;
  displayedPoints: number;
  omittedByDisplayCap: number;
  backendCapReached: boolean;
  clientCapApplied: boolean;
}

export interface BatteryPassportLinearFit {
  status: BatteryPassportFitStatus;
  minimumPoints: number;
  minimumSpanDays: number;
  slopePctPointsPerDay: number | null;
  annualizedChangePctPoints: number | null;
  rSquared: number | null;
}

export interface BatteryPassportTrendDiagnostics {
  pointCount: number;
  spanDays: number | null;
  daysSinceLatest: number | null;
  medianCadenceDays: number | null;
  startToEndChangePctPoints: number | null;
  minimumSohPct: number | null;
  maximumSohPct: number | null;
  meanSohPct: number | null;
  p10SohPct: number | null;
  p25SohPct: number | null;
  medianSohPct: number | null;
  p75SohPct: number | null;
  p90SohPct: number | null;
  rangePctPoints: number | null;
  interquartileRangePctPoints: number | null;
  standardDeviationPctPoints: number | null;
  fit: BatteryPassportLinearFit;
}

export interface BatteryPassportDistributionBin {
  key: 'below_60' | '60_70' | '70_80' | '80_90' | '90_100';
  minimum: number;
  maximum: number;
  includesMaximum: boolean;
  count: number;
  share: number | null;
}

export interface BatteryPassportTrendAnalysis {
  points: BatteryPassportTrendEvidencePoint[];
  accounting: BatteryPassportTrendAccounting;
  cap: BatteryPassportTrendCap;
  diagnostics: BatteryPassportTrendDiagnostics;
  distribution: BatteryPassportDistributionBin[];
}

export interface BatteryPassportSanitizedMetrics {
  sohPct: number | null;
  capacityKwh: number | null;
  originalCapacityKwh: number | null;
  capacityRatio: number | null;
  equivalentFullCycles: number | null;
  fastChargeRatio: number | null;
  avgChargeLimitPct: number | null;
  reportedGrade: string | null;
  invalidNumericFieldCount: number;
}

export interface BatteryPassportGradeReconstruction {
  status: 'available' | 'unavailable';
  unavailableReason: 'unknown_soh' | 'invalid_inputs' | null;
  score: number | null;
  grade: string | null;
  reportedGrade: string | null;
  matchesReported: boolean | null;
  clampedSohPct: number | null;
  clampedFastChargeRatio: number | null;
  clampedEquivalentFullCycles: number | null;
  fastChargePenalty: number | null;
  cyclePenalty: number | null;
  inputsClamped: boolean;
}

export interface BatteryPassportThermalBand {
  key: 'cold' | 'nominal' | 'hot';
  valuePct: number | null;
}

export interface BatteryPassportThermalAnalysis {
  status: 'available' | 'no_data' | 'invalid';
  bands: BatteryPassportThermalBand[];
  validBandCount: number;
  invalidBandCount: number;
  sumPct: number | null;
  differenceFrom100PctPoints: number | null;
}

export interface BatteryPassportSupportIngredient {
  value: number;
  target: number;
  score: number;
}

export interface BatteryPassportEvidenceSupport {
  index: number;
  band: BatteryPassportSupportBand;
  coreFields: BatteryPassportSupportIngredient;
  trendPoints: BatteryPassportSupportIngredient;
  trendSpan: BatteryPassportSupportIngredient;
  thermalProfile: BatteryPassportSupportIngredient;
  provenanceDigest: BatteryPassportSupportIngredient;
}

export interface BatteryPassportHashFacts {
  vehicleId: number | null;
  firstObservedDay: string | null;
  sohPct: number | null;
  capacityKwh: number | null;
  equivalentFullCycles: number | null;
  fastChargeRatio: number | null;
  issuedAtDay: string | null;
}

export interface BatteryPassportAnalysis {
  nowMs: number;
  metrics: BatteryPassportSanitizedMetrics;
  trend: BatteryPassportTrendAnalysis;
  thermal: BatteryPassportThermalAnalysis;
  grade: BatteryPassportGradeReconstruction;
  support: BatteryPassportEvidenceSupport;
  hashFacts: BatteryPassportHashFacts;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function isUnknownSohSentinel(
  sohPct: unknown,
  reportedGrade: string | null,
): boolean {
  return sohPct === 0 && reportedGrade?.toUpperCase() === 'N/A';
}

function parseUtcDay(value: unknown): number | null {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

function utcDayFromInstant(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function quantile(sortedValues: readonly number[], probability: number): number | null {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0] ?? null;
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  if (lower == null || upper == null) return null;
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

function linearFit(
  points: readonly BatteryPassportTrendEvidencePoint[],
  spanDays: number | null,
): BatteryPassportLinearFit {
  const base = {
    minimumPoints: BATTERY_PASSPORT_MIN_FIT_POINTS,
    minimumSpanDays: BATTERY_PASSPORT_MIN_FIT_SPAN_DAYS,
    slopePctPointsPerDay: null,
    annualizedChangePctPoints: null,
    rSquared: null,
  };
  if (points.length < BATTERY_PASSPORT_MIN_FIT_POINTS) {
    return { ...base, status: 'insufficient_points' };
  }
  if (
    spanDays == null
    || spanDays < BATTERY_PASSPORT_MIN_FIT_SPAN_DAYS
  ) {
    return { ...base, status: 'insufficient_span' };
  }

  const origin = points[0]?.dayMs;
  if (origin == null) return { ...base, status: 'insufficient_points' };
  const xs = points.map((point) => (point.dayMs - origin) / DAY_MS);
  const ys = points.map((point) => point.sohPct);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index] ?? 0;
    const y = ys[index] ?? 0;
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) ** 2;
  }
  if (denominator === 0) {
    return { ...base, status: 'insufficient_span' };
  }
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  let residualSquares = 0;
  let totalSquares = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index] ?? 0;
    const y = ys[index] ?? 0;
    const predicted = intercept + slope * x;
    residualSquares += (y - predicted) ** 2;
    totalSquares += (y - meanY) ** 2;
  }
  return {
    ...base,
    status: 'available',
    slopePctPointsPerDay: slope,
    annualizedChangePctPoints: slope * DAYS_PER_YEAR,
    rSquared: totalSquares > 0
      ? clamp(1 - residualSquares / totalSquares, 0, 1)
      : null,
  };
}

function trendDiagnostics(
  points: readonly BatteryPassportTrendEvidencePoint[],
  nowMs: number,
): BatteryPassportTrendDiagnostics {
  const first = points[0] ?? null;
  const last = points[points.length - 1] ?? null;
  const spanDays = first && last
    ? (last.dayMs - first.dayMs) / DAY_MS
    : null;
  const values = points.map((point) => point.sohPct);
  const sortedValues = [...values].sort((a, b) => a - b);
  const mean = values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
  const standardDeviation = mean == null
    ? null
    : Math.sqrt(
        values.reduce(
          (sum, value) => sum + (value - mean) ** 2,
          0,
        ) / values.length,
      );
  const cadences = points.slice(1).map((point, index) => (
    (point.dayMs - (points[index]?.dayMs ?? point.dayMs)) / DAY_MS
  ));
  const p25 = quantile(sortedValues, 0.25);
  const p75 = quantile(sortedValues, 0.75);
  const minimum = sortedValues[0] ?? null;
  const maximum = sortedValues[sortedValues.length - 1] ?? null;

  return {
    pointCount: points.length,
    spanDays,
    daysSinceLatest: last
      ? Math.max(0, Math.floor((nowMs - last.dayMs) / DAY_MS))
      : null,
    medianCadenceDays: median(cadences),
    startToEndChangePctPoints: first && last
      ? last.sohPct - first.sohPct
      : null,
    minimumSohPct: minimum,
    maximumSohPct: maximum,
    meanSohPct: mean,
    p10SohPct: quantile(sortedValues, 0.1),
    p25SohPct: p25,
    medianSohPct: quantile(sortedValues, 0.5),
    p75SohPct: p75,
    p90SohPct: quantile(sortedValues, 0.9),
    rangePctPoints: minimum != null && maximum != null
      ? maximum - minimum
      : null,
    interquartileRangePctPoints: p25 != null && p75 != null
      ? p75 - p25
      : null,
    standardDeviationPctPoints: standardDeviation,
    fit: linearFit(points, spanDays),
  };
}

function trendDistribution(
  points: readonly BatteryPassportTrendEvidencePoint[],
): BatteryPassportDistributionBin[] {
  const definitions: Array<Omit<BatteryPassportDistributionBin, 'count' | 'share'>> = [
    { key: 'below_60', minimum: 0, maximum: 60, includesMaximum: false },
    { key: '60_70', minimum: 60, maximum: 70, includesMaximum: false },
    { key: '70_80', minimum: 70, maximum: 80, includesMaximum: false },
    { key: '80_90', minimum: 80, maximum: 90, includesMaximum: false },
    { key: '90_100', minimum: 90, maximum: 100, includesMaximum: true },
  ];
  return definitions.map((definition) => {
    const count = points.filter((point) => (
      point.sohPct >= definition.minimum
      && (
        definition.includesMaximum
          ? point.sohPct <= definition.maximum
          : point.sohPct < definition.maximum
      )
    )).length;
    return {
      ...definition,
      count,
      share: points.length > 0 ? count / points.length : null,
    };
  });
}

export function analyzeBatteryPassportTrend(
  source: readonly BatteryPassportTrendPoint[] | null | undefined,
  nowMs: number,
): BatteryPassportTrendAnalysis {
  const points = Array.isArray(source) ? source : [];
  const frozenNowMs = Number.isFinite(nowMs) ? nowMs : 0;
  const categories: Record<BatteryPassportTrendCategory, number> = {
    included: 0,
    invalid_date: 0,
    future_date: 0,
    invalid_soh: 0,
    duplicate_date: 0,
  };
  const seenDates = new Set<string>();
  const canonical: BatteryPassportTrendEvidencePoint[] = [];

  points.forEach((point, sourceIndex) => {
    const date = (point as BatteryPassportTrendPoint | null)?.date;
    const dayMs = parseUtcDay(date);
    if (dayMs == null) {
      categories.invalid_date += 1;
      return;
    }
    if (dayMs > frozenNowMs) {
      categories.future_date += 1;
      return;
    }
    const rawSohPct = (point as BatteryPassportTrendPoint | null)?.soh_pct;
    const sohPct = finiteInRange(rawSohPct, 0, 100);
    if (sohPct == null) {
      categories.invalid_soh += 1;
      return;
    }
    if (seenDates.has(date as string)) {
      categories.duplicate_date += 1;
      return;
    }
    seenDates.add(date as string);
    categories.included += 1;
    canonical.push({
      date: date as string,
      dayMs,
      sohPct,
      sourceIndex,
    });
  });

  canonical.sort((left, right) => (
    left.dayMs - right.dayMs
    || left.sourceIndex - right.sourceIndex
  ));
  const displayed = canonical.slice(-BATTERY_PASSPORT_TREND_MAX_POINTS);
  const returnedPoints = points.length;
  const includedPoints = categories.included;
  const accounting: BatteryPassportTrendAccounting = {
    returnedPoints,
    includedPoints,
    excludedPoints: returnedPoints - includedPoints,
    categories,
  };
  const omittedByDisplayCap = Math.max(
    0,
    canonical.length - displayed.length,
  );

  return {
    points: displayed,
    accounting,
    cap: {
      backendMaximum: BATTERY_PASSPORT_TREND_MAX_POINTS,
      canonicalPoints: canonical.length,
      displayedPoints: displayed.length,
      omittedByDisplayCap,
      backendCapReached:
        returnedPoints >= BATTERY_PASSPORT_TREND_MAX_POINTS,
      clientCapApplied: omittedByDisplayCap > 0,
    },
    diagnostics: trendDiagnostics(displayed, frozenNowMs),
    distribution: trendDistribution(displayed),
  };
}

export function batteryPassportGradeFromScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  if (score >= 50) return 'E';
  return 'F';
}

export function reconstructBatteryPassportGrade(
  sohPct: unknown,
  fastChargeRatio: unknown,
  equivalentFullCycles: unknown,
  reportedGrade?: unknown,
): BatteryPassportGradeReconstruction {
  const rawSoh = finiteNumber(sohPct);
  const rawFastRatio = finiteNumber(fastChargeRatio);
  const rawCycles = finiteNumber(equivalentFullCycles);
  const normalizedReported = typeof reportedGrade === 'string'
    && reportedGrade.trim() !== ''
    ? reportedGrade.trim().toUpperCase()
    : null;
  const unknownSoh = isUnknownSohSentinel(
    rawSoh,
    normalizedReported,
  );
  if (
    unknownSoh
    || rawSoh == null
    || rawFastRatio == null
    || rawCycles == null
  ) {
    return {
      status: 'unavailable',
      unavailableReason: unknownSoh
        ? 'unknown_soh'
        : 'invalid_inputs',
      score: null,
      grade: null,
      reportedGrade: normalizedReported,
      matchesReported: null,
      clampedSohPct: null,
      clampedFastChargeRatio: null,
      clampedEquivalentFullCycles: null,
      fastChargePenalty: null,
      cyclePenalty: null,
      inputsClamped: false,
    };
  }

  const clampedSohPct = clamp(rawSoh, 0, 100);
  const clampedFastChargeRatio = clamp(rawFastRatio, 0, 1);
  const clampedEquivalentFullCycles = Math.max(0, rawCycles);
  const fastChargePenalty = 8 * clampedFastChargeRatio;
  const cyclePenalty =
    12 * clamp(clampedEquivalentFullCycles / 1_500, 0, 1);
  const score = clamp(
    clampedSohPct - fastChargePenalty - cyclePenalty,
    0,
    100,
  );
  const grade = batteryPassportGradeFromScore(score);

  return {
    status: 'available',
    unavailableReason: null,
    score,
    grade,
    reportedGrade: normalizedReported,
    matchesReported: normalizedReported == null
      ? null
      : normalizedReported === grade,
    clampedSohPct,
    clampedFastChargeRatio,
    clampedEquivalentFullCycles,
    fastChargePenalty,
    cyclePenalty,
    inputsClamped:
      clampedSohPct !== rawSoh
      || clampedFastChargeRatio !== rawFastRatio
      || clampedEquivalentFullCycles !== rawCycles,
  };
}

export function analyzeBatteryPassportThermal(
  thermal: BatteryPassportThermalExposure | null | undefined,
): BatteryPassportThermalAnalysis {
  const bands: BatteryPassportThermalBand[] = [
    {
      key: 'cold',
      valuePct: finiteInRange(thermal?.cold_pct, 0, 100),
    },
    {
      key: 'nominal',
      valuePct: finiteInRange(thermal?.nominal_pct, 0, 100),
    },
    {
      key: 'hot',
      valuePct: finiteInRange(thermal?.hot_pct, 0, 100),
    },
  ];
  const validValues = bands.flatMap((band) => (
    band.valuePct == null ? [] : [band.valuePct]
  ));
  const validBandCount = validValues.length;
  const invalidBandCount = bands.length - validBandCount;
  const sumPct = invalidBandCount === 0
    ? validValues.reduce((sum, value) => sum + value, 0)
    : null;
  const allZero = sumPct === 0;
  const status = thermal == null || allZero
    ? 'no_data'
    : invalidBandCount > 0
      ? 'invalid'
      : 'available';

  return {
    status,
    bands,
    validBandCount,
    invalidBandCount,
    sumPct,
    differenceFrom100PctPoints: sumPct == null
      ? null
      : sumPct - 100,
  };
}

function sanitizeMetrics(
  passport: BatteryPassport | null | undefined,
): BatteryPassportSanitizedMetrics {
  const reportedGrade =
    typeof passport?.health_grade === 'string'
    && passport.health_grade.trim() !== ''
      ? passport.health_grade.trim()
      : null;
  const sohPct = isUnknownSohSentinel(
    passport?.soh_pct,
    reportedGrade,
  )
    ? null
    : finiteInRange(passport?.soh_pct, 0, 100);
  const capacityKwh = finiteInRange(passport?.capacity_kwh, 0, 500);
  const originalCapacityKwh = finiteInRange(
    passport?.original_capacity_kwh,
    0,
    500,
  );
  const equivalentFullCycles = finiteInRange(
    passport?.equivalent_full_cycles,
    0,
    1_000_000,
  );
  const fastChargeRatio = finiteInRange(
    passport?.fast_charge_ratio,
    0,
    1,
  );
  const avgChargeLimitPct = finiteInRange(
    passport?.avg_charge_limit_pct,
    0,
    100,
  );
  const numericValues = [
    sohPct,
    capacityKwh,
    originalCapacityKwh,
    equivalentFullCycles,
    fastChargeRatio,
    avgChargeLimitPct,
  ];
  return {
    sohPct,
    capacityKwh,
    originalCapacityKwh,
    capacityRatio:
      capacityKwh != null
      && originalCapacityKwh != null
      && originalCapacityKwh > 0
        ? capacityKwh / originalCapacityKwh
        : null,
    equivalentFullCycles,
    fastChargeRatio,
    avgChargeLimitPct,
    reportedGrade,
    invalidNumericFieldCount: passport == null
      ? numericValues.length
      : numericValues.filter((value) => value == null).length,
  };
}

function supportIngredient(
  value: number,
  target: number,
): BatteryPassportSupportIngredient {
  return {
    value,
    target,
    score: target > 0 ? clamp(value / target, 0, 1) : 0,
  };
}

function evidenceSupport(
  passport: BatteryPassport | null | undefined,
  metrics: BatteryPassportSanitizedMetrics,
  trend: BatteryPassportTrendAnalysis,
  thermal: BatteryPassportThermalAnalysis,
): BatteryPassportEvidenceSupport {
  const validCoreFields = [
    metrics.sohPct,
    metrics.capacityKwh,
    metrics.originalCapacityKwh,
    metrics.equivalentFullCycles,
    metrics.fastChargeRatio,
    metrics.avgChargeLimitPct,
  ].filter((value) => value != null).length;
  const coreFields = supportIngredient(
    passport == null ? 0 : validCoreFields,
    6,
  );
  const trendPoints = supportIngredient(
    trend.diagnostics.pointCount,
    30,
  );
  const trendSpan = supportIngredient(
    trend.diagnostics.spanDays ?? 0,
    BATTERY_PASSPORT_MIN_FIT_SPAN_DAYS,
  );
  const thermalProfile = supportIngredient(
    thermal.status === 'available' ? 1 : 0,
    1,
  );
  const provenanceDigest = supportIngredient(
    typeof passport?.provenance_hash === 'string'
    && passport.provenance_hash.trim() !== ''
      ? 1
      : 0,
    1,
  );
  const ingredients = [
    coreFields,
    trendPoints,
    trendSpan,
    thermalProfile,
    provenanceDigest,
  ];
  const index = Math.round(
    (
      ingredients.reduce(
        (sum, ingredient) => sum + ingredient.score,
        0,
      ) / ingredients.length
    ) * 100,
  );
  const band: BatteryPassportSupportBand =
    index === 0
      ? 'none'
      : index < 35
        ? 'thin'
        : index < 70
          ? 'developing'
          : 'broad';
  return {
    index,
    band,
    coreFields,
    trendPoints,
    trendSpan,
    thermalProfile,
    provenanceDigest,
  };
}

function hashFacts(
  passport: BatteryPassport | null | undefined,
): BatteryPassportHashFacts {
  if (passport == null) {
    return {
      vehicleId: null,
      firstObservedDay: null,
      sohPct: null,
      capacityKwh: null,
      equivalentFullCycles: null,
      fastChargeRatio: null,
      issuedAtDay: null,
    };
  }
  return {
    vehicleId: finiteNumber(passport.vehicle_id),
    firstObservedDay: passport.first_observed_at == null
      ? '0001-01-01'
      : utcDayFromInstant(passport.first_observed_at),
    sohPct: finiteNumber(passport.soh_pct),
    capacityKwh: finiteNumber(passport.capacity_kwh),
    equivalentFullCycles: finiteNumber(
      passport.equivalent_full_cycles,
    ),
    fastChargeRatio: finiteNumber(passport.fast_charge_ratio),
    issuedAtDay: utcDayFromInstant(passport.issued_at),
  };
}

export function analyzeBatteryPassport(
  passport: BatteryPassport | null | undefined,
  nowMs: number,
): BatteryPassportAnalysis {
  const frozenNowMs = Number.isFinite(nowMs) ? nowMs : 0;
  const metrics = sanitizeMetrics(passport);
  const trend = analyzeBatteryPassportTrend(
    passport?.degradation_trend,
    frozenNowMs,
  );
  const thermal = analyzeBatteryPassportThermal(
    passport?.thermal_exposure,
  );
  const grade = reconstructBatteryPassportGrade(
    passport?.soh_pct,
    passport?.fast_charge_ratio,
    passport?.equivalent_full_cycles,
    passport?.health_grade,
  );
  return {
    nowMs: frozenNowMs,
    metrics,
    trend,
    thermal,
    grade,
    support: evidenceSupport(
      passport,
      metrics,
      trend,
      thermal,
    ),
    hashFacts: hashFacts(passport),
  };
}

/**
 * Rebuilds the wire certificate explicitly so camel-case convenience mirrors
 * added by the request client never leak into the downloaded artifact.
 * Values are copied without diagnostic clamping or reinterpretation.
 */
export function toBatteryPassportCertificate(
  passport: BatteryPassport,
): Record<string, unknown> {
  const trend: unknown[] = Array.isArray(passport.degradation_trend)
    ? passport.degradation_trend
    : [];
  const recommendations = Array.isArray(passport.recommendations)
    ? passport.recommendations
    : [];
  return {
    vehicle_id: passport.vehicle_id,
    vin_masked: passport.vin_masked,
    issued_at: passport.issued_at,
    first_observed_at: passport.first_observed_at,
    soh_pct: passport.soh_pct,
    capacity_kwh: passport.capacity_kwh,
    original_capacity_kwh: passport.original_capacity_kwh,
    equivalent_full_cycles: passport.equivalent_full_cycles,
    fast_charge_ratio: passport.fast_charge_ratio,
    avg_charge_limit_pct: passport.avg_charge_limit_pct,
    thermal_exposure: {
      cold_pct: passport.thermal_exposure?.cold_pct,
      nominal_pct: passport.thermal_exposure?.nominal_pct,
      hot_pct: passport.thermal_exposure?.hot_pct,
    },
    health_grade: passport.health_grade,
    degradation_trend: trend.flatMap((point) => {
      if (typeof point !== 'object' || point == null) return [];
      const candidate = point as Partial<BatteryPassportTrendPoint>;
      if (
        parseUtcDay(candidate.date) == null
        || finiteInRange(candidate.soh_pct, 0, 100) == null
      ) {
        return [];
      }
      return [{
        date: candidate.date,
        soh_pct: candidate.soh_pct,
      }];
    }),
    recommendations: [...recommendations],
    provenance_hash: passport.provenance_hash,
  };
}
