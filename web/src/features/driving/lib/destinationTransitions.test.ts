import { describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';
import {
  buildDestinationTransitions,
  normalizeDestination,
  parseDestinationTimestamp,
} from './destinationTransitions';

const NOW = Date.parse('2026-02-10T12:00:00.000Z');
const HALF_HOUR_MS = 1_800_000;
let nextId = 1;

function driveAt(
  startTs: string,
  startAddress: string | null,
  endAddress: string | null,
  overrides: Partial<Drive> = {},
): Drive {
  const parsedStart = Date.parse(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(startTs)
      ? startTs
      : `${startTs}Z`,
  );
  const durationS = overrides.durationS ?? 1_800;
  const endTs =
    overrides.endTs === undefined
      ? new Date(parsedStart + HALF_HOUR_MS).toISOString()
      : overrides.endTs;
  return {
    id: nextId++,
    vehicleId: 1,
    startTs,
    endTs,
    durationS,
    distanceM: 10_000,
    startAddress,
    endAddress,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 1_800,
    regenEnergyWh: 200,
    avgSpeedMps: 12,
    maxSpeedMps: 25,
    avgPowerW: 4_000,
    outsideTempAvgC: 15,
    insideTempAvgC: 20,
    score: null,
    endedStatus: 'completed',
    createdAt: startTs,
    updatedAt: startTs,
    ...overrides,
    endTs,
  };
}

function driveAtHour(
  hour: number,
  startAddress: string | null,
  endAddress: string | null,
  overrides: Partial<Drive> = {},
): Drive {
  const startTs = new Date(
    Date.parse('2026-02-01T00:00:00.000Z')
      + hour * 3_600_000,
  ).toISOString();
  return driveAt(startTs, startAddress, endAddress, overrides);
}

function branchingSequence(): Drive[] {
  return [
    driveAtHour(0, 'Home', 'A'),
    driveAtHour(1, 'A', 'B'),
    driveAtHour(2, 'B', 'A'),
    driveAtHour(3, 'A', 'B'),
    driveAtHour(4, 'B', 'A'),
    driveAtHour(5, 'A', 'B'),
    driveAtHour(6, 'B', 'A'),
    driveAtHour(7, 'A', 'C'),
  ];
}

function analyze(
  drives: readonly Drive[],
  options: Parameters<typeof buildDestinationTransitions>[3] = {},
) {
  return buildDestinationTransitions(drives, NOW, 'UTC', options);
}

function expectFiniteNumbers(value: unknown): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(expectFiniteNumbers);
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(
      expectFiniteNumbers,
    );
  }
}

describe('destination location and timestamp normalization', () => {
  it('groups equivalent addresses and falls back to rounded coordinates', () => {
    const first = driveAtHour(0, 'Start', '  Work, HQ ');
    const second = driveAtHour(1, 'Start', 'WORK HQ');
    expect(normalizeDestination(first)?.key).toBe(
      normalizeDestination(second)?.key,
    );
    expect(normalizeDestination(first)?.label).toBe('Work, HQ');
    expect(
      normalizeDestination(
        driveAtHour(2, 'Start', null, {
          endLat: 10.1234,
          endLon: -20.9876,
        }),
      ),
    ).toEqual({
      key: 'geo:10.123,-20.988',
      label: '10.123, -20.988',
    });
    expect(
      normalizeDestination(
        driveAtHour(3, 'Start', null, {
          endLat: 91,
          endLon: 0,
        }),
      ),
    ).toBeNull();
  });

  it('parses offset-free API timestamps as UTC and rejects hostile dates', () => {
    expect(parseDestinationTimestamp('2026-02-01T10:15:00')).toBe(
      Date.parse('2026-02-01T10:15:00Z'),
    );
    expect(parseDestinationTimestamp('2026-02-01 10:15')).toBe(
      Date.parse('2026-02-01T10:15:00Z'),
    );
    expect(parseDestinationTimestamp('2026-02-30T10:15:00Z')).toBeNull();
    expect(parseDestinationTimestamp('2026-01-01T24:00:00Z')).toBeNull();
    expect(parseDestinationTimestamp('not-a-time')).toBeNull();
  });
});

