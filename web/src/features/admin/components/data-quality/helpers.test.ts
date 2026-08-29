import { describe, it, expect } from 'vitest';

import {
  countBySeverity,
  coverageTrust,
  formatCoveragePct,
  formatDuplicateRatio,
  formatSeconds,
  sortFieldsWorstFirst,
  sortVersions,
  versionLabel,
} from './helpers';
import type {
  DataQualityFieldScore,
  NormalizationVersionCount,
} from '@/types/admin-operator-confidence';

// ---------------------------------------------------------------------------
// data-quality/helpers — evidence-honesty contract lock
//
// The single most important property these helpers carry is the distinction
// between "no measurement" (null) and "a measured zero". The backend
// deliberately returns `coverage_pct: null` for an empty window rather than
// fabricating 0 %, and these helpers must preserve that all the way to the
// display boundary. A helper that coerced null → 0 would let the UI claim a
// failing coverage measurement that was never taken.
//
// The second property is bucket identity: `version: null` (legacy / written
// before migration 000232) is NOT `version: 0` (an explicit below-contract
// attestation). Collapsing them would erase provenance.
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<DataQualityFieldScore> = {}): DataQualityFieldScore {
  return {
    field: 'VehicleSpeed',
    sample_count: 100,
    last_seen_at: '2026-08-29T12:00:00Z',
    freshness_seconds: 10,
    max_gap_seconds: 5,
    duplicate_ratio: 0,
    versioned_sample_count: 100,
    unversioned_sample_count: 0,
    normalization_coverage_pct: 100,
    normalization_coverage_state: 'measured',
    composite_score: 100,
    severity: 'ok',
    ...overrides,
  };
}

describe('coverageTrust', () => {
  it('reports unknown when the backend measured nothing', () => {
    expect(coverageTrust(null, 'unknown')).toBe('unknown');
    expect(coverageTrust(null)).toBe('unknown');
    expect(coverageTrust(undefined)).toBe('unknown');
  });

  it('honours an explicit unknown state even if a percentage leaked through', () => {
    // Defensive: the backend contract pairs null with 'unknown', but the state
    // flag is authoritative — we must never present a stale number as measured.
    expect(coverageTrust(42, 'unknown')).toBe('unknown');
  });

  it('never treats NaN or Infinity as a measurement', () => {
    expect(coverageTrust(Number.NaN, 'measured')).toBe('unknown');
    expect(coverageTrust(Number.POSITIVE_INFINITY, 'measured')).toBe('unknown');
  });

  it('separates a measured zero from an unknown', () => {
    expect(coverageTrust(0, 'measured')).toBe('none');
    expect(coverageTrust(0, 'measured')).not.toBe(coverageTrust(null, 'unknown'));
  });

  it('classifies partial and complete coverage', () => {
    expect(coverageTrust(0.1, 'measured')).toBe('partial');
    expect(coverageTrust(50, 'measured')).toBe('partial');
    expect(coverageTrust(99.9, 'measured')).toBe('partial');
    expect(coverageTrust(100, 'measured')).toBe('complete');
  });
});

describe('formatCoveragePct', () => {
  it('returns null (not "0.0%") when there is no measurement', () => {
    expect(formatCoveragePct(null, 'unknown')).toBeNull();
    expect(formatCoveragePct(null, 'measured')).toBeNull();
    expect(formatCoveragePct(undefined)).toBeNull();
    expect(formatCoveragePct(Number.NaN, 'measured')).toBeNull();
  });

  it('formats a measured zero as an explicit 0.0%', () => {
    expect(formatCoveragePct(0, 'measured')).toBe('0.0%');
  });

  it('formats measured percentages at the requested precision', () => {
    expect(formatCoveragePct(85, 'measured')).toBe('85.0%');
    expect(formatCoveragePct(85.456, 'measured', 2)).toBe('85.46%');
    expect(formatCoveragePct(100, 'measured', 0)).toBe('100%');
  });
});

describe('versionLabel', () => {
  it('labels the null bucket as legacy rather than v0', () => {
    expect(versionLabel(null, 'Legacy / unknown')).toBe('Legacy / unknown');
    expect(versionLabel(undefined, 'Legacy / unknown')).toBe('Legacy / unknown');
  });

  it('keeps an explicit version 0 distinguishable from legacy', () => {
    expect(versionLabel(0, 'Legacy / unknown')).toBe('v0');
    expect(versionLabel(0, 'Legacy / unknown')).not.toBe(versionLabel(null, 'Legacy / unknown'));
  });

  it('labels attested versions', () => {
    expect(versionLabel(1, 'Legacy')).toBe('v1');
    expect(versionLabel(2, 'Legacy')).toBe('v2');
  });
});

