import { describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';

import {
  COLD_GAP_HOURS,
  MIN_GROUP_DRIVES,
  WARM_GAP_HOURS,
  bucketParkingGap,
  classifyParkingGap,
  summarizeColdStarts,
} from './coldStart';

let nextId = 1;
const HOUR_MS = 3_600_000;

interface DriveSpec {
  gapH: number;
  whPerKm: number;
  distanceM?: number;
  tempC?: number | null;
}

/** Each drive starts `gapH` hours after the previous drive ended. */
function chain(specs: DriveSpec[], startMs = Date.UTC(2026, 0, 5, 8)): Drive[] {
  const drives: Drive[] = [];
  let cursor = startMs;
  for (const spec of specs) {
    cursor += spec.gapH * HOUR_MS;
    const distanceM = spec.distanceM ?? 10_000;
    const start = new Date(cursor);
    const end = new Date(cursor + HOUR_MS);
    drives.push({
      id: nextId++,
      vehicleId: 1,
      startTs: start.toISOString(),
      endTs: end.toISOString(),
      durationS: 3_600,
      distanceM,
      startAddress: null,
      endAddress: null,
      startLat: null,
      startLon: null,
      endLat: null,
      endLon: null,
      startBatteryPct: 80,
      endBatteryPct: 70,
      energyUsedWh: spec.whPerKm * (distanceM / 1_000),
      regenEnergyWh: null,
      avgSpeedMps: 15,
      maxSpeedMps: 30,
      avgPowerW: null,
      outsideTempAvgC: spec.tempC === undefined ? 5 : spec.tempC,
      insideTempAvgC: null,
      score: null,
      endedStatus: null,
      createdAt: '',
      updatedAt: '',
    });
    cursor = end.getTime();
  }
  return drives;
}

describe('cold-start classification', () => {
  it('keeps the inclusive warm and cold thresholds and excludes the middle band', () => {
    expect(classifyParkingGap(WARM_GAP_HOURS * 3_600)).toBe('warm');
    expect(classifyParkingGap(WARM_GAP_HOURS * 3_600 + 1)).toBe('ambiguous');
    expect(classifyParkingGap(COLD_GAP_HOURS * 3_600 - 1)).toBe('ambiguous');
    expect(classifyParkingGap(COLD_GAP_HOURS * 3_600)).toBe('cold');
    expect(classifyParkingGap(Number.NaN)).toBeNull();
    expect(classifyParkingGap(-1)).toBeNull();
  });

  it('uses deterministic cold parking buckets at 12 and 24 hours', () => {
    expect(bucketParkingGap(30 * 60)).toBe('warm');
    expect(bucketParkingGap(3 * 3_600)).toBe('ambiguous');
    expect(bucketParkingGap(6 * 3_600)).toBe('cold6To12');
    expect(bucketParkingGap(12 * 3_600)).toBe('cold12To24');
    expect(bucketParkingGap(24 * 3_600)).toBe('cold24Plus');
  });
});

describe('summarizeColdStarts', () => {
  it('splits observations by preceding gap while preserving ambiguous coverage', () => {
    const summary = summarizeColdStarts(chain([
      { gapH: 0, whPerKm: 150 },
      { gapH: 12, whPerKm: 190 },
      { gapH: 0.5, whPerKm: 150 },
      { gapH: 3, whPerKm: 170 },
    ]));

    expect(summary.observations.map((row) => row.classification)).toEqual([
      'cold',
      'warm',
      'ambiguous',
    ]);
    expect(summary.cold.drives).toBe(1);
    expect(summary.warm.drives).toBe(1);
    expect(summary.ambiguous).toBe(1);
    expect(summary.analyzed).toBe(3);
    expect(summary.unclassified).toBe(1);
  });

  it('quantifies the weighted aggregate penalty with enough samples on both sides', () => {
    const summary = summarizeColdStarts(chain([
      { gapH: 0, whPerKm: 150 },
      ...Array.from({ length: MIN_GROUP_DRIVES }, () => ({ gapH: 12, whPerKm: 190 })),
      ...Array.from({ length: MIN_GROUP_DRIVES }, () => ({ gapH: 0.5, whPerKm: 150 })),
    ]));

    expect(summary.cold.whPerKm).toBe(190);
    expect(summary.warm.whPerKm).toBe(150);
    expect(summary.sampleSufficient).toBe(true);
    expect(summary.penaltyWhPerKm).toBe(40);
    expect(summary.penaltyShare).toBeCloseTo(40 / 150);
    expect(summary.totalPenaltyWh).toBe(2_000);
    expect(summary.coldShare).toBeCloseTo(0.5);
  });

  it('withholds aggregate and opportunity claims when either group is thin', () => {
    const summary = summarizeColdStarts(chain([
      { gapH: 0, whPerKm: 150 },
      { gapH: 12, whPerKm: 190 },
      { gapH: 0.5, whPerKm: 150 },
    ]));

    expect(summary.sampleSufficient).toBe(false);
    expect(summary.penaltyWhPerKm).toBeNull();
    expect(summary.totalPenaltyWh).toBeNull();
    expect(summary.opportunities).toEqual([]);
  });

  it('rolls up monthly consumption by distance rather than averaging drives', () => {
    const summary = summarizeColdStarts(chain(
      [
        { gapH: 0, whPerKm: 150 },
        { gapH: 12, whPerKm: 200, distanceM: 10_000 },
        { gapH: 12, whPerKm: 100, distanceM: 30_000 },
        { gapH: 0.5, whPerKm: 150, distanceM: 20_000 },
        { gapH: 0.5, whPerKm: 170, distanceM: 20_000 },
        { gapH: 31 * 24, whPerKm: 180, distanceM: 10_000 },
        { gapH: 0.5, whPerKm: 140, distanceM: 10_000 },
      ],
      Date.UTC(2026, 0, 1, 8),
    ));

    expect(summary.monthly.map((row) => row.month)).toEqual(['2026-01', '2026-02']);
    expect(summary.monthly[0]?.cold).toMatchObject({ drives: 2, whPerKm: 125 });
    expect(summary.monthly[0]?.warm).toMatchObject({ drives: 2, whPerKm: 160 });
    expect(summary.monthly[1]?.cold.drives).toBe(1);
    expect(summary.monthly[1]?.warm.drives).toBe(1);
  });

  it('builds a complete parking-gap distribution including zero-count buckets', () => {
    const summary = summarizeColdStarts(chain([
      { gapH: 0, whPerKm: 150 },
      { gapH: 0.5, whPerKm: 150 },
      { gapH: 1, whPerKm: 150 },
      { gapH: 3, whPerKm: 160 },
      { gapH: 6, whPerKm: 180 },
      { gapH: 11.5, whPerKm: 180 },
      { gapH: 12, whPerKm: 185 },
      { gapH: 23.5, whPerKm: 185 },
      { gapH: 24, whPerKm: 190 },
    ]));

    expect(summary.gapBuckets.map((bucket) => [bucket.key, bucket.drives])).toEqual([
      ['warm', 2],
      ['ambiguous', 1],
      ['cold6To12', 2],
      ['cold12To24', 2],
      ['cold24Plus', 1],
    ]);
    expect(summary.gapBuckets.reduce((sum, bucket) => sum + bucket.share, 0)).toBeCloseTo(1);
  });

  it('exposes finite temperature evidence only for classified cold and warm drives', () => {
    const summary = summarizeColdStarts(chain([
      { gapH: 0, whPerKm: 150, tempC: 5 },
      { gapH: 12, whPerKm: 200, tempC: -8 },
      { gapH: 0.5, whPerKm: 150, tempC: 18 },
      { gapH: 3, whPerKm: 170, tempC: 7 },
      { gapH: 12, whPerKm: 195, tempC: null },
      { gapH: 0.5, whPerKm: 155, tempC: Number.POSITIVE_INFINITY },
    ]));

    expect(summary.temperature).toHaveLength(2);
    expect(summary.temperature.map((row) => [row.classification, row.outsideTempAvgC])).toEqual([
      ['cold', -8],
      ['warm', 18],
    ]);
  });

  it('ranks positive cold-start opportunities against a valid warm baseline', () => {
    const summary = summarizeColdStarts(chain([
      { gapH: 0, whPerKm: 150 },
      { gapH: 12, whPerKm: 250, distanceM: 20_000, tempC: -10 },
      ...Array.from({ length: 4 }, () => ({ gapH: 12, whPerKm: 190 })),
      ...Array.from({ length: 5 }, () => ({ gapH: 0.5, whPerKm: 150 })),
    ]));

    expect(summary.sampleSufficient).toBe(true);
    expect(summary.opportunities).toHaveLength(5);
    expect(summary.opportunities[0]).toMatchObject({
      distanceM: 20_000,
      outsideTempAvgC: -10,
      estimatedAvoidableWh: 2_000,
    });
    expect(summary.opportunities.every((row) => row.estimatedAvoidableWh > 0)).toBe(true);
  });

  it('does not call energy avoidable when the sufficient aggregate has no positive penalty', () => {
    const summary = summarizeColdStarts(chain([
      { gapH: 0, whPerKm: 150 },
      ...Array.from({ length: 5 }, () => ({ gapH: 12, whPerKm: 140 })),
      ...Array.from({ length: 5 }, () => ({ gapH: 0.5, whPerKm: 150 })),
    ]));

    expect(summary.sampleSufficient).toBe(true);
    expect(summary.penaltyWhPerKm).toBe(-10);
    expect(summary.totalPenaltyWh).toBe(0);
    expect(summary.opportunities).toEqual([]);
  });

  it('skips malformed and unusable rows without leaking non-finite evidence', () => {
    const drives = chain([
      { gapH: 0, whPerKm: 150 },
      { gapH: 12, whPerKm: 190 },
      { gapH: 0.5, whPerKm: 150 },
    ]);
    drives[0] = { ...drives[0]!, startTs: 'not-a-date' };
    drives[1] = { ...drives[1]!, energyUsedWh: Number.NaN, endTs: 'bad-end' };
    drives[2] = { ...drives[2]!, outsideTempAvgC: Number.NaN };

    expect(() => summarizeColdStarts(drives)).not.toThrow();
    const summary = summarizeColdStarts(drives);
    expect(summary.analyzed).toBe(0);
    expect(summary.temperature).toEqual([]);
    expect(summary.penaltyWhPerKm).toBeNull();
  });

  it('handles empty input with complete null-safe evidence collections', () => {
    const summary = summarizeColdStarts([]);
    expect(summary.analyzed).toBe(0);
    expect(summary.eligible).toBe(0);
    expect(summary.penaltyWhPerKm).toBeNull();
    expect(summary.coldShare).toBeNull();
    expect(summary.monthly).toEqual([]);
    expect(summary.temperature).toEqual([]);
    expect(summary.opportunities).toEqual([]);
    expect(summary.gapBuckets).toHaveLength(5);
  });
});
