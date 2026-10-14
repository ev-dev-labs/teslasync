import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  SelectedVehicleProvider,
  __SELECTED_VEHICLE_STORAGE_KEY__,
} from '@/store/selectedVehicle';
import { useSelectedVehicle } from '../useSelectedVehicle';
import type { Vehicle } from '@/types/vehicle';
import type { DataStateSource } from '@/api/dataState';
import { request } from '@/api/client';

const STORAGE_KEY = __SELECTED_VEHICLE_STORAGE_KEY__;

const FLEET: Vehicle[] = [
  {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN-A',
    display_name: 'Roadster',
    model: 'roadster',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
  },
  {
    id: 2,
    vehicle_id: 2,
    vin: 'VIN-B',
    display_name: 'Cybertruck',
    model: 'cybertruck',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
  },
];

let vehiclesQuery: DataStateSource<Vehicle[]> | undefined;

vi.mock('@/api/client', () => ({ request: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...original,
    useVehicles: () => vehiclesQuery ?? original.useVehicles(),
  };
});

function makeWrapper(initialEntries: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>
          <SelectedVehicleProvider>{children}</SelectedVehicleProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('useSelectedVehicle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vehiclesQuery = { data: FLEET, isSuccess: true };
    vi.mocked(request).mockReset();
  });

  it('defaults to the first vehicle when nothing is selected', async () => {
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(1));
    expect(result.current.vehicle?.display_name).toBe('Roadster');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('honors a previously persisted selection', async () => {
    window.localStorage.setItem(STORAGE_KEY, '2');
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/battery']),
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(2));
    expect(result.current.vehicle?.display_name).toBe('Cybertruck');
  });

  it('lets the /vehicles/:id path override and sync the store', async () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/vehicles/2']),
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(2));
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2'));
  });

  it('lets ?vehicle_id=N override and sync the store (alert drillthrough)', async () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/battery?vehicle_id=2&t=2026-04-30T13:00:00Z']),
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(2));
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2'));
  });

  it('setVehicleId updates both state and persistence', async () => {
    const { result } = renderHook(() => {
      const selected = useSelectedVehicle();
      const location = useLocation();
      return { ...selected, location };
    }, {
      wrapper: makeWrapper(['/dashboard']),
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(1));
    act(() => {
      result.current.setVehicleId(2);
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(2));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2');
    expect(result.current.location.search).toBe('?vehicle_id=2');
  });

  it('repairs a persisted id that is no longer in the fleet', async () => {
    window.localStorage.setItem(STORAGE_KEY, '999');
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(1));
    expect(result.current.vehicle?.display_name).toBe('Roadster');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('ignores malformed ?vehicle_id values', async () => {
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/battery?vehicle_id=oops']),
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(1));
  });

  it('preserves unrelated query params when a global selection changes', async () => {
    const { result } = renderHook(() => {
      const selected = useSelectedVehicle();
      const location = useLocation();
      return { ...selected, location };
    }, {
      wrapper: makeWrapper(['/period-compare?period_a=30&period_b=90']),
    });

    act(() => {
      result.current.setVehicleId(2);
    });

    await waitFor(() => expect(result.current.vehicleId).toBe(2));
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('vehicle_id')).toBe('2');
    expect(params.get('period_a')).toBe('30');
    expect(params.get('period_b')).toBe('90');
  });

  it('preserves the global time scope when the vehicle changes', async () => {
    const { result } = renderHook(() => {
      const selected = useSelectedVehicle();
      const location = useLocation();
      return { ...selected, location };
    }, {
      wrapper: makeWrapper([
        '/battery?from=2026-07-29&to=2026-08-27&time_scope=30d',
      ]),
    });

    act(() => result.current.setVehicleId(2));

    await waitFor(() => expect(result.current.vehicleId).toBe(2));
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('vehicle_id')).toBe('2');
    expect(params.get('from')).toBe('2026-07-29');
    expect(params.get('to')).toBe('2026-08-27');
    expect(params.get('time_scope')).toBe('30d');
  });

  it('updates an existing URL-backed vehicle filter instead of being overwritten by it', async () => {
    const { result } = renderHook(() => {
      const selected = useSelectedVehicle();
      const location = useLocation();
      return { ...selected, location };
    }, {
      wrapper: makeWrapper(['/battery?vehicle_id=1&t=2026-04-30T13:00:00Z']),
    });

    act(() => {
      result.current.setVehicleId(2);
    });

    await waitFor(() => expect(result.current.vehicleId).toBe(2));
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('vehicle_id')).toBe('2');
    expect(params.get('t')).toBe('2026-04-30T13:00:00Z');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it('rewrites vehicle detail paths when the global selection changes', async () => {
    const { result } = renderHook(() => {
      const selected = useSelectedVehicle();
      const location = useLocation();
      return { ...selected, location };
    }, {
      wrapper: makeWrapper(['/vehicles/1/access?tab=keys']),
    });

    act(() => {
      result.current.setVehicleId(2);
    });

    await waitFor(() => expect(result.current.location.pathname).toBe('/vehicles/2/access'));
    expect(result.current.location.search).toBe('?tab=keys');
    expect(result.current.vehicleId).toBe(2);
  });

  it('repairs a deleted vehicle id in the URL while retaining the rest of the query', async () => {
    const { result } = renderHook(() => {
      const selected = useSelectedVehicle();
      const location = useLocation();
      return { ...selected, location };
    }, {
      wrapper: makeWrapper(['/battery?vehicle_id=999&signal=BatteryLevel']),
    });

    await waitFor(() => expect(result.current.vehicleId).toBe(1));
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('vehicle_id')).toBe('1');
    expect(params.get('signal')).toBe('BatteryLevel');
  });

  it('repairs a deleted vehicle detail path while retaining its query', async () => {
    const { result } = renderHook(() => {
      const selected = useSelectedVehicle();
      const location = useLocation();
      return { ...selected, location };
    }, {
      wrapper: makeWrapper(['/vehicles/999?tab=overview']),
    });

    await waitFor(() => expect(result.current.location.pathname).toBe('/vehicles/1'));
    expect(result.current.location.search).toBe('?tab=overview');
    expect(result.current.vehicleId).toBe(1);
  });

  it('does not reinterpret multi-vehicle URL filters as the global selection', async () => {
    window.localStorage.setItem(STORAGE_KEY, '2');
    const { result } = renderHook(() => {
      const selected = useSelectedVehicle();
      const location = useLocation();
      return { ...selected, location };
    }, {
      wrapper: makeWrapper(['/notifications/inbox?vehicle_id=1,2']),
    });

    await waitFor(() => expect(result.current.vehicleId).toBe(2));
    expect(result.current.location.search).toBe('?vehicle_id=1,2');
  });

  it('exposes an unresolved prerequisite without inventing a confirmed empty fleet', () => {
    vehiclesQuery = { isPending: true, isFetching: true, fetchStatus: 'fetching' };
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });

    expect(result.current.vehicles).toEqual([]);
    expect(result.current.vehicleId).toBeNull();
    expect(result.current.vehicle).toBeNull();
    expect(result.current.vehiclesState).toMatchObject({
      data: undefined,
      hasData: false,
      status: 'initial',
      provenance: 'unknown',
      fatalError: null,
      refreshError: null,
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps a persisted id while the fleet is unknown and repairs it only after resolution', async () => {
    window.localStorage.setItem(STORAGE_KEY, '999');
    vehiclesQuery = { isPending: true };
    const { result, rerender } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });

    expect(result.current.vehicleId).toBe(999);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('999');
    vehiclesQuery = { data: FLEET, isSuccess: true };
    rerender();

    await waitFor(() => expect(result.current.vehicleId).toBe(1));
    expect(result.current.vehiclesState.data).toBe(FLEET);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('preserves an unresolved URL selection through fatal failure until a known fleet can repair it', async () => {
    const error = new Error('Fleet unavailable');
    const refetch = vi.fn();
    vehiclesQuery = { isError: true, error, refetch };
    const { result, rerender } = renderHook(() => {
      const selected = useSelectedVehicle();
      return { ...selected, location: useLocation() };
    }, {
      wrapper: makeWrapper(['/battery?vehicle_id=999&signal=BatteryLevel']),
    });

    expect(result.current.vehicleId).toBe(999);
    expect(result.current.location.search).toBe('?vehicle_id=999&signal=BatteryLevel');
    expect(result.current.vehiclesState).toMatchObject({
      data: undefined,
      hasData: false,
      status: 'initialFailure',
      fatalError: error,
      refreshError: null,
    });
    act(() => result.current.vehiclesState.retry?.());
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('999');

    vehiclesQuery = { data: FLEET, isSuccess: true };
    rerender();
    await waitFor(() => expect(result.current.vehicleId).toBe(1));
    expect(result.current.location.search).toBe('?vehicle_id=1&signal=BatteryLevel');
  });

  it('marks a successful empty fleet unavailable without erasing sticky selection', async () => {
    window.localStorage.setItem(STORAGE_KEY, '2');
    vehiclesQuery = { data: [], isSuccess: true };
    const { result, rerender } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });

    expect(result.current.vehicleId).toBeNull();
    expect(result.current.vehicle).toBeNull();
    expect(result.current.vehiclesState).toMatchObject({
      data: [],
      hasData: true,
      status: 'unavailable',
      provenance: 'cached',
      fatalError: null,
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2');
    vehiclesQuery = { data: FLEET, isSuccess: true };
    rerender();
    await waitFor(() => expect(result.current.vehicleId).toBe(2));
  });

  it('retains the fleet record selection timestamp and retry on background failure', () => {
    window.localStorage.setItem(STORAGE_KEY, '2');
    const error = new Error('Refresh failed');
    const refetch = vi.fn();
    vehiclesQuery = { data: FLEET, isError: true, error, dataUpdatedAt: 1234, refetch };
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });

    expect(result.current.vehicleId).toBe(2);
    expect(result.current.vehicle).toBe(FLEET[1]);
    expect(result.current.vehicles).toBe(FLEET);
    expect(result.current.vehiclesState).toMatchObject({
      data: FLEET,
      hasData: true,
      status: 'stale',
      provenance: 'cached',
      fatalError: null,
      refreshError: error,
      updatedAt: 1234,
    });
    act(() => result.current.vehiclesState.retry?.());
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it('exposes background fetching while retaining selected records and stable trust identity', () => {
    vehiclesQuery = { data: FLEET, isSuccess: true, isFetching: true };
    const { result, rerender } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });
    const state = result.current.vehiclesState;

    expect(state).toMatchObject({ status: 'ok', isRefreshing: true, fatalError: null });
    expect(result.current.vehicle).toBe(FLEET[0]);
    rerender();
    expect(result.current.vehiclesState).toBe(state);
  });

  it.each([undefined, FLEET, []])('keeps paused trust cause-neutral for retained payload %j', (data) => {
    vehiclesQuery = { data, isPending: data === undefined, fetchStatus: 'paused' };
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });

    expect(result.current.vehiclesState).toMatchObject({
      data,
      status: data === undefined ? 'initial' : 'stale',
      isRefreshBlocked: true,
      fatalError: null,
      refreshError: null,
    });
  });

  it('does not relabel a retained empty fleet with refresh failure as a successful empty response', () => {
    const error = new Error('Empty cache refresh failed');
    vehiclesQuery = { data: [], isError: true, error };
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });

    expect(result.current.vehiclesState).toMatchObject({
      data: [],
      hasData: true,
      status: 'stale',
      fatalError: null,
      refreshError: error,
    });
  });

  it('forwards actual useVehicles loading failure retry and recovery with cancellation intact', async () => {
    vehiclesQuery = undefined;
    let rejectFirst: (error: Error) => void = () => {};
    vi.mocked(request).mockReturnValueOnce(new Promise<Vehicle[]>((_resolve, reject) => {
      rejectFirst = reject;
    })).mockResolvedValue(FLEET);
    window.localStorage.setItem(STORAGE_KEY, '2');
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });

    expect(result.current.vehiclesState.status).toBe('initial');
    expect(result.current.vehicleId).toBe(2);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith('/vehicles', { signal: expect.any(AbortSignal) });
    const error = new Error('Initial request rejected');
    await act(async () => rejectFirst(error));
    await waitFor(() => expect(result.current.vehiclesState.fatalError).toBe(error));
    expect(result.current.vehiclesState.data).toBeUndefined();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2');

    act(() => result.current.vehiclesState.retry?.());
    await waitFor(() => expect(result.current.vehiclesState.status).toBe('ok'));
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.vehiclesState.data).toBe(FLEET);
    expect(result.current.vehicle).toBe(FLEET[1]);
  });

  it('forwards actual useVehicles retained refresh failure and successful retry without dropping the selection', async () => {
    vehiclesQuery = undefined;
    const error = new Error('Background request rejected');
    vi.mocked(request).mockResolvedValueOnce(FLEET).mockRejectedValueOnce(error).mockResolvedValue(FLEET);
    window.localStorage.setItem(STORAGE_KEY, '2');
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });
    await waitFor(() => expect(result.current.vehiclesState.status).toBe('ok'));
    const updatedAt = result.current.vehiclesState.updatedAt;

    act(() => result.current.vehiclesState.retry?.());
    await waitFor(() => expect(result.current.vehiclesState.refreshError).toBe(error));
    expect(result.current.vehiclesState.fatalError).toBeNull();
    expect(result.current.vehiclesState.status).toBe('stale');
    expect(result.current.vehiclesState.updatedAt).toBe(updatedAt);
    expect(result.current.vehicleId).toBe(2);
    expect(result.current.vehicle).toBe(FLEET[1]);
    expect(result.current.vehicles).toBe(FLEET);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2');

    act(() => result.current.vehiclesState.retry?.());
    await waitFor(() => expect(result.current.vehiclesState.status).toBe('ok'));
    expect(result.current.vehiclesState.refreshError).toBeNull();
    expect(request).toHaveBeenCalledTimes(3);
  });
});
