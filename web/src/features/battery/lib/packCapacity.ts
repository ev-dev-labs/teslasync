import type { ChargingSession } from '@/types/charging';

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365.25;
const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export const DEFAULT_PACK_CAPACITY_HISTORY_LIMIT = 1_000;
export const DEFAULT_CAPACITY_SOC_WINDOW_PCT = 10;
export const DEFAULT_PROCESS_NOISE_WH_PER_SQRT_DAY = 30;
export const CAPACITY_SOC_WINDOW_OPTIONS = [5, 10, 20, 30, 40] as const;
export const CAPACITY_PROCESS_NOISE_OPTIONS = [10, 30, 60, 120] as const;

export type PackCapacityEvidenceBand =
  | 'none'
  | 'thin'
  | 'developing'
  | 'strong';

export type PackCapacityRowCategory =
  | 'included'
  | 'incomplete_live'
  | 'invalid_timestamp_order'
  | 'future'
  | 'missing_soc'
  | 'invalid_soc'
  | 'nonpositive_soc_gain'
  | 'missing_energy'
  | 'invalid_energy'
  | 'below_soc_window'
  | 'implausible_capacity'
  | 'duplicate_session'
  | 'overlapping_interval'
  | 'outside_analysis_cap';

export type CapacityFitStatus =
  | 'available'
  | 'insufficient_observations'
  | 'insufficient_span'
  | 'insufficient_months';

export type PackCapacitySession = Omit<
  ChargingSession,
  'id' | 'start_soc_pct' | 'total_energy_added_wh'
> & {
  id: string | number;
  start_soc_pct: number | null;
  total_energy_added_wh: number | null;
};

export interface PackCapacityOptions {
  minSocWindowPct?: number;
  socSigmaPct?: number;
  energyRelativeSigma?: number;
  processNoiseWhPerSqrtDay?: number;
  minPlausibleWh?: number;
  maxPlausibleWh?: number;
  historyLimit?: number;
  minFitObservations?: number;
  minFitSpanDays?: number;
  minFitMonths?: number;
  maxTrendMonths?: number;
  maxTimelinePoints?: number;
  maxRecentMeasurements?: number;
}

export interface ResolvedPackCapacityOptions {
  minSocWindowPct: number;
  socSigmaPct: number;
  energyRelativeSigma: number;
  processNoiseWhPerSqrtDay: number;
  minPlausibleWh: number;
  maxPlausibleWh: number;
  historyLimit: number;
  minFitObservations: number;
  minFitSpanDays: number;
  minFitMonths: number;
  maxTrendMonths: number;
  maxTimelinePoints: number;
  maxRecentMeasurements: number;
}

export interface CapacityObservation {
  sessionId: string;
  startTs: string;
  endTs: string;
  startMs: number;
  endMs: number;
  durationS: number;
  startSocPct: number;
  endSocPct: number;
  socDeltaPct: number;
  energyAddedWh: number;
  capacityWh: number;
  sigmaWh: number;
  relativeSigma: number;
  chargerType: string | null;
  locationLabel: string | null;
}

export interface CapacityState {
  sessionId: string;
  ts: string;
  tsMs: number;
  capacityWh: number;
  sigmaWh: number;
  observedWh: number;
  measurementSigmaWh: number;
  priorWh: number;
  priorSigmaWh: number;
  innovationWh: number;
  innovationSigmaWh: number;
  standardizedInnovation: number;
  gain: number;
}

export interface PackCapacityAccounting {
  returnedRows: number;
  includedRows: number;
  excludedRows: number;
  historyLimit: number;
  historyCapReached: boolean;
  categories: Record<PackCapacityRowCategory, number>;
}

export interface CapacityFit {
  status: CapacityFitStatus;
  observationCount: number;
  activeMonths: number;
  spanDays: number;
  originMs: number | null;
  slopeWhPerDay: number | null;
  interceptWh: number | null;
  changeAcrossSpanWh: number | null;
  annualChangeWh: number | null;
  annualChangeShare: number | null;
  rSquared: number | null;
}

export interface CapacitySummary {
  currentWh: number | null;
  currentSigmaWh: number | null;
  currentRelativeSigma: number | null;
  filteredMaxWh: number | null;
  currentToMaxRatio: number | null;
  rawMedianWh: number | null;
  rawP10Wh: number | null;
  rawP90Wh: number | null;
  highInformationShare: number | null;
  fit: CapacityFit;
}

export interface CapacityMonthPoint {
  monthKey: string;
  samples: number;
  highInformationSamples: number;
  medianObservedWh: number | null;
  latestFilteredWh: number | null;
  latestSigmaWh: number | null;
  meanSocWindowPct: number | null;
  meanRelativeSigma: number | null;
  meanGain: number | null;
  energyAddedWh: number;
}

export interface CapacitySocWindowPoint {
  lowerPct: number;
  upperPct: number;
  samples: number;
  medianObservedWh: number | null;
  meanRelativeSigma: number | null;
  meanGain: number | null;
  energyAddedWh: number;
}

