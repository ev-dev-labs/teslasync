import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, value),
        fallback,
      ),
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const refetch = vi.fn();
const reset = vi.fn();
const mutate = vi.fn();

function query<T>(data: T) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    isStale: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch,
  };
}

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => query([{ id: 7, display_name: 'Pool Y', vin: 'VIN7' }]),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatPower: (value: number | null) => value == null ? '—' : `${value / 1000} kW`,
    formatDistance: (value: number | null) => value == null ? '—' : `${value / 1000} km`,
    unitPrefs: { distance: 'km' },
  }),
}));

vi.mock('@/api/hooks/useFleetOps', () => ({
  useFleetDrivers: () => query({ items: [{
    id: 2,
    reference_code: 'DRV-A',
    display_name: 'Driver A',
    status: 'active',
    version: 3,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }], total: 1, limit: 100, offset: 0 }),
  useFleetAssignments: () => query({ items: [{
    id: 1,
    vehicle_id: 7,
    vehicle_display_name: 'Pool Y',
    driver_id: 2,
    driver_display_name: 'Driver A',
    starts_at: '2026-08-01T00:00:00Z',
    ends_at: null,
    notes: null,
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }], total: 1, limit: 100, offset: 0 }),
  useFleetReservations: () => query({ items: [{
    id: 3,
    vehicle_id: 7,
    vehicle_display_name: 'Pool Y',
    driver_id: 2,
    driver_display_name: 'Driver A',
    cost_center_id: 4,
    cost_center_name: 'Field',
    title: 'Airport run',
    purpose: null,
    starts_at: '2026-08-06T10:00:00Z',
    ends_at: '2026-08-06T11:00:00Z',
    status: 'confirmed',
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }], total: 1, limit: 100, offset: 0 }),
  useFleetCostCenters: () => query({ items: [{
    id: 4,
    code: 'FIELD',
    name: 'Field team',
    active: true,
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }], total: 1, limit: 100, offset: 0 }),
  useFleetChargingPolicies: () => query({ items: [{
    id: 5,
    vehicle_id: 7,
    vehicle_display_name: 'Pool Y',
    name: 'Depot nights',
    target_soc_pct: 80,
    max_power_w: 11000,
    priority: 10,
    effective_from: '2026-08-01T00:00:00Z',
    effective_to: null,
    enabled: true,
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    windows: [{ day_of_week: 1, start_local_time: '00:00', end_local_time: '06:00' }],
  }], total: 1, limit: 100, offset: 0 }),
  useFleetWorkOrders: () => query({ items: [{
    id: 6,
    vehicle_id: 7,
    vehicle_display_name: 'Pool Y',
    cost_center_id: 4,
    cost_center_name: 'Field',
    title: 'Rotate tires',
    description: null,
    status: 'open',
    severity: 'high',
    due_odometer_m: 100000,
    due_at: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    cost_minor: 10000,
    currency: 'USD',
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }], total: 1, limit: 100, offset: 0 }),
  useFleetUtilizationForecast: () => query({
    from: '2026-08-05T00:00:00Z',
    to: '2026-08-19T00:00:00Z',
    generated_at: '2026-08-05T00:00:00Z',
    quality: 'fair',
    history_drive_count: 20,
    history_day_count: 12,
    limitations: ['Moderate history.'],
    points: [{
      vehicle_id: 7,
      vehicle_display_name: 'Pool Y',
      forecast_date: '2026-08-06T00:00:00Z',
      available_s: 36000,
      reserved_s: 7200,
      maintenance_downtime_s: 0,
      historical_expected_s: 3600,
      expected_utilization_pct: 20,
      lower_utilization_pct: 10,
      upper_utilization_pct: 35,
    }],
  }),
  useCreateFleetReservation: () => ({
    mutate,
    reset,
    isPending: false,
    isError: false,
    error: null,
  }),
  useUpdateFleetReservation: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useCreateFleetDriver: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useUpdateFleetDriver: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useCreateFleetAssignment: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useUpdateFleetAssignment: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useCreateFleetCostCenter: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useUpdateFleetCostCenter: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useCreateFleetChargingPolicy: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useUpdateFleetChargingPolicy: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useCreateFleetWorkOrder: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useUpdateFleetWorkOrder: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetDriver: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetAssignment: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetCostCenter: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetChargingPolicy: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetWorkOrder: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetReservation: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
}));

