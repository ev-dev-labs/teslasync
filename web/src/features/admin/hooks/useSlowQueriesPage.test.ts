import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DataStateSource } from '@/api/dataState';
import type { SlowQueryRow } from '@/types/admin-operator-confidence';
import { useSlowQueriesPage } from './useSlowQueriesPage';

type RuntimeRow = Omit<SlowQueryRow, 'mean_time_ms' | 'max_time_ms'> & {
  mean_time_ms?: unknown;
  max_time_ms?: unknown;
};
type FixtureQuery = DataStateSource<{ slow_queries: RuntimeRow[] }> & {
  refetch: () => unknown;
};

const { queryMock, refetch } = vi.hoisted(() => ({
  queryMock: vi.fn<() => FixtureQuery>(),
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useOperatorConfidence', () => ({ useSlowQueries: queryMock }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: String, fmtCompact: String, fmtNumber: String, precision: 1, locale: 'en',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function row(overrides: Partial<RuntimeRow> = {}): RuntimeRow {
  return Object.freeze({
    query_id: 1, fingerprint: 'SELECT fixture', calls: 0, total_time_ms: 0,
    rows_returned: 0, ...overrides,
  });
}

function renderRows(rows?: RuntimeRow[]) {
  if (rows) Object.freeze(rows);
  const query: FixtureQuery = {
    data: rows === undefined ? undefined : { slow_queries: rows },
    isSuccess: rows !== undefined,
    isPending: rows === undefined,
    fetchStatus: 'idle',
    refetch,
  };
  queryMock.mockReturnValue(query);
  return { ...renderHook(() => useSlowQueriesPage()), query };
}

beforeEach(() => {
  queryMock.mockReset();
  refetch.mockClear();
});

describe('useSlowQueriesPage measured maxima', () => {
  it('keeps loaded empty counts known zero without inventing latency maxima', () => {
    const { result } = renderRows([]);
    expect(result.current.queryState.hasData).toBe(true);
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.totals).toEqual({
      calls: 0, totalMs: 0, rowsReturned: 0, cacheRatio: null,
      maxMean: Number.NaN, maxPeak: Number.NaN,
    });
  });

  it('keeps missing source data distinct from a loaded empty snapshot', () => {
    const { result } = renderRows();
    expect(result.current.queryState.hasData).toBe(false);
    expect(result.current.totals.maxMean).toBeNaN();
    expect(result.current.totals.maxPeak).toBeNaN();
  });

  it.each([undefined, null, Number.NaN, Infinity, -Infinity, '0', '', false])(
    'does not treat missing or invalid maxima %s as measured zero',
    value => {
      const { result } = renderRows([row({ mean_time_ms: value, max_time_ms: value })]);
      expect(result.current.totals.maxMean).toBeNaN();
      expect(result.current.totals.maxPeak).toBeNaN();
      expect(typeof result.current.totals.maxMean).toBe('number');
      expect(typeof result.current.totals.maxPeak).toBe('number');
    },
  );

  it('preserves explicitly measured zero after missing and invalid values', () => {
    const { result } = renderRows([
      row(), row({ mean_time_ms: null, max_time_ms: Infinity }),
      row({ mean_time_ms: 0, max_time_ms: 0 }),
    ]);
    expect(result.current.totals.maxMean).toBe(0);
    expect(result.current.totals.maxPeak).toBe(0);
  });

  it('selects signed fractional maxima independently without clipping to zero', () => {
    const rows = [
      row({ mean_time_ms: -8.5, max_time_ms: -1.25, calls: 2, total_time_ms: 10,
        rows_returned: 3, shared_blks_hit: 3, shared_blks_read: 1 }),
      row({ mean_time_ms: -2.75, max_time_ms: -9.5, calls: 4, total_time_ms: 20,
        rows_returned: 5 }),
      row({ mean_time_ms: null, max_time_ms: Number.NaN }),
    ];
    const { result, query } = renderRows(rows);
    // Rows 2–3 lack shared-buffer counters, so the across-queries cache total
    // requires complete evidence and stays null (see the cache-evidence contract).
    expect(result.current.totals).toEqual({
      calls: 6, totalMs: 30, rowsReturned: 8, cacheRatio: null,
      maxMean: -2.75, maxPeak: -1.25,
    });
    expect(result.current.rows).toBe(rows);
    expect(result.current.query).toBe(query);
    result.current.retry();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('preserves positive fractional maxima and ignores invalid trailing inputs', () => {
    const { result } = renderRows([
      row({ mean_time_ms: 1.125, max_time_ms: 8.75 }),
      row({ mean_time_ms: 3.5, max_time_ms: 2.25 }),
      row({ mean_time_ms: Infinity, max_time_ms: '99' }),
    ]);
    expect(result.current.totals.maxMean).toBe(3.5);
    expect(result.current.totals.maxPeak).toBe(8.75);
  });

  it('keeps an unknown maximum independent from a measured counterpart', () => {
    const { result } = renderRows([row({ mean_time_ms: null, max_time_ms: 0.25 })]);
    expect(result.current.totals.maxMean).toBeNaN();
    expect(result.current.totals.maxPeak).toBe(0.25);
  });
});
