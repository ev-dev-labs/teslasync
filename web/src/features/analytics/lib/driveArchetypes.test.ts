import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  buildDrivePoints,
  kMeans,
  labelForCentroid,
  meanSilhouette,
  summarizeArchetypes,
} from './driveArchetypes';

let nextId = 1;

interface DriveSpec {
  km: number;
  speedKph: number;
  hour: number;
  whPerKm: number;
  tempC?: number;
  day?: number;
}

function drive({ km, speedKph, hour, whPerKm, tempC = 15, day = 1 }: DriveSpec): Drive {
  const distanceM = km * 1000;
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: new Date(2026, 2, day, hour, 5).toISOString(),
    endTs: null,
    durationS: Math.round((km / speedKph) * 3600),
    distanceM,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: whPerKm * km,
    regenEnergyWh: null,
    avgSpeedMps: speedKph / 3.6,
    maxSpeedMps: (speedKph / 3.6) * 1.4,
    avgPowerW: null,
    outsideTempAvgC: tempC,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

/** Deterministic jitter in [-1, 1) so synthetic blobs aren't perfectly discrete. */
function jitter(i: number, salt: number): number {
  return (Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453) % 1;
}

/** Two crisply separated habits: a morning city commute and a highway run. */
function bimodalFleet(perGroup: number): Drive[] {
  const out: Drive[] = [];
  for (let i = 0; i < perGroup; i++) {
    out.push(drive({
      km: 12 + jitter(i, 1) * 2,
      speedKph: 28 + jitter(i, 2) * 3,
      hour: 8,
      whPerKm: 190 + jitter(i, 3) * 8,
      day: 1 + (i % 20),
    }));
    out.push(drive({
      km: 140 + jitter(i, 4) * 12,
      speedKph: 100 + jitter(i, 5) * 5,
      hour: 14,
      whPerKm: 165 + jitter(i, 6) * 6,
      day: 1 + (i % 20),
    }));
  }
  return out;
}

describe('buildDrivePoints', () => {
  it('encodes hour on a circle so midnight neighbours 01:00', () => {
    const { points } = buildDrivePoints([
      drive({ km: 10, speedKph: 30, hour: 23, whPerKm: 180 }),
      drive({ km: 10, speedKph: 30, hour: 1, whPerKm: 180 }),
      drive({ km: 10, speedKph: 30, hour: 12, whPerKm: 180 }),
    ]);
    const circDist = (a: number, b: number) =>
      Math.hypot(
        points[a]!.features[2]! - points[b]!.features[2]!,
        points[a]!.features[3]! - points[b]!.features[3]!,
      );
    expect(circDist(0, 1)).toBeLessThan(circDist(0, 2));
  });

  it('skips drives without distance, energy or speed', () => {
    const noEnergy = { ...drive({ km: 10, speedKph: 30, hour: 9, whPerKm: 180 }), energyUsedWh: null };
    const tiny = drive({ km: 0.2, speedKph: 20, hour: 9, whPerKm: 180 });
    const noSpeed = { ...drive({ km: 10, speedKph: 30, hour: 9, whPerKm: 180 }), avgSpeedMps: null };
    const { points, skipped } = buildDrivePoints([noEnergy, tiny, noSpeed]);
    expect(points).toHaveLength(0);
    expect(skipped).toBe(3);
  });

  it('defaults a missing ambient temperature instead of producing NaN', () => {
    const noTemp = { ...drive({ km: 10, speedKph: 30, hour: 9, whPerKm: 180 }), outsideTempAvgC: null };
    const { points } = buildDrivePoints([noTemp]);
    expect(points[0]!.features.every((f) => Number.isFinite(f))).toBe(true);
  });
});

describe('kMeans', () => {
  const rand = () => 0.5;

  it('separates two obvious blobs', () => {
    const data: number[][] = [];
    for (let i = 0; i < 20; i++) data.push([0 + i * 0.01, 0]);
    for (let i = 0; i < 20; i++) data.push([10 + i * 0.01, 10]);
    const { assignments } = kMeans(data, 2, rand);
    const first = assignments.slice(0, 20);
    const second = assignments.slice(20);
    expect(new Set(first).size).toBe(1);
    expect(new Set(second).size).toBe(1);
    expect(first[0]).not.toBe(second[0]);
  });

  it('is deterministic for a fixed random source', () => {
    const data = Array.from({ length: 30 }, (_, i) => [i % 7, Math.floor(i / 7)]);
    const a = kMeans(data, 3, () => 0.3);
    const b = kMeans(data, 3, () => 0.3);
    expect(a.assignments).toEqual(b.assignments);
    expect(a.inertia).toBeCloseTo(b.inertia, 9);
  });

  it('lowers inertia as k grows', () => {
    const data = Array.from({ length: 40 }, (_, i) => [i, (i * 7) % 13]);
    const k2 = kMeans(data, 2, rand).inertia;
    const k5 = kMeans(data, 5, rand).inertia;
    expect(k5).toBeLessThan(k2);
  });
});

describe('meanSilhouette', () => {
  const twoBlobs = [
    ...Array.from({ length: 15 }, (_, i) => [i * 0.01, 0]),
    ...Array.from({ length: 15 }, (_, i) => [10 + i * 0.01, 0]),
  ];

  it('scores a correct partition near 1', () => {
    const assignments = twoBlobs.map((_, i) => (i < 15 ? 0 : 1));
    expect(meanSilhouette(twoBlobs, assignments, 2, 100)).toBeGreaterThan(0.9);
  });

  it('scores a partition that splits one blob poorly', () => {
    const assignments = twoBlobs.map((_, i) => (i % 2 === 0 ? 0 : 1));
    expect(meanSilhouette(twoBlobs, assignments, 2, 100)).toBeLessThan(0.2);
  });

  it('returns 0 for degenerate input', () => {
    expect(meanSilhouette([[1]], [0], 1, 10)).toBe(0);
  });
});

describe('labelForCentroid', () => {
  const base = { distanceKm: 20, speedKph: 40, hour: 12, whPerKm: 180, tempC: 15 };

  it('names archetypes from their physical position', () => {
    expect(labelForCentroid({ ...base, distanceKm: 300 })).toBe('roadTrip');
    expect(labelForCentroid({ ...base, distanceKm: 60, speedKph: 95 })).toBe('highwayRun');
    expect(labelForCentroid({ ...base, distanceKm: 3 })).toBe('shortHop');
    expect(labelForCentroid({ ...base, tempC: -5 })).toBe('coldWeather');
    expect(labelForCentroid({ ...base, hour: 8 })).toBe('morningCommute');
    expect(labelForCentroid({ ...base, hour: 18 })).toBe('eveningCommute');
    expect(labelForCentroid(base)).toBe('everyday');
  });
});

describe('summarizeArchetypes', () => {
  it('stays quiet below the evidence floor', () => {
    const summary = summarizeArchetypes(bimodalFleet(3));
    expect(summary.k).toBe(0);
    expect(summary.clusters).toEqual([]);
  });

  it('recovers two habits from bimodal history', () => {
    const summary = summarizeArchetypes(bimodalFleet(30));
    expect(summary.analyzedDrives).toBe(60);
    expect(summary.silhouette).toBeGreaterThan(0.4);

    // No cluster may mix the two habits: every cluster is either all-city or
    // all-highway, and each habit's drives are fully accounted for.
    const cityDrives = summary.clusters
      .filter((c) => c.centroid.speedKph < 50)
      .reduce((sum, c) => sum + c.size, 0);
    const highwayDrives = summary.clusters
      .filter((c) => c.centroid.speedKph >= 70)
      .reduce((sum, c) => sum + c.size, 0);

    expect(cityDrives).toBe(30);
    expect(highwayDrives).toBe(30);
    expect(summary.clusters.map((c) => c.label)).toContain('highwayRun');
  });

  it('partitions every analysed drive exactly once', () => {
    const summary = summarizeArchetypes(bimodalFleet(25));
    const ids = summary.clusters.flatMap((c) => c.driveIds);
    expect(ids).toHaveLength(summary.analyzedDrives);
    expect(new Set(ids).size).toBe(summary.analyzedDrives);
    const shareSum = summary.clusters.reduce((s, c) => s + c.share, 0);
    expect(shareSum).toBeCloseTo(1, 2);
  });

  it('is stable across repeated runs', () => {
    const drives = bimodalFleet(25);
    const a = summarizeArchetypes(drives);
    const b = summarizeArchetypes(drives);
    expect(a.clusters.map((c) => c.size)).toEqual(b.clusters.map((c) => c.size));
    expect(a.k).toBe(b.k);
  });

  it('sorts clusters by size descending', () => {
    const drives = [...bimodalFleet(20), ...Array.from({ length: 30 }, (_, i) =>
      drive({ km: 4, speedKph: 22, hour: 19, whPerKm: 230, day: 1 + (i % 20) }))];
    const summary = summarizeArchetypes(drives);
    const sizes = summary.clusters.map((c) => c.size);
    expect(sizes).toEqual([...sizes].sort((x, y) => y - x));
  });
});
