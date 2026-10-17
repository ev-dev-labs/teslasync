import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMaintenance, useServiceRecords } from './useMaintenance';
import type { MaintenanceItem, ServiceRecord } from './useMaintenance';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../client', () => ({ request: requestMock }));

const item: MaintenanceItem = {
  id: 2,
  vehicle_id: 42,
  category: 'tires',
  name: 'Tire Rotation',
  description: 'Rotate tires for even wear',
  due_date: null,
  due_mileage: 133000,
  current_mileage: 123000,
  last_service_date: null,
  last_service_mileage: null,
  interval_months: null,
  interval_miles: 10000,
  status: 'good',
  created_at: '2026-10-04T00:00:00Z',
};

// Contract fixture only, not evidence that the empty backend produces records.
const record: ServiceRecord = {
  id: 9,
  vehicle_id: 42,
  date: '2026-10-01',
  description: '',
  mileage: 0,
  cost: 0,
  provider: '',
  notes: 'Retain notes',
  created_at: '2026-10-01T00:00:00Z',
};

const clients: QueryClient[] = [];
function setup(retry: boolean | number = false, staleTime = 12345) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry, staleTime, retryDelay: 0, gcTime: Infinity } },
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

describe('canonical maintenance read hooks', () => {
  it('preserves both identities, full raw values and inherited stale policy', async () => {
    requestMock.mockImplementation((path: string) => Promise.resolve(
      path.startsWith('/maintenance/records') ? [record] : [item],
    ));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({
      items: useMaintenance(42),
      records: useServiceRecords(42),
    }), { wrapper });
    await waitFor(() => {
      expect(result.current.items.isSuccess).toBe(true);
      expect(result.current.records.isSuccess).toBe(true);
    });
    expect(requestMock.mock.calls).toEqual([
      ['/maintenance?vehicle_id=42', { signal: expect.any(AbortSignal) }],
      ['/maintenance/records?vehicle_id=42', { signal: expect.any(AbortSignal) }],
    ]);
    expect(result.current.items.data).toEqual([item]);
    expect(result.current.records.data).toEqual([record]);
    const queries = client.getQueryCache().getAll();
    expect(queries.map((query) => query.queryKey)).toEqual([
      ['maintenance', 42], ['maintenance-records', 42],
    ]);
    for (const query of queries) {
      expect(query.options).toMatchObject({ staleTime: 12345, retry: false });
      expect(query.options).not.toHaveProperty('select');
    }
  });

  it('does not fetch with a null selection and keeps the exact null identities', () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({
      items: useMaintenance(null),
      records: useServiceRecords(null),
    }), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.items.fetchStatus).toBe('idle');
    expect(result.current.records.fetchStatus).toBe('idle');
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([
      ['maintenance', null], ['maintenance-records', null],
    ]);
  });

  it('retains the precise non-null gate rather than replacing it with truthiness', async () => {
    requestMock.mockResolvedValue([]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useMaintenance(0), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledWith('/maintenance?vehicle_id=0', { signal: expect.any(AbortSignal) });
    // Real backend rejects 0; this only guards the inherited query enablement.
  });

  it('isolates both caches and requests when the selected vehicle changes', async () => {
    requestMock.mockResolvedValue([]);
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(({ vehicleId }: { vehicleId: number | null }) => ({
      items: useMaintenance(vehicleId),
      records: useServiceRecords(vehicleId),
    }), { wrapper, initialProps: { vehicleId: 42 } });
    await waitFor(() => expect(result.current.records.isSuccess).toBe(true));
    rerender({ vehicleId: 7 });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(4));
    expect(requestMock).toHaveBeenCalledWith('/maintenance?vehicle_id=7', { signal: expect.any(AbortSignal) });
    expect(requestMock).toHaveBeenCalledWith('/maintenance/records?vehicle_id=7', { signal: expect.any(AbortSignal) });
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([
      ['maintenance', 42], ['maintenance-records', 42],
      ['maintenance', 7], ['maintenance-records', 7],
    ]);
  });

  it('inherits QueryClient retry instead of the legacy retry:false override', async () => {
    requestMock.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValue([]);
    const { wrapper } = setup(1);
    const { result } = renderHook(() => useMaintenance(42), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual([]);
  });

  it('surfaces read errors without fabricating fallback records', async () => {
    const error = new Error('records unavailable');
    requestMock.mockRejectedValue(error);
    const { wrapper } = setup();
    const { result } = renderHook(() => useServiceRecords(42), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeUndefined();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing empty records payload', async () => {
    requestMock.mockResolvedValue([]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useServiceRecords(42), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('aborts both in-flight sources when their observers unmount', async () => {
    const signals: AbortSignal[] = [];
    requestMock.mockImplementation((_path: string, { signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      });
    });
    const { client, wrapper } = setup();
    const { unmount } = renderHook(() => ({
      items: useMaintenance(42),
      records: useServiceRecords(42),
    }), { wrapper });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals.every(signal => !signal.aborted)).toBe(true);
    unmount();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(client.getQueryData(['maintenance', 42])).toBeUndefined();
    expect(client.getQueryData(['maintenance-records', 42])).toBeUndefined();
  });
});
