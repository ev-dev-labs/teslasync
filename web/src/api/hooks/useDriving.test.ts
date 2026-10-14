import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { request } from '@/api/client';
import { drivingKeys, useDrives, useDrivingStats, useDriveHistory } from './useDriving';
import { useChargingHistory } from './useCharging';
import { useEnergyStats } from './useEnergy';

vi.mock('@/api/client', () => ({ request: vi.fn() }));
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const mockedRequest = vi.mocked(request);
const clients: QueryClient[] = [];

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
  };
}

beforeEach(() => mockedRequest.mockReset());
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

describe('driving exact-range integration', () => {
  const start = '2024-03-10T15:42:19.125Z';
  const end = '2024-03-11T15:42:19.125Z';

  it('sends both exact bounds and vehicle to the list and whole-range stats without a cap change', async () => {
    const stats = { totalDrives: 125, totalDistanceKm: 8765, regenEnergyWh: null };
    mockedRequest.mockResolvedValueOnce([]).mockResolvedValueOnce(stats);
    const context = wrapper();
    const { result } = renderHook(() => ({
      drives: useDrives('42', { start, end }),
      stats: useDrivingStats('42', { start, end }),
    }), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.stats.isSuccess).toBe(true));
    expect(result.current.drives.data).toEqual([]);
    expect(result.current.stats.data).toBe(stats);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    for (const [path, options] of mockedRequest.mock.calls) {
      const url = new URL(path, 'http://fixture.test');
      expect(['/drives', '/drives/stats']).toContain(url.pathname);
      expect([...url.searchParams.keys()]).toEqual(['vehicle_id', 'start', 'end']);
      expect(url.searchParams.get('vehicle_id')).toBe('42');
      expect(url.searchParams.get('start')).toBe(start);
      expect(url.searchParams.get('end')).toBe(end);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(context.client.getQueryState(drivingKeys.stats('42', { start, end }))?.data).toBe(stats);
  });

  describe.each([
    {
      name: 'drive',
      useHistory: () => useDriveHistory('42'),
      key: drivingKeys.history('42'),
      populated: [{ id: 7, startSocPct: null }, null, { id: 8, startSocPct: 80 }],
      empty: [],
      invalid: [null, {}, { rows: [] }, 'unavailable'],
    },
    {
      name: 'charging',
      useHistory: () => useChargingHistory('42'),
      key: ['charging-sessions', 'history', '42', 1000],
      populated: [{ id: 7, startSocPct: null }, null, { id: 8, startSocPct: 20 }],
      empty: [],
      invalid: [null, {}, { rows: [] }, 'unavailable'],
    },
    {
      name: 'energy',
      useHistory: () => useEnergyStats('42'),
      key: ['energy-stats', '42', 'days:30'],
      populated: { total_wh: 12000, daily_breakdown: [{ date: '2026-01-01', energy_wh: 12000 }, null] },
      empty: { total_wh: 0, daily_breakdown: [] },
      invalid: [null, [], {}, { daily_breakdown: null }, { daily_breakdown: {} }],
    },
  ])('$name analytical history shape', ({ useHistory, key, populated, empty, invalid }) => {
    it.each(invalid.map((payload, index) => ({ payload, index })))(
      'retains populated cache and reports a failed refresh for malformed shape $index',
      async ({ payload }) => {
        mockedRequest.mockResolvedValueOnce(populated).mockResolvedValueOnce(payload);
        const context = wrapper();
        const { result } = renderHook(useHistory, { wrapper: context.wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(populated);
        await result.current.refetch();
        await waitFor(() => expect(result.current.isRefetchError).toBe(true));
        expect(result.current.error?.message).toContain('Invalid');
        expect(result.current.data).toEqual(populated);
        expect(context.client.getQueryData(key)).toEqual(populated);
      },
    );

    it('accepts a legitimate empty history and preserves every returned row before qualification', async () => {
      mockedRequest.mockResolvedValueOnce(populated).mockResolvedValueOnce(empty);
      const context = wrapper();
      const { result } = renderHook(useHistory, { wrapper: context.wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(populated);
      await result.current.refetch();
      await waitFor(() => expect(result.current.data).toEqual(empty));
      expect(result.current.isSuccess).toBe(true);
      expect(context.client.getQueryData(key)).toEqual(empty);
    });

    it('reports an initial shape failure without inventing empty data', async () => {
      mockedRequest.mockResolvedValueOnce(null);
      const context = wrapper();
      const { result } = renderHook(useHistory, { wrapper: context.wrapper });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data).toBeUndefined();
      expect(context.client.getQueryData(key)).toBeUndefined();
    });
  });

  it('refetches and isolates stats cache entries when either bound changes', async () => {
    mockedRequest.mockResolvedValueOnce({ totalDrives: 125 })
      .mockResolvedValueOnce({ totalDrives: 50 }).mockResolvedValueOnce({ totalDrives: 7 });
    const context = wrapper();
    const { result, rerender } = renderHook(
      (window: { start: string; end: string }) => useDrivingStats('42', window),
      { wrapper: context.wrapper, initialProps: { start, end } },
    );
    await waitFor(() => expect(result.current.data?.totalDrives).toBe(125));
    const laterStart = '2024-03-10T20:00:00.000Z';
    rerender({ start: laterStart, end });
    await waitFor(() => expect(result.current.data?.totalDrives).toBe(50));
    const earlierEnd = '2024-03-11T10:00:00.000Z';
    rerender({ start: laterStart, end: earlierEnd });
    await waitFor(() => expect(result.current.data?.totalDrives).toBe(7));
    expect(mockedRequest).toHaveBeenCalledTimes(3);
    expect(context.client.getQueryData(drivingKeys.stats('42', { start, end }))).toEqual({ totalDrives: 125 });
    expect(new URL(mockedRequest.mock.calls[2][0], 'http://fixture.test').searchParams.get('end')).toBe(earlierEnd);
  });

  it('preserves unbounded keys URLs retry policy and missing-vehicle enablement', async () => {
    expect(drivingKeys.stats('42')).toEqual(['driving-stats', '42']);
    expect(drivingKeys.stats('42', {})).toEqual(['driving-stats', '42']);
    const boom = new Error('stats unavailable');
    mockedRequest.mockRejectedValueOnce(boom);
    const context = wrapper();
    const { result } = renderHook(() => useDrivingStats('42'), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(boom);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest.mock.calls[0][0]).toBe('/drives/stats?vehicle_id=42');
    mockedRequest.mockReset();
    const disabled = renderHook(() => useDrivingStats(undefined, { start, end }), { wrapper: context.wrapper });
    expect(disabled.result.current.fetchStatus).toBe('idle');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'lower only', window: { start }, expected: ['driving-stats', '42', start, null] },
    { name: 'upper only', window: { end }, expected: ['driving-stats', '42', null, end] },
  ])('supports an optional $name bound without inventing its other side', async ({ window, expected }) => {
    expect(drivingKeys.stats('42', window)).toEqual(expected);
    mockedRequest.mockResolvedValueOnce({ totalDrives: 0 });
    const context = wrapper();
    const { result } = renderHook(() => useDrivingStats('42', window), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = new URL(mockedRequest.mock.calls[0][0], 'http://fixture.test').searchParams;
    expect(params.has('start')).toBe('start' in window);
    expect(params.has('end')).toBe('end' in window);
  });
});
