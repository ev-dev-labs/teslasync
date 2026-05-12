import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/api/types';
import {
  getChargerCategory,
  durationMinutes,
  avgPowerW,
  costPerKwh,
  computeChargingPeriodStats,
  batteryFriendlyScore,
  detectChargingAnomalies,
  detectNotableSessions,
  dailyChargingTrend,
  priorPeriod,
} from '../chargingAggregation';

function s(overrides: Partial<ChargingSession>): ChargingSession {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: '2026-04-15T10:00:00Z',
    ended_at: '2026-04-15T11:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 30_000,
    peak_power_w: 30_000,
    avg_power_w: 28_000,
    cost_decimal: 5,
    cost_currency: 'USD',
    charger_type: 'AC/Home',
    cable_type: null,
    startedAt: '2026-04-15T10:00:00Z',
    duration_min: 60,
    ...overrides,
  };
}

describe('getChargerCategory', () => {
  it.each([
    ['Tesla Supercharger V3', 'supercharger'],
    ['Supercharger',          'supercharger'],
    ['CCS DC Fast',           'dc'],
    ['ChaDeMo',               'dc'],
    ['DC Fast Charger',       'dc'],
    ['Home AC',               'home'],
    ['Wall Connector',        'home'],
    ['Mystery brand',         'unknown'],
    [null,                    'home'],
    [undefined,               'home'],
  ] as const)('maps %p → %s', (raw, expected) => {
    expect(getChargerCategory(raw)).toBe(expected);
  });
});

describe('durationMinutes', () => {
  it('returns minutes for a valid range', () => {
    expect(durationMinutes(s({ started_at: '2026-04-15T10:00:00Z', ended_at: '2026-04-15T11:30:00Z' }))).toBe(90);
  });
  it('returns 0 for in-progress sessions', () => {
    expect(durationMinutes(s({ ended_at: null }))).toBe(0);
  });
  it('returns 0 when ended_at is before started_at', () => {
    expect(durationMinutes(s({ started_at: '2026-04-15T11:00:00Z', ended_at: '2026-04-15T10:00:00Z' }))).toBe(0);
  });
  it('returns 0 for malformed timestamps', () => {
    expect(durationMinutes(s({ started_at: 'oops', ended_at: 'oops' }))).toBe(0);
  });
});

describe('avgPowerW', () => {
  it('computes from total energy / duration when both are present', () => {
    // 30 kWh in 1h → 30 kW = 30,000 W
    expect(avgPowerW(s({ total_energy_added_wh: 30_000 }))).toBe(30_000);
  });
  it('falls back to API avg_power_w when duration is unusable', () => {
    expect(avgPowerW(s({ ended_at: null, avg_power_w: 22_000 }))).toBe(22_000);
  });
  it('returns 0 when neither path is computable', () => {
    expect(avgPowerW(s({ ended_at: null, avg_power_w: null }))).toBe(0);
  });
});

describe('costPerKwh', () => {
  it('returns dollars per kWh for a paid session', () => {
    // $5 / 30 kWh = $0.1667/kWh
    expect(costPerKwh(s({ cost_decimal: 5, total_energy_added_wh: 30_000 }))).toBeCloseTo(0.1667, 3);
  });
  it('returns null when free', () => {
    expect(costPerKwh(s({ cost_decimal: 0 }))).toBeNull();
    expect(costPerKwh(s({ cost_decimal: null }))).toBeNull();
  });
  it('returns null when no energy was delivered', () => {
    expect(costPerKwh(s({ total_energy_added_wh: 0 }))).toBeNull();
  });
});

