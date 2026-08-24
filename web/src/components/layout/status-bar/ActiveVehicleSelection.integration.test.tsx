import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import type { Vehicle } from '@/types/vehicle';
import { VehicleSelect } from '@/components/forms';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';
import { ActiveVehicleSegment } from './ActiveVehicleSegment';

const fleet: Vehicle[] = [
  {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN-ONE',
    display_name: 'Model 3',
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
    display_name: 'Model Y',
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
  useVehicleState: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km' } }),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderSelectionSurfaces() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/battery?range=30d']}>
        <SelectedVehicleProvider>
          <ActiveVehicleSegment />
          <VehicleSelect />
          <LocationProbe />
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('global vehicle selection surfaces', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps the status selector, page filter, URL, and persisted store synchronized', async () => {
    renderSelectionSurfaces();

    const pageSelect = await screen.findByTestId('vehicle-select') as HTMLSelectElement;
    await waitFor(() => expect(pageSelect.value).toBe('1'));

    fireEvent.click(screen.getByRole('button', { name: /Switch vehicle \(Model 3\)/ }));
    const dialog = screen.getByRole('dialog', { name: 'Switch vehicle' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Model Y/ }));

    await waitFor(() => expect(pageSelect.value).toBe('2'));
    expect(screen.getByRole('button', { name: /Switch vehicle \(Model Y\)/ })).toBeInTheDocument();
    const selectedParams = new URLSearchParams(
      screen.getByTestId('location-search').textContent ?? '',
    );
    expect(selectedParams.get('vehicle_id')).toBe('2');
    expect(selectedParams.get('range')).toBe('30d');
    expect(window.localStorage.getItem('teslasync-selected-vehicle')).toBe('2');

    fireEvent.change(pageSelect, { target: { value: '1' } });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Switch vehicle \(Model 3\)/ })).toBeInTheDocument(),
    );
    expect(new URLSearchParams(
      screen.getByTestId('location-search').textContent ?? '',
    ).get('vehicle_id')).toBe('1');
  });
});
