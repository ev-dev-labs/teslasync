import { describe, expect, it } from 'vitest';

import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import {
  analyzeCycleStress,
  DEPTH_STRESS_EXPONENT,
  extractRainflowCycles,
  type SocTurningPoint,
} from './cycleStress';

const NOW = Date.parse('2026-08-08T12:00:00.000Z');
let nextId = 1;

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: nextId++,
    vehicleId: 7,
    startTs: '2026-08-01T08:00:00.000Z',
    endTs: '2026-08-01T09:00:00.000Z',
    durationS: 3_600,
    distanceM: 20_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 37.1,
    startLon: -122.1,
    endLat: 37.2,
    endLon: -122.2,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: 4_000,
    regenEnergyWh: 300,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 5_000,
    outsideTempAvgC: 20,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

function session(
  overrides: Partial<ChargingSession> = {},
): ChargingSession {
  return {
    id: String(nextId++),
    vehicle_id: '7',
    charger_type: 'AC',
    start_soc_pct: 20,
    end_soc_pct: 80,
    total_energy_added_wh: 40_000,
    peak_power_w: null,
    cost_decimal: null,
    started_at: '2026-08-01T10:00:00.000Z',
    ended_at: '2026-08-01T11:00:00.000Z',
    start_ts: '2026-08-01T10:00:00.000Z',
    startedAt: '2026-08-01T10:00:00.000Z',
    duration_min: 60,
    ...overrides,
  };
}

function point(
  hour: number,
  socPct: number,
  segmentId = 1,
): SocTurningPoint {
  const ms = Date.parse('2026-08-01T00:00:00.000Z') + hour * 3_600_000;
  return {
    ms,
    timestamp: new Date(ms).toISOString(),
    socPct,
    source: hour % 2 === 0 ? 'drive' : 'charging',
    kind: hour % 2 === 0 ? 'start' : 'end',
    rowId: `row:${hour}`,
    segmentId,
  };
}

describe('analyzeCycleStress accounting', () => {
  it('puts every drive row into one primary category without synthesizing ends', () => {
    const result = analyzeCycleStress(
      [],
      [
        drive(),
        drive({ endTs: null, durationS: 600 }),
        drive({ startTs: 'bad' }),
        drive({
          startTs: '2026-08-02T10:00:00.000Z',
          endTs: '2026-08-02T09:00:00.000Z',
        }),
        drive({
          startTs: '2026-09-01T08:00:00.000Z',
          endTs: '2026-09-01T09:00:00.000Z',
        }),
        drive({ startBatteryPct: null }),
        drive({ endBatteryPct: 120 }),
        drive({ startBatteryPct: 60, endBatteryPct: 60 }),
      ],
      NOW,
      'UTC',
    );

    expect(result.driveAccounting.categories).toMatchObject({
      included: 1,
      incomplete_live: 1,
      invalid_timestamp_order: 2,
      future: 1,
      missing_soc: 1,
      invalid_soc: 1,
      nonpositive_soc_drop: 1,
    });
    expect(
      result.driveAccounting.includedRows
      + result.driveAccounting.excludedRows,
    ).toBe(result.driveAccounting.returnedRows);
  });

  it('puts every charging row into one primary category', () => {
    const result = analyzeCycleStress(
      [
        session(),
        session({ ended_at: null, duration_min: 30 }),
        session({ started_at: 'bad' }),
        session({
          started_at: '2026-08-02T10:00:00.000Z',
          ended_at: '2026-08-02T09:00:00.000Z',
        }),
        session({
          started_at: '2026-09-01T08:00:00.000Z',
          ended_at: '2026-09-01T09:00:00.000Z',
        }),
        session({ end_soc_pct: null }),
        session({ start_soc_pct: -1 }),
        session({ start_soc_pct: 60, end_soc_pct: 60 }),
      ],
      [],
      NOW,
      'UTC',
    );

    expect(result.chargingAccounting.categories).toMatchObject({
      included: 1,
      incomplete_live: 1,
      invalid_timestamp_order: 2,
      future: 1,
      missing_soc: 1,
      invalid_soc: 1,
      nonpositive_soc_gain: 1,
    });
  });

  it('rejects overlapping intervals deterministically', () => {
    const result = analyzeCycleStress(
      [
        session({
          started_at: '2026-08-01T08:30:00.000Z',
          ended_at: '2026-08-01T10:00:00.000Z',
        }),
      ],
      [drive()],
      NOW,
      'UTC',
    );

    expect(result.driveAccounting.categories.included).toBe(1);
    expect(
      result.chargingAccounting.categories.overlapping_interval,
    ).toBe(1);
    expect(result.continuity.overlappingIntervals).toBe(1);
  });
});

