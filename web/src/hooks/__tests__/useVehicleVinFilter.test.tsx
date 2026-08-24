import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Vehicle } from '@/types/vehicle';
import {
  SelectedVehicleProvider,
  __SELECTED_VEHICLE_STORAGE_KEY__,
} from '@/store/selectedVehicle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  ALL_VEHICLES_VIN,
  useVehicleVinFilter,
} from '@/hooks/useVehicleVinFilter';

const fleet: Vehicle[] = [
  {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN-ONE',
    display_name: 'One',
    model: 'model3',
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
    vin: 'VIN-TWO',
    display_name: 'Two',
    model: 'modely',
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
  useVehicles: () => ({ data: fleet }),
}));

function wrapper(initialEntry = '/tesla/charging/history') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <SelectedVehicleProvider>{children}</SelectedVehicleProvider>
      </MemoryRouter>
    );
  };
}

function useHarness() {
  const filter = useVehicleVinFilter();
  const selected = useSelectedVehicle();
  const location = useLocation();
  return { filter, selected, location };
}

describe('useVehicleVinFilter', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults VIN-backed pages to the persisted global vehicle', async () => {
    window.localStorage.setItem(__SELECTED_VEHICLE_STORAGE_KEY__, '2');
    const { result } = renderHook(useHarness, { wrapper: wrapper() });

    await waitFor(() => expect(result.current.filter.selectedVin).toBe('VIN-TWO'));
    expect(result.current.filter.queryVin).toBe('VIN-TWO');
  });

  it('supports an explicit fleet-wide override until the status vehicle changes', async () => {
    const { result } = renderHook(useHarness, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.selected.vehicleId).toBe(1));

    act(() => {
      result.current.filter.setSelectedVin(ALL_VEHICLES_VIN);
    });
    await waitFor(() => expect(result.current.filter.allVehicles).toBe(true));
    expect(result.current.filter.queryVin).toBeUndefined();

    act(() => {
      result.current.selected.setVehicleId(2);
    });
    await waitFor(() => expect(result.current.filter.selectedVin).toBe('VIN-TWO'));
    expect(result.current.filter.allVehicles).toBe(false);
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('vehicle_id')).toBe('2');
    expect(params.has('vin')).toBe(false);
  });

  it('promotes a concrete page VIN selection into the global vehicle store', async () => {
    const { result } = renderHook(useHarness, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.selected.vehicleId).toBe(1));

    act(() => {
      result.current.filter.setSelectedVin('VIN-TWO');
    });

    await waitFor(() => expect(result.current.selected.vehicleId).toBe(2));
    expect(result.current.filter.queryVin).toBe('VIN-TWO');
    expect(window.localStorage.getItem(__SELECTED_VEHICLE_STORAGE_KEY__)).toBe('2');
  });

  it('hydrates the global selection from legacy VIN bookmarks', async () => {
    const { result } = renderHook(useHarness, {
      wrapper: wrapper('/tesla/charging/history?vin=VIN-TWO'),
    });

    await waitFor(() => expect(result.current.selected.vehicleId).toBe(2));
    expect(result.current.filter.queryVin).toBe('VIN-TWO');
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('vehicle_id')).toBe('2');
    expect(params.has('vin')).toBe(false);
  });

  it('removes an unresolvable VIN instead of querying a different vehicle under a stale label', async () => {
    const { result } = renderHook(useHarness, {
      wrapper: wrapper('/tesla/charging/history?vin=VIN-MISSING'),
    });

    await waitFor(() =>
      expect(new URLSearchParams(result.current.location.search).has('vin')).toBe(false),
    );
    expect(result.current.filter.selectedVin).toBe('VIN-ONE');
    expect(result.current.filter.queryVin).toBe('VIN-ONE');
  });

  it('preserves fleet-wide VIN scope while repairing a stale numeric vehicle id', async () => {
    const { result } = renderHook(useHarness, {
      wrapper: wrapper('/tesla/charging/history?vehicle_id=999&vin=*'),
    });

    await waitFor(() => {
      const params = new URLSearchParams(result.current.location.search);
      expect(params.get('vehicle_id')).toBe('1');
      expect(params.get('vin')).toBe('*');
    });
    expect(result.current.filter.allVehicles).toBe(true);
    expect(result.current.filter.queryVin).toBeUndefined();
  });
});
