import type { Drive } from '@/types/driving';

/**
 * Journey fragmentation is deliberately a descriptive analysis of the
 * returned drive-history window. It does not infer trip intent, causality, or
 * a counterfactual route.
 */
export const DEFAULT_MAX_PARKING_GAP_MIN = 120;
export const DEFAULT_SHORT_STOPOVER_MIN = 30;
export const DEFAULT_GPS_TOLERANCE_M = 250;
export const DEFAULT_SHORT_FRAGMENT_DISTANCE_M = 5_000;
export const DEFAULT_COMPACT_CHAIN_DISTANCE_M = 50_000;
export const DEFAULT_HISTORY_LIMIT = 1_000;
export const DEFAULT_MIN_ENERGY_SUPPORT_JOURNEYS = 3;
export const DEFAULT_MIN_EVIDENCE_ROWS = 3;
export const SENSITIVITY_THRESHOLDS_MIN = [30, 60, 120, 240] as const;

export type RowCategory =
  | 'included'
  | 'incompleteLive'
  | 'invalidTimestampOrder'
  | 'future'
  | 'invalidDuration';

export type PairCategory =
  | 'linked'
  | 'unusableSourceBoundary'
  | 'unlocatableEndpoint'
  | 'endpointMismatch'
  | 'overlapNegativeGap'
  | 'overSelectedGap';

export interface JourneyFragmentationOptions {
  maxParkingGapMin?: number;
  shortStopoverMaxMin?: number;
  gpsToleranceM?: number;
  shortFragmentDistanceM?: number;
  compactChainDistanceM?: number;
  historyLimit?: number;
  minimumEnergySupportJourneys?: number;
  minimumEvidenceRows?: number;
}

export interface ResolvedJourneyFragmentationOptions {
  maxParkingGapMin: number;
  shortStopoverMaxMin: number;
  gpsToleranceM: number;
  shortFragmentDistanceM: number;
  compactChainDistanceM: number;
  historyLimit: number;
  minimumEnergySupportJourneys: number;
  minimumEvidenceRows: number;
  sensitivityThresholdsMin: readonly number[];
}

export interface ClassifiedJourneyRow {
  driveId: number;
  sourceIndex: number;
  category: RowCategory;
  startMs: number | null;
  endMs: number | null;
  placedInSequence: boolean;
}

export interface Journey {
  driveIds: number[];
  startMs: number;
  endMs: number;
  startAddress: string | null;
  endAddress: string | null;
  fragments: number;
  parkingGapsMin: number[];
  shortStopovers: number;
  drivingSeconds: number;
  observedParkingSeconds: number;
  distanceM: number;
  energyUsedWh: number | null;
  completeEnergy: boolean;
  isCompactObservedChain: boolean;
}

export interface DistributionSummary {
  count: number;
  median: number | null;
  p90: number | null;
  maximum: number | null;
}

export interface ChainLengthPoint {
  fragments: number;
  journeyCount: number;
}

export interface GapHistogramPoint {
  lowerBoundMin: number;
  upperBoundMin: number | null;
  gapCount: number;
}

export interface EnergyGroupSummary {
  journeys: number;
  completeEnergyJourneys: number;
  totalDistanceM: number;
  completeEnergyDistanceM: number;
  distanceCoverage: number | null;
  energyIntensityWhPerM: number | null;
}

export interface EnergyComparison {
  singleDrive: EnergyGroupSummary;
  multiDrive: EnergyGroupSummary;
  observedDifferenceWhPerM: number | null;
  minimumSupportedJourneys: number;
  supportBand: 'supported' | 'thin' | 'unavailable';
}

export interface TemporalProfilePoint {
  key: string;
  label: string;
  journeyCount: number;
  driveCount: number;
}

export interface ThresholdSensitivityPoint {
  thresholdMin: number;
  journeyCount: number;
  linkedPairs: number;
  multiDriveJourneys: number;
}

export interface PairDetail {
  previousDriveId: number;
  currentDriveId: number;
  category: PairCategory;
  gapMin: number | null;
}

