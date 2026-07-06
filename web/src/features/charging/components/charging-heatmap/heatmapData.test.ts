// charging-heatmap/heatmapData unit tests.
//
// Every export is exercised across multiple facets / branches:
//   buildGrid          — grid shape, correct weekday/hour bucketing, energy
//                        summing (incl. the `?? 0` null guard), busiest-slot
//                        tracking, unparseable-timestamp skip and the nullish
//                        `sessions` guard (must not throw).
//   heatColor          — the count===0 / max===0 floor plus all four ratio
//                        bands with their *exclusive* < boundaries (0.25 / 0.5
//                        / 0.75) and the full-intensity tail.
//   HEAT_LEGEND        — length, low→high ordering, distinctness and alignment
//                        with heatColor's floor and ceiling.
//   aggregateLocations — count/threshold/sort/cap, null → unknownLabel, the
//                        blank/whitespace → unknownLabel + trim-dedupe fix and
//                        the nullish `sessions` guard.
//   aggregateByDayOfWeek — 7-row Sun..Sat totals with label mapping, the
//                        String(day) fallback for a short label array and the
//                        null-model guard.
//   deriveInsights     — busiest day/hour, weekend/weekday split, activeSlots,
//                        the all-zero model and the null-model guard.
//   formatHourLabel    — zero-padding for single- vs double-digit hours.
//
// Timestamps deliberately OMIT a timezone suffix: a date-time string without an
// offset is parsed as *local* time, so `getDay()` / `getHours()` read back the
// exact calendar weekday/hour written here regardless of the CI host timezone
// (the weekday of a fixed calendar date is timezone-invariant).
//   2026-07-05 = Sunday (0), 2026-07-06 = Monday (1), 2026-07-04 = Saturday (6).

import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/api/types';
import {
  buildGrid,
  heatColor,
  HEAT_LEGEND,
  aggregateLocations,
  aggregateByDayOfWeek,
  deriveInsights,
  formatHourLabel,
  type HeatmapModel,
} from './heatmapData';

const MON_10 = '2026-07-06T10:00:00'; // day 1, hour 10
const SUN_14 = '2026-07-05T14:00:00'; // day 0, hour 14
const SAT_10 = '2026-07-04T10:00:00'; // day 6, hour 10

const LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: MON_10,
    ended_at: '2026-07-06T11:00:00',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 5_000,
    peak_power_w: null,
    avg_power_w: null,
    cost_decimal: null,
    cost_currency: null,
    charger_type: null,
    cable_type: null,
    startedAt: MON_10,
    duration_min: 60,
    ...overrides,
  };
}

/** The canonical multi-slot scenario reused by several suites. */
function scenarioSessions(): ChargingSession[] {
  return [
    makeSession({ id: 1, started_at: MON_10, total_energy_added_wh: 5_000 }),
    makeSession({ id: 2, started_at: MON_10, total_energy_added_wh: 5_000 }),
    makeSession({ id: 3, started_at: MON_10, total_energy_added_wh: 5_000 }),
    makeSession({ id: 4, started_at: SUN_14, total_energy_added_wh: 8_000 }),
    makeSession({ id: 5, started_at: SAT_10, total_energy_added_wh: 2_000 }),
  ];
}

