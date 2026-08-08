import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COMFORT_BAND_C,
  DEFAULT_COMFORT_MAX_GAP_S,
  DEFAULT_COMFORT_MAX_TARGET_SHIFT_C,
  DEFAULT_COMFORT_SUSTAIN_SAMPLES,
  DEFAULT_COMFORT_WINDOW_DISPLAY_LIMIT,
  DEFAULT_SETPOINT_DISAGREEMENT_C,
  MAX_COMFORT_WINDOW_DISPLAY_LIMIT,
  summarizeComfortConsistency,
  type ComfortSample,
} from './comfortConsistency';

const BASE = Date.UTC(2026, 6, 1, 12);

function row(
  minute: number,
  insideTemp: number,
  overrides: Partial<ComfortSample> = {},
): ComfortSample {
  return {
    timestamp: new Date(BASE + minute * 60_000).toISOString(),
    insideTemp,
    driverTempSetting: 21,
    passengerTempSetting: 21,
    hvacPower: true,
    ...overrides,
  };
}

describe('summarizeComfortConsistency row and source accounting', () => {
  it('assigns every returned row to one mutually exclusive outcome', () => {
    const duplicate = new Date(BASE).toISOString();
    const result = summarizeComfortConsistency([
      { timestamp: duplicate, insideTemp: 21, driverTempSetting: 21, hvacPower: true },
      null,
      {},
      { timestamp: 'bad', insideTemp: 21, driverTempSetting: 21, hvacPower: true },
      { timestamp: duplicate, insideTemp: 30, driverTempSetting: 21, hvacPower: false },
      row(5, 21, { hvacPower: null, isAcOn: null, fanSpeed: null }),
      row(10, 21, { hvacPower: false }),
      row(15, 21, { insideTemp: null }),
      row(20, 21, { driverTempSetting: null, passengerTempSetting: null }),
    ] as unknown as ComfortSample[]);

    expect(result.rows).toEqual({
      returnedRows: 9,
      invalidRowRows: 1,
      missingTimestampRows: 1,
      invalidTimestampRows: 1,
      timestampValidRows: 6,
      duplicateTimestampRows: 1,
      uniqueTimestampRows: 5,
      unknownHvacRows: 1,
      hvacOffRows: 1,
      missingInsideTempRows: 1,
      missingSetpointRows: 1,
      analyzedRows: 1,
    });
    expect(result.sources).toMatchObject({
      denominatorRows: 5,
      insideTempRows: 4,
      driverSetpointRows: 4,
      passengerSetpointRows: 3,
      anySetpointRows: 4,
      pairedSetpointRows: 3,
      singleSetpointRows: 1,
      knownHvacRows: 4,
      activeHvacRows: 3,
      thermallyCompleteRows: 3,
    });
    expect(result.identities.rowsBalanced).toBe(true);
    expect(result.identities.timestampsBalanced).toBe(true);
  });

  it('uses a valid timestamp alias when the other alias is malformed', () => {
    const result = summarizeComfortConsistency([
      {
        timestamp: 'bad',
        created_at: new Date(BASE).toISOString(),
        insideTemp: 21,
        driverTempSetting: 21,
        hvacPower: true,
      },
    ]);

    expect(result.rows.analyzedRows).toBe(1);
    expect(result.rows.invalidTimestampRows).toBe(0);
  });

  it('retains the first returned row at a duplicate timestamp', () => {
    const timestamp = new Date(BASE).toISOString();
    const result = summarizeComfortConsistency([
      { timestamp, insideTemp: 21, driverTempSetting: 21, hvacPower: true },
      { timestamp, insideTemp: 35, driverTempSetting: 21, hvacPower: true },
    ]);

    expect(result.rows.duplicateTimestampRows).toBe(1);
    expect(result.meanAbsDeviationC).toBe(0);
  });

  it('tracks paired and one-sided setpoint support separately', () => {
    const result = summarizeComfortConsistency([
      row(0, 21, { passengerTempSetting: null }),
      row(5, 21, { driverTempSetting: 20, passengerTempSetting: 22 }),
    ]);

    expect(result.sources.singleSetpointRows).toBe(1);
    expect(result.sources.pairedSetpointRows).toBe(1);
    expect(result.singleSetpointAnalyzedSamples).toBe(1);
    expect(result.pairedSetpointAnalyzedSamples).toBe(1);
    expect(result.meanSetpointDisagreementC).toBe(2);
    expect(result.disagreementSampleShare).toBe(1);
  });
});

