/**
 * Descriptive first-order destination-transition evidence.
 *
 * A transition is accepted only when two chronologically adjacent returned
 * rows are both usable and the earlier drive's end matches the later drive's
 * start. Calendar fields are derived in an explicit IANA timezone and the
 * analysis clock is injected by the caller.
 */
import type { Drive } from '@/types/driving';

const MS_PER_DAY = 86_400_000;
const BUCKET_HOURS = 2;
const EARTH_RADIUS_M = 6_371_000;
const MAX_OPTION_COUNT = 1_000_000;
const MAX_GPS_TOLERANCE_M = 10_000;
const MAX_CONTINUITY_GAP_MS = 10 * 366 * MS_PER_DAY;

export type DestinationEvidenceBand =
  | 'none'
  | 'thin'
  | 'developing'
  | 'strong';

export type DestinationRowCategory =
  | 'included'
  | 'incomplete_timestamp'
  | 'invalid_timestamp_or_order'
  | 'future'
  | 'invalid_duration'
  | 'unlocatable_end';

export type LatestRowCategory =
  | DestinationRowCategory
  | 'none'
  | 'indeterminate';

export interface DestinationTransitionOptions {
  historyLimit?: number;
  gpsToleranceM?: number;
  maxContinuityGapMs?: number | null;
  minSupportedOriginTransitions?: number;
  strongOriginTransitions?: number;
  strongOriginActiveDays?: number;
  strongOriginActiveWeeks?: number;
  strongTemporalSamples?: number;
  topMatrixStateLimit?: number;
}

export interface ResolvedDestinationTransitionOptions {
  historyLimit: number;
  gpsToleranceM: number;
  maxContinuityGapMs: number | null;
  minSupportedOriginTransitions: number;
  strongOriginTransitions: number;
  strongOriginActiveDays: number;
  strongOriginActiveWeeks: number;
  strongTemporalSamples: number;
  topMatrixStateLimit: number;
}

export interface DestinationLocation {
  key: string;
  label: string;
}

export interface DestinationSupport {
  supported: boolean;
  index: number;
  band: DestinationEvidenceBand;
  outgoingTransitionIngredient: number;
  activeDayIngredient: number;
  activeWeekIngredient: number;
  recurrenceIngredient: number;
  recurrenceCount: number;
  recurrenceShare: number;
}

export interface DestinationState {
  key: string;
  label: string;
  visits: number;
  visitShare: number;
  activeLocalDays: number;
  activeLocalWeeks: number;
  firstVisitMs: number;
  lastVisitMs: number;
  outgoingTransitions: number;
  outgoingActiveLocalDays: number;
  outgoingActiveLocalWeeks: number;
  distinctObservedSuccessors: number;
  entropyBits: number | null;
  effectiveSuccessorCount: number | null;
  transitionConcentrationIndex: number | null;
  leadingSuccessorKey: string | null;
  leadingSuccessorLabel: string | null;
  leadingSuccessorCount: number;
  leadingSuccessorObservedShare: number | null;
  support: DestinationSupport;
}

export interface DestinationEdge {
  fromKey: string;
  fromLabel: string;
  toKey: string;
  toLabel: string;
  count: number;
  observedConditionalShare: number;
  shareOfAcceptedTransitions: number;
  empiricalInformationBits: number;
  firstObservationMs: number;
  lastObservationMs: number;
  activeLocalDays: number;
  activeLocalWeeks: number;
  originSupported: boolean;
  originSupportBand: DestinationEvidenceBand;
}

export type TransitionCellStatus =
  | 'observed'
  | 'unobserved'
  | 'unsupported_origin';

export interface TransitionMatrixCell {
  toKey: string;
  toLabel: string;
  count: number;
  observedConditionalShare: number | null;
  status: TransitionCellStatus;
}

export interface TransitionMatrixRow {
  fromKey: string;
  fromLabel: string;
  outgoingTransitions: number;
  originSupported: boolean;
  supportBand: DestinationEvidenceBand;
  entropyBits: number | null;
  transitionConcentrationIndex: number | null;
  cells: TransitionMatrixCell[];
}

export interface DestinationRowAccounting {
  returnedRows: number;
  includedRows: number;
  excludedRows: number;
  incompleteTimestampRows: number;
  invalidTimestampOrOrderRows: number;
  futureRows: number;
  invalidDurationRows: number;
  unlocatableEndDestinationRows: number;
  chronologicallyPlacedRows: number;
  unplacedRows: number;
  historyLimit: number;
  historyCapReached: boolean;
}

export interface DestinationContinuityAccounting {
  adjacentCandidatePairs: number;
  acceptedTransitions: number;
  excludedPairs: number;
  excludedUnusableRowPairs: number;
  excludedCurrentStartUnlocatablePairs: number;
  excludedEndpointMismatchPairs: number;
  excludedOverlapOrNegativeGapPairs: number;
  excludedLongGapPairs: number;
}

export interface TemporalSampleSupport {
  supported: boolean;
  index: number;
  band: DestinationEvidenceBand;
}

export interface TemporalTransitionPoint {
  samples: number;
  distinctOrigins: number;
  distinctDestinations: number;
  distinctEdges: number;
  leadingEdgeCount: number;
  leadingEdgeShare: number | null;
  weightedEntropyBits: number | null;
  transitionConcentrationIndex: number | null;
  support: TemporalSampleSupport;
}

export interface TwoHourTransitionPoint extends TemporalTransitionPoint {
  bucketStartHour: number;
}

export interface WeekdayTransitionPoint extends TemporalTransitionPoint {
  weekday: number;
}

export interface MonthTransitionPoint extends TemporalTransitionPoint {
  monthKey: string;
  firstObservationMs: number;
}

