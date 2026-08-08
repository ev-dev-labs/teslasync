import { beforeEach, describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';
import {
  MAX_ARCHETYPE_DIRECTORY_LIMIT,
  adjustedRandIndex,
  buildDrivePoints,
  kMeans,
  labelForCentroid,
  meanSilhouette,
  summarizeArchetypes,
  type ArchetypeCentroid,
  type ArchetypeOptions,
} from './driveArchetypes';

let nextId = 1;

interface DriveSpec {
  km: number;
  speedKph: number;
  hour: number;
  whPerKm: number;
  tempC?: number | null;
  day?: number;
}

function drive({
  km,
  speedKph,
  hour,
  whPerKm,
  tempC = 15,
  day = 1,
}: DriveSpec): Drive {
  const distanceM = km * 1000;
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: new Date(Date.UTC(2026, 2, day, hour, 5)).toISOString(),
    endTs: null,
    durationS: Math.round((km / speedKph) * 3600),
    distanceM,
    startAddress: `Start ${day}`,
    endAddress: `End ${day}`,
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

function jitter(index: number, salt: number): number {
  return (Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453) % 1;
}

function bimodalFleet(perGroup: number): Drive[] {
  const result: Drive[] = [];
  for (let index = 0; index < perGroup; index += 1) {
    result.push(
      drive({
        km: 12 + jitter(index, 1) * 2,
        speedKph: 28 + jitter(index, 2) * 3,
        hour: 8,
        whPerKm: 190 + jitter(index, 3) * 8,
        day: 1 + (index % 20),
      }),
      drive({
        km: 140 + jitter(index, 4) * 12,
        speedKph: 100 + jitter(index, 5) * 5,
        hour: 14,
        whPerKm: 165 + jitter(index, 6) * 6,
        day: 1 + (index % 20),
      }),
    );
  }
  return result;
}

beforeEach(() => {
  nextId = 1;
});

describe('buildDrivePoints source accounting', () => {
  it('assigns every hostile source row to exactly one disposition', () => {
    const valid = drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180 });
    const imputed = drive({
      km: 12,
      speedKph: 32,
      hour: 9,
      whPerKm: 185,
      tempC: null,
    });
    const rows = [
      valid,
      imputed,
      null,
      { ...drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180 }), id: 0 },
      { ...valid },
      { ...drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180 }), startTs: '' },
      { ...drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180 }), startTs: 'bad' },
      { ...drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180 }), distanceM: Number.NaN },
      drive({ km: 0.2, speedKph: 20, hour: 8, whPerKm: 180 }),
      { ...drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180 }), energyUsedWh: null },
      { ...drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180 }), energyUsedWh: 0 },
      { ...drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180 }), avgSpeedMps: null },
      { ...drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180 }), avgSpeedMps: 0 },
    ] as unknown as Drive[];

    const result = buildDrivePoints(rows);

    expect(result.points).toHaveLength(2);
    expect(result.skipped).toBe(11);
    expect(result.accounting).toEqual({
      returnedRows: 13,
      invalidRowRows: 1,
      invalidIdRows: 1,
      duplicateDriveRows: 1,
      missingStartRows: 1,
      invalidStartRows: 1,
      invalidDistanceRows: 1,
      shortDistanceRows: 1,
      missingEnergyRows: 1,
      invalidEnergyRows: 1,
      missingSpeedRows: 1,
      invalidSpeedRows: 1,
      eligibleObservedTempRows: 1,
      eligibleImputedTempRows: 1,
    });
  });

  it('uses the eligible observed-temperature median for missing temperatures', () => {
    const result = buildDrivePoints([
      drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180, tempC: 10 }),
      drive({ km: 12, speedKph: 32, hour: 9, whPerKm: 185, tempC: 20 }),
      drive({ km: 14, speedKph: 34, hour: 10, whPerKm: 190, tempC: null }),
    ]);

    expect(result.temperatureImputationC).toBe(15);
    expect(result.temperatureImputationSource).toBe('observed_median');
    expect(result.points[2]).toMatchObject({
      tempC: 15,
      tempImputed: true,
    });
    expect(result.points[2]!.features.every(Number.isFinite)).toBe(true);
  });

  it('discloses the configured fallback when no measured temperature exists', () => {
    const result = buildDrivePoints([
      drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180, tempC: null }),
      drive({ km: 12, speedKph: 32, hour: 9, whPerKm: 185, tempC: null }),
    ], { defaultTempC: 12 });

    expect(result.temperatureImputationC).toBe(12);
    expect(result.temperatureImputationSource).toBe('configured_default');
    expect(result.points.every((point) => point.tempC === 12)).toBe(true);
  });

  it('derives calendar features in the configured IANA timezone', () => {
    const source = drive({
      km: 10,
      speedKph: 30,
      hour: 8,
      whPerKm: 180,
    });
    source.startTs = '2026-03-01T07:30:00.000Z';

    const utc = buildDrivePoints([source], { timeZone: 'UTC' }).points[0]!;
    const losAngeles = buildDrivePoints(
      [source],
      { timeZone: 'America/Los_Angeles' },
    ).points[0]!;

    expect(utc.hour).toBe(7.5);
    expect(utc.month).toBe('2026-03');
    expect(losAngeles.hour).toBe(23.5);
    expect(losAngeles.month).toBe('2026-02');
  });

  it('encodes local hour on a circle so 23:00 is nearer 01:00 than noon', () => {
    const { points } = buildDrivePoints([
      drive({ km: 10, speedKph: 30, hour: 23, whPerKm: 180 }),
      drive({ km: 10, speedKph: 30, hour: 1, whPerKm: 180 }),
      drive({ km: 10, speedKph: 30, hour: 12, whPerKm: 180 }),
    ]);
    const circularDistance = (left: number, right: number) =>
      Math.hypot(
        points[left]!.features[2]! - points[right]!.features[2]!,
        points[left]!.features[3]! - points[right]!.features[3]!,
      );

    expect(circularDistance(0, 1)).toBeLessThan(circularDistance(0, 2));
  });

  it('does not mutate source arrays or rows', () => {
    const drives = bimodalFleet(12);
    const before = structuredClone(drives);

    summarizeArchetypes(drives);

    expect(drives).toEqual(before);
  });
});

