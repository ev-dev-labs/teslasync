import { describe, expect, it } from 'vitest';

import type {
  BatteryPassport,
  BatteryPassportTrendPoint,
} from '@/api/hooks/useBatteryPassport';
import {
  analyzeBatteryPassport,
  analyzeBatteryPassportThermal,
  analyzeBatteryPassportTrend,
  batteryPassportGradeFromScore,
  reconstructBatteryPassportGrade,
  toBatteryPassportCertificate,
} from './batteryPassportAnalysis';

const NOW_MS = Date.parse('2026-08-08T12:00:00.000Z');

function passport(
  overrides: Partial<BatteryPassport> = {},
): BatteryPassport {
  return {
    vehicle_id: 7,
    vin_masked: '5YJ**********1234',
    issued_at: '2026-08-08T10:00:00Z',
    first_observed_at: '2024-01-02T03:04:05Z',
    soh_pct: 91.2,
    capacity_kwh: 68.4,
    original_capacity_kwh: 75,
    equivalent_full_cycles: 321.4,
    fast_charge_ratio: 0.125,
    avg_charge_limit_pct: 81.2,
    thermal_exposure: {
      cold_pct: 10,
      nominal_pct: 80,
      hot_pct: 10,
    },
    health_grade: 'B',
    degradation_trend: [
      { date: '2026-05-01', soh_pct: 92.1 },
      { date: '2026-08-01', soh_pct: 91.2 },
    ],
    recommendations: ['Server output'],
    provenance_hash: 'a'.repeat(64),
    ...overrides,
  };
}

function trendPoint(
  startMs: number,
  dayOffset: number,
  sohPct: number,
): BatteryPassportTrendPoint {
  return {
    date: new Date(startMs + dayOffset * 86_400_000)
      .toISOString()
      .slice(0, 10),
    soh_pct: sohPct,
  };
}

