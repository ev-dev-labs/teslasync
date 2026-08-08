import { describe, it, expect } from 'vitest';
import {
  CABIN_ROW_EXCLUSION_REASONS,
  CANDIDATE_REJECTION_REASONS,
  buildSoakCurve,
  fitSoakEvents,
  minutesToReach,
  predictCabinTemp,
  summarizeCabinThermal,
  type CabinSample,
} from './cabinThermal';

const BASE = Date.UTC(2026, 5, 1, 12, 0, 0);

/**
 * A synthetic soak: cabin relaxing from `startC` toward `ambientC` with a
 * known time constant, sampled every `stepMin`.
 */
function soak(opts: {
  startMinOffset: number;
  startC: number;
  ambientC: number;
  tauMin: number;
  points: number;
  stepMin?: number;
  hvacOn?: boolean;
}): CabinSample[] {
  const { startMinOffset, startC, ambientC, tauMin, points, stepMin = 10, hvacOn = false } = opts;
  return Array.from({ length: points }, (_, i) => {
    const t = i * stepMin;
    return {
      timestamp: new Date(BASE + (startMinOffset + t) * 60_000).toISOString(),
      insideTemp: ambientC + (startC - ambientC) * Math.exp(-t / tauMin),
      outsideTemp: ambientC,
      isAcOn: hvacOn,
      hvacPower: hvacOn,
    };
  });
}

function gaps(
  values: readonly number[],
  startMinOffset = 0,
  ambientC = 20,
  stepMin = 10,
): CabinSample[] {
  return values.map((gap, index) => ({
    timestamp: new Date(
      BASE + (startMinOffset + index * stepMin) * 60_000,
    ).toISOString(),
    insideTemp: ambientC + gap,
    outsideTemp: ambientC,
    isAcOn: false,
    hvacPower: false,
  }));
}