describe('computeChargingPeriodStats', () => {
  const sessions = [
    s({ id: 1, total_energy_added_wh: 20_000, cost_decimal: 4, charger_type: 'Supercharger', started_at: '2026-04-15T08:00:00Z', ended_at: '2026-04-15T09:00:00Z', start_soc_pct: 20, end_soc_pct: 80 }),
    s({ id: 2, total_energy_added_wh: 30_000, cost_decimal: 0, charger_type: 'Home AC',      started_at: '2026-04-15T22:00:00Z', ended_at: '2026-04-16T06:00:00Z', start_soc_pct: 30, end_soc_pct: 100 }),
    s({ id: 3, total_energy_added_wh: 50_000, cost_decimal: 12, charger_type: 'DC Fast',     started_at: '2026-04-20T08:00:00Z', ended_at: '2026-04-20T08:30:00Z', start_soc_pct: 10, end_soc_pct: 80 }),
  ];

  it('counts sessions and sums energy / cost', () => {
    const stats = computeChargingPeriodStats(sessions);
    expect(stats.count).toBe(3);
    expect(stats.totalEnergyWh).toBe(100_000);
    expect(stats.totalCost).toBe(16);
  });

  it('respects the date range filter', () => {
    const stats = computeChargingPeriodStats(sessions, '2026-04-15', '2026-04-15');
    // Session 2 spans midnight UTC (started 22:00) → started_at day = 2026-04-15
    // Session 3 (Apr 20) → out of range
    expect(stats.count).toBe(2);
  });

  it('counts free sessions', () => {
    const stats = computeChargingPeriodStats(sessions);
    expect(stats.freeCount).toBe(1);
  });

  it('breaks down by category', () => {
    const stats = computeChargingPeriodStats(sessions);
    expect(stats.byCategory.supercharger).toBe(1);
    expect(stats.byCategory.home).toBe(1);
    expect(stats.byCategory.dc).toBe(1);
  });

  it('reports avgRateKw based on total energy and duration', () => {
    // 100 kWh in 9.5 h → ~10.5 kW
    const stats = computeChargingPeriodStats(sessions);
    expect(stats.avgRateKw).toBeCloseTo(100 / 9.5, 1);
  });

  it('returns count=0 and avg=null for empty windows', () => {
    const stats = computeChargingPeriodStats([]);
    expect(stats.count).toBe(0);
    expect(stats.avgRateKw).toBeNull();
    expect(stats.batteryFriendlyScore).toBeNull();
  });
});

describe('batteryFriendlyScore', () => {
  it('rewards low-start, sweet-spot finish', () => {
    const score = batteryFriendlyScore([
      s({ start_soc_pct: 20, end_soc_pct: 80 }),
    ]);
    expect(score).toBeGreaterThanOrEqual(95);
  });

  it('penalises 100% charges', () => {
    const score = batteryFriendlyScore([
      s({ start_soc_pct: 20, end_soc_pct: 100 }),
    ]);
    // 50 (base) + 30 (low start) - 25 (100% finish) = 55
    expect(score).toBeCloseTo(55, 1);
  });

  it('penalises starting from a high SoC', () => {
    const score = batteryFriendlyScore([
      s({ start_soc_pct: 80, end_soc_pct: 90 }),
    ]);
    // 50 - 10 (high start) + 0 (≤ 90%) = 40
    expect(score).toBeCloseTo(40, 1);
  });

  it('returns null when no sessions have SoC data', () => {
    const score = batteryFriendlyScore([
      s({ start_soc_pct: null as unknown as number, end_soc_pct: null }),
    ]);
    expect(score).toBeNull();
  });
});

describe('detectChargingAnomalies', () => {
  it('flags telemetry gap (energy ≈ 0, duration > 5m)', () => {
    const anomalies = detectChargingAnomalies([
      s({ id: 1, total_energy_added_wh: 0, started_at: '2026-04-15T10:00:00Z', ended_at: '2026-04-15T10:30:00Z' }),
    ]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].kind).toBe('telemetry_gap');
  });

  it('flags cost_zero (energy added but no cost) on non-home chargers', () => {
    const anomalies = detectChargingAnomalies([
      s({ id: 1, total_energy_added_wh: 30_000, cost_decimal: null, charger_type: 'Supercharger' }),
    ]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].kind).toBe('cost_zero');
  });

  it('does NOT flag cost_zero on home chargers (free is normal)', () => {
    const anomalies = detectChargingAnomalies([
      s({ id: 1, total_energy_added_wh: 30_000, cost_decimal: null, charger_type: 'Home AC' }),
    ]);
    expect(anomalies).toHaveLength(0);
  });

  it('flags expensive charges (cost/kWh > threshold)', () => {
    // $20 / 30 kWh = $0.667/kWh > $0.50 default threshold
    const anomalies = detectChargingAnomalies([
      s({ id: 1, total_energy_added_wh: 30_000, cost_decimal: 20, charger_type: 'Supercharger' }),
    ]);
    expect(anomalies[0].kind).toBe('expensive');
  });

  it('flags trickle charges (very long, very low power)', () => {
    // 7h, 1 kWh → 0.14 kW avg
    const anomalies = detectChargingAnomalies([
      s({
        id: 1,
        started_at: '2026-04-15T00:00:00Z',
        ended_at:   '2026-04-15T07:00:00Z',
        total_energy_added_wh: 1_000,
        charger_type: 'Home AC',
        cost_decimal: 0.50,
      }),
    ]);
    expect(anomalies[0].kind).toBe('trickle');
  });

  it('respects custom thresholds', () => {
    const anomalies = detectChargingAnomalies(
      [s({ id: 1, total_energy_added_wh: 30_000, cost_decimal: 10, charger_type: 'Supercharger' })],
      { expensiveCostPerKwh: 0.20 },
    );
    expect(anomalies[0].kind).toBe('expensive');
  });

  it('produces at most one anomaly per session (priority order)', () => {
    // Telemetry gap takes priority over expensive (no kWh added → no cpk).
    const anomalies = detectChargingAnomalies([
      s({ id: 1, total_energy_added_wh: 0, cost_decimal: 100, started_at: '2026-04-15T10:00:00Z', ended_at: '2026-04-15T10:30:00Z' }),
    ]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].kind).toBe('telemetry_gap');
  });
});

