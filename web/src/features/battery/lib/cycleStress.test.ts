import { describe, expect, it } from 'vitest';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import {
  DEPTH_STRESS_EXPONENT,
  buildSocTurningPoints,
  extractRainflowCycles,
  summarizeCycleStress,
  type SocTurningPoint,
} from './cycleStress';

const BASE = Date.UTC(2026, 0, 1);

function point(day: number, socPct: number): SocTurningPoint {
  const ms = BASE + day * 86_400_000;
  return { ms, timestamp: new Date(ms).toISOString(), socPct };
}

function drive(over: Partial<Drive>): Drive {
  return {
    id: 1,
    vehicleId: 1,
    startTs: new Date(BASE).toISOString(),
    endTs: new Date(BASE + 3_600_000).toISOString(),
    durationS: 3600,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: 10_000,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function session(over: Partial<ChargingSession>): ChargingSession {
  return {
    id: '1',
    vehicle_id: '1',
    charger_type: 'AC',
    start_soc_pct: 20,
    end_soc_pct: 80,
    total_energy_added_wh: 40_000,
    peak_power_w: null,
    cost_decimal: null,
    started_at: new Date(BASE).toISOString(),
    ended_at: new Date(BASE + 3_600_000).toISOString(),
    start_ts: new Date(BASE).toISOString(),
    startedAt: new Date(BASE).toISOString(),
    duration_min: 60,
    ...over,
  };
}

describe('buildSocTurningPoints', () => {
  it('sorts mixed event boundaries and removes monotone intermediate points', () => {
    const sessions = [
      session({
        started_at: new Date(BASE + 4 * 3_600_000).toISOString(),
        ended_at: new Date(BASE + 5 * 3_600_000).toISOString(),
        start_soc_pct: 40,
        end_soc_pct: 80,
      }),
    ];
    const drives = [
      drive({
        startTs: new Date(BASE + 2 * 3_600_000).toISOString(),
        endTs: new Date(BASE + 3 * 3_600_000).toISOString(),
        startBatteryPct: 70,
        endBatteryPct: 40,
      }),
      drive({
        startTs: new Date(BASE).toISOString(),
        endTs: new Date(BASE + 3_600_000).toISOString(),
        startBatteryPct: 90,
        endBatteryPct: 80,
      }),
    ];
    expect(buildSocTurningPoints(sessions, drives).map((row) => row.socPct)).toEqual([
      90, 40, 80,
    ]);
  });

  it('derives missing endpoint timestamps from SI drive duration and session duration', () => {
    const turns = buildSocTurningPoints(
      [session({ ended_at: null, duration_min: 30, start_soc_pct: 20, end_soc_pct: 50 })],
      [drive({ startTs: new Date(BASE + 3_600_000).toISOString(), endTs: null, durationS: 600 })],
    );
    expect(turns.every((row) => Number.isFinite(row.ms))).toBe(true);
    expect(turns[0]!.ms).toBe(BASE);
  });

  it('ignores invalid timestamps and SoC values', () => {
    expect(
      buildSocTurningPoints(
        [session({ started_at: 'bad', start_soc_pct: -1, end_soc_pct: 101 })],
        [drive({ startTs: 'bad', startBatteryPct: null, endBatteryPct: Number.NaN })],
      ),
    ).toEqual([]);
  });
});

describe('extractRainflowCycles', () => {
  it('leaves an unresolved 100% excursion as two half cycles', () => {
    const cycles = extractRainflowCycles([point(0, 0), point(1, 100), point(2, 0)]);
    expect(cycles.map((cycle) => cycle.count)).toEqual([0.5, 0.5]);
    expect(cycles.reduce((sum, cycle) => sum + cycle.equivalentFullCycles, 0)).toBe(1);
  });

  it('closes an inner range as a full cycle and keeps outer boundaries as halves', () => {
    const cycles = extractRainflowCycles([
      point(0, 0),
      point(1, 100),
      point(2, 20),
      point(3, 80),
      point(4, 0),
    ]);
    expect(cycles.filter((cycle) => cycle.count === 1).map((cycle) => cycle.depthPct)).toEqual([
      60,
    ]);
    expect(cycles.reduce((sum, cycle) => sum + cycle.equivalentFullCycles, 0)).toBeCloseTo(
      1.6,
    );
  });

  it('applies nonlinear depth stress while preserving one full-depth normalization', () => {
    const cycles = extractRainflowCycles([point(0, 0), point(1, 50), point(2, 0)]);
    const stress = cycles.reduce((sum, cycle) => sum + cycle.stressEquivalentCycles, 0);
    expect(stress).toBeCloseTo(0.5 ** DEPTH_STRESS_EXPONENT);
    expect(stress).toBeLessThan(0.5);
  });
});

describe('summarizeCycleStress', () => {
  it('returns weighted mean depth, deep share, histogram, and monthly trend', () => {
    const sessions = [
      session({
        started_at: '2026-01-01T00:00:00Z',
        ended_at: '2026-01-01T01:00:00Z',
        start_soc_pct: 10,
        end_soc_pct: 90,
      }),
      session({
        id: '2',
        started_at: '2026-02-01T00:00:00Z',
        ended_at: '2026-02-01T01:00:00Z',
        start_soc_pct: 30,
        end_soc_pct: 70,
      }),
    ];
    const drives = [
      drive({
        startTs: '2026-01-02T00:00:00Z',
        endTs: '2026-01-02T01:00:00Z',
        startBatteryPct: 90,
        endBatteryPct: 30,
      }),
      drive({
        id: 2,
        startTs: '2026-02-02T00:00:00Z',
        endTs: '2026-02-02T01:00:00Z',
        startBatteryPct: 70,
        endBatteryPct: 20,
      }),
    ];
    const result = summarizeCycleStress(sessions, drives);
    expect(result.weightedCycleCount).toBeGreaterThan(0);
    expect(result.meanDepthPct).toBeGreaterThan(0);
    expect(result.deepCycleShare).not.toBeNull();
    expect(result.histogram).toHaveLength(5);
    expect(result.recentTrend.map((row) => row.month)).toEqual(['2026-01', '2026-02']);
    expect(result.stressEquivalentCycles).toBeLessThan(result.equivalentFullCycles);
  });

  it('is explicit and null-safe without observations', () => {
    const result = summarizeCycleStress([], []);
    expect(result.cycles).toEqual([]);
    expect(result.equivalentFullCycles).toBe(0);
    expect(result.meanDepthPct).toBeNull();
    expect(result.deepCycleShare).toBeNull();
    expect(result.recentTrend).toEqual([]);
  });

  it('limits the recent trend to twelve continuous months', () => {
    const turns = Array.from({ length: 15 }, (_, index) =>
      point(index * 31, index % 2 === 0 ? 20 : 80),
    );
    const cycles = extractRainflowCycles(turns);
    expect(cycles.length).toBeGreaterThan(0);
    const sessions = turns.slice(0, -1).map((turn, index) =>
      session({
        id: String(index),
        started_at: turn.timestamp,
        ended_at: turns[index + 1]!.timestamp,
        start_soc_pct: turn.socPct,
        end_soc_pct: turns[index + 1]!.socPct,
      }),
    );
    expect(summarizeCycleStress(sessions, []).recentTrend.length).toBeLessThanOrEqual(12);
  });
});