export type CapacityInnovationBand =
  | 'below_minus_two'
  | 'minus_two_to_minus_one'
  | 'minus_one_to_one'
  | 'one_to_two'
  | 'above_two';

export interface CapacityInnovationPoint {
  band: CapacityInnovationBand;
  samples: number;
  share: number | null;
}

export interface CapacityWindowSensitivityPoint {
  minSocWindowPct: number;
  includedRows: number;
  currentWh: number | null;
  currentSigmaWh: number | null;
  currentRelativeSigma: number | null;
  annualChangeWh: number | null;
  fitStatus: CapacityFitStatus;
}

export interface CapacityProcessSensitivityPoint {
  processNoiseWhPerSqrtDay: number;
  currentWh: number | null;
  currentSigmaWh: number | null;
  currentRelativeSigma: number | null;
  annualChangeWh: number | null;
  fitStatus: CapacityFitStatus;
}

export interface CapacitySupportIngredient {
  value: number;
  target: number;
  score: number;
}

export interface PackCapacitySupport {
  index: number;
  band: PackCapacityEvidenceBand;
  observations: CapacitySupportIngredient;
  highInformation: CapacitySupportIngredient;
  spanDays: CapacitySupportIngredient;
  activeMonths: CapacitySupportIngredient;
  recency: CapacitySupportIngredient;
}

export interface PackCapacityCoverage {
  highInformationRows: number;
  qualifiedShare: number | null;
  activeLocalDays: number;
  activeLocalWeeks: number;
  activeLocalMonths: number;
  firstObservationMs: number | null;
  lastObservationMs: number | null;
  observedSpanDays: number | null;
  daysSinceLastObservation: number | null;
  medianCadenceDays: number | null;
  totalEnergyAddedWh: number;
  returnedTrendMonths: number;
  displayedTrendMonths: number;
  omittedTrendMonths: number;
  timelinePoints: number;
  omittedTimelinePoints: number;
  omittedRecentMeasurements: number;
  support: PackCapacitySupport;
}

export interface PackCapacityResult {
  nowMs: number;
  timeZone: string;
  config: ResolvedPackCapacityOptions;
  accounting: PackCapacityAccounting;
  observations: CapacityObservation[];
  states: CapacityState[];
  timeline: CapacityState[];
  recentMeasurements: Array<{
    observation: CapacityObservation;
    state: CapacityState;
  }>;
  summary: CapacitySummary;
  coverage: PackCapacityCoverage;
  monthTrend: CapacityMonthPoint[];
  socWindowProfile: CapacitySocWindowPoint[];
  innovationProfile: CapacityInnovationPoint[];
  windowSensitivity: CapacityWindowSensitivityPoint[];
  processSensitivity: CapacityProcessSensitivityPoint[];
}

interface CandidateObservation extends CapacityObservation {
  sourceIndex: number;
  dedupeKey: string | null;
}

interface ClassifiedSession {
  candidate: CandidateObservation | null;
  category: PackCapacityRowCategory | null;
}

interface LocalParts {
  dateKey: string;
  weekKey: string;
  monthKey: string;
}

interface LinearFit {
  slope: number;
  intercept: number;
  rSquared: number;
}

const DEFAULTS: ResolvedPackCapacityOptions = {
  minSocWindowPct: DEFAULT_CAPACITY_SOC_WINDOW_PCT,
  socSigmaPct: 1,
  energyRelativeSigma: 0.015,
  processNoiseWhPerSqrtDay: DEFAULT_PROCESS_NOISE_WH_PER_SQRT_DAY,
  minPlausibleWh: 10_000,
  maxPlausibleWh: 200_000,
  historyLimit: DEFAULT_PACK_CAPACITY_HISTORY_LIMIT,
  minFitObservations: 12,
  minFitSpanDays: 180,
  minFitMonths: 6,
  maxTrendMonths: 24,
  maxTimelinePoints: 200,
  maxRecentMeasurements: 25,
};

const SOC_WINDOW_EDGES = [5, 10, 20, 40, 60, 100] as const;

function clampNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.floor(clampNumber(value, fallback, minimum, maximum));
}