describe('sortVersions', () => {
  const buckets: NormalizationVersionCount[] = [
    { version: 2, sample_count: 5, share_pct: 5 },
    { version: null, sample_count: 40, share_pct: 40 },
    { version: 0, sample_count: 10, share_pct: 10 },
    { version: 1, sample_count: 45, share_pct: 45 },
  ];

  it('places the legacy bucket first, then ascends by version', () => {
    expect(sortVersions(buckets).map((b) => b.version)).toEqual([null, 0, 1, 2]);
  });

  it('never mutates the caller array', () => {
    const input = [...buckets];
    sortVersions(input);
    expect(input.map((b) => b.version)).toEqual([2, null, 0, 1]);
  });

  it('is null-safe', () => {
    expect(sortVersions(null)).toEqual([]);
    expect(sortVersions(undefined)).toEqual([]);
  });
});

describe('sortFieldsWorstFirst', () => {
  it('orders by ascending composite score', () => {
    const sorted = sortFieldsWorstFirst([
      makeField({ field: 'Good', composite_score: 95 }),
      makeField({ field: 'Bad', composite_score: 12 }),
      makeField({ field: 'Mid', composite_score: 60 }),
    ]);
    expect(sorted.map((f) => f.field)).toEqual(['Bad', 'Mid', 'Good']);
  });

  it('breaks ties by field name so the order is deterministic', () => {
    const sorted = sortFieldsWorstFirst([
      makeField({ field: 'Zulu', composite_score: 50 }),
      makeField({ field: 'Alpha', composite_score: 50 }),
    ]);
    expect(sorted.map((f) => f.field)).toEqual(['Alpha', 'Zulu']);
  });

  it('is null-safe and does not mutate the input', () => {
    const input = [
      makeField({ field: 'B', composite_score: 10 }),
      makeField({ field: 'A', composite_score: 90 }),
    ];
    sortFieldsWorstFirst(input);
    expect(input.map((f) => f.field)).toEqual(['B', 'A']);
    expect(sortFieldsWorstFirst(null)).toEqual([]);
  });
});

describe('countBySeverity', () => {
  it('counts only the requested tier', () => {
    const fields = [
      makeField({ field: 'a', severity: 'critical' }),
      makeField({ field: 'b', severity: 'critical' }),
      makeField({ field: 'c', severity: 'warn' }),
      makeField({ field: 'd', severity: 'ok' }),
    ];
    expect(countBySeverity(fields, 'critical')).toBe(2);
    expect(countBySeverity(fields, 'warn')).toBe(1);
    expect(countBySeverity(fields, 'ok')).toBe(1);
  });

  it('is null-safe', () => {
    expect(countBySeverity(null, 'critical')).toBe(0);
    expect(countBySeverity(undefined, 'ok')).toBe(0);
  });
});

describe('formatSeconds', () => {
  it('returns null for unmeasurable input rather than "0s"', () => {
    expect(formatSeconds(null)).toBeNull();
    expect(formatSeconds(undefined)).toBeNull();
    expect(formatSeconds(Number.NaN)).toBeNull();
    expect(formatSeconds(-1)).toBeNull();
  });

  it('formats a measured zero explicitly', () => {
    expect(formatSeconds(0)).toBe('0s');
  });

  it('steps units at the documented boundaries', () => {
    expect(formatSeconds(59)).toBe('59s');
    expect(formatSeconds(60)).toBe('1m');
    expect(formatSeconds(3599)).toBe('60m');
    expect(formatSeconds(3600)).toBe('1h');
    expect(formatSeconds(86_399)).toBe('24h');
    expect(formatSeconds(86_400)).toBe('1d');
  });
});

describe('formatDuplicateRatio', () => {
  it('converts a 0..1 ratio to a percentage string', () => {
    expect(formatDuplicateRatio(0)).toBe('0.0%');
    expect(formatDuplicateRatio(0.5)).toBe('50.0%');
    expect(formatDuplicateRatio(1)).toBe('100.0%');
  });

  it('returns null for an unmeasurable ratio', () => {
    expect(formatDuplicateRatio(null)).toBeNull();
    expect(formatDuplicateRatio(undefined)).toBeNull();
    expect(formatDuplicateRatio(Number.NaN)).toBeNull();
  });
});
