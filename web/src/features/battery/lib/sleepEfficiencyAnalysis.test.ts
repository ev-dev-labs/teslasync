import { describe, expect, it } from 'vitest';

import type {
  SleepDrainEvent,
  SleepEfficiencyData,
} from '@/types/energy';
import {
  SLEEP_EVENT_DIRECTORY_CAP,
  SLEEP_STATE_DIRECTORY_CAP,
  SLEEP_MEASUREMENT_TOLERANCES,
  analyzeSleepEfficiency,
  analyzeSleepRange,
} from './sleepEfficiencyAnalysis';

const NOW = Date.parse('2026-08-08T12:00:00Z');

function event(
  overrides: Partial<SleepDrainEvent> = {},
): SleepDrainEvent {
  return {
    id: 1,
    start_date: '2026-08-07T01:00:00Z',
    end_date: '2026-08-07T05:00:00Z',
    duration_hours: 4,
    battery_lost: 2,
    drain_rate: 0.5,
    sentry_mode: false,
    outside_temp: 20,
    start_battery: 80,
    end_battery: 78,
    ...overrides,
  };
}

function analyze(
  data: SleepEfficiencyData | null | undefined,
  nowMs = NOW,
) {
  return analyzeSleepEfficiency(
    data,
    nowMs,
    '2026-07-10',
    '2026-08-08',
  );
}

