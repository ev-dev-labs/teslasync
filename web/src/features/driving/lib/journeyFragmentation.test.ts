import { describe, expect, it } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  analyzeJourneyFragmentation,
  DEFAULT_GPS_TOLERANCE_M,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_MAX_PARKING_GAP_MIN,
} from './journeyFragmentation';

const MINUTE = 60_000;
const NOW = Date.parse('2026-08-08T12:00:00.000Z');
let nextId = 1;

function driveAt(
  minute: number,
  overrides: Partial<Drive> = {},
): Drive {
  const start = Date.parse('2026-08-01T08:00:00.000Z') + minute * MINUTE;
  const durationS = overrides.durationS ?? 1_800;
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: new Date(start).toISOString(),
    endTs: new Date(start + durationS * 1_000).toISOString(),
    durationS,
    distanceM: 10_000,
    startAddress: 'Home',
    endAddress: 'Stop',
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: 2_000,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: 'completed',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function linkedPair(firstMinute: number, secondMinute: number): Drive[] {
  return [
    driveAt(firstMinute, { startAddress: 'Home', endAddress: 'Same place' }),
    driveAt(secondMinute, { startAddress: 'same PLACE', endAddress: 'Office' }),
  ];
}

describe('analyzeJourneyFragmentation', () => {
  it('sorts a copied view of input and links an inclusive selected threshold', () => {
    const drives = linkedPair(0, 150);
    const returnedOutOfOrder = [drives[1]!, drives[0]!];
    const original = returnedOutOfOrder.map((drive) => ({ ...drive }));
    const result = analyzeJourneyFragmentation(returnedOutOfOrder, NOW, 'UTC', {
      maxParkingGapMin: 120,
    });

    expect(result.journeyCount).toBe(1);
    expect(result.linkedPairs).toBe(1);
    expect(result.journeys[0]?.parkingGapsMin).toEqual([120]);
    expect(returnedOutOfOrder).toEqual(original);
    expect(result.journeys[0]?.driveIds).toEqual([drives[0]!.id, drives[1]!.id]);
  });

  it('accepts GPS continuity within the default tolerance and rejects a mismatch', () => {
    const nearby = [
      driveAt(0, { endAddress: null, endLat: 37, endLon: -122 }),
      driveAt(30, { startAddress: null, startLat: 37.001, startLon: -122 }),
    ];
    const nearbyResult = analyzeJourneyFragmentation(nearby, NOW, 'UTC');
    expect(nearbyResult.pairAccounting.linked).toBe(1);

    const far = [
      driveAt(0, { endAddress: null, endLat: 37, endLon: -122 }),
      driveAt(30, { startAddress: null, startLat: 38, startLon: -122 }),
    ];
    const farResult = analyzeJourneyFragmentation(far, NOW, 'UTC');
    expect(farResult.pairAccounting.endpointMismatch).toBe(1);
    expect(DEFAULT_GPS_TOLERANCE_M).toBe(250);
  });

  it('keeps missing endpoints as a single included journey and accounts for the pair', () => {
    const result = analyzeJourneyFragmentation([
      driveAt(0, { startAddress: null, endAddress: null }),
      driveAt(30, { startAddress: null, endAddress: null }),
    ], NOW, 'UTC');

    expect(result.includedDrives).toBe(2);
    expect(result.journeyCount).toBe(2);
    expect(result.pairAccounting.unlocatableEndpoint).toBe(1);
  });

  it('uses placed unusable rows as boundaries without poisoning later evidence', () => {
    const boundary = driveAt(30, {
      durationS: 0,
      endTs: new Date(Date.parse('2026-08-01T09:00:00.000Z')).toISOString(),
    });
    const result = analyzeJourneyFragmentation([
      driveAt(0, { endAddress: 'A', startAddress: 'Home' }),
      boundary,
      driveAt(60, { startAddress: 'A', endAddress: 'Office' }),
      driveAt(120, { startAddress: 'Office', endAddress: 'Home' }),
    ], NOW, 'UTC');

    expect(result.rowAccounting.invalidDuration).toBe(1);
    expect(result.pairAccounting.unusableSourceBoundary).toBe(2);
    expect(result.journeyCount).toBe(2);
    expect(result.journeys[1]?.driveIds).toHaveLength(2);
  });

  it('creates local source boundaries around rows with unparseable starts', () => {
    const result = analyzeJourneyFragmentation([
      driveAt(0, { endAddress: 'A' }),
      driveAt(30, { startTs: 'not-a-date', endAddress: 'B' }),
      driveAt(60, { startAddress: 'A', endAddress: 'C' }),
      driveAt(90, { startAddress: 'C', endAddress: 'D' }),
    ], NOW, 'UTC');

    expect(result.rowAccounting.invalidTimestampOrder).toBe(1);
    expect(result.pairAccounting.unusableSourceBoundary).toBe(2);
    expect(result.journeys.at(-1)?.driveIds).toHaveLength(2);
  });

  it('classifies future, live, invalid duration, and invalid timestamp/order rows exclusively', () => {
    const future = driveAt(0);
    future.startTs = new Date(NOW + MINUTE).toISOString();
    future.endTs = new Date(NOW + 31 * MINUTE).toISOString();
    const result = analyzeJourneyFragmentation([
      future,
      driveAt(0, { endTs: null }),
      driveAt(0, { durationS: 0, endTs: '2026-08-01T09:00:00.000Z' }),
      driveAt(0, { endTs: '2026-08-01T07:00:00.000Z' }),
    ], NOW, 'UTC');

    expect(result.rowAccounting).toMatchObject({
      future: 1,
      incompleteLive: 1,
      invalidDuration: 1,
      invalidTimestampOrder: 1,
      included: 0,
      excluded: 4,
    });
    expect(result.classifiedRows).toHaveLength(4);
  });

  it('reconciles every returned row and every adjacent pair', () => {
    const result = analyzeJourneyFragmentation([
      ...linkedPair(0, 30),
      driveAt(60, { durationS: -1 }),
      driveAt(90, { startTs: 'bad' }),
    ], NOW, 'UTC');
    const rows = result.rowAccounting;
    expect(rows.included + rows.excluded).toBe(result.returnedRows);
    expect(
      result.pairAccounting.linked
      + result.pairAccounting.unusableSourceBoundary
      + result.pairAccounting.unlocatableEndpoint
      + result.pairAccounting.endpointMismatch
      + result.pairAccounting.overlapNegativeGap
      + result.pairAccounting.overSelectedGap,
    ).toBe(result.pairAccounting.totalAdjacentPairs);
    expect(result.journeyCount).toBe(result.includedDrives - result.linkedPairs);
  });

  it('reports overlap as a distinct boundary and does not link it', () => {
    const result = analyzeJourneyFragmentation([
      driveAt(0, { durationS: 7_200, endAddress: 'A' }),
      driveAt(60, { startAddress: 'A', endAddress: 'B' }),
    ], NOW, 'UTC');
    expect(result.pairAccounting.overlapNegativeGap).toBe(1);
    expect(result.linkedPairs).toBe(0);
  });

  it('reports the returned-history cap, spans, and recency', () => {
    const result = analyzeJourneyFragmentation([driveAt(0), driveAt(60)], NOW, 'UTC', {
      historyLimit: 2,
    });
    expect(result.capReached).toBe(true);
    expect(result.returnedRows).toBe(2);
    expect(result.includedSpanDays).toBeGreaterThan(0);
    expect(result.daysSinceLatestIncludedDrive).toBeGreaterThan(0);
    expect(result.historyLimit).toBe(2);
    expect(DEFAULT_HISTORY_LIMIT).toBe(1_000);
  });

  it('marks compact observed chains with a structural rule only', () => {
    const result = analyzeJourneyFragmentation([
      driveAt(0, { endAddress: 'A', distanceM: 4_000 }),
      driveAt(45, { startAddress: 'A', endAddress: 'B', distanceM: 4_000 }),
    ], NOW, 'UTC');
    expect(result.compactObservedChainCount).toBe(1);
    expect(result.journeys[0]?.isCompactObservedChain).toBe(true);
  });

  it('summarizes distributions, duration allocation, and short-fragment denominators', () => {
    const result = analyzeJourneyFragmentation([
      driveAt(0, { endAddress: 'A', distanceM: 2_000, durationS: 600 }),
      driveAt(40, { startAddress: 'A', endAddress: 'B', distanceM: 8_000, durationS: 1_200 }),
      driveAt(200, { distanceM: 3_000, durationS: 900 }),
    ], NOW, 'UTC');

    expect(result.chainFragmentSummary.median).toBe(1.5);
    expect(result.linkedGapSummary.median).toBe(30);
    expect(result.drivingSeconds).toBe(2_700);
    expect(result.observedParkingSeconds).toBe(1_800);
    expect(result.shortFragmentCount).toBe(2);
    expect(result.shortFragmentDenominator).toBe(3);
    expect(result.shortFragmentDistanceM).toBe(5_000);
  });

  it('reports complete-energy counts, coverage, and a separate support gate', () => {
    const result = analyzeJourneyFragmentation([
      driveAt(0, { endAddress: 'A', energyUsedWh: 2_000 }),
      driveAt(30, { startAddress: 'A', energyUsedWh: null }),
      driveAt(300, { energyUsedWh: 3_000 }),
      driveAt(500, { energyUsedWh: 4_000 }),
    ], NOW, 'UTC');
    const energy = result.energyComparison;

    expect(energy.singleDrive.completeEnergyJourneys).toBe(2);
    expect(energy.multiDrive.completeEnergyJourneys).toBe(0);
    expect(energy.multiDrive.distanceCoverage).toBe(0);
    expect(energy.observedDifferenceWhPerM).toBeNull();
    expect(energy.supportBand).toBe('unavailable');
  });

  it('keeps energy comparison descriptive when both groups are complete but thin', () => {
    const result = analyzeJourneyFragmentation([
      driveAt(0, { endAddress: 'A', energyUsedWh: 1_000 }),
      driveAt(30, { startAddress: 'A', energyUsedWh: 1_000 }),
      driveAt(300, { energyUsedWh: 3_000 }),
    ], NOW, 'UTC');
    expect(result.energyComparison.observedDifferenceWhPerM).not.toBeNull();
    expect(result.energyComparison.supportBand).toBe('thin');
  });

  it('computes fixed sensitivity with the same location rules', () => {
    const result = analyzeJourneyFragmentation([
      driveAt(0, { endAddress: 'A' }),
      driveAt(90, { startAddress: 'A' }),
    ], NOW, 'UTC');
    expect(result.sensitivity.map((point) => point.thresholdMin)).toEqual([30, 60, 120, 240]);
    expect(result.sensitivity.find((point) => point.thresholdMin === 60)?.journeyCount).toBe(1);
    expect(result.sensitivity.find((point) => point.thresholdMin === 30)?.journeyCount).toBe(2);
  });

  it('uses the vehicle timezone for hour, weekday, month, days, and DST-safe profiles', () => {
    const result = analyzeJourneyFragmentation([
      driveAt(0, { startTs: '2026-03-08T09:30:00.000Z', endTs: '2026-03-08T10:00:00.000Z' }),
      driveAt(1_000, { startTs: '2026-11-01T08:30:00.000Z', endTs: '2026-11-01T09:00:00.000Z' }),
    ], Date.parse('2026-12-01T00:00:00.000Z'), 'America/Los_Angeles');
    expect(result.timeZone).toBe('America/Los_Angeles');
    expect(result.startTwoHourProfile.length).toBeGreaterThan(0);
    expect(result.weekdayProfile[0]?.driveCount).toBe(2);
    expect(result.monthlyProfile.map((point) => point.key)).toEqual(['2026-03', '2026-11']);
    expect(result.activeDays).toBe(2);
    expect(result.activeWeeks).toBe(2);
  });

  it('falls back safely for hostile options, dates, and coordinates', () => {
    const result = analyzeJourneyFragmentation([
      driveAt(0, {
        startLat: Number.POSITIVE_INFINITY,
        endLon: Number.NaN,
      }),
    ], NOW, 'not/a-timezone', {
      maxParkingGapMin: Number.POSITIVE_INFINITY,
      shortStopoverMaxMin: -4,
      gpsToleranceM: Number.NaN,
      historyLimit: Number.POSITIVE_INFINITY,
      minimumEnergySupportJourneys: 0,
    });
    expect(result.timeZone).toBe('UTC');
    expect(result.options.maxParkingGapMin).toBe(DEFAULT_MAX_PARKING_GAP_MIN);
    expect(result.options.gpsToleranceM).toBe(DEFAULT_GPS_TOLERANCE_M);
    expect(result.historyLimit).toBe(DEFAULT_HISTORY_LIMIT);
    expect(result.journeyCount).toBe(1);
  });
});