describe('row accounting and continuity', () => {
  it('places every returned row in exactly one eligibility category', () => {
    const rows = [
      driveAtHour(0, 'Home', 'A'),
      driveAtHour(1, 'A', 'B', { endTs: null }),
      driveAtHour(2, 'B', 'C', { startTs: 'invalid' }),
      driveAtHour(3, 'C', 'D', {
        endTs: driveAtHour(2, 'X', 'Y').startTs,
      }),
      driveAt('2026-03-01T00:00:00Z', 'D', 'E'),
      driveAtHour(5, 'E', 'F', { durationS: 0 }),
      driveAtHour(6, 'F', null),
    ];
    const result = analyze(rows);
    const accounting = result.accounting;
    expect(accounting).toMatchObject({
      returnedRows: 7,
      includedRows: 1,
      excludedRows: 6,
      incompleteTimestampRows: 1,
      invalidTimestampOrOrderRows: 2,
      futureRows: 1,
      invalidDurationRows: 1,
      unlocatableEndDestinationRows: 1,
    });
    expect(
      accounting.includedRows
        + accounting.incompleteTimestampRows
        + accounting.invalidTimestampOrOrderRows
        + accounting.futureRows
        + accounting.invalidDurationRows
        + accounting.unlocatableEndDestinationRows,
    ).toBe(accounting.returnedRows);
  });

  it('keeps a placed unusable row as a sequence boundary', () => {
    const result = analyze([
      driveAtHour(0, 'Home', 'A'),
      driveAtHour(1, 'A', null),
      driveAtHour(2, 'A', 'B'),
    ]);
    expect(result.includedVisits).toBe(2);
    expect(result.acceptedTransitions).toBe(0);
    expect(result.continuity).toMatchObject({
      adjacentCandidatePairs: 2,
      excludedUnusableRowPairs: 2,
      excludedPairs: 2,
    });
  });

  it('does not bridge across a row whose start cannot be placed', () => {
    const result = analyze([
      driveAtHour(0, 'Home', 'A'),
      driveAtHour(1, 'A', null, { startTs: 'invalid' }),
      driveAtHour(2, 'A', 'B'),
    ]);
    expect(result.accounting.unplacedRows).toBe(1);
    expect(result.acceptedTransitions).toBe(0);
    expect(result.continuity.excludedUnusableRowPairs).toBe(1);
  });

  it('keeps valid source-order segments usable around an unplaced row', () => {
    const result = analyze([
      driveAtHour(0, 'Home', 'A'),
      driveAtHour(1, 'A', 'B'),
      driveAtHour(2, 'B', null, { startTs: 'invalid' }),
      driveAtHour(3, 'C', 'D'),
      driveAtHour(4, 'D', 'E'),
    ]);

    expect(result.accounting.unplacedRows).toBe(1);
    expect(result.continuity).toMatchObject({
      adjacentCandidatePairs: 3,
      acceptedTransitions: 2,
      excludedUnusableRowPairs: 1,
      excludedPairs: 1,
    });
    expect(result.edges.map((edge) => `${edge.fromLabel}→${edge.toLabel}`))
      .toEqual(['A→B', 'D→E']);
  });

  it('rejects the false Work-to-Gym edge when the next drive starts at Home', () => {
    const result = analyze([
      driveAtHour(0, 'Home', 'Work'),
      driveAtHour(1, 'Home', 'Gym'),
    ]);
    expect(result.acceptedTransitions).toBe(0);
    expect(result.continuity.excludedEndpointMismatchPairs).toBe(1);
    expect(result.edges).toEqual([]);
  });

  it('accepts close GPS endpoints and rejects the same pair below tolerance', () => {
    const rows = [
      driveAtHour(0, 'Home', 'West entrance', {
        endLat: 37,
        endLon: -122,
      }),
      driveAtHour(1, 'East entrance', 'Office', {
        startLat: 37.001,
        startLon: -122,
      }),
    ];
    expect(analyze(rows).acceptedTransitions).toBe(1);
    const strict = analyze(rows, { gpsToleranceM: 50 });
    expect(strict.acceptedTransitions).toBe(0);
    expect(strict.continuity.excludedEndpointMismatchPairs).toBe(1);
  });

  it('accounts for unlocatable starts, overlap, and configured long gaps', () => {
    const unlocatable = analyze([
      driveAtHour(0, 'Home', 'A'),
      driveAtHour(1, null, 'B'),
    ]);
    expect(
      unlocatable.continuity.excludedCurrentStartUnlocatablePairs,
    ).toBe(1);

    const overlap = analyze([
      driveAtHour(0, 'Home', 'A', {
        endTs: '2026-02-01T02:00:00.000Z',
      }),
      driveAtHour(1, 'A', 'B'),
    ]);
    expect(
      overlap.continuity.excludedOverlapOrNegativeGapPairs,
    ).toBe(1);

    const longGap = analyze(
      [
        driveAtHour(0, 'Home', 'A'),
        driveAtHour(10, 'A', 'B'),
      ],
      { maxContinuityGapMs: 2 * 3_600_000 },
    );
    expect(longGap.continuity.excludedLongGapPairs).toBe(1);
    expect(longGap.config.maxContinuityGapMs).toBe(7_200_000);
  });

  it('reconciles every adjacent candidate pair', () => {
    const result = analyze([
      driveAtHour(0, 'Home', 'A'),
      driveAtHour(1, 'A', 'B'),
      driveAtHour(2, 'Elsewhere', 'C'),
      driveAtHour(3, 'C', null),
    ]);
    expect(
      result.continuity.acceptedTransitions
        + result.continuity.excludedPairs,
    ).toBe(result.continuity.adjacentCandidatePairs);
  });
});

