import { describe, expect, it, vi } from 'vitest';
import type { PeriodStats } from '@/api/hooks/usePeriodStats';
import { deriveComparisonState } from './comparisonState';

const a: PeriodStats = {
  total_distance: 1000, total_drives: 50, energy_used: 200,
  avg_efficiency: 200, total_cost: 40, co2_saved: 120,
};
const b: PeriodStats = {
  total_distance: 2000, total_drives: 90, energy_used: 420,
  avg_efficiency: 210, total_cost: 88, co2_saved: 250,
};

describe('independent period source trust', () => {
  it('passes healthy raw operands through by identity without normalization', () => {
    const result = deriveComparisonState({ data: a }, { data: b });
    expect(result.a).toBe(a);
    expect(result.b).toBe(b);
    expect(result.hasPair).toBe(true);
    expect(result.comparisonError).toBeNull();
    expect(result.comparisonLoading).toBe(false);
    expect(a.total_distance).toBe(1000);
    expect(b.avg_efficiency).toBe(210);
  });

  it.each(['A', 'B'] as const)('keeps the pair on a retained %s refresh failure', failed => {
    const error = new Error('refresh failed');
    const result = deriveComparisonState(
      { data: a, error: failed === 'A' ? error : undefined, isError: failed === 'A' },
      { data: b, error: failed === 'B' ? error : undefined, isError: failed === 'B' },
    );
    expect(result.a).toBe(a);
    expect(result.b).toBe(b);
    expect(result.comparisonError).toBeNull();
    expect(result.hasPair).toBe(true);
    const state = failed === 'A' ? result.stateA : result.stateB;
    expect(state.refreshError).toBe(error);
    expect(state.fatalError).toBeNull();
    expect(state.status).toBe('stale');
  });

  it.each(['A', 'B'] as const)('keeps the independent neighbor on an initial %s failure', failed => {
    const error = new Error('source failed');
    const result = failed === 'A'
      ? deriveComparisonState({ error, isError: true }, { data: b })
      : deriveComparisonState({ data: a }, { error, isError: true });
    expect(result.hasPair).toBe(false);
    expect(result.comparisonError).toBe(error);
    expect(failed === 'A' ? result.b : result.a).toBe(failed === 'A' ? b : a);
    expect(failed === 'A' ? result.a : result.b).toBeUndefined();
  });

  it('does not hide a retained pair during a refresh or paused/offline fetch', () => {
    const result = deriveComparisonState(
      { data: a, isFetching: true },
      { data: b, fetchStatus: 'paused' },
    );
    expect(result.comparisonLoading).toBe(false);
    expect(result.comparisonError).toBeNull();
    expect(result.stateA.isRefreshing).toBe(true);
    expect(result.stateB.isRefreshBlocked).toBe(true);
    expect(result.b).toBe(b);
  });

  it('distinguishes missing operands from an authoritative zero-valued payload', () => {
    const zero: PeriodStats = {
      total_distance: 0, total_drives: 0, energy_used: 0,
      avg_efficiency: 0, total_cost: 0, co2_saved: 0,
    };
    const missing = deriveComparisonState({ data: a }, { isLoading: true });
    expect(missing.b).toBeUndefined();
    expect(missing.comparisonLoading).toBe(true);
    expect(missing.stateB.fatalError).toBeNull();
    expect(deriveComparisonState({ data: a }, { data: zero }).b).toBe(zero);
  });

  it('forwards independent retries without retrying the healthy neighbor', () => {
    const retryA = vi.fn();
    const retryB = vi.fn();
    const result = deriveComparisonState(
      { data: a, refetch: retryA },
      { error: new Error('initial failure'), refetch: retryB },
    );
    result.stateB.retry?.();
    expect(retryA).not.toHaveBeenCalled();
    expect(retryB).toHaveBeenCalledOnce();
  });
});
