import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HVAC_MAX_GAP_S,
  DEFAULT_HVAC_RUN_DISPLAY_LIMIT,
  DEFAULT_HVAC_SHORT_CYCLE_THRESHOLD_S,
  MAX_HVAC_RUN_DISPLAY_LIMIT,
  normalizeHvacOn,
  summarizeHvacCycling,
  type HvacSignalSample,
} from './hvacCycling';

const BASE = Date.UTC(2026, 6, 1, 10, 0, 0);

function sample(
  minute: number,
  state: Partial<HvacSignalSample>,
): HvacSignalSample {
  return {
    timestamp: new Date(BASE + minute * 60_000).toISOString(),
    ...state,
  };
}

describe('normalizeHvacOn', () => {
  it('preserves active-wins tri-state semantics for existing consumers', () => {
    expect(normalizeHvacOn({ hvacPower: false, fanSpeed: 3 })).toBe(true);
    expect(normalizeHvacOn({ isAcOn: true, hvacFanStatus: 0 })).toBe(true);
    expect(normalizeHvacOn({ hvacPower: true, isAcOn: false })).toBe(true);
    expect(normalizeHvacOn({
      hvacPower: false,
      isAcOn: false,
      fanSpeed: 0,
    })).toBe(false);
    expect(normalizeHvacOn({})).toBeNull();
  });

  it('ignores hostile runtime types and nonfinite fan values', () => {
    expect(normalizeHvacOn({
      hvacPower: 'true',
      isAcOn: 1,
      fanSpeed: Number.POSITIVE_INFINITY,
      hvacFanStatus: Number.NaN,
    })).toBeNull();
    expect(normalizeHvacOn({ fanSpeed: -1 })).toBe(false);
    expect(normalizeHvacOn(null as unknown as HvacSignalSample)).toBeNull();
  });
});

describe('summarizeHvacCycling row accounting', () => {
  it('assigns every returned row to one mutually exclusive outcome', () => {
    const timestamp = new Date(BASE).toISOString();
    const result = summarizeHvacCycling([
      { timestamp, hvacPower: true },
      {},
      { timestamp: 'not-a-date', hvacPower: true },
      { timestamp: 123 as unknown as string, hvacPower: true },
      { timestamp, hvacPower: false },
      sample(5, {}),
      sample(10, { hvacPower: false }),
    ]);

    expect(result.rows).toEqual({
      returnedRows: 7,
      validKnownStateRows: 2,
      missingTimestampRows: 1,
      invalidTimestampRows: 2,
      duplicateTimestampRows: 1,
      uninterpretableStateRows: 1,
      timestampValidRows: 4,
      uniqueTimestampRows: 3,
      knownOnRows: 1,
      knownOffRows: 1,
    });
    expect(result.identities.rowsBalanced).toBe(true);
  });

  it('uses a valid timestamp alias when the other alias is malformed', () => {
    const result = summarizeHvacCycling([
      {
        timestamp: 'bad',
        created_at: new Date(BASE).toISOString(),
        fanSpeed: 1,
      },
      {
        timestamp: '',
        created_at: new Date(BASE + 60_000).toISOString(),
        fanSpeed: 0,
      },
    ]);

    expect(result.rows.validKnownStateRows).toBe(2);
    expect(result.rows.invalidTimestampRows).toBe(0);
    expect(result.observedS).toBe(60);
  });

  it('retains the first returned row at a duplicate timestamp', () => {
    const duplicate = new Date(BASE).toISOString();
    const rows = [
      sample(10, { hvacPower: false }),
      { timestamp: duplicate, hvacPower: false },
      { timestamp: duplicate, hvacPower: true },
      sample(5, { hvacPower: false }),
    ];
    const result = summarizeHvacCycling(rows);

    expect(result.rows.duplicateTimestampRows).toBe(1);
    expect(result.rows.knownOnRows).toBe(0);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      on: false,
      durationS: 600,
      intervals: 2,
    });
  });

  it('accounts for strict signal availability and defensible conflicts', () => {
    const result = summarizeHvacCycling([
      sample(0, {
        hvacPower: true,
        isAcOn: false,
        fanSpeed: 0,
        hvacFanStatus: 2,
      }),
      sample(5, { isAcOn: false }),
      sample(10, { fanSpeed: Number.NaN }),
    ]);

    expect(result.signals).toEqual({
      denominatorRows: 3,
      hvacPowerRows: 1,
      acRows: 2,
      fanSpeedRows: 1,
      fanStatusRows: 1,
      anyFanRows: 1,
      anySignalRows: 2,
      powerAcConflictRows: 1,
      fanConflictRows: 1,
      anyConflictRows: 1,
    });
    expect(result.coverage.stateCoverage).toBeCloseTo(2 / 3);
  });
});

