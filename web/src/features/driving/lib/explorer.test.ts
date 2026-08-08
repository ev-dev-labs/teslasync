import { beforeEach, describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';

import {
  EXPLORER_HISTORY_LIMIT,
  MIN_DISCOVERIES_FOR_CADENCE,
  haversineM,
  summarizeExplorer,
} from './explorer';

let nextId = 1;

function driveTo(
  endLat: number | null,
  endLon: number | null,
  overrides: Partial<Drive> = {},
): Drive {
  const day = String(((nextId - 1) % 27) + 1).padStart(2, '0');
  const startTs = `2026-01-${day}T08:00:00.000Z`;
  const endTs = `2026-01-${day}T08:30:00.000Z`;
  return {
    id: nextId++,
    vehicleId: 1,
    startTs,
    endTs,
    durationS: 1_800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: 37,
    startLon: -122,
    endLat,
    endLon,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 2_000,
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

const BASE: [number, number] = [37, -122];

beforeEach(() => {
  nextId = 1;
});

describe('haversineM', () => {
  it('stays symmetric and returns SI-canonical meters', () => {
    expect(haversineM(37, -122, 37, -122)).toBe(0);
    const forward = haversineM(37, -122, 38, -122);
    expect(forward).toBeGreaterThan(105_000);
    expect(forward).toBeLessThan(118_000);
    expect(haversineM(38, -122, 37, -122)).toBeCloseTo(forward);
  });
});

describe('summarizeExplorer', () => {
  it('clusters nearby arrivals and keeps raw coordinates private', () => {
    const summary = summarizeExplorer([
      driveTo(...BASE, { endAddress: 'Observed base' }),
      driveTo(...BASE),
      driveTo(...BASE),
      driveTo(37.5011, -122.5012, { endAddress: 'Cabin' }),
      driveTo(37.5014, -122.5008),
    ]);

    expect(summary.inferredBase).toMatchObject({
      label: 'Observed base',
      visits: 3,
    });
    expect(summary.evidence.baseSufficient).toBe(true);
    expect(summary.uniquePlaces).toBe(1);
    expect(summary.destinations[0]).toMatchObject({
      label: 'Cabin',
      visits: 2,
      repeatVisits: 1,
    });
    expect(summary.destinations[0]).not.toHaveProperty('lat');
    expect(summary.destinations[0]).not.toHaveProperty('lon');
    expect(summary.inferredBase).not.toHaveProperty('lat');
    expect(summary.inferredBase).not.toHaveProperty('lon');
  });

  it('accounts for every timestamp and coordinate exclusion deterministically', () => {
    const summary = summarizeExplorer([
      driveTo(...BASE),
      driveTo(...BASE, {
        endTs: null,
        startTs: '2026-01-02T08:00:00.000Z',
      }),
      driveTo(...BASE, { endTs: null, startTs: '' }),
      driveTo(...BASE, { endTs: 'bad-end', startTs: 'bad-start' }),
      driveTo(null, null),
      driveTo(Number.NaN, -122),
      driveTo(91, -122),
    ]);

    expect(summary.eligibility).toMatchObject({
      observed: 7,
      eligible: 2,
      excluded: 5,
      timestampEligible: 5,
      coordinateEligible: 4,
      usedEndTimestamp: 1,
      usedStartTimestamp: 1,
      exclusions: {
        missingTimestamp: 1,
        invalidTimestamp: 1,
        missingCoordinates: 1,
        invalidCoordinates: 1,
        outOfRangeCoordinates: 1,
      },
    });
    expect(summary.eligibility.eligibleShare).toBeCloseTo(2 / 7);
    expect(
      Object.values(summary.eligibility.exclusions).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(summary.eligibility.excluded);
  });

  it('prefers arrival timestamps and rolls up monthly new and repeat behavior', () => {
    const summary = summarizeExplorer([
      driveTo(...BASE, { endTs: '2026-01-01T09:00:00.000Z' }),
      driveTo(...BASE, { endTs: '2026-01-02T09:00:00.000Z' }),
      driveTo(...BASE, { endTs: '2026-01-03T09:00:00.000Z' }),
      driveTo(37.5, -122.5, {
        startTs: '2025-12-31T23:00:00.000Z',
        endTs: '2026-01-10T09:00:00.000Z',
      }),
      driveTo(37.5, -122.5, { endTs: '2026-02-11T09:00:00.000Z' }),
      driveTo(38.5, -121.5, { endTs: '2026-02-15T09:00:00.000Z' }),
      driveTo(38.5, -121.5, { endTs: '2026-02-20T09:00:00.000Z' }),
    ]);

    expect(summary.monthlyExploration).toEqual([
      {
        month: '2026-01',
        newPlaces: 1,
        repeatArrivals: 0,
        destinationArrivals: 1,
        cumulativePlaces: 1,
        newArrivalShare: 1,
      },
      {
        month: '2026-02',
        newPlaces: 1,
        repeatArrivals: 2,
        destinationArrivals: 3,
        cumulativePlaces: 2,
        newArrivalShare: 1 / 3,
      },
    ]);
    expect(summary.repeatBehavior).toMatchObject({
      destinationArrivals: 4,
      newArrivals: 2,
      repeatArrivals: 2,
      newShare: 0.5,
      repeatShare: 0.5,
    });
    expect(summary.evidence.behaviorSufficient).toBe(true);
  });

  it('builds visit-weighted radius bands and deterministic rankings', () => {
    const drives = [
      driveTo(0, 0, { endAddress: 'Base' }),
      driveTo(0, 0),
      driveTo(0, 0),
      driveTo(0.01, 0, { endAddress: 'Local' }),
      driveTo(0.01, 0),
      driveTo(0.1, 0, { endAddress: 'Near' }),
      driveTo(0.5, 0, { endAddress: 'Regional' }),
      driveTo(1.5, 0, { endAddress: 'Far' }),
    ];
    const summary = summarizeExplorer(drives);

    expect(summary.radiusM).toBeGreaterThan(160_000);
    expect(summary.farthest?.label).toBe('Far');
    expect(
      summary.distanceBands.map((band) => [
        band.key,
        band.destinations,
        band.arrivals,
      ]),
    ).toEqual([
      ['local', 1, 2],
      ['near', 1, 1],
      ['regional', 1, 1],
      ['far', 1, 1],
    ]);
    expect(
      summary.distanceBands.reduce(
        (sum, band) => sum + (band.arrivalShare ?? 0),
        0,
      ),
    ).toBeCloseTo(1);
    expect(summary.farthestRanking.map((item) => item.label)).toEqual([
      'Far',
      'Regional',
      'Near',
      'Local',
    ]);
    expect(summary.rareRanking.map((item) => item.label)).toEqual([
      'Far',
      'Regional',
      'Near',
      'Local',
    ]);
    expect(summarizeExplorer([...drives].reverse())).toEqual(summary);
  });

  it('breaks base-frequency ties by first arrival rather than input order', () => {
    const firstBase = driveTo(37, -122, {
      endTs: '2026-01-01T09:00:00.000Z',
      endAddress: 'Earlier cluster',
    });
    const laterBaseVisit = driveTo(37, -122, {
      endTs: '2026-01-04T09:00:00.000Z',
    });
    const destinationA = driveTo(38, -122, {
      endTs: '2026-01-02T09:00:00.000Z',
      endAddress: 'Later cluster',
    });
    const destinationB = driveTo(38, -122, {
      endTs: '2026-01-03T09:00:00.000Z',
    });
    const drives = [destinationB, laterBaseVisit, destinationA, firstBase];

    const summary = summarizeExplorer(drives);
    expect(summary.inferredBase?.label).toBe('Earlier cluster');
    expect(summary.destinations[0]?.label).toBe('Later cluster');
    expect(summarizeExplorer([...drives].reverse())).toEqual(summary);
  });

  it('withholds base-relative claims until minimum evidence is met', () => {
    const summary = summarizeExplorer([
      driveTo(37, -122),
      driveTo(38, -122),
      driveTo(39, -122),
      driveTo(40, -122),
    ]);

    expect(summary.evidence.baseSufficient).toBe(false);
    expect(summary.evidence.behaviorSufficient).toBe(false);
    expect(summary.evidence.cadenceSufficient).toBe(false);
    expect(summary.evidence.rankingSufficient).toBe(false);
    expect(summary.radiusM).toBeNull();
    expect(summary.farthest).toBeNull();
    expect(summary.farthestRanking).toEqual([]);
    expect(summary.rareRanking).toEqual([]);
    expect(summary.distanceBands.every((band) => band.arrivals === 0)).toBe(
      true,
    );
    expect(summary.uniquePlaces).toBe(4);
    expect(summary.destinations).toHaveLength(4);
    expect(summary.repeatBehavior).toMatchObject({
      destinationArrivals: 4,
      newArrivals: 4,
      repeatArrivals: 0,
    });
    expect(summary.monthlyExploration).toEqual([
      expect.objectContaining({
        newPlaces: 4,
        destinationArrivals: 4,
        cumulativePlaces: 4,
      }),
    ]);
  });

  it('requires three discoveries before reporting cadence intervals', () => {
    const thin = summarizeExplorer([
      driveTo(...BASE, { endTs: '2026-01-01T09:00:00.000Z' }),
      driveTo(...BASE, { endTs: '2026-01-02T09:00:00.000Z' }),
      driveTo(...BASE, { endTs: '2026-01-03T09:00:00.000Z' }),
      driveTo(38, -122, { endTs: '2026-01-10T09:00:00.000Z' }),
      driveTo(39, -122, { endTs: '2026-01-20T09:00:00.000Z' }),
    ]);
    expect(thin.cadence.discoveries).toBe(
      MIN_DISCOVERIES_FOR_CADENCE - 1,
    );
    expect(thin.evidence.cadenceSufficient).toBe(false);
    expect(thin.cadence.medianGapDays).toBeNull();

    const sufficient = summarizeExplorer([
      ...[
        driveTo(...BASE, { endTs: '2026-01-01T09:00:00.000Z' }),
        driveTo(...BASE, { endTs: '2026-01-02T09:00:00.000Z' }),
        driveTo(...BASE, { endTs: '2026-01-03T09:00:00.000Z' }),
      ],
      driveTo(38, -122, { endTs: '2026-01-10T09:00:00.000Z' }),
      driveTo(39, -122, { endTs: '2026-01-20T09:00:00.000Z' }),
      driveTo(40, -122, { endTs: '2026-02-09T09:00:00.000Z' }),
    ]);
    expect(sufficient.evidence.cadenceSufficient).toBe(true);
    expect(sufficient.cadence).toMatchObject({
      discoveries: 3,
      observedIntervals: 2,
      medianGapDays: 15,
      longestGapDays: 20,
      latestGapDays: 20,
    });
  });

  it('detects the bounded history cap and returns complete empty evidence', () => {
    const empty = summarizeExplorer([]);
    expect(empty.eligibility).toMatchObject({
      observed: 0,
      eligible: 0,
      excluded: 0,
    });
    expect(empty.eligibility.eligibleShare).toBeNull();
    expect(empty.inferredBase).toBeNull();
    expect(empty.monthlyExploration).toEqual([]);
    expect(empty.distanceBands).toHaveLength(4);
    expect(empty.historyLimit).toBe(EXPLORER_HISTORY_LIMIT);
    expect(empty.historyCapReached).toBe(false);

    const capped = summarizeExplorer(
      [driveTo(...BASE), driveTo(...BASE), driveTo(...BASE)],
      { historyLimit: 3 },
    );
    expect(capped.historyLimit).toBe(3);
    expect(capped.historyCapReached).toBe(true);

    const bounded = summarizeExplorer([], { historyLimit: 50_000 });
    expect(bounded.historyLimit).toBe(EXPLORER_HISTORY_LIMIT);
  });
});
