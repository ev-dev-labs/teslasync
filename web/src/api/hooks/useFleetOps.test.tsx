import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();
vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import {
  fleetOpsKeys,
  useCreateFleetReservation,
  useDeleteFleetReservation,
  useDeleteFleetWorkOrder,
  useFleetReservation,
  useFleetReservations,
  useFleetUtilizationForecast,
  useFleetWorkOrders,
  useUpdateFleetChargingPolicy,
  useUpdateFleetReservation,
} from './useFleetOps';

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { Wrapper, client };
}

beforeEach(() => requestMock.mockReset());

describe('fleet operations query hooks', () => {
  it('uses the mounted reservation route, snake_case filters, and AbortSignal', async () => {
    requestMock.mockResolvedValueOnce({ items: [], total: 0, limit: 25, offset: 0 });
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useFleetReservations({ vehicle_id: 7, cost_center_id: 3, limit: 25 }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, options] = requestMock.mock.calls[0] as [string, RequestInit & { requiresLiveMode?: boolean }];
    expect(url).toBe('/fleet-ops/reservations?vehicle_id=7&cost_center_id=3&limit=25');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('builds the fleet forecast URL without requiring a vehicle id', async () => {
    requestMock.mockResolvedValueOnce({ points: [], limitations: [] });
    const { Wrapper } = wrapper();
    const from = '2026-08-05T00:00:00.000Z';
    const to = '2026-08-19T00:00:00.000Z';
    const { result } = renderHook(() => useFleetUtilizationForecast(undefined, from, to), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock.mock.calls[0][0]).toBe(
      `/fleet-ops/utilization-forecast?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
  });

  it('uses the mounted work-order route for fleet service attention', async () => {
    requestMock.mockResolvedValueOnce({ items: [], total: 0, limit: 100, offset: 0 });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useFleetWorkOrders({ limit: 100 }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, options] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/fleet-ops/work-orders?limit=100');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('guards detail requests when the id is empty', () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useFleetReservation(undefined), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('keeps query keys under one invalidation prefix', () => {
    expect(fleetOpsKeys.reservations({ vehicle_id: 2 }).slice(0, 1)).toEqual(fleetOpsKeys.all);
    expect(fleetOpsKeys.forecast().slice(0, 1)).toEqual(fleetOpsKeys.all);
  });
});

describe('fleet operations mutations', () => {
  it('creates a reservation and invalidates all fleet caches', async () => {
    requestMock.mockResolvedValueOnce({ id: 9 });
    const { Wrapper, client } = wrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateFleetReservation(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        vehicle_id: 2,
        driver_id: null,
        cost_center_id: 4,
        title: 'Airport run',
        purpose: null,
        starts_at: '2026-08-06T10:00:00Z',
        ends_at: '2026-08-06T11:00:00Z',
        status: 'requested',
      });
    });
    const [url, options] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/fleet-ops/reservations');
    expect(options.method).toBe('POST');
    expect(options.requiresLiveMode).toBe(true);
    expect(JSON.parse(String(options.body))).toMatchObject({ vehicle_id: 2, cost_center_id: 4 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetOpsKeys.all });
  });

  it('threads the optimistic version through policy updates', async () => {
    requestMock.mockResolvedValueOnce({ id: 8 });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useUpdateFleetChargingPolicy(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: 8,
        version: 3,
        input: {
          vehicle_id: 2,
          name: 'Depot nights',
          target_soc_pct: 80,
          max_power_w: 11000,
          priority: 10,
          effective_from: '2026-08-05T00:00:00Z',
          effective_to: null,
          enabled: true,
          windows: [{ day_of_week: 1, start_local_time: '00:00', end_local_time: '06:00' }],
        },
      });

    });
    const [url, options] = requestMock.mock.calls[0] as [string, RequestInit & { requiresLiveMode?: boolean }];
    expect(url).toBe('/fleet-ops/charging-policies/8');
    expect(options.method).toBe('PUT');
    expect(options.requiresLiveMode).toBe(true);
    expect(JSON.parse(String(options.body))).toMatchObject({ version: 3, max_power_w: 11000 });
  });

  it('threads the optimistic version through reservation cancellation', async () => {
    requestMock.mockResolvedValueOnce({ id: 3 });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useUpdateFleetReservation(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: 3,
        version: 4,
        input: {
          vehicle_id: 7,
          driver_id: 2,
          cost_center_id: null,
          title: 'Airport run',
          purpose: null,
          starts_at: '2026-08-06T10:00:00Z',
          ends_at: '2026-08-06T11:00:00Z',
          status: 'cancelled',
        },
      });
    });
    const [url, options] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/fleet-ops/reservations/3');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(String(options.body))).toMatchObject({ version: 4, status: 'cancelled' });
  });

  it('puts the optimistic version in delete query parameters', async () => {
    requestMock.mockResolvedValueOnce(undefined);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useDeleteFleetWorkOrder(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 12, version: 5 });
    });
    expect(requestMock.mock.calls[0][0]).toBe('/fleet-ops/work-orders/12?version=5');
    expect((requestMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('deletes a reservation through the mounted item route', async () => {
    requestMock.mockResolvedValueOnce(undefined);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useDeleteFleetReservation(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 3, version: 6 });
    });
    expect(requestMock.mock.calls[0][0]).toBe('/fleet-ops/reservations/3?version=6');
    expect((requestMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });
});