export interface JourneyFragmentationResult {
  timeZone: string;
  options: ResolvedJourneyFragmentationOptions;
  returnedRows: number;
  includedDrives: number;
  journeys: Journey[];
  journeyCount: number;
  linkedPairs: number;
  multiDriveJourneys: number;
  multiDriveShare: number | null;
  averageFragmentsPerJourney: number | null;
  chainLengthDistribution: ChainLengthPoint[];
  chainFragmentSummary: DistributionSummary;
  linkedGapSummary: DistributionSummary;
  gapHistogram: GapHistogramPoint[];
  drivingSeconds: number;
  observedParkingSeconds: number;
  shortFragmentCount: number;
  shortFragmentDenominator: number;
  shortFragmentDistanceM: number;
  shortFragmentDistanceShare: number | null;
  compactObservedChainCount: number;
  totalDistanceM: number;
  energyComparison: EnergyComparison;
  startHourProfile: TemporalProfilePoint[];
  startTwoHourProfile: TemporalProfilePoint[];
  weekdayProfile: TemporalProfilePoint[];
  monthlyProfile: TemporalProfilePoint[];
  activeDays: number;
  activeWeeks: number;
  returnedSpanStartMs: number | null;
  returnedSpanEndMs: number | null;
  returnedSpanDays: number | null;
  includedSpanStartMs: number | null;
  includedSpanEndMs: number | null;
  includedSpanDays: number | null;
  latestIncludedEndMs: number | null;
  daysSinceLatestIncludedDrive: number | null;
  historyLimit: number;
  capReached: boolean;
  evidenceBand: 'none' | 'thin' | 'observed' | 'capped';
  rowAccounting: {
    included: number;
    incompleteLive: number;
    invalidTimestampOrder: number;
    future: number;
    invalidDuration: number;
    excluded: number;
  };
  classifiedRows: ClassifiedJourneyRow[];
  pairAccounting: {
    totalAdjacentPairs: number;
    linked: number;
    unusableSourceBoundary: number;
    unlocatableEndpoint: number;
    endpointMismatch: number;
    overlapNegativeGap: number;
    overSelectedGap: number;
  };
  pairDetails: PairDetail[];
  sensitivity: ThresholdSensitivityPoint[];
}

interface ClassifiedInternal extends ClassifiedJourneyRow {
  drive: Drive;
}

interface TimedIncluded extends ClassifiedInternal {
  category: 'included';
  startMs: number;
  endMs: number;
}

interface BuiltSequence {
  items: ClassifiedInternal[];
  sourceBoundaryRows: number;
}