function resolveOptions(
  options: PackCapacityOptions,
): ResolvedPackCapacityOptions {
  const minPlausibleWh = clampNumber(
    options.minPlausibleWh,
    DEFAULTS.minPlausibleWh,
    1_000,
    500_000,
  );
  const maxPlausibleWh = Math.max(
    minPlausibleWh + 1,
    clampNumber(
      options.maxPlausibleWh,
      DEFAULTS.maxPlausibleWh,
      1_001,
      1_000_000,
    ),
  );
  return {
    minSocWindowPct: clampNumber(
      options.minSocWindowPct,
      DEFAULTS.minSocWindowPct,
      1,
      100,
    ),
    socSigmaPct: clampNumber(
      options.socSigmaPct,
      DEFAULTS.socSigmaPct,
      0.05,
      10,
    ),
    energyRelativeSigma: clampNumber(
      options.energyRelativeSigma,
      DEFAULTS.energyRelativeSigma,
      0.001,
      0.5,
    ),
    processNoiseWhPerSqrtDay: clampNumber(
      options.processNoiseWhPerSqrtDay,
      DEFAULTS.processNoiseWhPerSqrtDay,
      0,
      5_000,
    ),
    minPlausibleWh,
    maxPlausibleWh,
    historyLimit: clampInteger(
      options.historyLimit,
      DEFAULTS.historyLimit,
      1,
      1_000,
    ),
    minFitObservations: clampInteger(
      options.minFitObservations,
      DEFAULTS.minFitObservations,
      2,
      1_000,
    ),
    minFitSpanDays: clampNumber(
      options.minFitSpanDays,
      DEFAULTS.minFitSpanDays,
      1,
      3_650,
    ),
    minFitMonths: clampInteger(
      options.minFitMonths,
      DEFAULTS.minFitMonths,
      2,
      120,
    ),
    maxTrendMonths: clampInteger(
      options.maxTrendMonths,
      DEFAULTS.maxTrendMonths,
      1,
      120,
    ),
    maxTimelinePoints: clampInteger(
      options.maxTimelinePoints,
      DEFAULTS.maxTimelinePoints,
      10,
      1_000,
    ),
    maxRecentMeasurements: clampInteger(
      options.maxRecentMeasurements,
      DEFAULTS.maxRecentMeasurements,
      1,
      100,
    ),
  };
}

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function timestampText(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (value?.trim()) return value;
  }
  return null;
}

function finiteMs(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

function emptyCategories(): Record<PackCapacityRowCategory, number> {
  return {
    included: 0,
    incomplete_live: 0,
    invalid_timestamp_order: 0,
    future: 0,
    missing_soc: 0,
    invalid_soc: 0,
    nonpositive_soc_gain: 0,
    missing_energy: 0,
    invalid_energy: 0,
    below_soc_window: 0,
    implausible_capacity: 0,
    duplicate_session: 0,
    overlapping_interval: 0,
    outside_analysis_cap: 0,
  };
}

function classifySession(
  session: PackCapacitySession,
  sourceIndex: number,
  nowMs: number,
  config: ResolvedPackCapacityOptions,
): ClassifiedSession {
  const startTs = timestampText(session.started_at);
  const endTs = timestampText(session.ended_at);
  if (!endTs) {
    return { candidate: null, category: 'incomplete_live' };
  }
  const startMs = finiteMs(startTs);
  const endMs = finiteMs(endTs);
  if (
    startMs == null
    || endMs == null
    || endMs <= startMs
  ) {
    return { candidate: null, category: 'invalid_timestamp_order' };
  }
  if (endMs > nowMs) {
    return { candidate: null, category: 'future' };
  }

  if (session.start_soc_pct == null || session.end_soc_pct == null) {
    return { candidate: null, category: 'missing_soc' };
  }
  const startSocPct = finite(session.start_soc_pct);
  const endSocPct = finite(session.end_soc_pct);
  if (
    startSocPct == null
    || endSocPct == null
    || startSocPct < 0
    || startSocPct > 100
    || endSocPct < 0
    || endSocPct > 100
  ) {
    return { candidate: null, category: 'invalid_soc' };
  }
  const socDeltaPct = endSocPct - startSocPct;
  if (socDeltaPct <= 0) {
    return { candidate: null, category: 'nonpositive_soc_gain' };
  }

  if (session.total_energy_added_wh == null) {
    return { candidate: null, category: 'missing_energy' };
  }
  const energyAddedWh = finite(session.total_energy_added_wh);
  if (energyAddedWh == null || energyAddedWh <= 0) {
    return { candidate: null, category: 'invalid_energy' };
  }
  if (socDeltaPct < config.minSocWindowPct) {
    return { candidate: null, category: 'below_soc_window' };
  }

  const capacityWh = energyAddedWh / (socDeltaPct / 100);
  if (
    !Number.isFinite(capacityWh)
    || capacityWh < config.minPlausibleWh
    || capacityWh > config.maxPlausibleWh
  ) {
    return { candidate: null, category: 'implausible_capacity' };
  }

  const socTerm =
    (capacityWh * config.socSigmaPct) / socDeltaPct;
  const meterTerm = capacityWh * config.energyRelativeSigma;
  const sigmaWh = Math.sqrt(
    socTerm * socTerm + meterTerm * meterTerm,
  );
  const rawId =
    session.id == null ? '' : String(session.id).trim();
  const sessionId = rawId || `row:${sourceIndex}`;

  return {
    candidate: {
      sessionId,
      dedupeKey: rawId || null,
      sourceIndex,
      startTs: startTs!,
      endTs,
      startMs,
      endMs,
      durationS: (endMs - startMs) / 1_000,
      startSocPct,
      endSocPct,
      socDeltaPct,
      energyAddedWh,
      capacityWh,
      sigmaWh,
      relativeSigma: sigmaWh / capacityWh,
      chargerType: session.charger_type?.trim() || null,
      locationLabel: session.start_place?.trim() || null,
    },
    category: null,
  };
}

export function buildCapacityObservations(
  sessions: readonly PackCapacitySession[],
  nowMs: number,
  options: PackCapacityOptions = {},
): {
  observations: CapacityObservation[];
  accounting: PackCapacityAccounting;
} {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError(
      'Pack Capacity observation building requires a finite clock',
    );
  }
  const config = resolveOptions(options);
  const categories = emptyCategories();
  const candidates: CandidateObservation[] = [];

  sessions.forEach((session, sourceIndex) => {
    const classified = classifySession(
      session,
      sourceIndex,
      nowMs,
      config,
    );
    if (classified.candidate) candidates.push(classified.candidate);
    else if (classified.category) categories[classified.category] += 1;
  });

  candidates.sort(
    (left, right) =>
      left.startMs - right.startMs
      || left.endMs - right.endMs
      || left.sessionId.localeCompare(right.sessionId)
      || left.sourceIndex - right.sourceIndex,
  );
  const seenIds = new Set<string>();
  const chronological: CandidateObservation[] = [];
  for (const candidate of candidates) {
    if (
      candidate.dedupeKey
      && seenIds.has(candidate.dedupeKey)
    ) {
      categories.duplicate_session += 1;
      continue;
    }
    if (candidate.dedupeKey) seenIds.add(candidate.dedupeKey);

    const previous = chronological[chronological.length - 1];
    if (previous && candidate.startMs < previous.endMs) {
      categories.overlapping_interval += 1;
      continue;
    }
    chronological.push(candidate);
  }

  const byCompletion = [...chronological].sort(
    (left, right) =>
      left.endMs - right.endMs
      || left.startMs - right.startMs
      || left.sessionId.localeCompare(right.sessionId),
  );
  const includedCandidates = byCompletion.slice(-config.historyLimit);
  categories.outside_analysis_cap +=
    byCompletion.length - includedCandidates.length;
  categories.included = includedCandidates.length;
  const observations: CapacityObservation[] =
    includedCandidates.map((candidate) => ({
      sessionId: candidate.sessionId,
      startTs: candidate.startTs,
      endTs: candidate.endTs,
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      durationS: candidate.durationS,
      startSocPct: candidate.startSocPct,
      endSocPct: candidate.endSocPct,
      socDeltaPct: round(candidate.socDeltaPct, 3),
      energyAddedWh: round(candidate.energyAddedWh, 3),
      capacityWh: round(candidate.capacityWh, 3),
      sigmaWh: round(candidate.sigmaWh, 3),
      relativeSigma: round(candidate.relativeSigma),
      chargerType: candidate.chargerType,
      locationLabel: candidate.locationLabel,
    }));

  return {
    observations,
    accounting: {
      returnedRows: sessions.length,
      includedRows: observations.length,
      excludedRows: sessions.length - observations.length,
      historyLimit: config.historyLimit,
      historyCapReached: sessions.length >= config.historyLimit,
      categories,
    },
  };
}

