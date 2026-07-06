/**
 * `types/charging.ts` — charging-domain DTO contract harness.
 *
 * Every export in the module under test is an `interface`, erased at runtime, so
 * a smoke import proves nothing. Following the repo convention for type modules
 * (features/analytics/.../weekly-digest/types.test.ts,
 * features/charging/.../charging-curve/types.test.ts) this suite pins each
 * contract on two levels:
 *
 *   • Compile-time — every fixture is annotated with its interface, so a field
 *     rename / removal / retype breaks THIS file in any typecheck (IDE, or a
 *     `tsc` run that includes tests). `expectTypeOf` additionally locks the exact
 *     `| null` unions and optional modifiers that consumers branch on.
 *   • Runtime (`expect`) — the fixtures are exercised through the SAME derived
 *     math their real consumers run: the confidence-band height and actual/
 *     forecast merge (CostForecastSection), the home/Supercharger donut share and
 *     insight filtering (ForecastDetails), the savings-banner threshold and the
 *     `day*24 + hour` heatmap indexing (OptimizerSection / CostHeatmap), the
 *     charge-window / savings-sign readout (SmartChargePage), the peak-rate scan
 *     (RateTimeline), and the timestamp/cost coalescing + latest-by-`startedAt`
 *     selection (RecentActivity / ChargingSessionDetailWidget). Combined with
 *     exhaustive key-completeness and `| null` branch coverage, a wire-shape
 *     drift or a mis-typed nullable cannot slip past unseen.
 *
 * Pure structural + arithmetic assertions only — no network, no DOM, no MSW.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  ChargingSession,
  CostForecastData,
  CostHistoricalMonth,
  CostForecastMonth,
  CostBreakdownData,
  ChargerCategoryData,
  GasComparisonData,
  ChargingOptimizerData,
  OptimizerSchedule,
  OptimizerCostAnalysis,
  OptimizerRecommendation,
  OptimizerHeatmapEntry,
  OptimizeChargeRequest,
  ChargeWindow,
  CostComparison,
  HourlyRate,
  OptimizeChargeResponse,
  ApplyScheduleRequest,
  ApplyScheduleResponse,
  ChargePlan,
  RatePlanInfo,
} from './charging';

/** Sorted own-enumerable keys — used to assert a fixture is neither missing nor gaining a field. */
const keysOf = (o: object): string[] => Object.keys(o).sort();

/* ── ChargingSession — the list / single-session wire shape + its aliases ───── */

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: '42',
    vehicle_id: '1',
    charger_type: 'Supercharger',
    start_soc_pct: 20,
    end_soc_pct: 80,
    total_energy_added_wh: 40_000,
    peak_power_w: 150_000,
    cost_decimal: 12.5,
    started_at: '2024-01-01T10:00:00Z',
    ended_at: '2024-01-01T10:30:00Z',
    start_ts: '2024-01-01T10:00:00Z',
    startedAt: '2024-01-01T10:00:00Z',
    duration_min: 30,
    cost: 12.5,
    ...overrides,
  };
}

const SESSION_KEYS = [
  'id', 'vehicle_id', 'charger_type', 'start_soc_pct', 'end_soc_pct',
  'total_energy_added_wh', 'peak_power_w', 'cost_decimal', 'started_at',
  'ended_at', 'start_ts', 'startedAt', 'duration_min', 'cost',
];

// Mirror the two coalescing helpers the SPA relies on (RecentActivity /
// RecentChargesSection) so a future field rename that breaks the fallback is caught.
const pickTimestamp = (s: ChargingSession): string | undefined => s.started_at ?? s.start_ts;
const pickCost = (s: ChargingSession): number | null | undefined => s.cost ?? s.cost_decimal;

