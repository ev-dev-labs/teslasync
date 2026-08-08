/**
 * Pure Explorer model.
 *
 * Drive endpoint coordinates are clustered into coarse cells, but coordinates
 * never leave this module. Distances remain SI-canonical meters; display-unit
 * conversion belongs at the React render boundary.
 */

import type { Drive } from '@/types/driving';

export const EXPLORER_HISTORY_LIMIT = 1000;
export const EXPLORER_CLUSTER_DEGREES = 0.01;
export const MIN_BASE_ARRIVALS = 3;
export const MIN_BASE_CLUSTER_VISITS = 2;
export const MIN_DESTINATION_ARRIVALS = 3;
export const MIN_DESTINATIONS_FOR_RANKING = 2;
export const MIN_DISCOVERIES_FOR_CADENCE = 3;
export const RARE_DESTINATION_MAX_VISITS = 2;

const EARTH_RADIUS_M = 6_371_000;
const DAY_MS = 86_400_000;
const RANKING_LIMIT = 5;

export type DistanceBandKey = 'local' | 'near' | 'regional' | 'far';

export interface Destination {
  /** Opaque, deterministic identifier; never contains coordinates. */
  id: string;
  ordinal: number;
  label: string | null;
  visits: number;
  repeatVisits: number;
  /** Great-circle distance from the inferred observed base, in meters. */
  distanceFromBaseM: number;
  firstVisitedAt: string;
  lastVisitedAt: string;
  firstVisitMonth: string;
}

export type MonthlyExploration = {
  month: string;
  newPlaces: number;
  repeatArrivals: number;
  destinationArrivals: number;
  cumulativePlaces: number;
  newArrivalShare: number | null;
};

export type DistanceBand = {
  key: DistanceBandKey;
  minM: number;
  maxM: number | null;
  destinations: number;
  arrivals: number;
  arrivalShare: number | null;
};

export interface ExplorerExclusions {
  missingTimestamp: number;
  invalidTimestamp: number;
  missingCoordinates: number;
  invalidCoordinates: number;
  outOfRangeCoordinates: number;
}

export interface ExplorerEligibility {
  observed: number;
  eligible: number;
  excluded: number;
  timestampEligible: number;
  coordinateEligible: number;
  usedEndTimestamp: number;
  usedStartTimestamp: number;
  timestampCoverageShare: number | null;
  coordinateCoverageShare: number | null;
  eligibleShare: number | null;
  exclusions: ExplorerExclusions;
}

