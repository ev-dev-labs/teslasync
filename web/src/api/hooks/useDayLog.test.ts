// useDayLog hook tests.
//
// Covers the all-pages fetch contract:
//   - single page resolves merged when total fits one page;
//   - multi-page days loop with offset until total_events is reached;
//   - paging-integrity failures retain records and expose retryable errors;
//   - loading, paused, empty and retained-refresh states stay distinct;
//   - snake_case query building (vehicle_id/date/timezone/limit),
//     omitted layers upstream, and the `enabled` gate.
//
// Network is faked at the `@/api/client` boundary so no real fetch happens.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: requestMock };
});

import { DayLogPagingError, dayLogKeys, useDayLog, DAY_LOG_PAGE_LIMIT } from './useDayLog';
import type { DayLogEvent, DayLogResponse } from '../types';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function event(id: string): DayLogEvent {
  return { id, ts: '2026-09-14T12:00:00Z', type: 'locked', layer: 'default', source: 'security_events', vehicle_id: 1, payload: {} };
}

function page(events: DayLogEvent[], total: number, offset: number): DayLogResponse {
  return {
    vehicle_id: 1,
    date: '2026-09-14',
    timezone: 'UTC',
    day_start: '2026-09-14T00:00:00Z',
    day_end: '2026-09-15T00:00:00Z',
    truncated: false,
    total_events: total,
    limit: DAY_LOG_PAGE_LIMIT,
    offset,
    layers: [],
    summary: { drive_count: 0, charge_count: 0, drive_duration_s: null, drive_distance_m: null, energy_added_wh: null, energy_used_wh: null },
    sources: [],
    events,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDayLog', () => {
  it('resolves a single page with snake_case params and no layers upstream', async () => {
    requestMock.mockResolvedValueOnce(page([event('a')], 1, 0));
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.events).toHaveLength(1);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const url = String(requestMock.mock.calls[0][0]);
    expect(url).toContain('vehicle_id=1');
    expect(url).toContain('date=2026-09-14');
    expect(url).toContain('timezone=UTC');
    expect(url).toContain(`limit=${DAY_LOG_PAGE_LIMIT}`);
    expect(url).not.toContain('layers=');
  });

  it('pages with offset until total_events is reached', async () => {
    requestMock
      .mockResolvedValueOnce(page([event('a')], 3, 0))
      .mockResolvedValueOnce(page([event('b'), event('c')], 3, 1));
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.events.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(String(requestMock.mock.calls[1][0])).toContain('offset=1');
  });

  it('fails explicitly with retained records when a page adds nothing, then retries', async () => {
    requestMock
      .mockResolvedValueOnce(page([event('a')], 5, 0))
      .mockResolvedValueOnce(page([], 5, 1));
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data?.events).toHaveLength(1);
    expect(result.current.error).toBeInstanceOf(DayLogPagingError);
    expect(result.current.pagingError?.partialData.total_events).toBe(5);
    expect(result.current.data?.truncated).toBe(false);
    expect(requestMock).toHaveBeenCalledTimes(2);
    requestMock.mockRejectedValueOnce(new Error('retry unavailable'));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.error?.message).toBe('retry unavailable'));
    expect(result.current.data?.events.map((e) => e.id)).toEqual(['a']);
    requestMock.mockResolvedValueOnce(page([event('a'), event('b')], 2, 0));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(result.current.pagingError).toBeNull();
  });

  it.each([
    ['repeated offset', page([event('b')], 3, 0)],
    ['changed total', page([event('b')], 4, 1)],
    ['repeated records', page([event('a')], 3, 1)],
    ['duplicate records within a page', page([event('b'), event('b')], 3, 1)],
    ['excess records', page([event('b'), event('c'), event('d')], 3, 1)],
    ['changed scope', { ...page([event('b')], 3, 1), vehicle_id: 2 }],
  ])('rejects %s without claiming signal-cap truncation', async (_name, invalidPage) => {
    requestMock.mockResolvedValueOnce(page([event('a')], 3, 0)).mockResolvedValueOnce(invalidPage);
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data?.events.map((e) => e.id)).toEqual(['a']);
    expect(result.current.data?.truncated).toBe(false);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('retains records and the transport cause when a later page fails', async () => {
    const cause = new Error('page unavailable');
    requestMock.mockResolvedValueOnce(page([event('a')], 2, 0)).mockRejectedValueOnce(cause);
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.pagingError?.cause).toBe(cause);
    expect(result.current.data?.events.map((e) => e.id)).toEqual(['a']);
    expect(result.current.data?.truncated).toBe(false);
  });

  it('keeps loading distinct from an authoritative empty result', async () => {
    let resolve!: (value: DayLogResponse) => void;
    requestMock.mockReturnValueOnce(new Promise<DayLogResponse>((done) => { resolve = done; }));
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.fetchStatus).toBe('fetching');
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
    await act(async () => { resolve(page([], 0, 0)); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.events).toEqual([]);
    expect(result.current.data?.total_events).toBe(0);
    expect(result.current.data?.summary.drive_count).toBe(0);
    expect(result.current.data?.summary.drive_distance_m).toBeNull();
  });

  it('exposes paused-without-data without inventing a failure', async () => {
    onlineManager.setOnline(false);
    const hook = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    try {
      expect(hook.result.current.fetchStatus).toBe('paused');
      expect(hook.result.current.isPending).toBe(true);
      expect(hook.result.current.isLoading).toBe(false);
      expect(hook.result.current.data).toBeUndefined();
      expect(hook.result.current.error).toBeNull();
      expect(requestMock).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
      onlineManager.setOnline(true);
    }
  });

  it('exposes an initial transport failure without fabricated records and recovers', async () => {
    const error = new Error('initial request unavailable');
    requestMock.mockRejectedValueOnce(error);
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeUndefined();
    expect(result.current.pagingError).toBeNull();
    requestMock.mockResolvedValueOnce(page([], 0, 0));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.events).toEqual([]);
  });

  it('retains successful records while refresh is actively loading', async () => {
    requestMock.mockResolvedValueOnce(page([event('original')], 1, 0));
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    let resolve!: (value: DayLogResponse) => void;
    requestMock.mockReturnValueOnce(new Promise<DayLogResponse>((done) => { resolve = done; }));
    let refresh!: ReturnType<typeof result.current.refetch>;
    act(() => { refresh = result.current.refetch(); });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.events.map((e) => e.id)).toEqual(['original']);
    await act(async () => {
      resolve(page([event('refreshed')], 1, 0));
      await refresh;
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data?.events.map((e) => e.id)).toEqual(['refreshed']);
  });

  it.each(['transport', 'paging'])('retains successful data through %s refresh failure and recovery', async (failure) => {
    const original = page([event('original')], 1, 0);
    requestMock.mockResolvedValueOnce(original);
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const successfulAt = result.current.dataUpdatedAt;
    if (failure === 'transport') {
      requestMock.mockRejectedValueOnce(new Error('refresh unavailable'));
    } else {
      requestMock.mockResolvedValueOnce(page([event('new')], 2, 0))
        .mockResolvedValueOnce(page([], 2, 1));
    }
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isRefetchError).toBe(true));
    expect(result.current.data?.events).toEqual(original.events);
    expect(result.current.dataUpdatedAt).toBe(successfulAt);
    expect(result.current.data?.truncated).toBe(false);
    requestMock.mockResolvedValueOnce(page([event('recovered')], 1, 0));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.data?.events.map((e) => e.id)).toEqual(['recovered']);
  });

  it('preserves server-confirmed signal-cap provenance', async () => {
    requestMock.mockResolvedValueOnce({ ...page([event('a')], 1, 0), truncated: true });
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.truncated).toBe(true);
    expect(result.current.pagingError).toBeNull();
  });

  it('never retains partial records across a vehicle scope change', async () => {
    requestMock.mockResolvedValueOnce(page([event('a')], 2, 0))
      .mockResolvedValueOnce(page([], 2, 1));
    const { result, rerender } = renderHook(
      ({ vehicleId }) => useDayLog({ vehicleId, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper(), initialProps: { vehicleId: 1 } },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    requestMock.mockRejectedValueOnce(new Error('other vehicle unavailable'));
    rerender({ vehicleId: 2 });
    await waitFor(() => expect(result.current.error?.message).toBe('other vehicle unavailable'));
    expect(result.current.data).toBeUndefined();
  });

  it('stays disabled without a positive vehicle id', () => {
    const { result } = renderHook(
      () => useDayLog({ vehicleId: null, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isPending).toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('builds stable keys with sorted layers', () => {
    expect(dayLogKeys.day(1, 'd', 'tz', ['gear', 'lights'])).toEqual(
      dayLogKeys.day(1, 'd', 'tz', ['lights', 'gear']),
    );
  });
});
