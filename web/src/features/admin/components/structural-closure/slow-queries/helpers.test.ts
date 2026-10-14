import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SlowQueryRow } from '@/types/admin-operator-confidence';
import { cacheHitRatioLabel, cacheHitRatioTotalValue, cacheHitRatioValue } from './helpers';
import { useSlowQueriesPage } from '../../../hooks/useSlowQueriesPage';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/api/hooks/useOperatorConfidence', () => ({ useSlowQueries: queryMock }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: String, fmtCompact: String, fmtNumber: String, precision: 2, locale: 'en-US',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function row(counters: Partial<SlowQueryRow> = {}): SlowQueryRow {
  return Object.freeze({
    query_id: 1, fingerprint: 'SELECT fixture', calls: 10,
    total_time_ms: 500, mean_time_ms: 50, max_time_ms: 100,
    rows_returned: 20, ...counters,
  });
}

describe('slow-query cache evidence', () => {
  it.each([
    {}, { shared_blks_hit: 100 }, { shared_blks_read: 100 },
    { shared_blks_hit: null, shared_blks_read: 100 },
    { shared_blks_hit: 100, shared_blks_read: null },
    { shared_blks_hit: 0, shared_blks_read: 0 },
    { shared_blks_hit: NaN, shared_blks_read: 100 },
    { shared_blks_hit: 100, shared_blks_read: Infinity },
    { shared_blks_hit: -1, shared_blks_read: 100 },
  ])('keeps missing, untouched or invalid counters unknown: %j', counters => {
    const value = row(counters);
    expect(cacheHitRatioValue(value)).toBeNull();
    expect(cacheHitRatioLabel(value)).toBe('—');
    expect(cacheHitRatioTotalValue([value])).toBeNull();
  });

  it.each([[0, 100, 0], [100, 0, 100], [900, 100, 90]])(
    'preserves measured hits %i and reads %i as %i percent', (hit, read, expected) => {
      const value = row({ shared_blks_hit: hit, shared_blks_read: read });
      expect(cacheHitRatioValue(value)).toBe(expected);
      expect(cacheHitRatioLabel(value)).not.toBe('—');
      expect(cacheHitRatioTotalValue([value])).toBe(expected);
    },
  );

  it('preserves block-weighted totals and allows measured untouched rows', () => {
    const rows = [
      row({ shared_blks_hit: 900, shared_blks_read: 100 }),
      row({ shared_blks_hit: 20, shared_blks_read: 180 }),
      row({ shared_blks_hit: 0, shared_blks_read: 0 }),
    ];
    expect(cacheHitRatioTotalValue(rows)).toBeCloseTo(76.6666666667);
    expect(cacheHitRatioTotalValue([])).toBeNull();
    expect(cacheHitRatioTotalValue([...rows, row()])).toBeNull();
  });

  it('passes unknown summary evidence through the controller without discarding populated rows', () => {
    const measured = row({ shared_blks_hit: 900, shared_blks_read: 100 });
    const incomplete = row({ query_id: 2, shared_blks_hit: 100 });
    const rows = [measured, incomplete];
    queryMock.mockReturnValue({
      data: { slow_queries: rows }, isSuccess: true, fetchStatus: 'idle', refetch: vi.fn(),
    });
    const { result, rerender } = renderHook(() => useSlowQueriesPage());
    expect(result.current.totals).toEqual({
      calls: 20, totalMs: 1000, rowsReturned: 40, maxMean: 50, maxPeak: 100, cacheRatio: null,
    });
    expect(result.current.rows).toBe(rows);
    expect(result.current.cacheLeaders).toEqual([{ row: measured, ratio: 90 }]);
    expect(result.current.chartRows).toHaveLength(2);
    expect(incomplete).not.toHaveProperty('shared_blks_read');

    queryMock.mockReturnValue({
      data: { slow_queries: [measured] }, isSuccess: true, fetchStatus: 'idle', refetch: vi.fn(),
    });
    rerender();
    expect(result.current.totals.cacheRatio).toBe(90);
  });
});