export interface ObservedBase {
  label: string | null;
  visits: number;
  arrivalShare: number;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface RepeatBehavior {
  destinationArrivals: number;
  newArrivals: number;
  repeatArrivals: number;
  newShare: number | null;
  repeatShare: number | null;
}

export interface DiscoveryCadence {
  discoveries: number;
  observedIntervals: number;
  medianGapDays: number | null;
  longestGapDays: number | null;
  latestGapDays: number | null;
}

export interface ExplorerEvidence {
  baseSufficient: boolean;
  behaviorSufficient: boolean;
  rankingSufficient: boolean;
  cadenceSufficient: boolean;
}

export interface ExplorerSummary {
  inferredBase: ObservedBase | null;
  destinations: Destination[];
  uniquePlaces: number;
  farthest: Destination | null;
  /** Visit-weighted p90 distance from the inferred base, in meters. */
  radiusM: number | null;
  monthlyExploration: MonthlyExploration[];
  distanceBands: DistanceBand[];
  farthestRanking: Destination[];
  rareRanking: Destination[];
  repeatBehavior: RepeatBehavior;
  cadence: DiscoveryCadence;
  eligibility: ExplorerEligibility;
  evidence: ExplorerEvidence;
  historyLimit: number;
  historyCapReached: boolean;
}

export interface ExplorerOptions {
  historyLimit?: number;
}

type TimestampSource = 'end' | 'start';
type ExclusionKey = keyof ExplorerExclusions;

interface LocatedArrival {
  driveId: number;
  timestampMs: number;
  timestampIso: string;
  timestampSource: TimestampSource;
  month: string;
  monthOrder: number;
  lat: number;
  lon: number;
  address: string | null;
  cellKey: string;
}

interface Cluster {
  key: string;
  lat: number;
  lon: number;
  label: string | null;
  visits: number;
  firstMs: number;
  lastMs: number;
  firstIso: string;
  lastIso: string;
}

interface TimestampResult {
  status: 'valid';
  ms: number;
  iso: string;
  source: TimestampSource;
}

interface TimestampFailure {
  status: 'missing' | 'invalid';
}

interface CoordinateResult {
  status: 'valid';
  lat: number;
  lon: number;
}

interface CoordinateFailure {
  status: 'missing' | 'invalid' | 'outOfRange';
}

interface MonthlyAggregate {
  month: string;
  order: number;
  newPlaces: number;
  repeatArrivals: number;
  destinationArrivals: number;
}

const DISTANCE_BANDS: ReadonlyArray<{
  key: DistanceBandKey;
  minM: number;
  maxM: number | null;
}> = [
  { key: 'local', minM: 0, maxM: 5_000 },
  { key: 'near', minM: 5_000, maxM: 25_000 },
  { key: 'regional', minM: 25_000, maxM: 100_000 },
  { key: 'far', minM: 100_000, maxM: null },
];

/** Haversine great-circle distance in SI-canonical meters. */
export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRad(lat2 - lat1);
  const deltaLon = toRad(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function historyLimitOf(options: ExplorerOptions): number {
  const candidate = options.historyLimit;
  return typeof candidate === 'number' &&
    Number.isFinite(candidate) &&
    candidate > 0
    ? Math.min(EXPLORER_HISTORY_LIMIT, Math.floor(candidate))
    : EXPLORER_HISTORY_LIMIT;
}

function nonBlank(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validTimestamp(value: string | null | undefined): number | null {
  const normalized = nonBlank(value);
  if (normalized == null) return null;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function resolveTimestamp(drive: Drive): TimestampResult | TimestampFailure {
  const endValue = nonBlank(drive.endTs);
  const startValue = nonBlank(drive.startTs);
  const endMs = validTimestamp(endValue);
  if (endMs != null) {
    return {
      status: 'valid',
      ms: endMs,
      iso: new Date(endMs).toISOString(),
      source: 'end',
    };
  }

  const startMs = validTimestamp(startValue);
  if (startMs != null) {
    return {
      status: 'valid',
      ms: startMs,
      iso: new Date(startMs).toISOString(),
      source: 'start',
    };
  }

  return {
    status: endValue == null && startValue == null ? 'missing' : 'invalid',
  };
}

function resolveCoordinates(drive: Drive): CoordinateResult | CoordinateFailure {
  if (drive.endLat == null || drive.endLon == null) return { status: 'missing' };
  if (!Number.isFinite(drive.endLat) || !Number.isFinite(drive.endLon)) {
    return { status: 'invalid' };
  }
  if (
    drive.endLat < -90 ||
    drive.endLat > 90 ||
    drive.endLon < -180 ||
    drive.endLon > 180
  ) {
    return { status: 'outOfRange' };
  }
  return { status: 'valid', lat: drive.endLat, lon: drive.endLon };
}

function monthParts(ms: number): { key: string; order: number } {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  return {
    key: `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`,
    order: year * 12 + monthIndex,
  };
}

function cellOf(lat: number, lon: number): string {
  const latIndex = Math.round(lat / EXPLORER_CLUSTER_DEGREES);
  const lonIndex = Math.round(lon / EXPLORER_CLUSTER_DEGREES);
  return `${latIndex}:${lonIndex}`;
}

function compareArrivals(left: LocatedArrival, right: LocatedArrival): number {
  return (
    left.timestampMs - right.timestampMs ||
    left.driveId - right.driveId ||
    left.lat - right.lat ||
    left.lon - right.lon ||
    (left.address ?? '').localeCompare(right.address ?? '')
  );
}

function buildClusters(arrivals: readonly LocatedArrival[]): Cluster[] {
  const grouped = new Map<string, LocatedArrival[]>();
  for (const arrival of arrivals) {
    const group = grouped.get(arrival.cellKey) ?? [];
    group.push(arrival);
    grouped.set(arrival.cellKey, group);
  }

  return Array.from(grouped.entries()).map(([key, group]) => {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    return {
      key,
      lat: group.reduce((sum, item) => sum + item.lat, 0) / group.length,
      lon: group.reduce((sum, item) => sum + item.lon, 0) / group.length,
      label: group.find((item) => item.address != null)?.address ?? null,
      visits: group.length,
      firstMs: first.timestampMs,
      lastMs: last.timestampMs,
      firstIso: first.timestampIso,
      lastIso: last.timestampIso,
    };
  });
}

function compareBase(left: Cluster, right: Cluster): number {
  return (
    right.visits - left.visits ||
    left.firstMs - right.firstMs ||
    left.key.localeCompare(right.key)
  );
}

function compareDestinations(left: Destination, right: Destination): number {
  return (
    right.visits - left.visits ||
    right.distanceFromBaseM - left.distanceFromBaseM ||
    left.firstVisitedAt.localeCompare(right.firstVisitedAt) ||
    left.id.localeCompare(right.id)
  );
}

function percentile90(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.ceil(ordered.length * 0.9) - 1,
  );
  return ordered[index] ?? null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] ?? null;
  const lower = ordered[middle - 1];
  const upper = ordered[middle];
  return lower == null || upper == null ? null : (lower + upper) / 2;
}

function emptyDistanceBands(): DistanceBand[] {
  return DISTANCE_BANDS.map((band) => ({
    ...band,
    destinations: 0,
    arrivals: 0,
    arrivalShare: null,
  }));
}

function distanceBandsOf(
  destinations: readonly Destination[],
  enabled: boolean,
): DistanceBand[] {
  if (!enabled) return emptyDistanceBands();
  const totalArrivals = destinations.reduce(
    (sum, destination) => sum + destination.visits,
    0,
  );
  return DISTANCE_BANDS.map((definition) => {
    const members = destinations.filter(
      (destination) =>
        destination.distanceFromBaseM >= definition.minM &&
        (definition.maxM == null ||
          destination.distanceFromBaseM < definition.maxM),
    );
    const arrivals = members.reduce(
      (sum, destination) => sum + destination.visits,
      0,
    );
    return {
      ...definition,
      destinations: members.length,
      arrivals,
      arrivalShare: totalArrivals > 0 ? arrivals / totalArrivals : null,
    };
  });
}

function emptySummary(
  eligibility: ExplorerEligibility,
  historyLimit: number,
): ExplorerSummary {
  return {
    inferredBase: null,
    destinations: [],
    uniquePlaces: 0,
    farthest: null,
    radiusM: null,
    monthlyExploration: [],
    distanceBands: emptyDistanceBands(),
    farthestRanking: [],
    rareRanking: [],
    repeatBehavior: {
      destinationArrivals: 0,
      newArrivals: 0,
      repeatArrivals: 0,
      newShare: null,
      repeatShare: null,
    },
    cadence: {
      discoveries: 0,
      observedIntervals: 0,
      medianGapDays: null,
      longestGapDays: null,
      latestGapDays: null,
    },
    eligibility,
    evidence: {
      baseSufficient: false,
      behaviorSufficient: false,
      rankingSufficient: false,
      cadenceSufficient: false,
    },
    historyLimit,
    historyCapReached: eligibility.observed >= historyLimit,
  };
}

function exclusionFor(
  timestamp: TimestampResult | TimestampFailure,
  coordinates: CoordinateResult | CoordinateFailure,
): ExclusionKey | null {
  if (timestamp.status === 'missing') return 'missingTimestamp';
  if (timestamp.status === 'invalid') return 'invalidTimestamp';
  if (coordinates.status === 'missing') return 'missingCoordinates';
  if (coordinates.status === 'invalid') return 'invalidCoordinates';
  if (coordinates.status === 'outOfRange') return 'outOfRangeCoordinates';
  return null;
}

export function summarizeExplorer(
  drives: readonly Drive[],
  options: ExplorerOptions = {},
): ExplorerSummary {
  const historyLimit = historyLimitOf(options);
  const exclusions: ExplorerExclusions = {
    missingTimestamp: 0,
    invalidTimestamp: 0,
    missingCoordinates: 0,
    invalidCoordinates: 0,
    outOfRangeCoordinates: 0,
  };
  const arrivals: LocatedArrival[] = [];
  let timestampEligible = 0;
  let coordinateEligible = 0;
  let usedEndTimestamp = 0;
  let usedStartTimestamp = 0;

  for (const drive of drives) {
    const timestamp = resolveTimestamp(drive);
    const coordinates = resolveCoordinates(drive);
    if (timestamp.status === 'valid') timestampEligible += 1;
    if (coordinates.status === 'valid') coordinateEligible += 1;

    const exclusion = exclusionFor(timestamp, coordinates);
    if (exclusion != null) {
      exclusions[exclusion] += 1;
      continue;
    }
    if (timestamp.status !== 'valid' || coordinates.status !== 'valid') {
      continue;
    }

    const month = monthParts(timestamp.ms);
    arrivals.push({
      driveId: Number.isFinite(drive.id) ? drive.id : 0,
      timestampMs: timestamp.ms,
      timestampIso: timestamp.iso,
      timestampSource: timestamp.source,
      month: month.key,
      monthOrder: month.order,
      lat: coordinates.lat,
      lon: coordinates.lon,
      address: nonBlank(drive.endAddress),
      cellKey: cellOf(coordinates.lat, coordinates.lon),
    });
    if (timestamp.source === 'end') usedEndTimestamp += 1;
    else usedStartTimestamp += 1;
  }

  arrivals.sort(compareArrivals);
  const observed = drives.length;
  const eligible = arrivals.length;
  const eligibility: ExplorerEligibility = {
    observed,
    eligible,
    excluded: observed - eligible,
    timestampEligible,
    coordinateEligible,
    usedEndTimestamp,
    usedStartTimestamp,
    timestampCoverageShare: observed > 0 ? timestampEligible / observed : null,
    coordinateCoverageShare: observed > 0 ? coordinateEligible / observed : null,
    eligibleShare: observed > 0 ? eligible / observed : null,
    exclusions,
  };

  const clusters = buildClusters(arrivals);
  const base = [...clusters].sort(compareBase)[0] ?? null;
  if (base == null) return emptySummary(eligibility, historyLimit);

  const baseSufficient =
    eligible >= MIN_BASE_ARRIVALS &&
    base.visits >= MIN_BASE_CLUSTER_VISITS;
  const destinationClusters = clusters
    .filter(
      (cluster) => !baseSufficient || cluster.key !== base.key,
    )
    .sort((left, right) => left.key.localeCompare(right.key));
  const idByCell = new Map(
    destinationClusters.map((cluster, index) => [
      cluster.key,
      `destination-${index + 1}`,
    ]),
  );
  const destinations = destinationClusters
    .map((cluster, index): Destination => ({
      id: idByCell.get(cluster.key) ?? `destination-${index + 1}`,
      ordinal: index + 1,
      label: cluster.label,
      visits: cluster.visits,
      repeatVisits: Math.max(0, cluster.visits - 1),
      distanceFromBaseM: Math.round(
        haversineM(base.lat, base.lon, cluster.lat, cluster.lon),
      ),
      firstVisitedAt: cluster.firstIso,
      lastVisitedAt: cluster.lastIso,
      firstVisitMonth: monthParts(cluster.firstMs).key,
    }))
    .sort(compareDestinations);

  const seenDestinations = new Set<string>();
  const monthly = new Map<string, MonthlyAggregate>();
  const discoveryTimes: number[] = [];
  let repeatArrivals = 0;
  for (const arrival of arrivals) {
    if (baseSufficient && arrival.cellKey === base.key) continue;
    const aggregate = monthly.get(arrival.month) ?? {
      month: arrival.month,
      order: arrival.monthOrder,
      newPlaces: 0,
      repeatArrivals: 0,
      destinationArrivals: 0,
    };
    aggregate.destinationArrivals += 1;
    if (seenDestinations.has(arrival.cellKey)) {
      aggregate.repeatArrivals += 1;
      repeatArrivals += 1;
    } else {
      seenDestinations.add(arrival.cellKey);
      aggregate.newPlaces += 1;
      discoveryTimes.push(arrival.timestampMs);
    }
    monthly.set(arrival.month, aggregate);
  }

  let cumulativePlaces = 0;
  const monthlyExploration: MonthlyExploration[] = Array.from(monthly.values())
    .sort(
      (left, right) =>
        left.order - right.order || left.month.localeCompare(right.month),
    )
    .map((aggregate) => {
      cumulativePlaces += aggregate.newPlaces;
      return {
        month: aggregate.month,
        newPlaces: aggregate.newPlaces,
        repeatArrivals: aggregate.repeatArrivals,
        destinationArrivals: aggregate.destinationArrivals,
        cumulativePlaces,
        newArrivalShare:
          aggregate.destinationArrivals > 0
            ? aggregate.newPlaces / aggregate.destinationArrivals
            : null,
      };
    });

  const destinationArrivals = destinations.reduce(
    (sum, destination) => sum + destination.visits,
    0,
  );
  const newArrivals = destinations.length;
  const repeatBehavior: RepeatBehavior = {
    destinationArrivals,
    newArrivals,
    repeatArrivals,
    newShare:
      destinationArrivals > 0 ? newArrivals / destinationArrivals : null,
    repeatShare:
      destinationArrivals > 0 ? repeatArrivals / destinationArrivals : null,
  };

  const discoveryGaps = discoveryTimes.slice(1).map((time, index) => {
    const previous = discoveryTimes[index];
    return previous == null ? 0 : (time - previous) / DAY_MS;
  });
  const cadenceSufficient =
    baseSufficient &&
    discoveryTimes.length >= MIN_DISCOVERIES_FOR_CADENCE;
  const medianGap = cadenceSufficient ? median(discoveryGaps) : null;
  const cadence: DiscoveryCadence = {
    discoveries: discoveryTimes.length,
    observedIntervals: discoveryGaps.length,
    medianGapDays: medianGap == null ? null : round1(medianGap),
    longestGapDays:
      cadenceSufficient && discoveryGaps.length > 0
        ? round1(Math.max(...discoveryGaps))
        : null,
    latestGapDays:
      cadenceSufficient && discoveryGaps.length > 0
        ? round1(discoveryGaps[discoveryGaps.length - 1] ?? 0)
        : null,
  };

  const weightedDistances = destinations.flatMap((destination) =>
    Array.from(
      { length: destination.visits },
      () => destination.distanceFromBaseM,
    ),
  );
  const radiusM = baseSufficient ? percentile90(weightedDistances) : null;
  const farthest = baseSufficient
    ? [...destinations].sort(
        (left, right) =>
          right.distanceFromBaseM - left.distanceFromBaseM ||
          left.id.localeCompare(right.id),
      )[0] ?? null
    : null;
  const rankingSufficient =
    baseSufficient &&
    destinations.length >= MIN_DESTINATIONS_FOR_RANKING;
  const farthestRanking = rankingSufficient
    ? [...destinations]
        .sort(
          (left, right) =>
            right.distanceFromBaseM - left.distanceFromBaseM ||
            right.visits - left.visits ||
            left.firstVisitedAt.localeCompare(right.firstVisitedAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, RANKING_LIMIT)
    : [];
  const rareRanking = rankingSufficient
    ? destinations
        .filter(
          (destination) =>
            destination.visits <= RARE_DESTINATION_MAX_VISITS,
        )
        .sort(
          (left, right) =>
            left.visits - right.visits ||
            right.distanceFromBaseM - left.distanceFromBaseM ||
            left.firstVisitedAt.localeCompare(right.firstVisitedAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, RANKING_LIMIT)
    : [];

  const behaviorSufficient =
    baseSufficient &&
    destinationArrivals >= MIN_DESTINATION_ARRIVALS;

  return {
    inferredBase: {
      label: base.label,
      visits: base.visits,
      arrivalShare: base.visits / eligible,
      firstObservedAt: base.firstIso,
      lastObservedAt: base.lastIso,
    },
    destinations,
    uniquePlaces: destinations.length,
    farthest,
    radiusM,
    monthlyExploration,
    distanceBands: distanceBandsOf(destinations, baseSufficient),
    farthestRanking,
    rareRanking,
    repeatBehavior,
    cadence,
    eligibility,
    evidence: {
      baseSufficient,
      behaviorSufficient,
      rankingSufficient,
      cadenceSufficient,
    },
    historyLimit,
    historyCapReached: observed >= historyLimit,
  };
}