describe('buildGrid', () => {
  it('returns an all-zero 7×24 grid for empty input', () => {
    const model = buildGrid([]);
    expect(model.grid).toHaveLength(7);
    expect(model.grid.every((row) => row.length === 24)).toBe(true);
    expect(model.grid[3][12]).toEqual({ count: 0, totalEnergyWh: 0 });
    expect(model).toEqual({
      grid: model.grid,
      maxCount: 0,
      favDay: 0,
      favHour: 0,
    });
  });

  it('buckets a session into its local weekday/hour slot and sums energy', () => {
    const model = buildGrid([makeSession({ started_at: MON_10, total_energy_added_wh: 5_000 })]);
    // Monday (1) at 10:00.
    expect(model.grid[1][10]).toEqual({ count: 1, totalEnergyWh: 5_000 });
    expect(model.grid[0][10]).toEqual({ count: 0, totalEnergyWh: 0 });
    expect(model.maxCount).toBe(1);
    expect(model.favDay).toBe(1);
    expect(model.favHour).toBe(10);
  });

  it('accumulates multiple sessions in the same slot, treating null energy as 0', () => {
    const model = buildGrid([
      makeSession({ started_at: MON_10, total_energy_added_wh: 5_000 }),
      makeSession({ started_at: MON_10, total_energy_added_wh: null as unknown as number }),
    ]);
    expect(model.grid[1][10].count).toBe(2);
    expect(model.grid[1][10].totalEnergyWh).toBe(5_000);
  });

  it('tracks the busiest single slot across the whole dataset', () => {
    const model = buildGrid(scenarioSessions());
    expect(model.maxCount).toBe(3);
    expect(model.favDay).toBe(1); // Monday
    expect(model.favHour).toBe(10);
  });

  it('skips sessions with an unparseable started_at instead of crashing', () => {
    const model = buildGrid([
      makeSession({ started_at: MON_10 }),
      makeSession({ started_at: 'not-a-date' }),
      makeSession({ started_at: '' }),
    ]);
    // Only the valid Monday session counts.
    expect(model.grid[1][10].count).toBe(1);
    expect(model.maxCount).toBe(1);
  });

  it('is null-safe: undefined sessions yield an empty model without throwing', () => {
    const model = buildGrid(undefined as unknown as ChargingSession[]);
    expect(model.maxCount).toBe(0);
    expect(model.grid).toHaveLength(7);
  });
});

describe('heatColor', () => {
  it('returns the floor swatch when count or max is 0', () => {
    expect(heatColor(0, 10)).toBe('rgba(0, 240, 255, 0.04)');
    expect(heatColor(5, 0)).toBe('rgba(0, 240, 255, 0.04)');
  });

  it('maps each intensity band, honouring exclusive < boundaries', () => {
    // ratio 0.1 → lowest active band.
    expect(heatColor(1, 10)).toBe('rgba(0, 240, 255, 0.15)');
    // ratio exactly 0.25 is NOT < 0.25 → next band up (green).
    expect(heatColor(25, 100)).toBe('rgba(16, 185, 129, 0.4)');
    // ratio exactly 0.5 is NOT < 0.5 → amber.
    expect(heatColor(50, 100)).toBe('rgba(245, 158, 11, 0.55)');
    // ratio exactly 0.75 is NOT < 0.75 → red.
    expect(heatColor(75, 100)).toBe('rgba(239, 68, 68, 0.75)');
  });

  it('returns the hottest swatch at full intensity', () => {
    expect(heatColor(10, 10)).toBe('rgba(239, 68, 68, 0.75)');
    expect(heatColor(9, 10)).toBe('rgba(239, 68, 68, 0.75)');
  });
});

describe('HEAT_LEGEND', () => {
  it('has five distinct swatches ordered low → high', () => {
    expect(HEAT_LEGEND).toHaveLength(5);
    expect(new Set(HEAT_LEGEND).size).toBe(5);
  });

  it('aligns with heatColor at the floor and ceiling of the scale', () => {
    expect(HEAT_LEGEND[0]).toBe(heatColor(0, 10));
    expect(HEAT_LEGEND[HEAT_LEGEND.length - 1]).toBe(heatColor(10, 10));
    expect(HEAT_LEGEND).toContain('rgba(16, 185, 129, 0.4)');
  });
});