export interface HistoricalLeadingSuccessor {
  fromKey: string;
  fromLabel: string;
  toKey: string;
  toLabel: string;
  count: number;
  outgoingTransitions: number;
  observedShare: number;
  supportedOrigin: boolean;
  supportBand: DestinationEvidenceBand;
}

export interface LatestDestinationState {
  key: string;
  label: string;
  observedAtMs: number;
  ageDays: number;
  outgoingTransitions: number;
  supportedOrigin: boolean;
  supportBand: DestinationEvidenceBand;
  historicalLeadingSuccessor: HistoricalLeadingSuccessor | null;
}

export interface DestinationTransitionEvidence {
  activeLocalDays: number;
  activeLocalWeeks: number;
  returnedFirstObservationMs: number | null;
  returnedLastObservationMs: number | null;
  returnedSpanDays: number | null;
  firstIncludedVisitMs: number | null;
  lastIncludedVisitMs: number | null;
  includedSpanDays: number | null;
  daysSinceLastIncludedVisit: number | null;
  firstAcceptedTransitionMs: number | null;
  lastAcceptedTransitionMs: number | null;
  acceptedTransitionSpanDays: number | null;
  originsWithOutgoingEvidence: number;
  supportedOriginStates: number;
  unsupportedOriginStates: number;
  supportedOriginTransitionCoverage: number | null;
  weightedEntropyBits: number | null;
  effectiveSuccessorCount: number | null;
  transitionConcentrationIndex: number | null;
  weightedOriginSupportIndex: number | null;
  weightedOutgoingTransitionIngredient: number | null;
  weightedActiveDayIngredient: number | null;
  weightedActiveWeekIngredient: number | null;
  weightedRecurrenceIngredient: number | null;
  destinationVisitConcentration: number | null;
  acceptedEdgeConcentration: number | null;
  latestStateAgeDays: number | null;
}

export interface DestinationTransitionResult {
  nowMs: number;
  timeZone: string;
  config: ResolvedDestinationTransitionOptions;
  accounting: DestinationRowAccounting;
  continuity: DestinationContinuityAccounting;
  includedVisits: number;
  acceptedTransitions: number;
  uniqueDestinations: number;
  states: DestinationState[];
  edges: DestinationEdge[];
  frequentEdges: DestinationEdge[];
  empiricallyRareEdges: DestinationEdge[];
  matrix: TransitionMatrixRow[];
  topMatrix: TransitionMatrixRow[];
  twoHourProfile: TwoHourTransitionPoint[];
  weekdayProfile: WeekdayTransitionPoint[];
  monthTrend: MonthTransitionPoint[];
  evidence: DestinationTransitionEvidence;
  latestRowCategory: LatestRowCategory;
  latestState: LatestDestinationState | null;
}

interface ZonedParts {
  hour: number;
  weekday: number;
  dateKey: string;
  monthKey: string;
  weekKey: string;
}

interface NormalizedEndpoint extends DestinationLocation {
  addressKey: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface DriveRecord {
  sourceIndex: number;
  category: DestinationRowCategory;
  startMs: number | null;
  endMs: number | null;
  start: NormalizedEndpoint | null;
  destination: NormalizedEndpoint | null;
  visitZoned: ZonedParts | null;
}

interface IncludedRecord extends DriveRecord {
  category: 'included';
  startMs: number;
  endMs: number;
  destination: NormalizedEndpoint;
  visitZoned: ZonedParts;
}

interface AcceptedTransitionRecord {
  fromKey: string;
  toKey: string;
  observedMs: number;
  zoned: ZonedParts;
}

interface StateAccumulator {
  key: string;
  label: string;
  visits: number;
  visitDays: Set<string>;
  visitWeeks: Set<string>;
  firstVisitMs: number;
  lastVisitMs: number;
}

interface EdgeAccumulator {
  fromKey: string;
  toKey: string;
  count: number;
  firstObservationMs: number;
  lastObservationMs: number;
  days: Set<string>;
  weeks: Set<string>;
}

const DEFAULTS: ResolvedDestinationTransitionOptions = {
  historyLimit: 1_000,
  gpsToleranceM: 250,
  maxContinuityGapMs: null,
  minSupportedOriginTransitions: 3,
  strongOriginTransitions: 12,
  strongOriginActiveDays: 8,
  strongOriginActiveWeeks: 6,
  strongTemporalSamples: 12,
  topMatrixStateLimit: 8,
};

const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function clamp(value: number, minimum = 0, maximum = 1): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum = MAX_OPTION_COUNT,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const integer = Math.floor(value);
  if (integer < minimum) return fallback;
  return Math.min(maximum, integer);
}

function boundedPositive(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || !Number.isFinite(value) || value < minimum) {
    return fallback;
  }
  return Math.min(maximum, value);
}

