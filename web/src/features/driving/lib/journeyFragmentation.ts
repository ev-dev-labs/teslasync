/**
 * Journey fragmentation chains completed drives using observed parking gaps.
 *
 * The model describes recorded trip structure only. "Consolidatable" means a
 * compact chain of nearby-in-time fragments, not proof that any leg was
 * avoidable; distance and energy indicators are associations, not a routed
 * counterfactual.
 */
import type { Drive } from '@/types/driving';

export const DEFAULT_MAX_PARKING_GAP_MIN = 120;
export const DEFAULT_SHORT_STOPOVER_MIN = 30;

export interface JourneyFragmentationOptions {
  maxParkingGapMin?: number;
  shortStopoverMaxMin?: number;
  consolidatableDistanceM?: number;
  shortFragmentDistanceM?: number;
}

export interface Journey {
  driveIds: number[];
  startMs: number;
  endMs: number;
  fragments: number;
  parkingGapsMin: number[];
  shortStopovers: number;
  distanceM: number;
  energyUsedWh: number | null;
  consolidatable: boolean;
}

export interface JourneyFragmentationResult {
  journeys: Journey[];
  analyzedDrives: number;
  journeyCount: number;
  fragmentedJourneys: number;
  fragmentedShare: number | null;
  fragmentsPerJourney: number | null;
  shortStopovers: number;
  consolidatableChains: number;
  totalDistanceM: number;
  shortFragmentDistanceM: number;
  shortFragmentDistanceShare: number | null;
  singleJourneyWhPerKm: number | null;
  fragmentedJourneyWhPerKm: number | null;
  energyOverheadWhPerKm: number | null;
}

interface TimedDrive {
  drive: Drive;
  startMs: number;
  endMs: number;
}

function positive(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : fallback;
}

function distance(drive: Drive): number {
  return Number.isFinite(drive.distanceM) && drive.distanceM > 0 ? drive.distanceM : 0;
}

function journeyFrom(
  drives: readonly TimedDrive[],
  gapsMin: readonly number[],
  shortStopoverMaxMin: number,
  consolidatableDistanceM: number,
): Journey {
  const distanceM = drives.reduce((sum, item) => sum + distance(item.drive), 0);
  const energyRows = drives.filter(
    (item) => item.drive.energyUsedWh != null
      && Number.isFinite(item.drive.energyUsedWh) && item.drive.energyUsedWh >= 0
      && distance(item.drive) > 0,
  );
  const energyUsedWh = energyRows.length === drives.length
    ? energyRows.reduce((sum, item) => sum + item.drive.energyUsedWh!, 0)
    : null;
  const shortStopovers = gapsMin.filter((gap) => gap <= shortStopoverMaxMin).length;
  return {
    driveIds: drives.map((item) => item.drive.id),
    startMs: drives[0]!.startMs,
    endMs: drives[drives.length - 1]!.endMs,
    fragments: drives.length,
    parkingGapsMin: [...gapsMin],
    shortStopovers,
    distanceM,
    energyUsedWh,
    consolidatable:
      drives.length > 1
      && gapsMin.every((gap) => gap <= shortStopoverMaxMin)
      && distanceM <= consolidatableDistanceM,
  };
}

function efficiency(journeys: readonly Journey[]): number | null {
  let distanceM = 0;
  let energyWh = 0;
  for (const journey of journeys) {
    if (journey.energyUsedWh == null || journey.distanceM <= 0) continue;
    distanceM += journey.distanceM;
    energyWh += journey.energyUsedWh;
  }
  return distanceM > 0 ? energyWh / (distanceM / 1000) : null;
}

export function analyzeJourneyFragmentation(
  drives: readonly Drive[],
  options: JourneyFragmentationOptions = {},
): JourneyFragmentationResult {
  const maxParkingGapMin = positive(options.maxParkingGapMin, DEFAULT_MAX_PARKING_GAP_MIN);
  const shortStopoverMaxMin = positive(options.shortStopoverMaxMin, DEFAULT_SHORT_STOPOVER_MIN);
  const consolidatableDistanceM = positive(options.consolidatableDistanceM, 50_000);
  const shortFragmentDistanceM = positive(options.shortFragmentDistanceM, 5_000);

  const timed = drives.map<TimedDrive | null>((drive) => {
    const startMs = new Date(drive.startTs).getTime();
    const endMs = drive.endTs == null ? Number.NaN : new Date(drive.endTs).getTime();
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? { drive, startMs, endMs }
      : null;
  }).filter((item): item is TimedDrive => item != null)
    .sort((a, b) => a.startMs - b.startMs || a.drive.id - b.drive.id);

  const journeys: Journey[] = [];
  let chain: TimedDrive[] = [];
  let gapsMin: number[] = [];
  const flush = () => {
    if (chain.length > 0) {
      journeys.push(journeyFrom(chain, gapsMin, shortStopoverMaxMin, consolidatableDistanceM));
    }
    chain = [];
    gapsMin = [];
  };

  for (const item of timed) {
    const previous = chain.length > 0 ? chain[chain.length - 1] : undefined;
    if (!previous) {
      chain.push(item);
      continue;
    }
    const gapMin = (item.startMs - previous.endMs) / 60_000;
    if (gapMin >= 0 && gapMin <= maxParkingGapMin) {
      chain.push(item);
      gapsMin.push(gapMin);
    } else {
      flush();
      chain.push(item);
    }
  }
  flush();

  const fragmented = journeys.filter((journey) => journey.fragments > 1);
  const singles = journeys.filter((journey) => journey.fragments === 1);
  const totalDistanceM = journeys.reduce((sum, journey) => sum + journey.distanceM, 0);
  const fragmentedDriveIds = new Set(fragmented.flatMap((journey) => journey.driveIds));
  const shortDistanceM = timed.reduce(
    (sum, item) =>
      fragmentedDriveIds.has(item.drive.id) && distance(item.drive) <= shortFragmentDistanceM
        ? sum + distance(item.drive)
        : sum,
    0,
  );
  const singleJourneyWhPerKm = efficiency(singles);
  const fragmentedJourneyWhPerKm = efficiency(fragmented);

  return {
    journeys,
    analyzedDrives: timed.length,
    journeyCount: journeys.length,
    fragmentedJourneys: fragmented.length,
    fragmentedShare: journeys.length > 0 ? fragmented.length / journeys.length : null,
    fragmentsPerJourney:
      journeys.length > 0 ? timed.length / journeys.length : null,
    shortStopovers: journeys.reduce((sum, journey) => sum + journey.shortStopovers, 0),
    consolidatableChains: journeys.filter((journey) => journey.consolidatable).length,
    totalDistanceM,
    shortFragmentDistanceM: shortDistanceM,
    shortFragmentDistanceShare: totalDistanceM > 0 ? shortDistanceM / totalDistanceM : null,
    singleJourneyWhPerKm,
    fragmentedJourneyWhPerKm,
    energyOverheadWhPerKm:
      singleJourneyWhPerKm != null && fragmentedJourneyWhPerKm != null
        ? fragmentedJourneyWhPerKm - singleJourneyWhPerKm
        : null,
  };
}
