/**
 * charging-curve/types — contract tests for the Charging Curve view-models.
 *
 * This module is *type-only*: every export is an `interface`, erased at runtime.
 * A smoke render proves nothing here, so — following the repo convention for
 * type modules (see features/automations/components/stepInputTypes.test.ts) —
 * this suite enforces the contracts on two levels:
 *
 *   • Runtime (`expect`)      — the *shape + producer contract*. `CurvePoint`
 *     is driven through its REAL producer `generateChargingCurve` (DC taper vs
 *     AC-flat vs null-default branches, the `power >= 0` floor). The aggregate
 *     view-models are built with the SAME real helpers (`avg`,
 *     `durationMinutes`, `getChargerLabel`) their components use, so the
 *     assertions verify real construction math rather than a hand-typed echo.
 *   • Compile-time (`expectTypeOf`) — the *type identities*: each export equals
 *     its documented shape, the `| null` unions are preserved, and the extracted
 *     `YearlyTrendPoint` is byte-for-byte the element `TimeToChargeMetrics`
 *     carries (the DRY contract `YearlyTrendChart` now depends on). These are
 *     runtime no-ops; the production `tsc --noEmit` gate enforces them.
 *
 * No network, no DOM — pure structural assertions, so no MSW/QueryClient harness.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { ChargingSession } from '@/api/types';
import {
  avg,
  durationMinutes,
  generateChargingCurve,
  getChargerLabel,
  isDcSession,
} from './helpers';
import type {
  ChargeRatePoint,
  ChargerTypeStats,
  CurvePoint,
  MonthlySpeed,
  SummaryStats,
  TimeToChargeMetrics,
  YearlyTrendPoint,
} from './types';

/**
 * Full, valid `ChargingSession` fixture. Every non-optional field is set so the
 * object is assignable without an `as` cast; overrides tweak only what a test
 * cares about. Defaults describe a 30-minute 10%→80% Supercharger session.
 */
function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: '2024-01-01T10:00:00Z',
    ended_at: '2024-01-01T10:30:00Z',
    start_soc_pct: 10,
    end_soc_pct: 80,
    delta_soc_pct: 70,
    start_odometer_m: 100_000,
    end_odometer_m: 100_000,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 40_000,
    peak_power_w: 150_000,
    avg_power_w: 120_000,
    cost_decimal: 12.5,
    cost_currency: 'USD',
    charger_type: 'Tesla',
    cable_type: null,
    startedAt: '2024-01-01T10:00:00Z',
    duration_min: 30,
    ...overrides,
  };
}

const powerAt = (curve: CurvePoint[], soc: number): number | undefined =>
  curve.find((p) => p.soc === soc)?.power;

// ── CurvePoint — via its real producer generateChargingCurve ──────────────────