describe('continuity-bounded reconstruction', () => {
  it('starts a new segment across a long unobserved time gap', () => {
    const result = analyzeCycleStress(
      [
        session({
          started_at: '2026-08-01T10:00:00.000Z',
          ended_at: '2026-08-01T11:00:00.000Z',
          start_soc_pct: 60,
          end_soc_pct: 80,
        }),
        session({
          started_at: '2026-08-20T10:00:00.000Z',
          ended_at: '2026-08-20T11:00:00.000Z',
          start_soc_pct: 20,
          end_soc_pct: 70,
        }),
      ],
      [],
      NOW + 20 * 86_400_000,
      'UTC',
      { maxContinuityGapS: 7 * 86_400 },
    );

    expect(result.continuity.segmentCount).toBe(2);
    expect(result.continuity.timeGapBoundaries).toBe(1);
    expect(new Set(result.cycles.map((cycle) => cycle.segmentId)).size).toBe(2);
  });

  it('starts a new segment for an unexplained boundary SoC jump', () => {
    const result = analyzeCycleStress(
      [
        session({
          started_at: '2026-08-01T10:00:00.000Z',
          ended_at: '2026-08-01T11:00:00.000Z',
          start_soc_pct: 20,
          end_soc_pct: 40,
        }),
      ],
      [
        drive({
          startTs: '2026-08-01T12:00:00.000Z',
          endTs: '2026-08-01T13:00:00.000Z',
          startBatteryPct: 80,
          endBatteryPct: 60,
        }),
      ],
      NOW,
      'UTC',
      { maxBoundaryJumpPct: 5 },
    );

    expect(result.continuity.segmentCount).toBe(2);
    expect(result.continuity.socJumpBoundaries).toBe(1);
  });

  it('keeps a continuous charge-drive sequence in one segment', () => {
    const result = analyzeCycleStress(
      [
        session({
          started_at: '2026-08-01T10:00:00.000Z',
          ended_at: '2026-08-01T11:00:00.000Z',
          start_soc_pct: 20,
          end_soc_pct: 80,
        }),
      ],
      [
        drive({
          startTs: '2026-08-01T12:00:00.000Z',
          endTs: '2026-08-01T13:00:00.000Z',
          startBatteryPct: 79,
          endBatteryPct: 30,
        }),
      ],
      NOW,
      'UTC',
    );

    expect(result.continuity.segmentCount).toBe(1);
    expect(result.continuity.socJumpBoundaries).toBe(0);
    expect(result.turningPoints.map((turn) => turn.socPct)).toEqual([
      20, 80, 30,
    ]);
  });
});