describe('ChargingSession', () => {
  it('carries exactly the declared keys with the right runtime types', () => {
    const s = makeSession();
    expect(keysOf(s)).toEqual([...SESSION_KEYS].sort());

    // IDs are strings on this shape (the widget parses them with Number()).
    expect(typeof s.id).toBe('string');
    expect(typeof s.vehicle_id).toBe('string');
    for (const k of ['start_soc_pct', 'total_energy_added_wh', 'duration_min'] as const) {
      expect(typeof s[k]).toBe('number');
      expect(Number.isFinite(s[k])).toBe(true);
    }
    expect(typeof s.started_at).toBe('string');
    expectTypeOf<ChargingSession['id']>().toEqualTypeOf<string>();
    expectTypeOf<ChargingSession['end_soc_pct']>().toEqualTypeOf<number | null>();
  });

  it('accepts null on every nullable slot and undefined on the optional aliases', () => {
    const s = makeSession({
      charger_type: null,
      end_soc_pct: null,
      peak_power_w: null,
      cost_decimal: null,
      ended_at: undefined,
      cost: undefined,
    });

    expect(s.charger_type).toBeNull();
    expect(s.end_soc_pct).toBeNull();
    expect(s.peak_power_w).toBeNull();
    expect(s.cost_decimal).toBeNull();
    expect(s.ended_at).toBeUndefined();
    expect(s.cost).toBeUndefined();

    // The nullable unions / optional modifiers are the exact ones consumers branch on.
    expectTypeOf<ChargingSession['charger_type']>().toEqualTypeOf<string | null>();
    expectTypeOf<ChargingSession['peak_power_w']>().toEqualTypeOf<number | null>();
    expectTypeOf<ChargingSession['cost']>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<ChargingSession['ended_at']>().toEqualTypeOf<string | null | undefined>();
  });

  it('coalesces the timestamp + cost aliases the way its consumers do', () => {
    // A row that supplies only the dashboard-activity alias still resolves a time.
    const aliasOnly = makeSession({ started_at: undefined as unknown as string, start_ts: '2024-05-05T08:00:00Z' });
    expect(pickTimestamp(aliasOnly)).toBe('2024-05-05T08:00:00Z');

    // Canonical `started_at` wins when both are present.
    expect(pickTimestamp(makeSession({ started_at: 'A', start_ts: 'B' }))).toBe('A');

    // `cost` (legacy alias) is preferred, falling back to the SI `cost_decimal`.
    expect(pickCost(makeSession({ cost: 9, cost_decimal: 3 }))).toBe(9);
    expect(pickCost(makeSession({ cost: undefined, cost_decimal: 3 }))).toBe(3);
    expect(pickCost(makeSession({ cost: null, cost_decimal: 3 }))).toBe(3);
  });

  it('supports the latest-by-startedAt reducer + numeric-id parse (ChargingSessionDetailWidget)', () => {
    const list: ChargingSession[] = [
      makeSession({ id: '5', startedAt: '2024-01-01T00:00:00Z' }),
      makeSession({ id: '9', startedAt: '2024-03-01T00:00:00Z' }),
      makeSession({ id: '7', startedAt: '2024-02-01T00:00:00Z' }),
    ];
    const latest = list.reduce((a, b) => (new Date(a.startedAt) > new Date(b.startedAt) ? a : b));
    expect(latest.id).toBe('9');

    const id = Number(latest.id);
    expect(Number.isFinite(id)).toBe(true);
    expect(id).toBe(9);

    // A non-numeric id must degrade to NaN (the widget guards with Number.isFinite).
    expect(Number.isFinite(Number(makeSession({ id: 'not-a-number' }).id))).toBe(false);
  });
});

/* ── Cost Forecast — CostForecastData + its five nested shapes ───────────────── */

function makeForecast(overrides: Partial<CostForecastData> = {}): CostForecastData {
  const historical: CostHistoricalMonth[] = [
    { month: '2024-01', cost: 40, kwh: 200, sessions: 8, cost_per_kwh: 0.2 },
    { month: '2024-02', cost: 44, kwh: 210, sessions: 9, cost_per_kwh: 0.21 },
    { month: '2024-03', cost: 48, kwh: 220, sessions: 10, cost_per_kwh: 0.218 },
  ];
  const forecast: CostForecastMonth[] = [
    { month: '2024-04', cost: 50, cost_low: 45, cost_high: 60, kwh: 225 },
    { month: '2024-05', cost: 52, cost_low: 46, cost_high: 64, kwh: 230 },
  ];
  const breakdown: CostBreakdownData = {
    home: { pct: 70, avg_cost_per_kwh: 0.14, monthly_avg: 32 },
    supercharger: { pct: 30, avg_cost_per_kwh: 0.42, monthly_avg: 18 },
  };
  const gas_comparison: GasComparisonData = {
    avg_km_per_month: 1600,
    gas_cost_per_month: 180,
    ev_cost_per_month: 50,
    monthly_savings: 130,
    annual_savings: 1560,
    lifetime_savings: 15600,
  };
  return {
    historical,
    forecast,
    breakdown,
    gas_comparison,
    insights: ['Charge off-peak to save ~$12/mo', '  ', ''],
    ...overrides,
  };
}