interface BuiltChains {
  journeys: Journey[];
  pairDetails: PairDetail[];
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveOption(value: unknown, fallback: number): number {
  const number = finiteOr(value, fallback);
  return number > 0 ? number : fallback;
}

function nonNegativeOption(value: unknown, fallback: number): number {
  const number = finiteOr(value, fallback);
  return number >= 0 ? number : fallback;
}

function integerOption(value: unknown, fallback: number, maximum?: number): number {
  const number = Math.floor(finiteOr(value, fallback));
  if (number < 1) return fallback;
  return maximum == null ? number : Math.min(number, maximum);
}

export function resolveJourneyFragmentationOptions(
  options: JourneyFragmentationOptions = {},
): ResolvedJourneyFragmentationOptions {
  return {
    maxParkingGapMin: nonNegativeOption(options.maxParkingGapMin, DEFAULT_MAX_PARKING_GAP_MIN),
    shortStopoverMaxMin: nonNegativeOption(options.shortStopoverMaxMin, DEFAULT_SHORT_STOPOVER_MIN),
    gpsToleranceM: positiveOption(options.gpsToleranceM, DEFAULT_GPS_TOLERANCE_M),
    shortFragmentDistanceM: positiveOption(
      options.shortFragmentDistanceM,
      DEFAULT_SHORT_FRAGMENT_DISTANCE_M,
    ),
    compactChainDistanceM: positiveOption(
      options.compactChainDistanceM,
      DEFAULT_COMPACT_CHAIN_DISTANCE_M,
    ),
    historyLimit: integerOption(options.historyLimit, DEFAULT_HISTORY_LIMIT, DEFAULT_HISTORY_LIMIT),
    minimumEnergySupportJourneys: integerOption(
      options.minimumEnergySupportJourneys,
      DEFAULT_MIN_ENERGY_SUPPORT_JOURNEYS,
    ),
    minimumEvidenceRows: integerOption(
      options.minimumEvidenceRows,
      DEFAULT_MIN_EVIDENCE_ROWS,
    ),
    sensitivityThresholdsMin: [...SENSITIVITY_THRESHOLDS_MIN],
  };
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function safeTimeZone(timeZone: unknown): string {
  const candidate = typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return 'UTC';
  }
}

function isLiveOrIncomplete(drive: Drive): boolean {
  if (drive.live === true || drive.endTs == null) return true;
  const status = typeof drive.endedStatus === 'string' ? drive.endedStatus.toLowerCase() : '';
  return status.includes('progress') || status === 'active' || status === 'started';
}

function classifyDrive(drive: Drive, sourceIndex: number, nowMs: number): ClassifiedInternal {
  const startMs = parseTimestamp(drive.startTs);
  const endMs = parseTimestamp(drive.endTs);
  let category: RowCategory;

  if (isLiveOrIncomplete(drive)) {
    category = 'incompleteLive';
  } else if (startMs == null || endMs == null || endMs <= startMs) {
    category = 'invalidTimestampOrder';
  } else if (startMs > nowMs || endMs > nowMs) {
    category = 'future';
  } else if (
    typeof drive.durationS !== 'number'
    || !Number.isFinite(drive.durationS)
    || drive.durationS <= 0
  ) {
    category = 'invalidDuration';
  } else {
    category = 'included';
  }

  return {
    drive,
    driveId: drive.id,
    sourceIndex,
    category,
    startMs,
    endMs,
    placedInSequence: startMs != null,
  };
}

function distanceM(drive: Drive): number {
  return typeof drive.distanceM === 'number' && Number.isFinite(drive.distanceM) && drive.distanceM > 0
    ? drive.distanceM
    : 0;
}

function energyWh(drive: Drive): number | null {
  return typeof drive.energyUsedWh === 'number'
    && Number.isFinite(drive.energyUsedWh)
    && drive.energyUsedWh >= 0
    ? drive.energyUsedWh
    : null;
}

function validCoordinate(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number'
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && typeof longitude === 'number'
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180;
}

function normalizeAddress(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  const normalized = address.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return normalized || null;
}

function hasGps(latitude: number | null, longitude: number | null): boolean {
  return validCoordinate(latitude, longitude);
}

function gpsDistanceM(
  firstLat: number,
  firstLon: number,
  secondLat: number,
  secondLon: number,
): number {
  const radians = Math.PI / 180;
  const lat1 = firstLat * radians;
  const lat2 = secondLat * radians;
  const deltaLat = (secondLat - firstLat) * radians;
  const deltaLon = (secondLon - firstLon) * radians;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function endpointMatch(previous: Drive, current: Drive, toleranceM: number): 'linked' | 'unlocatable' | 'mismatch' {
  const previousAddress = normalizeAddress(previous.endAddress);
  const currentAddress = normalizeAddress(current.startAddress);
  if (previousAddress != null && currentAddress != null && previousAddress === currentAddress) {
    return 'linked';
  }

  const previousGps = hasGps(previous.endLat, previous.endLon);
  const currentGps = hasGps(current.startLat, current.startLon);
  if (previousGps && currentGps) {
    return gpsDistanceM(
      previous.endLat as number,
      previous.endLon as number,
      current.startLat as number,
      current.startLon as number,
    ) <= toleranceM
      ? 'linked'
      : 'mismatch';
  }

  return previousAddress == null && !previousGps || currentAddress == null && !currentGps
    ? 'unlocatable'
    : 'mismatch';
}

function buildSequence(rows: readonly ClassifiedInternal[]): BuiltSequence {
  const sequence: ClassifiedInternal[] = [];
  let sortableChunk: ClassifiedInternal[] = [];
  let sourceBoundaryRows = 0;

  const flush = () => {
    sortableChunk = [...sortableChunk].sort(
      (first, second) => (first.startMs as number) - (second.startMs as number)
        || first.sourceIndex - second.sourceIndex,
    );
    sequence.push(...sortableChunk);
    sortableChunk = [];
  };

  for (const row of rows) {
    if (row.startMs == null) {
      flush();
      sequence.push(row);
      sourceBoundaryRows += 1;
    } else {
      sortableChunk.push(row);
    }
  }
  flush();
  return { items: sequence, sourceBoundaryRows };
}

function pairCategory(
  previous: ClassifiedInternal,
  current: ClassifiedInternal,
  maxParkingGapMin: number,
  gpsToleranceM: number,
): { category: PairCategory; gapMin: number | null } {
  if (previous.category !== 'included' || current.category !== 'included') {
    return { category: 'unusableSourceBoundary', gapMin: null };
  }

  const timedPrevious = previous as TimedIncluded;
  const timedCurrent = current as TimedIncluded;
  const gapMin = (timedCurrent.startMs - timedPrevious.endMs) / 60_000;
  if (gapMin < 0) return { category: 'overlapNegativeGap', gapMin };
  if (gapMin > maxParkingGapMin) return { category: 'overSelectedGap', gapMin };

  const endpoint = endpointMatch(previous.drive, current.drive, gpsToleranceM);
  if (endpoint === 'unlocatable') return { category: 'unlocatableEndpoint', gapMin };
  if (endpoint === 'mismatch') return { category: 'endpointMismatch', gapMin };
  return { category: 'linked', gapMin };
}

function journeyFromChain(
  chain: readonly TimedIncluded[],
  gapsMin: readonly number[],
  options: ResolvedJourneyFragmentationOptions,
): Journey {
  const totalDistanceM = chain.reduce((sum, row) => sum + distanceM(row.drive), 0);
  const energyRows = chain.map((row) => ({
    energy: energyWh(row.drive),
    distance: distanceM(row.drive),
  }));
  const completeEnergy = energyRows.every((row) => row.energy != null && row.distance > 0);
  const energyUsedWh = completeEnergy
    ? energyRows.reduce((sum, row) => sum + (row.energy as number), 0)
    : null;
  return {
    driveIds: chain.map((row) => row.drive.id),
    startMs: chain[0]!.startMs,
    endMs: chain[chain.length - 1]!.endMs,
    startAddress: chain[0]!.drive.startAddress ?? null,
    endAddress: chain[chain.length - 1]!.drive.endAddress ?? null,
    fragments: chain.length,
    parkingGapsMin: [...gapsMin],
    shortStopovers: gapsMin.filter((gap) => gap <= options.shortStopoverMaxMin).length,
    drivingSeconds: chain.reduce(
      (sum, row) => sum + (Number.isFinite(row.drive.durationS) ? row.drive.durationS : 0),
      0,
    ),
    observedParkingSeconds: gapsMin.reduce((sum, gap) => sum + gap * 60, 0),
    distanceM: totalDistanceM,
    energyUsedWh,
    completeEnergy,
    isCompactObservedChain:
      chain.length > 1
      && gapsMin.every((gap) => gap <= options.shortStopoverMaxMin)
      && totalDistanceM <= options.compactChainDistanceM,
  };
}

function buildChains(
  sequence: readonly ClassifiedInternal[],
  options: ResolvedJourneyFragmentationOptions,
  maxParkingGapMin: number,
): BuiltChains {
  const journeys: Journey[] = [];
  const pairDetails: PairDetail[] = [];
  let chain: TimedIncluded[] = [];
  let gapsMin: number[] = [];

  const flush = () => {
    if (chain.length > 0) {
      journeys.push(journeyFromChain(chain, gapsMin, options));
    }
    chain = [];
    gapsMin = [];
  };

  for (let index = 0; index < sequence.length; index += 1) {
    const current = sequence[index]!;
    if (index > 0) {
      const previous = sequence[index - 1]!;
      const pair = pairCategory(previous, current, maxParkingGapMin, options.gpsToleranceM);
      pairDetails.push({
        previousDriveId: previous.drive.id,
        currentDriveId: current.drive.id,
        category: pair.category,
        gapMin: pair.gapMin,
      });
      if (pair.category === 'linked' && current.category === 'included') {
        chain.push(current as TimedIncluded);
        gapsMin.push(pair.gapMin as number);
        continue;
      }
    }

    if (current.category === 'included') {
      flush();
      chain = [current as TimedIncluded];
    } else {
      flush();
    }
  }
  flush();
  return { journeys, pairDetails };
}

function distributionSummary(values: readonly number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, median: null, p90: null, maximum: null };
  }
  const sorted = [...values].sort((first, second) => first - second);
  const quantile = (fraction: number): number => {
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower]!;
    return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
  };
  return {
    count: sorted.length,
    median: quantile(0.5),
    p90: quantile(0.9),
    maximum: sorted[sorted.length - 1]!,
  };
}