describe('extractRainflowCycles', () => {
  it('leaves an unresolved full-depth excursion as two half cycles', () => {
    const cycles = extractRainflowCycles([
      point(0, 0),
      point(1, 100),
      point(2, 0),
    ]);

    expect(cycles.map((cycle) => cycle.count)).toEqual([0.5, 0.5]);
    expect(
      cycles.reduce(
        (sum, cycle) => sum + cycle.equivalentFullCycles,
        0,
      ),
    ).toBe(1);
  });

  it('closes an inner range and preserves boundary half cycles', () => {
    const cycles = extractRainflowCycles([
      point(0, 0),
      point(1, 100),
      point(2, 20),
      point(3, 80),
      point(4, 0),
    ]);

    expect(
      cycles
        .filter((cycle) => cycle.count === 1)
        .map((cycle) => cycle.depthPct),
    ).toEqual([60]);
    expect(
      cycles.reduce(
        (sum, cycle) => sum + cycle.equivalentFullCycles,
        0,
      ),
    ).toBeCloseTo(1.6);
  });

  it('applies the configured illustrative exponent', () => {
    const cycles = extractRainflowCycles(
      [point(0, 0), point(1, 50), point(2, 0)],
      DEPTH_STRESS_EXPONENT,
    );
    const index = cycles.reduce(
      (sum, cycle) => sum + cycle.depthWeightedIndex,
      0,
    );

    expect(index).toBeCloseTo(0.5 ** DEPTH_STRESS_EXPONENT);
    expect(index).toBeLessThan(0.5);
  });
});