export function kalmanFilterCapacity(
  observations: readonly CapacityObservation[],
  options: PackCapacityOptions = {},
): CapacityState[] {
  if (observations.length === 0) return [];
  const config = resolveOptions(options);
  const first = observations[0]!;
  let estimate = first.capacityWh;
  let variance = first.sigmaWh ** 2;
  const states: CapacityState[] = [
    {
      sessionId: first.sessionId,
      ts: first.endTs,
      tsMs: first.endMs,
      capacityWh: round(estimate, 3),
      sigmaWh: round(Math.sqrt(variance), 3),
      observedWh: first.capacityWh,
      measurementSigmaWh: first.sigmaWh,
      priorWh: first.capacityWh,
      priorSigmaWh: first.sigmaWh,
      innovationWh: 0,
      innovationSigmaWh: first.sigmaWh,
      standardizedInnovation: 0,
      gain: 1,
    },
  ];

  for (let index = 1; index < observations.length; index += 1) {
    const observation = observations[index]!;
    const previous = observations[index - 1]!;
    const elapsedDays = Math.max(
      0,
      (observation.endMs - previous.endMs) / DAY_MS,
    );
    variance +=
      config.processNoiseWhPerSqrtDay ** 2 * elapsedDays;
    const priorWh = estimate;
    const priorSigmaWh = Math.sqrt(variance);
    const measurementVariance = Math.max(
      1,
      observation.sigmaWh ** 2,
    );
    const innovationWh = observation.capacityWh - priorWh;
    const innovationSigmaWh = Math.sqrt(
      variance + measurementVariance,
    );
    const gain = variance / (variance + measurementVariance);
    estimate += gain * innovationWh;
    variance *= 1 - gain;

    states.push({
      sessionId: observation.sessionId,
      ts: observation.endTs,
      tsMs: observation.endMs,
      capacityWh: round(estimate, 3),
      sigmaWh: round(Math.sqrt(variance), 3),
      observedWh: observation.capacityWh,
      measurementSigmaWh: observation.sigmaWh,
      priorWh: round(priorWh, 3),
      priorSigmaWh: round(priorSigmaWh, 3),
      innovationWh: round(innovationWh, 3),
      innovationSigmaWh: round(innovationSigmaWh, 3),
      standardizedInnovation: round(
        innovationSigmaWh > 0
          ? innovationWh / innovationSigmaWh
          : 0,
        3,
      ),
      gain: round(gain, 6),
    });
  }
  return states;
}

