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

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: FLEET }),
}));

function makeWrapper(initialEntries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
});
