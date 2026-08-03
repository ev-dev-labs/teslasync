import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { haversineKm, summarizeExplorer } from './explorer';

let nextId = 1;

function driveTo(endLat: number | null, endLon: number | null, over: Partial<Drive> = {}): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: `2026-07-${String(((nextId - 1) % 27) + 1).padStart(2, '0')}T08:00:00Z`,
    endTs: null,
    durationS: 1800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: 37.0,
    startLon: -122.0,
    endLat,
    endLon,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 2000,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const HOME: [number, number] = [37.0, -122.0];

describe('haversineKm', () => {
  it('is zero for identical points and symmetric', () => {
    expect(haversineKm(37, -122, 37, -122)).toBe(0);
    const ab = haversineKm(37, -122, 38, -121);
    expect(haversineKm(38, -121, 37, -122)).toBeCloseTo(ab);
  });

  it('measures one degree of latitude as ~111 km', () => {
    expect(haversineKm(37, -122, 38, -122)).toBeGreaterThan(105);
    expect(haversineKm(37, -122, 38, -122)).toBeLessThan(118);
  });
});

describe('summarizeExplorer', () => {
  it('anchors home on the most-visited cell and excludes it from destinations', () => {
    const drives = [
      driveTo(...HOME), driveTo(...HOME), driveTo(...HOME),
      driveTo(37.5, -122.5, { endAddress: 'Cabin' }),
    ];
    const s = summarizeExplorer(drives);
    expect(s.home).not.toBeNull();
    expect(s.home!.lat).toBeCloseTo(37.0);
    expect(s.uniquePlaces).toBe(1);
    expect(s.destinations[0]!.label).toBe('Cabin');
  });

  it('buckets nearby arrivals (~1 km) into one destination', () => {
    const drives = [
      driveTo(...HOME), driveTo(...HOME),
      driveTo(37.5011, -122.5012), driveTo(37.5014, -122.5008),
    ];
    const s = summarizeExplorer(drives);
    expect(s.uniquePlaces).toBe(1);
    expect(s.destinations[0]!.visits).toBe(2);
  });

  it('finds the farthest destination and a visit-weighted radius', () => {
    const drives = [
      driveTo(...HOME), driveTo(...HOME), driveTo(...HOME),
      driveTo(37.1, -122.0), driveTo(37.1, -122.0), // ~11 km, twice
      driveTo(39.0, -122.0), // ~222 km, once
    ];
    const s = summarizeExplorer(drives);
    expect(s.farthest!.distanceFromHomeKm).toBeGreaterThan(200);
    // p90 over weighted [11, 11, 222] → 222 (rank ceil(2.7)=3).
    expect(s.radiusKm).toBeGreaterThan(200);
  });

  it('counts first visits per month', () => {
    const drives = [
      driveTo(...HOME, { startTs: '2026-01-02T08:00:00Z' }),
      driveTo(...HOME, { startTs: '2026-01-03T08:00:00Z' }),
      driveTo(37.5, -122.5, { startTs: '2026-01-10T08:00:00Z' }),
      driveTo(37.5, -122.5, { startTs: '2026-02-11T08:00:00Z' }), // revisit
      driveTo(38.5, -121.5, { startTs: '2026-02-15T08:00:00Z' }),
    ];
    const s = summarizeExplorer(drives);
    expect(s.monthlyDiscoveries).toEqual([
      { month: '2026-01', newPlaces: 1 },
      { month: '2026-02', newPlaces: 1 },
    ]);
  });

  it('handles missing coordinates and empty input', () => {
    expect(summarizeExplorer([]).home).toBeNull();
    const s = summarizeExplorer([driveTo(null, null), driveTo(...HOME)]);
    expect(s.analyzed).toBe(1);
  });
});
