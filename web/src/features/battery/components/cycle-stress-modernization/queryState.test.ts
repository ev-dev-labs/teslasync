import { describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import { cycleStressQueryState } from './queryState';

describe('cycle-stress independent source trust', () => {
  it('distinguishes unknown initial payload from authoritative empty history', () => {
    const initial = cycleStressQueryState(true, {}, {});
    expect(initial.state.isResolved).toBe(false);
    expect(initial.state.loadingSources).toEqual(['charging', 'drive']);
    const empty = cycleStressQueryState(true, { data: [], isSuccess: true }, { data: [], isSuccess: true });
    expect(empty.state.isResolved).toBe(true);
    expect(empty.fatalError).toBeNull();
    expect(empty.sources[0].trust.data).toEqual([]);
  });
  it('keeps the exact retained payload through a background failure', () => {
    const rows: ChargingSession[] = [];
    const failure = new Error('technical refresh failure');
    const result = cycleStressQueryState(true, { data: rows, isError: true, error: failure },
      { data: [], isSuccess: true });
    expect(result.sources[0].trust.data).toBe(rows);
    expect(result.sources[0].trust.status).toBe('stale');
    expect(result.state.error).toBeNull();
    expect(result.state.refreshError).toBe(failure);
    expect(result.state.failedSources).toEqual([]);
  });
  it('reports only the affected source and never retries its healthy neighbor', () => {
    const chargingRetry = vi.fn();
    const drivingRetry = vi.fn();
    const sessions: DataStateSource<ChargingSession[]> = {
      isError: true, error: new Error('charging unavailable'), refetch: chargingRetry,
    };
    const drives: DataStateSource<Drive[]> = { data: [], isSuccess: true, refetch: drivingRetry };
    const result = cycleStressQueryState(true, sessions, drives);
    expect(result.state.failedSources).toEqual(['charging']);
    expect(result.fatalError).toBeNull();
    result.state.onRetry();
    expect(chargingRetry).toHaveBeenCalledTimes(1);
    expect(drivingRetry).not.toHaveBeenCalled();
  });
  it('cannot declare a fatal page while the other source is pending', () => {
    const result = cycleStressQueryState(true, { isError: true, error: new Error('failed') },
      { isLoading: true, isFetching: true });
    expect(result.fatalError).toBeNull();
    expect(result.state.isLoading).toBe(true);
    expect(result.state.isResolved).toBe(false);
  });
  it('has fatalError only when both independent histories have nothing retained', () => {
    const failure = new Error('failed');
    const result = cycleStressQueryState(true, { isError: true, error: failure }, { isError: true });
    expect(result.fatalError).toBe(failure);
    expect(result.state.error).toBe(failure);
    expect(result.state.failedSources).toEqual(['charging', 'drive']);
  });
  it('does not manufacture zero evidence for paused first loads or disabled queries', () => {
    const paused = cycleStressQueryState(true, { fetchStatus: 'paused', isPending: true },
      { fetchStatus: 'paused', isPending: true });
    expect(paused.state.isResolved).toBe(false);
    expect(paused.sources.every(source => source.trust.isRefreshBlocked)).toBe(true);
    const disabled = cycleStressQueryState(false, { isError: true }, { isError: true });
    expect(disabled.state.isResolved).toBe(false);
    expect(disabled.state.failedSources).toEqual([]);
    expect(disabled.fatalError).toBeNull();
  });
});