describe('descriptive transition evidence', () => {
  it('withholds a stale latest-state insight when the actual latest row is unknown', () => {
    const rows = branchingSequence();
    rows.push(driveAtHour(9, 'C', null));
    const result = analyze(rows);
    expect(result.latestRowCategory).toBe('unlocatable_end');
    expect(result.latestState).toBeNull();
  });

  it('labels a thin historical successor only from the actual latest state', () => {
    const result = analyze([
      driveAtHour(0, 'Home', 'A'),
      driveAtHour(1, 'A', 'B'),
      driveAtHour(2, 'B', 'A'),
    ]);
    expect(result.latestState?.label).toBe('A');
    expect(result.latestState?.supportedOrigin).toBe(false);
    expect(result.latestState?.supportBand).toBe('thin');
    expect(result.latestState?.historicalLeadingSuccessor).toMatchObject({
      toLabel: 'B',
      count: 1,
      outgoingTransitions: 1,
      observedShare: 1,
      supportedOrigin: false,
    });
  });

  it('separates a one-edge concentration from thin origin support', () => {
    const result = analyze([
      driveAtHour(0, 'Home', 'A'),
      driveAtHour(1, 'A', 'B'),
    ]);
    const origin = result.states.find((state) => state.label === 'A');
    const edge = result.edges[0];
    expect(origin?.transitionConcentrationIndex).toBe(100);
    expect(origin?.support.supported).toBe(false);
    expect(origin?.support.band).toBe('thin');
    expect(edge?.observedConditionalShare).toBe(1);
  });

  it('opens the default origin support gate at three outgoing transitions', () => {
    const result = analyze(branchingSequence());
    const originA = result.states.find((state) => state.label === 'A');
    expect(originA?.outgoingTransitions).toBe(4);
    expect(originA?.support.supported).toBe(true);
    const originB = result.states.find((state) => state.label === 'B');
    expect(originB?.outgoingTransitions).toBe(3);
    expect(originB?.support.supported).toBe(true);
  });

  it('uses distinct observed successors in the concentration denominator', () => {
    const base = analyze(branchingSequence());
    const expanded = analyze([
      ...branchingSequence(),
      driveAtHour(20, 'Detached', 'X'),
      driveAtHour(21, 'Unknown', null),
      driveAtHour(22, 'Detached', 'Y'),
    ]);
    const baseA = base.states.find((state) => state.label === 'A');
    const expandedA = expanded.states.find((state) => state.label === 'A');
    const expectedEntropy =
      -(0.75 * Math.log2(0.75) + 0.25 * Math.log2(0.25));
    expect(baseA?.entropyBits).toBeCloseTo(expectedEntropy);
    expect(baseA?.transitionConcentrationIndex).toBeCloseTo(
      100 * (1 - expectedEntropy),
    );
    expect(expandedA?.transitionConcentrationIndex).toBeCloseTo(
      baseA?.transitionConcentrationIndex ?? -1,
    );
  });

  it('computes empirical edge shares and information content', () => {
    const result = analyze(branchingSequence());
    const edgeAB = result.edges.find(
      (edge) => edge.fromLabel === 'A' && edge.toLabel === 'B',
    );
    const edgeAC = result.edges.find(
      (edge) => edge.fromLabel === 'A' && edge.toLabel === 'C',
    );
    expect(edgeAB?.count).toBe(3);
    expect(edgeAB?.observedConditionalShare).toBeCloseTo(0.75);
    expect(edgeAC?.observedConditionalShare).toBeCloseTo(0.25);
    expect(edgeAC?.empiricalInformationBits).toBeCloseTo(2);
  });

  it('uses stable key ordering for tied edges', () => {
    const result = analyze([
      driveAtHour(0, 'Home', 'A'),
      driveAtHour(1, 'A', 'C'),
      driveAtHour(2, 'C', 'A'),
      driveAtHour(3, 'A', 'B'),
    ]);
    const aEdges = result.edges.filter((edge) => edge.fromLabel === 'A');
    expect(aEdges.map((edge) => edge.toLabel)).toEqual(['B', 'C']);
  });
});

