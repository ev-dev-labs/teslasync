import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { DataQualityFieldScore, NormalizationVersionCount } from '@/types/admin-operator-confidence';
import {
  countBySeverity, coverageTrust, formatCoveragePct, formatDuplicateRatio,
  formatSeconds, sortFieldsWorstFirst, sortVersions, versionLabel,
} from './helpers';

function field(name: string, score: number, severity: DataQualityFieldScore['severity'] = 'ok'): DataQualityFieldScore {
  return {
    field: name, composite_score: score, severity, sample_count: 10,
    last_seen_at: '2026-10-13T18:00:00Z', freshness_seconds: 0, max_gap_seconds: 0,
    duplicate_ratio: 0, versioned_sample_count: 10, unversioned_sample_count: 0,
    normalization_coverage_pct: 100, normalization_coverage_state: 'measured',
  };
}

beforeEach(() => { setGlobalLocale('en-US'); setGlobalPrecision(2); });
afterEach(() => { setGlobalLocale('en-US'); setGlobalPrecision(2); });

describe('data quality helper preservation contracts', () => {
  it.each([
    ['negative coverage', -0.01, 'none'], ['exact zero', 0, 'none'],
    ['immediately above zero', 0.01, 'partial'], ['interior', 50, 'partial'],
    ['immediately below complete', 99.99, 'partial'], ['exact complete', 100, 'complete'],
    ['above complete', 100.01, 'complete'],
  ] as const)('classifies %s without shifting trust thresholds', (_name, input, expected) => {
    expect(coverageTrust(input, 'measured')).toBe(expected);
  });

  it.each([
    ['null', null], ['undefined', undefined], ['NaN', Number.NaN],
    ['positive infinity', Infinity], ['negative infinity', -Infinity],
  ] as const)('keeps %s unknown in coverage and duplicate formatters', (_name, input) => {
    expect(coverageTrust(input, 'measured')).toBe('unknown');
    expect(formatCoveragePct(input, 'measured')).toBeNull();
    expect(formatDuplicateRatio(input)).toBeNull();
  });

  it('honors authoritative unknown for stale zero and positive coverage', () => {
    for (const value of [0, 50, 100]) {
      expect(coverageTrust(value, 'unknown')).toBe('unknown');
      expect(formatCoveragePct(value, 'unknown')).toBeNull();
    }
  });

  it('preserves default and explicit specialist coverage precision without clamping', () => {
    expect(formatCoveragePct(0, 'measured')).toBe('0.00%');
    expect(formatCoveragePct(85.456, 'measured', 1)).toBe('85.5%');
    expect(formatCoveragePct(-1, 'measured', 0)).toBe('-1%');
    expect(formatCoveragePct(101, 'measured', 0)).toBe('101%');
    setGlobalPrecision(3);
    expect(formatCoveragePct(12.3456, 'measured')).toBe('12.346%');
    expect(formatCoveragePct(12.3456, 'measured', 0)).toBe('12%');
  });

  it('uses saved locale for coverage and ratios while retaining raw arithmetic', () => {
    setGlobalLocale('de-DE');
    expect(formatCoveragePct(1234.5, 'measured')).toBe('1.234,50%');
    expect(formatDuplicateRatio(0.123456)).toBe('12,35%');
    setGlobalPrecision(3);
    expect(formatDuplicateRatio(0.123456)).toBe('12,346%');
  });

  it.each([
    ['zero', 0, '0.00%'], ['interior', 0.25, '25.00%'], ['one', 1, '100.00%'],
    ['negative valid public input', -0.25, '-25.00%'], ['above one public input', 1.25, '125.00%'],
  ] as const)('formats duplicate ratio %s without adding a clamp', (_name, ratio, expected) => {
    expect(formatDuplicateRatio(ratio)).toBe(expected);
  });

  it.each([
    ['zero', 0, '0s'], ['below second half', 0.49, '0s'], ['second half', 0.5, '1s'],
    ['before minute rounding', 59.49, '59s'], ['rounded seconds before minute', 59.5, '60s'],
    ['immediately below minute', 59.999, '60s'], ['at minute', 60, '1m'],
    ['immediately above minute', 60.001, '1m'], ['before minute half', 89.99, '1m'],
    ['minute half', 90, '2m'], ['immediately below hour', 3599.999, '60m'],
    ['at hour', 3600, '1h'], ['immediately above hour', 3600.001, '1h'],
    ['before hour half', 5399.99, '1h'], ['hour half', 5400, '2h'],
    ['immediately below day', 86399.999, '24h'], ['at day', 86400, '1d'],
    ['immediately above day', 86400.001, '1d'], ['before day half', 129599.99, '1d'],
    ['day half', 129600, '2d'], ['huge finite duration', 8640000000, '100000d'],
  ] as const)('preserves duration %s threshold and rounding', (_name, seconds, expected) => {
    setGlobalPrecision(5);
    expect(formatSeconds(seconds)).toBe(expected);
  });

  it.each([
    ['null', null], ['undefined', undefined], ['NaN', Number.NaN],
    ['positive infinity', Infinity], ['negative infinity', -Infinity],
    ['negative fraction', -0.001], ['negative integer', -1],
  ] as const)('keeps duration %s unmeasurable instead of zero', (_name, seconds) => {
    expect(formatSeconds(seconds)).toBeNull();
  });

  it('localizes duration digits without changing rounded values or default units', () => {
    setGlobalLocale('ar-EG');
    expect([12, 90, 5400, 129600].map(formatSeconds)).toEqual(['١٢s', '٢m', '٢h', '٢d']);
  });

  it('preserves caller legacy labels and explicit zero and signed versions', () => {
    expect(versionLabel(null, 'Ancien / inconnu')).toBe('Ancien / inconnu');
    expect(versionLabel(undefined, '')).toBe('');
    expect(versionLabel(0, 'Legacy')).toBe('v0');
    expect(versionLabel(-1, 'Legacy')).toBe('v-1');
    expect(versionLabel(1234, 'Legacy')).toBe('v1234');
  });

  it('sorts every legacy bucket first then signed versions stably without mutation', () => {
    const buckets: readonly NormalizationVersionCount[] = Object.freeze([
      Object.freeze({ version: 2, sample_count: 4, share_pct: 40 }),
      Object.freeze({ version: null, sample_count: 1, share_pct: null }),
      Object.freeze({ version: 0, sample_count: 2, share_pct: 20 }),
      Object.freeze({ version: null, sample_count: 3, share_pct: 30 }),
      Object.freeze({ version: -1, sample_count: 0, share_pct: 0 }),
    ]);
    const sorted = sortVersions(buckets);
    expect(sorted.map(row => [row.version, row.sample_count, row.share_pct])).toEqual([
      [null, 1, null], [null, 3, 30], [-1, 0, 0], [0, 2, 20], [2, 4, 40],
    ]);
    expect(buckets.map(row => row.version)).toEqual([2, null, 0, null, -1]);
    expect(sorted).not.toBe(buckets);
  });

  it('keeps empty missing and singleton version distributions distinct and copied', () => {
    expect(sortVersions(null)).toEqual([]);
    expect(sortVersions(undefined)).toEqual([]);
    expect(sortVersions([])).toEqual([]);
    const single: NormalizationVersionCount[] = [{ version: 0, sample_count: 0, share_pct: null }];
    expect(sortVersions(single)).toEqual([{ version: 0, sample_count: 0, share_pct: null }]);
    expect(sortVersions(single)).not.toBe(single);
  });

  it('sorts negative zero tied and healthy fields worst first without mutating raw SI', () => {
    const fields = Object.freeze([
      Object.freeze(field('Zulu', 50, 'warn')), Object.freeze(field('Healthy', 100)),
      Object.freeze(field('Alpha', 50, 'warn')), Object.freeze(field('Zero', 0, 'critical')),
      Object.freeze(field('Negative', -1, 'critical')),
    ]);
    expect(sortFieldsWorstFirst(fields).map(row => row.field)).toEqual(['Negative', 'Zero', 'Alpha', 'Zulu', 'Healthy']);
    expect(fields.map(row => row.field)).toEqual(['Zulu', 'Healthy', 'Alpha', 'Zero', 'Negative']);
    expect(fields[0]).toMatchObject({ freshness_seconds: 0, duplicate_ratio: 0, versioned_sample_count: 10 });
  });

  it('handles empty missing singleton and missing runtime scores with original zero fallback', () => {
    expect(sortFieldsWorstFirst(null)).toEqual([]);
    expect(sortFieldsWorstFirst(undefined)).toEqual([]);
    expect(sortFieldsWorstFirst([])).toEqual([]);
    const singleton = [field('Only', 10)];
    expect(sortFieldsWorstFirst(singleton).map(row => row.field)).toEqual(['Only']);
    expect(sortFieldsWorstFirst(singleton)).not.toBe(singleton);
    // A malformed wire row is deliberately decoded, not declared as a valid typed fixture.
    const missing: DataQualityFieldScore = JSON.parse(JSON.stringify({ ...field('Missing', 1), composite_score: null }));
    expect(sortFieldsWorstFirst([field('Positive', 1), missing, field('Negative', -1)]).map(row => row.field))
      .toEqual(['Negative', 'Missing', 'Positive']);
  });

  it('counts exact severity partitions including zero counts and absent inputs', () => {
    const fields = [field('CriticalA', 10, 'critical'), field('CriticalB', 20, 'critical'),
      field('Warning', 60, 'warn'), field('Healthy', 100, 'ok')];
    expect(['critical', 'warn', 'ok'].map(severity => countBySeverity(fields, severity as DataQualityFieldScore['severity'])))
      .toEqual([2, 1, 1]);
    expect(countBySeverity([field('Healthy', 100)], 'critical')).toBe(0);
    expect(countBySeverity([], 'ok')).toBe(0);
    expect(countBySeverity(null, 'critical')).toBe(0);
    expect(countBySeverity(undefined, 'warn')).toBe(0);
  });
});