describe('fitSoakEvents', () => {
  it('recovers a known time constant', () => {
    const { events } = fitSoakEvents(
      soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 12 }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.tauMin).toBeGreaterThan(85);
    expect(events[0]!.tauMin).toBeLessThan(95);
    expect(events[0]!.r2).toBeGreaterThan(0.99);
    expect(events[0]!.cooling).toBe(true);
  });

  it('recognises a warming cabin as its own regime', () => {
    const { events } = fitSoakEvents(
      soak({ startMinOffset: 0, startC: -5, ambientC: 15, tauMin: 60, points: 12 }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.cooling).toBe(false);
    expect(events[0]!.tauMin).toBeGreaterThan(55);
  });

  it('never fits a window where the HVAC was running', () => {
    const { events, rejected } = fitSoakEvents(
      soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 12, hvacOn: true }),
    );
    expect(events).toHaveLength(0);
    expect(rejected).toBe(0);
  });

  it('treats canonical hvacPower=true as running without an AC signal', () => {
    const samples = soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 12 })
      .map((s) => ({ ...s, isAcOn: false, hvacPower: true }));
    expect(fitSoakEvents(samples).events).toHaveLength(0);
  });

  it('keeps unknown HVAC state out of candidate evidence', () => {
    const samples = soak({
      startMinOffset: 0,
      startC: 40,
      ambientC: 20,
      tauMin: 90,
      points: 12,
    }).map(({ hvacPower: _hvacPower, isAcOn: _isAcOn, ...sample }) => sample);
    const summary = summarizeCabinThermal(samples);

    expect(summary.events).toHaveLength(0);
    expect(summary.candidates).toHaveLength(0);
    expect(summary.coverage).toMatchObject({
      hvacOnSamples: 0,
      hvacOffSamples: 0,
      hvacUnknownSamples: 12,
      hvacOnRuns: 0,
      hvacUnknownRuns: 1,
    });
    expect(summary.accounting).toMatchObject({
      normalizedRows: 12,
      hvacUnknownRows: 12,
      candidateSampleRows: 0,
    });
  });

  it('splits windows across an HVAC-on interruption', () => {
    const samples: CabinSample[] = [
      ...soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 8 }),
      ...soak({ startMinOffset: 80, startC: 34, ambientC: 20, tauMin: 90, points: 3, hvacOn: true }),
      ...soak({ startMinOffset: 200, startC: 34, ambientC: 20, tauMin: 70, points: 8 }),
    ];
    const { events } = fitSoakEvents(samples);
    expect(events).toHaveLength(2);
    expect(events[0]!.tauMin).not.toBe(events[1]!.tauMin);
  });

  it('splits windows across a long sampling gap', () => {
    const samples: CabinSample[] = [
      ...soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 8 }),
      ...soak({ startMinOffset: 500, startC: 38, ambientC: 20, tauMin: 90, points: 8 }),
    ];
    expect(fitSoakEvents(samples).events).toHaveLength(2);
  });

  it('rejects windows that are too short or too flat', () => {
    const short = soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 4, stepMin: 2 });
    const flat = soak({ startMinOffset: 0, startC: 21, ambientC: 20, tauMin: 90, points: 12 });
    expect(fitSoakEvents(short).events).toHaveLength(0);
    expect(fitSoakEvents(flat).events).toHaveLength(0);
  });

  it('rejects a cabin heating away from ambient (solar gain)', () => {
    const climbing: CabinSample[] = Array.from({ length: 12 }, (_, i) => ({
      timestamp: new Date(BASE + i * 10 * 60_000).toISOString(),
      insideTemp: 25 + i * 1.5,
      outsideTemp: 20,
      isAcOn: false,
      hvacPower: false,
    }));
    const { events, rejected } = fitSoakEvents(climbing);
    expect(events).toHaveLength(0);
    expect(rejected).toBe(1);
  });

  it('ignores rows with missing temperatures or timestamps', () => {
    const junk: CabinSample[] = [
      { timestamp: null, insideTemp: 30, outsideTemp: 20 },
      { timestamp: 'nope', insideTemp: 30, outsideTemp: 20 },
      { timestamp: new Date(BASE).toISOString(), insideTemp: null, outsideTemp: 20 },
      { created_at: new Date(BASE).toISOString(), insideTemp: 30, outsideTemp: null },
    ];
    const { analyzed, events } = fitSoakEvents(junk);
    expect(analyzed).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('accepts created_at as the timestamp field', () => {
    const samples = soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 12 })
      .map(({ timestamp, ...rest }) => ({ ...rest, created_at: timestamp }));
    expect(fitSoakEvents(samples).events).toHaveLength(1);
  });
});

