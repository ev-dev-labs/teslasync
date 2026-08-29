import { describe, expect, it } from 'vitest';

import type { FsdInsightsDay } from '@/types/fsd';

import {
  bucketSharePct,
  buildWeekdayPattern,
  coercePeriodDays,
  hasAnyCounterObservation,
  hasAnyMeasuredFsd,
  hasAnyShare,
  topActiveDays,
  weekdayOfDayKey,
  type FsdWeekdayBucket,
} from '../helpers';

function day(overrides: Partial<FsdInsightsDay> & { date: string }): FsdInsightsDay {
  return {
    fsd_distance_m: null,
    driving_distance_m: null,
    fsd_share_pct: null,
    fsd_observation_count: 0,
    driving_observation_count: 0,
    reset_count: 0,
    has_counter_observation: false,
    ...overrides,
  };
}

function bucket(overrides: Partial<FsdWeekdayBucket> = {}): FsdWeekdayBucket {
  return {
    weekday: 1,
    fsdDistanceM: null,
    shareFsdDistanceM: null,
    shareDrivingDistanceM: null,
    counterObservationDays: 0,
    measuredDays: 0,
    activeDays: 0,
    ...overrides,
  };
}

describe('weekdayOfDayKey', () => {
  it('resolves the calendar weekday without re-interpreting the local date', () => {
    // 2026-03-01 is a Sunday, 2026-03-02 a Monday.
    expect(weekdayOfDayKey('2026-03-01')).toBe(0);
    expect(weekdayOfDayKey('2026-03-02')).toBe(1);
    expect(weekdayOfDayKey('2026-03-07')).toBe(6);
  });

  it('returns null for a malformed key instead of guessing', () => {
    expect(weekdayOfDayKey('')).toBeNull();
    expect(weekdayOfDayKey('2026-3-1')).toBeNull();
    expect(weekdayOfDayKey('2026-02-31')).toBeNull();
    expect(weekdayOfDayKey('not-a-date')).toBeNull();
  });
});

