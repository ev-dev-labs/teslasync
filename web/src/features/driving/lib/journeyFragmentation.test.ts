import { describe, expect, it } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  analyzeJourneyFragmentation,
  DEFAULT_MAX_PARKING_GAP_MIN,
} from './journeyFragmentation';

let id = 1;
const MINUTE = 60_000;

function drive(startMinute: number, overrides: Partial<Drive> = {}): Drive {
  const start = Date.UTC(2026, 0, 1, 8, 0) + startMinute * MINUTE;
  return {
    id: id++,
    vehicleId: 1,
    startTs: new Date(start).toISOString(),
    endTs: new Date(start + 30 * MINUTE).toISOString(),
    durationS: 1800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: 1800,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('analyzeJourneyFragmentation', () => {
  it('sorts drives and chains gaps up to the inclusive default threshold', () => {
    const result = analyzeJourneyFragmentation([
      drive(300),
      drive(0),
      drive(150), // 120 minutes after the first drive ended
    ]);
    expect(DEFAULT_MAX_PARKING_GAP_MIN).toBe(120);
    expect(result.journeyCount).toBe(1);
    expect(result.journeys[0]?.driveIds).toHaveLength(3);
    expect(result.journeys[0]?.parkingGapsMin).toEqual([120, 120]);
  });

  it('splits chains when parking exceeds the configured maximum', () => {
    const drives = [drive(0), drive(91)];
    expect(analyzeJourneyFragmentation(drives, { maxParkingGapMin: 60 }).journeyCount).toBe(2);
    expect(analyzeJourneyFragmentation(drives, { maxParkingGapMin: 61 }).journeyCount).toBe(1);
  });

  it('identifies short stopovers and compact consolidatable chains', () => {
    const result = analyzeJourneyFragmentation([
      drive(0, { distanceM: 4000 }),
      drive(50, { distanceM: 5000 }),
      drive(100, { distanceM: 6000 }),
    ]);
    expect(result.shortStopovers).toBe(2);
    expect(result.consolidatableChains).toBe(1);
    expect(result.journeys[0]?.consolidatable).toBe(true);

    const long = analyzeJourneyFragmentation([
      drive(0, { distanceM: 30_000 }),
      drive(50, { distanceM: 30_000 }),
    ]);
    expect(long.consolidatableChains).toBe(0);
  });

  it('computes fragmented share and mean fragments per journey', () => {
    const result = analyzeJourneyFragmentation([
      drive(0),
      drive(60),
      drive(500),
    ]);
    expect(result.journeyCount).toBe(2);
    expect(result.fragmentedJourneys).toBe(1);
    expect(result.fragmentedShare).toBe(0.5);
    expect(result.fragmentsPerJourney).toBe(1.5);
  });

  it('reports short-fragment distance as an indicator, not added distance', () => {
    const result = analyzeJourneyFragmentation([
      drive(0, { distanceM: 3000 }),
      drive(60, { distanceM: 7000 }),
      drive(500, { distanceM: 10_000 }),
    ]);
    expect(result.totalDistanceM).toBe(20_000);
    expect(result.shortFragmentDistanceM).toBe(3000);
    expect(result.shortFragmentDistanceShare).toBe(0.15);
  });

  it('compares distance-weighted energy intensity by journey structure', () => {
    const result = analyzeJourneyFragmentation([
      drive(0, { distanceM: 10_000, energyUsedWh: 2000 }),
      drive(60, { distanceM: 10_000, energyUsedWh: 2000 }),
      drive(500, { distanceM: 20_000, energyUsedWh: 3000 }),
    ]);
    expect(result.fragmentedJourneyWhPerKm).toBe(200);
    expect(result.singleJourneyWhPerKm).toBe(150);
    expect(result.energyOverheadWhPerKm).toBe(50);
  });

  it('withholds the energy comparison when either side lacks complete energy', () => {
    const result = analyzeJourneyFragmentation([
      drive(0, { energyUsedWh: null }),
      drive(60),
      drive(500),
    ]);
    expect(result.fragmentedJourneyWhPerKm).toBeNull();
    expect(result.energyOverheadWhPerKm).toBeNull();
  });

  it('skips open, reversed, and malformed drives', () => {
    const result = analyzeJourneyFragmentation([
      drive(0, { endTs: null }),
      drive(60, { startTs: 'bad' }),
      drive(120, { endTs: '2020-01-01T00:00:00Z' }),
    ]);
    expect(result.analyzedDrives).toBe(0);
    expect(result.journeys).toEqual([]);
    expect(result.fragmentedShare).toBeNull();
  });

  it('sanitizes invalid option values back to defaults', () => {
    const result = analyzeJourneyFragmentation(
      [drive(0), drive(150)],
      { maxParkingGapMin: Number.NaN, shortStopoverMaxMin: -1 },
    );
    expect(result.journeyCount).toBe(1);
    expect(result.shortStopovers).toBe(0);
  });
});