describe('CostForecastData envelope + CostHistoricalMonth / CostForecastMonth', () => {
  it('exposes the five top-level series with their nested element shapes', () => {
    const f = makeForecast();
    expect(keysOf(f)).toEqual(['breakdown', 'forecast', 'gas_comparison', 'historical', 'insights']);
    expect(keysOf(f.historical[0])).toEqual(['cost', 'cost_per_kwh', 'kwh', 'month', 'sessions']);
    expect(keysOf(f.forecast[0])).toEqual(['cost', 'cost_high', 'cost_low', 'kwh', 'month']);
    expect(Array.isArray(f.insights)).toBe(true);
    expectTypeOf<CostForecastData['insights']>().toEqualTypeOf<string[]>();
  });

  it('supports the actual/forecast merge + non-negative confidence band (CostForecastSection)', () => {
    const f = makeForecast();
    // The chart merges history (`actual`) and projection (`forecast` + ci band).
    const rows = [
      ...f.historical.map((h) => ({ month: h.month, actual: h.cost })),
      ...f.forecast.map((p) => ({
        month: p.month,
        forecast: p.cost,
        ci_low: p.cost_low,
        ci_band: Math.max(0, p.cost_high - p.cost_low),
      })),
    ];
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ month: '2024-01', actual: 40 });

    // Every projected month must yield a finite, non-negative band the stacked Area can render.
    const projected = rows.slice(f.historical.length);
    expect(projected.map((r) => r.ci_band)).toEqual([15, 18]);
    for (const p of projected) {
      expect(p.ci_band).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(p.ci_band as number)).toBe(true);
    }
  });
});

describe('CostBreakdownData / ChargerCategoryData', () => {
  it('models the home vs Supercharger donut consumed by ForecastDetails', () => {
    const { breakdown } = makeForecast();
    const donut = [
      { name: 'Home', value: breakdown.home.pct },
      { name: 'Supercharger', value: breakdown.supercharger.pct },
    ];
    expect(donut.map((d) => d.value)).toEqual([70, 30]);
    // A well-formed breakdown's shares total 100%.
    expect(breakdown.home.pct + breakdown.supercharger.pct).toBe(100);
    // Supercharging is the pricier category per kWh.
    expect(breakdown.supercharger.avg_cost_per_kwh).toBeGreaterThan(breakdown.home.avg_cost_per_kwh);
    expect(keysOf(breakdown.home)).toEqual(['avg_cost_per_kwh', 'monthly_avg', 'pct']);
    expectTypeOf<CostBreakdownData['home']>().toEqualTypeOf<ChargerCategoryData>();
  });
});

describe('GasComparisonData', () => {
  it('keeps the savings tiers internally consistent (monthly < annual < lifetime)', () => {
    const { gas_comparison: g } = makeForecast();
    expect(g.gas_cost_per_month - g.ev_cost_per_month).toBe(g.monthly_savings);
    expect(g.annual_savings).toBe(g.monthly_savings * 12);
    expect(g.lifetime_savings).toBeGreaterThan(g.annual_savings);
    expect(g.avg_km_per_month).toBeGreaterThan(0);
    expect(keysOf(g)).toEqual([
      'annual_savings', 'avg_km_per_month', 'ev_cost_per_month',
      'gas_cost_per_month', 'lifetime_savings', 'monthly_savings',
    ]);
  });
});

describe('CostForecastData.insights', () => {
  it('is a plain string[] the consumer can filter down to non-blank entries', () => {
    const { insights } = makeForecast();
    // ForecastDetails drops null / whitespace-only entries before rendering chips.
    const shown = insights.filter((s) => typeof s === 'string' && s.trim().length > 0);
    expect(insights).toHaveLength(3);
    expect(shown).toEqual(['Charge off-peak to save ~$12/mo']);
  });
});

/* ── Charging Optimizer — ChargingOptimizerData + four nested shapes ─────────── */

