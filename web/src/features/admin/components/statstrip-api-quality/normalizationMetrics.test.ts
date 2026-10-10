import { describe, expect, it } from 'vitest';
import { normalizationMetrics } from './normalizationMetrics';
import { formatOperationalMetrics } from '@/lib/operationalMetrics';
import type { MetricPreferences } from '@/lib/metric-reference';
import type { DataQualityFieldScore, NormalizationSummary } from '@/types/admin-operator-confidence';

const labels = ['total', 'versioned', 'unversioned', 'coverage', 'required', 'critical']
  .map(key => ({ key, label: key, subtitle: `${key} description` }));
const normalization: NormalizationSummary = {
  required_version: 1, total_sample_count: 1000, versioned_sample_count: 800,
  unversioned_sample_count: 200, coverage_pct: 80, coverage_state: 'measured', versions: [],
};
const preferences: MetricPreferences = {
  units: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
  },
  currency: { kind: 'symbol', value: '$' },
};
const field: DataQualityFieldScore = {
  field: 'Speed', sample_count: 10, last_seen_at: '2026-10-07T04:00:00Z',
  freshness_seconds: 0, max_gap_seconds: 0, duplicate_ratio: 0,
  versioned_sample_count: 10, unversioned_sample_count: 0,
  normalization_coverage_pct: 100, normalization_coverage_state: 'measured',
  composite_score: 100, severity: 'ok',
};

describe('normalization stat metrics', () => {
  it('keeps numeric sources numeric, version identifiers textual, and all descriptions intact', () => {
    const fields: DataQualityFieldScore[] = [{ ...field, severity: 'critical' }, field];
    const metrics = normalizationMetrics(normalization, fields, true, labels, 'Unknown');
    expect(metrics.map(metric => metric.rawValue)).toEqual([1000, 800, 200, 80, 1, 1]);
    expect(metrics.map(metric => metric.metricId)).toEqual(['count', 'count', 'count', 'percent', 'identifier', 'count']);
    expect(metrics.map(metric => metric.description)).toEqual(labels.map(label => label.subtitle));
    expect(normalization.total_sample_count).toBe(1000);
    expect(metrics.map(metric => metric.context)).toEqual(labels.map(label => label.subtitle));
    expect(metrics.map(metric => metric.occurrenceId)).toEqual(labels.map(label => `normalization-${label.key}`));
    expect(formatOperationalMetrics(metrics, preferences, (_key, fallback) => fallback)[4].value).toBe('v1');
  });

  it('never invents sample counts or critical fields before the first response', () => {
    const metrics = normalizationMetrics(undefined, [], false, labels, 'Unknown');
    expect(metrics.map(metric => metric.rawValue)).toEqual([undefined, undefined, undefined, null, 'Unknown', null]);
    expect(metrics[3].missingReason).toBe('Unknown');
    expect(metrics[4].metricId).toBe('text');
    expect(metrics[4].display).toBeUndefined();
  });

  it('withholds zero-sample coverage even if an inconsistent payload reports a percentage', () => {
    const metrics = normalizationMetrics({ ...normalization, total_sample_count: 0, coverage_pct: 100 }, [], true, labels, 'Unknown');
    expect(metrics[0].rawValue).toBe(0);
    expect(metrics[3].rawValue).toBeNull();
    expect(metrics[5].rawValue).toBe(0);
  });

  it('preserves a measured zero percent when samples really exist', () => {
    const metrics = normalizationMetrics({ ...normalization, versioned_sample_count: 0, coverage_pct: 0 }, [], true, labels, 'Unknown');
    expect(metrics[3].rawValue).toBe(0);
    expect(metrics[3].missingReason).toBeUndefined();
  });

  it.each([0, 1, 1234567])('preserves required version %s as a raw identifier through the real Brief formatter', required_version => {
    const source = { ...normalization, required_version };
    const metrics = normalizationMetrics(source, [], true, labels, 'Unknown');
    expect(metrics[4]).toMatchObject({
      metricId: 'identifier', rawValue: required_version,
      display: { identifierPrefix: 'v' }, occurrenceId: 'normalization-required',
      label: 'required', description: 'required description', context: 'required description',
    });
    const briefMetrics = formatOperationalMetrics(metrics, preferences, (_key, fallback) => fallback);
    expect(briefMetrics[4]).toMatchObject({
      key: 'normalization-required', rawValue: required_version,
      value: `v${required_version}`, valueState: 'value',
    });
    expect(source.required_version).toBe(required_version);
    expect(metrics.filter(metric => metric.display != null)).toHaveLength(1);
  });

  it('preserves localized unknown identity without adding a version prefix', () => {
    const unknown = 'Version not supplied';
    const metrics = normalizationMetrics(undefined, [], false, labels, unknown);
    expect(metrics[4]).toMatchObject({ metricId: 'text', rawValue: unknown });
    expect(metrics[4].display).toBeUndefined();
    const briefMetrics = formatOperationalMetrics(metrics, preferences, (_key, fallback) => fallback);
    expect(briefMetrics[4]).toMatchObject({ rawValue: unknown, value: unknown, valueState: 'value' });
  });
});