function resolveOptions(
  options: DestinationTransitionOptions,
): ResolvedDestinationTransitionOptions {
  const minSupportedOriginTransitions = boundedInteger(
    options.minSupportedOriginTransitions,
    DEFAULTS.minSupportedOriginTransitions,
    3,
  );
  const maxGapCandidate = options.maxContinuityGapMs;
  const maxContinuityGapMs =
    maxGapCandidate != null
    && Number.isFinite(maxGapCandidate)
    && maxGapCandidate > 0
      ? Math.min(MAX_CONTINUITY_GAP_MS, Math.max(1_000, maxGapCandidate))
      : null;
  return {
    historyLimit: boundedInteger(
      options.historyLimit,
      DEFAULTS.historyLimit,
      1,
    ),
    gpsToleranceM: boundedPositive(
      options.gpsToleranceM,
      DEFAULTS.gpsToleranceM,
      1,
      MAX_GPS_TOLERANCE_M,
    ),
    maxContinuityGapMs,
    minSupportedOriginTransitions,
    strongOriginTransitions: boundedInteger(
      options.strongOriginTransitions,
      Math.max(
        DEFAULTS.strongOriginTransitions,
        minSupportedOriginTransitions,
      ),
      minSupportedOriginTransitions,
    ),
    strongOriginActiveDays: boundedInteger(
      options.strongOriginActiveDays,
      DEFAULTS.strongOriginActiveDays,
      1,
    ),
    strongOriginActiveWeeks: boundedInteger(
      options.strongOriginActiveWeeks,
      DEFAULTS.strongOriginActiveWeeks,
      1,
    ),
    strongTemporalSamples: boundedInteger(
      options.strongTemporalSamples,
      Math.max(
        DEFAULTS.strongTemporalSamples,
        minSupportedOriginTransitions,
      ),
      minSupportedOriginTransitions,
    ),
    topMatrixStateLimit: boundedInteger(
      options.topMatrixStateLimit,
      DEFAULTS.topMatrixStateLimit,
      1,
      20,
    ),
  };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedAddress(value: unknown): {
  key: string;
  label: string;
} | null {
  if (typeof value !== 'string') return null;
  const label = value.trim().replace(/\s+/g, ' ');
  if (!label) return null;
  const key = label
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return key ? { key, label } : null;
}

function validCoordinate(
  latitude: unknown,
  longitude: unknown,
): { latitude: number; longitude: number } | null {
  if (
    typeof latitude !== 'number'
    || typeof longitude !== 'number'
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function coordinateLabel(value: number): string {
  const rounded = Math.round(value * 1_000) / 1_000;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(3);
}

function normalizeEndpoint(
  address: unknown,
  latitude: unknown,
  longitude: unknown,
): NormalizedEndpoint | null {
  const normalized = normalizedAddress(address);
  const coordinates = validCoordinate(latitude, longitude);
  if (normalized) {
    return {
      key: `address:${normalized.key}`,
      label: normalized.label,
      addressKey: normalized.key,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
    };
  }
  if (!coordinates) return null;
  const label =
    `${coordinateLabel(coordinates.latitude)}, `
    + coordinateLabel(coordinates.longitude);
  return {
    key: `geo:${label.replace(' ', '')}`,
    label,
    addressKey: null,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  };
}

/** Normalize an end destination using address first, then rounded GPS. */
export function normalizeDestination(
  drive: Pick<Drive, 'endAddress' | 'endLat' | 'endLon'>,
): DestinationLocation | null {
  const endpoint = normalizeEndpoint(
    drive.endAddress,
    drive.endLat,
    drive.endLon,
  );
  return endpoint ? { key: endpoint.key, label: endpoint.label } : null;
}

/** Validate an IANA timezone, falling back deterministically to UTC. */
export function normalizeDestinationTimeZone(timeZone: string): string {
  const candidate =
    typeof timeZone === 'string' && timeZone.trim()
      ? timeZone.trim()
      : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return 'UTC';
  }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const days = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return days[month - 1] ?? 0;
}

/**
 * Parse API timestamps deterministically.
 *
 * Offset-free ISO values are interpreted as UTC rather than browser-local
 * time. Impossible calendar fields and malformed offsets are rejected.
 */
export function parseDestinationTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      trimmed,
    );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hasTime = match[4] != null;
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    return null;
  }
  const offset = match[8];
  if (!hasTime && offset) return null;
  if (offset && offset.toUpperCase() !== 'Z') {
    const offsetMatch = /^[+-](\d{2}):?(\d{2})$/.exec(offset);
    if (
      !offsetMatch
      || Number(offsetMatch[1]) > 23
      || Number(offsetMatch[2]) > 59
    ) {
      return null;
    }
  }
  const candidate = hasTime
    ? offset
      ? trimmed
      : `${trimmed}Z`
    : `${trimmed}T00:00:00.000Z`;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
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
      hourCycle: 'h23',
      weekday: 'short',
    },
  );
  PARTS_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function shiftDateKey(dateKey: string, days: number): string {
  const [year = 1, month = 1, day = 1] = dateKey.split('-').map(Number);
  const shifted = new Date(0);
  shifted.setUTCHours(12, 0, 0, 0);
  shifted.setUTCFullYear(year, month - 1, day + days);
  return [
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  const year = Number(part('year'));
  const month = Number(part('month'));
  const day = Number(part('day'));
  const rawHour = Number(part('hour'));
  const hour = rawHour === 24 ? 0 : Math.floor(clamp(rawHour, 0, 23));
  const weekdayNames: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayNames[part('weekday')] ?? 0;
  const yearLabel = String(year).padStart(4, '0');
  const monthLabel = String(month).padStart(2, '0');
  const dayLabel = String(day).padStart(2, '0');
  const dateKey = `${yearLabel}-${monthLabel}-${dayLabel}`;
  return {
    hour,
    weekday,
    dateKey,
    monthKey: `${yearLabel}-${monthLabel}`,
    weekKey: shiftDateKey(dateKey, -((weekday + 6) % 7)),
  };
}

function explicitlyIncomplete(drive: Drive): boolean {
  if (drive.live === true) return true;
  const status =
    typeof drive.endedStatus === 'string'
      ? drive.endedStatus.trim().toLocaleLowerCase('en-US')
      : '';
  return [
    'active',
    'driving',
    'in progress',
    'in_progress',
    'started',
  ].includes(status);
}

function classifyRecord(
  drive: Drive,
  sourceIndex: number,
  nowMs: number,
  timeZone: string,
): DriveRecord {
  const startText =
    typeof drive.startTs === 'string' ? drive.startTs.trim() : '';
  const endText =
    typeof drive.endTs === 'string' ? drive.endTs.trim() : '';
  const startMs = parseDestinationTimestamp(drive.startTs);
  const endMs = parseDestinationTimestamp(drive.endTs);
  const start = normalizeEndpoint(
    drive.startAddress,
    drive.startLat,
    drive.startLon,
  );
  const destination = normalizeEndpoint(
    drive.endAddress,
    drive.endLat,
    drive.endLon,
  );
  const base = {
    sourceIndex,
    startMs,
    endMs,
    start,
    destination,
    visitZoned: null,
  };
  if (!startText || !endText || explicitlyIncomplete(drive)) {
    return { ...base, category: 'incomplete_timestamp' };
  }
  if (startMs == null || endMs == null || endMs <= startMs) {
    return { ...base, category: 'invalid_timestamp_or_order' };
  }
  if (startMs > nowMs || endMs > nowMs) {
    return { ...base, category: 'future' };
  }
  if (
    typeof drive.durationS !== 'number'
    || !Number.isFinite(drive.durationS)
    || drive.durationS <= 0
  ) {
    return { ...base, category: 'invalid_duration' };
  }
  if (!destination) {
    return { ...base, category: 'unlocatable_end' };
  }
  return {
    ...base,
    category: 'included',
    startMs,
    endMs,
    destination,
    visitZoned: zonedParts(endMs, timeZone),
  };
}

function isIncluded(record: DriveRecord): record is IncludedRecord {
  return record.category === 'included';
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function endpointDistanceM(
  left: NormalizedEndpoint,
  right: NormalizedEndpoint,
): number | null {
  if (
    left.latitude == null
    || left.longitude == null
    || right.latitude == null
    || right.longitude == null
  ) {
    return null;
  }
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude)
      * Math.cos(rightLatitude)
      * Math.sin(longitudeDelta / 2) ** 2;
  const boundedA = clamp(a);
  const distance =
    2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(boundedA), Math.sqrt(1 - boundedA));
  return finiteOrNull(distance);
}