describe('summarizeCabinThermal', () => {
  it('is fully null-safe with no data', () => {
    const s = summarizeCabinThermal([]);
    expect(s.tauMin).toBeNull();
    expect(s.halfLifeMin).toBeNull();
    expect(s.meanR2).toBeNull();
    expect(s.events).toEqual([]);
  });

  it('medians the fitted constants and separates the two regimes', () => {
    const samples: CabinSample[] = [
      ...soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 60, points: 10 }),
      ...soak({ startMinOffset: 400, startC: 42, ambientC: 20, tauMin: 100, points: 10 }),
      ...soak({ startMinOffset: 800, startC: -5, ambientC: 15, tauMin: 40, points: 10 }),
    ];
    const s = summarizeCabinThermal(samples);
    expect(s.events).toHaveLength(3);
    expect(s.coolingTauMin).toBe(80);
    expect(s.warmingTauMin).toBeGreaterThan(35);
    expect(s.warmingTauMin).toBeLessThan(45);
    expect(s.halfLifeMin).toBe(Math.round(s.tauMin! * Math.LN2));
  });

  it('accounts for every returned row with one mutually exclusive outcome', () => {
    const validTs = new Date(BASE + 10 * 60_000).toISOString();
    const rows: CabinSample[] = [
      { insideTemp: 30, outsideTemp: 20 },
      { timestamp: 'not-a-date', insideTemp: 30, outsideTemp: 20 },
      { timestamp: new Date(BASE + 1).toISOString(), insideTemp: null, outsideTemp: 20 },
      { timestamp: new Date(BASE + 2).toISOString(), insideTemp: Number.NaN, outsideTemp: 20 },
      { timestamp: new Date(BASE + 3).toISOString(), insideTemp: 30, outsideTemp: null },
      { timestamp: new Date(BASE + 4).toISOString(), insideTemp: 30, outsideTemp: Number.POSITIVE_INFINITY },
      { timestamp: validTs, insideTemp: 30, outsideTemp: 20 },
      { timestamp: validTs, insideTemp: 31, outsideTemp: 20 },
    ];

    const summary = summarizeCabinThermal(rows);
    expect(summary.accounting).toMatchObject({
      returnedRows: 8,
      excludedRows: 7,
      normalizedRows: 1,
    });
    for (const reason of CABIN_ROW_EXCLUSION_REASONS) {
      expect(summary.rowExclusions[reason]).toBe(1);
    }
    expect(
      summary.accounting.normalizedRows + summary.rowExclusions.total,
    ).toBe(summary.accounting.returnedRows);
    expect(summary.normalizedSamples[0]?.insideC).toBe(30);
  });

  it.each([
    [
      'insufficient_samples',
      gaps([10, 9, 8]),
    ],
    [
      'below_minimum_duration',
      gaps([10, 9, 8, 7], 0, 20, 5),
    ],
    [
      'initial_gap_below_threshold',
      gaps([1, 0.9, 0.8, 0.7]),
    ],
    [
      'ambient_crossing',
      gaps([10, 6, 0, -1]),
    ],
    [
      'regression_unavailable',
      gaps([10, 10, 10, 10]),
    ],
    [
      'non_relaxing_gap',
      gaps([5, 6, 7, 8]),
    ],
    [
      'r2_below_gate',
      gaps([10, 5, 9, 4, 7, 3]),
    ],
    [
      'invalid_tau',
      soak({
        startMinOffset: 0,
        startC: 40,
        ambientC: 20,
        tauMin: 2_000,
        points: 12,
      }),
    ],
  ] as const)('assigns exactly the %s rejection reason', (reason, rows) => {
    const summary = summarizeCabinThermal(rows);
    expect(summary.candidates).toHaveLength(1);
    expect(summary.candidates[0]?.reason).toBe(reason);
    expect(summary.accounting.acceptedFits).toBe(0);
    expect(summary.accounting.rejectedCandidates).toBe(1);
    expect(
      summary.rejectionReasonCounts.find((item) => item.reason === reason)?.count,
    ).toBe(1);
  });

  it('exposes every rejection category in stable gate order, including zeroes', () => {
    const summary = summarizeCabinThermal([]);
    expect(summary.rejectionReasonCounts.map((item) => item.reason)).toEqual(
      CANDIDATE_REJECTION_REASONS,
    );
    expect(summary.rejectionReasonCounts.every((item) => item.count === 0)).toBe(true);
  });

  it('retains candidate details even when an early gate rejects the window', () => {
    const candidate = summarizeCabinThermal(
      gaps([10, 9, 8], 0),
    ).candidates[0]!;

    expect(candidate).toMatchObject({
      samples: 3,
      durationMin: 20,
      ambientC: 20,
      initialGapC: 10,
      direction: 'cooling',
      disposition: 'rejected',
      reason: 'insufficient_samples',
    });
    expect(candidate.startTs).toBe(new Date(BASE).toISOString());
    expect(candidate.endTs).toBe(new Date(BASE + 20 * 60_000).toISOString());
  });

  it('exposes the exact resolved thresholds used by the fit', () => {
    const summary = summarizeCabinThermal([], {
      maxGapMin: 30,
      minDurationMin: 15,
      minSamples: 5,
      minDeltaC: 4,
      minR2: 0.9,
      candidateDisplayCap: 7,
    });

    expect(summary.thresholds).toMatchObject({
      maxGapMin: 30,
      minDurationMin: 15,
      minSamples: 5,
      minDeltaC: 4,
      minR2: 0.9,
      candidateDisplayCap: 7,
    });
  });

  it('keeps candidate and rejection identities exact', () => {
    const rows: CabinSample[] = [
      ...gaps([10, 9, 8], 0),
      ...gaps([1, 0.9, 0.8, 0.7], 200),
      ...soak({
        startMinOffset: 400,
        startC: 40,
        ambientC: 20,
        tauMin: 90,
        points: 10,
      }),
    ];
    const summary = summarizeCabinThermal(rows);
    const rejectionTotal = summary.rejectionReasonCounts.reduce(
      (sum, item) => sum + item.count,
      0,
    );

    expect(summary.accounting.candidateWindows).toBe(3);
    expect(summary.accounting.acceptedFits).toBe(1);
    expect(summary.accounting.rejectedCandidates).toBe(2);
    expect(rejectionTotal).toBe(summary.accounting.rejectedCandidates);
    expect(
      summary.accounting.acceptedFits + summary.accounting.rejectedCandidates,
    ).toBe(summary.accounting.candidateWindows);
    expect(summary.acceptanceFunnel.at(-1)?.count).toBe(1);
  });

  it('sorts deterministically, keeps the first duplicate, and never mutates input', () => {
    const firstTs = new Date(BASE).toISOString();
    const later = gaps([10, 9, 8, 7], 200);
    const earlier = gaps([10, 9, 8, 7], 0);
    const duplicateFirst: CabinSample = Object.freeze({
      timestamp: firstTs,
      insideTemp: 30,
      outsideTemp: 20,
      isAcOn: false,
      hvacPower: false,
    });
    const duplicateSecond: CabinSample = Object.freeze({
      timestamp: firstTs,
      insideTemp: 99,
      outsideTemp: 20,
      isAcOn: false,
      hvacPower: false,
    });
    const input = Object.freeze([
      ...later.map((row) => Object.freeze(row)),
      duplicateFirst,
      duplicateSecond,
      ...earlier.slice(1).map((row) => Object.freeze(row)),
    ]);
    const originalOrder = input.map((row) => row.timestamp);

    const first = summarizeCabinThermal(input);
    const second = summarizeCabinThermal(input);

    expect(first.candidates.map((candidate) => candidate.startMs)).toEqual([
      BASE,
      BASE + 200 * 60_000,
    ]);
    expect(first.normalizedSamples[0]?.insideC).toBe(30);
    expect(first).toEqual(second);
    expect(input.map((row) => row.timestamp)).toEqual(originalOrder);
  });

  it('caps the newest-first candidate directory with an exact omission count', () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      gaps([1, 0.9, 0.8, 0.7], index * 200),
    ).flat();
    const summary = summarizeCabinThermal(rows, { candidateDisplayCap: 2 });

    expect(summary.candidates.map((candidate) => candidate.index)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(summary.candidateDirectory.items.map((candidate) => candidate.index)).toEqual([
      5, 4,
    ]);
    expect(summary.candidateDirectory).toMatchObject({
      total: 5,
      displayed: 2,
      omitted: 3,
      cap: 2,
    });
  });

  it('turns an 83-window all-rejected payload into reasoned evidence', () => {
    const rows = Array.from({ length: 83 }, (_, index) =>
      gaps([1.5, 1.4, 1.3, 1.2], index * 120),
    ).flat();
    const summary = summarizeCabinThermal(rows);

    expect(summary.accounting).toMatchObject({
      candidateWindows: 83,
      acceptedFits: 0,
      rejectedCandidates: 83,
    });
    expect(summary.tauMin).toBeNull();
    expect(
      summary.rejectionReasonCounts.find(
        (item) => item.reason === 'initial_gap_below_threshold',
      )?.count,
    ).toBe(83);
    expect(summary.candidateDirectory.displayed).toBe(50);
    expect(summary.candidateDirectory.omitted).toBe(33);
  });

  it('reports source cadence, HVAC boundaries, and long-gap segmentation', () => {
    const rows: CabinSample[] = [
      ...gaps([10, 9, 8, 7], 0),
      {
        ...gaps([6], 40)[0]!,
        hvacPower: true,
      },
      {
        ...gaps([5], 50)[0]!,
        hvacPower: true,
      },
      ...gaps([10, 9, 8, 7], 200),
    ];
    const coverage = summarizeCabinThermal(rows).coverage;

    expect(coverage.hvacOnSamples).toBe(2);
    expect(coverage.hvacOffSamples).toBe(8);
    expect(coverage.hvacUnknownSamples).toBe(0);
    expect(coverage.hvacOnRuns).toBe(1);
    expect(coverage.hvacUnknownRuns).toBe(0);
    expect(coverage.hvacBoundaryCount).toBe(1);
    expect(coverage.longGapCount).toBe(1);
    expect(coverage.longGapSegments).toBe(2);
    expect(coverage.medianCadenceMin).toBe(10);
    expect(coverage.maxObservedGapMin).toBe(150);
  });

  it('handles hostile runtime field types and nonfinite values without throwing', () => {
    const hostile: CabinSample[] = [
      { timestamp: 123, insideTemp: 30, outsideTemp: 20 },
      { timestamp: new Date(BASE).toISOString(), insideTemp: '30', outsideTemp: 20 },
      { timestamp: new Date(BASE + 1).toISOString(), insideTemp: 30, outsideTemp: '-Infinity' },
      { created_at: new Date(BASE + 2).toISOString(), insideTemp: Number.NEGATIVE_INFINITY, outsideTemp: 20 },
    ];
    const summary = summarizeCabinThermal(hostile);

    expect(summary.accounting.returnedRows).toBe(4);
    expect(summary.accounting.normalizedRows).toBe(0);
    expect(summary.rowExclusions.invalid_timestamp).toBe(1);
    expect(summary.rowExclusions.nonfinite_inside_temperature).toBe(2);
    expect(summary.rowExclusions.nonfinite_outside_temperature).toBe(1);
  });
});