describe('buildWeekdayPattern', () => {
  it('always returns seven buckets, all unmeasured, for an empty series', () => {
    const buckets = buildWeekdayPattern([], false);
    expect(buckets).toHaveLength(7);
    expect(buckets.map((b) => b.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(buckets.every((b) => b.fsdDistanceM === null)).toBe(true);
    expect(buckets.every((b) => b.shareFsdDistanceM === null)).toBe(true);
    expect(buckets.every((b) => b.shareDrivingDistanceM === null)).toBe(true);
  });

  it('sums measured distance into the matching weekday bucket', () => {
    const buckets = buildWeekdayPattern([
      day({
        date: '2026-03-02',
        fsd_distance_m: 1000,
        driving_distance_m: 4000,
        fsd_share_pct: 25,
        has_counter_observation: true,
      }),
      day({
        date: '2026-03-09',
        fsd_distance_m: 500,
        driving_distance_m: 2000,
        fsd_share_pct: 25,
        has_counter_observation: true,
      }),
      day({ date: '2026-03-03', fsd_distance_m: 0, has_counter_observation: true }),
    ], true);

    const monday = buckets[1];
    expect(monday.fsdDistanceM).toBe(1500);
    expect(monday.shareFsdDistanceM).toBe(1500);
    expect(monday.shareDrivingDistanceM).toBe(6000);
    expect(monday.counterObservationDays).toBe(2);
    expect(monday.measuredDays).toBe(2);
    expect(monday.activeDays).toBe(2);

    const tuesday = buckets[2];
    // A measured zero contributes a measured day, but not an active one.
    expect(tuesday.fsdDistanceM).toBe(0);
    expect(tuesday.measuredDays).toBe(1);
    expect(tuesday.activeDays).toBe(0);
  });

  it('keeps a weekday unmeasured when no contributing day reported the counter', () => {
    // The driving counter reported but the self-driving counter said nothing,
    // so the weekday total must stay null, not 0.
    const buckets = buildWeekdayPattern([
      day({
        date: '2026-03-02',
        driving_distance_m: 4000,
        has_counter_observation: true,
      }),
    ], true);
    expect(buckets[1].fsdDistanceM).toBeNull();
    expect(buckets[1].measuredDays).toBe(0);
    expect(buckets[1].counterObservationDays).toBe(1);
    expect(buckets[1].shareFsdDistanceM).toBeNull();
    expect(buckets[1].shareDrivingDistanceM).toBeNull();
  });

  it('ignores malformed dates rather than bucketing them arbitrarily', () => {
    const buckets = buildWeekdayPattern(
      [day({ date: 'garbage', fsd_distance_m: 999 })],
      true,
    );
    expect(buckets.every((b) => b.fsdDistanceM === null)).toBe(true);
  });

  it('does not resurrect a share when the API reports mismatched counter spans', () => {
    const buckets = buildWeekdayPattern([
      day({
        date: '2026-03-02',
        fsd_distance_m: 1000,
        driving_distance_m: 4000,
        fsd_share_pct: 25,
      }),
    ], false);

    expect(buckets[1].fsdDistanceM).toBe(1000);
    expect(buckets[1].shareFsdDistanceM).toBeNull();
    expect(buckets[1].shareDrivingDistanceM).toBeNull();
    expect(bucketSharePct(buckets[1])).toBeNull();
  });

  it('uses only days where the API reported both sides on a common basis', () => {
    const buckets = buildWeekdayPattern([
      day({ date: '2026-03-02', fsd_distance_m: 800 }),
      day({ date: '2026-03-09', driving_distance_m: 4000 }),
      day({
        date: '2026-03-16',
        fsd_distance_m: 200,
        driving_distance_m: 1000,
        fsd_share_pct: 20,
      }),
    ], true);

    expect(buckets[1].fsdDistanceM).toBe(1000);
    expect(buckets[1].shareFsdDistanceM).toBe(200);
    expect(buckets[1].shareDrivingDistanceM).toBe(1000);
    expect(bucketSharePct(buckets[1])).toBe(20);
  });
});

describe('bucketSharePct', () => {
  it('is null when either side is missing or the denominator is zero', () => {
    expect(bucketSharePct(bucket({ shareFsdDistanceM: 10 }))).toBeNull();
    expect(
      bucketSharePct(bucket({ shareFsdDistanceM: 10, shareDrivingDistanceM: 0 })),
    ).toBeNull();
    expect(bucketSharePct(bucket({ shareDrivingDistanceM: 200 }))).toBeNull();
  });

  it('computes a percentage and clamps above 100', () => {
    expect(
      bucketSharePct(bucket({ shareFsdDistanceM: 25, shareDrivingDistanceM: 200 })),
    ).toBeCloseTo(12.5);
    expect(
      bucketSharePct(bucket({ shareFsdDistanceM: 500, shareDrivingDistanceM: 100 })),
    ).toBe(100);
  });
});

describe('topActiveDays', () => {
  const days = [
    day({ date: '2026-03-01', fsd_distance_m: 0, has_counter_observation: true }),
    day({ date: '2026-03-02', fsd_distance_m: 500, has_counter_observation: true }),
    day({ date: '2026-03-03', fsd_distance_m: 900, has_counter_observation: true }),
    day({ date: '2026-03-04', fsd_distance_m: 900, has_counter_observation: true }),
    day({ date: '2026-03-05', has_counter_observation: true }),
  ];

  it('excludes measured zeros and unmeasured days alike', () => {
    expect(topActiveDays(days, 10).map((d) => d.date)).toEqual([
      '2026-03-04',
      '2026-03-03',
      '2026-03-02',
    ]);
  });

  it('caps the list and never mutates the input array', () => {
    const snapshot = days.map((d) => d.date);
    expect(topActiveDays(days, 2)).toHaveLength(2);
    expect(topActiveDays(days, 0)).toHaveLength(0);
    expect(topActiveDays(days, -5)).toHaveLength(0);
    expect(days.map((d) => d.date)).toEqual(snapshot);
  });
});

describe('counter-observation presence probes', () => {
  it('distinguishes no counter observation from a true zero', () => {
    expect(hasAnyCounterObservation([day({ date: '2026-03-01' })])).toBe(false);
    expect(
      hasAnyCounterObservation([
        day({ date: '2026-03-01', has_counter_observation: true }),
      ]),
    ).toBe(true);
  });

  it('separates a driving observation from a self-driving measurement', () => {
    // A driving-only counter observation still leaves nothing to plot for FSD.
    const drivingOnly = [
      day({
        date: '2026-03-01',
        driving_distance_m: 12000,
        has_counter_observation: true,
      }),
    ];
    expect(hasAnyCounterObservation(drivingOnly)).toBe(true);
    expect(hasAnyMeasuredFsd(drivingOnly)).toBe(false);

    // A measured zero IS a measurement and must keep the chart alive.
    const measuredZero = [
      day({ date: '2026-03-01', fsd_distance_m: 0, has_counter_observation: true }),
    ];
    expect(hasAnyMeasuredFsd(measuredZero)).toBe(true);
  });

  it('reports share availability from the API field, not from the distance', () => {
    expect(
      hasAnyShare([
        day({
          date: '2026-03-01',
          fsd_distance_m: 100,
          has_counter_observation: true,
        }),
      ]),
    ).toBe(false);
    expect(hasAnyShare([day({ date: '2026-03-01', fsd_share_pct: 0 })])).toBe(true);
  });
});

describe('coercePeriodDays', () => {
  it('passes supported presets through', () => {
    for (const days of [7, 30, 90, 365] as const) {
      expect(coercePeriodDays(days, 30)).toBe(days);
    }
  });

  it('falls back for anything the backend was not asked for', () => {
    expect(coercePeriodDays(45, 30)).toBe(30);
    expect(coercePeriodDays(Number.NaN, 7)).toBe(7);
    expect(coercePeriodDays(-1, 90)).toBe(90);
    expect(coercePeriodDays(Number.POSITIVE_INFINITY, 30)).toBe(30);
  });
});