describe('analyzeBatteryPassportTrend', () => {
  it('assigns every returned point to one exact accounting category', () => {
    const source = [
      { date: '2026-08-01', soh_pct: 91 },
      { date: '2026-02-30', soh_pct: 90 },
      { date: '2026-08-09', soh_pct: 90 },
      { date: '2026-08-02', soh_pct: 101 },
      { date: '2026-08-01', soh_pct: 89 },
    ];

    const result = analyzeBatteryPassportTrend(source, NOW_MS);

    expect(result.accounting.categories).toEqual({
      included: 1,
      invalid_date: 1,
      future_date: 1,
      invalid_soh: 1,
      duplicate_date: 1,
    });
    expect(result.accounting.includedPoints).toBe(1);
    expect(result.accounting.excludedPoints).toBe(4);
    expect(
      Object.values(result.accounting.categories).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(result.accounting.returnedPoints);
  });

  it('uses the supplied frozen clock for future classification', () => {
    const source = [{ date: '2026-08-09', soh_pct: 90 }];
    const frozen = analyzeBatteryPassportTrend(source, NOW_MS);
    const later = analyzeBatteryPassportTrend(
      source,
      Date.parse('2026-08-10T12:00:00Z'),
    );

    expect(frozen.accounting.categories.future_date).toBe(1);
    expect(later.accounting.categories.included).toBe(1);
  });

  it('deduplicates first valid dates and sorts included points in UTC order', () => {
    const source = [
      { date: '2026-08-03', soh_pct: 88 },
      { date: '2026-08-01', soh_pct: 91 },
      { date: '2026-08-02', soh_pct: 90 },
      { date: '2026-08-01', soh_pct: 70 },
    ];

    const result = analyzeBatteryPassportTrend(source, NOW_MS);

    expect(result.points.map((point) => point.date)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
    expect(result.points[0]?.sohPct).toBe(91);
    expect(result.accounting.categories.duplicate_date).toBe(1);
  });

  it('does not mutate source trend points while sorting and deduplicating', () => {
    const source = [
      { date: '2026-08-03', soh_pct: 88 },
      { date: '2026-08-01', soh_pct: 91 },
      { date: '2026-08-01', soh_pct: 90 },
    ];
    const snapshot = structuredClone(source);

    analyzeBatteryPassportTrend(source, NOW_MS);

    expect(source).toEqual(snapshot);
  });

  it('withholds and then exposes the linear description at both gates', () => {
    const start = Date.parse('2025-01-01T00:00:00Z');
    const tooFew = Array.from({ length: 11 }, (_, index) =>
      trendPoint(start, index * 10, 95 - index * 0.1),
    );
    const tooShort = Array.from({ length: 12 }, (_, index) =>
      trendPoint(start, index * 5, 95 - index * 0.1),
    );
    const available = Array.from({ length: 12 }, (_, index) =>
      trendPoint(start, index * 10, 95 - index * 0.1),
    );

    const fewResult = analyzeBatteryPassportTrend(tooFew, NOW_MS);
    const shortResult = analyzeBatteryPassportTrend(tooShort, NOW_MS);
    const availableResult = analyzeBatteryPassportTrend(
      available,
      NOW_MS,
    );

    expect(fewResult.diagnostics.fit.status).toBe(
      'insufficient_points',
    );
    expect(shortResult.diagnostics.fit.status).toBe(
      'insufficient_span',
    );
    expect(availableResult.diagnostics.fit.status).toBe('available');
    expect(
      availableResult.diagnostics.fit.annualizedChangePctPoints,
    ).toBeLessThan(0);
    expect(fewResult.diagnostics.fit.annualizedChangePctPoints)
      .toBeNull();
    expect(shortResult.diagnostics.fit.annualizedChangePctPoints)
      .toBeNull();
  });

  it('caps the displayed timeline without losing returned-row accounting', () => {
    const start = Date.parse('2026-01-01T00:00:00Z');
    const source = Array.from({ length: 182 }, (_, index) =>
      trendPoint(start, index, 95 - index * 0.01),
    );

    const result = analyzeBatteryPassportTrend(
      source,
      Date.parse('2026-12-31T12:00:00Z'),
    );

    expect(result.accounting.returnedPoints).toBe(182);
    expect(result.accounting.categories.included).toBe(182);
    expect(result.cap).toMatchObject({
      backendMaximum: 180,
      canonicalPoints: 182,
      displayedPoints: 180,
      omittedByDisplayCap: 2,
      backendCapReached: true,
      clientCapApplied: true,
    });
    expect(result.points[0]?.date).toBe('2026-01-03');
  });
});

describe('grade reconstruction', () => {
  it('pins every documented grade boundary', () => {
    expect(batteryPassportGradeFromScore(90)).toBe('A');
    expect(batteryPassportGradeFromScore(89.999)).toBe('B');
    expect(batteryPassportGradeFromScore(80)).toBe('B');
    expect(batteryPassportGradeFromScore(70)).toBe('C');
    expect(batteryPassportGradeFromScore(60)).toBe('D');
    expect(batteryPassportGradeFromScore(50)).toBe('E');
    expect(batteryPassportGradeFromScore(49.999)).toBe('F');
  });

  it('matches the server formula and surfaces reported-grade mismatch', () => {
    const matching = reconstructBatteryPassportGrade(92, 1, 1500, 'C');
    const mismatch = reconstructBatteryPassportGrade(92, 1, 1500, 'A');

    expect(matching).toMatchObject({
      score: 72,
      grade: 'C',
      fastChargePenalty: 8,
      cyclePenalty: 12,
      matchesReported: true,
    });
    expect(mismatch.matchesReported).toBe(false);
    expect(mismatch.reportedGrade).toBe('A');
    expect(mismatch.grade).toBe('C');
  });

  it('treats the backend unknown-SoH sentinel as unavailable', () => {
    const source = passport({
      soh_pct: 0,
      health_grade: 'N/A',
    });

    const result = analyzeBatteryPassport(source, NOW_MS);
    const artifact = toBatteryPassportCertificate(source);

    expect(result.metrics.sohPct).toBeNull();
    expect(result.grade).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'unknown_soh',
      score: null,
      grade: null,
      reportedGrade: 'N/A',
      matchesReported: null,
    });
    expect(result.grade.grade).not.toBe('F');
    expect(result.grade.matchesReported).not.toBe(false);
    expect(result.hashFacts.sohPct).toBe(0);
    expect(artifact).toMatchObject({
      soh_pct: 0,
      health_grade: 'N/A',
    });
  });

  it('clamps finite hostile formula inputs and rejects non-finite inputs', () => {
    const clamped = reconstructBatteryPassportGrade(
      150,
      -1,
      -50,
      'A',
    );
    const unavailable = reconstructBatteryPassportGrade(
      Number.NaN,
      0,
      0,
      'A',
    );

    expect(clamped).toMatchObject({
      score: 100,
      grade: 'A',
      inputsClamped: true,
      clampedSohPct: 100,
      clampedFastChargeRatio: 0,
      clampedEquivalentFullCycles: 0,
    });
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.score).toBeNull();
  });
});