function resolveTimeZone(candidate: string): string {
  const trimmed = candidate.trim();
  if (!trimmed) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(0);
    return trimmed;
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
    },
  );
  PARTS_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function localWeekKey(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const mondayIndex = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayIndex);
  return date.toISOString().slice(0, 10);
}

function localParts(ms: number, timeZone: string): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const parsed = Number(parts.find((part) => part.type === type)?.value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const yearText = String(year).padStart(4, '0');
  const monthText = String(month).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return {
    dateKey: `${yearText}-${monthText}-${dayText}`,
    weekKey: localWeekKey(year, month, day),
    monthKey: `${yearText}-${monthText}`,
  };
}

function dateOrdinal(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / DAY_MS;
}

function addMonths(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + amount, 1, 12));
  return `${date.getUTCFullYear()}-${String(
    date.getUTCMonth() + 1,
  ).padStart(2, '0')}`;
}

function mean(values: readonly number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function quantile(
  values: readonly number[],
  percentile: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0]!;
  const position =
    Math.min(1, Math.max(0, percentile)) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
}

function linearFit(
  xs: readonly number[],
  ys: readonly number[],
): LinearFit | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const xMean = mean(xs)!;
  const yMean = mean(ys)!;
  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const xDelta = xs[index]! - xMean;
    const yDelta = ys[index]! - yMean;
    covariance += xDelta * yDelta;
    xVariance += xDelta * xDelta;
    yVariance += yDelta * yDelta;
  }
  if (xVariance <= 0) return null;
  const slope = covariance / xVariance;
  const rSquared =
    yVariance > 0
      ? (covariance * covariance) / (xVariance * yVariance)
      : 1;
  return {
    slope,
    intercept: yMean - slope * xMean,
    rSquared: Math.min(1, Math.max(0, rSquared)),
  };
}

function isHighInformation(observation: CapacityObservation): boolean {
  return (
    observation.socDeltaPct >= 20
    && observation.relativeSigma <= 0.08
  );
}

function activeMonthCount(
  observations: readonly CapacityObservation[],
  timeZone: string,
): number {
  return new Set(
    observations.map(
      (observation) => localParts(observation.endMs, timeZone).monthKey,
    ),
  ).size;
}

function buildFit(
  states: readonly CapacityState[],
  observations: readonly CapacityObservation[],
  timeZone: string,
  referenceWh: number | null,
  config: ResolvedPackCapacityOptions,
): CapacityFit {
  const observationCount = states.length;
  const activeMonths = activeMonthCount(observations, timeZone);
  const spanDays =
    states.length > 1
      ? (states[states.length - 1]!.tsMs - states[0]!.tsMs) / DAY_MS
      : 0;
  const changeAcrossSpanWh =
    states.length > 1
      ? states[states.length - 1]!.capacityWh
        - states[0]!.capacityWh
      : null;
  let status: CapacityFitStatus = 'available';
  if (observationCount < config.minFitObservations) {
    status = 'insufficient_observations';
  } else if (spanDays < config.minFitSpanDays) {
    status = 'insufficient_span';
  } else if (activeMonths < config.minFitMonths) {
    status = 'insufficient_months';
  }
  if (status !== 'available') {
    return {
      status,
      observationCount,
      activeMonths,
      spanDays: round(spanDays, 1),
      originMs: states[0]?.tsMs ?? null,
      slopeWhPerDay: null,
      interceptWh: null,
      changeAcrossSpanWh:
        changeAcrossSpanWh == null ? null : round(changeAcrossSpanWh, 3),
      annualChangeWh: null,
      annualChangeShare: null,
      rSquared: null,
    };
  }
  const startMs = states[0]!.tsMs;
  const fit = linearFit(
    states.map((state) => (state.tsMs - startMs) / DAY_MS),
    states.map((state) => state.capacityWh),
  );
  const annualChangeWh =
    fit == null ? null : fit.slope * DAYS_PER_YEAR;
  return {
    status,
    observationCount,
    activeMonths,
    spanDays: round(spanDays, 1),
    originMs: startMs,
    slopeWhPerDay: fit == null ? null : round(fit.slope),
    interceptWh: fit == null ? null : round(fit.intercept),
    changeAcrossSpanWh:
      changeAcrossSpanWh == null ? null : round(changeAcrossSpanWh, 3),
    annualChangeWh:
      annualChangeWh == null ? null : round(annualChangeWh, 3),
    annualChangeShare:
      annualChangeWh != null && referenceWh != null && referenceWh > 0
        ? round(annualChangeWh / referenceWh)
        : null,
    rSquared: fit == null ? null : round(fit.rSquared),
  };
}

