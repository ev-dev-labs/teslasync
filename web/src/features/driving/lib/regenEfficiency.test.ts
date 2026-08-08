import { describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';

import {
  REGEN_MONTH_DISPLAY_LIMIT,
  REGEN_RANKED_DRIVE_LIMIT,
  buildRegenEfficiencyModel,
} from './regenEfficiency';

function makeDrive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicleId: 7,
    startTs: '2025-01-15T12:00:00Z',
    endTs: '2025-01-15T12:30:00Z',
    durationS: 1_800,
    distanceM: 25_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 70,
    endBatteryPct: 60,
    energyUsedWh: 1_000,
    regenEnergyWh: 200,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 4_000,
    outsideTempAvgC: 15,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: '2025-01-15T12:00:00Z',
    updatedAt: '2025-01-15T12:30:00Z',
    ...overrides,
  };
}

describe('buildRegenEfficiencyModel', () => {
  it('uses energy weighting rather than a naive average and exposes quartiles', () => {
    const result = buildRegenEfficiencyModel(
      [
        makeDrive({ id: 1, energyUsedWh: 1_000, regenEnergyWh: 100 }),
        makeDrive({ id: 2, energyUsedWh: 100, regenEnergyWh: 50 }),
      ],
      1_000,
    );

    expect(result.totalMeasuredRegenWh).toBe(150);
    expect(result.totalMeasuredDriveEnergyWh).toBe(1_100);
    expect(result.energyWeightedRatioPct).toBeCloseTo(13.63636, 5);
    expect(result.energyWeightedRatioPct).not.toBe(30);
    expect(result.ratioStatistics).toEqual({
      minPct: 10,
      q1Pct: 20,
      medianPct: 30,
      q3Pct: 40,
      maxPct: 50,
    });
  });

  it('treats measured zero regen as an eligible and valid 0% observation', () => {
    const result = buildRegenEfficiencyModel(
      [makeDrive({ regenEnergyWh: 0, energyUsedWh: 800 })],
      1_000,
    );

    expect(result.accounting.eligibleCount).toBe(1);
    expect(result.totalMeasuredRegenWh).toBe(0);
    expect(result.energyWeightedRatioPct).toBe(0);
    expect(result.ratioStatistics.medianPct).toBe(0);
    expect(result.ratioDistribution[0]).toMatchObject({
      key: 'below5',
      eligibleCount: 1,
      eligibleSharePct: 100,
    });
    expect(result.rankedDrives[0]?.recoveryRatioPct).toBe(0);
  });

  it('accounts independently for missing and invalid fields', () => {
    const result = buildRegenEfficiencyModel(
      [
        makeDrive({
          id: 1,
          regenEnergyWh: null,
          outsideTempAvgC: null,
          startBatteryPct: null,
        }),
        makeDrive({
          id: 2,
          startTs: 'not-a-date',
          regenEnergyWh: -1,
          energyUsedWh: 0,
          outsideTempAvgC: Number.NaN,
          startBatteryPct: 101,
        }),
        makeDrive({
          id: 3,
          startTs: '',
          regenEnergyWh: 0,
          energyUsedWh: null,
          outsideTempAvgC: 10,
          startBatteryPct: 40,
        }),
      ],
      3,
    );

    expect(result.accounting).toMatchObject({
      observedCount: 3,
      eligibleCount: 0,
      excludedCount: 3,
      historyCapReached: true,
      missingFields: {
        regenEnergyWh: 1,
        energyUsedWh: 1,
        startTs: 1,
        outsideTempAvgC: 1,
        startBatteryPct: 1,
      },
      invalidFields: {
        regenEnergyWh: 1,
        energyUsedWh: 1,
        startTs: 1,
        outsideTempAvgC: 1,
        startBatteryPct: 1,
      },
    });
    expect(result.energyWeightedRatioPct).toBeNull();
  });

  it('places exact ratio, temperature, and starting-SoC boundaries correctly', () => {
    const ratioInputs = [
      { ratio: 4.99, temp: -1, soc: 39.9 },
      { ratio: 5, temp: 0, soc: 40 },
      { ratio: 10, temp: 10, soc: 60 },
      { ratio: 15, temp: 20, soc: 80 },
      { ratio: 20, temp: 30, soc: 90 },
      { ratio: 30, temp: 31, soc: 100 },
    ];
    const result = buildRegenEfficiencyModel(
      ratioInputs.map(({ ratio, temp, soc }, index) =>
        makeDrive({
          id: index + 1,
          energyUsedWh: 100,
          regenEnergyWh: ratio,
          outsideTempAvgC: temp,
          startBatteryPct: soc,
        }),
      ),
      1_000,
    );

    expect(result.ratioDistribution.map((bucket) => bucket.eligibleCount)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
    expect(result.temperatureBuckets.map((bucket) => bucket.returnedCount)).toEqual([
      1, 1, 1, 1, 2,
    ]);
    expect(result.startingSocBuckets.map((bucket) => bucket.returnedCount)).toEqual([
      1, 1, 1, 1, 2,
    ]);
  });

  it('sorts all months chronologically and displays only the latest 24', () => {
    const drives = Array.from({ length: 26 }, (_, index) => {
      const year = 2023 + Math.floor(index / 12);
      const month = String((index % 12) + 1).padStart(2, '0');
      return makeDrive({
        id: index + 1,
        startTs: `${year}-${month}-15T12:00:00Z`,
        energyUsedWh: 1_000,
        regenEnergyWh: 100,
      });
    }).reverse();

    const result = buildRegenEfficiencyModel(drives, 1_000);

    expect(result.months).toHaveLength(26);
    expect(result.months[0]?.month).toBe('2023-01');
    expect(result.months.at(-1)?.month).toBe('2025-02');
    expect(result.totalMonthCount).toBe(26);
    expect(result.displayMonths).toHaveLength(REGEN_MONTH_DISPLAY_LIMIT);
    expect(result.displayMonths[0]?.month).toBe('2023-03');
    expect(result.monthsTruncated).toBe(true);
  });

  it('keeps returned and eligible month counts separate and rejects invalid dates', () => {
    const result = buildRegenEfficiencyModel(
      [
        makeDrive({ id: 1, startTs: '2024-02-29T12:00:00Z' }),
        makeDrive({
          id: 2,
          startTs: '2024-02-20T12:00:00Z',
          regenEnergyWh: null,
        }),
        makeDrive({ id: 3, startTs: '2024-02-31T12:00:00Z' }),
      ],
      1_000,
    );

    expect(result.months).toEqual([
      {
        month: '2024-02',
        totalRegenWh: 200,
        totalDriveEnergyWh: 1_000,
        eligibleCount: 1,
        returnedCount: 2,
        energyWeightedRatioPct: 20,
      },
    ]);
    expect(result.accounting.invalidFields.startTs).toBe(1);
  });

  it('uses the configured timezone at a UTC month boundary', () => {
    const result = buildRegenEfficiencyModel(
      [
        makeDrive({
          id: 1,
          startTs: '2025-03-01T01:30:00Z',
        }),
        makeDrive({
          id: 2,
          startTs: '2025-03-01T08:30:00Z',
        }),
      ],
      1_000,
      'America/Los_Angeles',
    );

    expect(result.timeZone).toBe('America/Los_Angeles');
    expect(result.months.map((month) => month.month)).toEqual([
      '2025-02',
      '2025-03',
    ]);
    expect(result.months.map((month) => month.returnedCount)).toEqual([1, 1]);
  });

  it('keeps measurement-less months unavailable but preserves measured zero regen', () => {
    const result = buildRegenEfficiencyModel(
      [
        makeDrive({
          id: 1,
          startTs: '2025-01-10T12:00:00Z',
          regenEnergyWh: null,
          energyUsedWh: 800,
        }),
        makeDrive({
          id: 2,
          startTs: '2025-01-20T12:00:00Z',
          regenEnergyWh: 100,
          energyUsedWh: null,
        }),
        makeDrive({
          id: 3,
          startTs: '2025-02-10T12:00:00Z',
          regenEnergyWh: 0,
          energyUsedWh: 800,
        }),
      ],
      1_000,
      'UTC',
    );

    expect(result.months).toEqual([
      {
        month: '2025-01',
        totalRegenWh: null,
        totalDriveEnergyWh: null,
        eligibleCount: 0,
        returnedCount: 2,
        energyWeightedRatioPct: null,
      },
      {
        month: '2025-02',
        totalRegenWh: 0,
        totalDriveEnergyWh: 800,
        eligibleCount: 1,
        returnedCount: 1,
        energyWeightedRatioPct: 0,
      },
    ]);
  });

  it('ranks by recovered energy, preserves input order for ties, and bounds rows', () => {
    const tied = [
      makeDrive({ id: 20, regenEnergyWh: 500 }),
      makeDrive({ id: 10, regenEnergyWh: 500 }),
      ...Array.from({ length: 10 }, (_, index) =>
        makeDrive({ id: 30 + index, regenEnergyWh: 400 - index }),
      ),
    ];
    const result = buildRegenEfficiencyModel(tied, 1_000);

    expect(result.rankedDriveTotal).toBe(12);
    expect(result.rankedDrives).toHaveLength(REGEN_RANKED_DRIVE_LIMIT);
    expect(result.rankedDrives.slice(0, 2).map((drive) => drive.driveId)).toEqual([
      20, 10,
    ]);
    expect(result.rankedDrives.map((drive) => drive.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('does not mutate the source array or drive objects', () => {
    const drives = [
      makeDrive({ id: 2, regenEnergyWh: 500 }),
      makeDrive({ id: 1, regenEnergyWh: 100 }),
    ];
    const before = JSON.parse(JSON.stringify(drives)) as Drive[];

    buildRegenEfficiencyModel(drives, 1_000);

    expect(drives).toEqual(before);
    expect(drives.map((drive) => drive.id)).toEqual([2, 1]);
  });

  it('rejects a non-positive or non-finite history limit', () => {
    expect(() => buildRegenEfficiencyModel([], 0)).toThrow(RangeError);
    expect(() => buildRegenEfficiencyModel([], Number.NaN)).toThrow(RangeError);
  });
});