describe('predictCabinTemp', () => {
  it('decays toward ambient by one time constant', () => {
    // After exactly τ the remaining gap is 1/e of the original.
    expect(predictCabinTemp(40, 20, 60, 60)).toBeCloseTo(20 + 20 / Math.E, 6);
  });

  it('returns the current temperature for a degenerate tau', () => {
    expect(predictCabinTemp(40, 20, 0, 60)).toBe(40);
    expect(predictCabinTemp(40, 20, Number.NaN, 60)).toBe(40);
  });
});

describe('minutesToReach', () => {
  it('inverts the exponential', () => {
    expect(minutesToReach(40, 20, 60, 30)).toBe(Math.round(60 * Math.LN2));
  });

  it('returns null for an unreachable target', () => {
    // Cooling toward 20 °C can never reach 15 °C.
    expect(minutesToReach(40, 20, 60, 15)).toBeNull();
    // Nor can it get further away.
    expect(minutesToReach(40, 20, 60, 45)).toBeNull();
  });

  it('returns 0 when already at ambient', () => {
    expect(minutesToReach(20, 20, 60, 20)).toBe(0);
  });
});

describe('buildSoakCurve', () => {
  it('samples the horizon at the requested step', () => {
    const curve = buildSoakCurve(40, 20, 60, 120, 30);
    expect(curve.map((p) => p.minutes)).toEqual([0, 30, 60, 90, 120]);
    expect(curve[0]!.cabinC).toBe(40);
    expect(curve[4]!.cabinC).toBeLessThan(curve[0]!.cabinC);
  });

  it('returns an empty curve for degenerate inputs', () => {
    expect(buildSoakCurve(40, 20, 0, 120)).toEqual([]);
    expect(buildSoakCurve(40, 20, 60, 120, 0)).toEqual([]);
  });
});
