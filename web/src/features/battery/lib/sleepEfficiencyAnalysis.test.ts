import { describe, expect, it } from 'vitest';

import type {
  SleepDrainEvent,
  SleepEfficiencyData,
} from '@/types/energy';
import {
  SLEEP_EVENT_DIRECTORY_CAP,
  SLEEP_STATE_DIRECTORY_CAP,
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
    expect(result.stateAccounting.includedRows).toBe(2);
    expect(result.stateAccounting.excludedRows).toBe(4);
    expect(result.transitions.totalCount).toBe(15);
    expect(result.transitions.states[1]).toMatchObject({
      state: 'mystery_mode',
      known: false,
      count: 5,
    });
    expect(result.stateAccounting.duplicatePolicy).toBe(
      'first_valid_row_wins',
    );
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
    expect(result.dwell.reportedEfficiencyPct).toBeNull();
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
      event({ id: 5, battery_lost: -1 }),
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
    expect(result.transitions.totalCount).toBe(0);
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
