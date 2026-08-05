import { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return { ...actual, request: vi.fn() };
});

import { request } from '../client';
import {
  benchmarkKeys,
  useBenchmarkPrivacyStatus,
  useBenchmarkReleases,
  useCreateBenchmarkRelease,
  useOptInBenchmarks,
  useRevokeBenchmarks,
  type BenchmarkPrivacyStatus,
  type BenchmarkRelease,
} from './useBenchmarks';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const status: BenchmarkPrivacyStatus = {
  vehicle_id: 7,
  opted_in: true,
  opted_in_at: '2026-08-01T00:00:00Z',
  revoked_at: null,
  epsilon_budget: 4,
  epsilon_spent: 1,
  epsilon_remaining: 3,
  minimum_cohort_size: 5,
  mechanism_version: 1,
};

const release: BenchmarkRelease = {
  release_id: 4,
  period_start: '2026-05-01T00:00:00Z',
  period_end: '2026-08-01T00:00:00Z',
  model_family: 'model_y',
  model_year_bucket: 2020,
  mechanism_version: 1,
  minimum_cohort_size: 5,
  epsilon_spent: 1,
  suppressed: false,
  suppression_reason: null,
  created_at: '2026-08-02T00:00:00Z',
  metrics: [],
};

function wrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, Wrapper };
}

beforeEach(() => mockedRequest.mockReset());

describe('benchmark queries', () => {
  it('does not fetch until a vehicle is selected', () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useBenchmarkPrivacyStatus(null), {
      wrapper: Wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('uses snake_case params and paths without the version prefix', async () => {
    mockedRequest.mockResolvedValueOnce(status);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useBenchmarkPrivacyStatus(7), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledWith(
      '/benchmarks/privacy?vehicle_id=7',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    mockedRequest.mockResolvedValueOnce({ items: [], limit: 8, offset: 2 });
    const releases = renderHook(() => useBenchmarkReleases(7, 8, 2), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(releases.result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenLastCalledWith(
      '/benchmarks/releases?vehicle_id=7&limit=8&offset=2',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe('benchmark mutations', () => {
  it('opts in with an explicit vehicle-only body', async () => {
    mockedRequest.mockResolvedValueOnce(status);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useOptInBenchmarks(), { wrapper: Wrapper });
    await act(() => result.current.mutateAsync(7));
    expect(mockedRequest).toHaveBeenCalledWith('/benchmarks/privacy/consent', {
      method: 'PUT',
      body: JSON.stringify({ vehicle_id: 7 }),
    });
  });

  it('creates a stable release without sending trips, locations, or VIN', async () => {
    mockedRequest.mockResolvedValueOnce(release);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateBenchmarkRelease(), {
      wrapper: Wrapper,
    });
    await act(() => result.current.mutateAsync({ vehicle_id: 7 }));
    const [, options] = mockedRequest.mock.calls[0] as [string, RequestInit];
    expect(mockedRequest.mock.calls[0]?.[0]).toBe('/benchmarks/releases');
    expect(JSON.parse(options.body as string)).toEqual({ vehicle_id: 7 });
  });

  it('revokes through DELETE and clears benchmark queries', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, client } = wrapper();
    client.setQueryData(benchmarkKeys.releases(7, 12, 0), { items: [release] });
    const { result } = renderHook(() => useRevokeBenchmarks(), { wrapper: Wrapper });
    await act(() => result.current.mutateAsync(7));
    expect(mockedRequest).toHaveBeenCalledWith(
      '/benchmarks/privacy/consent?vehicle_id=7',
      { method: 'DELETE' },
    );
    expect(client.getQueryData(benchmarkKeys.releases(7, 12, 0))).toBeUndefined();
  });
});
