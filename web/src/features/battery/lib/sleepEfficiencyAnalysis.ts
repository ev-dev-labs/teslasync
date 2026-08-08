import type {
  SleepDrainEvent,
  SleepEfficiencyData,
  SleepSentryGroup,
  SleepStateDistributionRow,
} from '@/types/energy';

const DAY_MS = 86_400_000;
const SENTRY_HOURS_PER_MONTH = 730;
const KNOWN_STATES = new Set([
  'asleep',
  'online',
  'driving',
  'charging',
  'updating',
  'suspended',
]);

export const DEFAULT_SLEEP_RANGE_DAYS = 30;
export const SLEEP_STATE_DIRECTORY_CAP = 50;
export const SLEEP_EVENT_DIRECTORY_CAP = 50;

export type SleepStateRowCategory =
  | 'included'
  | 'missing_state'
  | 'invalid_count'
  | 'invalid_minutes'
  | 'duplicate_state';

export type SleepEventRowCategory =
  | 'included'
  | 'invalid_timestamp'
  | 'future'
  | 'invalid_duration'
  | 'invalid_battery'
  | 'duplicate_id';

export type SleepRangeStatus =
  | 'valid'
  | 'missing'
  | 'invalid'
  | 'reversed';

export type SleepAvailabilityStatus =
  | 'available'
  | 'partial'
  | 'unavailable';

export type SleepAvailabilityKey =
  | 'transition_counts'
  | 'state_dwell'
  | 'sleep_efficiency'
  | 'time_to_sleep'
  | 'sentry_comparison'
  | 'drain_events'
  | 'cost_inputs';

export type SleepAvailabilityReason =
  | 'valid_transition_destinations'
  | 'valid_rows_without_destinations'
  | 'no_valid_transition_rows'
  | 'positive_dwell_minutes'
  | 'no_positive_dwell_minutes'
  | 'duration_ratio_derived'
  | 'withheld_without_dwell'
  | 'positive_reported_value'
  | 'placeholder_or_missing'
  | 'both_sentry_groups'
  | 'one_sentry_group'
  | 'no_count_bearing_sentry_groups'
  | 'validated_events'
  | 'events_excluded'
  | 'no_events'
  | 'capacity_and_price'
  | 'one_cost_input'
  | 'no_cost_inputs';

export interface SleepRangeAnalysis {
  requestedStart: string | null;
  requestedEnd: string | null;
  status: SleepRangeStatus;
  inclusiveDays: number | null;
  startMs: number | null;
  endMs: number | null;
}

export interface SleepStateEvidence {
  state: string;
  known: boolean;
  count: number;
  countShare: number | null;
  totalMinutes: number;
  durationShare: number | null;
  sourceIndex: number;
}

export interface SleepStateAccounting {
  returnedRows: number;
  includedRows: number;
  excludedRows: number;
  categories: Record<SleepStateRowCategory, number>;
  directoryCap: number;
  displayedRows: number;
  omittedRows: number;
  duplicatePolicy: 'first_valid_row_wins';
}

export interface SleepTransitionAnalysis {
  totalCount: number;
  asleepCount: number;
  asleepShare: number | null;
  representedStateCount: number;
  dominantState: string | null;
  dominantShare: number | null;
  normalizedEntropy: number | null;
  states: readonly SleepStateEvidence[];
  directory: readonly SleepStateEvidence[];
}

export interface SleepDwellAnalysis {
  available: boolean;
  totalMinutes: number;
  asleepMinutes: number;
  recomputedEfficiencyPct: number | null;
  reportedEfficiencyPct: number | null;
  reportedFieldValid: boolean;
  reportedDifferencePoints: number | null;
  timeToSleepAvgMin: number | null;
}

export interface SleepSentryEvidenceGroup {
  mode: 'on' | 'off';
  available: boolean;
  count: number | null;
  avgDrainRate: number | null;
  avgDurationHours: number | null;
  avgBatteryLost: number | null;
  avgTempC: number | null;
  sourceIndex: number | null;
}

export interface SleepCapacityContext {
  batteryCapacityWh: number | null;
  capacitySource: string | null;
  capacitySourceCategory:
    | 'vin_estimate'
    | 'model_estimate'
    | 'default'
    | 'other'
    | 'unavailable';
  baseCostPerKwh: number | null;
}

