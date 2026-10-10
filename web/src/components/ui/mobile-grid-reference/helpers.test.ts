import { describe, expect, it } from 'vitest';
import { canLoadMore, defaultMobileRoles, groupHasSummary, isMobileGridWidth, rowMappingIssues, safeProgress, showMobileSearch } from './helpers';
import { referenceRow } from './testFixtures';

describe('controlled mobile reference contract helpers', () => {
  it('uses strict allocated-container width, never viewport width', () => {
    expect([375, 390, 639, 639.99].map(isMobileGridWidth)).toEqual([true, true, true, true]);
    expect([640, 641, 1440, -1, NaN, Infinity].map(isMobileGridWidth)).toEqual([false, false, false, false, false, false]);
  });
  it('shows search for unknown capacity or more than ten possible rows', () => {
    expect(showMobileSearch(undefined)).toBe(true);
    expect(showMobileSearch(11)).toBe(true);
    expect(showMobileSearch(10)).toBe(false);
    expect(showMobileSearch(0)).toBe(false);
  });
  it('never relabels a replacing page as cumulative Load more', () => {
    expect(canLoadMore({ kind: 'replacing', notice: 'adapter gap' })).toBe(false);
    expect(canLoadMore({ kind: 'single', count: 6 })).toBe(false);
    expect(canLoadMore({ kind: 'cumulative', shown: 20, total: 21, nextCount: 1 })).toBe(true);
    expect(canLoadMore({ kind: 'cumulative', shown: 21, total: 21, nextCount: 0 })).toBe(false);
    expect(canLoadMore({ kind: 'cumulative', shown: 10, total: null, nextCount: 10 })).toBe(true);
  });
  it('never fabricates a singleton aggregate', () => {
    expect(groupHasSummary({ key: 'a', rows: [], memberCount: 1, summary: 'wrong' })).toBe(false);
    expect(groupHasSummary({ key: 'b', rows: [], memberCount: 3, summary: '3 loaded members' })).toBe(true);
    expect(groupHasSummary({ key: 'c', rows: [], memberCount: 3 })).toBe(false);
  });
  it('has deterministic role fallbacks and flags duplicated semantic fields', () => {
    const roles = defaultMobileRoles([
      { key: 'title' }, { key: 'energy', numeric: true },
      { key: 'duration' }, { key: 'distance' }, { key: 'temp' }, { key: 'extra' },
    ]);
    expect([...roles.values()]).toEqual(['title', 'primary', 'meta', 'meta', 'meta', 'hidden']);
    expect(rowMappingIssues(referenceRow())).toEqual([]);
    const row = referenceRow();
    expect(rowMappingIssues({ ...row, meta: [...row.meta, ...row.meta] })).toContain('duplicate-meta-field');
    expect(rowMappingIssues({ ...row, meta: [...row.meta, ...row.meta, ...row.meta, ...row.meta] })).toContain('too-many-meta-fields');
  });
  it('clamps invalid progress without conflating valid zero with missing', () => {
    expect([0, 45, 120, -20, NaN].map(safeProgress)).toEqual([0, 45, 100, 0, 0]);
  });
});