describe('thermal and whole-certificate analysis', () => {
  it('reports the exact thermal sum without normalization', () => {
    const result = analyzeBatteryPassportThermal({
      cold_pct: 33.3,
      nominal_pct: 33.3,
      hot_pct: 33.4,
    });

    expect(result.status).toBe('available');
    expect(result.sumPct).toBe(100);
    expect(result.differenceFrom100PctPoints).toBe(0);
    expect(result.validBandCount + result.invalidBandCount).toBe(3);
  });

  it('distinguishes zero thermal evidence from hostile thermal values', () => {
    expect(analyzeBatteryPassportThermal({
      cold_pct: 0,
      nominal_pct: 0,
      hot_pct: 0,
    }).status).toBe('no_data');
    const invalid = analyzeBatteryPassportThermal({
      cold_pct: Number.POSITIVE_INFINITY,
      nominal_pct: 50,
      hot_pct: -1,
    });
    expect(invalid.status).toBe('invalid');
    expect(invalid.sumPct).toBeNull();
    expect(invalid.invalidBandCount).toBe(2);
  });

  it('sanitizes hostile diagnostics without mutating certificate facts', () => {
    const hostile = passport({
      soh_pct: Number.NaN,
      capacity_kwh: Number.POSITIVE_INFINITY,
      original_capacity_kwh: -75,
      equivalent_full_cycles: -1,
      fast_charge_ratio: 2,
      avg_charge_limit_pct: 101,
      thermal_exposure: {
        cold_pct: 20,
        nominal_pct: Number.NaN,
        hot_pct: 80,
      },
      degradation_trend: [
        { date: 'bad', soh_pct: Number.NaN },
        { date: '2026-08-01', soh_pct: -2 },
      ],
    });
    const snapshot = structuredClone(hostile);

    const result = analyzeBatteryPassport(hostile, NOW_MS);

    expect(result.metrics.invalidNumericFieldCount).toBe(6);
    expect(result.metrics.capacityRatio).toBeNull();
    expect(result.grade.status).toBe('unavailable');
    expect(result.thermal.status).toBe('invalid');
    expect(result.trend.accounting.categories).toMatchObject({
      invalid_date: 1,
      invalid_soh: 1,
    });
    expect(hostile).toEqual(snapshot);
  });

  it('returns explicit empty evidence and zero breadth support', () => {
    const result = analyzeBatteryPassport(null, NOW_MS);

    expect(result.trend.points).toEqual([]);
    expect(result.trend.accounting.returnedPoints).toBe(0);
    expect(result.trend.diagnostics.spanDays).toBeNull();
    expect(result.trend.distribution.every((bin) => bin.share == null))
      .toBe(true);
    expect(result.support).toMatchObject({
      index: 0,
      band: 'none',
    });
    expect(result.hashFacts.vehicleId).toBeNull();
  });

  it('builds a clean snake_case artifact without diagnostic changes', () => {
    const source = Object.assign(passport(), {
      vehicleId: 999,
      capacityKwh: 999,
      thermalExposure: { coldPct: 999 },
    });
    const artifact = toBatteryPassportCertificate(source);
    const thermal = artifact.thermal_exposure as Record<string, unknown>;
    const trend = artifact.degradation_trend as Array<
      Record<string, unknown>
    >;

    expect(artifact.capacity_kwh).toBe(source.capacity_kwh);
    expect(artifact).not.toHaveProperty('vehicleId');
    expect(artifact).not.toHaveProperty('capacityKwh');
    expect(artifact).not.toHaveProperty('thermalExposure');
    expect(thermal).toEqual({
      cold_pct: 10,
      nominal_pct: 80,
      hot_pct: 10,
    });
    expect(thermal).not.toHaveProperty('coldPct');
    expect(trend[0]).toEqual({
      date: '2026-05-01',
      soh_pct: 92.1,
    });
  });

  it('excludes malformed trend entries from export without mutating facts', () => {
    const malformedTrend: unknown[] = [
      { date: '2026-05-01', soh_pct: 92.1 },
      null,
      'not-an-object',
      { date: 'not-a-day', soh_pct: 91 },
      { date: '2026-02-30', soh_pct: 91 },
      { date: '2026-06-01', soh_pct: Number.NaN },
      { date: '2026-07-01', soh_pct: 101 },
      { date: '2027-01-01', soh_pct: 90 },
      { date: '2026-05-01', soh_pct: 89 },
    ];
    const source = passport({
      degradation_trend:
        malformedTrend as BatteryPassportTrendPoint[],
    });
    const snapshot = structuredClone(source);

    const artifact = toBatteryPassportCertificate(source);

    expect(artifact).toEqual({
      vehicle_id: source.vehicle_id,
      vin_masked: source.vin_masked,
      issued_at: source.issued_at,
      first_observed_at: source.first_observed_at,
      soh_pct: source.soh_pct,
      capacity_kwh: source.capacity_kwh,
      original_capacity_kwh: source.original_capacity_kwh,
      equivalent_full_cycles: source.equivalent_full_cycles,
      fast_charge_ratio: source.fast_charge_ratio,
      avg_charge_limit_pct: source.avg_charge_limit_pct,
      thermal_exposure: {
        cold_pct: source.thermal_exposure.cold_pct,
        nominal_pct: source.thermal_exposure.nominal_pct,
        hot_pct: source.thermal_exposure.hot_pct,
      },
      health_grade: source.health_grade,
      degradation_trend: [
        { date: '2026-05-01', soh_pct: 92.1 },
        { date: '2027-01-01', soh_pct: 90 },
        { date: '2026-05-01', soh_pct: 89 },
      ],
      recommendations: source.recommendations,
      provenance_hash: source.provenance_hash,
    });
    expect(source).toEqual(snapshot);
  });
});
