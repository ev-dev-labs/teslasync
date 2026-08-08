import { describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';
import {
  DEFAULT_MAX_DEPARTURE_SAMPLE_AGE_S,
  DEFAULT_MAX_TARGET_SHIFT_C,
  DEFAULT_MIN_INITIAL_DELTA_C,
  DEFAULT_MIN_OBSERVATION_SPAN_S,
  DEFAULT_MIN_THERMAL_SAMPLES,
  DEFAULT_PRECONDITIONING_DIRECTORY_LIMIT,
  DEFAULT_PRE_DRIVE_WINDOW_S,
  MAX_PRECONDITIONING_DIRECTORY_LIMIT,
  summarizePreconditioningEffectiveness,
  type PreconditioningClimateSample,
} from './preconditioningEffectiveness';

const DEPARTURE = Date.UTC(2026, 6, 1, 8);

function climate(
  minutesBefore: number,
  insideTemp: number,
  hvacPower: boolean | null,
  overrides: Partial<PreconditioningClimateSample> = {},
): PreconditioningClimateSample {
  return {
    timestamp: new Date(DEPARTURE - minutesBefore * 60_000).toISOString(),
    insideTemp,
    driverTempSetting: 21,
    passengerTempSetting: 21,
    hvacPower,
    ...overrides,
  };
}

function climateAt(
  departureMs: number,
  minutesBefore: number,
  insideTemp: number,
  hvacPower: boolean | null,
  overrides: Partial<PreconditioningClimateSample> = {},
): PreconditioningClimateSample {
  return {
    ...climate(minutesBefore, insideTemp, hvacPower, overrides),
    timestamp: new Date(departureMs - minutesBefore * 60_000).toISOString(),
  };
}

function drive(id = 1, startMs = DEPARTURE): Drive {
  return {
    id,
    vehicleId: 1,
    startTs: new Date(startMs).toISOString(),
    endTs: null,
    durationS: 600,
    distanceM: 1000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: null,
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
  };
}

describe('summarizePreconditioningEffectiveness source accounting', () => {
  it('assigns every returned climate row to one exact outcome', () => {
    const duplicate = climate(30, 35, true).timestamp;
    const result = summarizePreconditioningEffectiveness([
      climate(30, 35, true),
      null,
      {},
      { timestamp: 'bad', insideTemp: 21, driverTempSetting: 21, hvacPower: true },
      { ...climate(30, 20, false), timestamp: duplicate },
      climate(25, 20, false, { insideTemp: null }),
      climate(20, 20, true, {
        driverTempSetting: null,
        passengerTempSetting: null,
      }),
      climate(15, 20, null),
      climate(10, 20, false),
      climate(5, 20, true),
    ] as unknown as PreconditioningClimateSample[], []);

    expect(result.climateRows).toEqual({
      returnedRows: 10,
      invalidRowRows: 1,
      missingTimestampRows: 1,
      invalidTimestampRows: 1,
      timestampValidRows: 7,
      duplicateTimestampRows: 1,
      uniqueTimestampRows: 6,
      missingInsideTempRows: 1,
      missingSetpointRows: 1,
      completeUnknownHvacRows: 1,
      completeHvacOffRows: 1,
      completeHvacOnRows: 2,
    });
    expect(result.climateSources).toMatchObject({
      denominatorRows: 6,
      insideTempRows: 5,
      anySetpointRows: 5,
      thermallyCompleteRows: 4,
      knownHvacRows: 5,
      hvacOnRows: 3,
      hvacOffRows: 2,
    });
    expect(result.identities.climateRowsBalanced).toBe(true);
    expect(result.identities.climateTimestampsBalanced).toBe(true);
  });

  it('accounts for malformed, missing, duplicate, and valid drives', () => {
    const missingStart = { ...drive(2), startTs: '' };
    const invalidStart = { ...drive(3), startTs: 'bad' };
    const result = summarizePreconditioningEffectiveness([], [
      drive(1),
      null,
      { ...drive(4), id: 0 },
      missingStart,
      invalidStart,
      drive(1, DEPARTURE + 60_000),
    ] as unknown as Drive[]);

    expect(result.driveRows).toEqual({
      returnedRows: 6,
      invalidRowRows: 2,
      missingStartRows: 1,
      invalidStartRows: 1,
      duplicateDriveRows: 1,
      uniqueValidDrives: 1,
    });
    expect(result.departureAccounting.outsideClimateCoverage).toBe(1);
    expect(result.identities.driveRowsBalanced).toBe(true);
    expect(result.identities.departureOutcomesBalanced).toBe(true);
  });

  it('retains the first climate row and drive at duplicate identities', () => {
    const timestamp = climate(30, 35, false).timestamp;
    const result = summarizePreconditioningEffectiveness(
      [
        { ...climate(30, 35, false), timestamp },
        { ...climate(30, 35, true), timestamp },
        climate(5, 24, false),
      ],
      [drive(1), drive(1, DEPARTURE + 60 * 60_000)],
    );

    expect(result.climateRows.duplicateTimestampRows).toBe(1);
    expect(result.driveRows.duplicateDriveRows).toBe(1);
    expect(result.departures[0]?.conditioned).toBe(false);
  });
});

describe('summarizePreconditioningEffectiveness join and classification gates', () => {
  it('joins only the configured pre-drive window', () => {
    const result = summarizePreconditioningEffectiveness(
      [
        climate(50, 40, true),
        climate(45, 35, false),
        climate(10, 30, false),
        climate(-1, 20, true),
      ],
      [drive()],
    );

    expect(result.departures).toHaveLength(1);
    expect(result.departures[0]).toMatchObject({
      conditioned: false,
      sampleCount: 2,
      windowRowCount: 2,
      initialDeltaC: 14,
      startDeltaC: 9,
      improvementC: 5,
    });
  });

  it('uses observed HVAC activity even when the active row lacks thermal fields', () => {
    const result = summarizePreconditioningEffectiveness(
      [
        climate(30, 35, false),
        climate(20, 30, true, { insideTemp: null }),
        climate(5, 24, false),
      ],
      [drive()],
    );

    expect(result.departures[0]).toMatchObject({
      conditioned: true,
      sampleCount: 2,
      windowRowCount: 3,
      hvacOnSamples: 1,
    });
  });

  it('does not let an incomplete unknown row disappear from the control gate', () => {
    const result = summarizePreconditioningEffectiveness(
      [
        climate(30, 35, false),
        climate(20, 30, null, { insideTemp: null }),
        climate(5, 24, false),
      ],
      [drive()],
    );

    expect(result.joinedDepartures).toBe(0);
    expect(result.departureAccounting.ambiguousHvac).toBe(1);
    expect(result.directory.items[0]).toMatchObject({
      disposition: 'ambiguous_hvac',
      unknownHvacSamples: 1,
    });
  });

  it('withholds stale departure-readiness evidence', () => {
    const result = summarizePreconditioningEffectiveness(
      [climate(40, 35, true), climate(20, 25, true)],
      [drive()],
    );

    expect(result.joinedDepartures).toBe(0);
    expect(result.departureAccounting.staleDepartureSample).toBe(1);
    expect(result.directory.items[0]?.lastSampleLeadS).toBe(20 * 60);
  });

  it('does not count repeated forward-folded cabin state as fresh thermal evidence', () => {
    const result = summarizePreconditioningEffectiveness(
      [
        climate(30, 35, false),
        climate(20, 35, true),
        climate(5, 35, true),
      ],
      [drive()],
    );

    expect(result.joinedDepartures).toBe(0);
    expect(result.departureAccounting.insufficientThermalSamples).toBe(1);
    expect(result.directory.items[0]).toMatchObject({
      thermalSampleCount: 1,
      hvacOnSamples: 2,
      hvacOffSamples: 1,
      unknownHvacSamples: 0,
    });
  });

  it('separates insufficient samples from insufficient observation span', () => {
    const insufficientSamples = summarizePreconditioningEffectiveness(
      [
        climate(10, 35, true),
        climate(5, 30, true, { insideTemp: null }),
      ],
      [drive()],
    );
    const insufficientSpan = summarizePreconditioningEffectiveness(
      [climate(10, 35, true), climate(8, 30, true)],
      [drive()],
    );

    expect(
      insufficientSamples.departureAccounting.insufficientThermalSamples,
    ).toBe(1);
    expect(
      insufficientSpan.departureAccounting.insufficientObservationSpan,
    ).toBe(1);
  });

  it('withholds material target shifts and initially in-band departures', () => {
    const shifted = summarizePreconditioningEffectiveness(
      [
        climate(30, 35, true, {
          driverTempSetting: 21,
          passengerTempSetting: 21,
        }),
        climate(5, 24, true, {
          driverTempSetting: 24,
          passengerTempSetting: 24,
        }),
      ],
      [drive()],
    );
    const comfortable = summarizePreconditioningEffectiveness(
      [climate(30, 21.5, false), climate(5, 21, false)],
      [drive()],
    );

    expect(shifted.departureAccounting.targetShiftExclusions).toBe(1);
    expect(comfortable.departureAccounting.initialInBand).toBe(1);
  });

  it('distinguishes no temporal overlap from an empty window inside coverage', () => {
    const outside = summarizePreconditioningEffectiveness(
      [climate(30, 35, true), climate(5, 24, true)],
      [drive(1, DEPARTURE + 3 * 24 * 60 * 60_000)],
    );
    const insideCoverageNoRows = summarizePreconditioningEffectiveness(
      [
        climateAt(DEPARTURE, 60, 35, true),
        climateAt(DEPARTURE, -60, 24, true),
      ],
      [drive()],
    );

    expect(outside.departureAccounting.outsideClimateCoverage).toBe(1);
    expect(insideCoverageNoRows.departureAccounting.noWindowRows).toBe(1);
  });
});

describe('summarizePreconditioningEffectiveness comparisons and profiles', () => {
  it('averages front-row setpoints and computes observed improvement', () => {
    const result = summarizePreconditioningEffectiveness(
      [
        climate(30, 35, false, {
          driverTempSetting: 20,
          passengerTempSetting: 22,
        }),
        climate(10, 24, true, {
          driverTempSetting: 20,
          passengerTempSetting: 22,
        }),
      ],
      [drive()],
    );

    expect(result.departures[0]).toMatchObject({
      conditioned: true,
      regime: 'hot',
      initialDeltaC: 14,
      startDeltaC: 3,
      improvementC: 11,
      hvacOnSamples: 1,
    });
  });

  it('stratifies hot and cold departures and compares group medians', () => {
    const secondDeparture = DEPARTURE + 60 * 60_000;
    const thirdDeparture = DEPARTURE + 2 * 60 * 60_000;
    const samples: PreconditioningClimateSample[] = [
      climateAt(DEPARTURE, 30, 35, false),
      climateAt(DEPARTURE, 5, 24, true),
      climateAt(secondDeparture, 30, 5, false),
      climateAt(secondDeparture, 5, 18, true),
      climateAt(thirdDeparture, 30, 6, false),
      climateAt(thirdDeparture, 5, 7, false),
    ];
    const result = summarizePreconditioningEffectiveness(samples, [
      drive(1),
      drive(2, secondDeparture),
      drive(3, thirdDeparture),
    ]);
    const hot = result.strata.find((row) => row.regime === 'hot')!;
    const cold = result.strata.find((row) => row.regime === 'cold')!;

    expect(hot.conditionedCount).toBe(1);
    expect(cold.conditionedCount).toBe(1);
    expect(cold.unconditionedCount).toBe(1);
    expect(cold.startDeltaAdvantageC).not.toBeNull();
    expect(cold.improvementLiftC).not.toBeNull();
    expect(result.hotDepartures).toBe(1);
    expect(result.coldDepartures).toBe(2);
  });

  it('requires both groups before publishing comparative effects', () => {
    const result = summarizePreconditioningEffectiveness(
      [climate(30, 35, true), climate(5, 25, true)],
      [drive()],
    );

    expect(result.overall.evidence).toBe('none');
    expect(result.overall.startDeltaAdvantageC).toBeNull();
    expect(result.overall.improvementLiftC).toBeNull();
    expect(result.overall.balanceCount).toBe(0);
  });

  it('withholds headline effects when groups exist only in different strata', () => {
    const coldDeparture = DEPARTURE + 60 * 60_000;
    const result = summarizePreconditioningEffectiveness(
      [
        climateAt(DEPARTURE, 30, 35, true),
        climateAt(DEPARTURE, 5, 24, true),
        climateAt(coldDeparture, 30, 5, false),
        climateAt(coldDeparture, 5, 7, false),
      ],
      [drive(1), drive(2, coldDeparture)],
    );

    expect(result.conditionedDepartures).toBe(1);
    expect(result.unconditionedDepartures).toBe(1);
    expect(result.strata.every((comparison) => comparison.evidence === 'none'))
      .toBe(true);
    expect(result.overall).toMatchObject({
      conditionedCount: 0,
      unconditionedCount: 0,
      evidence: 'none',
      startDeltaAdvantageC: null,
      improvementLiftC: null,
    });
  });

  it('reports balanced evidence strength without claiming causality', () => {
    const samples: PreconditioningClimateSample[] = [];
    const drives: Drive[] = [];
    for (let index = 0; index < 12; index += 1) {
      const startMs = DEPARTURE + index * 3_600_000;
      drives.push(drive(index + 1, startMs));
      samples.push(
        climateAt(startMs, 30, 35, index % 2 === 0),
        climateAt(startMs, 5, index % 2 === 0 ? 23 : 34, index % 2 === 0),
      );
    }
    const result = summarizePreconditioningEffectiveness(samples, drives);

    expect(result.overall.conditionedCount).toBe(6);
    expect(result.overall.unconditionedCount).toBe(6);
    expect(result.overall.evidence).not.toBe('none');
    expect(result.overall.confidence).toBeGreaterThan(0);
    expect(result.identities.classifiedGroupsBalanced).toBe(true);
    expect(result.identities.regimesBalanced).toBe(true);
  });

  it('publishes hourly and improvement distributions with exact support', () => {
    const secondDeparture = DEPARTURE + 60 * 60_000;
    const result = summarizePreconditioningEffectiveness(
      [
        climateAt(DEPARTURE, 30, 35, true),
        climateAt(DEPARTURE, 5, 23, true),
        climateAt(secondDeparture, 30, 10, false),
        climateAt(secondDeparture, 5, 19, false),
      ],
      [drive(1), drive(2, secondDeparture)],
    );

    expect(
      result.hourlyProfile.reduce(
        (sum, bucket) => sum + bucket.classifiedDepartures,
        0,
      ),
    ).toBe(result.joinedDepartures);
    expect(
      result.improvementDistribution.reduce(
        (sum, bin) => sum + bin.total,
        0,
      ),
    ).toBe(result.joinedDepartures);
  });
});

describe('summarizePreconditioningEffectiveness support and resilience', () => {
  it('discloses climate-row reuse across overlapping departure windows', () => {
    const secondDeparture = DEPARTURE + 20 * 60_000;
    const result = summarizePreconditioningEffectiveness(
      [
        climateAt(DEPARTURE, 20, 35, true),
        climateAt(DEPARTURE, 5, 25, true),
        climateAt(secondDeparture, 15, 23, true),
        climateAt(secondDeparture, 5, 22, true),
      ],
      [drive(1), drive(2, secondDeparture)],
    );

    expect(result.windowSupport).toMatchObject({
      departuresWithWindowRows: 2,
      departuresWithThermalSupport: 2,
      windowRowReferences: 6,
      climateRowsUsed: 4,
      climateRowsReused: 2,
    });
  });

  it('caps a deterministic newest-first departure directory', () => {
    const samples: PreconditioningClimateSample[] = [];
    const drives: Drive[] = [];
    for (let index = 0; index < 3; index += 1) {
      const departureMs = DEPARTURE + index * 60 * 60_000;
      drives.push(drive(index + 1, departureMs));
      samples.push(
        climateAt(departureMs, 30, 35, true),
        climateAt(departureMs, 5, 25, true),
      );
    }
    const first = summarizePreconditioningEffectiveness(samples, drives, {
      directoryLimit: 2,
    });
    const second = summarizePreconditioningEffectiveness(samples, drives, {
      directoryLimit: 2,
    });

    expect(first.directory).toMatchObject({
      total: 3,
      displayed: 2,
      omitted: 1,
      cap: 2,
    });
    expect(first.directory.items.map((item) => item.driveId)).toEqual([3, 2]);
    expect(second.directory).toEqual(first.directory);
  });

  it('validates every option and bounds the directory cap', () => {
    const invalid = summarizePreconditioningEffectiveness([], [], {
      preDriveWindowS: Number.NaN,
      minInitialDeltaC: 0,
      minThermalSamples: 1,
      minObservationSpanS: -1,
      maxDepartureSampleAgeS: Number.POSITIVE_INFINITY,
      maxTargetShiftC: 0,
      directoryLimit: 0,
    });
    expect(invalid.thresholds).toEqual({
      preDriveWindowS: DEFAULT_PRE_DRIVE_WINDOW_S,
      minInitialDeltaC: DEFAULT_MIN_INITIAL_DELTA_C,
      minThermalSamples: DEFAULT_MIN_THERMAL_SAMPLES,
      minObservationSpanS: DEFAULT_MIN_OBSERVATION_SPAN_S,
      maxDepartureSampleAgeS: DEFAULT_MAX_DEPARTURE_SAMPLE_AGE_S,
      maxTargetShiftC: DEFAULT_MAX_TARGET_SHIFT_C,
      directoryLimit: DEFAULT_PRECONDITIONING_DIRECTORY_LIMIT,
    });

    const bounded = summarizePreconditioningEffectiveness([], [], {
      preDriveWindowS: 600,
      minInitialDeltaC: 2,
      minThermalSamples: 3.9,
      minObservationSpanS: 120,
      maxDepartureSampleAgeS: 300,
      maxTargetShiftC: 1,
      directoryLimit: MAX_PRECONDITIONING_DIRECTORY_LIMIT + 50,
    });
    expect(bounded.thresholds).toEqual({
      preDriveWindowS: 600,
      minInitialDeltaC: 2,
      minThermalSamples: 3,
      minObservationSpanS: 120,
      maxDepartureSampleAgeS: 300,
      maxTargetShiftC: 1,
      directoryLimit: MAX_PRECONDITIONING_DIRECTORY_LIMIT,
    });
  });

  it('does not mutate source arrays or source rows', () => {
    const samples = [climate(5, 24, true), climate(30, 35, false)];
    const drives = [drive()];
    const samplesBefore = structuredClone(samples);
    const drivesBefore = structuredClone(drives);

    summarizePreconditioningEffectiveness(samples, drives);

    expect(samples).toEqual(samplesBefore);
    expect(drives).toEqual(drivesBefore);
  });

  it('survives hostile rows and keeps all identities exact', () => {
    const result = summarizePreconditioningEffectiveness(
      [
        null,
        'row',
        { timestamp: {}, insideTemp: 21, driverTempSetting: 21 },
        climate(5, 24, true),
      ] as unknown as PreconditioningClimateSample[],
      [
        null,
        { id: 'drive', startTs: new Date(DEPARTURE).toISOString() },
        drive(),
      ] as unknown as Drive[],
    );

    expect(result.climateRows).toMatchObject({
      returnedRows: 4,
      invalidRowRows: 2,
      invalidTimestampRows: 1,
      uniqueTimestampRows: 1,
    });
    expect(result.driveRows).toMatchObject({
      returnedRows: 3,
      invalidRowRows: 2,
      uniqueValidDrives: 1,
    });
    expect(Object.values(result.identities).every(Boolean)).toBe(true);
  });

  it('keeps empty evidence explicit and balanced', () => {
    const result = summarizePreconditioningEffectiveness([], []);

    expect(result.departures).toEqual([]);
    expect(result.conditionedShare).toBeNull();
    expect(result.overall.evidence).toBe('none');
    expect(result.hourlyProfile).toHaveLength(24);
    expect(result.improvementDistribution).toHaveLength(5);
    expect(Object.values(result.identities).every(Boolean)).toBe(true);
  });
});