function buildGapHistogram(gaps: readonly number[]): GapHistogramPoint[] {
  const bounds = [0, 15, 30, 60, 120, 240] as const;
  return bounds.map((lowerBoundMin, index) => {
    const upperBoundMin = bounds[index + 1] ?? null;
    return {
      lowerBoundMin,
      upperBoundMin,
      gapCount: gaps.filter((gap) =>
        gap >= lowerBoundMin && (upperBoundMin == null ? true : gap < upperBoundMin),
      ).length,
    };
  });
}

function groupEnergy(journeys: readonly Journey[], multiDrive: boolean): EnergyGroupSummary {
  const group = journeys.filter((journey) => multiDrive ? journey.fragments > 1 : journey.fragments === 1);
  const complete = group.filter((journey) => journey.completeEnergy && journey.energyUsedWh != null);
  const totalDistanceM = group.reduce((sum, journey) => sum + journey.distanceM, 0);
  const completeEnergyDistanceM = complete.reduce((sum, journey) => sum + journey.distanceM, 0);
  const totalEnergyWh = complete.reduce((sum, journey) => sum + (journey.energyUsedWh as number), 0);
  return {
    journeys: group.length,
    completeEnergyJourneys: complete.length,
    totalDistanceM,
    completeEnergyDistanceM,
    distanceCoverage: totalDistanceM > 0 ? completeEnergyDistanceM / totalDistanceM : null,
    energyIntensityWhPerM:
      completeEnergyDistanceM > 0 ? totalEnergyWh / completeEnergyDistanceM : null,
  };
}