function buildSummary(
  observations: readonly CapacityObservation[],
  states: readonly CapacityState[],
  timeZone: string,
  config: ResolvedPackCapacityOptions,
): CapacitySummary {
  const current = states[states.length - 1] ?? null;
  const filteredMaxWh =
    states.length > 0
      ? Math.max(...states.map((state) => state.capacityWh))
      : null;
  const capacities = observations.map(
    (observation) => observation.capacityWh,
  );
  const highInformationRows = observations.filter(
    isHighInformation,
  ).length;
  return {
    currentWh: current?.capacityWh ?? null,
    currentSigmaWh: current?.sigmaWh ?? null,
    currentRelativeSigma:
      current != null && current.capacityWh > 0
        ? round(current.sigmaWh / current.capacityWh)
        : null,
    filteredMaxWh,
    currentToMaxRatio:
      current != null && filteredMaxWh != null && filteredMaxWh > 0
        ? round(current.capacityWh / filteredMaxWh)
        : null,
    rawMedianWh:
      capacities.length > 0 ? round(quantile(capacities, 0.5)!) : null,
    rawP10Wh:
      capacities.length > 0 ? round(quantile(capacities, 0.1)!) : null,
    rawP90Wh:
      capacities.length > 0 ? round(quantile(capacities, 0.9)!) : null,
    highInformationShare:
      observations.length > 0
        ? round(highInformationRows / observations.length)
        : null,
    fit: buildFit(
      states,
      observations,
      timeZone,
      filteredMaxWh,
      config,
    ),
  };
}

function buildMonthTrend(
  observations: readonly CapacityObservation[],
  states: readonly CapacityState[],
  timeZone: string,
  config: ResolvedPackCapacityOptions,
): {
  returnedMonths: number;
  points: CapacityMonthPoint[];
} {
  if (observations.length === 0) {
    return { returnedMonths: 0, points: [] };
  }
  const grouped = new Map<string, number[]>();
  observations.forEach((observation, index) => {
    const key = localParts(observation.endMs, timeZone).monthKey;
    const indices = grouped.get(key) ?? [];
    indices.push(index);
    grouped.set(key, indices);
  });
  const keys = Array.from(grouped.keys()).sort();
  const first = keys[0]!;
  const latest = keys[keys.length - 1]!;
  const all: CapacityMonthPoint[] = [];
  for (let month = first; month <= latest; month = addMonths(month, 1)) {
    const indices = grouped.get(month) ?? [];
    const monthObservations = indices.map((index) => observations[index]!);
    const monthStates = indices.map((index) => states[index]!);
    const latestState = monthStates[monthStates.length - 1] ?? null;
    all.push({
      monthKey: month,
      samples: indices.length,
      highInformationSamples: monthObservations.filter(
        isHighInformation,
      ).length,
      medianObservedWh:
        monthObservations.length > 0
          ? round(
              quantile(
                monthObservations.map(
                  (observation) => observation.capacityWh,
                ),
                0.5,
              )!,
            )
          : null,
      latestFilteredWh: latestState?.capacityWh ?? null,
      latestSigmaWh: latestState?.sigmaWh ?? null,
      meanSocWindowPct:
        monthObservations.length > 0
          ? round(
              mean(
                monthObservations.map(
                  (observation) => observation.socDeltaPct,
                ),
              )!,
            )
          : null,
      meanRelativeSigma:
        monthObservations.length > 0
          ? round(
              mean(
                monthObservations.map(
                  (observation) => observation.relativeSigma,
                ),
              )!,
            )
          : null,
      meanGain:
        monthStates.length > 0
          ? round(mean(monthStates.map((state) => state.gain))!)
          : null,
      energyAddedWh: round(
        monthObservations.reduce(
          (sum, observation) => sum + observation.energyAddedWh,
          0,
        ),
        3,
      ),
    });
    if (month === latest) break;
  }
  return {
    returnedMonths: all.length,
    points: all.slice(-config.maxTrendMonths),
  };
}

function buildSocWindowProfile(
  observations: readonly CapacityObservation[],
  states: readonly CapacityState[],
): CapacitySocWindowPoint[] {
  return SOC_WINDOW_EDGES.slice(0, -1).map((lowerPct, index) => {
    const upperPct = SOC_WINDOW_EDGES[index + 1]!;
    const indices = observations
      .map((observation, observationIndex) => ({
        observation,
        observationIndex,
      }))
      .filter(
        ({ observation }) =>
          observation.socDeltaPct >= lowerPct
          && (
            index === SOC_WINDOW_EDGES.length - 2
              ? observation.socDeltaPct <= upperPct
              : observation.socDeltaPct < upperPct
          ),
      )
      .map(({ observationIndex }) => observationIndex);
    const members = indices.map(
      (observationIndex) => observations[observationIndex]!,
    );
    const memberStates = indices.map(
      (observationIndex) => states[observationIndex]!,
    );
    return {
      lowerPct,
      upperPct,
      samples: members.length,
      medianObservedWh:
        members.length > 0
          ? round(
              quantile(
                members.map((observation) => observation.capacityWh),
                0.5,
              )!,
            )
          : null,
      meanRelativeSigma:
        members.length > 0
          ? round(
              mean(
                members.map(
                  (observation) => observation.relativeSigma,
                ),
              )!,
            )
          : null,
      meanGain:
        memberStates.length > 0
          ? round(mean(memberStates.map((state) => state.gain))!)
          : null,
      energyAddedWh: round(
        members.reduce(
          (sum, observation) => sum + observation.energyAddedWh,
          0,
        ),
        3,
      ),
    };
  });
}