describe('clustering primitives', () => {
  const random = () => 0.5;

  it('separates two obvious blobs', () => {
    const data = [
      ...Array.from({ length: 20 }, (_, index) => [index * 0.01, 0]),
      ...Array.from({ length: 20 }, (_, index) => [10 + index * 0.01, 10]),
    ];
    const result = kMeans(data, 2, random);

    expect(new Set(result.assignments.slice(0, 20)).size).toBe(1);
    expect(new Set(result.assignments.slice(20)).size).toBe(1);
    expect(result.assignments[0]).not.toBe(result.assignments[20]);
  });

  it('is deterministic for a fixed random source', () => {
    const data = Array.from({ length: 30 }, (_, index) => [
      index % 7,
      Math.floor(index / 7),
    ]);
    const first = kMeans(data, 3, () => 0.3);
    const second = kMeans(data, 3, () => 0.3);

    expect(first.assignments).toEqual(second.assignments);
    expect(first.inertia).toBeCloseTo(second.inertia, 9);
  });

  it('lowers inertia as k grows on varied data', () => {
    const data = Array.from({ length: 40 }, (_, index) => [
      index,
      (index * 7) % 13,
    ]);

    expect(kMeans(data, 5, random).inertia)
      .toBeLessThan(kMeans(data, 2, random).inertia);
  });

  it('rejects invalid low-level requests loudly', () => {
    expect(() => kMeans([], 2, random)).toThrow(RangeError);
    expect(() => kMeans([[1]], 2, random)).toThrow(RangeError);
  });

  it('scores a correct partition near one and a mixed partition low', () => {
    const blobs = [
      ...Array.from({ length: 15 }, (_, index) => [index * 0.01, 0]),
      ...Array.from({ length: 15 }, (_, index) => [10 + index * 0.01, 0]),
    ];
    const correct = blobs.map((_, index) => (index < 15 ? 0 : 1));
    const mixed = blobs.map((_, index) => index % 2);

    expect(meanSilhouette(blobs, correct, 2, 100)).toBeGreaterThan(0.9);
    expect(meanSilhouette(blobs, mixed, 2, 100)).toBeLessThan(0.2);
  });

  it('counts singleton-cluster members as zero silhouette evidence', () => {
    const value = meanSilhouette([[0], [0.1], [10]], [0, 0, 1], 2, 100);

    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(0.8);
  });

  it('measures restart agreement independently of cluster label numbers', () => {
    expect(adjustedRandIndex([0, 0, 1, 1], [5, 5, 9, 9])).toBe(1);
    expect(adjustedRandIndex([0, 0, 1, 1], [0, 1, 0, 1])).toBeLessThan(1);
    expect(adjustedRandIndex([0], [0])).toBe(0);
  });
});