describe('CurvePoint (generateChargingCurve producer)', () => {
  it('spans the session SOC window with numeric {soc, power} points', () => {
    const curve = generateChargingCurve(
      makeSession({ start_soc_pct: 10, end_soc_pct: 80, charger_type: 'Tesla' }),
    );

    expect(curve).toHaveLength(71); // inclusive 10..80
    expect(curve[0]).toEqual({ soc: 10, power: 150 });
    expect(curve[curve.length - 1].soc).toBe(80);
    for (const point of curve) {
      expect(typeof point.soc).toBe('number');
      expect(typeof point.power).toBe('number');
    }
    // Shape identity for the emitted element.
    expectTypeOf(curve[0]).toEqualTypeOf<CurvePoint>();
  });

  it('tapers DC power above 50% SOC and never drops below zero', () => {
    const session = makeSession({
      start_soc_pct: 10,
      end_soc_pct: 100,
      peak_power_w: 150_000,
      charger_type: 'Tesla',
    });
    expect(isDcSession(session)).toBe(true);

    const curve = generateChargingCurve(session);
    expect(powerAt(curve, 50)).toBe(150); // full power through the knee
    expect(powerAt(curve, 80)).toBeCloseTo(75, 5); // 150 * 0.5
    expect(powerAt(curve, 100)).toBeCloseTo(22.5, 5); // 150 * 0.5 * 0.3

    expect(powerAt(curve, 100)!).toBeLessThan(powerAt(curve, 50)!);
    expect(curve.every((p) => p.power >= 0 && Number.isFinite(p.power))).toBe(true);
  });

  it('holds AC power flat at the session peak (no taper)', () => {
    const session = makeSession({
      start_soc_pct: 20,
      end_soc_pct: 90,
      peak_power_w: 11_000, // <= 20kW and no charger_type => AC
      charger_type: null,
    });
    expect(isDcSession(session)).toBe(false);

    const curve = generateChargingCurve(session);
    expect(curve).toHaveLength(71); // inclusive 20..90
    expect(curve.every((p) => p.power === 11)).toBe(true);
  });

  it('applies null-safe defaults (0→100 window @ 11 kW) for missing metadata', () => {
    // peak_power_w null -> 11 kW default; end_soc_pct null -> 100.
    const curve = generateChargingCurve(
      makeSession({ start_soc_pct: 0, end_soc_pct: null, peak_power_w: null, charger_type: null }),
    );

    expect(curve[0].soc).toBe(0);
    expect(curve[curve.length - 1].soc).toBe(100);
    expect(curve.every((p) => p.power === 11)).toBe(true);
    expectTypeOf<CurvePoint>().toEqualTypeOf<{ soc: number; power: number }>();
  });
});

// ── ChargerTypeStats — mirror the ChargerTypeChart reducer ────────────────────

describe('ChargerTypeStats', () => {
  const items = [
    makeSession({
      id: 1,
      charger_type: 'Tesla',
      peak_power_w: 150_000,
      total_energy_added_wh: 40_000,
      started_at: '2024-01-01T10:00:00Z',
      ended_at: '2024-01-01T10:30:00Z',
    }),
    makeSession({
      id: 2,
      charger_type: 'Tesla',
      peak_power_w: 120_000,
      total_energy_added_wh: 30_000,
      started_at: '2024-01-01T12:00:00Z',
      ended_at: '2024-01-01T12:20:00Z',
    }),
  ];

  it('aggregates a charger category using the real helper math', () => {
    const stat: ChargerTypeStats = {
      label: getChargerLabel(items[0]),
      count: items.length,
      avgKw: avg(items.map((s) => (s.peak_power_w ?? 0) / 1000)),
      avgKwh: avg(items.map((s) => s.total_energy_added_wh / 1000)),
      avgDuration: avg(items.map((s) => durationMinutes(s.started_at, s.ended_at))),
    };

    expect(stat).toEqual({
      label: 'Supercharger',
      count: 2,
      avgKw: 135, // (150 + 120) / 2
      avgKwh: 35, // (40 + 30) / 2
      avgDuration: 25, // (30 + 20) / 2
    });
  });

  it('exposes exactly the five typed fields', () => {
    const stat: ChargerTypeStats = {
      label: 'Home / AC',
      count: 0,
      avgKw: 0,
      avgKwh: 0,
      avgDuration: 0,
    };

    expect(Object.keys(stat).sort()).toEqual([
      'avgDuration',
      'avgKw',
      'avgKwh',
      'count',
      'label',
    ]);
    expectTypeOf<ChargerTypeStats>().toEqualTypeOf<{
      label: string;
      count: number;
      avgKw: number;
      avgKwh: number;
      avgDuration: number;
    }>();
  });
});

// ── MonthlySpeed — mirror the SpeedTrendChart reducer ─────────────────────────