export interface SleepSentryProjection {
  available: boolean;
  onMonthlyKwh: number | null;
  onMonthlyCost: number | null;
  extraDrainRate: number | null;
  extraMonthlyKwh: number | null;
  extraMonthlyCost: number | null;
}

export interface SleepSentryAnalysis {
  on: SleepSentryEvidenceGroup;
  off: SleepSentryEvidenceGroup;
  hasAnyEvidence: boolean;
  comparisonAvailable: boolean;
  context: SleepCapacityContext;
  projection: SleepSentryProjection;
}

export type SleepEventRecency =
  | 'last_24_hours'
  | 'last_7_days'
  | 'older'
  | 'unclassified';

export interface ValidSleepDrainEvent {
  id: string;
  startDate: string;
  endDate: string;
  startMs: number;
  endMs: number;
  durationHours: number;
  batteryLost: number;
  drainRate: number;
  sentryMode: boolean;
  outsideTempC: number | null;
  startBattery: number;
  endBattery: number;
  recency: SleepEventRecency;
  sourceIndex: number;
}

export interface SleepEventAccounting {
  returnedRows: number;
  includedRows: number;
  excludedRows: number;
  categories: Record<SleepEventRowCategory, number>;
  directoryCap: number;
  displayedRows: number;
  omittedRows: number;
  duplicatePolicy: 'first_valid_event_wins';
}

export interface SleepEventAggregates {
  available: boolean;
  count: number;
  totalDurationHours: number | null;
  medianDurationHours: number | null;
  totalBatteryLost: number | null;
  medianDrainRate: number | null;
  sentryShare: number | null;
  temperatureCoverage: number | null;
  last24HoursCount: number;
  last7DaysCount: number;
  olderCount: number;
  unclassifiedCount: number;
}

export interface SleepEventAnalysis {
  events: readonly ValidSleepDrainEvent[];
  directory: readonly ValidSleepDrainEvent[];
  accounting: SleepEventAccounting;
  aggregates: SleepEventAggregates;
  reportedTotalEvents: number | null;
}

export interface SleepAvailabilityRow {
  key: SleepAvailabilityKey;
  status: SleepAvailabilityStatus;
  reason: SleepAvailabilityReason;
}

export interface SleepEvidenceBreadth {
  score: number;
  earnedPoints: number;
  possiblePoints: number;
  availableSources: number;
  partialSources: number;
  unavailableSources: number;
}

export interface SleepSourceCoverage {
  hasResponse: boolean;
  vehicleId: number | null;
  backendPeriodDays: number | null;
  frozenNowMs: number | null;
  frozenNowIso: string | null;
  clockValid: boolean;
}

export interface SleepEfficiencyAnalysis {
  range: SleepRangeAnalysis;
  source: SleepSourceCoverage;
  stateAccounting: SleepStateAccounting;
  transitions: SleepTransitionAnalysis;
  dwell: SleepDwellAnalysis;
  sentry: SleepSentryAnalysis;
  events: SleepEventAnalysis;
  availability: readonly SleepAvailabilityRow[];
  breadth: SleepEvidenceBreadth;
}

interface ParsedStateRow {
  evidence: Omit<SleepStateEvidence, 'countShare' | 'durationShare'> | null;
  category: Exclude<SleepStateRowCategory, 'included'> | null;
}

interface ParsedEventRow {
  event: ValidSleepDrainEvent | null;
  category: Exclude<SleepEventRowCategory, 'included' | 'duplicate_id'> | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonnegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null && number >= 0 && number <= Number.MAX_SAFE_INTEGER
    ? number
    : null;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null && number > 0 && number <= Number.MAX_SAFE_INTEGER
    ? number
    : null;
}

function nonnegativeInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null
    && Number.isSafeInteger(number)
    && number >= 0
    ? number
    : null;
}

function positiveInteger(value: unknown): number | null {
  const number = nonnegativeInteger(value);
  return number != null && number > 0 ? number : null;
}

function percentage(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null && number >= 0 && number <= 100 ? number : null;
}

function safeSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    const next = total + value;
    if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER) return null;
    total = next;
  }
  return total;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left == null || right == null) return null;
  const value = (left + right) / 2;
  return Number.isFinite(value) ? value : null;
}

