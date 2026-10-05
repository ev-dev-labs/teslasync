import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  usePressurePageLatest, usePressurePageHistory, type TirePressureReading,
} from './usePressurePage';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../client', () => ({ request: requestMock }));

// Fake contract fixture, not a live vehicle or evidence of backend population.
const reading: TirePressureReading = {
  id: 9,
  vehicle_id: 42,
  front_left: 280000,
  front_right: null,
  rear_left: 0,
  // rear_right deliberately omitted, not normalized to a numeric reading.
  tpms_hard_warnings: null,
  tpms_soft_warnings: '{"fl":false}',
  created_at: '2026-10-04T12:00:00Z',
};
const start = '2026-09-28';
const end = '2026-10-04';
const clients: QueryClient[] = [];

interface RetryOutcome {
  isSuccess: boolean;
  data: TirePressureReading | TirePressureReading[] | null | undefined;
}

function setup(retry: boolean | number = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry, retryDelay: 0, staleTime: 12345, gcTime: Infinity,
        refetchInterval: false, refetchOnWindowFocus: false,
      },
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
  clients.splice(0).forEach(client => client.clear());
});

describe('pressure page query extraction contract', () => {
  it('keeps numeric keys, both URL bounds, raw Pa/null/omitted fields and inherited policy', async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/tire-pressure/latest') ? reading : [reading]));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({
      latest: usePressurePageLatest(42),
      history: usePressurePageHistory(42, start, end),
    }), { wrapper });
    await waitFor(() => {
      expect(result.current.latest.isSuccess).toBe(true);
      expect(result.current.history.isSuccess).toBe(true);
    });
    expect(requestMock.mock.calls).toEqual([
      ['/tire-pressure/latest?vehicle_id=42'],
      ['/tire-pressure?vehicle_id=42&start=2026-09-28&end=2026-10-04'],
    ]); // One argument only: default GET, no new signal/options forwarding.
    expect(result.current.latest.data).toEqual(reading);
    expect(result.current.history.data).toEqual([reading]);
    expect(result.current.latest.data).not.toHaveProperty('rear_right');
    const queries = client.getQueryCache().getAll();
    expect(queries.map(query => query.queryKey)).toEqual([
      ['tire-pressure-latest', 42],
      ['tire-pressure-history', 42, start, end],
    ]);
    for (const query of queries) {
      expect(query.options).toMatchObject({
        staleTime: 12345, retry: false, gcTime: Infinity,
        refetchInterval: false, refetchOnWindowFocus: false,
      });
      expect(query.options).not.toHaveProperty('select');
      expect(query.options).not.toHaveProperty('placeholderData');
      expect(query.options).not.toHaveProperty('initialData');
    }
  });

  it('disables null selection without losing its exact cache identities', () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({
      latest: usePressurePageLatest(null),
      history: usePressurePageHistory(null, start, end),
    }), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.latest.fetchStatus).toBe('idle');
    expect(result.current.history.fetchStatus).toBe('idle');
    expect(result.current.latest.data).toBeUndefined();
    expect(result.current.history.data).toBeUndefined();
    expect(client.getQueryCache().getAll().map(query => query.queryKey)).toEqual([
      ['tire-pressure-latest', null],
      ['tire-pressure-history', null, start, end],
    ]);
    expect(client.getQueryCache().getAll().every(query => !query.isActive())).toBe(true);
  });

  it.each([0, -1])('preserves the strict non-null gate for numeric scope %s', async vehicleId => {
    requestMock.mockResolvedValue(null);
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({
      latest: usePressurePageLatest(vehicleId),
      history: usePressurePageHistory(vehicleId, start, end),
    }), { wrapper });
    await waitFor(() => {
      expect(result.current.latest.isSuccess).toBe(true);
      expect(result.current.history.isSuccess).toBe(true);
    });
    expect(requestMock.mock.calls).toEqual([
      [`/tire-pressure/latest?vehicle_id=${vehicleId}`],
      [`/tire-pressure?vehicle_id=${vehicleId}&start=${start}&end=${end}`],
    ]);
    // isActive resolves enablement on the mounted query observers; the cache's
    // base QueryOptions type does not expose observer-only `enabled`.
    expect(client.getQueryCache().getAll().every(query => query.isActive())).toBe(true);
    // The real handler rejects zero; this guards orchestration, not validity.
  });

  it('retains successful null data on both sources instead of silently substituting defaults', async () => {
    requestMock.mockResolvedValue(null);
    const { wrapper } = setup();
    const { result } = renderHook(() => ({
      latest: usePressurePageLatest(42),
      history: usePressurePageHistory(42, start, end),
    }), { wrapper });
    await waitFor(() => {
      expect(result.current.latest.isSuccess).toBe(true);
      expect(result.current.history.isSuccess).toBe(true);
    });
    expect(result.current.latest.data).toBeNull();
    // Even an unexpected null history payload must not be rewritten to [].
    expect(result.current.history.data).toBeNull();
  });

  it('passes each bound literally and independently scopes history without rescoping latest', async () => {
    requestMock.mockResolvedValue([]);
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ from, to }: { from: string; to: string }) => ({
        latest: usePressurePageLatest(42),
        history: usePressurePageHistory(42, from, to),
      }),
      { wrapper, initialProps: { from: start, to: end } },
    );
    await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
    rerender({ from: '2026-09-27', to: end });
    await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
    rerender({ from: '2026-09-27', to: '2026-10-05' });
    await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
    expect(requestMock.mock.calls).toEqual([
      ['/tire-pressure/latest?vehicle_id=42'],
      [`/tire-pressure?vehicle_id=42&start=${start}&end=${end}`],
      [`/tire-pressure?vehicle_id=42&start=2026-09-27&end=${end}`],
      ['/tire-pressure?vehicle_id=42&start=2026-09-27&end=2026-10-05'],
    ]);
    expect(client.getQueryCache().getAll().map(query => query.queryKey)).toEqual([
      ['tire-pressure-latest', 42],
      ['tire-pressure-history', 42, start, end],
      ['tire-pressure-history', 42, '2026-09-27', end],
      ['tire-pressure-history', 42, '2026-09-27', '2026-10-05'],
    ]);
  });

  it('preserves empty bounds rather than inventing a hook default window', async () => {
    requestMock.mockResolvedValue([]);
    const { client, wrapper } = setup();
    const { result } = renderHook(() => usePressurePageHistory(42, '', ''), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledWith('/tire-pressure?vehicle_id=42&start=&end=');
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual([
      'tire-pressure-history', 42, '', '',
    ]);
  });

  it('isolates both numeric vehicle caches on a selection change', async () => {
    requestMock.mockResolvedValue(null);
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(({ vehicleId }: { vehicleId: number | null }) => ({
      latest: usePressurePageLatest(vehicleId),
      history: usePressurePageHistory(vehicleId, start, end),
    }), { wrapper, initialProps: { vehicleId: 42 } });
    await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
    rerender({ vehicleId: 7 });
    await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
    expect(requestMock.mock.calls).toEqual([
      ['/tire-pressure/latest?vehicle_id=42'],
      [`/tire-pressure?vehicle_id=42&start=${start}&end=${end}`],
      ['/tire-pressure/latest?vehicle_id=7'],
      [`/tire-pressure?vehicle_id=7&start=${start}&end=${end}`],
    ]);
    expect(client.getQueryCache().getAll().map(query => query.queryKey)).toEqual([
      ['tire-pressure-latest', 42], ['tire-pressure-history', 42, start, end],
      ['tire-pressure-latest', 7], ['tire-pressure-history', 7, start, end],
    ]);
  });

  it.each(['latest', 'history'] as const)('inherits retry for %s without installing an override', async source => {
    requestMock.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValue(null);
    const { wrapper } = setup(1);
    const useSource: () => RetryOutcome = source === 'latest'
      ? () => {
        const query = usePressurePageLatest(42);
        return { isSuccess: query.isSuccess, data: query.data };
      }
      : () => {
        const query = usePressurePageHistory(42, start, end);
        return { isSuccess: query.isSuccess, data: query.data };
      };
    const { result } = renderHook(useSource, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBeNull();
  });

  it('surfaces an independent history error without default data or loss of latest cache', async () => {
    const error = new Error('history unavailable');
    requestMock.mockImplementation((path: string) => path.startsWith('/tire-pressure/latest')
      ? Promise.resolve(reading) : Promise.reject(error));
    const { wrapper } = setup();
    const { result } = renderHook(() => ({
      latest: usePressurePageLatest(42),
      history: usePressurePageHistory(42, start, end),
    }), { wrapper });
    await waitFor(() => {
      expect(result.current.latest.isSuccess).toBe(true);
      expect(result.current.history.isError).toBe(true);
    });
    expect(result.current.history.error).toBe(error);
    expect(result.current.history.data).toBeUndefined();
    expect(result.current.latest.data).toEqual(reading);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
