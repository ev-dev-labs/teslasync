import { describe, expect, it } from 'vitest';
import { normalizationMetrics } from './normalizationMetrics';
import type { DataQualityFieldScore, NormalizationSummary } from '@/types/admin-operator-confidence';

const labels = ['total', 'versioned', 'unversioned', 'coverage', 'required', 'critical']
  .map(key => ({ key, label: key, subtitle: `${key} description` }));
const normalization: NormalizationSummary = {
  required_version: 1, total_sample_count: 1000, versioned_sample_count: 800,
  unversioned_sample_count: 200, coverage_pct: 80, coverage_state: 'measured', versions: [],
};

describe('normalization stat metrics', () => {
  it('keeps numeric sources numeric, version identifiers textual, and all descriptions intact', () => {
    const fields = [{ severity: 'critical' }, { severity: 'ok' }] as DataQualityFieldScore[];
    const metrics = normalizationMetrics(normalization, fields, true, labels, 'Unknown');
    expect(metrics.map(metric => metric.rawValue)).toEqual([1000, 800, 200, 80, 'v1', 1]);
    expect(metrics.map(metric => metric.metricId)).toEqual(['count', 'count', 'count', 'percent', 'text', 'count']);
    expect(metrics.map(metric => metric.description)).toEqual(labels.map(label => label.subtitle));
    expect(normalization.total_sample_count).toBe(1000);
  });

  it('never invents sample counts or critical fields before the first response', () => {
    const metrics = normalizationMetrics(undefined, [], false, labels, 'Unknown');
    expect(metrics.map(metric => metric.rawValue)).toEqual([undefined, undefined, undefined, null, 'Unknown', null]);
    expect(metrics[3].missingReason).toBe('Unknown');
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
});