describe('summarizeHvacCycling interval evidence', () => {
  it('computes duration-weighted on/off duty from observed intervals', () => {
    const result = summarizeHvacCycling([
      sample(0, { hvacPower: true }),
      sample(5, { hvacPower: true }),
      sample(10, { hvacPower: false }),
      sample(20, { hvacPower: false }),
      sample(30, { isAcOn: true }),
      sample(35, { isAcOn: false }),
    ]);

    expect(result.totalOnObservedS).toBe(900);
    expect(result.totalOffObservedS).toBe(1_200);
    expect(result.observedS).toBe(2_100);
    expect(result.dutyCycle).toBeCloseTo(3 / 7);
    expect(result.runs.map((run) => [run.on, run.durationS])).toEqual([
      [true, 600],
      [false, 1_200],
      [true, 300],
    ]);
  });

  it('keeps unknown states as barriers instead of bridging across them', () => {
    const result = summarizeHvacCycling([
      sample(0, { hvacPower: true }),
      sample(5, {}),
      sample(10, { hvacPower: true }),
      sample(15, { hvacPower: false }),
    ]);

    expect(result.intervals).toMatchObject({
      candidateAdjacentPairs: 3,
      observedIntervals: 2,
      unknownStateBarriers: 1,
      longGapExclusions: 0,
    });
    expect(result.observedS).toBe(600);
    expect(result.runs.map((run) => [
      run.startMs,
      run.endMs,
      run.leftBoundary,
      run.rightBoundary,
    ])).toEqual([
      [
        BASE,
        BASE + 5 * 60_000,
        'dataset_edge',
        'unknown_state',
      ],
      [
        BASE + 10 * 60_000,
        BASE + 15 * 60_000,
        'unknown_state',
        'observed_transition',
      ],
    ]);
  });

  it('breaks runs at long gaps and records both censored boundaries', () => {
    const result = summarizeHvacCycling(
      [
        sample(0, { hvacPower: true }),
        sample(5, { hvacPower: true }),
        sample(100, { hvacPower: true }),
        sample(105, { hvacPower: true }),
        sample(110, { hvacPower: false }),
      ],
      { maxGapS: 600 },
    );

    expect(result.intervals.longGapExclusions).toBe(1);
    expect(result.runs.filter((run) => run.on)).toMatchObject([
      {
        durationS: 300,
        leftBoundary: 'dataset_edge',
        rightBoundary: 'long_gap',
        complete: false,
      },
      {
        durationS: 600,
        leftBoundary: 'long_gap',
        rightBoundary: 'observed_transition',
        complete: false,
      },
    ]);
    expect(result.boundaryAccounting.longGapBoundaries).toBe(2);
  });

  it('balances every interval disposition and terminal sample exactly', () => {
    const duplicate = new Date(BASE).toISOString();
    const result = summarizeHvacCycling(
      [
        { timestamp: duplicate, hvacPower: true },
        { timestamp: duplicate, hvacPower: false },
        sample(5, {}),
        sample(10, { hvacPower: false }),
        sample(100, { hvacPower: false }),
      ],
      { maxGapS: 600 },
    );

    expect(result.intervals).toEqual({
      candidateAdjacentPairs: 3,
      observedIntervals: 1,
      longGapExclusions: 1,
      unknownStateBarriers: 1,
      nonpositiveIntervals: 0,
      duplicatesRemovedBeforePairing: 1,
      terminalSamples: 1,
    });
    expect(result.identities.timelineBalanced).toBe(true);
    expect(result.identities.intervalsBalanced).toBe(true);
    expect(result.identities.runIntervalsBalanced).toBe(true);
    expect(result.identities.observedDurationBalanced).toBe(true);
  });

  it('keeps a lone terminal sample separate from intervals and runs', () => {
    const result = summarizeHvacCycling([
      sample(0, { hvacPower: true }),
    ]);

    expect(result.intervals.candidateAdjacentPairs).toBe(0);
    expect(result.intervals.terminalSamples).toBe(1);
    expect(result.runs).toEqual([]);
    expect(result.dutyCycle).toBeNull();
  });
});