describe('sleepEfficiencyAnalysis state accounting', () => {
  it('preserves all chart evidence and source order without attaching presentation colors', () => {
    const source: SleepEfficiencyData = {
      state_distribution: [
        { state: 'online', count: 0, total_minutes: 0 },
        { state: 'mystery_mode', count: 1, total_minutes: 15 },
        { state: 'asleep', count: 4, total_minutes: 45 },
      ],
      sentry_comparison: [
        { sentry_mode: false, count: 2, avg_drain_rate: -0.125, avg_battery_lost: -0.5, avg_duration_hours: 4 },
        { sentry_mode: true, count: 3, avg_drain_rate: 0, avg_battery_lost: 0, avg_duration_hours: 2 },
      ],
    };
    const original = structuredClone(source);
    const result = analyze(source);
    expect(result.transitions.states.map(row => [row.state, row.count, row.totalMinutes]))
      .toEqual([['online', 0, 0], ['mystery_mode', 1, 15], ['asleep', 4, 45]]);
    expect(result.sentry.comparisonAvailable).toBe(true);
    expect(result.sentry.off).toMatchObject({ count: 2, avgDrainRate: -0.125, avgBatteryLost: -0.5, avgDurationHours: 4 });
    expect(result.sentry.on).toMatchObject({ count: 3, avgDrainRate: 0, avgBatteryLost: 0, avgDurationHours: 2 });
    expect(result.transitions.states.every(row => !('color' in row))).toBe(true);
    expect(source).toEqual(original);
  });

  it('derives evidence support independently of requested scope and successful empty responses', () => {
    const missing = analyze(undefined);
    expect(missing.range.status).toBe('valid');
    expect(missing.source).toMatchObject({ hasResponse: false, hasEvidence: false });
    const empty = analyze({ state_distribution: [], recent_events: [], sentry_comparison: [] });
    expect(empty.source).toMatchObject({ hasResponse: true, hasEvidence: false });
    expect(empty.breadth.score).toBe(0);
    const rejected = analyze({
      state_distribution: [{ state: '', count: 2, total_minutes: 0 }],
      recent_events: [event({ duration_hours: -1 })],
    });
    expect(rejected.source).toMatchObject({ hasResponse: true, hasEvidence: false });
    expect(rejected.breadth.partialSources).toBeGreaterThan(0);
    expect(analyze({
      state_distribution: [{ state: 'asleep', count: 0, total_minutes: 0 }],
    }).source.hasEvidence).toBe(true);
    expect(analyze({
      sentry_comparison: [{ sentry_mode: true, count: 1, avg_drain_rate: 0, avg_battery_lost: 0 }],
    }).source.hasEvidence).toBe(true);
  });

  it('assigns every state row to one mutually exclusive category and keeps unknown states', () => {
    const result = analyze({
      state_distribution: [
        { state: 'asleep', count: 10, total_minutes: 0 },
        { state: '', count: 2, total_minutes: 0 },
        { state: 'online', count: -1, total_minutes: 0 },
        { state: 'driving', count: 2, total_minutes: -1 },
        { state: 'ASLEEP', count: 3, total_minutes: 0 },
        { state: 'mystery_mode', count: 5, total_minutes: 0 },
      ],
    });

    expect(result.stateAccounting.categories).toEqual({
      included: 2,
      missing_state: 1,
      invalid_count: 1,
      invalid_minutes: 1,
      duplicate_state: 1,
    });
    expect(result.stateAccounting.returnedRows).toBe(6);
    expect(result.stateAccounting.includedRows).toBe(3);
    expect(result.stateAccounting.excludedRows).toBe(3);
    expect(result.stateAccounting.durationIncludedRows).toBe(2);
    expect(result.stateAccounting.durationExcludedRows).toBe(4);
    expect(result.transitions.totalCount).toBe(17);
    expect(result.transitions.states[2]).toMatchObject({
      state: 'mystery_mode',
      known: false,
      count: 5,
    });
    expect(result.stateAccounting.duplicatePolicy).toBe(
      'first_valid_row_wins',
    );
  });

  it.each([undefined, null, -1, Number.NaN, Infinity, -Infinity, Number.MAX_VALUE])(
    'retains valid counts independently of unavailable duration (%s)',
    total_minutes => {
      const result = analyze({
        state_distribution: [
          { state: 'asleep', count: 8, total_minutes },
          { state: 'online', count: 2, total_minutes: 30 },
          { state: 'ASLEEP', count: 99, total_minutes: 90 },
        ],
      });

      expect(result.source.hasEvidence).toBe(true);
      expect(result.stateAccounting).toMatchObject({
        includedRows: 2,
        excludedRows: 1,
        durationIncludedRows: 1,
        durationExcludedRows: 2,
        categories: { included: 1, invalid_minutes: 1, duplicate_state: 1 },
      });
      expect(result.transitions.totalCount).toBe(10);
      expect(result.transitions.asleepShare).toBe(0.8);
      expect(result.transitions.states[0]).toMatchObject({
        count: 8,
        durationAvailable: false,
        totalMinutes: 0,
        durationShare: null,
        sourceIndex: 0,
      });
      expect(result.transitions.states[1]).toMatchObject({
        durationAvailable: true,
        durationShare: 1,
      });
      expect(result.dwell).toMatchObject({
        available: true,
        includedRows: 1,
        excludedRows: 2,
        totalMinutes: 30,
      });
      expect(result.availability.find(row => row.key === 'transition_counts')?.status).toBe('available');
      expect(result.availability.find(row => row.key === 'state_dwell')?.status).toBe('partial');
      expect(result.availability.find(row => row.key === 'sleep_efficiency')?.status).toBe('partial');
    },
  );

  it('keeps count-only evidence without synthesizing duration shares or efficiency', () => {
    const result = analyze({
      sleep_efficiency_pct: 75,
      state_distribution: [
        { state: 'asleep', count: 8 },
        { state: 'online', count: 2, total_minutes: -1 },
      ],
    });
    expect(result.transitions.totalCount).toBe(10);
    expect(result.transitions.asleepShare).toBe(0.8);
    expect(result.transitions.states.every(row => !row.durationAvailable && row.durationShare == null)).toBe(true);
    expect(result.dwell).toMatchObject({
      available: false,
      includedRows: 0,
      excludedRows: 2,
      recomputedEfficiencyPct: null,
      reportedEfficiencyPct: 75,
    });
  });

  it.each([undefined, null, -1, 0.5, Number.NaN, Infinity, Number.MAX_VALUE])(
    'rejects invalid counts (%s) without reserving the state for deduplication',
    count => {
      const result = analyze({
        state_distribution: [
          { state: 'asleep', count, total_minutes: 90 },
          { state: 'ASLEEP', count: 4, total_minutes: 90 },
        ],
      });
      expect(result.stateAccounting.categories.invalid_count).toBe(1);
      expect(result.transitions.states).toHaveLength(1);
      expect(result.transitions.states[0]).toMatchObject({
        count: 4, sourceIndex: 1, durationAvailable: true,
      });
      expect(result.transitions.totalCount).toBe(4);
      expect(result.dwell.totalMinutes).toBe(90);
    },
  );

  it('retains counts when the duration sum overflows', () => {
    const result = analyze({
      state_distribution: [
        { state: 'asleep', count: 4, total_minutes: Number.MAX_SAFE_INTEGER },
        { state: 'online', count: 6, total_minutes: 1 },
      ],
    });
    expect(result.transitions.totalCount).toBe(10);
    expect(result.transitions.states[1]).toMatchObject({
      durationAvailable: false, totalMinutes: 0, durationShare: null,
    });
    expect(result.stateAccounting.categories.invalid_minutes).toBe(1);
    expect(result.dwell.totalMinutes).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('treats zero minutes as valid transition-only evidence without publishing 0% efficiency', () => {
    const result = analyze({
      sleep_efficiency_pct: 0,
      time_to_sleep_avg_min: 0,
      state_distribution: [
        { state: 'asleep', count: 8, total_minutes: 0 },
        { state: 'online', count: 2, total_minutes: 0 },
      ],
    });

    expect(result.stateAccounting.categories.included).toBe(2);
    expect(result.transitions.totalCount).toBe(10);
    expect(result.transitions.asleepShare).toBeCloseTo(0.8);
    expect(result.dwell.available).toBe(false);
    expect(result.dwell.totalMinutes).toBe(0);
    expect(result.dwell.recomputedEfficiencyPct).toBeNull();
    expect(result.dwell.reportedEfficiencyPct).toBe(0);
    expect(result.dwell.reportedFieldValid).toBe(true);
    expect(result.dwell.timeToSleepAvgMin).toBeNull();
  });

  it('derives duration shares and compares reported efficiency when positive minutes exist', () => {
    const result = analyze({
      sleep_efficiency_pct: 74,
      time_to_sleep_avg_min: 12,
      state_distribution: [
        { state: 'asleep', count: 4, total_minutes: 90 },
        { state: 'online', count: 6, total_minutes: 30 },
      ],
    });

    expect(result.dwell.available).toBe(true);
    expect(result.dwell.totalMinutes).toBe(120);
    expect(result.dwell.asleepMinutes).toBe(90);
    expect(result.dwell.recomputedEfficiencyPct).toBe(75);
    expect(result.dwell.reportedEfficiencyPct).toBe(74);
    expect(result.dwell.reportedDifferencePoints).toBe(-1);
    expect(result.dwell.timeToSleepAvgMin).toBe(12);
    expect(result.transitions.states[0]?.durationShare).toBe(0.75);
  });

  it('computes deterministic concentration and normalized entropy', () => {
    const equal = analyze({
      state_distribution: [
        { state: 'asleep', count: 5, total_minutes: 0 },
        { state: 'online', count: 5, total_minutes: 0 },
      ],
    });
    expect(equal.transitions.normalizedEntropy).toBeCloseTo(1);
    expect(equal.transitions.dominantState).toBe('asleep');
    expect(equal.transitions.dominantShare).toBe(0.5);
    expect(equal.transitions.representedStateCount).toBe(2);

    const concentrated = analyze({
      state_distribution: [
        { state: 'online', count: 10, total_minutes: 0 },
        { state: 'asleep', count: 0, total_minutes: 0 },
      ],
    });
    expect(concentrated.transitions.normalizedEntropy).toBe(0);
    expect(concentrated.transitions.representedStateCount).toBe(1);
  });
});

describe('sleepEfficiencyAnalysis Sentry evidence', () => {
  it.each([
    { value: undefined, status: 'missing' },
    { value: null, status: 'missing' },
    { value: Number.NaN, status: 'invalid' },
    { value: Infinity, status: 'invalid' },
    { value: -Infinity, status: 'invalid' },
    { value: Number.MAX_VALUE, status: 'invalid' },
    { value: 0, status: 'measured' },
    { value: 0.125, status: 'measured' },
  ] as const)('exposes independent group metric validity for $value', ({ value, status }) => {
    const result = analyze({
      sentry_comparison: [{
        sentry_mode: true, count: 2,
        avg_drain_rate: value, avg_duration_hours: value,
        avg_battery_lost: value, avg_temp: value,
      }],
    });
    expect(result.sentry.on.available).toBe(true);
    for (const key of ['drainRate', 'durationHours', 'batteryLost', 'temperatureC'] as const) {
      expect(result.sentry.on.measurements[key]).toEqual({
        status, value: status === 'measured' ? value : null,
      });
    }
    expect(result.sentry.on.measurements.count).toEqual({ status: 'measured', value: 2 });
    expect(result.sentry.provenance.rows[0]?.measurements).toEqual(result.sentry.on.measurements);
    expect(result.sentry.provenance.causalEffectEstablished).toBe(false);
  });

  it('keeps signed fractional metrics independent of invalid duration', () => {
    const result = analyze({
      sentry_comparison: [{
        sentry_mode: true, count: 1, avg_drain_rate: -0.125,
        avg_battery_lost: -0.25, avg_duration_hours: -0.5, avg_temp: -3.75,
      }],
    });
    expect(result.sentry.on.measurements).toEqual({
      count: { status: 'measured', value: 1 },
      drainRate: { status: 'measured', value: -0.125 },
      batteryLost: { status: 'measured', value: -0.25 },
      durationHours: { status: 'invalid', value: null },
      temperatureC: { status: 'measured', value: -3.75 },
    });
    expect(result.sentry.on.avgDurationHours).toBeNull();
  });

  it('accounts for every group without merging duplicates or replacing invalid metrics', () => {
    const result = analyze({
      sentry_comparison: [
        { count: 1 },
        { sentry_mode: true },
        { sentry_mode: true, count: -1 },
        { sentry_mode: true, count: 0.5 },
        { sentry_mode: true, count: 0, avg_drain_rate: 0 },
        { sentry_mode: true, count: 2, avg_drain_rate: Number.NaN },
        { sentry_mode: true, count: 3, avg_drain_rate: 0.5 },
        { sentry_mode: false, count: 4, avg_drain_rate: 0 },
      ],
    });
    expect(result.sentry.provenance.rows.map(row => row.category)).toEqual([
      'invalid_mode', 'missing_count', 'invalid_count', 'invalid_count',
      'zero_count', 'included', 'duplicate_mode', 'included',
    ]);
    expect(result.sentry.provenance.rows.map(row => row.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.sentry.provenance.rows[4]?.measurements.count).toEqual({ status: 'measured', value: 0 });
    expect(result.sentry.on).toMatchObject({ available: true, sourceIndex: 5, count: 2, avgDrainRate: null });
    expect(result.sentry.comparisonAvailable).toBe(true);
    expect(result.sentry.drainRateDifference).toBeNull();
    expect(result.sentry.provenance).toMatchObject({
      duplicatePolicy: 'first_count_bearing_group_wins',
      averageWeighting: 'unknown',
      groupExposureHours: 'unknown',
      comparisonBasis: 'observational_group_averages',
      causalEffectEstablished: false,
    });
    expect(Object.isFrozen(result.sentry.provenance.rows)).toBe(true);
  });

  it('keeps event sample shares and medians distinct from time exposure and backend groups', () => {
    const result = analyze({
      recent_events: [
        event({ id: 1, duration_hours: 0.5, drain_rate: 2, sentry_mode: true }),
        event({ id: 2, duration_hours: 8, drain_rate: 0 }),
        event({ id: 2, duration_hours: 100, drain_rate: 100, sentry_mode: true }),
      ],
    });
    expect(result.events.aggregates).toMatchObject({
      count: 2, totalDurationHours: 8.5, medianDrainRate: 1, sentryShare: 0.5,
    });
    expect(result.events.exposure.uniqueHours).toBe(4);
    expect(result.events.accounting.categories.duplicate_id).toBe(1);
    expect(result.sentry.hasAnyEvidence).toBe(false);
    expect(result.sentry.provenance.groupExposureHours).toBe('unknown');
    expect(result.sentry.provenance.rows).toEqual([]);
  });

  it.each([
    { on: 0, off: 0, difference: 0, excess: 0 },
    { on: 0.5, off: 0.25, difference: 0.25, excess: 0.25 },
    { on: 0.125, off: 0.375, difference: -0.25, excess: 0 },
    { on: 0.25, off: 0.25, difference: 0, excess: 0 },
  ])('preserves signed fractional comparisons and nonnegative excess for $on minus $off', ({
    on, off, difference, excess,
  }) => {
    const data: SleepEfficiencyData = {
      battery_capacity_wh: 75_000,
      base_cost_per_kwh: 0.2,
      sentry_comparison: [
        { sentry_mode: true, count: 3, avg_drain_rate: on },
        { sentry_mode: false, count: 4, avg_drain_rate: off },
      ],
    };
    const result = analyze(data);
    expect(result.sentry.on.avgDrainRate).toBe(on);
    expect(result.sentry.off.avgDrainRate).toBe(off);
    expect(result.sentry.drainRateDifference).toBe(difference);
    expect(result.sentry.projection.extraDrainRate).toBe(excess);
    expect(result.sentry.projection.extraMonthlyKwh).toBeCloseTo(excess / 100 * 75 * 730);
    expect(result.sentry.projection.extraMonthlyCost).toBeCloseTo(excess / 100 * 75 * 730 * 0.2);
    expect(data.sentry_comparison?.map(row => row.avg_drain_rate)).toEqual([on, off]);

    const withoutCapacity = analyze({ sentry_comparison: data.sentry_comparison });
    expect(withoutCapacity.sentry.drainRateDifference).toBe(difference);
    expect(withoutCapacity.sentry.projection.extraDrainRate).toBe(excess);
    expect(withoutCapacity.sentry.projection.available).toBe(false);
    expect(withoutCapacity.sentry.projection.extraMonthlyKwh).toBeNull();
    expect(withoutCapacity.sentry.projection.extraMonthlyCost).toBeNull();
  });

  it.each([undefined, null, Number.NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE])(
    'withholds invalid or missing rates (%s) rather than reporting measured zero',
    rate => {
      for (const sentryMode of [true, false]) {
        const result = analyze({
          battery_capacity_wh: 75_000,
          sentry_comparison: [
            { sentry_mode: sentryMode, count: 3, avg_drain_rate: rate },
            { sentry_mode: !sentryMode, count: 4, avg_drain_rate: 0 },
          ],
        });
        expect(result.sentry.comparisonAvailable).toBe(true);
        expect(result.sentry[sentryMode ? 'on' : 'off'].avgDrainRate).toBeNull();
        expect(result.sentry.drainRateDifference).toBeNull();
        expect(result.sentry.projection.extraDrainRate).toBeNull();
        expect(result.sentry.projection.available).toBe(false);
        expect(result.sentry.projection.extraMonthlyKwh).toBeNull();
      }
    },
  );

  it('withholds differences when a count-bearing group is absent', () => {
    for (const data of [
      undefined,
      {},
      { sentry_comparison: [] },
      { sentry_comparison: [{ sentry_mode: true, count: 1, avg_drain_rate: 0 }] },
      { sentry_comparison: [
        { sentry_mode: true, count: 1, avg_drain_rate: 0 },
        { sentry_mode: false, count: 0, avg_drain_rate: 0 },
      ] },
    ]) {
      const result = analyze(data);
      expect(result.sentry.drainRateDifference).toBeNull();
      expect(result.sentry.projection.extraDrainRate).toBeNull();
    }
  });

  it('accepts count-bearing zero rates as legitimate evidence and zero projections', () => {
    const result = analyze({
      battery_capacity_wh: 75_000,
      capacity_source: 'vin_estimate',
      base_cost_per_kwh: 0.2,
      sentry_comparison: [
        {
          sentry_mode: true,
          count: 3,
          avg_drain_rate: 0,
          avg_duration_hours: 5,
          avg_battery_lost: 0,
          avg_temp: 10,
        },
        {
          sentry_mode: false,
          count: 4,
          avg_drain_rate: 0,
          avg_duration_hours: 6,
          avg_battery_lost: 0,
          avg_temp: 8,
        },
      ],
    });

    expect(result.sentry.comparisonAvailable).toBe(true);
    expect(result.sentry.on.avgDrainRate).toBe(0);
    expect(result.sentry.off.avgBatteryLost).toBe(0);
    expect(result.sentry.projection.available).toBe(true);
    expect(result.sentry.projection.onMonthlyKwh).toBe(0);
    expect(result.sentry.projection.onMonthlyCost).toBe(0);
    expect(result.sentry.projection.extraDrainRate).toBe(0);
    expect(
      result.availability.find(
        (row) => row.key === 'sentry_comparison',
      )?.status,
    ).toBe('available');
  });

  it('keeps empty and zero-count groups unavailable', () => {
    const empty = analyze({ sentry_comparison: [] });
    expect(empty.sentry.hasAnyEvidence).toBe(false);
    expect(empty.sentry.comparisonAvailable).toBe(false);
    expect(empty.sentry.projection.available).toBe(false);

    const zeroCounts = analyze({
      sentry_comparison: [
        {
          sentry_mode: true,
          count: 0,
          avg_drain_rate: 0,
          avg_duration_hours: 0,
          avg_battery_lost: 0,
          avg_temp: 0,
        },
      ],
    });
    expect(zeroCounts.sentry.on.available).toBe(false);
  });

  it('marks one positive-count group as partial rather than a comparison', () => {
    const result = analyze({
      sentry_comparison: [
        {
          sentry_mode: true,
          count: 2,
          avg_drain_rate: 0.5,
          avg_duration_hours: 3,
          avg_battery_lost: 1.5,
          avg_temp: -5,
        },
      ],
    });
    expect(result.sentry.hasAnyEvidence).toBe(true);
    expect(result.sentry.comparisonAvailable).toBe(false);
    expect(result.sentry.on.avgTempC).toBe(-5);
    expect(
      result.availability.find(
        (row) => row.key === 'sentry_comparison',
      )?.status,
    ).toBe('partial');
  });
});

describe('sleepEfficiencyAnalysis event accounting', () => {
  it('assigns all event categories, deduplicates first valid IDs, and sorts without mutation', () => {
    const rows: SleepDrainEvent[] = [
      event({ id: 1, start_date: '2026-08-06T01:00:00Z' }),
      event({ id: 2, start_date: 'not-a-time' }),
      event({
        id: 3,
        start_date: '2026-08-09T01:00:00Z',
        end_date: '2026-08-09T02:00:00Z',
      }),
      event({ id: 4, duration_hours: 0 }),
      event({ id: 5, battery_lost: -101 }),
      event({
        id: 1,
        start_date: '2026-08-05T01:00:00Z',
        end_date: '2026-08-05T05:00:00Z',
      }),
      event({
        id: 6,
        start_date: '2026-08-08T01:00:00Z',
        end_date: '2026-08-08T05:00:00Z',
        outside_temp: null,
      }),
    ];
    const before = rows.map((row) => ({ ...row }));
    const result = analyze({ recent_events: rows, total_events: 7 });

    expect(result.events.accounting.categories).toEqual({
      included: 2,
      invalid_timestamp: 1,
      future: 1,
      invalid_duration: 1,
      invalid_battery: 1,
      duplicate_id: 1,
    });
    expect(result.events.events.map((row) => row.id)).toEqual(['6', '1']);
    expect(rows).toEqual(before);
    expect(result.events.reportedTotalEvents).toBe(7);
    expect(result.events.accounting.duplicatePolicy).toBe(
      'first_valid_event_wins',
    );
  });

    describe('sleepEfficiencyAnalysis measurement provenance and exposure', () => {
      it.each([
        { loss: -0.25, start: 80, end: 80.25, rate: -0.0625 },
        { loss: 0.25, start: 80, end: 79.75, rate: 0.0625 },
        { loss: 0, start: 80, end: 80, rate: 0 },
      ])('retains signed charging/recalibration and fractional readings ($loss)', ({ loss, start, end, rate }) => {
        const result = analyze({ recent_events: [event({
          battery_lost: loss, start_battery: start, end_battery: end, drain_rate: rate,
        })] });
        expect(result.events.events).toHaveLength(1);
        expect(result.events.aggregates.totalBatteryLost).toBe(loss);
        expect(result.events.measurements[0]).toMatchObject({
          reported: { batteryLost: { status: 'measured', value: loss } },
          derived: { durationHours: 4, batteryLost: loss, drainRate: rate },
          contradictions: [],
        });
      });

      it.each([
        { value: undefined, status: 'missing' },
        { value: null, status: 'missing' },
        { value: Number.NaN, status: 'invalid' },
        { value: Infinity, status: 'invalid' },
        { value: -101, status: 'invalid' },
        { value: 0, status: 'measured' },
      ] as const)('distinguishes $status loss from measured zero without substituting endpoints', ({ value, status }) => {
        const result = analyze({ recent_events: [event({ battery_lost: value })] });
        expect(result.events.measurements[0]?.reported.batteryLost.status).toBe(status);
        expect(result.events.measurements[0]?.derived.batteryLost).toBe(2);
        expect(result.events.accounting.includedRows).toBe(status === 'measured' ? 1 : 0);
        expect(result.events.aggregates.totalBatteryLost).toBe(status === 'measured' ? 0 : null);
      });

      it('discloses contradictions without rewriting or rejecting finite signed readings', () => {
        const input = event({ duration_hours: 2, battery_lost: -1, drain_rate: 0.5 });
        const result = analyze({ recent_events: [input] });
        expect(result.events.events[0]).toMatchObject({
          durationHours: 2, batteryLost: -1, drainRate: 0.5,
        });
        expect(result.events.measurements[0]).toMatchObject({
          derived: { durationHours: 4, batteryLost: 2, drainRate: 0.5 },
          contradictions: ['duration', 'battery_loss', 'drain_rate'],
        });
        expect(input.duration_hours).toBe(2);
      });

      it('allows rounding at tolerance boundaries and discloses values beyond them', () => {
        const { durationHours, batteryPoints, drainRatePointsPerHour } = SLEEP_MEASUREMENT_TOLERANCES;
        const roundedLoss = 2 + batteryPoints;
        const roundedDuration = 4 + durationHours;
        const rounded = event({
          duration_hours: roundedDuration,
          battery_lost: roundedLoss,
          drain_rate: roundedLoss / roundedDuration + drainRatePointsPerHour,
        });
        expect(analyze({ recent_events: [rounded] }).events.measurements[0]?.contradictions).toEqual([]);
        expect(analyze({ recent_events: [event({
          duration_hours: roundedDuration + 0.001,
          battery_lost: roundedLoss + 0.001,
          drain_rate: 1,
        })] }).events.measurements[0]?.contradictions).toEqual(['duration', 'battery_loss', 'drain_rate']);
      });

      it('keeps negative group averages and signed projections without claiming average identities', () => {
        const result = analyze({
          battery_capacity_wh: 75_000,
          sentry_comparison: [
            { sentry_mode: true, count: 2, avg_drain_rate: -0.25, avg_battery_lost: -0.5, avg_duration_hours: 3 },
            { sentry_mode: false, count: 2, avg_drain_rate: -0.5 },
          ],
        });
        expect(result.sentry.on.avgBatteryLost).toBe(-0.5);
        expect(result.sentry.on.measurements.drainRate).toEqual({ status: 'measured', value: -0.25 });
        expect(result.sentry.off.measurements.batteryLost.status).toBe('missing');
        expect(result.sentry.drainRateDifference).toBe(0.25);
        expect(result.sentry.projection.onMonthlyKwh).toBeCloseTo(-0.25 / 100 * 75 * 730);
        expect(result.sentry.projection.basis).toBe('signed_net_rate_730_hours');
      });

      it('uses timestamp union for nested overlaps, touching intervals and clipped exposure', () => {
        const result = analyzeSleepEfficiency({ recent_events: [
          event({ id: 1, start_date: '2026-08-07T00:00:00Z', end_date: '2026-08-07T08:00:00Z', duration_hours: 8 }),
          event({ id: 2, start_date: '2026-08-07T01:00:00Z', end_date: '2026-08-07T03:00:00Z', duration_hours: 2 }),
          event({ id: 3, start_date: '2026-08-07T08:00:00Z', end_date: '2026-08-07T10:00:00Z', duration_hours: 2 }),
          event({ id: 4, start_date: '2026-08-06T22:00:00Z', end_date: '2026-08-07T01:00:00Z', duration_hours: 3 }),
        ] }, NOW, '2026-08-07', '2026-08-07');
        expect(result.events.accounting.includedRows).toBe(4);
        expect(result.events.aggregates.totalDurationHours).toBe(15);
        expect(result.events.exposure).toEqual({
          uniqueHours: 12, overlapHours: 3, overlappingRows: 2,
          requestedHours: 24, coveredRequestedHours: 10,
          requestedCoverage: 10 / 24, completePeriodCoverage: 'unknown',
        });
      });

      it('does not invent exposure from empty rows, invalid range or invalid timestamp order', () => {
        expect(analyze({ recent_events: [] }).events.exposure).toMatchObject({
          uniqueHours: null, overlapHours: null, requestedCoverage: null,
        });
        const result = analyzeSleepEfficiency({ recent_events: [
          event(),
          event({ id: 2, end_date: '2026-08-07T01:00:00Z' }),
        ] }, NOW, 'invalid', 'invalid');
        expect(result.events.accounting.categories.invalid_timestamp).toBe(1);
        expect(result.events.exposure).toMatchObject({
          uniqueHours: 4, requestedHours: null, requestedCoverage: null,
        });
      });

      it('keeps independent reported efficiency and discloses disagreement with derived dwell', () => {
        expect(analyze({ sleep_efficiency_pct: 0 }).dwell).toMatchObject({
          reportedEfficiencyPct: 0,
          reportedMeasurement: { status: 'measured', value: 0 },
          recomputedEfficiencyPct: null, efficiencyContradiction: false,
        });
        expect(analyze({ sleep_efficiency_pct: Number.NaN }).dwell.reportedMeasurement.status).toBe('invalid');
        expect(analyze({}).dwell.reportedMeasurement.status).toBe('missing');
        const result = analyze({
          sleep_efficiency_pct: 74,
          state_distribution: [
            { state: 'asleep', count: 1, total_minutes: 90.5 },
            { state: 'online', count: 1, total_minutes: 29.5 },
          ],
        });
        expect(result.dwell.recomputedEfficiencyPct).toBeCloseTo(90.5 / 120 * 100);
        expect(result.dwell.efficiencyContradiction).toBe(true);
      });
    });
  it('derives event aggregates, SI temperature coverage, and frozen-clock recency', () => {
    const result = analyze({
      recent_events: [
        event({
          id: 1,
          start_date: '2026-08-08T01:00:00Z',
          end_date: '2026-08-08T03:00:00Z',
          duration_hours: 2,
          battery_lost: 1,
          drain_rate: 0.5,
          sentry_mode: true,
          outside_temp: 20,
        }),
        event({
          id: 2,
          start_date: '2026-08-03T01:00:00Z',
          end_date: '2026-08-03T05:00:00Z',
          duration_hours: 4,
          battery_lost: 3,
          drain_rate: 0.75,
          outside_temp: null,
        }),
        event({
          id: 3,
          start_date: '2026-07-01T01:00:00Z',
          end_date: '2026-07-01T07:00:00Z',
          duration_hours: 6,
          battery_lost: 5,
          drain_rate: 1,
          outside_temp: -10,
        }),
      ],
    });

    expect(result.events.aggregates).toMatchObject({
      available: true,
      count: 3,
      totalDurationHours: 12,
      medianDurationHours: 4,
      totalBatteryLost: 9,
      medianDrainRate: 0.75,
      last24HoursCount: 1,
      last7DaysCount: 1,
      olderCount: 1,
    });
    expect(result.events.aggregates.sentryShare).toBeCloseTo(1 / 3);
    expect(result.events.aggregates.temperatureCoverage).toBeCloseTo(2 / 3);
  });

  it('uses the supplied frozen clock for both future and recency classification', () => {
    const data: SleepEfficiencyData = {
      recent_events: [
        event({
          id: 1,
          start_date: '2026-08-08T13:00:00Z',
          end_date: '2026-08-08T14:00:00Z',
        }),
      ],
    };
    const before = analyze(data, Date.parse('2026-08-08T12:00:00Z'));
    const after = analyze(data, Date.parse('2026-08-09T12:00:00Z'));

    expect(before.events.accounting.categories.future).toBe(1);
    expect(after.events.accounting.categories.future).toBe(0);
    expect(after.events.events[0]?.recency).toBe('last_24_hours');
    expect(before.source.frozenNowIso).toBe('2026-08-08T12:00:00.000Z');
  });
});

describe('sleepEfficiencyAnalysis range handling', () => {
  it('computes inclusive UTC dates without DST sensitivity', () => {
    expect(analyzeSleepRange('2026-03-07', '2026-03-09')).toMatchObject({
      status: 'valid',
      inclusiveDays: 3,
    });
    expect(analyzeSleepRange('2026-11-01', '2026-11-01')).toMatchObject({
      status: 'valid',
      inclusiveDays: 1,
    });
    expect(
      analyzeSleepRange('2026-06-17', '2026-07-16').inclusiveDays,
    ).toBe(30);
  });

  it('flags reversed, invalid, and missing ranges without one-day coercion', () => {
    expect(analyzeSleepRange('2026-03-10', '2026-03-01')).toMatchObject({
      status: 'reversed',
      inclusiveDays: null,
    });
    expect(analyzeSleepRange('2026-02-30', '2026-03-01')).toMatchObject({
      status: 'invalid',
      inclusiveDays: null,
    });
    expect(analyzeSleepRange(null, '2026-03-01')).toMatchObject({
      status: 'missing',
      inclusiveDays: null,
    });
  });
});

describe('sleepEfficiencyAnalysis hardening, caps, and support', () => {
  it('does not mutate input and freezes the returned model', () => {
    const input: SleepEfficiencyData = {
      state_distribution: [
        { state: 'asleep', count: 2, total_minutes: 10 },
      ],
      recent_events: [event()],
    };
    const before = JSON.parse(JSON.stringify(input)) as SleepEfficiencyData;
    const result = analyze(input);

    expect(input).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.transitions.states)).toBe(true);
    expect(Object.isFrozen(result.events.events)).toBe(true);
  });

  it('rejects hostile non-finite and negative values instead of creating success-shaped zeros', () => {
    const result = analyze({
      vehicle_id: Number.POSITIVE_INFINITY,
      period_days: -30,
      battery_capacity_wh: Number.NaN,
      base_cost_per_kwh: Number.NEGATIVE_INFINITY,
      sleep_efficiency_pct: Number.NaN,
      time_to_sleep_avg_min: -1,
      state_distribution: [
        {
          state: 'asleep',
          count: Number.POSITIVE_INFINITY,
          total_minutes: 0,
        },
        {
          state: 'online',
          count: 2,
          total_minutes: Number.NaN,
        },
      ],
      sentry_comparison: [
        {
          sentry_mode: true,
          count: Number.POSITIVE_INFINITY,
          avg_drain_rate: 0,
        },
      ],
    });

    expect(result.source.vehicleId).toBeNull();
    expect(result.source.backendPeriodDays).toBeNull();
    expect(result.stateAccounting.categories.invalid_count).toBe(1);
    expect(result.stateAccounting.categories.invalid_minutes).toBe(1);
    expect(result.transitions.totalCount).toBe(2);
    expect(result.dwell.recomputedEfficiencyPct).toBeNull();
    expect(result.sentry.context.batteryCapacityWh).toBeNull();
    expect(result.sentry.context.baseCostPerKwh).toBeNull();
    expect(result.sentry.hasAnyEvidence).toBe(false);
  });

  it('keeps an empty response unavailable rather than synthesizing evidence', () => {
    const result = analyze({});
    expect(result.source.hasResponse).toBe(true);
    expect(result.transitions.states).toEqual([]);
    expect(result.events.events).toEqual([]);
    expect(result.dwell.available).toBe(false);
    expect(result.sentry.comparisonAvailable).toBe(false);
    expect(result.breadth.score).toBe(0);
    expect(
      result.availability.every(
        (row) => row.status === 'unavailable',
      ),
    ).toBe(true);
  });

  it('caps state and event directories without changing full summaries', () => {
    const states = Array.from({ length: 55 }, (_, index) => ({
      state: `unknown_${index}`,
      count: 1,
      total_minutes: 0,
    }));
    const events = Array.from({ length: 55 }, (_, index) =>
      event({
        id: index + 1,
        start_date: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T01:00:00Z`,
        end_date: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T05:00:00Z`,
      }),
    );
    const result = analyze({
      state_distribution: states,
      recent_events: events,
    });

    expect(result.transitions.totalCount).toBe(55);
    expect(result.transitions.states).toHaveLength(55);
    expect(result.transitions.directory).toHaveLength(
      SLEEP_STATE_DIRECTORY_CAP,
    );
    expect(result.stateAccounting.omittedRows).toBe(5);
    expect(result.events.aggregates.count).toBe(55);
    expect(result.events.directory).toHaveLength(
      SLEEP_EVENT_DIRECTORY_CAP,
    );
    expect(result.events.accounting.omittedRows).toBe(5);
  });

  it('computes transparent source breadth rather than confidence', () => {
    const result = analyze({
      state_distribution: [
        { state: 'asleep', count: 3, total_minutes: 0 },
      ],
      battery_capacity_wh: 75_000,
      capacity_source: 'default',
      base_cost_per_kwh: 0.12,
    });
    expect(result.breadth).toEqual({
      score: 29,
      earnedPoints: 2,
      possiblePoints: 7,
      availableSources: 2,
      partialSources: 0,
      unavailableSources: 5,
    });
  });

  it('marks an invalid frozen clock and leaves recency unclassified', () => {
    const result = analyze({ recent_events: [event()] }, Number.NaN);
    expect(result.source.clockValid).toBe(false);
    expect(result.source.frozenNowMs).toBeNull();
    expect(result.events.events[0]?.recency).toBe('unclassified');
  });
});
