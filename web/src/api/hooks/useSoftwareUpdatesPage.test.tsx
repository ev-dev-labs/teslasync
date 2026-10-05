import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PAGE_SIZE, useSoftwareUpdatesPage, type SoftwareUpdate } from './useSoftwareUpdatesPage';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/api/client', () => ({ request: requestMock }));

const clients: QueryClient[] = [];
function fixture() {
  // Error identity is observed as state, never thrown into the React boundary.
  // These are test defaults, not policy added by the production hook.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, throwOnError: false },
    },
  });
  clients.push(client);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

const updates: SoftwareUpdate[] = [
  {
    id: 9, vehicle_id: 7, version: '2026.4', status: 'unknown-status',
    installed_at: null, scheduled_at: '2026-04-03T12:00:00+05:30',
    created_at: '2026-04-01T10:00:00Z',
  },
  {
    id: 3, vehicle_id: 7, version: '2025.8', status: 'installed',
    installed_at: '2025-12-30T01:00:00Z', scheduled_at: null,
    created_at: '2025-12-29T00:00:00Z',
  },
  {
    id: 5, vehicle_id: 7, version: '2026.1', status: 'scheduled',
    installed_at: null, scheduled_at: null, created_at: 'invalid-date',
  },
];

beforeEach(() => {
  requestMock.mockReset();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('useSoftwareUpdatesPage exact page contract', () => {
  it('keeps PAGE_SIZE, URL operand order, encoding and the complete cache key', async () => {
    requestMock.mockResolvedValue(updates);
    const { client, wrapper } = fixture();
    const start = '2026-04-01T00:00:00+05:30';
    const end = 'end &/=+?';
    const { result } = renderHook(() => useSoftwareUpdatesPage(7, 3, start, end), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(PAGE_SIZE).toBe(50);
    expect(requestMock.mock.calls[0][0]).toBe(
      '/software-updates?vehicle_id=7&limit=50&offset=100&start=2026-04-01T00%3A00%3A00%2B05%3A30&end=end+%26%2F%3D%2B%3F',
    );
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual([
      'software-updates', 7, 3, start, end,
    ]);
    expect(requestMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it.each([0, -1, 1.5, Number.NaN, Infinity])(
    'enables every non-null numeric vehicle operand without normalization: %s',
    async (vehicleId) => {
      requestMock.mockResolvedValue([]);
      const { result } = renderHook(() => useSoftwareUpdatesPage(vehicleId, 1, '', ''), fixture());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(requestMock.mock.calls[0][0]).toBe(
        `/software-updates?vehicle_id=${String(vehicleId)}&limit=50&offset=0&start=&end=`,
      );
    },
  );

  it('disables only null but preserves its key and allows an explicit refetch', async () => {
    requestMock.mockResolvedValue([]);
    const { client, wrapper } = fixture();
    const { result } = renderHook(() => useSoftwareUpdatesPage(null, 1, '', ''), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(requestMock).not.toHaveBeenCalled();
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual([
      'software-updates', null, 1, '', '',
    ]);
    await act(async () => { await result.current.refetch(); });
    expect(requestMock.mock.calls[0][0]).toBe(
      '/software-updates?vehicle_id=null&limit=50&offset=0&start=&end=',
    );
  });

  it.each([0, -2, 1.5])('preserves page arithmetic for page %s', async (page) => {
    requestMock.mockResolvedValue([]);
    const { result } = renderHook(() => useSoftwareUpdatesPage(7, page, '', ''), fixture());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock.mock.calls[0][0]).toBe(
      `/software-updates?vehicle_id=7&limit=50&offset=${(page - 1) * 50}&start=&end=`,
    );
  });

  it('isolates each vehicle/page/start/end key and reuses an exact fresh cache entry', async () => {
    requestMock.mockResolvedValue(updates);
    const { client, wrapper } = fixture();
    client.setDefaultOptions({
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity, throwOnError: false },
    });
    const initial = { vehicleId: 7, page: 1, start: '', end: '' };
    const { result, rerender } = renderHook(
      (p) => useSoftwareUpdatesPage(p.vehicleId, p.page, p.start, p.end),
      { wrapper, initialProps: initial },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    for (const props of [
      { ...initial, vehicleId: 8 },
      { ...initial, page: 2 },
      { ...initial, start: 'start' },
      { ...initial, end: 'end' },
    ]) {
      rerender(props);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    }
    expect(requestMock).toHaveBeenCalledTimes(5);
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([
      ['software-updates', 7, 1, '', ''],
      ['software-updates', 8, 1, '', ''],
      ['software-updates', 7, 2, '', ''],
      ['software-updates', 7, 1, 'start', ''],
      ['software-updates', 7, 1, '', 'end'],
    ]);
    rerender(initial);
    expect(result.current.data).toEqual(updates);
    expect(requestMock).toHaveBeenCalledTimes(5);
  });

  it('returns raw array order, unknown status and nullable/unparsed date fields', async () => {
    requestMock.mockResolvedValue(updates);
    const { result } = renderHook(() => useSoftwareUpdatesPage(7, 1, '', ''), fixture());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(updates);
    expect(result.current.data?.map((u) => u.id)).toEqual([9, 3, 5]);
    expect(result.current.data?.[0].status).toBe('unknown-status');
    expect(result.current.data?.[0].installed_at).toBeNull();
    expect(result.current.data?.[2].created_at).toBe('invalid-date');
  });

  it.each([[], null, 0, { malformed: true }])(
    'does not select, default or normalize a raw success payload: %j',
    async (payload) => {
      requestMock.mockResolvedValue(payload);
      const { result } = renderHook(() => useSoftwareUpdatesPage(7, 1, '', ''), fixture());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(payload);
      expect(result.current.error).toBeNull();
    },
  );

  it('preserves rejected Error identity without inventing empty data', async () => {
    const error = new Error('software history unavailable');
    requestMock.mockRejectedValue(error);
    const { result } = renderHook(() => useSoftwareUpdatesPage(7, 1, '', ''), fixture());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeUndefined();
  });

  it('retains successful data when refetch fails, with the original error', async () => {
    const error = new Error('refresh unavailable');
    requestMock.mockResolvedValueOnce(updates).mockRejectedValueOnce(error);
    const { result } = renderHook(() => useSoftwareUpdatesPage(7, 1, '', ''), fixture());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isRefetchError).toBe(true));
    expect(result.current.data).toEqual(updates);
    expect(result.current.error).toBe(error);
  });

  it('forwards the actual query signal, which QueryClient cancellation aborts', async () => {
    requestMock.mockImplementation(() => new Promise<SoftwareUpdate[]>(() => {}));
    const { client, wrapper } = fixture();
    const { result } = renderHook(() => useSoftwareUpdatesPage(7, 1, '', ''), { wrapper });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const signal: AbortSignal = requestMock.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);
    await act(async () => {
      await client.cancelQueries({ queryKey: ['software-updates', 7, 1, '', ''], exact: true });
    });
    expect(signal.aborted).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeUndefined();
  });

  it('inherits client retry/stale/poll/error policy rather than overriding it', async () => {
    requestMock.mockRejectedValueOnce(new Error('retry me')).mockResolvedValueOnce(updates);
    const { client, wrapper } = fixture();
    client.setDefaultOptions({
      queries: {
        retry: 1, retryDelay: 0, staleTime: 12345,
        refetchInterval: 987654, throwOnError: false, gcTime: Infinity,
      },
    });
    const { result } = renderHook(() => useSoftwareUpdatesPage(7, 1, '', ''), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(2);
    const options = client.getQueryCache().getAll()[0].options;
    expect(options).toMatchObject({
      retry: 1, staleTime: 12345, refetchInterval: 987654, throwOnError: false,
    });
    expect(options).not.toHaveProperty('select');
  });
});