function makeOptimizer(overrides: Partial<ChargingOptimizerData> = {}): ChargingOptimizerData {
  const current_schedule: OptimizerSchedule = {
    most_common_start_hour: 22,
    most_common_day: 'Monday',
    avg_sessions_per_week: 4.5,
    home_charging_pct: 82,
    avg_charge_to_pct: 80,
  };
  const cost_analysis: OptimizerCostAnalysis = {
    peak_hours: [16, 17, 18, 19, 20],
    offpeak_hours: [0, 1, 2, 3, 4, 5],
    peak_cost_per_kwh: 0.42,
    offpeak_cost_per_kwh: 0.12,
    sessions_during_peak_pct: 35,
    potential_monthly_savings: 18,
  };
  const recommendations: OptimizerRecommendation[] = [
    { type: 'shift', priority: 'high', title: 'Shift to off-peak', detail: 'Charge after 9pm.', estimated_savings: 12 },
    { type: 'target', priority: 'medium', title: 'Lower target', detail: 'Cap at 80%.' },
    { type: 'info', priority: 'low', title: 'Home charging', detail: 'You mostly charge at home.' },
  ];
  const weekly_heatmap: OptimizerHeatmapEntry[] = [
    { day: 0, hour: 22, sessions: 3, avg_cost_per_kwh: 0.12 },
    { day: 4, hour: 18, sessions: 2, avg_cost_per_kwh: 0.42 },
  ];
  return {
    current_schedule,
    cost_analysis,
    battery_health_score: 78,
    recommendations,
    weekly_heatmap,
    ...overrides,
  };
}

describe('ChargingOptimizerData + OptimizerSchedule / OptimizerCostAnalysis', () => {
  it('exposes the schedule + cost-analysis blocks and the savings-banner threshold (OptimizerSection)', () => {
    const o = makeOptimizer();
    expect(keysOf(o)).toEqual([
      'battery_health_score', 'cost_analysis', 'current_schedule', 'recommendations', 'weekly_heatmap',
    ]);
    expect(keysOf(o.current_schedule)).toEqual([
      'avg_charge_to_pct', 'avg_sessions_per_week', 'home_charging_pct',
      'most_common_day', 'most_common_start_hour',
    ]);

    // The banner shows only when the potential monthly saving clears $5.
    expect(o.cost_analysis.potential_monthly_savings > 5).toBe(true);
    // Peak/off-peak hour lists are numeric arrays the readout joins into "16:00, …".
    expect(Array.isArray(o.cost_analysis.peak_hours)).toBe(true);
    expect(o.cost_analysis.peak_hours.map((h) => `${h}:00`).join(', ')).toBe('16:00, 17:00, 18:00, 19:00, 20:00');
    expect(o.cost_analysis.peak_cost_per_kwh).toBeGreaterThan(o.cost_analysis.offpeak_cost_per_kwh);
  });
});

describe('OptimizerRecommendation', () => {
  it('locks the priority union and drives the three severity branches', () => {
    const recs = makeOptimizer().recommendations;
    expect(recs.map((r) => r.priority)).toEqual(['high', 'medium', 'low']);

    // The card styling switches on exactly these three literals.
    const styleFor = (p: OptimizerRecommendation['priority']): string =>
      p === 'high' ? 'danger' : p === 'medium' ? 'amber' : 'neutral';
    expect(recs.map((r) => styleFor(r.priority))).toEqual(['danger', 'amber', 'neutral']);

    // `estimated_savings` is optional — present on the first, absent on the rest.
    expect(recs[0].estimated_savings).toBe(12);
    expect(recs[1].estimated_savings).toBeUndefined();
    expectTypeOf<OptimizerRecommendation['priority']>().toEqualTypeOf<'high' | 'medium' | 'low'>();
    expectTypeOf<OptimizerRecommendation['estimated_savings']>().toEqualTypeOf<number | undefined>();
  });
});

describe('OptimizerHeatmapEntry', () => {
  it('supports the day*24 + hour lookup + cost-intensity scale (CostHeatmap)', () => {
    const entries = makeOptimizer().weekly_heatmap;
    // O(1) cell map keyed exactly as CostHeatmap builds it.
    const byKey = new Map<number, OptimizerHeatmapEntry>();
    for (const e of entries) byKey.set(e.day * 24 + e.hour, e);

    expect(byKey.get(0 * 24 + 22)?.sessions).toBe(3);
    expect(byKey.get(4 * 24 + 18)?.avg_cost_per_kwh).toBe(0.42);
    expect(byKey.get(1 * 24 + 5)).toBeUndefined(); // an empty cell

    // Intensity = cost / peakCost, clamped to [0, 1] — the pricey Friday cell saturates.
    const peak = 0.42;
    const intensity = Math.min(1, (byKey.get(4 * 24 + 18)?.avg_cost_per_kwh ?? 0) / peak);
    expect(intensity).toBeCloseTo(1, 6);
    expect(keysOf(entries[0])).toEqual(['avg_cost_per_kwh', 'day', 'hour', 'sessions']);
  });
});

