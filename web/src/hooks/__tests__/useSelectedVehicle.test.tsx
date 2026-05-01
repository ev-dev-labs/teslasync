import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(1));
    act(() => {
      result.current.setVehicleId(2);
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(2));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it('returns null vehicle when the id is not in the fleet', async () => {
    window.localStorage.setItem(STORAGE_KEY, '999');
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/dashboard']),
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(999));
    expect(result.current.vehicle).toBeNull();
  });

  it('ignores malformed ?vehicle_id values', async () => {
    const { result } = renderHook(() => useSelectedVehicle(), {
      wrapper: makeWrapper(['/battery?vehicle_id=oops']),
    });
    await waitFor(() => expect(result.current.vehicleId).toBe(1));
  });
});