function innovationBand(
  standardizedInnovation: number,
): CapacityInnovationBand {
  if (standardizedInnovation < -2) return 'below_minus_two';
  if (standardizedInnovation < -1) return 'minus_two_to_minus_one';
  if (standardizedInnovation <= 1) return 'minus_one_to_one';
  if (standardizedInnovation <= 2) return 'one_to_two';
  return 'above_two';
}

function buildInnovationProfile(
  states: readonly CapacityState[],
): CapacityInnovationPoint[] {
  const bands: CapacityInnovationBand[] = [
    'below_minus_two',
    'minus_two_to_minus_one',
    'minus_one_to_one',
    'one_to_two',
    'above_two',
  ];
  const eligible = states.slice(1);
  return bands.map((band) => {
    const samples = eligible.filter(
      (state) => innovationBand(state.standardizedInnovation) === band,
    ).length;
    return {
      band,
      samples,
      share:
        eligible.length > 0 ? round(samples / eligible.length) : null,
    };
  });
}

function supportIngredient(
  value: number,
  target: number,
): CapacitySupportIngredient {
  return {
    value,
    target,
    score: target > 0 ? Math.min(1, value / target) : 0,
  };
}

function recencyScore(days: number | null): number {
  if (days == null) return 0;
  if (days <= 7) return 1;
  if (days <= 30) return 0.75;
  if (days <= 90) return 0.5;
  if (days <= 180) return 0.25;
  return 0;
}

function buildSupport(
  observations: number,
  highInformation: number,
  spanDays: number,
  activeMonths: number,
  daysSinceLast: number | null,
): PackCapacitySupport {
  const observationIngredient = supportIngredient(observations, 30);
  const highInformationIngredient = supportIngredient(
    highInformation,
    15,
  );
  const spanIngredient = supportIngredient(spanDays, 365);
  const monthIngredient = supportIngredient(activeMonths, 12);
  const recency = {
    value: daysSinceLast ?? 0,
    target: 30,
    score: recencyScore(daysSinceLast),
  };
  const index = round(
    100
      * (
        0.25 * observationIngredient.score
        + 0.25 * highInformationIngredient.score
        + 0.2 * spanIngredient.score
        + 0.15 * monthIngredient.score
        + 0.15 * recency.score
      ),
    1,
  );
  const band: PackCapacityEvidenceBand =
    observations === 0
      ? 'none'
      : index < 35
        ? 'thin'
        : index < 70
          ? 'developing'
          : 'strong';
  return {
    index,
    band,
    observations: observationIngredient,
    highInformation: highInformationIngredient,
    spanDays: spanIngredient,
    activeMonths: monthIngredient,
    recency,
  };
}

function buildWindowSensitivity(
  sessions: readonly PackCapacitySession[],
  nowMs: number,
  timeZone: string,
  config: ResolvedPackCapacityOptions,
): CapacityWindowSensitivityPoint[] {
  const thresholds = Array.from(
    new Set([
      ...CAPACITY_SOC_WINDOW_OPTIONS,
      config.minSocWindowPct,
    ]),
  ).sort((left, right) => left - right);
  return thresholds.map((minSocWindowPct) => {
    const { observations } = buildCapacityObservations(
      sessions,
      nowMs,
      { ...config, minSocWindowPct },
    );
    const states = kalmanFilterCapacity(observations, config);
    const current = states[states.length - 1] ?? null;
    const referenceWh =
      states.length > 0
        ? Math.max(...states.map((state) => state.capacityWh))
        : null;
    const fit = buildFit(
      states,
      observations,
      timeZone,
      referenceWh,
      config,
    );
    return {
      minSocWindowPct,
      includedRows: observations.length,
      currentWh: current?.capacityWh ?? null,
      currentSigmaWh: current?.sigmaWh ?? null,
      currentRelativeSigma:
        current != null && current.capacityWh > 0
          ? round(current.sigmaWh / current.capacityWh)
          : null,
      annualChangeWh: fit.annualChangeWh,
      fitStatus: fit.status,
    };
  });
}