describe('Cycle Stress analytical surfaces', () => {
  function mixedHistory() {
    return {
      sessions: [
        session({
          started_at: '2026-07-01T10:00:00.000Z',
          ended_at: '2026-07-01T11:00:00.000Z',
          start_soc_pct: 20,
          end_soc_pct: 90,
        }),
        session({
          started_at: '2026-08-01T10:00:00.000Z',
          ended_at: '2026-08-01T11:00:00.000Z',
          start_soc_pct: 30,
          end_soc_pct: 80,
        }),
      ],
      drives: [
        drive({
          startTs: '2026-07-01T12:00:00.000Z',
          endTs: '2026-07-01T13:00:00.000Z',
          startBatteryPct: 89,
          endBatteryPct: 31,
        }),
        drive({
          startTs: '2026-08-01T12:00:00.000Z',
          endTs: '2026-08-01T13:00:00.000Z',
          startBatteryPct: 79,
          endBatteryPct: 25,
        }),
      ],
    };
  }

  it('builds distribution, trend, threshold, exponent, mean-SoC, and duration evidence', () => {
    const history = mixedHistory();
    const result = analyzeCycleStress(
      history.sessions,
      history.drives,
      NOW,
      'UTC',
    );

    expect(result.summary.weightedCycleCount).toBeGreaterThan(0);
    expect(result.histogram).toHaveLength(5);
    expect(result.monthTrend.map((point) => point.monthKey)).toEqual([
      '2026-07',
      '2026-08',
    ]);
    expect(result.thresholdSensitivity).toHaveLength(5);
    expect(result.exponentSensitivity).toHaveLength(4);
    expect(result.meanSocProfile).toHaveLength(5);
    expect(result.durationProfile).toHaveLength(4);
  });

  it('uses vehicle-local cycle closure months', () => {
    const result = analyzeCycleStress(
      [
        session({
          started_at: '2026-03-01T07:00:00.000Z',
          ended_at: '2026-03-01T07:30:00.000Z',
          start_soc_pct: 20,
          end_soc_pct: 80,
        }),
      ],
      [],
      NOW,
      'America/Los_Angeles',
    );

    expect(result.monthTrend[0]?.monthKey).toBe('2026-02');
  });

  it('counts active weeks from accepted endpoints before monotone compaction', () => {
    const result = analyzeCycleStress(
      [
        session({
          id: 'week-1',
          started_at: '2026-01-01T10:00:00.000Z',
          ended_at: '2026-01-01T11:00:00.000Z',
          start_soc_pct: 20,
          end_soc_pct: 30,
        }),
        session({
          id: 'week-2',
          started_at: '2026-01-08T10:00:00.000Z',
          ended_at: '2026-01-08T11:00:00.000Z',
          start_soc_pct: 30,
          end_soc_pct: 40,
        }),
        session({
          id: 'week-3',
          started_at: '2026-01-15T10:00:00.000Z',
          ended_at: '2026-01-15T11:00:00.000Z',
          start_soc_pct: 40,
          end_soc_pct: 50,
        }),
      ],
      [],
      NOW,
      'UTC',
    );

    expect(result.turningPoints).toHaveLength(2);
    expect(result.coverage.activeLocalDays).toBe(3);
    expect(result.coverage.activeLocalWeeks).toBe(3);
  });

  it('falls back to UTC for an invalid timezone', () => {
    const result = analyzeCycleStress([], [], NOW, 'Nope/Zone');
    expect(result.timeZone).toBe('UTC');
  });

  it('shows how threshold and exponent choices change the index', () => {
    const history = mixedHistory();
    const result = analyzeCycleStress(
      history.sessions,
      history.drives,
      NOW,
      'UTC',
      { deepThresholdPct: 70, exponent: 2 },
    );

    expect(
      result.thresholdSensitivity.find(
        (point) => point.thresholdPct === 70,
      ),
    ).toBeDefined();
    expect(
      result.exponentSensitivity.find(
        (point) => point.exponent === 2,
      )?.depthWeightedIndex,
    ).toBeCloseTo(result.summary.depthWeightedIndex);
  });

  it('limits timeline and recent-cycle surfaces without dropping totals', () => {
    const sessions = Array.from({ length: 12 }, (_, index) =>
      session({
        id: String(index),
        started_at: new Date(
          Date.parse('2026-01-01T00:00:00.000Z')
            + index * 2 * 3_600_000,
        ).toISOString(),
        ended_at: new Date(
          Date.parse('2026-01-01T00:00:00.000Z')
            + (index * 2 + 1) * 3_600_000,
        ).toISOString(),
        start_soc_pct: index % 2 === 0 ? 20 : 40,
        end_soc_pct: index % 2 === 0 ? 80 : 90,
      }),
    );
    const result = analyzeCycleStress(
      sessions,
      [],
      NOW,
      'UTC',
      { maxTimelinePoints: 10, maxRecentCycles: 3 },
    );

    expect(result.timeline).toHaveLength(10);
    expect(result.coverage.omittedTimelinePoints).toBeGreaterThan(0);
    expect(result.recentCycles).toHaveLength(3);
    expect(result.cycles.length).toBeGreaterThan(3);
  });

  it('discloses source caps and asymmetric overlap', () => {
    const result = analyzeCycleStress(
      [session()],
      [drive()],
      NOW,
      'UTC',
      { historyLimit: 1 },
    );

    expect(result.chargingAccounting.historyCapReached).toBe(true);
    expect(result.driveAccounting.historyCapReached).toBe(true);
    expect(result.coverage.commonSourceOverlapDays).toBeNull();
  });

  it('returns explicit empty evidence without fabricated cycles', () => {
    const result = analyzeCycleStress([], [], NOW, 'UTC');

    expect(result.turningPoints).toEqual([]);
    expect(result.cycles).toEqual([]);
    expect(result.summary).toMatchObject({
      weightedCycleCount: 0,
      equivalentFullCycles: 0,
      depthWeightedIndex: 0,
      meanDepthPct: null,
      deepCycleShare: null,
    });
    expect(result.coverage.support).toMatchObject({
      index: 0,
      band: 'none',
    });
  });

  it('does not mutate either returned history array', () => {
    const sessions = [session()];
    const drives = [drive()];
    const sessionSnapshot = structuredClone(sessions);
    const driveSnapshot = structuredClone(drives);

    analyzeCycleStress(sessions, drives, NOW, 'UTC');

    expect(sessions).toEqual(sessionSnapshot);
    expect(drives).toEqual(driveSnapshot);
  });

  it('rejects a non-finite analysis clock', () => {
    expect(() =>
      analyzeCycleStress([], [], NaN, 'UTC'),
    ).toThrow(RangeError);
  });
});
