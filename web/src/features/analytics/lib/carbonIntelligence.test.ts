import { describe, expect, it } from 'vitest';

import {
  GAS_BASELINE_KG_CO2_PER_KM,
  analyzeCarbonCurve,
  analyzeCarbonSummary,
  analyzeDateWindow,
  analyzeRecommendation,
  buildCarbonIntelligence,
  derivePeriodContext,
} from './carbonIntelligence';

function completeCurve() {
  const curve = Array.from({ length: 24 }, (_, hour) => ({
    hour_of_day: hour,
    g_co2_per_kwh: 100 + Math.abs(hour - 2) * 10,
  }));
  return {
    curve,
    min: 100,
    max: 310,
    greenest_hours: [2],
    dirtiest_hours: [23],
  };
}

function lifetimeSummary() {
  return {
    total_energy_kwh: 10,
    total_co2_kg: 3,
    gas_equiv_co2_kg: 4,
    co2_saved_kg: 1,
    green_score: 4.8,
    sessions_scored: 4,
    monthly: [
      { month: '2026-02', energy_kwh: 5, co2_kg: 1.5 },
      { month: '2026-01', energy_kwh: 5, co2_kg: 1.5 },
    ],
  };
}

function periodSummary() {
  return {
    total_energy_kwh: 2.5,
    total_co2_kg: 0.75,
    gas_equiv_co2_kg: 0.5,
    co2_saved_kg: -0.25,
    green_score: 4.8,
    sessions_scored: 1,
    monthly: [
      { month: '2026-02', energy_kwh: 2.5, co2_kg: 0.75 },
    ],
  };
}

function recommendation() {
  return {
    current_avg_intensity: 300,
    greenest_window: {
      start_hour: 1,
      end_hour: 4,
      avg_intensity: 106.7,
    },
    potential_co2_saving_kg: 1.93,
    potential_saving_pct: 64.4,
  };
}