function buildProcessSensitivity(
  observations: readonly CapacityObservation[],
  timeZone: string,
  config: ResolvedPackCapacityOptions,
): CapacityProcessSensitivityPoint[] {
  const values = Array.from(
    new Set([
      ...CAPACITY_PROCESS_NOISE_OPTIONS,
      config.processNoiseWhPerSqrtDay,
    ]),
  ).sort((left, right) => left - right);
  return values.map((processNoiseWhPerSqrtDay) => {
    const states = kalmanFilterCapacity(observations, {
      ...config,
      processNoiseWhPerSqrtDay,
    });
    const current = states[states.length - 1] ?? null;
    const referenceWh =
      states.length > 0
        ? Math.max(...states.map((state) => state.capacityWh))
        : null;
    const fit = buildFit(
      states,
      observations,
      timeZone,
      referenceWh,
      config,
    );
    return {
      processNoiseWhPerSqrtDay,
      currentWh: current?.capacityWh ?? null,
      currentSigmaWh: current?.sigmaWh ?? null,
      currentRelativeSigma:
        current != null && current.capacityWh > 0
          ? round(current.sigmaWh / current.capacityWh)
          : null,
      annualChangeWh: fit.annualChangeWh,
      fitStatus: fit.status,
    };
  });
}

export function analyzePackCapacity(
  sessions: readonly PackCapacitySession[],
  nowMs: number,
  requestedTimeZone: string,
  options: PackCapacityOptions = {},
): PackCapacityResult {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError('Pack Capacity analysis requires a finite clock');
  }
  const config = resolveOptions(options);
  const timeZone = resolveTimeZone(requestedTimeZone);
  const { observations, accounting } = buildCapacityObservations(
    sessions,
    nowMs,
    config,
  );
  const states = kalmanFilterCapacity(observations, config);
  const summary = buildSummary(
    observations,
    states,
    timeZone,
    config,
  );
  const trend = buildMonthTrend(
    observations,
    states,
    timeZone,
    config,
  );
  const parts = observations.map((observation) =>
    localParts(observation.endMs, timeZone),
  );
  const dates = Array.from(
    new Set(parts.map((part) => part.dateKey)),
  ).sort();
  const weeks = new Set(parts.map((part) => part.weekKey));
  const months = new Set(parts.map((part) => part.monthKey));
  const firstObservationMs = observations[0]?.endMs ?? null;
  const lastObservationMs =
    observations[observations.length - 1]?.endMs ?? null;
  const observedSpanDays =
    dates.length > 0
      ? dateOrdinal(dates[dates.length - 1]!)
        - dateOrdinal(dates[0]!)
        + 1
      : null;
  const daysSinceLastObservation =
    lastObservationMs == null
      ? null
      : Math.max(0, (nowMs - lastObservationMs) / DAY_MS);
  const highInformationRows = observations.filter(
    isHighInformation,
  ).length;
  const cadenceDays = observations.slice(1).map(
    (observation, index) =>
      (
        observation.endMs
        - observations[index]!.endMs
      ) / DAY_MS,
  );

  return {
    nowMs,
    timeZone,
    config,
    accounting,
    observations,
    states,
    timeline: states.slice(-config.maxTimelinePoints),
    recentMeasurements: observations
      .map((observation, index) => ({
        observation,
        state: states[index]!,
      }))
      .sort(
        (left, right) =>
          right.observation.endMs - left.observation.endMs,
      )
      .slice(0, config.maxRecentMeasurements),
    summary,
    coverage: {
      highInformationRows,
      qualifiedShare:
        accounting.returnedRows > 0
          ? round(observations.length / accounting.returnedRows)
          : null,
      activeLocalDays: dates.length,
      activeLocalWeeks: weeks.size,
      activeLocalMonths: months.size,
      firstObservationMs,
      lastObservationMs,
      observedSpanDays,
      daysSinceLastObservation,
      medianCadenceDays:
        cadenceDays.length > 0
          ? round(quantile(cadenceDays, 0.5)!, 1)
          : null,
      totalEnergyAddedWh: round(
        observations.reduce(
          (sum, observation) => sum + observation.energyAddedWh,
          0,
        ),
        3,
      ),
      returnedTrendMonths: trend.returnedMonths,
      displayedTrendMonths: trend.points.length,
      omittedTrendMonths:
        trend.returnedMonths - trend.points.length,
      timelinePoints: Math.min(
        states.length,
        config.maxTimelinePoints,
      ),
      omittedTimelinePoints: Math.max(
        0,
        states.length - config.maxTimelinePoints,
      ),
      omittedRecentMeasurements: Math.max(
        0,
        observations.length - config.maxRecentMeasurements,
      ),
      support: buildSupport(
        observations.length,
        highInformationRows,
        observedSpanDays ?? 0,
        months.size,
        daysSinceLastObservation,
      ),
    },
    monthTrend: trend.points,
    socWindowProfile: buildSocWindowProfile(observations, states),
    innovationProfile: buildInnovationProfile(states),
    windowSensitivity: buildWindowSensitivity(
      sessions,
      nowMs,
      timeZone,
      config,
    ),
    processSensitivity: buildProcessSensitivity(
      observations,
      timeZone,
      config,
    ),
  };
}