describe('MonthlySpeed', () => {
  it('rounds DC/AC monthly averages to one decimal (kW)', () => {
    const dcKw = [150_000, 120_000].map((w) => w / 1000); // convertPowerFromSI(w,'kW')
    const acKw = [11_000].map((w) => w / 1000);
    const month: MonthlySpeed = {
      month: '2024-01',
      dcAvgKw: Math.round(avg(dcKw) * 10) / 10,
      acAvgKw: Math.round(avg(acKw) * 10) / 10,
    };

    expect(month).toEqual({ month: '2024-01', dcAvgKw: 135, acAvgKw: 11 });
    expectTypeOf<MonthlySpeed>().toEqualTypeOf<{
      month: string;
      dcAvgKw: number;
      acAvgKw: number;
    }>();
  });

  it('collapses an empty AC (or DC) bucket to 0 rather than NaN', () => {
    // avg([]) === 0, so a month with no AC sessions reports 0, not NaN.
    const month: MonthlySpeed = {
      month: '2024-02',
      dcAvgKw: Math.round(avg([150]) * 10) / 10,
      acAvgKw: Math.round(avg([]) * 10) / 10,
    };

    expect(month.acAvgKw).toBe(0);
    expect(Number.isNaN(month.acAvgKw)).toBe(false);
    expect(month.dcAvgKw).toBe(150);
  });
});

// ── ChargeRatePoint & YearlyTrendPoint — the extracted nested shapes ──────────

describe('ChargeRatePoint & YearlyTrendPoint', () => {
  it('ChargeRatePoint pairs a numeric rate with a session id', () => {
    const point: ChargeRatePoint = { rate: 88.5, id: 7 };

    expect(point.rate).toBeCloseTo(88.5, 5);
    expect(point.id).toBe(7);
    expect(Object.keys(point).sort()).toEqual(['id', 'rate']);
    expectTypeOf<ChargeRatePoint>().toEqualTypeOf<{ rate: number; id: number }>();
  });

  it('YearlyTrendPoint carries year + both durations + a count', () => {
    const point: YearlyTrendPoint = {
      year: '2024',
      avg10to80: 35.5,
      avg20to80: 22.1,
      count: 12,
    };

    expect(Object.keys(point).sort()).toEqual(['avg10to80', 'avg20to80', 'count', 'year']);
    expect(point.year).toBe('2024');
    expect(point.count).toBe(12);
    expectTypeOf<YearlyTrendPoint>().toEqualTypeOf<{
      year: string;
      avg10to80: number;
      avg20to80: number;
      count: number;
    }>();
  });
});

// ── TimeToChargeMetrics — the null-union branches ─────────────────────────────

describe('TimeToChargeMetrics', () => {
  it('empty metrics default scalars to null and yearlyTrend to []', () => {
    const empty: TimeToChargeMetrics = {
      avg10to80: null,
      avg20to80: null,
      fastest: null,
      slowest: null,
      yearlyTrend: [],
    };

    expect(empty.avg10to80).toBeNull();
    expect(empty.avg20to80).toBeNull();
    expect(empty.fastest).toBeNull();
    expect(empty.slowest).toBeNull();
    expect(empty.yearlyTrend).toEqual([]);
  });

  it('populated metrics carry ChargeRatePoint extremes + a YearlyTrendPoint trend', () => {
    const fastest: ChargeRatePoint = { rate: 90, id: 7 };
    const slowest: ChargeRatePoint = { rate: 30, id: 3 };
    const metrics: TimeToChargeMetrics = {
      avg10to80: 35.5,
      avg20to80: 22.1,
      fastest,
      slowest,
      yearlyTrend: [{ year: '2024', avg10to80: 35.5, avg20to80: 22.1, count: 12 }],
    };

    expect(metrics.fastest?.rate).toBe(90);
    expect(metrics.fastest?.id).toBe(7);
    expect(metrics.slowest!.rate).toBeLessThan(metrics.fastest!.rate);
    expect(metrics.yearlyTrend).toHaveLength(1);
    expect(metrics.yearlyTrend[0]).toEqual({
      year: '2024',
      avg10to80: 35.5,
      avg20to80: 22.1,
      count: 12,
    });
  });

  it('locks the union / array types and the shared YearlyTrendPoint identity', () => {
    // The fastest/slowest slots are nullable ChargeRatePoints, never bare 0.
    expectTypeOf<TimeToChargeMetrics['fastest']>().toEqualTypeOf<ChargeRatePoint | null>();
    expectTypeOf<TimeToChargeMetrics['slowest']>().toEqualTypeOf<ChargeRatePoint | null>();
    expectTypeOf<TimeToChargeMetrics['avg10to80']>().toEqualTypeOf<number | null>();
    expectTypeOf<TimeToChargeMetrics['yearlyTrend']>().toEqualTypeOf<YearlyTrendPoint[]>();
    // DRY contract: the element YearlyTrendChart consumes IS YearlyTrendPoint.
    expectTypeOf<TimeToChargeMetrics['yearlyTrend'][number]>().toEqualTypeOf<YearlyTrendPoint>();

    // Runtime anchor: a `| null` slot really does accept both members.
    const withNull: TimeToChargeMetrics['fastest'] = null;
    const withPoint: TimeToChargeMetrics['fastest'] = { rate: 12, id: 1 };
    expect(withNull).toBeNull();
    expect(withPoint?.id).toBe(1);
  });
});