describe('summarizeComfortConsistency sample and interval evidence', () => {
  it('preserves sample metrics while exposing duration-weighted evidence', () => {
    const result = summarizeComfortConsistency([
      row(0, 22, { driverTempSetting: 20, passengerTempSetting: 22 }),
      row(5, 23, { driverTempSetting: 20, passengerTempSetting: 22 }),
      row(10, 21, { driverTempSetting: 20, passengerTempSetting: 22 }),
    ]);

    expect(result.analyzedSamples).toBe(3);
    expect(result.meanAbsDeviationC).toBe(1);
    expect(result.medianAbsDeviationC).toBe(1);
    expect(result.meanSetpointDisagreementC).toBe(2);
    expect(result.withinComfortBandShare).toBeCloseTo(2 / 3);
    expect(result.intervalComposition.withinBandShare).toBeCloseTo(0.5);
  });

  it('classifies active interval duration below, within, and above the band', () => {
    const result = summarizeComfortConsistency([
      row(0, 24),
      row(5, 21),
      row(15, 18),
      row(20, 18, { hvacPower: false }),
    ]);

    expect(result.intervals).toMatchObject({
      candidateAdjacentPairs: 3,
      observedActiveIntervals: 3,
      longGapExclusions: 0,
      inactiveStartIntervals: 0,
      evidenceBarrierIntervals: 0,
    });
    expect(result.intervalComposition).toEqual({
      observedActiveS: 1_200,
      belowBandS: 300,
      withinBandS: 600,
      aboveBandS: 300,
      withinBandShare: 0.5,
      durationWeightedMeanAbsDeviationC: 1.5,
    });
    expect(result.identities.intervalDurationBalanced).toBe(true);
  });

  it('separates long gaps, inactive starts, and evidence barriers', () => {
    const result = summarizeComfortConsistency(
      [
        row(0, 24),
        row(5, 24, { hvacPower: false }),
        row(10, 24, { hvacPower: null }),
        row(15, 24),
        row(60, 24),
      ],
      { maxGapS: 600 },
    );

    expect(result.intervals).toEqual({
      candidateAdjacentPairs: 4,
      observedActiveIntervals: 1,
      longGapExclusions: 1,
      inactiveStartIntervals: 1,
      evidenceBarrierIntervals: 1,
      nonpositiveIntervals: 0,
      terminalSamples: 1,
    });
    expect(result.identities.intervalsBalanced).toBe(true);
  });

  it('splits duration evidence at local hour boundaries', () => {
    const start = new Date(2026, 6, 1, 10, 30, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    const result = summarizeComfortConsistency(
      [
        {
          timestamp: start.toISOString(),
          insideTemp: 21,
          driverTempSetting: 21,
          hvacPower: true,
        },
        {
          timestamp: end.toISOString(),
          insideTemp: 21,
          driverTempSetting: 21,
          hvacPower: true,
        },
      ],
      { maxGapS: 2 * 60 * 60 },
    );

    expect(result.hourlyProfile[start.getHours()]?.observedS).toBe(1_800);
    expect(result.hourlyProfile[end.getHours()]?.observedS).toBe(1_800);
    expect(
      result.hourlyProfile.reduce(
        (sum, bucket) => sum + bucket.withinBandS,
        0,
      ),
    ).toBe(3_600);
  });
});

describe('summarizeComfortConsistency active fragments and windows', () => {
  it('keeps missing thermal evidence as a run barrier', () => {
    const result = summarizeComfortConsistency([
      row(0, 30),
      row(5, 28, { insideTemp: null }),
      row(10, 28),
      row(15, 21.5),
      row(20, 21),
    ]);

    expect(result.activeRuns).toHaveLength(2);
    expect(result.stabilizationWindows).toHaveLength(2);
    expect(result.stabilizationWindows[0]).toMatchObject({
      samples: 1,
      leftBoundary: 'dataset_edge',
      rightBoundary: 'missing_evidence',
      timeToBandS: null,
    });
    expect(result.stabilizationWindows[1]).toMatchObject({
      samples: 3,
      leftBoundary: 'missing_evidence',
      rightBoundary: 'dataset_edge',
      timeToBandS: 300,
    });
    expect(result.boundaryAccounting.missingEvidenceBoundaries).toBe(2);
  });

  it('finds sustained stabilization and observed opposite-side overshoot', () => {
    const result = summarizeComfortConsistency(
      [
        row(0, 30),
        row(5, 25),
        row(10, 21.5),
        row(15, 20.5),
        row(20, 19),
        row(25, 19, { hvacPower: false }),
      ],
      { comfortBandC: 1.5, sustainSamples: 2 },
    );

    expect(result.stabilizationWindows).toHaveLength(1);
    expect(result.stabilizationWindows[0]).toMatchObject({
      direction: 'hot',
      timeToBandS: 600,
      overshootC: 2,
      rightBoundary: 'hvac_inactive',
      rightCensored: false,
    });
    expect(result.medianStabilizationS).toBe(600);
    expect(result.medianOvershootC).toBe(2);
    expect(result.stabilizedWindows).toBe(1);
  });

  it('separates cold starts and discloses an observed non-stabilized window', () => {
    const result = summarizeComfortConsistency([
      row(0, 10),
      row(10, 14),
      row(20, 17),
      row(25, 17, { hvacPower: false }),
    ]);

    expect(result.stabilizationWindows[0]).toMatchObject({
      direction: 'cold',
      timeToBandS: null,
      rightBoundary: 'hvac_inactive',
      rightCensored: false,
    });
    expect(result.stabilizedWindows).toBe(0);
    expect(result.unstabilizedWindows).toBe(1);
    expect(result.censoredUnstabilizedWindows).toBe(0);
  });

  it('splits active fragments across long gaps and material target changes', () => {
    const result = summarizeComfortConsistency(
      [
        row(0, 30),
        row(5, 28),
        row(60, 30),
        row(65, 28),
        row(70, 28, { driverTempSetting: 17, passengerTempSetting: 17 }),
        row(75, 25, { driverTempSetting: 17, passengerTempSetting: 17 }),
      ],
      { maxGapS: 600, maxTargetShiftC: 2 },
    );

    expect(result.activeRuns).toHaveLength(3);
    expect(result.stabilizationWindows).toHaveLength(3);
    expect(result.boundaryAccounting.longGapBoundaries).toBe(2);
    expect(result.boundaryAccounting.targetShiftBoundaries).toBe(2);
  });

  it('treats a late inactive row as a long-gap boundary', () => {
    const result = summarizeComfortConsistency(
      [
        row(0, 30),
        row(60, 30, { hvacPower: false }),
      ],
      { maxGapS: 600 },
    );

    expect(result.activeRuns[0]).toMatchObject({
      rightBoundary: 'long_gap',
      rightCensored: true,
    });
    expect(result.boundaryAccounting.longGapBoundaries).toBe(1);
    expect(result.boundaryAccounting.hvacInactiveBoundaries).toBe(0);
  });

  it('accounts for in-band starts separately from stabilization candidates', () => {
    const result = summarizeComfortConsistency([
      row(0, 21),
      row(5, 21),
      row(10, 21, { hvacPower: false }),
      row(15, 30),
    ]);

    expect(result.activeRunCount).toBe(2);
    expect(result.insideBandStartRuns).toBe(1);
    expect(result.stabilizationWindows).toHaveLength(1);
    expect(result.identities.activeFragmentsBalanced).toBe(true);
  });
});

describe('summarizeComfortConsistency distributions, score, and ordering', () => {
  it('publishes complete deviation and overshoot distributions', () => {
    const result = summarizeComfortConsistency([
      row(0, 30),
      row(5, 21),
      row(10, 19),
      row(15, 19, { hvacPower: false }),
    ]);

    expect(
      result.deviationDistribution.reduce(
        (sum, bin) => sum + bin.samples,
        0,
      ),
    ).toBe(result.analyzedSamples);
    expect(
      result.overshootDistribution.reduce(
        (sum, bin) => sum + bin.windows,
        0,
      ),
    ).toBe(result.stabilizationWindows.length);
  });

  it('exposes confidence shrinkage and every score component', () => {
    const sparse = summarizeComfortConsistency([row(0, 21)]);
    const dense = summarizeComfortConsistency(
      Array.from({ length: 100 }, (_, index) => row(index * 2, 21)),
    );

    expect(sparse.confidence).toBeLessThan(dense.confidence);
    expect(sparse.consistencyScore).toBeGreaterThanOrEqual(50);
    expect(dense.consistencyScore).toBeGreaterThan(sparse.consistencyScore!);
    expect(dense.score).toMatchObject({
      bandAdherence: 1,
      deviationScore: 1,
      agreementScore: 1,
      stabilizationScore: 0.5,
      sampleConfidence: 1,
    });
  });

  it('keeps chronological windows stable and caps a newest-first directory', () => {
    const samples = [
      row(0, 21, { hvacPower: false }),
      row(1, 30),
      row(2, 30, { hvacPower: false }),
      row(3, 30),
      row(4, 30, { hvacPower: false }),
      row(5, 10),
      row(6, 10, { hvacPower: false }),
    ];
    const first = summarizeComfortConsistency(samples, {
      windowDisplayLimit: 2,
    });
    const second = summarizeComfortConsistency(samples, {
      windowDisplayLimit: 2,
    });

    expect(first.windowDirectory).toMatchObject({
      total: 3,
      displayed: 2,
      omitted: 1,
      cap: 2,
    });
    expect(first.windowDirectory.items.map((window) => window.startMs)).toEqual(
      [...first.windowDirectory.items.map((window) => window.startMs)]
        .sort((a, b) => b - a),
    );
    expect(first.windowDirectory.items.map((window) => window.index)).toEqual([
      3,
      2,
    ]);
    expect(second.activeRuns).toEqual(first.activeRuns);
  });

  it('reports chronological coverage and cadence from every unique timestamp', () => {
    const result = summarizeComfortConsistency([
      row(30, 21),
      row(0, 21),
      row(5, 21),
      row(15, 21),
    ]);

    expect(result.coverage).toMatchObject({
      earliestValidMs: BASE,
      latestValidMs: BASE + 30 * 60_000,
      spanS: 1_800,
      cadenceIntervals: 3,
      medianGapS: 600,
      p90GapS: 900,
      maxObservedGapS: 900,
      longGapCount: 0,
      stateCoverage: 1,
      analyticCoverage: 1,
    });
  });
});

describe('summarizeComfortConsistency resilience', () => {
  it('validates every option and bounds the directory cap', () => {
    const invalid = summarizeComfortConsistency([], {
      comfortBandC: Number.NaN,
      maxGapS: Number.NEGATIVE_INFINITY,
      sustainSamples: 0,
      maxTargetShiftC: -1,
      setpointDisagreementC: 0,
      windowDisplayLimit: 0,
    });
    expect(invalid.thresholds).toEqual({
      comfortBandC: DEFAULT_COMFORT_BAND_C,
      maxGapS: DEFAULT_COMFORT_MAX_GAP_S,
      sustainSamples: DEFAULT_COMFORT_SUSTAIN_SAMPLES,
      maxTargetShiftC: DEFAULT_COMFORT_MAX_TARGET_SHIFT_C,
      setpointDisagreementC: DEFAULT_SETPOINT_DISAGREEMENT_C,
      windowDisplayLimit: DEFAULT_COMFORT_WINDOW_DISPLAY_LIMIT,
    });

    const bounded = summarizeComfortConsistency([], {
      comfortBandC: 2,
      maxGapS: 90,
      sustainSamples: 3.8,
      maxTargetShiftC: 1,
      setpointDisagreementC: 0.5,
      windowDisplayLimit: MAX_COMFORT_WINDOW_DISPLAY_LIMIT + 100,
    });
    expect(bounded.thresholds).toEqual({
      comfortBandC: 2,
      maxGapS: 90,
      sustainSamples: 3,
      maxTargetShiftC: 1,
      setpointDisagreementC: 0.5,
      windowDisplayLimit: MAX_COMFORT_WINDOW_DISPLAY_LIMIT,
    });
    expect(
      summarizeComfortConsistency(
        [],
        null as unknown as Parameters<typeof summarizeComfortConsistency>[1],
      ).thresholds,
    ).toEqual(invalid.thresholds);
  });

  it('does not mutate source rows or source order', () => {
    const samples = [row(10, 21), row(0, 30), row(5, 25)];
    const before = structuredClone(samples);

    summarizeComfortConsistency(samples);

    expect(samples).toEqual(before);
  });

  it('survives hostile rows and keeps exact identities', () => {
    const hostile = [
      null,
      'row',
      { timestamp: {}, insideTemp: 21, driverTempSetting: 21, hvacPower: true },
      {
        timestamp: new Date(BASE).toISOString(),
        insideTemp: Number.NaN,
        driverTempSetting: '21',
        hvacPower: 'yes',
      },
      row(1, 21),
    ] as unknown as ComfortSample[];

    const result = summarizeComfortConsistency(hostile);

    expect(result.rows).toMatchObject({
      returnedRows: 5,
      invalidRowRows: 2,
      invalidTimestampRows: 1,
      unknownHvacRows: 1,
      analyzedRows: 1,
    });
    expect(Object.values(result.identities).every(Boolean)).toBe(true);
  });

  it('keeps all accounting identities true for empty evidence', () => {
    const result = summarizeComfortConsistency([]);

    expect(result.rows.returnedRows).toBe(0);
    expect(result.intervalComposition.observedActiveS).toBe(0);
    expect(result.consistencyScore).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.hourlyProfile).toHaveLength(24);
    expect(Object.values(result.identities).every(Boolean)).toBe(true);
  });
});
