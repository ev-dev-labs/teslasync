import { describe, expect, it } from 'vitest';
import { makeReferenceRecords, REFERENCE_SCENARIOS } from './fixtures';
import { filterReferenceRows, referenceExportKeys, sortReferenceRows, toggleReferenceKey } from './fixtureHelpers';

describe('synthetic reference fixture invariants', () => {
  it('preserves 15 canonical fields, SI magnitudes, zero and null on disk', () => {
    const rows = makeReferenceRecords(4);
    expect(Object.keys(rows[0] ?? {})).toHaveLength(15);
    expect(rows[0]?.energy_wh).toBe(0);
    expect(rows[0]?.duration_s).toBeNull();
    expect(rows[1]?.energy_wh).toBe(26300);
    expect(rows[1]?.duration_s).toBe(10800);
    expect(rows[1]?.distance_m).toBe(42300);
    expect(rows[1]?.power_w).toBe(7700);
  });
  it('covers all original named states plus explicit source adapter gaps', () => {
    const ids = REFERENCE_SCENARIOS.map(scenario => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['dev-empty', 'dev-no-match', 'dev-loading', 'dev-error',
      'dev-one-row', 'dev-one-page', 'dev-many-pages', 'dev-200-rows', 'dev-grouped',
      'dev-long-values', 'dev-many-columns', 'dev-key-value', 'dev-selection', 'dev-sort-open',
      'dev-retained-error', 'dev-replacing-page', 'dev-full-export']));
  });
  it('loaded/selected export scopes remain independent of the visible batch/filter', () => {
    const loaded = makeReferenceRecords(21);
    const matching = loaded.filter(row => row.place === 'home');
    expect(referenceExportKeys('matchingLoaded', loaded, matching, ['reference-1'])).toHaveLength(14);
    expect(referenceExportKeys('selectedLoaded', loaded, matching, ['reference-1', 'unknown'])).toEqual(['reference-1']);
    expect(referenceExportKeys('fullResult', loaded, matching, [])).toHaveLength(21);
  });
  it('selects across batches and distinguishes single from multi selection', () => {
    expect(toggleReferenceKey(['reference-1'], 'reference-21')).toEqual(['reference-1', 'reference-21']);
    expect(toggleReferenceKey(['reference-1'], 'reference-21', 'single')).toEqual(['reference-21']);
    expect(toggleReferenceKey(['reference-1'], 'reference-1')).toEqual([]);
  });
  it('matches human titles and raw fields without mutating canonical input', () => {
    const rows = makeReferenceRecords(21);
    const titles = new Map(rows.map(row => [row.id, 'Reference home']));
    expect(filterReferenceRows(rows, 'missing', 'all', titles)).toHaveLength(0);
    expect(filterReferenceRows(rows, 'BatteryLevel', 'home', titles)).toHaveLength(14);
    const sorted = sortReferenceRows(rows, 'cost');
    expect(sorted[0]?.cost_usd).toBe(3.2);
    expect(rows[0]?.cost_usd).toBe(0);
  });
});
