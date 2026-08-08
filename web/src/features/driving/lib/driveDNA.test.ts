import { describe, expect, it } from 'vitest';

import type { DriveTelemetryPoint } from '@/types/driving';

import {
  DNA_CENTER,
  DRIVE_DNA_MAX_ART_POINTS,
  DRIVE_DNA_MAX_CHART_POINTS,
  POWER_COAST_THRESHOLD_W,
  buildDriveDnaModel,
  generateDriveDNA,
  petalLine,
} from './driveDNA';

function point(
  overrides: Partial<DriveTelemetryPoint> = {},
): DriveTelemetryPoint {
  return {
    timestamp: '2025-01-01T00:00:00.000Z',
    speed: 20,
    // The endpoint's legacy response field is kW.
    power: 10,
    batteryLevel: null,
    outsideTemp: 18,
    insideTemp: 21,
    driverTemp: 21,
    passengerTemp: 21,
    elevation: 100,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc: 70,
    usableSoc: null,
    tirePressureFl: null,
    tirePressureFr: null,
    tirePressureRl: null,
    tirePressureRr: null,
    isClimateOn: true,
    fanStatus: null,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function at(
  seconds: number,
  overrides: Partial<DriveTelemetryPoint> = {},
): DriveTelemetryPoint {
  return point({
    timestamp: new Date(
      Date.parse('2025-01-01T00:00:00.000Z') + seconds * 1_000,
    ).toISOString(),
    ...overrides,
  });
}

function traitIds(model: ReturnType<typeof buildDriveDnaModel>): string[] {
  return model.genome.traits.map((trait) => trait.id);
}

describe('buildDriveDnaModel timeline normalization', () => {
  it('filters invalid dates, sorts chronologically, counts duplicates, and does not mutate input', () => {
    const raw = [
      at(20, { speed: 20, power: -5 }),
      point({ timestamp: 'not-a-date' }),
      at(0, { speed: 0, power: 0 }),
      at(10, { speed: 10, power: 2 }),
      at(10, { speed: 11, power: 3 }),
    ];
    const snapshot = raw.map((row) => ({ ...row }));

    const model = buildDriveDnaModel(raw);

    expect(raw).toEqual(snapshot);
    expect(model.timeline.map((row) => row.speedMps)).toEqual([
      0, 10, 11, 20,
    ]);
    expect(model.timeline.map((row) => row.powerW)).toEqual([
      0, 2_000, 3_000, -5_000,
    ]);
    expect(model.sample).toEqual({
      returnedRows: 5,
      validRows: 4,
      observedSpanS: 20,
      medianIntervalS: 10,
      largestGapS: 10,
      invalidTimestampCount: 1,
      duplicateTimestampCount: 1,
    });
  });

  it('reads the actual created_at/createdAt wire timestamp aliases', () => {
    const snake = point({
      timestamp: 'invalid',
      created_at: '2025-01-01T00:00:02Z',
      speed: 2,
    });
    const camel = point({
      timestamp: 'invalid',
      createdAt: '2025-01-01T00:00:01Z',
      speed: 1,
    });

    const model = buildDriveDnaModel([snake, camel]);

    expect(model.timeline.map((row) => row.speedMps)).toEqual([1, 2]);
    expect(model.sample.invalidTimestampCount).toBe(0);
  });

  it('uses elapsed-time progress while remaining finite for repeated timestamps', () => {
    const regular = buildDriveDnaModel([at(0), at(10), at(40)]);
    expect(regular.timeline.map((row) => row.progress)).toEqual([
      0, 0.25, 1,
    ]);

    const repeated = buildDriveDnaModel([
      at(0, { speed: 1 }),
      at(0, { speed: 2 }),
      at(0, { speed: 3 }),
    ]);
    expect(repeated.timeline.map((row) => row.progress)).toEqual([
      0, 0.5, 1,
    ]);
    for (const row of repeated.timeline) {
      expect(Number.isFinite(row.elapsedS)).toBe(true);
      expect(Number.isFinite(row.encoding.progress01)).toBe(true);
    }
  });
});

describe('buildDriveDnaModel null and SI semantics', () => {
  it('lifts legacy kW power exactly once into canonical watts', () => {
    const model = buildDriveDnaModel([
      at(0, { power: 12.345 }),
      at(1, { power: -4.5 }),
    ]);

    expect(model.timeline.map((row) => row.powerW)).toEqual([
      12_345, -4_500,
    ]);
    expect(model.stats.peakPropulsionW).toBe(12_345);
    expect(model.stats.peakRegenW).toBe(4_500);
  });

  it('preserves measured zero while keeping missing channels unavailable', () => {
    const model = buildDriveDnaModel([
      at(0, {
        speed: 0,
        power: 0,
        soc: 0,
        batteryLevel: null,
        outsideTemp: 0,
        elevation: 0,
      }),
      at(1, {
        speed: null,
        power: null,
        soc: null,
        batteryLevel: null,
        usableSoc: null,
        outsideTemp: null,
        elevation: null,
      }),
    ]);

    expect(model.timeline[0]).toMatchObject({
      speedMps: 0,
      powerW: 0,
      socPct: 0,
      elevationM: 0,
      outsideTempC: 0,
    });
    expect(model.timeline[1]).toMatchObject({
      speedMps: null,
      powerW: null,
      socPct: null,
      elevationM: null,
      outsideTempC: null,
    });
    expect(model.coverage.speed.availableCount).toBe(1);
    expect(model.coverage.power.availablePct).toBe(50);
    expect(model.stats.topSpeedMps).toBe(0);
    expect(model.stats.peakPropulsionW).toBe(0);
    expect(model.stats.peakRegenW).toBe(0);
    expect(model.stats.coastEmissionCount).toBe(1);
    expect(model.stats.coastEmissionShare).toBe(1);
    expect(model.stats.socDeltaPct).toBe(0);
    expect(model.stats.positiveElevationClimbM).toBeNull();
  });

  it('prefers Soc, then BatteryLevel, then UsableSoc as percentage evidence', () => {
    const model = buildDriveDnaModel([
      at(0, { soc: 71, batteryLevel: 70, usableSoc: 69 }),
      at(1, { soc: null, batteryLevel: 68, usableSoc: 67 }),
      at(2, { soc: null, batteryLevel: null, usableSoc: 66 }),
    ]);

    expect(model.timeline.map((row) => row.socPct)).toEqual([71, 68, 66]);
    expect(model.stats.startSocPct).toBe(71);
    expect(model.stats.endSocPct).toBe(66);
    expect(model.stats.socDeltaPct).toBe(-5);
  });

  it('turns non-finite numeric channels into null without NaN or Infinity', () => {
    const model = buildDriveDnaModel([
      at(0, {
        speed: Number.NaN,
        power: Number.POSITIVE_INFINITY,
        soc: Number.NEGATIVE_INFINITY,
        elevation: Number.NaN,
        outsideTemp: Number.POSITIVE_INFINITY,
      }),
    ]);

    expect(model.timeline[0]).toMatchObject({
      speedMps: null,
      powerW: null,
      socPct: null,
      elevationM: null,
      outsideTempC: null,
    });
    expect(JSON.stringify(model)).not.toMatch(/NaN|Infinity/);
  });
});

describe('buildDriveDnaModel sampled evidence', () => {
  it('computes sampled speed, power, SoC, and positive climb statistics', () => {
    const model = buildDriveDnaModel([
      at(0, { speed: 10, power: 20, soc: 80, elevation: 100 }),
      at(1, { speed: 20, power: -10, soc: 78, elevation: 130 }),
      at(2, { speed: 40, power: 0, soc: 75, elevation: 120 }),
      at(3, { speed: 30, power: null, soc: null, elevation: 160 }),
    ]);

    expect(model.stats).toMatchObject({
      topSpeedMps: 40,
      medianSpeedMps: 25,
      peakPropulsionW: 20_000,
      peakRegenW: 10_000,
      startSocPct: 80,
      endSocPct: 75,
      socDeltaPct: -5,
      positiveElevationClimbM: 70,
      powerMeasuredCount: 3,
      regenEmissionCount: 1,
      propulsionEmissionCount: 1,
      coastEmissionCount: 1,
      regenEmissionShare: 1 / 3,
      propulsionEmissionShare: 1 / 3,
      coastEmissionShare: 1 / 3,
    });
  });

  it('requires at least two measured elevation values before reporting climb', () => {
    expect(
      buildDriveDnaModel([
        at(0, { elevation: null }),
        at(1, { elevation: 100 }),
      ]).stats.positiveElevationClimbM,
    ).toBeNull();
    expect(
      buildDriveDnaModel([
        at(0, { elevation: 100 }),
        at(1, { elevation: 100 }),
      ]).stats.positiveElevationClimbM,
    ).toBe(0);
  });

  it('classifies canonical W using a ±1 kW coast band', () => {
    expect(POWER_COAST_THRESHOLD_W).toBe(1_000);
    const model = buildDriveDnaModel([
      at(0, { power: -2 }),
      at(1, { power: -1 }),
      at(2, { power: -0.5 }),
      at(3, { power: 0 }),
      at(4, { power: 1 }),
      at(5, { power: 2 }),
    ]);

    expect(model.stats.regenEmissionCount).toBe(1);
    expect(model.stats.coastEmissionCount).toBe(4);
    expect(model.stats.propulsionEmissionCount).toBe(1);
  });

  it('uses emission counts rather than irregular elapsed-time weighting', () => {
    const model = buildDriveDnaModel([
      at(0, { power: -5, speed: 0 }),
      at(1, { power: 5, speed: 10 }),
      at(10_001, { power: 5, speed: 20 }),
      at(10_002, { power: 0, speed: 30 }),
    ]);

    expect(model.stats.regenEmissionShare).toBe(0.25);
    expect(model.distributions.power.basis).toBe('emission-count');
    expect(model.distributions.power.bins.map((bin) => bin.count)).toEqual([
      1, 1, 2,
    ]);
    expect(model.sample.largestGapS).toBe(10_000);
  });

  it('exposes all speed bands by measured emission count', () => {
    const model = buildDriveDnaModel([
      at(0, { speed: 0 }),
      at(1, { speed: 5 }),
      at(2, { speed: 20 }),
      at(3, { speed: 30 }),
      at(4, { speed: null }),
    ]);

    expect(model.distributions.speed.measuredCount).toBe(4);
    expect(model.distributions.speed.bins).toEqual([
      { id: 'stationary', count: 1, share: 0.25 },
      { id: 'low', count: 1, share: 0.25 },
      { id: 'medium', count: 1, share: 0.25 },
      { id: 'high', count: 1, share: 0.25 },
    ]);
  });
});

describe('buildDriveDnaModel normalized art and traits', () => {
  it('normalizes encoding dimensions to bounded finite values', () => {
    const model = buildDriveDnaModel([
      at(0, { speed: 10, power: -20, soc: 0, elevation: 100 }),
      at(10, { speed: 20, power: 10, soc: 50, elevation: 150 }),
      at(20, { speed: null, power: null, soc: 100, elevation: 200 }),
    ]);

    expect(model.timeline[0]?.encoding).toMatchObject({
      progress01: 0,
      speed01: 0.5,
      powerSigned01: -1,
      powerMagnitude01: 1,
      soc01: 0,
      elevation01: 0,
    });
    expect(model.timeline[1]?.encoding).toMatchObject({
      progress01: 0.5,
      speed01: 1,
      powerSigned01: 0.5,
      powerMagnitude01: 0.5,
      soc01: 0.5,
      elevation01: 0.5,
    });
    expect(model.timeline[2]?.encoding.speed01).toBeNull();
    expect(model.dimensions.speed.normalizedMax).toBe(1);
    expect(model.dimensions.power.canonicalMin).toBe(-20_000);
    expect(model.dimensions.soc.normalizedMax).toBe(1);
  });

  it('uses honest artistic trait names and normalized strengths', () => {
    const model = buildDriveDnaModel([
      at(0, { speed: 40, power: -6, elevation: 0, outsideTemp: -5 }),
      at(1, { speed: 42, power: -6, elevation: 100, outsideTemp: -4 }),
      at(2, { speed: 41, power: -6, elevation: 220, outsideTemp: -3 }),
      at(3, { speed: 39, power: 2, elevation: 210, outsideTemp: -2 }),
    ]);

    expect(traitIds(model)).toEqual(
      expect.arrayContaining([
        'spirited',
        'mountainous',
        'regen-observed',
        'cold-start',
        'low-demand',
      ]),
    );
    expect(traitIds(model)).not.toContain('efficient');
    for (const entry of model.genome.traits) {
      expect(entry.strength01).toBeGreaterThanOrEqual(0);
      expect(entry.strength01).toBeLessThanOrEqual(1);
    }
  });

  it('does not infer speed or power traits from missing channels', () => {
    const allNull = Array.from({ length: 3 }, (_, index) =>
      at(index, {
        speed: null,
        power: null,
        soc: null,
        batteryLevel: null,
        usableSoc: null,
        elevation: null,
        outsideTemp: null,
      }),
    );
    const model = buildDriveDnaModel(allNull);

    expect(model.genome.traits).toEqual([]);
    expect(model.stats.regenEmissionShare).toBeNull();
    expect(model.stats.topSpeedMps).toBeNull();
    expect(model.stats.regenEmissionCount).toBeNull();
    expect(model.stats.propulsionEmissionCount).toBeNull();
    expect(model.stats.coastEmissionCount).toBeNull();

    const measuredZero = buildDriveDnaModel([
      at(0, { speed: 0, power: 0 }),
      at(1, { speed: 0, power: 0 }),
    ]);
    expect(traitIds(measuredZero)).toEqual(
      expect.arrayContaining(['gentle', 'low-demand']),
    );
  });

  it('uses Balanced only when both speed and power evidence exist', () => {
    const balanced = buildDriveDnaModel([
      at(0, { speed: 20, power: 20, elevation: 100, outsideTemp: 20 }),
      at(1, { speed: 22, power: 22, elevation: 100, outsideTemp: 20 }),
    ]);
    expect(traitIds(balanced)).toEqual(['balanced']);

    const speedOnly = buildDriveDnaModel([
      at(0, { speed: 20, power: null }),
      at(1, { speed: 22, power: null }),
    ]);
    expect(traitIds(speedOnly)).toEqual([]);
  });

  it('is deterministic for identical normalized telemetry and chronological order', () => {
    const raw = [
      at(20, { speed: 30, power: -5, soc: 60 }),
      at(0, { speed: 10, power: 5, soc: 70 }),
      at(10, { speed: 20, power: 0, soc: 65 }),
    ];
    const shifted = raw.map((row) => ({
      ...row,
      timestamp: new Date(Date.parse(row.timestamp) + 86_400_000).toISOString(),
    }));

    const first = buildDriveDnaModel(raw);
    const clone = buildDriveDnaModel(raw.map((row) => ({ ...row })));
    const movedInTime = buildDriveDnaModel(shifted);

    expect(first.genome.signature).toBe(clone.genome.signature);
    expect(first.genome.signature).toBe(movedInTime.genome.signature);
    expect(first.genome.signature).toMatch(/^[0-9A-Z]{7}$/);
  });

  it('keeps missing and measured-zero encodings distinct in the signature', () => {
    const missing = buildDriveDnaModel([
      at(0, { speed: null, power: null }),
      at(1, { speed: null, power: null }),
    ]);
    const zero = buildDriveDnaModel([
      at(0, { speed: 0, power: 0 }),
      at(1, { speed: 0, power: 0 }),
    ]);

    expect(missing.genome.signature).not.toBe(zero.genome.signature);
  });
});

describe('buildDriveDnaModel edge cases and bounds', () => {
  it('returns coherent empty evidence for empty and invalid-only input', () => {
    const empty = buildDriveDnaModel(undefined);
    expect(empty.timeline).toEqual([]);
    expect(empty.chartPoints).toEqual([]);
    expect(empty.genome.petals).toEqual([]);
    expect(empty.genome.signature).toBe('0000000');
    expect(empty.sample.observedSpanS).toBeNull();
    expect(empty.coverage.power.availablePct).toBeNull();

    const invalid = buildDriveDnaModel([
      point({ timestamp: '' }),
      point({ timestamp: 'bad' }),
      null,
    ]);
    expect(invalid.sample.returnedRows).toBe(3);
    expect(invalid.sample.invalidTimestampCount).toBe(3);
    expect(invalid.sample.validRows).toBe(0);
  });

  it('handles one point without division by zero', () => {
    const model = buildDriveDnaModel([
      at(0, { speed: 0, power: 0, elevation: 0 }),
    ]);

    expect(model.timeline).toHaveLength(1);
    expect(model.chartPoints).toHaveLength(1);
    expect(model.genome.petals).toHaveLength(1);
    expect(model.sample).toMatchObject({
      observedSpanS: 0,
      medianIntervalS: null,
      largestGapS: null,
    });
    expect(model.timeline[0]?.progress).toBe(0);
    expect(model.genome.signature).not.toBe('0000000');
    expect(JSON.stringify(model)).not.toMatch(/NaN|Infinity/);
  });

  it('bounds chart and artwork points while retaining first and last', () => {
    const raw = Array.from({ length: 20_000 }, (_, index) =>
      at(index, {
        speed: index % 50,
        power: (index % 31) - 15,
        soc: 90 - (index % 40),
        elevation: index % 300,
      }),
    );

    const model = buildDriveDnaModel(raw);

    expect(model.timeline).toHaveLength(20_000);
    expect(model.chartPoints).toHaveLength(DRIVE_DNA_MAX_CHART_POINTS);
    expect(model.genome.petals).toHaveLength(DRIVE_DNA_MAX_ART_POINTS);
    expect(model.chartPoints[0]?.timestamp).toBe(model.timeline[0]?.timestamp);
    expect(model.chartPoints.at(-1)?.timestamp).toBe(
      model.timeline.at(-1)?.timestamp,
    );
    expect(model.genome.sourcePointCount).toBe(20_000);
    expect(model.genome.encodedPointCount).toBe(DRIVE_DNA_MAX_ART_POINTS);
    expect(JSON.stringify(model.genome)).not.toMatch(/NaN|Infinity/);
  });

  it('preserves isolated middle speed, propulsion, and regen extrema', () => {
    const raw = Array.from({ length: 2_000 }, (_, index) =>
      at(index, { speed: 20, power: 5 }),
    );
    raw[997] = at(997, { speed: 80, power: 5 });
    raw[999] = at(999, { speed: 0, power: 5 });
    raw[1_000] = at(1_000, { speed: 20, power: 250 });
    raw[1_002] = at(1_002, { speed: 20, power: -180 });
    const snapshot = raw.map((row) => ({ ...row }));

    const model = buildDriveDnaModel(raw);
    const sampledByElapsed = new Map(
      model.chartPoints.map((row) => [row.elapsedS, row]),
    );

    expect(sampledByElapsed.get(997)?.speedMps).toBe(80);
    expect(sampledByElapsed.get(999)?.speedMps).toBe(0);
    expect(sampledByElapsed.get(1_000)?.powerW).toBe(250_000);
    expect(sampledByElapsed.get(1_002)?.powerW).toBe(-180_000);
    expect(model.chartPoints).toHaveLength(DRIVE_DNA_MAX_CHART_POINTS);
    expect(
      new Set(model.chartPoints.map((row) => row.timestampMs)).size,
    ).toBe(model.chartPoints.length);
    expect(
      model.chartPoints.every(
        (row, index) =>
          index === 0 ||
          row.timestampMs >
            (model.chartPoints[index - 1]?.timestampMs ??
              Number.NEGATIVE_INFINITY),
      ),
    ).toBe(true);
    expect(raw).toEqual(snapshot);
    expect(buildDriveDnaModel(raw).chartPoints).toEqual(model.chartPoints);
  });

  it('retains null transition boundaries so sampled charts keep evidence gaps', () => {
    const raw = Array.from({ length: 2_000 }, (_, index) =>
      at(index, { speed: 30, power: 10 }),
    );
    raw[996] = at(996, { speed: null, power: null });

    const model = buildDriveDnaModel(raw);
    const gapPosition = model.chartPoints.findIndex(
      (row) => row.elapsedS === 996,
    );

    expect(gapPosition).toBeGreaterThan(0);
    expect(
      model.chartPoints
        .slice(gapPosition - 1, gapPosition + 2)
        .map((row) => row.elapsedS),
    ).toEqual([995, 996, 997]);
    expect(model.chartPoints[gapPosition - 1]).toMatchObject({
      speedMps: 30,
      powerW: 10_000,
    });
    expect(model.chartPoints[gapPosition]).toMatchObject({
      speedMps: null,
      powerW: null,
    });
    expect(model.chartPoints[gapPosition + 1]).toMatchObject({
      speedMps: 30,
      powerW: 10_000,
    });
  });

  it('keeps the art-only compatibility entry point deterministic', () => {
    const raw = [at(0), at(1, { power: -2 })];
    expect(generateDriveDNA(raw)).toEqual(buildDriveDnaModel(raw).genome);
  });

  it('maps petals to finite coordinates radiating from the centre', () => {
    const petal = buildDriveDnaModel([at(0)]).genome.petals[0];
    expect(petal).toBeDefined();
    const line = petalLine(petal!);

    for (const value of Object.values(line)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    const inner = Math.hypot(line.x1 - DNA_CENTER, line.y1 - DNA_CENTER);
    const outer = Math.hypot(line.x2 - DNA_CENTER, line.y2 - DNA_CENTER);
    expect(outer).toBeGreaterThanOrEqual(inner);
  });
});