function endpointsMatch(
  previousEnd: NormalizedEndpoint,
  currentStart: NormalizedEndpoint,
  toleranceM: number,
): boolean {
  if (
    previousEnd.addressKey
    && currentStart.addressKey
    && previousEnd.addressKey === currentStart.addressKey
  ) {
    return true;
  }
  const distance = endpointDistanceM(previousEnd, currentStart);
  return distance != null && distance <= toleranceM;
}

function entropyFromCounts(counts: readonly number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return 0;
  const result = counts.reduce((sum, count) => {
    if (count <= 0) return sum;
    const share = count / total;
    return sum - share * Math.log2(share);
  }, 0);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

function rowConcentration(entropyBits: number, successors: number): number {
  if (successors <= 0) return 0;
  if (successors === 1) return 1;
  const denominator = Math.log2(successors);
  return clamp(1 - entropyBits / denominator);
}

function evidenceBand(
  index: number,
  hasEvidence: boolean,
  supported: boolean,
): DestinationEvidenceBand {
  if (!hasEvidence) return 'none';
  if (!supported || index < 35) return 'thin';
  if (index < 70) return 'developing';
  return 'strong';
}

function originSupport(
  outgoingTransitions: number,
  activeDays: number,
  activeWeeks: number,
  distinctSuccessors: number,
  config: ResolvedDestinationTransitionOptions,
): DestinationSupport {
  const supported =
    outgoingTransitions >= config.minSupportedOriginTransitions;
  const outgoingTransitionIngredient = clamp(
    outgoingTransitions / config.strongOriginTransitions,
  );
  const activeDayIngredient = clamp(
    activeDays / config.strongOriginActiveDays,
  );
  const activeWeekIngredient = clamp(
    activeWeeks / config.strongOriginActiveWeeks,
  );
  const recurrenceCount = Math.max(
    0,
    outgoingTransitions - distinctSuccessors,
  );
  const recurrenceShare =
    outgoingTransitions > 1
      ? clamp(recurrenceCount / (outgoingTransitions - 1))
      : 0;
  const recurrenceIngredient = recurrenceShare;
  const index = clamp(
    100
      * (
        0.4 * outgoingTransitionIngredient
        + 0.25 * activeDayIngredient
        + 0.2 * activeWeekIngredient
        + 0.15 * recurrenceIngredient
      ),
    0,
    100,
  );
  return {
    supported,
    index,
    band: evidenceBand(index, outgoingTransitions > 0, supported),
    outgoingTransitionIngredient,
    activeDayIngredient,
    activeWeekIngredient,
    recurrenceIngredient,
    recurrenceCount,
    recurrenceShare,
  };
}

function range(values: readonly number[]): {
  first: number | null;
  last: number | null;
} {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    first = Math.min(first, value);
    last = Math.max(last, value);
  }
  return Number.isFinite(first) && Number.isFinite(last)
    ? { first, last }
    : { first: null, last: null };
}

function spanDays(first: number | null, last: number | null): number | null {
  if (first == null || last == null) return null;
  return finiteOrNull(Math.max(0, last - first) / MS_PER_DAY);
}

function temporalSupport(
  samples: number,
  config: ResolvedDestinationTransitionOptions,
): TemporalSampleSupport {
  const supported = samples >= config.minSupportedOriginTransitions;
  const index = clamp(100 * (samples / config.strongTemporalSamples), 0, 100);
  return {
    supported,
    index,
    band: evidenceBand(index, samples > 0, supported),
  };
}