/* ── Smart Charge Planner — request/response + plan history shapes ───────────── */

function makeWindow(overrides: Partial<ChargeWindow> = {}): ChargeWindow {
  return {
    start_time: '2024-06-01T23:00:00Z',
    end_time: '2024-06-02T05:00:00Z',
    rate_cents_kwh: 12,
    estimated_cost: 4.2,
    rate_tier: 'OFF_PEAK',
    ...overrides,
  };
}

function makeOptimizeResponse(overrides: Partial<OptimizeChargeResponse> = {}): OptimizeChargeResponse {
  const comparison: CostComparison = {
    charge_now_cost: 9.5,
    optimized_cost: 4.2,
    savings: 5.3,
    savings_percent: 55.8,
  };
  const hourly_rates: HourlyRate[] = [
    { hour: 16, rate_cents: 42, tier: 'ON_PEAK' },
    { hour: 23, rate_cents: 12, tier: 'OFF_PEAK' },
  ];
  return {
    plan_id: 7,
    current_soc: 55,
    target_soc: 80,
    kwh_needed: 18.5,
    estimated_duration_hours: 3.2,
    schedule: makeWindow(),
    comparison,
    alternative_windows: [makeWindow({ rate_tier: 'MID_PEAK', estimated_cost: 5.1 })],
    hourly_rates,
    ...overrides,
  };
}

describe('OptimizeChargeRequest', () => {
  it('separates the four required inputs from the four optional tuning knobs', () => {
    const req: OptimizeChargeRequest = {
      vehicle_id: 1,
      target_soc: 80,
      depart_by: '2024-06-02T07:30:00Z',
      rate_plan_id: 'pge-ev2a',
    };
    expect(keysOf(req)).toEqual(['depart_by', 'rate_plan_id', 'target_soc', 'vehicle_id']);
    expect(typeof req.vehicle_id).toBe('number');

    const tuned: OptimizeChargeRequest = {
      ...req,
      max_amps: 32,
      battery_capacity_kwh: 75,
      charger_voltage: 240,
      prefer_off_peak: true,
    };
    expect(tuned.prefer_off_peak).toBe(true);
    expectTypeOf<OptimizeChargeRequest['max_amps']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<OptimizeChargeRequest['prefer_off_peak']>().toEqualTypeOf<boolean | undefined>();
  });
});

describe('OptimizeChargeResponse + ChargeWindow + CostComparison + HourlyRate', () => {
  it('carries a single recommended window plus alternatives and an hourly rate curve', () => {
    const r = makeOptimizeResponse();
    expect(keysOf(r)).toEqual([
      'alternative_windows', 'comparison', 'current_soc', 'estimated_duration_hours',
      'hourly_rates', 'kwh_needed', 'plan_id', 'schedule', 'target_soc',
    ]);
    // `schedule` is one window; `alternative_windows` is a list of them.
    expect(keysOf(r.schedule)).toEqual(['end_time', 'estimated_cost', 'rate_cents_kwh', 'rate_tier', 'start_time']);
    expect(r.alternative_windows).toHaveLength(1);
    expect(new Date(r.schedule.end_time) > new Date(r.schedule.start_time)).toBe(true);

    // kWh-needed readout (SmartChargePage) — a positive, finite delta toward target.
    expect(r.target_soc).toBeGreaterThan(r.current_soc);
    expect(r.kwh_needed).toBeGreaterThan(0);
    expectTypeOf<OptimizeChargeResponse['schedule']>().toEqualTypeOf<ChargeWindow>();
    expectTypeOf<OptimizeChargeResponse['alternative_windows']>().toEqualTypeOf<ChargeWindow[]>();
  });

  it('keeps the cost comparison self-consistent (savings = now − optimized, positive)', () => {
    const { comparison: c } = makeOptimizeResponse();
    expect(c.charge_now_cost - c.optimized_cost).toBeCloseTo(c.savings, 6);
    expect(c.savings).toBeGreaterThan(0);
    expect(c.savings_percent).toBeCloseTo((c.savings / c.charge_now_cost) * 100, 1);
  });

  it('exposes an hourly rate curve whose peak the RateTimeline can scan for', () => {
    const { hourly_rates } = makeOptimizeResponse();
    // RateTimeline ignores non-finite rates when finding the peak.
    const values = hourly_rates.map((h) => h.rate_cents).filter((v) => Number.isFinite(v));
    expect(Math.max(...values)).toBe(42);
    expect(hourly_rates.every((h) => typeof h.hour === 'number' && typeof h.tier === 'string')).toBe(true);
    expect(keysOf(hourly_rates[0])).toEqual(['hour', 'rate_cents', 'tier']);
  });
});