describe('summarizeHvacCycling runs, transitions, and cycles', () => {
  it('separates samples, intervals, runs, active runs, and transitions', () => {
    const result = summarizeHvacCycling([
      sample(0, { hvacPower: false }),
      sample(5, { hvacPower: false }),
      sample(10, { hvacPower: true }),
      sample(15, { hvacPower: true }),
      sample(20, { hvacPower: false }),
      sample(25, {}),
    ]);

    expect(result.analyzedSamples).toBe(5);
    expect(result.intervals.observedIntervals).toBe(5);
    expect(result.runs).toHaveLength(3);
    expect(result.activeRunCount).toBe(1);
    expect(result.transitions).toEqual({
      offToOff: 1,
      offToOn: 1,
      onToOff: 1,
      onToOn: 1,
      knownToUnknown: 1,
    });
    expect(result.transitionCount).toBe(2);
    expect(result.observedOnStarts).toBe(1);
  });

  it('marks only transition-bounded active runs as complete cycles', () => {
    const result = summarizeHvacCycling([
      sample(0, { hvacPower: false }),
      sample(5, { hvacPower: true }),
      sample(10, { hvacPower: true }),
      sample(15, { hvacPower: false }),
      sample(20, { hvacPower: false }),
    ]);
    const active = result.runs.find((run) => run.on);

    expect(active).toMatchObject({
      durationS: 600,
      leftBoundary: 'observed_transition',
      rightBoundary: 'observed_transition',
      leftBoundaryObserved: true,
      rightBoundaryObserved: true,
      complete: true,
      support: 'complete',
      eligibleForShortCycle: true,
      shortCycle: true,
    });
    expect(result.completeCycles).toBe(1);
    expect(result.completeOnRunCount).toBe(1);
  });

  it('uses only complete active runs for short-cycle conclusions', () => {
    const result = summarizeHvacCycling(
      [
        sample(0, { hvacPower: true }),
        sample(5, { hvacPower: false }),
        sample(10, { hvacPower: true }),
        sample(15, { hvacPower: false }),
        sample(20, { hvacPower: true }),
        sample(40, { hvacPower: true }),
        sample(45, { hvacPower: false }),
      ],
      { shortCycleThresholdS: 600 },
    );

    expect(result.activeRunCount).toBe(3);
    expect(result.eventCount).toBe(3);
    expect(result.observedOnStarts).toBe(2);
    expect(result.completeOnRunCount).toBe(2);
    expect(result.shortCompleteOnRunCount).toBe(1);
    expect(result.qualifiedShortCycleRate).toBe(0.5);
    expect(result.shortCycleRate).toBe(0.5);
    expect(result.allOnRunShortCycleRate).toBeCloseTo(2 / 3);
  });

  it('withholds a rate when every active run is boundary-censored', () => {
    const result = summarizeHvacCycling([
      sample(0, { hvacPower: true }),
      sample(5, { hvacPower: false }),
    ]);

    expect(result.activeRunCount).toBe(1);
    expect(result.runs[0]?.complete).toBe(false);
    expect(result.runs[0]?.shortCycle).toBeNull();
    expect(result.completeOnRunCount).toBe(0);
    expect(result.qualifiedShortCycleRate).toBeNull();
    expect(result.shortCycleRate).toBeNull();
  });

  it('publishes run quantiles and a duration distribution without censoring claims', () => {
    const result = summarizeHvacCycling([
      sample(0, { hvacPower: false }),
      sample(5, { hvacPower: true }),
      sample(10, { hvacPower: false }),
      sample(20, { hvacPower: true }),
      sample(40, { hvacPower: false }),
      sample(70, { hvacPower: true }),
      sample(140, { hvacPower: false }),
    ], { maxGapS: 2 * 60 * 60 });

    expect(result.onRunQuantiles.count).toBe(3);
    expect(result.onRunQuantiles.medianS).toBe(1_200);
    expect(result.onRunQuantiles.p90S).toBe(4_200);
    expect(
      result.runLengthDistribution.reduce(
        (sum, bin) => sum + bin.onRuns,
        0,
      ),
    ).toBe(3);
  });
});