import FleetOperationsPage from './FleetOperationsPage';

beforeEach(() => {
  refetch.mockReset();
  reset.mockReset();
  mutate.mockReset();
});

describe('FleetOperationsPage', () => {
  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <FleetOperationsPage />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it('renders every operational panel and opens the reservation workflow', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Fleet operations' })).toBeInTheDocument();
    expect(screen.getByText('Reservation calendar')).toBeInTheDocument();
    expect(screen.getByText('Fleet drivers')).toBeInTheDocument();
    expect(screen.getByText('Assignment roster')).toBeInTheDocument();
    expect(screen.getByText('Cost-center allocation')).toBeInTheDocument();
    expect(screen.getByText('Charging policy matrix')).toBeInTheDocument();
    expect(screen.getByText('Maintenance work-order board')).toBeInTheDocument();
    expect(screen.getByText('Utilization forecast')).toBeInTheDocument();
    expect(screen.getAllByText('Pool Y').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'New reservation' }));
    expect(screen.getByRole('dialog', { name: 'Create reservation' })).toBeInTheDocument();
  });

  it('creates and version-updates a driver with typed payloads', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add driver' }));
    const createDialog = screen.getByRole('dialog', { name: 'Add driver' });
    fireEvent.change(within(createDialog).getByLabelText(/Display name/), { target: { value: 'Driver B' } });
    fireEvent.change(within(createDialog).getByLabelText(/Non-sensitive reference code/), { target: { value: 'DRV-B' } });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenLastCalledWith(
      { display_name: 'Driver B', reference_code: 'DRV-B', status: 'active' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    mutate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Driver A' }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit driver' });
    fireEvent.change(within(editDialog).getByLabelText(/Display name/), { target: { value: 'Driver A2' } });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        id: 2,
        version: 3,
        input: { display_name: 'Driver A2', reference_code: 'DRV-A', status: 'active' },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('passes the current version when deleting a driver', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Driver A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mutate).toHaveBeenCalledWith(
      { id: 2, version: 3 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('opens each fleet resource creation workflow', () => {
    renderPage();
    const workflows = [
      ['Add assignment', 'Add assignment'],
      ['Add cost center', 'Add cost center'],
      ['Add policy', 'Add charging policy'],
      ['Add work order', 'Add work order'],
    ];
    workflows.forEach(([buttonName, dialogName]) => {
      fireEvent.click(screen.getByRole('button', { name: buttonName }));
      expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
  });

  it('submits normalized charging windows', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add policy' }));
    const dialog = screen.getByRole('dialog', { name: 'Add charging policy' });
    fireEvent.change(within(dialog).getByLabelText(/Vehicle/), { target: { value: '7' } });
    fireEvent.change(within(dialog).getByLabelText(/Policy name/), { target: { value: 'Overnight' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle_id: 7,
        name: 'Overnight',
        target_soc_pct: 80,
        max_power_w: null,
        windows: [{
          day_of_week: 1,
          start_local_time: '00:00',
          end_local_time: '06:00',
        }],
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('edits a timeline reservation with its optimistic version', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Airport run' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Edit reservation' });
    fireEvent.change(within(dialog).getByLabelText(/Reservation name/), {
      target: { value: 'Airport return' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        id: 3,
        version: 1,
        input: expect.objectContaining({
          vehicle_id: 7,
          driver_id: 2,
          cost_center_id: 4,
          title: 'Airport return',
          status: 'confirmed',
        }),
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('cancels a timeline reservation using a versioned update', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel Airport run' })[0]);
    expect(screen.getByRole('dialog', { name: 'Cancel reservation?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        id: 3,
        version: 1,
        input: expect.objectContaining({
          title: 'Airport run',
          status: 'cancelled',
        }),
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('deletes a timeline reservation with its optimistic version', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Airport run' })[0]);
    expect(screen.getByRole('dialog', { name: 'Delete reservation?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mutate).toHaveBeenCalledWith(
      { id: 3, version: 1 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
