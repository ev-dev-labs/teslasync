import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import '@/i18n';
import { SelectedVehicleProvider, __SELECTED_VEHICLE_STORAGE_KEY__ } from '@/store/selectedVehicle';
import { VehicleSelect } from '../VehicleSelect';
import { WorkspaceScopeProvider } from '@/hooks/useWorkspaceScope';
import type { WorkspaceRouteScope } from '@/lib/workspaceScope';
import type { Vehicle } from '@/types/vehicle';

const STORAGE_KEY = __SELECTED_VEHICLE_STORAGE_KEY__;

let MOCK_FLEET: Vehicle[] = [];

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: MOCK_FLEET }),
}));

function makeVehicle(id: number, name: string, vin = `VIN-${id}`): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin,
    display_name: name,
    model: 'Model 3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
  };
}

function renderWithFleet(
  fleet: Vehicle[],
  initialEntries: string[] = ['/dashboard'],
  workspaceScope?: WorkspaceRouteScope,
  controlScope?: 'workspace' | 'local',
) {
  MOCK_FLEET = fleet;
  function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>
          <SelectedVehicleProvider>
            {workspaceScope ? (
              <WorkspaceScopeProvider scope={workspaceScope}>
                {children}
              </WorkspaceScopeProvider>
            ) : children}
          </SelectedVehicleProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Wrapper>
      <VehicleSelect scope={controlScope} />
    </Wrapper>,
  );
}

describe('VehicleSelect', () => {
  beforeEach(() => {
    window.localStorage.clear();
    MOCK_FLEET = [];
  });

  it('renders nothing when the fleet is empty', () => {
    const { container } = renderWithFleet([]);
    expect(container.querySelector('select')).toBeNull();
  });

  it('renders for a single-vehicle fleet (always-show rule)', async () => {
    renderWithFleet([makeVehicle(1, 'Roadster')]);
    const select = await screen.findByTestId('vehicle-select');
    expect(select).toBeInTheDocument();
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('1'));
    expect(screen.getByRole('option', { name: 'Roadster' })).toBeInTheDocument();
  });

  it('lists every vehicle and reflects the persisted store selection', async () => {
    window.localStorage.setItem(STORAGE_KEY, '2');
    renderWithFleet([
      makeVehicle(1, 'Roadster'),
      makeVehicle(2, 'Cybertruck'),
      makeVehicle(3, 'Plaid'),
    ]);
    const select = (await screen.findByTestId('vehicle-select')) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['1', '2', '3']);
    await waitFor(() => expect(select.value).toBe('2'));
  });

  it('persists a new selection through the store', async () => {
    renderWithFleet([
      makeVehicle(1, 'Roadster'),
      makeVehicle(2, 'Cybertruck'),
    ]);
    const select = (await screen.findByTestId('vehicle-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('1'));
    fireEvent.change(select, { target: { value: '2' } });
    await waitFor(() => expect(select.value).toBe('2'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it('falls back to the VIN when display_name is empty', async () => {
    renderWithFleet([{ ...makeVehicle(1, '', 'VIN-VINONLY'), display_name: '' }]);
    expect(await screen.findByRole('option', { name: 'VIN-VINONLY' })).toBeInTheDocument();
  });

  it('honors a custom aria-label', async () => {
    renderWithFleet([makeVehicle(1, 'Roadster')]);
    expect(
      await screen.findByLabelText(
        (await Promise.resolve('Select vehicle')) as string,
      ),
    ).toBeInTheDocument();
  });

  it('defers to the managed shell vehicle selector', () => {
    const { container } = renderWithFleet(
      [makeVehicle(1, 'Roadster')],
      ['/dashboard'],
      { range: false, vehicle: true },
    );
    expect(container.querySelector('select')).toBeNull();
  });

  it('keeps intentionally local vehicle fields visible under a managed shell', async () => {
    renderWithFleet(
      [makeVehicle(1, 'Roadster')],
      ['/dashboard'],
      { range: false, vehicle: true },
      'local',
    );
    expect(await screen.findByTestId('vehicle-select')).toBeInTheDocument();
  });
});