describe('labelForCentroid', () => {
  const base: ArchetypeCentroid = {
    distanceM: 20_000,
    speedMps: 40 / 3.6,
    hour: 12,
    efficiencyWhPerM: 0.18,
    tempC: 15,
  };

  it('applies the documented SI heuristic decision order', () => {
    expect(labelForCentroid({ ...base, distanceM: 300_000 })).toBe('roadTrip');
    expect(labelForCentroid({
      ...base,
      distanceM: 60_000,
      speedMps: 95 / 3.6,
    })).toBe('highwayRun');
    expect(labelForCentroid({ ...base, distanceM: 3_000 })).toBe('shortHop');
    expect(labelForCentroid({ ...base, tempC: -5 })).toBe('coldWeather');
    expect(labelForCentroid({ ...base, hour: 8 })).toBe('morningCommute');
    expect(labelForCentroid({ ...base, hour: 18 })).toBe('eveningCommute');
    expect(labelForCentroid(base)).toBe('everyday');
  });
});

describe('summarizeArchetypes', () => {
  it('publishes eligibility evidence but no clusters below the drive floor', () => {
    const summary = summarizeArchetypes(bimodalFleet(3));

    expect(summary.status).toBe('insufficient_drives');
    expect(summary.k).toBe(0);
    expect(summary.clusters).toEqual([]);
    expect(summary.analyzedDrives).toBe(6);
    expect(summary.activeFeatureDimensions).toBeGreaterThan(0);
  });

  it('withholds clustering when every feature dimension is constant', () => {
    const drives = Array.from({ length: 20 }, () =>
      drive({ km: 10, speedKph: 30, hour: 8, whPerKm: 180, tempC: 15 }),
    );
    const summary = summarizeArchetypes(drives);

    expect(summary.status).toBe('insufficient_variation');
    expect(summary.activeFeatureDimensions).toBe(0);
    expect(summary.candidates).toEqual([]);
  });

  it('recovers separated habits and exposes candidate selection evidence', () => {
    const summary = summarizeArchetypes(bimodalFleet(30));
    const selected = summary.candidates.filter((candidate) => candidate.selected);

    expect(summary.status).toBe('clustered');
    expect(summary.analyzedDrives).toBe(60);
    expect(summary.silhouette).toBeGreaterThan(0.4);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.silhouette).toBe(
      Math.max(...summary.candidates.map((candidate) => candidate.silhouette)),
    );
    expect(summary.candidates.some(
      (candidate) =>
        candidate.silhouette
        !== Math.round(candidate.silhouette * 1000) / 1000,
    )).toBe(true);
    expect(summary.candidates.map((candidate) => candidate.k)).toEqual([2, 3, 4, 5]);
    expect(summary.candidates.every(
      (candidate) =>
        candidate.restartAgreement >= -1
        && candidate.restartAgreement <= 1,
    )).toBe(true);
  });

  it('never selects a candidate with unrealized centroids', () => {
    const drives = Array.from({ length: 20 }, (_, index) =>
      drive({
        km: index < 10 ? 10 : 100,
        speedKph: index < 10 ? 30 : 90,
        hour: index < 10 ? 8 : 14,
        whPerKm: index < 10 ? 190 : 150,
        tempC: index < 10 ? 10 : 20,
      }),
    );
    const summary = summarizeArchetypes(drives);
    const selected = summary.candidates.find((candidate) => candidate.selected);

    expect(summary.status).toBe('clustered');
    expect(selected).toMatchObject({ k: 2, realizedK: 2 });
    expect(summary.candidates
      .filter((candidate) => candidate.realizedK !== candidate.k)
      .every((candidate) => !candidate.selected)).toBe(true);
  });

  it('reports each distance centroid in the fitted log-distance feature space', () => {
    const summary = summarizeArchetypes(bimodalFleet(25));

    for (const cluster of summary.clusters) {
      const memberDistances = summary.assignments
        .filter((assignment) => assignment.clusterIndex === cluster.index)
        .map((assignment) => assignment.distanceM);
      const fittedDistance = Math.expm1(
        memberDistances.reduce(
          (sum, distanceM) => sum + Math.log1p(distanceM),
          0,
        ) / memberDistances.length,
      );
      expect(cluster.centroid.distanceM).toBeCloseTo(fittedDistance, 0);
    }
  });

  it('partitions every eligible drive once with bounded assignment margins', () => {
    const summary = summarizeArchetypes(bimodalFleet(25));
    const ids = summary.clusters.flatMap((cluster) => cluster.driveIds);

    expect(ids).toHaveLength(summary.analyzedDrives);
    expect(new Set(ids).size).toBe(summary.analyzedDrives);
    expect(summary.assignments).toHaveLength(summary.analyzedDrives);
    expect(summary.assignments.every(
      (assignment) =>
        assignment.assignmentMargin >= 0
        && assignment.assignmentMargin <= 1,
    )).toBe(true);
    expect(Object.values(summary.identities).every(Boolean)).toBe(true);
    expect(summary.assignments.some(
      (assignment) =>
        assignment.assignmentMargin
        !== Math.round(assignment.assignmentMargin * 1000) / 1000,
    )).toBe(true);
    expect(summary.clusters.reduce(
      (total, cluster) => total + cluster.ambiguousAssignments,
      0,
    )).toBe(summary.assignments.filter(
      (assignment) => assignment.assignmentMargin < 0.1,
    ).length);
  });

  it('is stable across repeated runs and sorts clusters by size', () => {
    const drives = [
      ...bimodalFleet(20),
      ...Array.from({ length: 30 }, (_, index) =>
        drive({
          km: 4,
          speedKph: 22,
          hour: 19,
          whPerKm: 230,
          day: 1 + (index % 20),
        }),
      ),
    ];
    const first = summarizeArchetypes(drives);
    const second = summarizeArchetypes(drives);
    const sizes = first.clusters.map((cluster) => cluster.size);

    expect(second.clusters).toEqual(first.clusters);
    expect(sizes).toEqual([...sizes].sort((left, right) => right - left));
  });

  it('caps a deterministic newest-first assignment directory', () => {
    const summary = summarizeArchetypes(bimodalFleet(20), {
      directoryLimit: 2,
    });

    expect(summary.directory).toMatchObject({
      total: 40,
      displayed: 2,
      omitted: 38,
      cap: 2,
    });
    expect(summary.directory.items[0]!.departureMs)
      .toBeGreaterThanOrEqual(summary.directory.items[1]!.departureMs);
  });

  it('publishes exact hourly and monthly assignment support', () => {
    const summary = summarizeArchetypes(bimodalFleet(20));

    expect(summary.hourlyProfile.reduce(
      (sum, bucket) => sum + bucket.total,
      0,
    )).toBe(summary.analyzedDrives);
    expect(summary.monthlyProfile.reduce(
      (sum, bucket) => sum + bucket.total,
      0,
    )).toBe(summary.analyzedDrives);
  });

  it('flags a potentially capped history without claiming lifetime coverage', () => {
    const drives = bimodalFleet(10);
    const summary = summarizeArchetypes(drives, { historyLimit: drives.length });

    expect(summary.coverage.historyCapReached).toBe(true);
    expect(summary.coverage.historyLimit).toBe(drives.length);
  });

  it('validates options and bounds directory output', () => {
    const options: ArchetypeOptions = {
      minK: 1,
      maxK: 1,
      minDrives: 1,
      minDistanceM: 0,
      silhouetteSample: 1,
      defaultTempC: Number.NaN,
      seed: 4.9,
      historyLimit: 5_000,
      directoryLimit: MAX_ARCHETYPE_DIRECTORY_LIMIT + 50,
      timeZone: 'not/a-timezone',
    };
    const summary = summarizeArchetypes([], options);

    expect(summary.thresholds).toEqual({
      minK: 2,
      maxK: 2,
      minDrives: 8,
      minDistanceM: 500,
      silhouetteSample: 10,
      defaultTempC: 15,
      seed: 4,
      historyLimit: 1000,
      directoryLimit: MAX_ARCHETYPE_DIRECTORY_LIMIT,
      timeZone: 'UTC',
    });
  });

  it('keeps all identities balanced for hostile empty evidence', () => {
    const summary = summarizeArchetypes(
      [null, 'drive', { id: 0 }] as unknown as Drive[],
    );

    expect(summary.source.returnedRows).toBe(3);
    expect(summary.source.invalidRowRows).toBe(2);
    expect(summary.source.invalidIdRows).toBe(1);
    expect(Object.values(summary.identities).every(Boolean)).toBe(true);
  });
});
