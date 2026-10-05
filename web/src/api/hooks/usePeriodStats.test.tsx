import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePeriodStats, type PeriodStats } from './usePeriodStats';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../client', () => ({ request: requestMock }));

const rawStats: PeriodStats = {
  total_distance: 12.34,
  total_drives: 3,
  energy_used: 5.67,
  avg_efficiency: 459.48,
  total_cost: 0,
  co2_saved: 1.48,
};

const clients: QueryClient[] = [];
function setup(retry: boolean | number = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry, retryDelay: 0, staleTime: 12345, gcTime: Infinity },
    },
  });
  clients.push(client);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('period statistics read hook', () => {
  it('keeps independent periods, raw values and inherited query policy', async () => {
    requestMock.mockResolvedValue(rawStats);
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({
      a: usePeriodStats('42', 30),
      b: usePeriodStats('42', 90),
    }), { wrapper });
    await waitFor(() => {
      expect(result.current.a.isSuccess).toBe(true);
      expect(result.current.b.isSuccess).toBe(true);
    });
    expect(requestMock.mock.calls).toEqual([
      ['/analytics/period-stats?vehicle_id=42&days=30'],
      ['/analytics/period-stats?vehicle_id=42&days=90'],
    ]);
    expect(result.current.a.data).toEqual(rawStats);
    expect(result.current.b.data).toEqual(rawStats);
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([
      ['period-stats', '42', 30],
      ['period-stats', '42', 90],
    ]);
    for (const query of client.getQueryCache().getAll()) {
      expect(query.options).toMatchObject({ retry: false, staleTime: 12345 });
      expect(query.options).not.toHaveProperty('select');
    }
  });

  it('does not fetch for the original empty vehicle selection', () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => usePeriodStats('', 30), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([
      ['period-stats', '', 30],
    ]);
  });

  it('preserves all-time days zero without treating it as disabled', async () => {
    requestMock.mockResolvedValue(rawStats);
    const { wrapper } = setup();
    const { result } = renderHook(() => usePeriodStats('42', 0), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledWith('/analytics/period-stats?vehicle_id=42&days=0');
  });

  it('retains the original string truthiness gate for vehicle zero', async () => {
    requestMock.mockResolvedValue(rawStats);
    const { wrapper } = setup();
    const { result } = renderHook(() => usePeriodStats('0', 7), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledWith('/analytics/period-stats?vehicle_id=0&days=7');
  });

  it('isolates caches when the vehicle or comparison period changes', async () => {
    requestMock.mockResolvedValue(rawStats);
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ vehicleId, days }: { vehicleId: string; days: number }) => usePeriodStats(vehicleId, days),
      { wrapper, initialProps: { vehicleId: '42', days: 30 } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ vehicleId: '43', days: 7 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock.mock.calls).toEqual([
      ['/analytics/period-stats?vehicle_id=42&days=30'],
      ['/analytics/period-stats?vehicle_id=43&days=7'],
    ]);
    expect(client.getQueryData(['period-stats', '42', 30])).toEqual(rawStats);
    expect(client.getQueryData(['period-stats', '43', 7])).toEqual(rawStats);
  });

  it('inherits retries and propagates failure without a fabricated zero envelope', async () => {
    const error = new Error('period statistics unavailable');
    requestMock.mockRejectedValue(error);
    const { wrapper } = setup(1);
    const { result } = renderHook(() => usePeriodStats('42', 30), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeUndefined();
  });

  it('keeps prior raw statistics when a refresh fails', async () => {
    const error = new Error('charging aggregate unavailable');
    requestMock.mockResolvedValueOnce(rawStats).mockRejectedValueOnce(error);
    const { wrapper } = setup();
    const { result } = renderHook(() => usePeriodStats('42', 30), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
    expect(result.current.data).toEqual(rawStats);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('retains legitimate measured zeros from a successful empty aggregate', async () => {
    const emptyStats: PeriodStats = {
      total_distance: 0,
      total_drives: 0,
      energy_used: 0,
      avg_efficiency: 0,
      total_cost: 0,
      co2_saved: 0,
    };
    requestMock.mockResolvedValue(emptyStats);
    const { wrapper } = setup();
    const { result } = renderHook(() => usePeriodStats('42', 0), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(emptyStats);
    expect(result.current.error).toBeNull();
  });
});