// ── SummaryStats — mirror the ChargingCurvePage aggregation ───────────────────

describe('SummaryStats', () => {
  it('aggregates headline metrics via the real reducer math', () => {
    const sessions = [
      makeSession({
        id: 1,
        total_energy_added_wh: 40_000,
        cost_decimal: 12.5,
        peak_power_w: 150_000,
        started_at: '2024-01-01T10:00:00Z',
        ended_at: '2024-01-01T10:30:00Z',
      }),
      makeSession({
        id: 2,
        total_energy_added_wh: 30_000,
        cost_decimal: 7.5,
        peak_power_w: 120_000,
        started_at: '2024-01-01T12:00:00Z',
        ended_at: '2024-01-01T12:20:00Z',
      }),
    ];

    const totalEnergyWh = sessions.reduce((sum, s) => sum + (s.total_energy_added_wh ?? 0), 0);
    const totalCost = sessions.reduce((sum, s) => sum + (s.cost_decimal ?? 0), 0);
    const powers = sessions.map((s) => (s.peak_power_w ?? 0) / 1000);
    const stats: SummaryStats = {
      totalSessions: sessions.length,
      totalEnergy: totalEnergyWh / 1000,
      avgRate: avg(powers),
      peakRate: powers.length ? Math.max(...powers) : 0,
      avgDuration: avg(sessions.map((s) => durationMinutes(s.started_at, s.ended_at))),
      totalCost,
    };

    expect(stats).toEqual({
      totalSessions: 2,
      totalEnergy: 70, // 70_000 Wh -> kWh
      avgRate: 135, // (150 + 120) / 2
      peakRate: 150, // Math.max
      avgDuration: 25, // (30 + 20) / 2
      totalCost: 20, // 12.5 + 7.5
    });
  });

  it('null-safe: missing cost/power contribute 0 and an empty peak is 0 not -Infinity', () => {
    const session = makeSession({ cost_decimal: null, peak_power_w: null });

    const totalCost = [session].reduce((sum, s) => sum + (s.cost_decimal ?? 0), 0);
    const powers: number[] = [];
    const peakRate = powers.length ? Math.max(...powers) : 0;

    expect(totalCost).toBe(0);
    expect(peakRate).toBe(0);
    expect(Number.isFinite(peakRate)).toBe(true); // guards against Math.max() === -Infinity
    expectTypeOf<SummaryStats>().toEqualTypeOf<{
      totalSessions: number;
      totalEnergy: number;
      avgRate: number;
      peakRate: number;
      avgDuration: number;
      totalCost: number;
    }>();
  });
});