function windowInput() {
  return {
    startLabel: '2026-01-01',
    endLabel: '2026-02-28',
    startInstant: '2026-01-01T08:00:00.000Z',
    endInstantExclusive: '2026-03-01T08:00:00.000Z',
    timezone: 'America/Los_Angeles',
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

describe('analyzeCarbonCurve', () => {
  it('accounts for malformed, duplicate, and missing rows without mutating input', () => {
    const input = deepFreeze({
      curve: [
        { hour_of_day: 2, g_co2_per_kwh: 100 },
        { hour_of_day: 2, g_co2_per_kwh: 105 },
        { hour_of_day: 25, g_co2_per_kwh: 200 },
        { hour_of_day: 3, g_co2_per_kwh: Number.NaN },
        null,
      ],
      min: 100,
      max: 200,
      greenest_hours: [2],
      dirtiest_hours: [3],
    });

    const analysis = analyzeCarbonCurve(input);

    expect(analysis.availability).toBe('partial');
    expect(analysis.source).toMatchObject({
      returnedRows: 5,
      validRows: 2,
      validUniqueHours: 1,
      invalidHourRows: 2,
      invalidIntensityRows: 2,
      duplicateHourRows: 1,
      coverageComplete: false,
    });
    expect(analysis.source.missingHours).toHaveLength(23);
    expect(analysis.rows).toEqual([
      {
        hour: 2,
        intensityGPerKwh: 100,
        rank: 1,
        band: 'flat',
      },
    ]);
    expect(input.curve[0]).toEqual({
      hour_of_day: 2,
      g_co2_per_kwh: 100,
    });
  });

  it('derives sorted rows, ranks, extrema, distribution statistics, and bands', () => {
    const input = completeCurve();
    input.curve.reverse();
    const analysis = analyzeCarbonCurve(input);

    expect(analysis.availability).toBe('complete');
    expect(analysis.rows.map((row) => row.hour)).toEqual(
      Array.from({ length: 24 }, (_, hour) => hour),
    );
    expect(analysis.rankedRows[0]).toMatchObject({ hour: 2, rank: 1 });
    expect(analysis.stats).toMatchObject({
      minGPerKwh: 100,
      maxGPerKwh: 310,
      medianGPerKwh: 195,
      spanGPerKwh: 210,
      greenestHours: [2],
      dirtiestHours: [23],
    });
    expect(analysis.stats.meanGPerKwh).toBeCloseTo(197.5);
    expect(analysis.stats.cleanHours.length).toBeGreaterThan(0);
    expect(analysis.stats.dirtyHours.length).toBeGreaterThan(0);
  });

  it('distinguishes missing, empty, and wholly invalid curve payloads', () => {
    expect(analyzeCarbonCurve(null).availability).toBe('missing');
    expect(analyzeCarbonCurve({ curve: [] }).availability).toBe('empty');
    expect(analyzeCarbonCurve({
      curve: [{ hour_of_day: 'nope', g_co2_per_kwh: -1 }],
    }).availability).toBe('invalid');
  });
});

describe('analyzeCarbonSummary', () => {
  it('normalizes legacy wire kWh to canonical Wh exactly once and sorts months', () => {
    const input = deepFreeze(lifetimeSummary());
    const analysis = analyzeCarbonSummary(input);

    expect(analysis.availability).toBe('available');
    expect(analysis.totalEnergyWh).toBe(10_000);
    expect(analysis.monthly.map((row) => row.energyWh)).toEqual([5_000, 5_000]);
    expect(analysis.monthly.map((row) => row.month)).toEqual([
      '2026-01',
      '2026-02',
    ]);
    expect(analysis.energyWeightedIntensityGPerKwh).toBe(300);
    expect(analysis.netAvoidedCo2Kg).toBe(1);
    expect(analysis.netDisposition).toBe('avoided');
    expect(analysis.inferredGasBaselineDistanceM).toBeCloseTo(
      4 / GAS_BASELINE_KG_CO2_PER_KM * 1_000,
    );
    expect(input.total_energy_kwh).toBe(10);
  });

  it('preserves negative savings and marks excess emissions honestly', () => {
    const analysis = analyzeCarbonSummary(periodSummary());

    expect(analysis.reportedSavedCo2Kg).toBe(-0.25);
    expect(analysis.netAvoidedCo2Kg).toBe(-0.25);
    expect(analysis.netDisposition).toBe('excess');
  });

  it('distinguishes valid empty and invalid responses without coercing bad values', () => {
    const empty = analyzeCarbonSummary({
      total_energy_kwh: 0,
      total_co2_kg: 0,
      gas_equiv_co2_kg: 0,
      co2_saved_kg: 0,
      green_score: 0,
      sessions_scored: 0,
      monthly: [],
    });
    const invalid = analyzeCarbonSummary({
      total_energy_kwh: '10',
      total_co2_kg: 1,
      gas_equiv_co2_kg: 2,
      co2_saved_kg: 1,
      green_score: 101,
      sessions_scored: -1,
      monthly: [{ month: '2026-13', energy_kwh: 1, co2_kg: 1 }],
    });

    expect(empty.availability).toBe('empty');
    expect(empty.totalEnergyWh).toBe(0);
    expect(empty.energyWeightedIntensityGPerKwh).toBeNull();
    expect(invalid.availability).toBe('invalid');
    expect(invalid.totalEnergyWh).toBeNull();
    expect(invalid.monthly).toEqual([]);
    expect(invalid.source.invalidMonthlyRows).toBe(1);
  });

  it('rejects duplicate normalized month rows instead of silently merging them', () => {
    const duplicate = analyzeCarbonSummary({
      ...lifetimeSummary(),
      monthly: [
        { month: '2026-01', energy_kwh: 5, co2_kg: 1.5 },
        { month: '2026-01', energy_kwh: 5, co2_kg: 1.5 },
      ],
    });

    expect(duplicate.availability).toBe('invalid');
    expect(duplicate.source.duplicateMonthRows).toBe(1);
    expect(duplicate.monthly).toHaveLength(2);
  });
});

describe('context, window, recommendation, and reconciliation', () => {
  it('derives selected-period shares without dividing by zero', () => {
    const context = derivePeriodContext(
      analyzeCarbonSummary(periodSummary()),
      analyzeCarbonSummary(lifetimeSummary()),
    );
    const zeroContext = derivePeriodContext(
      analyzeCarbonSummary(periodSummary()),
      analyzeCarbonSummary({
        ...lifetimeSummary(),
        total_energy_kwh: 0,
        total_co2_kg: 0,
        gas_equiv_co2_kg: 0,
        sessions_scored: 0,
      }),
    );

    expect(context).toEqual({
      energySharePct: 25,
      co2SharePct: 25,
      gasBaselineSharePct: 12.5,
      sessionSharePct: 25,
    });
    expect(zeroContext).toEqual({
      energySharePct: null,
      co2SharePct: null,
      gasBaselineSharePct: null,
      sessionSharePct: null,
    });
  });

  it('keeps calendar-day and instant-duration metadata distinct across DST', () => {
    const window = analyzeDateWindow({
      startLabel: '2026-03-08',
      endLabel: '2026-03-09',
      startInstant: '2026-03-08T08:00:00.000Z',
      endInstantExclusive: '2026-03-10T07:00:00.000Z',
      timezone: 'America/Los_Angeles',
    });

    expect(window.availability).toBe('valid');
    expect(window.calendarDays).toBe(2);
    expect(window.instantDurationHours).toBe(47);
    expect(window.upperBoundExclusive).toBe(true);
  });

  it('rejects impossible calendar labels and unknown IANA timezones', () => {
    expect(analyzeDateWindow({
      startLabel: '2026-02-31',
      endLabel: '2026-03-02',
      startInstant: '2026-02-28T08:00:00.000Z',
      endInstantExclusive: '2026-03-03T08:00:00.000Z',
      timezone: 'America/Los_Angeles',
    }).availability).toBe('invalid');
    expect(analyzeDateWindow({
      ...windowInput(),
      timezone: 'Mars/Olympus_Mons',
    }).availability).toBe('invalid');
  });

  it('marks recommendation lifetime scope and independently recomputes scenario math', () => {
    const lifetime = analyzeCarbonSummary(lifetimeSummary());
    const analysis = analyzeRecommendation(recommendation(), lifetime);

    expect(analysis.scope).toBe('lifetime');
    expect(analysis.shiftedEnergyWh).toBe(10_000);
    expect(analysis.currentScenarioCo2Kg).toBe(3);
    expect(analysis.shiftedScenarioCo2Kg).toBeCloseTo(1.067);
    expect(analysis.calculatedPotentialSavingKg).toBeCloseTo(1.933);
    expect(analysis.calculatedPotentialSavingPct).toBeCloseTo(64.4333);
  });

  it('balances independent wire identities within explicit rounding tolerances', () => {
    const analysis = buildCarbonIntelligence({
      intensity: completeCurve(),
      periodSummary: periodSummary(),
      lifetimeSummary: lifetimeSummary(),
      recommendation: recommendation(),
      window: windowInput(),
    });

    expect(analysis.reconciliations).toHaveLength(16);
    expect(analysis.reconciliations.every(
      (check) => check.status === 'balances',
    )).toBe(true);
    expect(analysis.reconciliations.every(
      (check) => check.tolerance >= 0,
    )).toBe(true);
  });

  it('surfaces contradictions rather than manufacturing balanced identities', () => {
    const analysis = buildCarbonIntelligence({
      intensity: { ...completeCurve(), min: 999 },
      periodSummary: {
        ...periodSummary(),
        co2_saved_kg: 12,
      },
      lifetimeSummary: lifetimeSummary(),
      recommendation: {
        ...recommendation(),
        potential_co2_saving_kg: 50,
      },
      window: windowInput(),
    });

    expect(analysis.reconciliations.find(
      (check) => check.id === 'curve.minimum',
    )?.status).toBe('outside_tolerance');
    expect(analysis.reconciliations.find(
      (check) => check.id === 'period.gas_less_charging',
    )?.status).toBe('outside_tolerance');
    expect(analysis.reconciliations.find(
      (check) => check.id === 'recommendation.saving_mass',
    )?.status).toBe('outside_tolerance');
  });

  it('reconciles hour sets without numeric mismatch sentinels', () => {
    const intensity = completeCurve();
    intensity.greenest_hours = [3];
    const analysis = buildCarbonIntelligence({
      intensity,
      periodSummary: periodSummary(),
      lifetimeSummary: lifetimeSummary(),
      recommendation: recommendation(),
      window: windowInput(),
    });
    const check = analysis.reconciliations.find(
      (candidate) => candidate.id === 'curve.greenest_hours',
    );

    expect(check).toMatchObject({
      status: 'outside_tolerance',
      unit: 'hour_set',
      expected: null,
      observed: null,
      residual: null,
      expectedHours: [2],
      observedHours: [3],
    });
  });

  it('never throws on arbitrary runtime input', () => {
    const values: unknown[] = [
      undefined,
      null,
      false,
      'carbon',
      42,
      [],
      { curve: 'wrong' },
      { monthly: [{ energy_kwh: Number.POSITIVE_INFINITY }] },
    ];

    for (const value of values) {
      expect(() => analyzeCarbonCurve(value)).not.toThrow();
      expect(() => analyzeCarbonSummary(value)).not.toThrow();
      expect(() => analyzeRecommendation(
        value,
        analyzeCarbonSummary(value),
      )).not.toThrow();
    }
  });
});
