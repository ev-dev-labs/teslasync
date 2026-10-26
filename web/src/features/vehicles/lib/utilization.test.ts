import { describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';

import {
  summarizeUtilization,
  type UtilizationOptions,
} from './utilization';

let nextId = 1;

function drive(startTs: string, overrides: Partial<Drive> = {}): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs,
    endTs: null,
    durationS: 3_600,
    distanceM: 50_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 10_000,
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
    ...overrides,
  };
}

function options(overrides: Partial<UtilizationOptions> = {}): UtilizationOptions {
  return {
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    asOfMs: Date.parse('2026-08-10T00:00:00.000Z'),
    historyLimit: 1000,
    timezone: 'UTC',
    ...overrides,
  };
}

describe('summarizeUtilization', () => {
  it.each([
    ['UTC', '2026-08-01', 6, 1],
    ['America/Los_Angeles', '2026-07-31', 5, 2],
    ['Asia/Tokyo', '2026-08-01', 6, 2],
  ] as const)('attributes complete source evidence to the selected calendar in %s', (timezone, day, weekday, calendarDays) => {
    const rows = [drive('2026-08-01T00:30:00Z')];
    const original = JSON.stringify(rows);
    const summary = summarizeUtilization(rows, 0.1, options({
      rangeStart: '2026-07-31', rangeEnd: '2026-08-01', timezone,
      startInstant: '2026-07-31T00:00:00Z', endInstantExclusive: '2026-08-02T00:00:00Z',
    }));
    expect(summary.days.find(row => row.driveCount > 0)).toMatchObject({ day, distanceM: 50_000, energyWh: 10_000 });
    expect(summary.months.find(row => row.driveCount > 0)?.month).toBe(day.slice(0, 7));
    expect(summary.weekdays[Number(weekday)]).toMatchObject({ driveCount: 1, activeDays: 1, distanceM: 50_000 });
    expect(summary.observedCalendarDays).toBe(calendarDays);
    expect(summary.distancePerDayM).toBe(50_000 / Number(calendarDays));
    expect(summary).toMatchObject({ drives: 1, drivingHours: 1, distanceM: 50_000, energyWh: 10_000, totalEnergyCost: 1 });
    expect(summary.window.observedEndMs).toBe(Date.parse('2026-08-02T00:00:00Z'));
    expect(JSON.stringify(rows)).toBe(original);
  });

  it('splits elapsed driving time at selected midnight while retaining full-drive evidence on its start day', () => {
    const summary = summarizeUtilization([drive('2026-08-01T06:30:00Z', { durationS: 7200 })], 0.1, options({
      rangeStart: '2026-07-31', rangeEnd: '2026-08-01', timezone: 'America/Los_Angeles',
    }));
    expect(summary.days.map(day => [day.day, day.drivingS, day.driveCount, day.distanceM, day.energyWh])).toEqual([
      ['2026-07-31', 1800, 1, 50_000, 10_000],
      ['2026-08-01', 5400, 0, 0, 0],
    ]);
    expect(summary.months.map(month => [month.month, month.drivingS])).toEqual([['2026-07', 1800], ['2026-08', 5400]]);
    expect(summary.accounting.truncatedDurationRows).toBe(0);
    expect(summary.drivingHours).toBe(2);
  });

  it.each([
    ['2026-03-08', '2026-03-08T08:00:00Z', 23],
    ['2026-11-01', '2026-11-01T07:00:00Z', 25],
  ] as const)('measures actual elapsed hours for selected-calendar day %s', (day, start, hours) => {
    const summary = summarizeUtilization([drive(String(start))], null, options({
      rangeStart: String(day), rangeEnd: String(day), timezone: 'America/Los_Angeles',
      asOfMs: Date.parse('2026-12-01T00:00:00Z'),
    }));
    expect(summary.days).toHaveLength(1);
    expect(summary.days[0]).toMatchObject({ day, observedS: Number(hours) * 3600, driveCount: 1 });
    expect(summary.window.observedDurationS).toBe(Number(hours) * 3600);
    expect(summary.activeDayShare).toBe(1);
    expect(summary.distancePerDayM).toBe(50_000);
  });

  it.each([
    ['2026-03-02', '2026-03-08', '2026-03-02T08:00:00Z', 167],
    ['2026-10-26', '2026-11-01', '2026-10-26T07:00:00Z', 169],
  ] as const)('recognizes a complete selected-calendar week across DST starting %s', (start, end, instant, hours) => {
    const summary = summarizeUtilization([drive(String(instant), { durationS: 0 })], null, options({
      rangeStart: String(start), rangeEnd: String(end), timezone: 'America/Los_Angeles',
      asOfMs: Date.parse('2026-12-01T00:00:00Z'),
    }));
    expect(summary.days).toHaveLength(7);
    expect(summary.consistency.weeks).toHaveLength(1);
    expect(summary.consistency.weeks[0]).toMatchObject({ weekStart: start, observedCalendarDays: 7, isPartial: false });
    expect(summary.window.observedDurationS).toBe(Number(hours) * 3600);
    expect(summary.consistency.weeks[0].observedDays).toBeCloseTo(Number(hours) / 24);
  });

  it('does not invent an observed day when a zone skips an entire civil date', () => {
    const summary = summarizeUtilization([drive('2011-12-29T10:00:00Z')], null, options({
      rangeStart: '2011-12-29', rangeEnd: '2011-12-31', timezone: 'Pacific/Apia',
      asOfMs: Date.parse('2012-01-05T00:00:00Z'),
    }));
    expect(summary.days.map(day => day.day)).toEqual(['2011-12-29', '2011-12-31']);
    expect(summary.window.observedDurationS).toBe(48 * 3600);
  });

  it('preserves exact rolling bounds instead of widening them to calendar midnights', () => {
    const summary = summarizeUtilization([
      drive('2026-07-10T11:59:59.999Z'),
      drive('2026-07-10T12:00:00Z'),
      drive('2026-07-11T12:00:00Z'),
    ], null, options({
      rangeStart: '2026-07-10', rangeEnd: '2026-07-11', timezone: 'America/Los_Angeles',
      startInstant: '2026-07-10T12:00:00Z', endInstantExclusive: '2026-07-11T12:00:00Z',
    }));
    expect(summary.window.observedDurationS).toBe(24 * 3600);
    expect(summary.window.selectedStartMs).toBe(Date.parse('2026-07-10T12:00:00Z'));
    expect(summary.window.selectedEndExclusiveMs).toBe(Date.parse('2026-07-11T12:00:00Z'));
    expect(summary.accounting).toMatchObject({ eligibleRows: 1, beforeRangeRows: 1, afterRangeRows: 1 });
    expect(summary.days.map(day => day.observedS)).toEqual([19 * 3600, 5 * 3600]);
  });

  it.each([
    { startInstant: '2026-07-10T12:00:00Z' },
    { endInstantExclusive: '2026-07-11T12:00:00Z' },
    { startInstant: 'invalid', endInstantExclusive: '2026-07-11T12:00:00Z' },
    { startInstant: '2026-07-11T12:00:00Z', endInstantExclusive: '2026-07-10T12:00:00Z' },
  ])('does not silently replace malformed absolute bounds with a broader calendar window: %j', (bounds) => {
    const summary = summarizeUtilization([drive('2026-07-10T12:00:00Z')], null, options(bounds));
    expect(summary.window.rangeValid).toBe(false);
    expect(summary.accounting).toMatchObject({ eligibleRows: 0, invalidRangeRows: 1 });
  });

  it('carries missing and partial field coverage into each rollup without erasing inactive zeros or counts', () => {
    const summary = summarizeUtilization([
      drive('2026-07-01T08:00:00Z', { durationS: null, distanceM: null, energyUsedWh: null }),
      drive('2026-07-01T09:00:00Z', { durationS: 1800, distanceM: 12.345, energyUsedWh: 0 }),
    ], 0.1, options({ rangeEnd: '2026-07-02' }));
    const coverage = {
      usableDurationRows: 1, excludedDurationRows: 1, truncatedDurationRows: 0,
      usableDistanceRows: 1, excludedDistanceRows: 1,
      usableEnergyRows: 1, excludedEnergyRows: 1,
    };
    for (const row of [summary.days[0], summary.months[0], summary.consistency.weeks[0], summary.weekdays[3]]) {
      expect(row).toMatchObject({ driveCount: 2, distanceM: 12.345, coverage });
    }
    expect(summary.days[1]).toMatchObject({ driveCount: 0, drivingS: 0, distanceM: 0, energyWh: 0 });
    expect(summary.days[1].coverage?.excludedDistanceRows).toBe(0);
    expect(summary.totalEnergyCost).toBe(0);
    expect(summary.weekdays[3].averageDistancePerActiveDayM).toBe(12.345);
  });

  it('keeps unavailable derived operands null while retaining observed inactive zeros', () => {
    const summary = summarizeUtilization([
      drive('2026-07-01T08:00:00Z', { durationS: null, distanceM: null, energyUsedWh: null }),
    ], 0.1, options({ rangeEnd: '2026-08-02' }));
    expect(summary.drivingShare).toBeNull();
    expect(summary.distancePerDayM).toBeNull();
    expect(summary.months[0].drivingShare).toBeNull();
    expect(summary.months[1]).toMatchObject({ driveCount: 0, drivingShare: 0, distanceM: 0 });
    expect(summary.weekdays[3].averageDistancePerActiveDayM).toBeNull();
    expect(summary.weekdays[4].activeDayShare).toBe(0);
    expect(summary.drives).toBe(1);
  });

  it('counts finite measured zeros as available and carries clipped-duration coverage', () => {
    const zero = summarizeUtilization([
      drive('2026-07-01T08:00:00Z', { durationS: 0, distanceM: 0, energyUsedWh: 0 }),
    ], 0, options());
    expect(zero.accounting).toMatchObject({ usableDurationRows: 1, usableDistanceRows: 1, usableEnergyRows: 1 });
    expect(zero).toMatchObject({ drivingShare: 0, distancePerDayM: 0, totalEnergyCost: 0, costPerKm: null, costPerDrivingHour: null });
    const clipped = summarizeUtilization([drive('2026-07-31T23:30:00Z')], 0.1, options());
    expect(clipped.days[0].coverage).toMatchObject({
      usableDurationRows: 1, truncatedDurationRows: 1, excludedDistanceRows: 1, excludedEnergyRows: 1,
    });
    expect(clipped.months[0].coverage).toEqual(clipped.days[0].coverage);
  });

  it('distinguishes unobserved weekdays from observed inactive days and preserves fractional averages', () => {
    const summary = summarizeUtilization(
      [drive('2026-07-01T08:00:00.000Z', { distanceM: 12.345 })],
      null,
      options({ rangeEnd: '2026-07-02' }),
    );
    expect(summary.weekdays[0]).toMatchObject({
      observedDays: 0, activeDayShare: null, averageDistancePerActiveDayM: null,
    });
    expect(summary.weekdays[4]).toMatchObject({
      observedDays: 1, activeDays: 0, activeDayShare: 0, averageDistancePerActiveDayM: null,
    });
    expect(summary.weekdays[3]).toMatchObject({
      observedDays: 1, activeDays: 1, activeDayShare: 1, averageDistancePerActiveDayM: 12.345,
    });
  });

  it('measures utilization from the first eligible drive to the frozen boundary', () => {
    const summary = summarizeUtilization(
      [
        drive('2026-07-10T08:00:00.000Z'),
        drive('2026-07-15T08:00:00.000Z'),
      ],
      null,
      options({ asOfMs: Date.parse('2026-07-20T08:00:00.000Z') }),
    );

    expect(summary.observedDays).toBe(10);
    expect(summary.observedCalendarDays).toBe(11);
    expect(summary.drivingHours).toBe(2);
    expect(summary.drivingShare).toBeCloseTo(2 / 240);
    expect(summary.activeDayShare).toBeCloseTo(2 / 11);
    expect(summary.distancePerDayM).toBeCloseTo(100_000 / 11);
    expect(summary.window.observedStartMs).toBe(
      Date.parse('2026-07-10T08:00:00.000Z'),
    );
    expect(summary.window.observedEndMs).toBe(
      Date.parse('2026-07-20T08:00:00.000Z'),
    );
  });

  it('uses the selected end as an exclusive next-midnight boundary', () => {
    const summary = summarizeUtilization(
      [
        drive('2026-07-31T23:30:00.000Z', { durationS: 7_200 }),
        drive('2026-08-01T00:00:00.000Z'),
      ],
      0.1,
      options({ rangeStart: '2026-07-31', rangeEnd: '2026-07-31' }),
    );

    expect(summary.window.analysisEndMs).toBe(
      Date.parse('2026-08-01T00:00:00.000Z'),
    );
    expect(summary.drivingHours).toBe(0.5);
    expect(summary.accounting.truncatedDurationRows).toBe(1);
    expect(summary.accounting.usableDistanceRows).toBe(0);
    expect(summary.accounting.usableEnergyRows).toBe(0);
    expect(summary.accounting.afterRangeRows).toBe(1);
    expect(summary.durationBands.every((band) => band.driveCount === 0)).toBe(
      true,
    );
    expect(summary.distanceM).toBe(0);
    expect(summary.energyWh).toBe(0);
    expect(summary.totalEnergyCost).toBeNull();
    expect(summary.costPerDrivingHour).toBeNull();
    expect(summary.drives).toBe(1);
  });

  it('accounts deterministically for invalid, future, and out-of-range rows', () => {
    const asOfMs = Date.parse('2026-07-20T00:00:00.000Z');
    const summary = summarizeUtilization(
      [
        drive(''),
        drive('2026-07-20T00:00:00.000Z'),
        drive('2026-06-30T23:59:59.999Z'),
        drive('2026-08-01T00:00:00.000Z'),
        drive('2026-07-10T12:00:00.000Z'),
      ],
      null,
      options({ asOfMs }),
    );

    expect(summary.accounting).toMatchObject({
      returnedRows: 5,
      eligibleRows: 1,
      excludedRows: 4,
      invalidTimestampRows: 1,
      futureTimestampRows: 2,
      beforeRangeRows: 1,
      afterRangeRows: 0,
    });
  });

  it('builds zero-inclusive UTC day, month, week, and weekday rollups', () => {
    const summary = summarizeUtilization(
      [
        drive('2026-07-30T12:00:00.000Z', { distanceM: 10_000 }),
        drive('2026-08-02T12:00:00.000Z', { distanceM: 20_000 }),
      ],
      null,
      options({
        rangeStart: '2026-07-01',
        rangeEnd: '2026-08-03',
        asOfMs: Date.parse('2026-08-04T00:00:00.000Z'),
      }),
    );

    expect(summary.days.map((day) => day.day)).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
    expect(summary.days[1]).toMatchObject({
      day: '2026-07-31',
      active: false,
      driveCount: 0,
    });
    expect(summary.months.map((month) => month.month)).toEqual([
      '2026-07',
      '2026-08',
    ]);
    expect(summary.months[0]).toMatchObject({
      activeDays: 1,
      driveCount: 1,
      distanceM: 10_000,
    });
    expect(summary.months[1]).toMatchObject({
      activeDays: 1,
      driveCount: 1,
      distanceM: 20_000,
    });
    expect(summary.consistency.weeks.length).toBe(2);
    expect(summary.weekdays.reduce((sum, row) => sum + row.observedDays, 0)).toBe(
      5,
    );
  });

  it('places exact duration and SI-distance boundaries into stable bands', () => {
    const starts = [
      '2026-07-01T01:00:00.000Z',
      '2026-07-02T01:00:00.000Z',
      '2026-07-03T01:00:00.000Z',
      '2026-07-04T01:00:00.000Z',
      '2026-07-05T01:00:00.000Z',
    ];
    const durations = [899, 900, 1_800, 3_600, 7_200];
    const distances = [4_999, 5_000, 15_000, 50_000, 100_000];
    const summary = summarizeUtilization(
      starts.map((start, index) =>
        drive(start, {
          durationS: durations[index],
          distanceM: distances[index],
        }),
      ),
      null,
      options(),
    );

    expect(summary.durationBands.map((band) => band.driveCount)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(summary.distanceBands.map((band) => band.driveCount)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(summary.sampleGuards.durationDistribution.sufficient).toBe(true);
    expect(summary.sampleGuards.distanceDistribution.sufficient).toBe(true);
  });

  it('prices only matched energy rows and preserves field-level exclusions', () => {
    const summary = summarizeUtilization(
      [
        drive('2026-07-01T08:00:00.000Z', {
          durationS: 3_600,
          distanceM: 50_000,
          energyUsedWh: 10_000,
        }),
        drive('2026-07-02T08:00:00.000Z', {
          durationS: 3_600,
          distanceM: 50_000,
          energyUsedWh: null,
        }),
        drive('2026-07-03T08:00:00.000Z', {
          durationS: Number.NaN,
          distanceM: -1,
          energyUsedWh: 10_000,
        }),
      ],
      0.1,
      options(),
    );

    expect(summary.totalEnergyCost).toBeCloseTo(2);
    expect(summary.pricedDistanceM).toBe(50_000);
    expect(summary.pricedDrivingS).toBe(3_600);
    expect(summary.costPerKm).toBeCloseTo(0.02);
    expect(summary.costPerDrivingHour).toBeCloseTo(1);
    expect(summary.energyCoverageShare).toBeCloseTo(2 / 3);
    expect(summary.accounting).toMatchObject({
      usableDurationRows: 2,
      excludedDurationRows: 1,
      usableDistanceRows: 2,
      excludedDistanceRows: 1,
      usableEnergyRows: 2,
      excludedEnergyRows: 1,
    });
  });

  it('returns null costs for invalid rates or absent measured energy', () => {
    const invalidRate = summarizeUtilization(
      [drive('2026-07-01T08:00:00.000Z')],
      -1,
      options(),
    );
    const noEnergy = summarizeUtilization(
      [
        drive('2026-07-01T08:00:00.000Z', {
          energyUsedWh: null,
        }),
      ],
      0.1,
      options(),
    );

    expect(invalidRate.ratePerKwh).toBeNull();
    expect(invalidRate.totalEnergyCost).toBeNull();
    expect(noEnergy.totalEnergyCost).toBeNull();
    expect(noEnergy.costPerKm).toBeNull();
  });

  it('ranks busiest days by logged duration with deterministic tie-breaks', () => {
    const summary = summarizeUtilization(
      [
        drive('2026-07-03T08:00:00.000Z', {
          durationS: 7_200,
          distanceM: 20_000,
        }),
        drive('2026-07-01T08:00:00.000Z', {
          durationS: 3_600,
          distanceM: 50_000,
        }),
        drive('2026-07-02T08:00:00.000Z', {
          durationS: 3_600,
          distanceM: 70_000,
        }),
      ],
      null,
      options(),
    );

    expect(summary.busiestDays.map((day) => day.day)).toEqual([
      '2026-07-03',
      '2026-07-02',
      '2026-07-01',
    ]);
    expect(summary.consistency.longestActiveStreakDays).toBe(3);
    expect(summary.sampleGuards.busiestDays.sufficient).toBe(true);
  });

  it('detects the response cap and exposes conservative sample guards', () => {
    const summary = summarizeUtilization(
      [
        drive('2026-07-01T08:00:00.000Z'),
        drive('2026-07-02T08:00:00.000Z'),
      ],
      null,
      options({ historyLimit: 2 }),
    );

    expect(summary.accounting.historyCapReached).toBe(true);
    expect(summary.sampleGuards.weekdayProfile).toEqual({
      sampleSize: 2,
      minimum: 7,
      sufficient: false,
    });
    expect(summary.sampleGuards.monthlyTrend.sufficient).toBe(false);
    expect(summary.sampleGuards.activeDayConsistency.sufficient).toBe(true);
  });

  it('handles empty and invalid calendar windows without fabricating observations', () => {
    const empty = summarizeUtilization([], 0.1, options());
    const invalid = summarizeUtilization(
      [drive('2026-07-01T08:00:00.000Z')],
      0.1,
      options({ rangeStart: '2026-07-32' }),
    );

    expect(empty.observedDays).toBeNull();
    expect(empty.days).toEqual([]);
    expect(empty.busiestDays).toEqual([]);
    expect(invalid.window.rangeValid).toBe(false);
    expect(invalid.accounting.invalidRangeRows).toBe(1);
    expect(invalid.accounting.eligibleRows).toBe(0);
  });
});