function summarizeTemporalTransitions(
  transitions: readonly AcceptedTransitionRecord[],
  config: ResolvedDestinationTransitionOptions,
): TemporalTransitionPoint {
  const outgoing = new Map<string, Map<string, number>>();
  const edgeCounts = new Map<string, number>();
  const destinations = new Set<string>();
  for (const transition of transitions) {
    destinations.add(transition.toKey);
    const row = outgoing.get(transition.fromKey) ?? new Map<string, number>();
    row.set(transition.toKey, (row.get(transition.toKey) ?? 0) + 1);
    outgoing.set(transition.fromKey, row);
    const edgeKey = `${transition.fromKey}\u0000${transition.toKey}`;
    edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1);
  }
  let weightedEntropy = 0;
  let weightedConcentration = 0;
  for (const row of outgoing.values()) {
    const counts = [...row.values()];
    const total = counts.reduce((sum, count) => sum + count, 0);
    const entropyBits = entropyFromCounts(counts);
    weightedEntropy += entropyBits * total;
    weightedConcentration +=
      rowConcentration(entropyBits, counts.length) * total;
  }
  const samples = transitions.length;
  const leadingEdgeCount = [...edgeCounts.values()].reduce(
    (largest, count) => Math.max(largest, count),
    0,
  );
  return {
    samples,
    distinctOrigins: outgoing.size,
    distinctDestinations: destinations.size,
    distinctEdges: edgeCounts.size,
    leadingEdgeCount,
    leadingEdgeShare:
      samples > 0 ? clamp(leadingEdgeCount / samples) : null,
    weightedEntropyBits:
      samples > 0 ? finiteOrNull(weightedEntropy / samples) : null,
    transitionConcentrationIndex:
      samples > 0
        ? finiteOrNull(clamp(100 * (weightedConcentration / samples), 0, 100))
        : null,
    support: temporalSupport(samples, config),
  };
}

function buildMatrix(
  states: readonly DestinationState[],
  edgeLookup: ReadonlyMap<string, EdgeAccumulator>,
): TransitionMatrixRow[] {
  return states.map((state) => ({
    fromKey: state.key,
    fromLabel: state.label,
    outgoingTransitions: state.outgoingTransitions,
    originSupported: state.support.supported,
    supportBand: state.support.band,
    entropyBits: state.entropyBits,
    transitionConcentrationIndex: state.transitionConcentrationIndex,
    cells: states.map((destination) => {
      const edge = edgeLookup.get(`${state.key}\u0000${destination.key}`);
      const count = edge?.count ?? 0;
      return {
        toKey: destination.key,
        toLabel: destination.label,
        count,
        observedConditionalShare:
          state.outgoingTransitions > 0
            ? clamp(count / state.outgoingTransitions)
            : null,
        status: !state.support.supported
          ? 'unsupported_origin'
          : count > 0
            ? 'observed'
            : 'unobserved',
      };
    }),
  }));
}

function buildTopMatrix(
  states: readonly DestinationState[],
  edgeLookup: ReadonlyMap<string, EdgeAccumulator>,
  limit: number,
): TransitionMatrixRow[] {
  const topStates = states.slice(0, limit);
  return buildMatrix(topStates, edgeLookup);
}

/**
 * Build continuity-safe descriptive transition evidence without mutating the
 * returned drive array or individual drive objects.
 */
