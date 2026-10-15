import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { ComplianceApportionment } from '@/types/ownership';
import type { UnitPref } from '@/lib/unitConversion';
import { formatMetric } from '@/lib/metric-reference';
import { complianceSummary } from './complianceSummaryMetrics';

const t = ((key: string, fallback: string, vars?: Record<string, unknown>) =>
  fallback.replace(/{{(\w+)}}/g, (match, name: string) =>
    vars && name in vars ? String(vars[name]) : match) || key) as TFunction;
const units: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
  energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
};

function report(overrides: Partial<ComplianceApportionment> = {}): ComplianceApportionment {
  return {
    vehicle_id: 7, currency: 'USD',
    window: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', days: 31 },
    jurisdictions: [], total_distance_m: 12500, assigned_distance_m: 10000,
    unassigned_distance_m: 2500, unassigned_share_pct: 20, total_energy_wh: 25000,
    total_road_usage_charge_minor: 12345, total_registration_fee_minor: 6000,
    total_liability_minor: 18345, total_emissions_g: 123400, drive_count: 8, digest: 'seal',
    quality: {
      status: 'limited', sample_count: 8, coverage_pct: 80,
      window_start: null, window_end: null, reasons: ['Missing coordinates'],
    },
    evidence: [], ...overrides,
  };
}

describe('Period liability typed input contracts', () => {
  it('keeps raw SI distance, numeric major denominations and canonical kg without formatting into text', () => {
    const source = report();
    const summary = complianceSummary(source, units, 2, 'en-US', t);
    expect(summary.metrics.map(metric => metric.metricId))
      .toEqual(['distance', 'distance', 'distance', 'currency', 'currency', 'mass']);
    expect(summary.metrics.map(metric => metric.rawValue))
      .toEqual([12500, 10000, 2500, 123.45, 183.45, 123.4]);
    expect(summary.metrics[0].context).toBe('8 drives');
    expect(summary.metrics[2].context).toBe('20.00%');
    expect(summary.period).toMatchObject({
      kind: 'analysis', start: source.window.from, endExclusive: source.window.to,
      completeness: 'unknown',
    });
    expect(summary.preferences.currency).toEqual({ kind: 'iso', value: 'USD' });
    expect(source.total_emissions_g).toBe(123400);
    expect(source.total_liability_minor).toBe(18345);
  });

  it.each([
    ['JPY', 12345, 0],
    ['BHD', 12.345, 3],
  ] as const)('preserves the recorded %s minor denomination rather than assuming cents', (currency, major, precision) => {
    const summary = complianceSummary(report({ currency }), units, 2, 'en-US', t);
    expect(summary.metrics[3].rawValue).toBe(major);
    expect(summary.metrics[3].display?.precision).toBe(precision);
    expect(summary.preferences.currency).toEqual({ kind: 'iso', value: currency });
  });

  it('preserves kg, locale and precision independently of distance preferences', () => {
    const summary = complianceSummary(report(), { ...units, distance: 'mi' }, 3, 'de-DE', t);
    const emissions = summary.metrics[5];
    expect(formatMetric(emissions.metricId, emissions.rawValue, summary.preferences, undefined, emissions.display))
      .toMatchObject({ value: '123,400', unit: 'kg', rawValue: 123.4, state: 'value' });
    const distance = summary.metrics[0];
    expect(formatMetric(distance.metricId, distance.rawValue, summary.preferences, undefined, distance.display))
      .toMatchObject({ value: '7.77', unit: 'mi', rawValue: 12500 });
  });

  it('does not claim a convertible aggregate when assigned rows record mixed currencies', () => {
    const source = report({
      jurisdictions: [{
        jurisdiction_code: 'GB-LND', label: 'London', currency: 'GBP',
        distance_m: 10000, distance_share_pct: 80, energy_wh: 20000, drive_count: 8,
        road_usage_charge_minor: 12345, registration_fee_minor: 6000,
        total_liability_minor: 18345, emissions_g: 123400, emissions_g_per_m: 12.34,
        confidence_pct: 95,
      }],
    });
    const summary = complianceSummary(source, units, 2, 'en-US', t);
    expect(summary.metrics[3].rawValue).toBeNull();
    expect(summary.metrics[4].rawValue).toBeNull();
    expect(summary.metrics[4].missingReason).toBe('Mixed currencies; see the jurisdiction amounts below.');
    expect(source.jurisdictions?.[0].total_liability_minor).toBe(18345);
    expect(summary.metrics[0].rawValue).toBe(12500);
  });

  it('does not invent zeros or an editor currency when the source is absent', () => {
    const summary = complianceSummary(undefined, units, 2, 'en-US', t);
    expect(summary.metrics.map(metric => metric.rawValue)).toEqual([
      undefined, undefined, undefined, null, null, null,
    ]);
    expect(summary.period.kind).toBe('unknown');
    expect(summary.preferences.currency.value).toBe('');
  });

  it('keeps all real zero measurements, including zero kg and zero monetary amounts', () => {
    const summary = complianceSummary(report({
      total_distance_m: 0, assigned_distance_m: 0, unassigned_distance_m: 0,
      total_road_usage_charge_minor: 0, total_liability_minor: 0, total_emissions_g: 0,
    }), units, 2, 'en-US', t);
    expect(summary.metrics.map(metric => metric.rawValue)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