describe('aggregateLocations', () => {
  it('counts named places, keeps only repeats (≥2), and sorts by count desc', () => {
    const sessions = [
      makeSession({ start_place: 'Home' }),
      makeSession({ start_place: 'Home' }),
      makeSession({ start_place: 'Home' }),
      makeSession({ start_place: 'Work' }),
      makeSession({ start_place: 'Work' }),
      makeSession({ start_place: 'Cafe' }), // single visit → dropped
    ];
    expect(aggregateLocations(sessions, 'Unknown')).toEqual([
      { name: 'Home', count: 3 },
      { name: 'Work', count: 2 },
    ]);
  });

  it('groups null place names under the unknown label', () => {
    const sessions = [
      makeSession({ start_place: null }),
      makeSession({ start_place: null }),
    ];
    expect(aggregateLocations(sessions, 'Unknown')).toEqual([{ name: 'Unknown', count: 2 }]);
  });

  it('treats blank / whitespace-only places as unknown and trims to dedupe', () => {
    const blank = aggregateLocations(
      [makeSession({ start_place: '' }), makeSession({ start_place: '   ' })],
      'Unknown',
    );
    expect(blank).toEqual([{ name: 'Unknown', count: 2 }]);

    const trimmed = aggregateLocations(
      [makeSession({ start_place: 'Home' }), makeSession({ start_place: 'Home ' })],
      'Unknown',
    );
    expect(trimmed).toEqual([{ name: 'Home', count: 2 }]);
  });

  it('caps the result at the 10 most frequent locations', () => {
    const sessions = Array.from({ length: 11 }, (_, i) => [
      makeSession({ start_place: `Place ${i}` }),
      makeSession({ start_place: `Place ${i}` }),
    ]).flat();
    expect(aggregateLocations(sessions, 'Unknown')).toHaveLength(10);
  });

  it('is null-safe: undefined sessions yield an empty list without throwing', () => {
    expect(aggregateLocations(undefined as unknown as ChargingSession[], 'Unknown')).toEqual([]);
  });
});

describe('aggregateByDayOfWeek', () => {
  it('collapses the grid into 7 labelled Sun..Sat rows with per-day totals', () => {
    const model = buildGrid(scenarioSessions());
    const rows = aggregateByDayOfWeek(model, LABELS);

    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.day)).toEqual([...LABELS]);
    expect(rows[1]).toEqual({ day: 'Mon', count: 3, energyWh: 15_000 });
    expect(rows[0]).toEqual({ day: 'Sun', count: 1, energyWh: 8_000 });
    expect(rows[6]).toEqual({ day: 'Sat', count: 1, energyWh: 2_000 });
    expect(rows[2]).toEqual({ day: 'Tue', count: 0, energyWh: 0 });
  });

  it('falls back to the numeric day index when a label is missing', () => {
    const model = buildGrid([makeSession({ started_at: MON_10 })]);
    const rows = aggregateByDayOfWeek(model, ['Sun']); // only index 0 labelled
    expect(rows[1].day).toBe('1');
    expect(rows[1].count).toBe(1);
  });

  it('is null-safe: a null model yields an empty array without throwing', () => {
    expect(aggregateByDayOfWeek(null as unknown as HeatmapModel, LABELS)).toEqual([]);
  });
});

describe('deriveInsights', () => {
  it('derives busiest day/hour, the weekend split and active-slot count', () => {
    const insights = deriveInsights(buildGrid(scenarioSessions()));
    expect(insights.busiestDay).toBe(1); // Monday, 3 sessions
    expect(insights.busiestDayCount).toBe(3);
    expect(insights.busiestHour).toBe(10); // 3 (Mon) + 1 (Sat) at 10:00
    expect(insights.busiestHourCount).toBe(4);
    expect(insights.weekdayCount).toBe(3); // Mon only
    expect(insights.weekendCount).toBe(2); // Sun + Sat
    expect(insights.activeSlots).toBe(3); // 3 distinct weekday/hour slots
  });

  it('returns zeroed insights for an all-empty grid', () => {
    const insights = deriveInsights(buildGrid([]));
    expect(insights).toEqual({
      busiestDay: 0,
      busiestDayCount: 0,
      busiestHour: 0,
      busiestHourCount: 0,
      weekdayCount: 0,
      weekendCount: 0,
      activeSlots: 0,
    });
  });

  it('is null-safe: a null model yields zeroed insights without throwing', () => {
    const insights = deriveInsights(null as unknown as HeatmapModel);
    expect(insights.busiestDayCount).toBe(0);
    expect(insights.activeSlots).toBe(0);
  });
});

describe('formatHourLabel', () => {
  it('zero-pads single-digit hours', () => {
    expect(formatHourLabel(0)).toBe('00:00');
    expect(formatHourLabel(9)).toBe('09:00');
  });

  it('renders double-digit hours as-is', () => {
    expect(formatHourLabel(10)).toBe('10:00');
    expect(formatHourLabel(23)).toBe('23:00');
  });
});