export function buildDestinationTransitions(
  drives: readonly Drive[],
  nowMs: number,
  timeZone: string,
  options: DestinationTransitionOptions = {},
): DestinationTransitionResult {
  const config = resolveOptions(options ?? {});
  const resolvedNowMs =
    Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : 0;
  const resolvedTimeZone = normalizeDestinationTimeZone(timeZone);
  const records = drives.map((drive, sourceIndex) =>
    classifyRecord(
      drive,
      sourceIndex,
      resolvedNowMs,
      resolvedTimeZone,
    ),
  );
  const sequence = records
    .filter(
      (record): record is DriveRecord & { startMs: number } =>
        record.startMs != null,
    )
    .slice()
    .sort(
      (left, right) =>
        left.startMs - right.startMs
        || left.sourceIndex - right.sourceIndex,
    );
  const sourceSegmentByIndex = new Map<number, number>();
  let sourceSegment = 0;
  for (const record of records) {
    if (record.startMs == null) {
      sourceSegment += 1;
      continue;
    }
    sourceSegmentByIndex.set(record.sourceIndex, sourceSegment);
  }

  const categoryCounts: Record<DestinationRowCategory, number> = {
    included: 0,
    incomplete_timestamp: 0,
    invalid_timestamp_or_order: 0,
    future: 0,
    invalid_duration: 0,
    unlocatable_end: 0,
  };
  for (const record of records) categoryCounts[record.category] += 1;

  const included = sequence.filter(isIncluded);
  const stateAccumulators = new Map<string, StateAccumulator>();
  for (const record of included) {
    const existing = stateAccumulators.get(record.destination.key);
    if (existing) {
      existing.visits += 1;
      existing.visitDays.add(record.visitZoned.dateKey);
      existing.visitWeeks.add(record.visitZoned.weekKey);
      existing.firstVisitMs = Math.min(existing.firstVisitMs, record.endMs);
      existing.lastVisitMs = Math.max(existing.lastVisitMs, record.endMs);
    } else {
      stateAccumulators.set(record.destination.key, {
        key: record.destination.key,
        label: record.destination.label,
        visits: 1,
        visitDays: new Set([record.visitZoned.dateKey]),
        visitWeeks: new Set([record.visitZoned.weekKey]),
        firstVisitMs: record.endMs,
        lastVisitMs: record.endMs,
      });
    }
  }

  let excludedUnusableRowPairs = 0;
  let excludedCurrentStartUnlocatablePairs = 0;
  let excludedEndpointMismatchPairs = 0;
  let excludedOverlapOrNegativeGapPairs = 0;
  let excludedLongGapPairs = 0;
  const acceptedRecords: AcceptedTransitionRecord[] = [];
  const edgeAccumulators = new Map<string, EdgeAccumulator>();

  for (let index = 1; index < sequence.length; index += 1) {
    const previous = sequence[index - 1]!;
    const current = sequence[index]!;
    if (
      sourceSegmentByIndex.get(previous.sourceIndex)
        !== sourceSegmentByIndex.get(current.sourceIndex)
      || !isIncluded(previous)
      || !isIncluded(current)
    ) {
      excludedUnusableRowPairs += 1;
      continue;
    }
    if (!current.start) {
      excludedCurrentStartUnlocatablePairs += 1;
      continue;
    }
    if (current.startMs < previous.endMs) {
      excludedOverlapOrNegativeGapPairs += 1;
      continue;
    }
    if (
      !endpointsMatch(
        previous.destination,
        current.start,
        config.gpsToleranceM,
      )
    ) {
      excludedEndpointMismatchPairs += 1;
      continue;
    }
    const gapMs = current.startMs - previous.endMs;
    if (
      config.maxContinuityGapMs != null
      && gapMs > config.maxContinuityGapMs
    ) {
      excludedLongGapPairs += 1;
      continue;
    }
    const zoned = zonedParts(current.startMs, resolvedTimeZone);
    const transition: AcceptedTransitionRecord = {
      fromKey: previous.destination.key,
      toKey: current.destination.key,
      observedMs: current.startMs,
      zoned,
    };
    acceptedRecords.push(transition);
    const edgeKey = `${transition.fromKey}\u0000${transition.toKey}`;
    const edge = edgeAccumulators.get(edgeKey);
    if (edge) {
      edge.count += 1;
      edge.firstObservationMs = Math.min(
        edge.firstObservationMs,
        transition.observedMs,
      );
      edge.lastObservationMs = Math.max(
        edge.lastObservationMs,
        transition.observedMs,
      );
      edge.days.add(zoned.dateKey);
      edge.weeks.add(zoned.weekKey);
    } else {
      edgeAccumulators.set(edgeKey, {
        fromKey: transition.fromKey,
        toKey: transition.toKey,
        count: 1,
        firstObservationMs: transition.observedMs,
        lastObservationMs: transition.observedMs,
        days: new Set([zoned.dateKey]),
        weeks: new Set([zoned.weekKey]),
      });
    }
  }

  const outgoingEdges = new Map<string, EdgeAccumulator[]>();
  for (const edge of edgeAccumulators.values()) {
    const row = outgoingEdges.get(edge.fromKey) ?? [];
    row.push(edge);
    outgoingEdges.set(edge.fromKey, row);
  }
  for (const row of outgoingEdges.values()) {
    row.sort(
      (left, right) =>
        right.count - left.count
        || compareStrings(left.toKey, right.toKey),
    );
  }

  const includedVisits = included.length;
  const states = [...stateAccumulators.values()]
    .map<DestinationState>((accumulator) => {
      const row = outgoingEdges.get(accumulator.key) ?? [];
      const outgoingTransitions = row.reduce(
        (sum, edge) => sum + edge.count,
        0,
      );
      const entropyBits =
        outgoingTransitions > 0
          ? entropyFromCounts(row.map((edge) => edge.count))
          : null;
      const concentration =
        entropyBits != null
          ? rowConcentration(entropyBits, row.length)
          : null;
      const outgoingDays = new Set(
        row.flatMap((edge) => [...edge.days]),
      );
      const outgoingWeeks = new Set(
        row.flatMap((edge) => [...edge.weeks]),
      );
      const support = originSupport(
        outgoingTransitions,
        outgoingDays.size,
        outgoingWeeks.size,
        row.length,
        config,
      );
      const leading = row[0] ?? null;
      return {
        key: accumulator.key,
        label: accumulator.label,
        visits: accumulator.visits,
        visitShare:
          includedVisits > 0
            ? clamp(accumulator.visits / includedVisits)
            : 0,
        activeLocalDays: accumulator.visitDays.size,
        activeLocalWeeks: accumulator.visitWeeks.size,
        firstVisitMs: accumulator.firstVisitMs,
        lastVisitMs: accumulator.lastVisitMs,
        outgoingTransitions,
        outgoingActiveLocalDays: outgoingDays.size,
        outgoingActiveLocalWeeks: outgoingWeeks.size,
        distinctObservedSuccessors: row.length,
        entropyBits,
        effectiveSuccessorCount:
          entropyBits != null
            ? finiteOrNull(2 ** entropyBits)
            : null,
        transitionConcentrationIndex:
          concentration != null
            ? finiteOrNull(clamp(concentration * 100, 0, 100))
            : null,
        leadingSuccessorKey: leading?.toKey ?? null,
        leadingSuccessorLabel:
          leading
            ? stateAccumulators.get(leading.toKey)?.label ?? leading.toKey
            : null,
        leadingSuccessorCount: leading?.count ?? 0,
        leadingSuccessorObservedShare:
          leading && outgoingTransitions > 0
            ? clamp(leading.count / outgoingTransitions)
            : null,
        support,
      };
    })
    .sort(
      (left, right) =>
        right.visits - left.visits
        || right.outgoingTransitions - left.outgoingTransitions
        || compareStrings(left.label, right.label)
        || compareStrings(left.key, right.key),
    );
  const stateByKey = new Map(states.map((state) => [state.key, state]));
  const acceptedTransitions = acceptedRecords.length;

  const edges = [...edgeAccumulators.values()]
    .map<DestinationEdge>((edge) => {
      const origin = stateByKey.get(edge.fromKey);
      const destination = stateByKey.get(edge.toKey);
      const outgoingTransitions = origin?.outgoingTransitions ?? 0;
      const observedConditionalShare =
        outgoingTransitions > 0
          ? clamp(edge.count / outgoingTransitions)
          : 0;
      return {
        fromKey: edge.fromKey,
        fromLabel: origin?.label ?? edge.fromKey,
        toKey: edge.toKey,
        toLabel: destination?.label ?? edge.toKey,
        count: edge.count,
        observedConditionalShare,
        shareOfAcceptedTransitions:
          acceptedTransitions > 0
            ? clamp(edge.count / acceptedTransitions)
            : 0,
        empiricalInformationBits:
          observedConditionalShare > 0
            ? Math.max(0, -Math.log2(observedConditionalShare))
            : 0,
        firstObservationMs: edge.firstObservationMs,
        lastObservationMs: edge.lastObservationMs,
        activeLocalDays: edge.days.size,
        activeLocalWeeks: edge.weeks.size,
        originSupported: origin?.support.supported ?? false,
        originSupportBand: origin?.support.band ?? 'none',
      };
    })
    .sort(
      (left, right) =>
        right.count - left.count
        || compareStrings(left.fromKey, right.fromKey)
        || compareStrings(left.toKey, right.toKey),
    );
  const empiricallyRareEdges = edges
    .slice()
    .sort(
      (left, right) =>
        right.empiricalInformationBits - left.empiricalInformationBits
        || right.count - left.count
        || compareStrings(left.fromKey, right.fromKey)
        || compareStrings(left.toKey, right.toKey),
    )
    .slice(0, 12);

  const matrix = buildMatrix(states, edgeAccumulators);
  const topMatrix = buildTopMatrix(
    states,
    edgeAccumulators,
    config.topMatrixStateLimit,
  );
  const twoHourProfile = Array.from({ length: 12 }, (_, index) => {
    const bucketStartHour = index * BUCKET_HOURS;
    return {
      bucketStartHour,
      ...summarizeTemporalTransitions(
        acceptedRecords.filter(
          (transition) =>
            Math.floor(transition.zoned.hour / BUCKET_HOURS)
              * BUCKET_HOURS
            === bucketStartHour,
        ),
        config,
      ),
    };
  });
  const weekdayProfile = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    ...summarizeTemporalTransitions(
      acceptedRecords.filter(
        (transition) => transition.zoned.weekday === weekday,
      ),
      config,
    ),
  }));
  const monthGroups = new Map<string, AcceptedTransitionRecord[]>();
  for (const transition of acceptedRecords) {
    const group = monthGroups.get(transition.zoned.monthKey) ?? [];
    group.push(transition);
    monthGroups.set(transition.zoned.monthKey, group);
  }
  const monthTrend = [...monthGroups.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map<MonthTransitionPoint>(([monthKey, transitions]) => ({
      monthKey,
      firstObservationMs: transitions.reduce(
        (first, transition) => Math.min(first, transition.observedMs),
        Number.POSITIVE_INFINITY,
      ),
      ...summarizeTemporalTransitions(transitions, config),
    }));

  const returnedRange = range(
    records.flatMap((record) =>
      record.startMs != null ? [record.startMs] : [],
    ),
  );
  const includedRange = range(included.map((record) => record.endMs));
  const acceptedRange = range(
    acceptedRecords.map((transition) => transition.observedMs),
  );
  const originsWithOutgoingEvidence = states.filter(
    (state) => state.outgoingTransitions > 0,
  );
  const supportedOrigins = originsWithOutgoingEvidence.filter(
    (state) => state.support.supported,
  );
  const supportedTransitionCount = supportedOrigins.reduce(
    (sum, state) => sum + state.outgoingTransitions,
    0,
  );
  const weightedEntropyBits =
    acceptedTransitions > 0
      ? originsWithOutgoingEvidence.reduce(
          (sum, state) =>
            sum
            + (state.entropyBits ?? 0) * state.outgoingTransitions,
          0,
        ) / acceptedTransitions
      : null;
  const weightedConcentration =
    acceptedTransitions > 0
      ? originsWithOutgoingEvidence.reduce(
          (sum, state) =>
            sum
            + (state.transitionConcentrationIndex ?? 0)
              * state.outgoingTransitions,
          0,
        ) / acceptedTransitions
      : null;
  const weightedSupportValue = (
    selector: (state: DestinationState) => number,
  ): number | null =>
    acceptedTransitions > 0
      ? originsWithOutgoingEvidence.reduce(
          (sum, state) =>
            sum + selector(state) * state.outgoingTransitions,
          0,
        ) / acceptedTransitions
      : null;
  const destinationVisitConcentration =
    includedVisits > 0
      ? states.reduce(
          (sum, state) => sum + state.visitShare ** 2,
          0,
        )
      : null;
  const acceptedEdgeConcentration =
    acceptedTransitions > 0
      ? edges.reduce(
          (sum, edge) => sum + edge.shareOfAcceptedTransitions ** 2,
          0,
        )
      : null;

  const unplacedRecords = records.filter((record) => record.startMs == null);
  const latestPlaced = sequence[sequence.length - 1] ?? null;
  const latestOrderIndeterminate = unplacedRecords.some(
    (record) =>
      latestPlaced == null
      || record.endMs == null
      || record.endMs > latestPlaced.startMs,
  );
  let latestRowCategory: LatestRowCategory = 'none';
  let latestState: LatestDestinationState | null = null;
  if (records.length > 0 && latestOrderIndeterminate) {
    latestRowCategory = 'indeterminate';
  } else if (latestPlaced) {
    latestRowCategory = latestPlaced.category;
    if (isIncluded(latestPlaced)) {
      const state = stateByKey.get(latestPlaced.destination.key);
      if (state) {
        const historicalLeadingSuccessor =
          state.leadingSuccessorKey
          && state.leadingSuccessorLabel
          && state.leadingSuccessorObservedShare != null
            ? {
                fromKey: state.key,
                fromLabel: state.label,
                toKey: state.leadingSuccessorKey,
                toLabel: state.leadingSuccessorLabel,
                count: state.leadingSuccessorCount,
                outgoingTransitions: state.outgoingTransitions,
                observedShare: state.leadingSuccessorObservedShare,
                supportedOrigin: state.support.supported,
                supportBand: state.support.band,
              }
            : null;
        latestState = {
          key: state.key,
          label: state.label,
          observedAtMs: latestPlaced.endMs,
          ageDays:
            Math.max(0, resolvedNowMs - latestPlaced.endMs) / MS_PER_DAY,
          outgoingTransitions: state.outgoingTransitions,
          supportedOrigin: state.support.supported,
          supportBand: state.support.band,
          historicalLeadingSuccessor,
        };
      }
    }
  }

  const excludedRows = records.length - includedVisits;
  const adjacentCandidatePairs = Math.max(0, sequence.length - 1);
  const excludedPairs =
    excludedUnusableRowPairs
    + excludedCurrentStartUnlocatablePairs
    + excludedEndpointMismatchPairs
    + excludedOverlapOrNegativeGapPairs
    + excludedLongGapPairs;
  const latestStateAgeDays = latestState?.ageDays ?? null;

  return {
    nowMs: resolvedNowMs,
    timeZone: resolvedTimeZone,
    config,
    accounting: {
      returnedRows: records.length,
      includedRows: includedVisits,
      excludedRows,
      incompleteTimestampRows: categoryCounts.incomplete_timestamp,
      invalidTimestampOrOrderRows:
        categoryCounts.invalid_timestamp_or_order,
      futureRows: categoryCounts.future,
      invalidDurationRows: categoryCounts.invalid_duration,
      unlocatableEndDestinationRows: categoryCounts.unlocatable_end,
      chronologicallyPlacedRows: sequence.length,
      unplacedRows: unplacedRecords.length,
      historyLimit: config.historyLimit,
      historyCapReached: records.length >= config.historyLimit,
    },
    continuity: {
      adjacentCandidatePairs,
      acceptedTransitions,
      excludedPairs,
      excludedUnusableRowPairs,
      excludedCurrentStartUnlocatablePairs,
      excludedEndpointMismatchPairs,
      excludedOverlapOrNegativeGapPairs,
      excludedLongGapPairs,
    },
    includedVisits,
    acceptedTransitions,
    uniqueDestinations: states.length,
    states,
    edges,
    frequentEdges: edges.slice(0, 12),
    empiricallyRareEdges,
    matrix,
    topMatrix,
    twoHourProfile,
    weekdayProfile,
    monthTrend,
    evidence: {
      activeLocalDays: new Set(
        included.map((record) => record.visitZoned.dateKey),
      ).size,
      activeLocalWeeks: new Set(
        included.map((record) => record.visitZoned.weekKey),
      ).size,
      returnedFirstObservationMs: returnedRange.first,
      returnedLastObservationMs: returnedRange.last,
      returnedSpanDays: spanDays(returnedRange.first, returnedRange.last),
      firstIncludedVisitMs: includedRange.first,
      lastIncludedVisitMs: includedRange.last,
      includedSpanDays: spanDays(includedRange.first, includedRange.last),
      daysSinceLastIncludedVisit:
        includedRange.last != null
          ? Math.max(0, resolvedNowMs - includedRange.last) / MS_PER_DAY
          : null,
      firstAcceptedTransitionMs: acceptedRange.first,
      lastAcceptedTransitionMs: acceptedRange.last,
      acceptedTransitionSpanDays: spanDays(
        acceptedRange.first,
        acceptedRange.last,
      ),
      originsWithOutgoingEvidence: originsWithOutgoingEvidence.length,
      supportedOriginStates: supportedOrigins.length,
      unsupportedOriginStates:
        originsWithOutgoingEvidence.length - supportedOrigins.length,
      supportedOriginTransitionCoverage:
        acceptedTransitions > 0
          ? clamp(supportedTransitionCount / acceptedTransitions)
          : null,
      weightedEntropyBits:
        weightedEntropyBits != null
          ? finiteOrNull(weightedEntropyBits)
          : null,
      effectiveSuccessorCount:
        weightedEntropyBits != null
          ? finiteOrNull(2 ** weightedEntropyBits)
          : null,
      transitionConcentrationIndex:
        weightedConcentration != null
          ? finiteOrNull(clamp(weightedConcentration, 0, 100))
          : null,
      weightedOriginSupportIndex: finiteOrNull(
        weightedSupportValue((state) => state.support.index)
          ?? Number.NaN,
      ),
      weightedOutgoingTransitionIngredient: finiteOrNull(
        weightedSupportValue(
          (state) => state.support.outgoingTransitionIngredient,
        ) ?? Number.NaN,
      ),
      weightedActiveDayIngredient: finiteOrNull(
        weightedSupportValue(
          (state) => state.support.activeDayIngredient,
        ) ?? Number.NaN,
      ),
      weightedActiveWeekIngredient: finiteOrNull(
        weightedSupportValue(
          (state) => state.support.activeWeekIngredient,
        ) ?? Number.NaN,
      ),
      weightedRecurrenceIngredient: finiteOrNull(
        weightedSupportValue(
          (state) => state.support.recurrenceIngredient,
        ) ?? Number.NaN,
      ),
      destinationVisitConcentration:
        destinationVisitConcentration != null
          ? finiteOrNull(clamp(destinationVisitConcentration))
          : null,
      acceptedEdgeConcentration:
        acceptedEdgeConcentration != null
          ? finiteOrNull(clamp(acceptedEdgeConcentration))
          : null,
      latestStateAgeDays,
    },
    latestRowCategory,
    latestState,
  };
}