describe('ApplyScheduleRequest / ApplyScheduleResponse', () => {
  it('round-trips a plan id through the apply mutation envelope', () => {
    const req: ApplyScheduleRequest = { plan_id: 7 };
    const res: ApplyScheduleResponse = { status: 'applied', plan_id: req.plan_id, message: 'Scheduled charge set' };

    expect(req.plan_id).toBe(7);
    expect(res.plan_id).toBe(req.plan_id);
    expect(res.status).toBe('applied');
    expect(keysOf(res)).toEqual(['message', 'plan_id', 'status']);
  });
});

describe('ChargePlan', () => {
  it('renders a fully-populated plan-history row', () => {
    const plan: ChargePlan = {
      id: 1,
      vehicle_id: 1,
      target_soc: 80,
      depart_by: '2024-06-02T07:30:00Z',
      scheduled_start: '2024-06-01T23:00:00Z',
      scheduled_end: '2024-06-02T05:00:00Z',
      rate_plan: 'PG&E EV2-A',
      estimated_kwh: 18.5,
      estimated_cost: 4.2,
      charge_now_cost: 9.5,
      savings: 5.3,
      status: 'scheduled',
      applied_at: '2024-06-01T22:00:00Z',
      completed_at: null,
      created_at: '2024-06-01T21:00:00Z',
    };
    expect(keysOf(plan)).toEqual([
      'applied_at', 'charge_now_cost', 'completed_at', 'created_at', 'depart_by',
      'estimated_cost', 'estimated_kwh', 'id', 'rate_plan', 'savings',
      'scheduled_end', 'scheduled_start', 'status', 'target_soc', 'vehicle_id',
    ]);
    expect(plan.savings).toBeGreaterThan(0);
    expect(plan.completed_at).toBeNull();
  });

  it('tolerates the nullable estimate/outcome fields on a pending plan', () => {
    const pending: ChargePlan = {
      id: 2,
      vehicle_id: 1,
      target_soc: 90,
      depart_by: null,
      scheduled_start: '2024-06-03T23:00:00Z',
      scheduled_end: '2024-06-04T04:00:00Z',
      rate_plan: 'Flat',
      estimated_kwh: null,
      estimated_cost: null,
      charge_now_cost: null,
      savings: null,
      status: 'pending',
      applied_at: null,
      completed_at: null,
      created_at: '2024-06-03T20:00:00Z',
    };
    for (const v of [pending.depart_by, pending.estimated_kwh, pending.estimated_cost, pending.charge_now_cost, pending.savings, pending.applied_at]) {
      expect(v).toBeNull();
    }
    // Consumers coalesce the nullable numerics before display.
    expect(pending.estimated_cost ?? 0).toBe(0);
    expect(pending.rate_plan ?? '—').toBe('Flat');
    expectTypeOf<ChargePlan['depart_by']>().toEqualTypeOf<string | null>();
    expectTypeOf<ChargePlan['savings']>().toEqualTypeOf<number | null>();
  });
});

describe('RatePlanInfo', () => {
  it('describes a selectable utility rate plan', () => {
    const plans: RatePlanInfo[] = [
      { id: 'pge-ev2a', name: 'PG&E EV2-A', utility: 'PG&E' },
      { id: 'flat', name: 'Flat Rate', utility: 'Generic' },
    ];
    expect(plans.map((p) => p.id)).toEqual(['pge-ev2a', 'flat']);
    expect(keysOf(plans[0])).toEqual(['id', 'name', 'utility']);
    expect(plans.every((p) => typeof p.name === 'string' && typeof p.utility === 'string')).toBe(true);
    expectTypeOf<RatePlanInfo>().toEqualTypeOf<{ id: string; name: string; utility: string }>();
  });
});