describe('calendar, coverage, and resilience', () => {
  it('buckets transitions in the selected vehicle timezone', () => {
    const rows = [
      driveAt('2026-01-05T23:00:00.000Z', 'Home', 'A'),
      driveAt('2026-01-06T00:30:00.000Z', 'A', 'B'),
    ];
    const result = buildDestinationTransitions(
      rows,
      NOW,
      'America/Los_Angeles',
    );
    expect(
      result.twoHourProfile.find((point) => point.samples === 1)
        ?.bucketStartHour,
    ).toBe(16);
    expect(
      result.weekdayProfile.find((point) => point.samples === 1)?.weekday,
    ).toBe(1);
    expect(result.monthTrend[0]?.monthKey).toBe('2026-01');
  });

  it('falls back to UTC for an invalid timezone', () => {
    const result = buildDestinationTransitions([], NOW, 'Mars/Olympus');
    expect(result.timeZone).toBe('UTC');
  });

  it('reports cap, spans, and recency from the injected clock', () => {
    const first = driveAt(
      '2026-02-01T00:00:00.000Z',
      'Home',
      'A',
    );
    const second = driveAt(
      '2026-02-03T00:00:00.000Z',
      'Detached',
      'B',
    );
    const result = buildDestinationTransitions(
      [first, second],
      Date.parse('2026-02-05T00:30:00.000Z'),
      'UTC',
      { historyLimit: 2 },
    );
    expect(result.accounting.historyCapReached).toBe(true);
    expect(result.evidence.includedSpanDays).toBeCloseTo(2);
    expect(result.evidence.daysSinceLastIncludedVisit).toBeCloseTo(2);
  });

  it('is null-safe for zero and one row', () => {
    const empty = analyze([]);
    expect(empty.acceptedTransitions).toBe(0);
    expect(empty.evidence.transitionConcentrationIndex).toBeNull();
    expect(empty.latestState).toBeNull();

    const single = analyze([driveAtHour(0, 'Home', 'A')]);
    expect(single.includedVisits).toBe(1);
    expect(single.continuity.adjacentCandidatePairs).toBe(0);
    expect(single.latestState?.label).toBe('A');
    expect(single.latestState?.historicalLeadingSuccessor).toBeNull();
  });

  it('does not mutate input or nested drive values', () => {
    const input = branchingSequence();
    const before = structuredClone(input);
    analyze(input);
    expect(input).toEqual(before);
  });

  it('sanitizes hostile options and emits no nonfinite numeric output', () => {
    const result = buildDestinationTransitions(
      [driveAtHour(0, 'Home', 'A')],
      Number.NaN,
      'Invalid/Zone',
      {
        historyLimit: -4,
        gpsToleranceM: Number.POSITIVE_INFINITY,
        maxContinuityGapMs: Number.NEGATIVE_INFINITY,
        minSupportedOriginTransitions: 1,
        strongOriginTransitions: Number.NaN,
        strongOriginActiveDays: -1,
        strongOriginActiveWeeks: 0,
        strongTemporalSamples: Number.POSITIVE_INFINITY,
        topMatrixStateLimit: -2,
      },
    );
    expect(result.config).toMatchObject({
      historyLimit: 1_000,
      gpsToleranceM: 250,
      maxContinuityGapMs: null,
      minSupportedOriginTransitions: 3,
      strongOriginTransitions: 12,
      strongOriginActiveDays: 8,
      strongOriginActiveWeeks: 6,
      strongTemporalSamples: 12,
      topMatrixStateLimit: 8,
    });
    expect(result.timeZone).toBe('UTC');
    expectFiniteNumbers(result);
  });
});