function parseUtcDate(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp;
}

export function analyzeSleepRange(
  selectedStart: string | null | undefined,
  selectedEnd: string | null | undefined,
): SleepRangeAnalysis {
  const requestedStart =
    typeof selectedStart === 'string' && selectedStart.length > 0
      ? selectedStart
      : null;
  const requestedEnd =
    typeof selectedEnd === 'string' && selectedEnd.length > 0
      ? selectedEnd
      : null;

  if (!requestedStart || !requestedEnd) {
    return {
      requestedStart,
      requestedEnd,
      status: 'missing',
      inclusiveDays: null,
      startMs: null,
      endMs: null,
    };
  }

  const startMs = parseUtcDate(requestedStart);
  const endMs = parseUtcDate(requestedEnd);
  if (startMs == null || endMs == null) {
    return {
      requestedStart,
      requestedEnd,
      status: 'invalid',
      inclusiveDays: null,
      startMs,
      endMs,
    };
  }
  if (endMs < startMs) {
    return {
      requestedStart,
      requestedEnd,
      status: 'reversed',
      inclusiveDays: null,
      startMs,
      endMs,
    };
  }
  return {
    requestedStart,
    requestedEnd,
    status: 'valid',
    inclusiveDays: Math.floor((endMs - startMs) / DAY_MS) + 1,
    startMs,
    endMs,
  };
}

function parseStateRow(
  row: SleepStateDistributionRow,
  sourceIndex: number,
): ParsedStateRow {
  const state =
    typeof row?.state === 'string' ? row.state.trim().toLowerCase() : '';
  if (!state) return { evidence: null, category: 'missing_state' };

  const count = nonnegativeInteger(row.count);
  if (count == null) return { evidence: null, category: 'invalid_count' };

  const totalMinutes = nonnegativeNumber(row.total_minutes);
  if (totalMinutes == null) {
    return { evidence: null, category: 'invalid_minutes' };
  }

  return {
    evidence: {
      state,
      known: KNOWN_STATES.has(state),
      count,
      totalMinutes,
      sourceIndex,
    },
    category: null,
  };
}