describe('summarizeHvacCycling coverage, hourly support, and ordering', () => {
  it('reports chronological coverage and cadence in SI seconds', () => {
    const result = summarizeHvacCycling([
      sample(30, { hvacPower: false }),
      sample(0, { hvacPower: false }),
      sample(5, { hvacPower: false }),
      sample(15, { hvacPower: false }),
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
    });
  });

  it('splits hourly duty and observed support at local hour boundaries', () => {
    const start = new Date(2026, 6, 1, 10, 30, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    const result = summarizeHvacCycling(
      [
        { timestamp: start.toISOString(), hvacPower: true },
        { timestamp: end.toISOString(), hvacPower: false },
      ],
      { maxGapS: 2 * 60 * 60 },
    );

    expect(result.hourlyProfile[start.getHours()]?.observedS).toBe(1_800);
    expect(result.hourlyProfile[end.getHours()]?.observedS).toBe(1_800);
    expect(
      result.hourlyProfile.reduce(
        (sum, bucket) => sum + bucket.observedS,
        0,
      ),
    ).toBe(3_600);
    expect(
      result.hourlyProfile.reduce(
        (sum, bucket) => sum + bucket.onS,
        0,
      ),
    ).toBe(3_600);
  });

  it('keeps chronological runs stable and caps a newest-first directory', () => {
    const rows = [
      sample(20, { hvacPower: false }),
      sample(0, { hvacPower: false }),
      sample(15, { hvacPower: true }),
      sample(5, { hvacPower: true }),
      sample(10, { hvacPower: false }),
      sample(25, { hvacPower: true }),
      sample(30, { hvacPower: false }),
    ];
    const first = summarizeHvacCycling(rows, { runDisplayLimit: 2 });
    const second = summarizeHvacCycling(rows, { runDisplayLimit: 2 });

    expect(first.runs.map((run) => run.startMs)).toEqual(
      [...first.runs.map((run) => run.startMs)].sort((a, b) => a - b),
    );
    expect(first.runDirectory).toMatchObject({
      total: 6,
      displayed: 2,
      omitted: 4,
      cap: 2,
    });
    expect(first.runDirectory.items.map((run) => run.startMs)).toEqual(
      [...first.runDirectory.items.map((run) => run.startMs)]
        .sort((a, b) => b - a),
    );
    expect(second.runs).toEqual(first.runs);
  });
});

describe('summarizeHvacCycling resilience', () => {
  it('validates every option and bounds the directory cap', () => {
    const invalid = summarizeHvacCycling([], {
      maxGapS: Number.NaN,
      shortCycleThresholdS: Number.NEGATIVE_INFINITY,
      runDisplayLimit: 0,
    });
    expect(invalid.thresholds).toEqual({
      maxGapS: DEFAULT_HVAC_MAX_GAP_S,
      shortCycleThresholdS: DEFAULT_HVAC_SHORT_CYCLE_THRESHOLD_S,
      runDisplayLimit: DEFAULT_HVAC_RUN_DISPLAY_LIMIT,
    });

    const bounded = summarizeHvacCycling([], {
      maxGapS: 25,
      shortCycleThresholdS: 12,
      runDisplayLimit: MAX_HVAC_RUN_DISPLAY_LIMIT + 1_000,
    });
    expect(bounded.thresholds).toEqual({
      maxGapS: 25,
      shortCycleThresholdS: 12,
      runDisplayLimit: MAX_HVAC_RUN_DISPLAY_LIMIT,
    });
    expect(
      summarizeHvacCycling([], { runDisplayLimit: 2.9 })
        .thresholds.runDisplayLimit,
    ).toBe(2);
    expect(
      summarizeHvacCycling(
        [],
        null as unknown as Parameters<typeof summarizeHvacCycling>[1],
      ).thresholds,
    ).toEqual(invalid.thresholds);
  });

  it('does not mutate source order or source rows', () => {
    const rows = [
      sample(10, { hvacPower: false }),
      sample(0, { hvacPower: true }),
      sample(5, {}),
    ];
    const before = structuredClone(rows);

    summarizeHvacCycling(rows);

    expect(rows).toEqual(before);
  });

  it('survives hostile rows while accounting for them honestly', () => {
    const hostile = [
      null,
      'row',
      { timestamp: {}, hvacPower: true },
      {
        timestamp: new Date(BASE).toISOString(),
        hvacPower: 'yes',
        isAcOn: 1,
        fanSpeed: Number.NaN,
      },
      {
        timestamp: new Date(BASE + 60_000).toISOString(),
        fanSpeed: 2,
      },
    ] as unknown as HvacSignalSample[];

    const result = summarizeHvacCycling(hostile);

    expect(result.rows).toMatchObject({
      returnedRows: 5,
      missingTimestampRows: 2,
      invalidTimestampRows: 1,
      uninterpretableStateRows: 1,
      validKnownStateRows: 1,
    });
    expect(result.identities.rowsBalanced).toBe(true);
    expect(result.intervals.unknownStateBarriers).toBe(1);
  });

  it('keeps all accounting identities true for empty evidence', () => {
    const result = summarizeHvacCycling([]);

    expect(result.rows.returnedRows).toBe(0);
    expect(result.observedS).toBe(0);
    expect(result.dutyCycle).toBeNull();
    expect(result.qualifiedShortCycleRate).toBeNull();
    expect(result.hourlyProfile).toHaveLength(24);
    expect(Object.values(result.identities).every(Boolean)).toBe(true);
  });
});