function profileParts(ms: number, timeZone: string): {
  dateKey: string;
  monthKey: string;
  hour: number;
  weekday: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(ms)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const year = parts.year ?? '0000';
  const month = parts.month ?? '01';
  const day = parts.day ?? '01';
  const hourValue = Number(parts.hour ?? 0);
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    dateKey: `${year}-${month}-${day}`,
    monthKey: `${year}-${month}`,
    hour: Number.isFinite(hourValue) ? hourValue % 24 : 0,
    weekday: Math.max(0, weekdayNames.indexOf(parts.weekday ?? 'Sun')),
  };
}

function isoWeekKey(dateKey: string): string {
  const [yearText, monthText, dayText] = dateKey.split('-');
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const weekYear = date.getUTCFullYear();
  const firstDay = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((date.getTime() - firstDay.getTime()) / 86_400_000) + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

function profile(
  journeys: readonly Journey[],
  timeZone: string,
  mode: 'hour' | 'twoHour' | 'weekday' | 'month',
): TemporalProfilePoint[] {
  if (journeys.length === 0) return [];
  const fixedKeys = mode === 'hour'
    ? Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))
    : mode === 'twoHour'
      ? Array.from({ length: 12 }, (_, index) => String(index * 2).padStart(2, '0'))
      : mode === 'weekday'
        ? Array.from({ length: 7 }, (_, index) => String(index))
        : [];
  const counts = new Map<string, { journeyCount: number; driveCount: number; label: string }>();
  for (const key of fixedKeys) {
    counts.set(key, {
      journeyCount: 0,
      driveCount: 0,
      label: mode === 'weekday' ? key : `${key}:00`,
    });
  }
  for (const journey of journeys) {
    const parts = profileParts(journey.startMs, timeZone);
    const key = mode === 'hour'
      ? String(parts.hour).padStart(2, '0')
      : mode === 'twoHour'
        ? String(Math.floor(parts.hour / 2) * 2).padStart(2, '0')
        : mode === 'weekday'
          ? String(parts.weekday)
          : parts.monthKey;
    const label = mode === 'month' ? parts.monthKey : `${key}:00`;
    const current = counts.get(key) ?? { journeyCount: 0, driveCount: 0, label };
    current.journeyCount += 1;
    current.driveCount += journey.fragments;
    counts.set(key, current);
  }
  return [...counts.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => ({ key, ...value }));
}

function activeCalendarCounts(
  drives: readonly TimedIncluded[],
  timeZone: string,
): { days: number; weeks: number } {
  const days = new Set<string>();
  const weeks = new Set<string>();
  for (const drive of drives) {
    const dateKey = profileParts(drive.startMs, timeZone).dateKey;
    days.add(dateKey);
    weeks.add(isoWeekKey(dateKey));
  }
  return { days: days.size, weeks: weeks.size };
}