describe('detectNotableSessions', () => {
  it('returns top-decile by energy', () => {
    const list: ChargingSession[] = Array.from({ length: 20 }, (_, i) =>
      s({ id: i + 1, total_energy_added_wh: (i + 1) * 1_000 }),
    );
    const notable = detectNotableSessions(list);
    // top decile of 20 = 2; both sorted descending by energy → ids 19 and 20
    const ids = notable.map((n) => n.id).sort((a, b) => a - b);
    expect(ids).toContain(19);
    expect(ids).toContain(20);
  });

  it('always includes ≥150 kW peak sessions', () => {
    const list: ChargingSession[] = [
      s({ id: 1, total_energy_added_wh: 10_000, peak_power_w: 200_000 }),
      s({ id: 2, total_energy_added_wh: 5_000,  peak_power_w: 7_000 }),
      s({ id: 3, total_energy_added_wh: 5_000,  peak_power_w: 7_000 }),
    ];
    const ids = detectNotableSessions(list).map((n) => n.id);
    expect(ids).toContain(1);
  });

  it('returns [] for empty input', () => {
    expect(detectNotableSessions([])).toEqual([]);
  });
});

describe('dailyChargingTrend', () => {
  const sessions = [
    s({ id: 1, started_at: '2026-04-15T10:00:00Z', ended_at: '2026-04-15T11:00:00Z', total_energy_added_wh: 20_000, cost_decimal: 4 }),
    s({ id: 2, started_at: '2026-04-15T18:00:00Z', ended_at: '2026-04-15T19:00:00Z', total_energy_added_wh: 30_000, cost_decimal: 6 }),
    s({ id: 3, started_at: '2026-04-16T09:00:00Z', ended_at: '2026-04-16T09:30:00Z', total_energy_added_wh: 40_000, cost_decimal: 12 }),
  ];

  it('counts sessions per day', () => {
    const points = dailyChargingTrend(sessions, 'sessions');
    expect(points.find((p) => p.date === '2026-04-15')!.value).toBe(2);
    expect(points.find((p) => p.date === '2026-04-16')!.value).toBe(1);
  });

  it('sums energy per day in kWh', () => {
    const points = dailyChargingTrend(sessions, 'energy');
    expect(points.find((p) => p.date === '2026-04-15')!.value).toBeCloseTo(50, 6);
    expect(points.find((p) => p.date === '2026-04-16')!.value).toBeCloseTo(40, 6);
  });

  it('sums cost per day', () => {
    const points = dailyChargingTrend(sessions, 'cost');
    expect(points.find((p) => p.date === '2026-04-15')!.value).toBeCloseTo(10, 6);
  });

  it('averages power per day in kW', () => {
    const points = dailyChargingTrend(sessions, 'power');
    // Day 1: avg power of (20kW, 30kW) = 25 kW
    expect(points.find((p) => p.date === '2026-04-15')!.value).toBeCloseTo(25, 1);
    // Day 2: 40 kWh in 0.5h = 80 kW
    expect(points.find((p) => p.date === '2026-04-16')!.value).toBeCloseTo(80, 1);
  });

  it('returns empty array for empty input', () => {
    expect(dailyChargingTrend([], 'sessions')).toEqual([]);
  });
});

describe('re-export: priorPeriod', () => {
  it('is re-exported from drivesAggregation', () => {
    expect(priorPeriod('2026-04-13', '2026-05-12')).toEqual({
      start: '2026-03-14',
      end: '2026-04-12',
    });
  });
});
