// useDashboard hook tests.
//
// Covers every export of ../useDashboard:
//   - dashboardKeys — the query-key factory is stable and namespaced.
//   - useDashboardStats — hits GET /dashboard/stats (no /api/v1 prefix,
//     no query params), threads an AbortSignal, wires the shared query
//     key into the cache, surfaces loading/error, honours the staleTime
//     window (STANDARD) so a second observer is served from cache, and
//     passes zeroed payloads through verbatim (no silent fallback).
//
// Network is mocked at the api/client boundary (the repo convention —
// see useExports.test.tsx / useAiUsage.test.tsx). Never hits real network.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { request } from '@/api/client';
import { STALE_TIMES } from '@/lib/constants';
import type { DashboardStats } from '@/types/dashboard';
import { dashboardKeys, useDashboardStats } from './useDashboard';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const sample: DashboardStats = {
  totalVehicles: 3,
  totalM: 1_234_567,
  totalEnergyWh: 89_000,
  totalChargingSessions: 12,
  totalTrips: 47,
  avgEfficiency: 165.4,
  totalCostCents: 5_432,
};

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('dashboardKeys', () => {
  it('exposes a stable stats key namespaced under "dashboard"', () => {
    expect(dashboardKeys.stats).toEqual(['dashboard', 'stats']);
    expect(dashboardKeys.stats[0]).toBe('dashboard');
    expect(dashboardKeys.stats).toHaveLength(2);
  });
});

describe('useDashboardStats', () => {
  it('fetches the stats payload and threads an AbortSignal', async () => {
    mockedRequest.mockResolvedValueOnce(sample);

    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sample);
    expect(mockedRequest).toHaveBeenCalledWith(
      '/dashboard/stats',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('requests the versionless, param-free path (client adds /api/v1)', async () => {
    mockedRequest.mockResolvedValueOnce(sample);

    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const path = mockedRequest.mock.calls[0][0] as string;
    expect(path).toBe('/dashboard/stats');
    expect(path).not.toContain('/api/v1');
    expect(path).not.toContain('?');
  });

  it('stores the result under dashboardKeys.stats in the query cache', async () => {
    const client = makeClient();
    mockedRequest.mockResolvedValueOnce(sample);

    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(dashboardKeys.stats)).toEqual(sample);
  });

  it('reports the loading state before the request resolves', async () => {
    let resolveFn: (value: DashboardStats) => void = () => {};
    const pending = new Promise<DashboardStats>((resolve) => {
      resolveFn = resolve;
    });
    mockedRequest.mockReturnValueOnce(pending);

    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: makeWrapper(makeClient()),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    resolveFn(sample);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sample);
  });

  it('surfaces the error when the request rejects', async () => {
    const boom = new Error('stats unavailable');
    mockedRequest.mockRejectedValueOnce(boom);

    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(boom);
    expect(result.current.data).toBeUndefined();
  });

  it('serves cached stats to a second observer within the stale window', async () => {
    const client = makeClient();
    mockedRequest.mockResolvedValueOnce(sample);

    const first = renderHook(() => useDashboardStats(), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    const second = renderHook(() => useDashboardStats(), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(second.result.current.data).toEqual(sample);
    expect(STALE_TIMES.STANDARD).toBeGreaterThan(0);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it('passes a zeroed payload through verbatim (empty install)', async () => {
    const empty: DashboardStats = {
      totalVehicles: 0,
      totalM: 0,
      totalEnergyWh: 0,
      totalChargingSessions: 0,
      totalTrips: 0,
      avgEfficiency: 0,
      totalCostCents: 0,
    };
    mockedRequest.mockResolvedValueOnce(empty);

    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(empty);
    expect(result.current.data?.totalVehicles).toBe(0);
  });
});