function span(
  rows: readonly ClassifiedInternal[],
  includedOnly: boolean,
): { startMs: number | null; endMs: number | null; days: number | null } {
  const eligible = rows.filter((row) =>
    (!includedOnly || row.category === 'included')
    && row.startMs != null
    && row.endMs != null,
  );
  if (eligible.length === 0) return { startMs: null, endMs: null, days: null };
  const startMs = Math.min(...eligible.map((row) => row.startMs as number));
  const endMs = Math.max(...eligible.map((row) => row.endMs as number));
  return { startMs, endMs, days: Math.max(0, endMs - startMs) / 86_400_000 };
}

function pairAccounting(details: readonly PairDetail[]): JourneyFragmentationResult['pairAccounting'] {
  const count = (category: PairCategory) => details.filter((pair) => pair.category === category).length;
  return {
    totalAdjacentPairs: details.length,
    linked: count('linked'),
    unusableSourceBoundary: count('unusableSourceBoundary'),
    unlocatableEndpoint: count('unlocatableEndpoint'),
    endpointMismatch: count('endpointMismatch'),
    overlapNegativeGap: count('overlapNegativeGap'),
    overSelectedGap: count('overSelectedGap'),
  };
}

export function analyzeJourneyFragmentation(
  drives: readonly Drive[],
  nowMs = 0,
  timeZone = 'UTC',
  rawOptions: JourneyFragmentationOptions = {},
): JourneyFragmentationResult {
  const options = resolveJourneyFragmentationOptions(rawOptions);
  const analysisNowMs = finiteOr(nowMs, 0);
  const normalizedTimeZone = safeTimeZone(timeZone);
  const input = Array.isArray(drives) ? drives : [];
  const classified = input.map((drive, sourceIndex) =>
    classifyDrive(drive, sourceIndex, analysisNowMs),
  );
  const sequence = buildSequence(classified);
  const selected = buildChains(sequence.items, options, options.maxParkingGapMin);
  const journeys = selected.journeys;
  const includedRows = classified.filter((row): row is TimedIncluded => row.category === 'included');
  const linkedGaps = selected.pairDetails
    .filter((pair) => pair.category === 'linked' && pair.gapMin != null)
    .map((pair) => pair.gapMin as number);
  const multiDriveJourneys = journeys.filter((journey) => journey.fragments > 1).length;
  const totalDistanceM = journeys.reduce((sum, journey) => sum + journey.distanceM, 0);
  const shortRows = includedRows.filter((row) => {
    const distance = distanceM(row.drive);
    return distance > 0 && distance <= options.shortFragmentDistanceM;
  });
  const singleEnergy = groupEnergy(journeys, false);
  const multiEnergy = groupEnergy(journeys, true);
  const energySupport =
    singleEnergy.completeEnergyJourneys >= options.minimumEnergySupportJourneys
    && multiEnergy.completeEnergyJourneys >= options.minimumEnergySupportJourneys;
  const energyAvailable = singleEnergy.energyIntensityWhPerM != null
    && multiEnergy.energyIntensityWhPerM != null;
  const rowAccounting = {
    included: classified.filter((row) => row.category === 'included').length,
    incompleteLive: classified.filter((row) => row.category === 'incompleteLive').length,
    invalidTimestampOrder: classified.filter((row) => row.category === 'invalidTimestampOrder').length,
    future: classified.filter((row) => row.category === 'future').length,
    invalidDuration: classified.filter((row) => row.category === 'invalidDuration').length,
    excluded: classified.filter((row) => row.category !== 'included').length,
  };
  const returnedSpan = span(classified, false);
  const includedSpan = span(classified, true);
  const calendarCounts = activeCalendarCounts(includedRows, normalizedTimeZone);
  const sensitivity = options.sensitivityThresholdsMin.map((thresholdMin) => {
    const thresholdChains = buildChains(sequence.items, options, thresholdMin);
    return {
      thresholdMin,
      journeyCount: thresholdChains.journeys.length,
      linkedPairs: thresholdChains.pairDetails.filter((pair) => pair.category === 'linked').length,
      multiDriveJourneys: thresholdChains.journeys.filter((journey) => journey.fragments > 1).length,
    };
  });
  const chainLengths = journeys.map((journey) => journey.fragments);
  const chainLengthDistribution = [...new Set(chainLengths)]
    .sort((first, second) => first - second)
    .map((fragments) => ({
      fragments,
      journeyCount: chainLengths.filter((value) => value === fragments).length,
    }));
  const rowCategoryCounts = rowAccounting.included
    + rowAccounting.incompleteLive
    + rowAccounting.invalidTimestampOrder
    + rowAccounting.future
    + rowAccounting.invalidDuration;
  // Keep this assertion out of production control flow while still making
  // accidental category drift obvious during development and tests.
  if (rowCategoryCounts !== classified.length) {
    throw new Error('Journey row accounting lost a returned row');
  }

  return {
    timeZone: normalizedTimeZone,
    options,
    returnedRows: input.length,
    includedDrives: rowAccounting.included,
    journeys,
    journeyCount: journeys.length,
    linkedPairs: selected.pairDetails.filter((pair) => pair.category === 'linked').length,
    multiDriveJourneys,
    multiDriveShare: journeys.length > 0 ? multiDriveJourneys / journeys.length : null,
    averageFragmentsPerJourney: journeys.length > 0 ? includedRows.length / journeys.length : null,
    chainLengthDistribution,
    chainFragmentSummary: distributionSummary(chainLengths),
    linkedGapSummary: distributionSummary(linkedGaps),
    gapHistogram: buildGapHistogram(linkedGaps),
    drivingSeconds: journeys.reduce((sum, journey) => sum + journey.drivingSeconds, 0),
    observedParkingSeconds: journeys.reduce((sum, journey) => sum + journey.observedParkingSeconds, 0),
    shortFragmentCount: shortRows.length,
    shortFragmentDenominator: includedRows.length,
    shortFragmentDistanceM: shortRows.reduce((sum, row) => sum + distanceM(row.drive), 0),
    shortFragmentDistanceShare:
      totalDistanceM > 0
        ? shortRows.reduce((sum, row) => sum + distanceM(row.drive), 0) / totalDistanceM
        : null,
    compactObservedChainCount: journeys.filter((journey) => journey.isCompactObservedChain).length,
    totalDistanceM,
    energyComparison: {
      singleDrive: singleEnergy,
      multiDrive: multiEnergy,
      observedDifferenceWhPerM:
        energyAvailable
          ? (multiEnergy.energyIntensityWhPerM as number)
            - (singleEnergy.energyIntensityWhPerM as number)
          : null,
      minimumSupportedJourneys: options.minimumEnergySupportJourneys,
      supportBand: !energyAvailable ? 'unavailable' : energySupport ? 'supported' : 'thin',
    },
    startHourProfile: profile(journeys, normalizedTimeZone, 'hour'),
    startTwoHourProfile: profile(journeys, normalizedTimeZone, 'twoHour'),
    weekdayProfile: profile(journeys, normalizedTimeZone, 'weekday'),
    monthlyProfile: profile(journeys, normalizedTimeZone, 'month'),
    activeDays: calendarCounts.days,
    activeWeeks: calendarCounts.weeks,
    returnedSpanStartMs: returnedSpan.startMs,
    returnedSpanEndMs: returnedSpan.endMs,
    returnedSpanDays: returnedSpan.days,
    includedSpanStartMs: includedSpan.startMs,
    includedSpanEndMs: includedSpan.endMs,
    includedSpanDays: includedSpan.days,
    latestIncludedEndMs: includedSpan.endMs,
    daysSinceLatestIncludedDrive:
      includedSpan.endMs == null ? null : Math.max(0, analysisNowMs - includedSpan.endMs) / 86_400_000,
    historyLimit: options.historyLimit,
    capReached: input.length >= options.historyLimit,
    evidenceBand:
      input.length === 0
        ? 'none'
        : input.length >= options.historyLimit
          ? 'capped'
          : rowAccounting.included < options.minimumEvidenceRows
            ? 'thin'
            : 'observed',
    rowAccounting,
    classifiedRows: classified.map(({ drive: _drive, ...row }) => ({ ...row })),
    pairAccounting: pairAccounting(selected.pairDetails),
    pairDetails: selected.pairDetails,
    sensitivity,
  };
}