function buildStateAnalysis(
  rows: readonly SleepStateDistributionRow[],
): {
  accounting: SleepStateAccounting;
  transitions: SleepTransitionAnalysis;
  totalMinutes: number;
  asleepMinutes: number;
} {
  const categories: Record<SleepStateRowCategory, number> = {
    included: 0,
    missing_state: 0,
    invalid_count: 0,
    invalid_minutes: 0,
    duplicate_state: 0,
  };
  const seen = new Set<string>();
  const included: Array<
    Omit<SleepStateEvidence, 'countShare' | 'durationShare'>
  > = [];
  let runningCount = 0;
  let runningMinutes = 0;

  rows.forEach((row, sourceIndex) => {
    const parsed = parseStateRow(row, sourceIndex);
    if (parsed.category) {
      categories[parsed.category] += 1;
      return;
    }
    const evidence = parsed.evidence;
    if (!evidence) {
      categories.invalid_count += 1;
      return;
    }
    if (seen.has(evidence.state)) {
      categories.duplicate_state += 1;
      return;
    }
    const nextCount = runningCount + evidence.count;
    if (!Number.isSafeInteger(nextCount)) {
      categories.invalid_count += 1;
      return;
    }
    const nextMinutes = runningMinutes + evidence.totalMinutes;
    if (
      !Number.isFinite(nextMinutes)
      || nextMinutes > Number.MAX_SAFE_INTEGER
    ) {
      categories.invalid_minutes += 1;
      return;
    }
    seen.add(evidence.state);
    runningCount = nextCount;
    runningMinutes = nextMinutes;
    included.push(evidence);
    categories.included += 1;
  });

  const states: SleepStateEvidence[] = included.map((row) => ({
    ...row,
    countShare: runningCount > 0 ? row.count / runningCount : null,
    durationShare:
      runningMinutes > 0 ? row.totalMinutes / runningMinutes : null,
  }));
  const represented = states.filter((row) => row.count > 0);
  const asleep = states.find((row) => row.state === 'asleep');
  const dominant = [...represented].sort(
    (a, b) => b.count - a.count || a.state.localeCompare(b.state),
  )[0];
  let normalizedEntropy: number | null = null;
  if (runningCount > 0) {
    if (represented.length <= 1) {
      normalizedEntropy = 0;
    } else {
      const entropy = represented.reduce((sum, row) => {
        const share = row.count / runningCount;
        return sum - share * Math.log(share);
      }, 0);
      normalizedEntropy = entropy / Math.log(represented.length);
    }
  }

  const directory = states.slice(0, SLEEP_STATE_DIRECTORY_CAP);
  return {
    accounting: {
      returnedRows: rows.length,
      includedRows: categories.included,
      excludedRows: rows.length - categories.included,
      categories,
      directoryCap: SLEEP_STATE_DIRECTORY_CAP,
      displayedRows: directory.length,
      omittedRows: Math.max(0, states.length - directory.length),
      duplicatePolicy: 'first_valid_row_wins',
    },
    transitions: {
      totalCount: runningCount,
      asleepCount: asleep?.count ?? 0,
      asleepShare:
        runningCount > 0 ? (asleep?.count ?? 0) / runningCount : null,
      representedStateCount: represented.length,
      dominantState: dominant?.state ?? null,
      dominantShare:
        dominant && runningCount > 0 ? dominant.count / runningCount : null,
      normalizedEntropy:
        normalizedEntropy != null && Number.isFinite(normalizedEntropy)
          ? normalizedEntropy
          : null,
      states,
      directory,
    },
    totalMinutes: runningMinutes,
    asleepMinutes: asleep?.totalMinutes ?? 0,
  };
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function eventId(value: unknown): string | null {
  const id = nonnegativeInteger(value);
  return id != null ? String(id) : null;
}

function parseEventRow(
  event: SleepDrainEvent,
  sourceIndex: number,
  frozenNowMs: number | null,
): ParsedEventRow {
  const startMs = parseTimestamp(event?.start_date);
  const endMs = parseTimestamp(event?.end_date);
  if (startMs == null || endMs == null || endMs < startMs) {
    return { event: null, category: 'invalid_timestamp' };
  }
  if (
    frozenNowMs != null
    && (startMs > frozenNowMs || endMs > frozenNowMs)
  ) {
    return { event: null, category: 'future' };
  }

  const durationHours = positiveNumber(event.duration_hours);
  if (durationHours == null) {
    return { event: null, category: 'invalid_duration' };
  }

  const id = eventId(event.id);
  const batteryLost = percentage(event.battery_lost);
  const drainRate = nonnegativeNumber(event.drain_rate);
  const startBattery = percentage(event.start_battery);
  const endBattery = percentage(event.end_battery);
  if (
    id == null
    || batteryLost == null
    || drainRate == null
    || startBattery == null
    || endBattery == null
    || typeof event.sentry_mode !== 'boolean'
  ) {
    return { event: null, category: 'invalid_battery' };
  }

  const temp = finiteNumber(event.outside_temp);
  let recency: SleepEventRecency = 'unclassified';
  if (frozenNowMs != null) {
    const ageMs = frozenNowMs - startMs;
    if (ageMs <= DAY_MS) recency = 'last_24_hours';
    else if (ageMs <= DAY_MS * 7) recency = 'last_7_days';
    else recency = 'older';
  }

  return {
    event: {
      id,
      startDate: event.start_date as string,
      endDate: event.end_date as string,
      startMs,
      endMs,
      durationHours,
      batteryLost,
      drainRate,
      sentryMode: event.sentry_mode,
      outsideTempC: temp,
      startBattery,
      endBattery,
      recency,
      sourceIndex,
    },
    category: null,
  };
}

function buildEventAnalysis(
  rows: readonly SleepDrainEvent[],
  frozenNowMs: number | null,
  reportedTotalEventsValue: unknown,
): SleepEventAnalysis {
  const categories: Record<SleepEventRowCategory, number> = {
    included: 0,
    invalid_timestamp: 0,
    future: 0,
    invalid_duration: 0,
    invalid_battery: 0,
    duplicate_id: 0,
  };
  const seen = new Set<string>();
  const included: ValidSleepDrainEvent[] = [];

  rows.forEach((row, sourceIndex) => {
    const parsed = parseEventRow(row, sourceIndex, frozenNowMs);
    if (parsed.category) {
      categories[parsed.category] += 1;
      return;
    }
    const event = parsed.event;
    if (!event) {
      categories.invalid_battery += 1;
      return;
    }
    if (seen.has(event.id)) {
      categories.duplicate_id += 1;
      return;
    }
    seen.add(event.id);
    included.push(event);
    categories.included += 1;
  });

  const events = [...included].sort(
    (a, b) => b.startMs - a.startMs || a.id.localeCompare(b.id),
  );
  const directory = events.slice(0, SLEEP_EVENT_DIRECTORY_CAP);
  const durationValues = events.map((event) => event.durationHours);
  const batteryValues = events.map((event) => event.batteryLost);
  const drainValues = events.map((event) => event.drainRate);
  const temperatures = events.filter(
    (event) => event.outsideTempC != null,
  ).length;
  const count = events.length;

  return {
    events,
    directory,
    accounting: {
      returnedRows: rows.length,
      includedRows: categories.included,
      excludedRows: rows.length - categories.included,
      categories,
      directoryCap: SLEEP_EVENT_DIRECTORY_CAP,
      displayedRows: directory.length,
      omittedRows: Math.max(0, events.length - directory.length),
      duplicatePolicy: 'first_valid_event_wins',
    },
    aggregates: {
      available: count > 0,
      count,
      totalDurationHours: safeSum(durationValues),
      medianDurationHours: median(durationValues),
      totalBatteryLost: safeSum(batteryValues),
      medianDrainRate: median(drainValues),
      sentryShare:
        count > 0
          ? events.filter((event) => event.sentryMode).length / count
          : null,
      temperatureCoverage: count > 0 ? temperatures / count : null,
      last24HoursCount: events.filter(
        (event) => event.recency === 'last_24_hours',
      ).length,
      last7DaysCount: events.filter(
        (event) => event.recency === 'last_7_days',
      ).length,
      olderCount: events.filter((event) => event.recency === 'older').length,
      unclassifiedCount: events.filter(
        (event) => event.recency === 'unclassified',
      ).length,
    },
    reportedTotalEvents: nonnegativeInteger(reportedTotalEventsValue),
  };
}

function sentryMetric(
  value: unknown,
  allowNegative = false,
): number | null {
  const number = finiteNumber(value);
  if (number == null || number > Number.MAX_SAFE_INTEGER) return null;
  return allowNegative || number >= 0 ? number : null;
}

function buildSentryGroup(
  rows: readonly SleepSentryGroup[],
  sentryMode: boolean,
): SleepSentryEvidenceGroup {
  const sourceIndex = rows.findIndex(
    (row) =>
      row?.sentry_mode === sentryMode
      && positiveInteger(row.count) != null,
  );
  if (sourceIndex < 0) {
    return {
      mode: sentryMode ? 'on' : 'off',
      available: false,
      count: null,
      avgDrainRate: null,
      avgDurationHours: null,
      avgBatteryLost: null,
      avgTempC: null,
      sourceIndex: null,
    };
  }
  const row = rows[sourceIndex];
  return {
    mode: sentryMode ? 'on' : 'off',
    available: true,
    count: positiveInteger(row?.count),
    avgDrainRate: sentryMetric(row?.avg_drain_rate),
    avgDurationHours: sentryMetric(row?.avg_duration_hours),
    avgBatteryLost: sentryMetric(row?.avg_battery_lost),
    avgTempC: sentryMetric(row?.avg_temp, true),
    sourceIndex,
  };
}

function capacitySourceCategory(
  source: string | null,
): SleepCapacityContext['capacitySourceCategory'] {
  if (!source) return 'unavailable';
  if (source === 'vin_estimate') return 'vin_estimate';
  if (source === 'model_estimate') return 'model_estimate';
  if (source === 'default') return 'default';
  return 'other';
}

function buildSentryAnalysis(
  data: SleepEfficiencyData | null | undefined,
  rows: readonly SleepSentryGroup[],
): SleepSentryAnalysis {
  const on = buildSentryGroup(rows, true);
  const off = buildSentryGroup(rows, false);
  const batteryCapacityWh = positiveNumber(data?.battery_capacity_wh);
  const source =
    typeof data?.capacity_source === 'string'
    && data.capacity_source.trim().length > 0
      ? data.capacity_source.trim()
      : null;
  const baseCostPerKwh = nonnegativeNumber(data?.base_cost_per_kwh);
  const context: SleepCapacityContext = {
    batteryCapacityWh,
    capacitySource: source,
    capacitySourceCategory: capacitySourceCategory(source),
    baseCostPerKwh,
  };
  const comparisonAvailable = on.available && off.available;
  const ratesAvailable =
    comparisonAvailable
    && on.avgDrainRate != null
    && off.avgDrainRate != null;
  const projectionAvailable =
    ratesAvailable && batteryCapacityWh != null;

  let onMonthlyKwh: number | null = null;
  let extraDrainRate: number | null = null;
  let extraMonthlyKwh: number | null = null;
  if (
    projectionAvailable
    && on.avgDrainRate != null
    && off.avgDrainRate != null
    && batteryCapacityWh != null
  ) {
    onMonthlyKwh =
      (on.avgDrainRate / 100)
      * (batteryCapacityWh / 1_000)
      * SENTRY_HOURS_PER_MONTH;
    extraDrainRate = Math.max(0, on.avgDrainRate - off.avgDrainRate);
    extraMonthlyKwh =
      (extraDrainRate / 100)
      * (batteryCapacityWh / 1_000)
      * SENTRY_HOURS_PER_MONTH;
  }

  return {
    on,
    off,
    hasAnyEvidence: on.available || off.available,
    comparisonAvailable,
    context,
    projection: {
      available: projectionAvailable,
      onMonthlyKwh,
      onMonthlyCost:
        onMonthlyKwh != null && baseCostPerKwh != null
          ? onMonthlyKwh * baseCostPerKwh
          : null,
      extraDrainRate,
      extraMonthlyKwh,
      extraMonthlyCost:
        extraMonthlyKwh != null && baseCostPerKwh != null
          ? extraMonthlyKwh * baseCostPerKwh
          : null,
    },
  };
}

function availabilityRow(
  key: SleepAvailabilityKey,
  status: SleepAvailabilityStatus,
  reason: SleepAvailabilityReason,
): SleepAvailabilityRow {
  return { key, status, reason };
}

function buildAvailability(
  stateAccounting: SleepStateAccounting,
  transitions: SleepTransitionAnalysis,
  dwell: SleepDwellAnalysis,
  sentry: SleepSentryAnalysis,
  events: SleepEventAnalysis,
): SleepAvailabilityRow[] {
  const transitionRow =
    transitions.totalCount > 0
      ? availabilityRow(
          'transition_counts',
          'available',
          'valid_transition_destinations',
        )
      : stateAccounting.includedRows > 0
        ? availabilityRow(
            'transition_counts',
            'partial',
            'valid_rows_without_destinations',
          )
        : availabilityRow(
            'transition_counts',
            'unavailable',
            'no_valid_transition_rows',
          );
  const dwellRow = dwell.available
    ? availabilityRow('state_dwell', 'available', 'positive_dwell_minutes')
    : availabilityRow(
        'state_dwell',
        'unavailable',
        'no_positive_dwell_minutes',
      );
  const efficiencyRow = dwell.available
    ? availabilityRow(
        'sleep_efficiency',
        'available',
        'duration_ratio_derived',
      )
    : availabilityRow(
        'sleep_efficiency',
        'unavailable',
        'withheld_without_dwell',
      );
  const timeRow =
    dwell.timeToSleepAvgMin != null
      ? availabilityRow(
          'time_to_sleep',
          'available',
          'positive_reported_value',
        )
      : availabilityRow(
          'time_to_sleep',
          'unavailable',
          'placeholder_or_missing',
        );
  const sentryRow = sentry.comparisonAvailable
    ? availabilityRow(
        'sentry_comparison',
        'available',
        'both_sentry_groups',
      )
    : sentry.hasAnyEvidence
      ? availabilityRow(
          'sentry_comparison',
          'partial',
          'one_sentry_group',
        )
      : availabilityRow(
          'sentry_comparison',
          'unavailable',
          'no_count_bearing_sentry_groups',
        );
  const eventRow = events.accounting.includedRows > 0
    ? availabilityRow('drain_events', 'available', 'validated_events')
    : events.accounting.returnedRows > 0
      ? availabilityRow('drain_events', 'partial', 'events_excluded')
      : availabilityRow('drain_events', 'unavailable', 'no_events');
  const costInputs =
    sentry.context.batteryCapacityWh != null
    && sentry.context.baseCostPerKwh != null
      ? availabilityRow('cost_inputs', 'available', 'capacity_and_price')
      : sentry.context.batteryCapacityWh != null
          || sentry.context.baseCostPerKwh != null
        ? availabilityRow('cost_inputs', 'partial', 'one_cost_input')
        : availabilityRow('cost_inputs', 'unavailable', 'no_cost_inputs');

  return [
    transitionRow,
    dwellRow,
    efficiencyRow,
    timeRow,
    sentryRow,
    eventRow,
    costInputs,
  ];
}

function buildBreadth(
  rows: readonly SleepAvailabilityRow[],
): SleepEvidenceBreadth {
  const availableSources = rows.filter(
    (row) => row.status === 'available',
  ).length;
  const partialSources = rows.filter(
    (row) => row.status === 'partial',
  ).length;
  const unavailableSources =
    rows.length - availableSources - partialSources;
  const earnedPoints = availableSources + partialSources * 0.5;
  return {
    score:
      rows.length > 0 ? Math.round((earnedPoints / rows.length) * 100) : 0,
    earnedPoints,
    possiblePoints: rows.length,
    availableSources,
    partialSources,
    unavailableSources,
  };
}

function freezeDeep<T>(value: T): T {
  if (value != null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeDeep(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function analyzeSleepEfficiency(
  data: SleepEfficiencyData | null | undefined,
  nowMs: number,
  selectedStart: string | null | undefined,
  selectedEnd: string | null | undefined,
): SleepEfficiencyAnalysis {
  const range = analyzeSleepRange(selectedStart, selectedEnd);
  const clockValid =
    Number.isFinite(nowMs)
    && nowMs >= 0
    && nowMs <= 8_640_000_000_000_000;
  const frozenNowMs = clockValid ? nowMs : null;
  const stateRows = Array.isArray(data?.state_distribution)
    ? data.state_distribution
    : [];
  const sentryRows = Array.isArray(data?.sentry_comparison)
    ? data.sentry_comparison
    : [];
  const eventRows = Array.isArray(data?.recent_events)
    ? data.recent_events
    : [];

  const state = buildStateAnalysis(stateRows);
  const dwellAvailable =
    state.totalMinutes > 0
    && state.transitions.states.some((row) => row.totalMinutes > 0);
  const reportedField = percentage(data?.sleep_efficiency_pct);
  const recomputedEfficiencyPct = dwellAvailable
    ? (state.asleepMinutes / state.totalMinutes) * 100
    : null;
  const reportedEfficiencyPct =
    dwellAvailable && reportedField != null ? reportedField : null;
  const timeToSleepAvgMin = positiveNumber(data?.time_to_sleep_avg_min);
  const dwell: SleepDwellAnalysis = {
    available: dwellAvailable,
    totalMinutes: state.totalMinutes,
    asleepMinutes: state.asleepMinutes,
    recomputedEfficiencyPct,
    reportedEfficiencyPct,
    reportedFieldValid: reportedField != null,
    reportedDifferencePoints:
      reportedEfficiencyPct != null && recomputedEfficiencyPct != null
        ? reportedEfficiencyPct - recomputedEfficiencyPct
        : null,
    // Zero is currently a documented placeholder and has no sample-count
    // companion, so only a positive finite value is evidence-bearing.
    timeToSleepAvgMin,
  };
  const sentry = buildSentryAnalysis(data, sentryRows);
  const events = buildEventAnalysis(
    eventRows,
    frozenNowMs,
    data?.total_events,
  );
  const availability = buildAvailability(
    state.accounting,
    state.transitions,
    dwell,
    sentry,
    events,
  );

  return freezeDeep({
    range,
    source: {
      hasResponse: data != null,
      vehicleId: positiveInteger(data?.vehicle_id),
      backendPeriodDays: positiveInteger(data?.period_days),
      frozenNowMs,
      frozenNowIso:
        frozenNowMs != null ? new Date(frozenNowMs).toISOString() : null,
      clockValid,
    },
    stateAccounting: state.accounting,
    transitions: state.transitions,
    dwell,
    sentry,
    events,
    availability,
    breadth: buildBreadth(availability),
  });
}
